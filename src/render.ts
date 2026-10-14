// SVG schematic renderer with animated current flow.
// Current is drawn as dots marching along every wire and component (dash-offset animation),
// with speed proportional to the square root of the current so small currents stay visible.

import type { Circuit, Component } from "./types";
import type { Solution } from "./solver";
import { KIND_LABEL, formatSI, formatValue } from "./format";

const SVG_NS = "http://www.w3.org/2000/svg";
const U = 80; // pixels per grid unit
export const GRID = U;
const H = 26; // half-length of a component symbol
const DOT_GAP = 18;

type Vec = { x: number; y: number };

export interface ViewOptions {
  playing: boolean;
  speed: number; // multiplier
  electronFlow: boolean;
  showLabels: boolean;
  showNodeVoltages: boolean;
  editMode: boolean;
}

export interface Highlight {
  components: string[];
  nodes: number[];
}

interface Flow {
  el: SVGPathElement;
  current: number;
  offset: number;
}

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** Low -> high voltage colour ramp (cool blue -> violet -> warm orange). */
function voltageColor(t: number): string {
  const stops = [
    [56, 189, 248],
    [167, 139, 250],
    [251, 146, 60],
  ];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class CircuitView {
  readonly svg: SVGSVGElement;
  /** Circuit drawing; rebuilt on every render. */
  private scene: SVGGElement;
  /** Editor overlays (cursor, placement preview); survives renders. */
  readonly overlay: SVGGElement;
  private tooltip: HTMLElement;
  /** Wire selected in the editor, if any. */
  selectedWire: number | null = null;
  /** Keeps the viewBox fixed (e.g. while dragging) so the drawing doesn't shift under the cursor. */
  freezeViewBox = false;
  private flows: Flow[] = [];
  private last = 0;
  private circuit: Circuit | null = null;
  private solution: Solution | null = null;
  private highlight: Highlight | null = null;
  private selected: string | null = null;
  opts: ViewOptions = { playing: true, speed: 1, electronFlow: false, showLabels: true, showNodeVoltages: true, editMode: false };
  onSelect: (componentId: string | null) => void = () => {};
  /** Called after each render with the voltage range used for colouring (null if unsolved). */
  onLegend: (range: { min: number; max: number } | null) => void = () => {};

  constructor(svg: SVGSVGElement, tooltip: HTMLElement) {
    this.svg = svg;
    this.tooltip = tooltip;
    this.scene = el("g", {}, svg);
    this.overlay = el("g", { class: "overlay" }, svg);
    requestAnimationFrame(this.tick);
    svg.addEventListener("click", (e) => {
      if (!this.opts.editMode && e.target === svg) this.select(null);
    });
  }

  /** Re-draws the current circuit (e.g. after an edit) without the intro animation. */
  refresh() {
    this.render(false);
  }

  /** Converts a mouse position to the nearest grid coordinate. */
  toGrid(clientX: number, clientY: number): Vec {
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.round(p.x / U), y: Math.round(p.y / U) };
  }

  private computeViewBox(xs: number[], ys: number[]): string {
    const edit = this.opts.editMode;
    const pad = edit ? U * 1.5 : U * 0.9;
    if (xs.length === 0) return `${-U} ${-U} ${U * 10} ${U * 6}`;
    let minX = Math.min(...xs) - pad;
    let minY = Math.min(...ys) - pad;
    let w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    let h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    if (edit) {
      // Leave room to keep drawing around a small circuit.
      const minW = U * 10;
      const minH = U * 6;
      if (w < minW) (minX -= (minW - w) / 2), (w = minW);
      if (h < minH) (minY -= (minH - h) / 2), (h = minH);
    }
    return `${minX} ${minY} ${w} ${h}`;
  }

  setCircuit(c: Circuit | null, sol: Solution | null) {
    const isNew = c !== this.circuit;
    this.circuit = c;
    this.solution = sol;
    if (isNew) this.selected = null;
    this.render(isNew);
  }

  setOptions(o: Partial<ViewOptions>) {
    const needsRender = o.showLabels !== undefined || o.showNodeVoltages !== undefined || o.editMode !== undefined;
    Object.assign(this.opts, o);
    if (needsRender) this.render(false);
  }

  setHighlight(h: Highlight | null) {
    this.highlight = h;
    this.applyHighlight();
  }

  select(id: string | null) {
    this.selected = id;
    this.applyHighlight();
    this.onSelect(id);
  }

  // ------------------------------------------------------------ animation

  private tick = (t: number) => {
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
    this.last = t;
    if (this.opts.playing && this.flows.length) {
      const imax = Math.max(...this.flows.map((f) => Math.abs(f.current)));
      const dir = this.opts.electronFlow ? -1 : 1;
      for (const f of this.flows) {
        const rel = Math.abs(f.current) / imax;
        const v = (25 + 110 * Math.sqrt(rel)) * this.opts.speed;
        f.offset -= Math.sign(f.current) * dir * v * dt;
        f.el.style.strokeDashoffset = String(f.offset % (DOT_GAP * 100));
      }
    }
    requestAnimationFrame(this.tick);
  };

  // ------------------------------------------------------------ rendering

  private render(intro: boolean) {
    const svg = this.scene;
    svg.replaceChildren();
    this.flows = [];
    const c = this.circuit;
    if (!c) {
      this.onLegend(null);
      return;
    }
    const sol = this.solution;
    const edit = this.opts.editMode;
    const pts = new Map(c.points.map((p) => [p.id, { x: p.x * U, y: p.y * U }]));
    const P = (id: string): Vec => pts.get(id) ?? { x: 0, y: 0 };

    // View box around all points with room for labels.
    const xs = c.points.map((p) => p.x * U);
    const ys = c.points.map((p) => p.y * U);
    if (!this.freezeViewBox) this.svg.setAttribute("viewBox", this.computeViewBox(xs, ys));

    const defs = el("defs", {}, svg);
    const glow = el("filter", { id: "heat", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    el("feGaussianBlur", { stdDeviation: 5 }, glow);
    if (edit) {
      // Snap-grid dots, one per grid unit.
      const pat = el("pattern", { id: "grid", width: U, height: U, x: -U / 2, y: -U / 2, patternUnits: "userSpaceOnUse" }, defs);
      el("circle", { cx: U / 2, cy: U / 2, r: 2.2, class: "grid-dot" }, pat);
      el("rect", { x: -U * 60, y: -U * 60, width: U * 120, height: U * 120, fill: "url(#grid)", class: "grid-bg" }, svg);
    }

    // Voltage colouring.
    let vmin = 0;
    let vmax = 0;
    if (sol) {
      vmin = Math.min(...sol.nodeVoltage);
      vmax = Math.max(...sol.nodeVoltage);
    }
    const nodeColor = (pointId: string): string => {
      if (!sol || !this.opts.showNodeVoltages) return "var(--wire)";
      const n = sol.topology.nodeOf.get(pointId);
      if (n === undefined) return "var(--wire)";
      const span = vmax - vmin;
      return voltageColor(span < 1e-12 ? 0.5 : (sol.nodeVoltage[n] - vmin) / span);
    };
    this.onLegend(sol && this.opts.showNodeVoltages ? { min: vmin, max: vmax } : null);

    // Dots run above the wires but beneath component symbols, so symbols stay readable.
    const wireLayer = el("g", { class: "wires" }, svg);
    const flowLayer = el("g", { class: "flows" }, svg);
    const compLayer = el("g", { class: "components" }, svg);
    const labelLayer = el("g", { class: "labels" }, svg);
    const maxX = Math.max(...xs);

    const addFlow = (d: string, current: number, cls: string) => {
      if (!sol || Math.abs(current) < 1e-12) return;
      const p = el("path", { d, class: `flow ${cls}`, "stroke-dasharray": `0 ${DOT_GAP}` }, flowLayer);
      this.flows.push({ el: p, current, offset: Math.random() * DOT_GAP });
    };
    const imaxAll = sol ? Math.max(1e-30, ...Object.values(sol.compI).map(Math.abs)) : 1;
    const flowsAreTiny = (i: number) => Math.abs(i) < imaxAll * 1e-9;

    // Wires.
    c.wires.forEach((wr, wi) => {
      const a = P(wr.a);
      const b = P(wr.b);
      const d = elbow(a, b);
      const node = sol?.topology.nodeOf.get(wr.a);
      el("path", { d, class: "wire", stroke: nodeColor(wr.a), "data-node": node ?? "" }, wireLayer);
      if (edit) el("path", { d, class: `wire-hit${this.selectedWire === wi ? " selected" : ""}`, "data-wire": wi }, wireLayer);
      const i = sol ? sol.wireI[wi] : 0;
      if (sol && !flowsAreTiny(i)) addFlow(d, i, `node-${node}`);
    });

    // Junction dots where three or more conductors meet.
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    c.wires.forEach((wr) => (bump(wr.a), bump(wr.b)));
    c.components.forEach((k) => (bump(k.a), bump(k.b)));
    for (const [id, d] of degree) {
      if (d >= 3) {
        const p = P(id);
        const node = sol?.topology.nodeOf.get(id);
        el("circle", { cx: p.x, cy: p.y, r: 4.5, fill: nodeColor(id), class: "junction", "data-node": node ?? "" }, wireLayer);
      }
    }

    // Components.
    const pmax = sol ? Math.max(1e-30, ...c.components.filter((k) => k.kind === "resistor").map((k) => Math.abs(sol.compP[k.id]))) : 1;
    c.components.forEach((k, idx) => {
      const a = P(k.a);
      const b = P(k.b);
      const g = el("g", { class: "component", "data-id": k.id, tabindex: 0, role: "button", "aria-label": k.id }, compLayer);
      if (intro) g.style.animationDelay = `${idx * 70}ms`;
      if (intro) g.classList.add("intro");
      this.drawComponent(g, k, a, b, nodeColor(k.a), nodeColor(k.b), sol ? Math.abs(sol.compP[k.id]) / pmax : 0);

      const i = sol?.compI[k.id] ?? 0;
      if (sol && !flowsAreTiny(i)) addFlow(`M${a.x},${a.y} L${b.x},${b.y}`, i, `comp-${k.id}`);

      g.addEventListener("mouseenter", (e) => this.showTooltip(k, e as MouseEvent));
      g.addEventListener("mousemove", (e) => this.moveTooltip(e as MouseEvent));
      g.addEventListener("mouseleave", () => (this.tooltip.hidden = true));
      g.addEventListener("click", (e) => {
        if (this.opts.editMode) return; // the editor handles pointer input itself
        e.stopPropagation();
        this.select(this.selected === k.id ? null : k.id);
      });
      g.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") this.select(k.id);
      });

      if (this.opts.showLabels) this.drawLabel(labelLayer, k, a, b, a.x >= maxX && b.x >= maxX);
    });

    // Ground symbol.
    const gp = c.ground && pts.has(c.ground) ? c.ground : sol?.topology.nodePoints[sol.topology.ground]?.[0];
    if (gp) this.drawGround(compLayer, P(gp), nodeColor(gp));

    // Draggable point handles in edit mode.
    if (edit) {
      const handles = el("g", { class: "handles" }, svg);
      for (const p of c.points) {
        const q = P(p.id);
        el("circle", { cx: q.x, cy: q.y, r: 6, class: "point-handle", "data-point": p.id }, handles);
      }
    }

    // Node voltage badges.
    if (sol && this.opts.showNodeVoltages && this.opts.showLabels) {
      sol.topology.nodePoints.forEach((ptsOfNode, n) => {
        // Badge at the node's top-left-most point.
        const best = ptsOfNode
          .map((id) => ({ id, p: P(id) }))
          .sort((u, v) => u.p.y - v.p.y || u.p.x - v.p.x)[0];
        if (!best) return;
        const text = `${sol.topology.nodeNames[n]} ${formatSI(sol.nodeVoltage[n], "V", 3)}`;
        const gx = el("g", { class: "node-badge", "data-node": n }, labelLayer);
        const tw = text.length * 6.6 + 12;
        el("rect", { x: best.p.x - tw / 2, y: best.p.y - 40, width: tw, height: 18, rx: 9, fill: nodeColor(best.id) }, gx);
        const t = el("text", { x: best.p.x, y: best.p.y - 27, "text-anchor": "middle" }, gx);
        t.textContent = text;
      });
    }

    this.applyHighlight();
  }

  private drawComponent(g: SVGGElement, k: Component, a: Vec, b: Vec, colA: string, colB: string, heat: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const hl = Math.min(H, len / 2 - 4);
    const s = { x: mid.x - ux * hl, y: mid.y - uy * hl };
    const e = { x: mid.x + ux * hl, y: mid.y + uy * hl };
    // Leads in each terminal's node colour.
    el("line", { x1: a.x, y1: a.y, x2: s.x, y2: s.y, class: "wire", stroke: colA }, g);
    el("line", { x1: e.x, y1: e.y, x2: b.x, y2: b.y, class: "wire", stroke: colB }, g);
    // Invisible fat hit target.
    el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "hit" }, g);

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const sym = el("g", { transform: `translate(${mid.x},${mid.y}) rotate(${angle})`, class: `symbol ${k.kind}` }, g);
    const sc = hl / H;
    const s1 = (v: number) => v * sc;

    switch (k.kind) {
      case "resistor": {
        const n = 6;
        let d = `M${s1(-H)},0`;
        for (let i = 0; i < n; i++) {
          const x = s1(-H + ((i + 0.5) * 2 * H) / n);
          d += ` L${x},${i % 2 ? 9 : -9}`;
        }
        d += ` L${s1(H)},0`;
        if (heat > 0.02) el("path", { d, class: "heat", opacity: Math.min(1, 0.25 + heat * 0.9) }, sym);
        el("path", { d, class: "body" }, sym);
        break;
      }
      case "capacitor":
        el("line", { x1: s1(-H), y1: 0, x2: -5, y2: 0, class: "body" }, sym);
        el("line", { x1: 5, y1: 0, x2: s1(H), y2: 0, class: "body" }, sym);
        el("line", { x1: -5, y1: -15, x2: -5, y2: 15, class: "body plate" }, sym);
        el("line", { x1: 5, y1: -15, x2: 5, y2: 15, class: "body plate" }, sym);
        break;
      case "inductor": {
        const n = 4;
        const r = s1(H) / n;
        let d = `M${s1(-H)},0`;
        for (let i = 0; i < n; i++) d += ` a${r},${r} 0 0 1 ${2 * r},0`;
        el("path", { d, class: "body" }, sym);
        break;
      }
      case "voltage_source":
      case "current_source": {
        el("circle", { cx: 0, cy: 0, r: 20, class: "body source" }, sym);
        el("line", { x1: s1(-H), y1: 0, x2: -20, y2: 0, class: "body" }, sym);
        el("line", { x1: 20, y1: 0, x2: s1(H), y2: 0, class: "body" }, sym);
        if (k.kind === "current_source") this.arrow(sym);
        else this.plusMinus(sym, angle);
        break;
      }
      default: {
        // Dependent sources: diamond.
        el("path", { d: "M-21,0 L0,-21 L21,0 L0,21 Z", class: "body source" }, sym);
        el("line", { x1: s1(-H), y1: 0, x2: -21, y2: 0, class: "body" }, sym);
        el("line", { x1: 21, y1: 0, x2: s1(H), y2: 0, class: "body" }, sym);
        if (k.kind === "vccs" || k.kind === "cccs") this.arrow(sym);
        else this.plusMinus(sym, angle);
      }
    }
  }

  private arrow(sym: SVGGElement) {
    el("line", { x1: -11, y1: 0, x2: 9, y2: 0, class: "glyph" }, sym);
    el("path", { d: "M11,0 L3,-6 L3,6 Z", class: "glyph-fill" }, sym);
  }

  /** + near terminal a, − near terminal b; glyphs counter-rotated so they stay upright. */
  private plusMinus(sym: SVGGElement, angle: number) {
    const plus = el("g", { transform: `translate(-10,0) rotate(${-angle})` }, sym);
    el("path", { d: "M-4.5,0 H4.5 M0,-4.5 V4.5", class: "glyph" }, plus);
    const minus = el("g", { transform: `translate(10,0) rotate(${-angle})` }, sym);
    el("path", { d: "M-4.5,0 H4.5", class: "glyph" }, minus);
  }

  private drawGround(parent: SVGGElement, p: Vec, color: string) {
    const g = el("g", { class: "ground", transform: `translate(${p.x},${p.y})` }, parent);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 16, class: "wire", stroke: color }, g);
    el("line", { x1: -14, y1: 16, x2: 14, y2: 16, class: "gnd" }, g);
    el("line", { x1: -9, y1: 22, x2: 9, y2: 22, class: "gnd" }, g);
    el("line", { x1: -4, y1: 28, x2: 4, y2: 28, class: "gnd" }, g);
  }

  private drawLabel(layer: SVGGElement, k: Component, a: Vec, b: Vec, onRightEdge: boolean) {
    const sol = this.solution;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const g = el("g", { class: "label", "data-id": k.id }, layer);
    // Vertical parts get their label to the right, or to the left when they sit on the right edge.
    const x = vertical ? mid.x + (onRightEdge ? -30 : 30) : mid.x;
    const y = vertical ? mid.y - 6 : mid.y - 34;
    const anchor = vertical ? (onRightEdge ? "end" : "start") : "middle";
    const name = el("text", { x, y, "text-anchor": anchor, class: "label-name" }, g);
    name.textContent = k.id;
    const valueText = k.value === null
      ? sol
        ? `= ${formatValue(k.kind, sol.values[k.id])}`
        : "?"
      : formatValue(k.kind, k.value);
    const tspan = el("tspan", { class: k.value === null ? "label-unknown" : "label-value", dx: 6 }, name);
    tspan.textContent = valueText;
    if (sol) {
      const i = formatSI(Math.abs(sol.compI[k.id]), "A", 3);
      const v = formatSI(sol.compV[k.id], "V", 3);
      // Vertical parts stack I and V to stay narrow; horizontal parts have room for one line.
      const lines = vertical ? [i, v] : [`${i} · ${v}`];
      lines.forEach((text, n) => {
        const t = el("text", { x, y: y + 15 * (n + 1), "text-anchor": anchor, class: "label-result" }, g);
        t.textContent = text;
      });
    }
  }

  private applyHighlight() {
    const h = this.highlight;
    const svg = this.svg;
    const sel = this.selected;
    // While editing, a selection only highlights; dimming the rest would get in the way.
    svg.classList.toggle("dimmed", !!h || (!!sel && !this.opts.editMode));
    const comps = new Set(h?.components ?? []);
    if (sel) comps.add(sel);
    const nodes = new Set((h?.nodes ?? []).map(String));
    svg.querySelectorAll<SVGElement>(".component").forEach((g) => {
      g.classList.toggle("hl", comps.has(g.dataset.id!));
      g.classList.toggle("selected", g.dataset.id === sel);
    });
    svg.querySelectorAll<SVGElement>(".label").forEach((g) => g.classList.toggle("hl", comps.has(g.dataset.id!)));
    svg.querySelectorAll<SVGElement>(".wire[data-node], .junction, .node-badge").forEach((w) => {
      w.classList.toggle("hl", nodes.has(w.dataset.node ?? (w.getAttribute("data-node") as string)));
    });
    svg.querySelectorAll<SVGElement>(".flow").forEach((f) => {
      const cls = [...f.classList].find((c) => c.startsWith("comp-") || c.startsWith("node-")) ?? "";
      const on = cls.startsWith("comp-") ? comps.has(cls.slice(5)) : nodes.has(cls.slice(5));
      f.classList.toggle("hl", on);
    });
  }

  // ------------------------------------------------------------ tooltip

  private showTooltip(k: Component, e: MouseEvent) {
    const sol = this.solution;
    const rows: [string, string][] = [["Type", KIND_LABEL[k.kind]]];
    const v = sol ? sol.values[k.id] : k.value;
    rows.push(["Value", v === null || v === undefined ? "unknown" : formatValue(k.kind, v)]);
    if (sol) {
      rows.push(["Voltage", formatSI(sol.compV[k.id], "V")]);
      rows.push(["Current", formatSI(sol.compI[k.id], "A")]);
      const p = sol.compP[k.id];
      rows.push([p >= 0 ? "Absorbs" : "Delivers", formatSI(Math.abs(p), "W")]);
    }
    const t = this.tooltip;
    t.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = k.id;
    t.appendChild(title);
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      const l = document.createElement("span");
      l.textContent = label;
      const r = document.createElement("span");
      r.textContent = value;
      row.append(l, r);
      t.appendChild(row);
    }
    t.hidden = false;
    this.moveTooltip(e);
  }

  private moveTooltip(e: MouseEvent) {
    const t = this.tooltip;
    const box = t.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    t.style.left = `${e.clientX - box.left + 14}px`;
    t.style.top = `${e.clientY - box.top + 14}px`;
  }
}

/** Straight line, or an L-shaped path if the wire isn't axis-aligned. */
function elbow(a: Vec, b: Vec): string {
  if (a.x === b.x || a.y === b.y) return `M${a.x},${a.y} L${b.x},${b.y}`;
  return `M${a.x},${a.y} L${b.x},${a.y} L${b.x},${b.y}`;
}
