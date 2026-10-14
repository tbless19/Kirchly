// Interactive schematic editor: place, move, rewire and delete parts on the snap grid.

import type { Circuit, ComponentKind } from "./types";
import { CircuitView, GRID, el } from "./render";
import { addComponent, addWire, normalize, removeComponent, removeWire } from "./edit-ops";
import { KIND_LABEL } from "./format";

export type Tool = "select" | "wire" | "ground" | "delete" | ComponentKind;

type Vec = { x: number; y: number };

type Drag =
  | { kind: "point"; id: string }
  | { kind: "component"; id: string; origin: Vec; a: Vec; b: Vec };

const SHORTCUTS: Record<string, Tool> = {
  s: "select",
  w: "wire",
  r: "resistor",
  v: "voltage_source",
  i: "current_source",
  c: "capacitor",
  l: "inductor",
  g: "ground",
  d: "delete",
};

const MAX_HISTORY = 100;

export class Editor {
  active = false;
  tool: Tool = "select";
  private start: Vec | null = null;
  private drag: Drag | null = null;
  /** Snapshot taken when a drag begins; committed to history only if something actually moved. */
  private dragSnapshot: string | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private cursor: SVGCircleElement;
  private preview: SVGPathElement;

  /** Called after every change to the circuit. */
  onChange: () => void = () => {};
  /** Called when the tool changes, with a hint for the status line. */
  onTool: (tool: Tool, hint: string) => void = () => {};
  onHistory: (canUndo: boolean, canRedo: boolean) => void = () => {};

  constructor(
    private view: CircuitView,
    private getCircuit: () => Circuit | null,
  ) {
    this.cursor = el("circle", { r: 9, class: "edit-cursor", visibility: "hidden" }, view.overlay);
    this.preview = el("path", { class: "edit-preview", visibility: "hidden" }, view.overlay);
    const svg = view.svg;
    svg.addEventListener("pointerdown", this.pointerDown);
    svg.addEventListener("pointermove", this.pointerMove);
    svg.addEventListener("pointerup", this.pointerUp);
    svg.addEventListener("pointerleave", () => this.cursor.setAttribute("visibility", "hidden"));
    window.addEventListener("keydown", this.keyDown);
  }

  setActive(on: boolean) {
    this.active = on;
    this.cancel();
    this.view.selectedWire = null;
    this.view.svg.classList.toggle("editing", on);
    this.view.setOptions({ editMode: on });
    if (on) this.setTool(this.tool);
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.cancel();
    this.view.svg.dataset.tool = tool;
    this.onTool(tool, this.hint());
  }

  hint(): string {
    switch (this.tool) {
      case "select":
        return "Drag parts or points to move them. Click a part to edit it. Delete removes the selection.";
      case "wire":
        return this.start ? "Click the next corner; Esc to stop." : "Click (or drag) from one grid point to another to draw a wire.";
      case "ground":
        return "Click a connection point to make it ground (0 V).";
      case "delete":
        return "Click a part or wire to delete it.";
      default:
        return this.start
          ? `Click where the ${KIND_LABEL[this.tool].toLowerCase()} should end; Esc to cancel.`
          : `Click (or drag) between two grid points to place a ${KIND_LABEL[this.tool].toLowerCase()}. It runs from the first point to the second.`;
    }
  }

  // ------------------------------------------------------------ history

  /** Records the current state so the next change can be undone. Call before mutating. */
  snapshot() {
    const c = this.getCircuit();
    if (!c) return;
    this.undoStack.push(JSON.stringify(c));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  /** Discards the most recent snapshot (for an edit that turned out to be invalid). */
  dropSnapshot() {
    this.undoStack.pop();
    this.emitHistory();
  }

  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistory();
  }

  undo() {
    this.restore(this.undoStack, this.redoStack);
  }

  redo() {
    this.restore(this.redoStack, this.undoStack);
  }

  private restore(from: string[], to: string[]) {
    const c = this.getCircuit();
    const s = from.pop();
    if (!c || !s) return;
    to.push(JSON.stringify(c));
    Object.assign(c, JSON.parse(s)); // mutate in place so the view keeps its identity (no intro replay)
    this.view.selectedWire = null;
    this.view.select(null);
    this.emitHistory();
    this.onChange();
  }

  private emitHistory() {
    this.onHistory(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  // ------------------------------------------------------------ actions

  deleteSelection(selectedComponent: string | null) {
    const c = this.getCircuit();
    if (!c) return;
    if (selectedComponent) {
      this.snapshot();
      removeComponent(c, selectedComponent);
      this.view.select(null);
      this.onChange();
    } else if (this.view.selectedWire !== null) {
      this.snapshot();
      removeWire(c, this.view.selectedWire);
      this.view.selectedWire = null;
      this.onChange();
    }
  }

  private cancel() {
    this.start = null;
    this.preview.setAttribute("visibility", "hidden");
  }

  private place(from: Vec, to: Vec) {
    const c = this.getCircuit();
    if (!c) return;
    if (this.tool !== "wire" && from.x !== to.x && from.y !== to.y) {
      // Parts are straight: snap to the dominant axis.
      if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) to = { x: to.x, y: from.y };
      else to = { x: from.x, y: to.y };
    }
    if (from.x === to.x && from.y === to.y) return;
    this.snapshot();
    if (this.tool === "wire") {
      addWire(c, from, to);
      this.start = to; // keep drawing from the corner just placed
    } else {
      const id = addComponent(c, this.tool as ComponentKind, from, to);
      this.start = null;
      this.preview.setAttribute("visibility", "hidden");
      this.onChange();
      this.view.select(id);
      return;
    }
    this.onChange();
  }

  // ------------------------------------------------------------ pointer input

  private pointerDown = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return;
    const c = this.getCircuit();
    if (!c) return;
    const g = this.view.toGrid(e.clientX, e.clientY);
    const target = e.target as Element;
    const pointEl = target.closest<SVGElement>("[data-point]");
    const compEl = target.closest<SVGElement>(".component");
    const wireEl = target.closest<SVGElement>("[data-wire]");

    switch (this.tool) {
      case "select":
        this.view.selectedWire = null;
        if (pointEl) {
          this.beginDrag({ kind: "point", id: pointEl.dataset.point! }, e);
        } else if (compEl) {
          const k = c.components.find((x) => x.id === compEl.dataset.id)!;
          const pa = c.points.find((p) => p.id === k.a)!;
          const pb = c.points.find((p) => p.id === k.b)!;
          this.view.select(k.id);
          this.beginDrag({ kind: "component", id: k.id, origin: g, a: { x: pa.x, y: pa.y }, b: { x: pb.x, y: pb.y } }, e);
        } else if (wireEl) {
          this.view.select(null);
          this.view.selectedWire = Number(wireEl.dataset.wire);
          this.view.refresh();
        } else {
          this.view.select(null);
          this.view.refresh();
        }
        break;
      case "delete":
        if (compEl) {
          this.snapshot();
          removeComponent(c, compEl.dataset.id!);
          this.onChange();
        } else if (wireEl) {
          this.snapshot();
          removeWire(c, Number(wireEl.dataset.wire));
          this.onChange();
        }
        break;
      case "ground": {
        const p = c.points.find((q) => q.x === g.x && q.y === g.y);
        if (p) {
          this.snapshot();
          c.ground = p.id;
          this.onChange();
        }
        break;
      }
      default:
        // Wire and part tools: first press sets the start, release (drag) or second press sets the end.
        if (this.start) this.place(this.start, g);
        else this.start = g;
        this.view.svg.setPointerCapture(e.pointerId);
        this.onTool(this.tool, this.hint());
    }
  };

  private pointerMove = (e: PointerEvent) => {
    if (!this.active) return;
    const g = this.view.toGrid(e.clientX, e.clientY);
    this.cursor.setAttribute("cx", String(g.x * GRID));
    this.cursor.setAttribute("cy", String(g.y * GRID));
    this.cursor.setAttribute("visibility", this.tool === "select" ? "hidden" : "visible");

    if (this.start) {
      let end = g;
      if (this.tool !== "wire" && end.x !== this.start.x && end.y !== this.start.y) {
        end = Math.abs(g.x - this.start.x) >= Math.abs(g.y - this.start.y) ? { x: g.x, y: this.start.y } : { x: this.start.x, y: g.y };
      }
      const s = this.start;
      const d =
        this.tool === "wire" && s.x !== end.x && s.y !== end.y
          ? `M${s.x * GRID},${s.y * GRID} L${end.x * GRID},${s.y * GRID} L${end.x * GRID},${end.y * GRID}`
          : `M${s.x * GRID},${s.y * GRID} L${end.x * GRID},${end.y * GRID}`;
      this.preview.setAttribute("d", d);
      this.preview.setAttribute("visibility", "visible");
    }

    if (this.drag) this.dragTo(g);
  };

  private pointerUp = (e: PointerEvent) => {
    if (!this.active) return;
    if (this.view.svg.hasPointerCapture(e.pointerId)) this.view.svg.releasePointerCapture(e.pointerId);
    if (this.drag) {
      const moved = this.dragSnapshot === null; // snapshot is consumed on first movement
      this.drag = null;
      this.dragSnapshot = null;
      this.view.freezeViewBox = false;
      const c = this.getCircuit();
      if (moved && c) {
        normalize(c);
        this.onChange();
      }
      return;
    }
    // Drag-to-place: releasing on a different grid point finishes the part.
    if (this.start && this.tool !== "select") {
      const g = this.view.toGrid(e.clientX, e.clientY);
      if (g.x !== this.start.x || g.y !== this.start.y) {
        const wasWire = this.tool === "wire";
        this.place(this.start, g);
        if (wasWire) this.cancel(); // a dragged wire is a single segment
      }
    }
  };

  private beginDrag(d: Drag, e: PointerEvent) {
    this.drag = d;
    this.dragSnapshot = JSON.stringify(this.getCircuit());
    this.view.freezeViewBox = true;
    this.view.svg.setPointerCapture(e.pointerId);
  }

  private dragTo(g: Vec) {
    const c = this.getCircuit();
    const d = this.drag;
    if (!c || !d) return;
    let changed = false;
    const move = (id: string, to: Vec) => {
      const p = c.points.find((q) => q.id === id);
      if (p && (p.x !== to.x || p.y !== to.y)) {
        if (this.dragSnapshot !== null) {
          // First real movement: commit the pre-drag state to history.
          this.undoStack.push(this.dragSnapshot);
          this.redoStack = [];
          this.dragSnapshot = null;
          this.emitHistory();
        }
        p.x = to.x;
        p.y = to.y;
        changed = true;
      }
    };
    if (d.kind === "point") {
      move(d.id, g);
    } else {
      const k = c.components.find((x) => x.id === d.id);
      if (!k) return;
      const dx = g.x - d.origin.x;
      const dy = g.y - d.origin.y;
      move(k.a, { x: d.a.x + dx, y: d.a.y + dy });
      move(k.b, { x: d.b.x + dx, y: d.b.y + dy });
    }
    if (changed) this.view.refresh();
  }

  // ------------------------------------------------------------ keyboard

  private keyDown = (e: KeyboardEvent) => {
    if (!this.active) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, dialog")) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === "escape") {
      if (this.start) {
        this.cancel();
        this.onTool(this.tool, this.hint());
      } else this.setTool("select");
      return;
    }
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      this.deleteSelection(this.selectedComponent());
      return;
    }
    if (SHORTCUTS[key]) this.setTool(SHORTCUTS[key]);
  };

  /** The component currently selected in the view, read from the DOM. */
  private selectedComponent(): string | null {
    return this.view.svg.querySelector<SVGElement>(".component.selected")?.dataset.id ?? null;
  }
}
