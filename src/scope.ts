// AC "scope": rotating phasor diagram + one period of v(t) and i(t) for one component,
// with a cursor that follows the schematic animation's phase θ = ωt.

import { el } from "./render";
import type { Solution } from "./solver";
import { abs, argDeg, instant, scale, type Complex } from "./complex";
import { formatDeg, formatPhasor } from "./format";

const W = 300;
const HT = 132;
const PC = { x: 62, y: 66 }; // phasor diagram centre
const PR = 52; // phasor radius
const WX0 = 136; // waveform plot left
const WX1 = 294;
const WY = 66; // waveform zero line
const WA = 50; // waveform half height

export class Scope {
  private svg: SVGSVGElement;
  private vArrow: SVGLineElement;
  private iArrow: SVGLineElement;
  private vProj: SVGLineElement;
  private iProj: SVGLineElement;
  private cursor: SVGLineElement;
  private vDot: SVGCircleElement;
  private iDot: SVGCircleElement;
  private vWave: SVGPathElement;
  private iWave: SVGPathElement;
  private caption: HTMLElement;
  private v: Complex | null = null;
  private i: Complex | null = null;

  constructor(svg: SVGSVGElement, caption: HTMLElement) {
    this.svg = svg;
    this.caption = caption;
    svg.setAttribute("viewBox", `0 0 ${W} ${HT}`);
    const defs = el("defs", {}, svg);
    for (const [id, cls] of [["arrow-v", "scope-v"], ["arrow-i", "scope-i"]]) {
      const m = el("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
      el("path", { d: "M0,0 L10,5 L0,10 Z", class: `${cls}-fill` }, m);
    }
    // Phasor plane.
    el("circle", { cx: PC.x, cy: PC.y, r: PR, class: "scope-grid" }, svg);
    el("line", { x1: PC.x - PR - 4, y1: PC.y, x2: PC.x + PR + 4, y2: PC.y, class: "scope-axis" }, svg);
    el("line", { x1: PC.x, y1: PC.y - PR - 4, x2: PC.x, y2: PC.y + PR + 4, class: "scope-axis" }, svg);
    this.vProj = el("line", { class: "scope-proj scope-v" }, svg);
    this.iProj = el("line", { class: "scope-proj scope-i" }, svg);
    this.vArrow = el("line", { class: "scope-arrow scope-v", "marker-end": "url(#arrow-v)" }, svg);
    this.iArrow = el("line", { class: "scope-arrow scope-i", "marker-end": "url(#arrow-i)" }, svg);
    // Waveforms.
    el("line", { x1: WX0, y1: WY, x2: WX1, y2: WY, class: "scope-axis" }, svg);
    el("line", { x1: WX0, y1: WY - WA, x2: WX0, y2: WY + WA, class: "scope-axis" }, svg);
    this.vWave = el("path", { class: "scope-wave scope-v" }, svg);
    this.iWave = el("path", { class: "scope-wave scope-i" }, svg);
    this.cursor = el("line", { y1: WY - WA, y2: WY + WA, class: "scope-cursor" }, svg);
    this.vDot = el("circle", { r: 3.5, class: "scope-v-fill" }, svg);
    this.iDot = el("circle", { r: 3.5, class: "scope-i-fill" }, svg);
  }

  /** Shows component `id` of the solution (V and I phasors). */
  set(sol: Solution | null, id: string | null, isSource = false) {
    this.v = sol && id ? sol.compV[id] : null;
    // For sources, show the current delivered out of the + terminal rather than the absorbed-sign current.
    this.i = sol && id ? (isSource ? scale(sol.compI[id], -1) : sol.compI[id]) : null;
    this.svg.style.visibility = this.v ? "visible" : "hidden";
    if (!this.v || !this.i) {
      this.caption.textContent = "";
      return;
    }
    // One period of each waveform, each normalised to its own peak.
    for (const [z, path, scale] of [
      [this.v, this.vWave, 1],
      [this.i, this.iWave, 0.75],
    ] as const) {
      const m = abs(z) || 1;
      let d = "";
      for (let s = 0; s <= 64; s++) {
        const th = (s / 64) * 2 * Math.PI;
        const x = WX0 + (s / 64) * (WX1 - WX0);
        const y = WY - (instant(z, th) / m) * WA * scale;
        d += `${s ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      path.setAttribute("d", d);
    }
    const lag = argDeg(this.v) - argDeg(this.i);
    const rel =
      abs(this.i) < 1e-15 || abs(this.v) < 1e-15
        ? ""
        : Math.abs(lag) < 0.5
          ? "in phase"
          : `I ${lag > 0 ? "lags" : "leads"} V by ${formatDeg(Math.abs(((lag + 540) % 360) - 180))}`;
    this.caption.replaceChildren();
    const vSpan = document.createElement("span");
    vSpan.className = "cap-v";
    vSpan.textContent = `V ${formatPhasor(this.v, "V", 3)}`;
    const iSpan = document.createElement("span");
    iSpan.className = "cap-i";
    iSpan.textContent = `I${isSource ? " out" : ""} ${formatPhasor(this.i, "A", 3)}`;
    const relSpan = document.createElement("span");
    relSpan.textContent = rel;
    this.caption.append(vSpan, iSpan, relSpan);
    this.frame(0);
  }

  /** Moves the phasors and cursor to phase θ (radians). */
  frame(theta: number) {
    if (!this.v || !this.i) return;
    for (const [z, arrow, proj, dot, scale] of [
      [this.v, this.vArrow, this.vProj, this.vDot, 1],
      [this.i, this.iArrow, this.iProj, this.iDot, 0.75],
    ] as const) {
      const m = abs(z);
      const len = m > 1e-15 ? PR * scale : 0;
      const ang = (argDeg(z) * Math.PI) / 180 + theta;
      const x = PC.x + len * Math.cos(ang);
      const y = PC.y - len * Math.sin(ang);
      arrow.setAttribute("x1", String(PC.x));
      arrow.setAttribute("y1", String(PC.y));
      arrow.setAttribute("x2", x.toFixed(1));
      arrow.setAttribute("y2", y.toFixed(1));
      // Projection on the real axis = instantaneous value.
      proj.setAttribute("x1", x.toFixed(1));
      proj.setAttribute("y1", y.toFixed(1));
      proj.setAttribute("x2", x.toFixed(1));
      proj.setAttribute("y2", String(PC.y));
      const wx = WX0 + (theta / (2 * Math.PI)) * (WX1 - WX0);
      const wy = WY - (m > 1e-15 ? (instant(z, theta) / m) * WA * scale : 0);
      dot.setAttribute("cx", wx.toFixed(1));
      dot.setAttribute("cy", wy.toFixed(1));
      this.cursor.setAttribute("x1", wx.toFixed(1));
      this.cursor.setAttribute("x2", wx.toFixed(1));
    }
  }
}
