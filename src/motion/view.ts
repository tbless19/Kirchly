// Drawing and playback for motion scenes: a Stage maps world coordinates (metres, y up) onto the SVG,
// and MotionView runs the clock, the time slider and the graphs.

import { el } from "../render";

export const VW = 800;
export const VH = 460;
const PAD = 48;

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** A vector arrow whose geometry is updated each frame. */
export class Arrow {
  private line: SVGLineElement;
  private head: SVGPathElement;
  private label: SVGTextElement;
  constructor(parent: SVGGElement, cls: string, text = "") {
    const g = el("g", { class: `arrow ${cls}` }, parent);
    this.line = el("line", {}, g);
    this.head = el("path", {}, g);
    this.label = el("text", { class: "arrow-label" }, g);
    this.label.textContent = text;
  }
  /** Draws from screen point (x, y) along screen vector (dx, dy). Hidden when shorter than 3 px. */
  set(x: number, y: number, dx: number, dy: number, text?: string) {
    const len = Math.hypot(dx, dy);
    const vis = len >= 3;
    this.line.style.display = this.head.style.display = this.label.style.display = vis ? "" : "none";
    if (!vis) return;
    const ux = dx / len;
    const uy = dy / len;
    const hx = x + dx;
    const hy = y + dy;
    const hl = Math.min(11, len * 0.6);
    this.line.setAttribute("x1", f(x));
    this.line.setAttribute("y1", f(y));
    this.line.setAttribute("x2", f(hx - ux * hl * 0.6));
    this.line.setAttribute("y2", f(hy - uy * hl * 0.6));
    const px = -uy * hl * 0.45;
    const py = ux * hl * 0.45;
    this.head.setAttribute("d", `M${f(hx)},${f(hy)} L${f(hx - ux * hl + px)},${f(hy - uy * hl + py)} L${f(hx - ux * hl - px)},${f(hy - uy * hl - py)} Z`);
    if (text !== undefined) this.label.textContent = text;
    this.label.setAttribute("x", f(hx + ux * 10 + (Math.abs(uy) > 0.7 ? 8 : 0)));
    this.label.setAttribute("y", f(hy + uy * 10 + 4));
  }
}

const f = (n: number) => n.toFixed(1);

export class Stage {
  readonly g: SVGGElement;
  private k = 1;
  private ox = 0;
  private oy = 0;
  private readouts: HTMLElement;
  constructor(parent: SVGElement, box: Box, readouts: HTMLElement) {
    this.g = el("g", {}, parent);
    this.readouts = readouts;
    const w = Math.max(box.x1 - box.x0, 1e-9);
    const h = Math.max(box.y1 - box.y0, 1e-9);
    this.k = Math.min((VW - 2 * PAD) / w, (VH - 2 * PAD) / h);
    // Centre the box.
    this.ox = (VW - w * this.k) / 2 - box.x0 * this.k;
    this.oy = (VH + h * this.k) / 2 + box.y0 * this.k;
  }
  /** World → screen. */
  X = (x: number) => this.ox + x * this.k;
  Y = (y: number) => this.oy - y * this.k;
  /** World length → screen length. */
  L = (d: number) => d * this.k;

  line(x1: number, y1: number, x2: number, y2: number, cls: string) {
    return el("line", { x1: f(this.X(x1)), y1: f(this.Y(y1)), x2: f(this.X(x2)), y2: f(this.Y(y2)), class: cls }, this.g);
  }
  path(points: [number, number][], cls: string, close = false) {
    const d = points.map(([x, y], i) => `${i ? "L" : "M"}${f(this.X(x))},${f(this.Y(y))}`).join(" ") + (close ? " Z" : "");
    return el("path", { d, class: cls }, this.g);
  }
  text(x: number, y: number, s: string, cls = "scene-text", anchor = "middle") {
    const t = el("text", { x: f(this.X(x)), y: f(this.Y(y)), class: cls, "text-anchor": anchor }, this.g);
    t.textContent = s;
    return t;
  }
  /** A live readout line, shown in the overlay at the top-left of the canvas. */
  label(_x: number, _y: number, s: string, cls = "scene-readout") {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = s;
    this.readouts.appendChild(d);
    return d;
  }
  arrow(cls: string, text = "") {
    return new Arrow(this.g, cls, text);
  }
}

export interface Graph {
  label: string;
  f: (t: number) => number;
  format: (v: number) => string;
}

export interface Scene {
  box: Box;
  /** Real (physical) duration in seconds. */
  duration: number;
  loop?: boolean;
  build(stage: Stage): (t: number) => void;
  graphs?: Graph[];
  /** A short note under the canvas. */
  caption?: string;
}

/** Visual length of one run of the animation, so 0.05 s and 5000 s problems both play watchably. */
function visualDuration(d: number): number {
  return Math.min(8, Math.max(3, d));
}

export class MotionView {
  private svg: SVGSVGElement;
  private update: ((t: number) => void) | null = null;
  private scene: Scene | null = null;
  private t = 0;
  private last = 0;
  playing = true;
  speed = 1;
  private graphs: GraphPanel;
  onTime: (t: number, duration: number, rate: number) => void = () => {};

  private readouts: HTMLElement;
  constructor(svg: SVGSVGElement, graphSvg: SVGSVGElement, readouts: HTMLElement) {
    this.svg = svg;
    this.readouts = readouts;
    svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
    this.graphs = new GraphPanel(graphSvg);
    requestAnimationFrame(this.tick);
  }

  /** Shows a scene, or a message when the problem can't be animated yet. */
  show(scene: Scene | null, message = "") {
    this.svg.replaceChildren();
    this.readouts.replaceChildren();
    this.scene = scene;
    this.update = null;
    this.t = 0;
    if (!scene) {
      const t = el("text", { x: VW / 2, y: VH / 2, class: "scene-empty", "text-anchor": "middle" }, this.svg);
      t.textContent = message;
      this.graphs.set(null, 0);
      return;
    }
    const stage = new Stage(this.svg, scene.box, this.readouts);
    this.update = scene.build(stage);
    this.update(0);
    this.graphs.set(scene.graphs ?? null, scene.duration);
  }

  /** Seconds of physics per second of animation at speed 1. */
  get rate() {
    return this.scene ? this.scene.duration / visualDuration(this.scene.duration) : 1;
  }

  seek(fraction: number) {
    if (!this.scene) return;
    this.t = Math.min(1, Math.max(0, fraction)) * this.scene.duration;
    this.draw();
  }

  private draw() {
    if (!this.scene || !this.update) return;
    this.update(this.t);
    this.graphs.cursor(this.t);
    this.onTime(this.t, this.scene.duration, this.rate);
  }

  private tick = (now: number) => {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.playing && this.scene && this.update) {
      this.t += dt * this.rate * this.speed;
      if (this.t > this.scene.duration) {
        // Hold the final frame for a moment, then replay.
        if (this.t > this.scene.duration * (this.scene.loop ? 1 : 1.25)) this.t = 0;
      }
      const shown = Math.min(this.t, this.scene.duration);
      const keep = this.t;
      this.t = shown;
      this.draw();
      this.t = keep;
    }
    requestAnimationFrame(this.tick);
  };
}

/** Small time plots with a moving cursor. */
class GraphPanel {
  private svg: SVGSVGElement;
  private cursors: { line: SVGLineElement; dot: SVGCircleElement; g: Graph; y: (v: number) => number; x: (t: number) => number }[] = [];
  constructor(svg: SVGSVGElement) {
    this.svg = svg;
  }
  set(graphs: Graph[] | null, duration: number) {
    this.svg.replaceChildren();
    this.cursors = [];
    const card = this.svg.closest(".card") as HTMLElement | null;
    if (card) card.hidden = !graphs || !graphs.length;
    if (!graphs || !graphs.length || !(duration > 0)) return;
    const W = 300;
    const H = 86;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H * graphs.length}`);
    graphs.forEach((g, i) => {
      const top = i * H;
      const x0 = 50;
      const x1 = W - 6;
      const y0 = top + 18;
      const y1 = top + H - 14;
      const n = 120;
      const ts = Array.from({ length: n + 1 }, (_, k) => (k / n) * duration);
      const vs = ts.map(g.f);
      let lo = Math.min(...vs, 0);
      let hi = Math.max(...vs, 0);
      if (hi - lo < 1e-12) (hi += 1), (lo -= 1);
      const x = (t: number) => x0 + (t / duration) * (x1 - x0);
      const y = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
      const title = el("text", { x: 2, y: top + 11, class: "graph-title" }, this.svg);
      title.textContent = g.label;
      el("line", { x1: x0, y1: y(0), x2: x1, y2: y(0), class: "graph-axis" }, this.svg);
      el("line", { x1: x0, y1: y0, x2: x0, y2: y1, class: "graph-axis" }, this.svg);
      const hiT = el("text", { x: x0 - 3, y: y0 + 4, class: "graph-tick", "text-anchor": "end" }, this.svg);
      hiT.textContent = g.format(hi);
      const loT = el("text", { x: x0 - 3, y: y1, class: "graph-tick", "text-anchor": "end" }, this.svg);
      loT.textContent = g.format(lo);
      const endT = el("text", { x: x1, y: top + H - 2, class: "graph-tick", "text-anchor": "end" }, this.svg);
      endT.textContent = `${Number(duration.toPrecision(3))} s`;
      el("path", { d: vs.map((v, k) => `${k ? "L" : "M"}${f(x(ts[k]))},${f(y(v))}`).join(" "), class: `graph-line graph-${i}` }, this.svg);
      const line = el("line", { y1: y0, y2: y1, class: "graph-cursor" }, this.svg);
      const dot = el("circle", { r: 3.5, class: `graph-dot graph-${i}` }, this.svg);
      this.cursors.push({ line, dot, g, x, y });
    });
  }
  cursor(t: number) {
    for (const c of this.cursors) {
      const cx = f(c.x(t));
      c.line.setAttribute("x1", cx);
      c.line.setAttribute("x2", cx);
      c.dot.setAttribute("cx", cx);
      c.dot.setAttribute("cy", f(c.y(c.g.f(t))));
    }
  }
}
