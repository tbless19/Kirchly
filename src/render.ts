// SVG schematic renderer with animated current flow.
// Current is drawn as dots marching along every wire and component (dash-offset animation).
//   - DC: steady flow, speed ∝ √|I| so small currents stay visible.
//   - AC: dots follow the instantaneous current i(t) = Re(I·e^{jθ}) and slosh back and forth;
//     wire colours follow the instantaneous node voltages. θ advances slowly so the motion is visible.

import type { Circuit, Component } from "./types";
import { impedanceOf, type Solution } from "./solver";
import { KIND_LABEL, describeValue, formatPhasor, formatPhasorShort as shortPhasor, formatRect, formatSI } from "./format";
import { abs, argDeg, instant, type Complex } from "./complex";

const SVG_NS = "http://www.w3.org/2000/svg";
const U = 80; // pixels per grid unit
export const GRID = U;
const H = 26; // half-length of a component symbol
const DOT_GAP = 18;
/** Visual AC frequency: cycles per second of animation time at speed 1. */
const AC_VISUAL_HZ = 0.3;

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

export interface Legend {
  min: number;
  max: number;
  ac: boolean;
}

interface Flow {
  el: SVGPathElement;
  current: Complex;
  offset: number;
}

/** An element whose colour follows a node's voltage. */
interface Tinted {
  el: SVGElement;
  node: number;
  attr: "stroke" | "fill";
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
  private tinted: Tinted[] = [];
  private last = 0;
  /** AC animation phase θ = ωt in radians (animation time, not real time). */
  phase = 0;
  private circuit: Circuit | null = null;
  private solution: Solution | null = null;
  private highlight: Highlight | null = null;
  private selected: string | null = null;
  opts: ViewOptions = { playing: true, speed: 1, electronFlow: false, showLabels: true, showNodeVoltages: true, editMode: false };
  onSelect: (componentId: string | null) => void = () => {};
  /** Called after each render with the voltage range used for colouring (null if unsolved). */
  onLegend: (legend: Legend | null) => void = () => {};
  /** Called every animation frame with the AC phase θ (radians). */
  onFrame: (phase: number) => void = () => {};

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
    const sol = this.solution;
    if (this.opts.playing) {
      const dir = this.opts.electronFlow ? -1 : 1;
      if (sol?.ac) {
        this.phase = (this.phase + 2 * Math.PI * AC_VISUAL_HZ * this.opts.speed * dt) % (2 * Math.PI);
        const imax = Math.max(1e-30, ...this.flows.map((f) => abs(f.current)));
        for (const f of this.flows) {
          const rel = instant(f.current, this.phase) / imax;
          const v = 150 * Math.sign(rel) * Math.sqrt(Math.abs(rel)) * this.opts.speed;
          f.offset -= dir * v * dt;
          f.el.style.strokeDashoffset = String(f.offset % (DOT_GAP * 100));
          f.el.style.strokeOpacity = String(0.2 + 0.8 * Math.sqrt(Math.abs(rel)));
        }
        this.tint();
      } else if (this.flows.length) {
        const imax = Math.max(...this.flows.map((f) => Math.abs(f.current.re)));
        for (const f of this.flows) {
          const rel = Math.abs(f.current.re) / imax;
          const v = (25 + 110 * Math.sqrt(rel)) * this.opts.speed;
          f.offset -= Math.sign(f.current.re) * dir * v * dt;
          f.el.style.strokeDashoffset = String(f.offset % (DOT_GAP * 100));
        }
      }
    }
    if (sol?.ac) this.onFrame(this.phase);
    requestAnimationFrame(this.tick);
  };

  /** AC: recolour wires by the instantaneous node voltages. */
  private tint() {
    const sol = this.solution;
    if (!sol?.ac || !this.opts.showNodeVoltages || !this.tinted.length) return;
    const vmax = Math.max(1e-30, ...sol.nodeV.map(abs));
    const colors = sol.nodeV.map((v) => voltageColor(0.5 + (0.5 * instant(v, this.phase)) / vmax));
    for (const t of this.tinted) t.el.setAttribute(t.attr, colors[t.node]);
  }

  // ------------------------------------------------------------ rendering

  private render(intro: boolean) {
    const svg = this.scene;
    svg.replaceChildren();
    this.flows = [];
    this.tinted = [];
    const c = this.circuit;
    if (!c) {
      this.onLegend(null);
      return;
    }
    const sol = this.solution;
    const ac = !!sol?.ac;
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

    // Voltage colouring: static in DC; in AC the initial colour is overwritten every frame by tint().
    let vmin = 0;
    let vmax = 0;
    if (sol) {
      if (ac) {
        vmax = Math.max(...sol.nodeV.map(abs));
        vmin = -vmax;
      } else {
        vmin = Math.min(...sol.nodeV.map((v) => v.re));
        vmax = Math.max(...sol.nodeV.map((v) => v.re));
      }
    }
    const nodeOfPoint = (pointId: string) => sol?.topology.nodeOf.get(pointId);
    const nodeColor = (pointId: string): string => {
      const n = nodeOfPoint(pointId);
      if (!sol || !this.opts.showNodeVoltages || n === undefined) return "var(--wire)";
      const v = ac ? instant(sol.nodeV[n], this.phase) : sol.nodeV[n].re;
      const span = vmax - vmin;
      return voltageColor(span < 1e-12 ? 0.5 : (v - vmin) / span);
    };
    /** Registers an element for per-frame AC recolouring. */
    const tint = <T extends SVGElement>(e: T, pointId: string, attr: "stroke" | "fill" = "stroke"): T => {
      const n = nodeOfPoint(pointId);
      if (ac && n !== undefined) this.tinted.push({ el: e, node: n, attr });
      return e;
    };
    this.onLegend(sol && this.opts.showNodeVoltages ? { min: vmin, max: vmax, ac } : null);

    // Dots run above the wires but beneath component symbols, so symbols stay readable.
    const wireLayer = el("g", { class: "wires" }, svg);
    const flowLayer = el("g", { class: "flows" }, svg);
    const compLayer = el("g", { class: "components" }, svg);
    const labelLayer = el("g", { class: "labels" }, svg);
    const maxX = Math.max(...xs);

    const imaxAll = sol ? Math.max(1e-30, ...Object.values(sol.compI).map(abs)) : 1;
    const addFlow = (d: string, current: Complex, cls: string) => {
      if (!sol || abs(current) < imaxAll * 1e-9) return;
      const p = el("path", { d, class: `flow ${cls}`, "stroke-dasharray": `0 ${DOT_GAP}` }, flowLayer);
      this.flows.push({ el: p, current, offset: Math.random() * DOT_GAP });
    };

    // Wires.
    c.wires.forEach((wr, wi) => {
      const a = P(wr.a);
      const b = P(wr.b);
      const d = elbow(a, b);
      const node = nodeOfPoint(wr.a);
      tint(el("path", { d, class: "wire", stroke: nodeColor(wr.a), "data-node": node ?? "" }, wireLayer), wr.a);
      if (edit) el("path", { d, class: `wire-hit${this.selectedWire === wi ? " selected" : ""}`, "data-wire": wi }, wireLayer);
      if (sol) addFlow(d, sol.wireI[wi], `node-${node}`);
    });

    // Junction dots where three or more conductors meet.
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    c.wires.forEach((wr) => (bump(wr.a), bump(wr.b)));
    c.components.forEach((k) => (bump(k.a), bump(k.b)));
    for (const [id, d] of degree) {
      if (d >= 3) {
        const p = P(id);
        const node = nodeOfPoint(id);
        tint(el("circle", { cx: p.x, cy: p.y, r: 4.5, fill: nodeColor(id), class: "junction", "data-node": node ?? "" }, wireLayer), id, "fill");
      }
    }

    // Components.
    const pmax = sol ? Math.max(1e-30, ...c.components.filter((k) => k.kind === "resistor" || k.kind === "impedance").map((k) => Math.abs(sol.compS[k.id].re))) : 1;
    c.components.forEach((k, idx) => {
      const a = P(k.a);
      const b = P(k.b);
      const g = el("g", { class: "component", "data-id": k.id, tabindex: 0, role: "button", "aria-label": k.id }, compLayer);
      if (intro) g.style.animationDelay = `${idx * 70}ms`;
      if (intro) g.classList.add("intro");
      const [leadA, leadB] = this.drawComponent(g, k, a, b, nodeColor(k.a), nodeColor(k.b), sol ? Math.abs(sol.compS[k.id].re) / pmax : 0);
      tint(leadA, k.a);
      tint(leadB, k.b);

      if (sol) addFlow(`M${a.x},${a.y} L${b.x},${b.y}`, sol.compI[k.id], `comp-${k.id}`);

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
        const value = ac ? shortPhasor(sol.nodeV[n], "V") : formatSI(sol.nodeV[n].re, "V", 3);
        const text = `${sol.topology.nodeNames[n]} ${value}`;
        const gx = el("g", { class: "node-badge", "data-node": n }, labelLayer);
        const tw = text.length * 6.6 + 12;
        tint(el("rect", { x: best.p.x - tw / 2, y: best.p.y - 40, width: tw, height: 18, rx: 9, fill: nodeColor(best.id) }, gx), best.id, "fill");
        const t = el("text", { x: best.p.x, y: best.p.y - 27, "text-anchor": "middle" }, gx);
        t.textContent = text;
      });
    }

    this.applyHighlight();
  }

  /** Draws a part; returns its two lead lines (for voltage tinting). */
  private drawComponent(g: SVGGElement, k: Component, a: Vec, b: Vec, colA: string, colB: string, heat: number): [SVGLineElement, SVGLineElement] {
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
    const leadA = el("line", { x1: a.x, y1: a.y, x2: s.x, y2: s.y, class: "wire", stroke: colA }, g);
    const leadB = el("line", { x1: e.x, y1: e.y, x2: b.x, y2: b.y, class: "wire", stroke: colB }, g);
    // Invisible fat hit target.
    el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "hit" }, g);

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const sym = el("g", { transform: `translate(${mid.x},${mid.y}) rotate(${angle})`, class: `symbol ${k.kind}` }, g);
    const sc = hl / H;
    const s1 = (v: number) => v * sc;
    const ac = !!this.solution?.ac;

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
      case "impedance": {
        const w = s1(H) - 4;
        if (heat > 0.02) el("rect", { x: -w, y: -9, width: 2 * w, height: 18, class: "heat", opacity: Math.min(1, 0.25 + heat * 0.9) }, sym);
        el("line", { x1: s1(-H), y1: 0, x2: -w, y2: 0, class: "body" }, sym);
        el("line", { x1: w, y1: 0, x2: s1(H), y2: 0, class: "body" }, sym);
        el("rect", { x: -w, y: -9, width: 2 * w, height: 18, rx: 2, class: "body source" }, sym);
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
        else if (ac) this.sineGlyph(sym, angle);
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
    return [leadA, leadB];
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

  /** AC source: a sine wave, plus a small + at terminal a to keep the polarity visible. */
  private sineGlyph(sym: SVGGElement, angle: number) {
    const wave = el("g", { transform: `rotate(${-angle})` }, sym);
    el("path", { d: "M-11,0 C-7,-11 -3,-11 0,0 S7,11 11,0", class: "glyph" }, wave);
    const plus = el("g", { transform: `translate(-28,-11) rotate(${-angle})` }, sym);
    el("path", { d: "M-3.5,0 H3.5 M0,-3.5 V3.5", class: "glyph" }, plus);
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
    const ac = !!sol?.ac;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const g = el("g", { class: "label", "data-id": k.id }, layer);
    // Vertical parts get their label to the right, or to the left when they sit on the right edge.
    // AC results take two lines everywhere (phasors are long), so horizontal labels sit a line higher.
    const stacked = vertical || ac;
    const x = vertical ? mid.x + (onRightEdge ? -30 : 30) : mid.x;
    const y = vertical ? mid.y - 6 : mid.y - (sol && ac ? 49 : 34);
    const anchor = vertical ? (onRightEdge ? "end" : "start") : "middle";
    const name = el("text", { x, y, "text-anchor": anchor, class: "label-name" }, g);
    name.textContent = k.id;
    const unknown = k.value === null || (k.kind === "impedance" && k.reactance === null);
    const shown = unknown && sol ? { ...k, value: sol.values[k.id], reactance: sol.reactances[k.id] ?? k.reactance } : k;
    const tspan = el("tspan", { class: unknown ? "label-unknown" : "label-value", dx: 6 }, name);
    tspan.textContent = (unknown && sol ? "= " : "") + describeValue(shown, ac).replace(" ∠ ", "∠");
    if (sol) {
      const iz = sol.compI[k.id];
      const vz = sol.compV[k.id];
      const i = ac ? shortPhasor(iz, "A") : formatSI(Math.abs(iz.re), "A", 3);
      const v = ac ? shortPhasor(vz, "V") : formatSI(vz.re, "V", 3);
      // Vertical parts stack I and V to stay narrow; horizontal parts have room for one line.
      const lines = stacked ? [i, v] : [`${i} · ${v}`];
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
    const ac = !!sol?.ac;
    const rows: [string, string][] = [["Type", KIND_LABEL[k.kind]]];
    const shown = sol ? { ...k, value: sol.values[k.id], reactance: sol.reactances[k.id] ?? k.reactance } : k;
    rows.push(["Value", shown.value === null ? "unknown" : describeValue(shown, ac)]);
    if (sol) {
      const z = impedanceOf(k, sol);
      if (ac && z) rows.push(["Impedance", formatRect(z, "Ω")]);
      rows.push(["Voltage", ac ? formatPhasor(sol.compV[k.id], "V") : formatSI(sol.compV[k.id].re, "V")]);
      rows.push(["Current", ac ? formatPhasor(sol.compI[k.id], "A") : formatSI(sol.compI[k.id].re, "A")]);
      const s = sol.compS[k.id];
      rows.push([s.re >= 0 ? (ac ? "Avg power in" : "Absorbs") : ac ? "Avg power out" : "Delivers", formatSI(Math.abs(s.re), "W")]);
      if (ac) rows.push(["Reactive", formatSI(s.im, "var")]);
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
