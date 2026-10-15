// One animated scene per problem type. Each takes the solved values and returns a Scene,
// or a message naming what is still missing.

import type { Values } from "./models";
import type { MotionType } from "./models";
import { Stage, VW, type Graph, type Scene } from "./view";
import { formatQuantity, type Dim } from "./units";
import { el } from "../render";

const rad = (d: number) => (d * Math.PI) / 180;
const fmt = (v: number, dim: Dim) => formatQuantity(v, dim, 3);
const graph = (label: string, f: (t: number) => number, dim: Dim): Graph => ({ label, f, format: (v) => fmt(v, dim) });

type Builder = (v: Values, variant: string) => Scene | string;

/** Names of required values that are missing, as a message; "" if all present. */
function need(v: Values, keys: [string, string][]): string {
  const missing = keys.filter(([k]) => !Number.isFinite(v[k])).map(([, label]) => label);
  return missing.length ? `To animate this, the solver still needs: ${missing.join(", ")}.` : "";
}

/** Maximum of |f| over [0, T]. */
function maxAbs(f: (t: number) => number, T: number): number {
  let m = 0;
  for (let i = 0; i <= 200; i++) m = Math.max(m, Math.abs(f((i / 200) * T)));
  return m || 1;
}

/** A zig-zag spring between two screen points. */
function springPath(x1: number, y1: number, x2: number, y2: number, coils = 10, width = 10): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const lead = Math.min(12, len * 0.15);
  let d = `M${x1},${y1} L${x1 + ux * lead},${y1 + uy * lead}`;
  const body = len - 2 * lead;
  for (let i = 0; i < coils * 2; i++) {
    const s = lead + (body * (i + 0.5)) / (coils * 2);
    const side = i % 2 ? -width : width;
    d += ` L${(x1 + ux * s - uy * side).toFixed(1)},${(y1 + uy * s + ux * side).toFixed(1)}`;
  }
  d += ` L${x2 - ux * lead},${y2 - uy * lead} L${x2},${y2}`;
  return d;
}

// ------------------------------------------------------------------ 1D kinematics

const kinematics1d: Builder = (v, variant) => {
  const miss = need(v, [["v0", "initial velocity"], ["a", "acceleration"], ["t", "time"]]);
  if (miss) return miss;
  const T = v.t;
  if (!(T > 0)) return "The motion takes zero time, so there is nothing to animate.";
  const x = (t: number) => v.v0 * t + 0.5 * v.a * t * t;
  const vel = (t: number) => v.v0 + v.a * t;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i <= 200; i++) (lo = Math.min(lo, x((i / 200) * T))), (hi = Math.max(hi, x((i / 200) * T)));
  const span = Math.max(hi - lo, 1e-6);
  const vmax = maxAbs(vel, T);
  const vertical = variant === "free_fall";
  const graphs = [graph(vertical ? "Height y(t)" : "Position x(t)", x, "length"), graph("Velocity v(t)", vel, "speed")];

  if (vertical) {
    return {
      box: { x0: -span * 0.6, y0: lo - span * 0.12, x1: span * 0.6, y1: hi + span * 0.15 },
      duration: T,
      graphs,
      build(s) {
        s.line(-span * 0.35, lo - span * 0.02, span * 0.35, lo - span * 0.02, "ground");
        s.line(-span * 0.12, lo, -span * 0.12, hi, "ruler");
        s.text(-span * 0.15, 0, "start", "scene-text dim", "end");
        s.line(-span * 0.14, 0, -span * 0.1, 0, "ruler");
        const ball = el("circle", { r: 11, class: "ball" }, s.g);
        const va = s.arrow("arrow-v", "v");
        const aa = s.arrow("arrow-a", "a");
        const ro = s.label(16, 26, "");
        return (t) => {
          const px = s.X(0);
          const py = s.Y(x(t));
          ball.setAttribute("cx", String(px));
          ball.setAttribute("cy", String(py));
          va.set(px + 20, py, 0, (-vel(t) / vmax) * 90);
          aa.set(px + 44, py, 0, v.a ? -Math.sign(v.a) * 55 : 0);
          ro.textContent = `t = ${fmt(t, "time")}   y = ${fmt(x(t), "length")}   v = ${fmt(vel(t), "speed")}`;
        };
      },
    };
  }

  return {
    box: { x0: lo - span * 0.08, y0: -span * 0.12, x1: hi + span * 0.08, y1: span * 0.22 },
    duration: T,
    graphs,
    build(s) {
      s.line(lo - span * 0.08, 0, hi + span * 0.08, 0, "ground");
      s.line(0, 0, 0, span * 0.03, "ruler");
      s.text(0, -span * 0.05, "start", "scene-text dim");
      const car = el("g", { class: "car" }, s.g);
      el("rect", { x: -26, y: -24, width: 52, height: 18, rx: 5, class: "body" }, car);
      el("circle", { cx: -14, cy: -5, r: 6, class: "wheel" }, car);
      el("circle", { cx: 14, cy: -5, r: 6, class: "wheel" }, car);
      const va = s.arrow("arrow-v", "v");
      const aa = s.arrow("arrow-a", "a");
      const ro = s.label(16, 26, "");
      return (t) => {
        const px = s.X(x(t));
        const py = s.Y(0);
        car.setAttribute("transform", `translate(${px.toFixed(1)},${py.toFixed(1)})`);
        va.set(px, py - 36, (vel(t) / vmax) * 90, 0);
        aa.set(px, py - 58, v.a ? Math.sign(v.a) * 50 : 0, 0);
        ro.textContent = `t = ${fmt(t, "time")}   x = ${fmt(x(t), "length")}   v = ${fmt(vel(t), "speed")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ projectile

const projectile: Builder = (v) => {
  const miss = need(v, [["v0", "launch speed"], ["theta", "launch angle"], ["t", "time of flight"]]);
  if (miss) return miss;
  const g = v.g ?? 9.8;
  const h0 = v.h0 ?? 0;
  const hL = v.hL ?? 0;
  const vx = v.v0 * Math.cos(rad(v.theta));
  const vy0 = v.v0 * Math.sin(rad(v.theta));
  const T = v.t;
  if (!(T > 0)) return "The flight takes zero time.";
  const X = (t: number) => vx * t;
  const Y = (t: number) => h0 + vy0 * t - 0.5 * g * t * t;
  const VY = (t: number) => vy0 - g * t;
  const R = X(T);
  let top = Math.max(h0, hL);
  for (let i = 0; i <= 200; i++) top = Math.max(top, Y((i / 200) * T));
  const base = Math.min(0, h0, hL);
  const w = Math.max(R, top - base, 1e-6);
  const speedMax = Math.max(v.v0, Math.hypot(vx, VY(T)));
  const tp = vy0 / g;
  return {
    box: { x0: -w * 0.12, y0: base - w * 0.06, x1: R + w * 0.12, y1: top + w * 0.1 },
    duration: T,
    graphs: [graph("Height y(t)", Y, "length"), graph("Vertical velocity v_y(t)", VY, "speed")],
    build(s) {
      // Ground, launch cliff, landing ledge.
      s.line(-w * 0.12, base, R + w * 0.12, base, "ground");
      if (h0 > base + 1e-9) s.path([[-w * 0.12, base], [-w * 0.12, h0], [0, h0], [0, base]], "cliff", true);
      if (hL > base + 1e-9) s.path([[R - w * 0.02, base], [R - w * 0.02, hL], [R + w * 0.12, hL], [R + w * 0.12, base]], "cliff", true);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 120; i++) pts.push([X((i / 120) * T), Y((i / 120) * T)]);
      s.path(pts, "trajectory");
      if (tp > 0 && tp < T) {
        s.line(X(tp), Y(tp), X(tp), base, "dim");
        s.text(X(tp), Y(tp) + w * 0.03, `H = ${fmt(Y(tp), "length")}`, "scene-text");
      }
      s.line(0, base - w * 0.03, R, base - w * 0.03, "dim");
      s.text(R / 2, base - w * 0.055, `R = ${fmt(R, "length")}`, "scene-text");
      const trail = el("path", { class: "trail" }, s.g);
      const ball = el("circle", { r: 8, class: "ball" }, s.g);
      const vArrow = s.arrow("arrow-v", "v");
      const vxArrow = s.arrow("arrow-comp", "vₓ");
      const vyArrow = s.arrow("arrow-comp", "v_y");
      const ro = s.label(16, 26, "");
      return (t) => {
        const px = s.X(X(t));
        const py = s.Y(Y(t));
        ball.setAttribute("cx", px.toFixed(1));
        ball.setAttribute("cy", py.toFixed(1));
        let d = "";
        for (let i = 0; i <= 60; i++) {
          const ti = (i / 60) * t;
          d += `${i ? "L" : "M"}${s.X(X(ti)).toFixed(1)},${s.Y(Y(ti)).toFixed(1)}`;
        }
        trail.setAttribute("d", d);
        const k = 90 / speedMax;
        vArrow.set(px, py, vx * k, -VY(t) * k);
        vxArrow.set(px, py, vx * k, 0);
        vyArrow.set(px, py, 0, -VY(t) * k);
        ro.textContent = `t = ${fmt(t, "time")}   x = ${fmt(X(t), "length")}   y = ${fmt(Y(t), "length")}   |v| = ${fmt(Math.hypot(vx, VY(t)), "speed")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ inclined plane

const incline: Builder = (v, variant) => {
  const miss = need(v, [["theta", "incline angle"], ["a", "acceleration"]]);
  if (miss) return miss;
  const v0 = Number.isFinite(v.v0) ? v.v0 : 0;
  const T = Number.isFinite(v.t) && v.t > 0 ? v.t : 2.5;
  const s = (t: number) => v0 * t + 0.5 * v.a * t * t;
  const vel = (t: number) => v0 + v.a * t;
  let travel = 0;
  for (let i = 0; i <= 200; i++) travel = Math.max(travel, Math.abs(s((i / 200) * T)));
  const L = Math.max(travel * 1.35, Number.isFinite(v.d) ? v.d * 1.3 : 0, 1e-6);
  const th = rad(v.theta);
  const down = variant !== "up";
  // Slope from the top-left (0, L sinθ) to the bottom-right (L cosθ, 0).
  const top = { x: 0, y: L * Math.sin(th) };
  const dir = { x: Math.cos(th), y: -Math.sin(th) }; // down the slope
  const start = down ? L * 0.08 : L * 0.92; // distance from the top
  const along = (t: number) => (down ? start + s(t) : start - s(t));
  const size = L * 0.09;
  const m = v.m;
  const g = v.g ?? 9.8;
  const forces = Number.isFinite(m)
    ? { W: m * g, N: v.N ?? m * g * Math.cos(th), f: v.f ?? 0, F: v.F ?? 0 }
    : null;
  const fmax = forces ? Math.max(forces.W, forces.N, forces.f, Math.abs(forces.F), 1e-12) : 1;
  return {
    box: { x0: -L * 0.12, y0: -L * 0.12, x1: L * Math.cos(th) + L * 0.12, y1: L * Math.sin(th) + L * 0.18 },
    duration: T,
    graphs: [graph("Distance along the slope s(t)", s, "length"), graph("Speed v(t)", vel, "speed")],
    caption: forces ? "Forces on the block: weight, normal, friction" + (forces.F ? ", applied force." : ".") : "Give the mass to see the force arrows.",
    build(st) {
      st.path([[0, 0], [0, top.y], [L * Math.cos(th), 0]], "wedge", true);
      st.line(-L * 0.1, 0, L * Math.cos(th) + L * 0.1, 0, "ground");
      st.text(L * Math.cos(th) - L * 0.16, L * 0.03, `θ = ${fmt(v.theta, "angle")}`, "scene-text");
      const block = el("polygon", { class: "body" }, st.g);
      const W = st.arrow("arrow-w", "mg");
      const N = st.arrow("arrow-f", "N");
      const Fr = st.arrow("arrow-fr", "f");
      const Fa = st.arrow("arrow-app", "F");
      const va = st.arrow("arrow-v", "v");
      const ro = st.label(16, 26, "");
      const nrm = { x: Math.sin(th), y: Math.cos(th) }; // outward normal
      return (t) => {
        const d = Math.min(L, Math.max(0, along(t)));
        const bx = top.x + dir.x * d;
        const by = top.y + dir.y * d;
        // Square block sitting on the slope.
        const c = [
          [bx - dir.x * size * 0.5, by - dir.y * size * 0.5],
          [bx + dir.x * size * 0.5, by + dir.y * size * 0.5],
          [bx + dir.x * size * 0.5 + nrm.x * size, by + dir.y * size * 0.5 + nrm.y * size],
          [bx - dir.x * size * 0.5 + nrm.x * size, by - dir.y * size * 0.5 + nrm.y * size],
        ];
        block.setAttribute("points", c.map(([x, y]) => `${st.X(x).toFixed(1)},${st.Y(y).toFixed(1)}`).join(" "));
        const cx = st.X(bx + nrm.x * size * 0.5);
        const cy = st.Y(by + nrm.y * size * 0.5);
        const k = 75 / fmax;
        const motion = down ? 1 : -1; // +1 when moving down the slope
        if (forces) {
          W.set(cx, cy, 0, forces.W * k);
          N.set(cx, cy, nrm.x * forces.N * k, -nrm.y * forces.N * k);
          Fr.set(cx, cy, -motion * dir.x * forces.f * k, motion * dir.y * forces.f * k);
          Fa.set(cx, cy, -dir.x * forces.F * k, dir.y * forces.F * k);
        }
        const sp = vel(t);
        va.set(cx, cy - st.L(size) * 0.9, motion * dir.x * sp * (60 / maxAbs(vel, T)), -motion * dir.y * sp * (60 / maxAbs(vel, T)));
        ro.textContent = `t = ${fmt(t, "time")}   s = ${fmt(s(t), "length")}   v = ${fmt(sp, "speed")}   a = ${fmt(v.a, "accel")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ pulleys

const pulley: Builder = (v, variant) => {
  const miss = need(v, [["a", "acceleration"]]);
  if (miss) return miss;
  const v0 = Number.isFinite(v.v0) ? v.v0 : 0;
  const T = Number.isFinite(v.t) && v.t > 0 ? v.t : 2.5;
  const s = (t: number) => v0 * t + 0.5 * v.a * t * t;
  const vel = (t: number) => v0 + v.a * t;
  const smax = maxAbs(s, T);
  const travel = 2.4;
  const vis = (t: number) => (s(t) / smax) * travel;
  const m1 = v.m1 ?? 1;
  const m2 = v.m2 ?? 1;
  const side = (m: number) => 0.55 + 0.35 * Math.cbrt(m / Math.max(m1, m2));
  const g = v.g ?? 9.8;
  const T_ = v.Ft;
  const fmax = Math.max(m1 * g, m2 * g, T_ ?? 0, 1e-12);
  const table = variant === "table";
  return {
    box: { x0: 0, y0: 0, x1: 10, y1: 8.4 },
    duration: T,
    graphs: [graph("Distance moved s(t)", s, "length"), graph("Speed v(t)", vel, "speed")],
    caption: "m₂ moving down is positive. The drawing compresses the distance to fit.",
    build(st) {
      const ropeL = el("path", { class: "rope" }, st.g);
      const ropeR = el("path", { class: "rope" }, st.g);
      const b1 = el("rect", { class: "body" }, st.g);
      const b2 = el("rect", { class: "body alt" }, st.g);
      const l1 = el("text", { class: "mass-label", "text-anchor": "middle" }, st.g);
      const l2 = el("text", { class: "mass-label", "text-anchor": "middle" }, st.g);
      l1.textContent = "m₁";
      l2.textContent = "m₂";
      const T1 = st.arrow("arrow-f", "T");
      const T2 = st.arrow("arrow-f", "T");
      const W1 = st.arrow("arrow-w", "m₁g");
      const W2 = st.arrow("arrow-w", "m₂g");
      const ro = st.label(16, 26, "");
      const k = 70 / fmax;
      const rect = (r: SVGRectElement, cx: number, cy: number, sz: number) => {
        r.setAttribute("x", (st.X(cx - sz / 2)).toFixed(1));
        r.setAttribute("y", (st.Y(cy + sz / 2)).toFixed(1));
        r.setAttribute("width", st.L(sz).toFixed(1));
        r.setAttribute("height", st.L(sz).toFixed(1));
      };
      const s1 = side(m1);
      const s2 = side(m2);
      if (!table) {
        const pc = { x: 5, y: 7.4 };
        const pr = 0.8;
        el("circle", { cx: st.X(pc.x), cy: st.Y(pc.y), r: st.L(pr), class: "pulley" }, st.g);
        st.line(pc.x, pc.y, pc.x, 8.3, "rope");
        st.line(3.8, 8.3, 6.2, 8.3, "ground");
        return (t) => {
          const d = vis(t);
          const y1 = 3.6 + d; // m1 rises when m2 falls
          const y2 = 3.6 - d;
          ropeL.setAttribute("d", `M${st.X(pc.x - pr)},${st.Y(pc.y)} L${st.X(pc.x - pr)},${st.Y(y1 + s1 / 2)}`);
          ropeR.setAttribute("d", `M${st.X(pc.x + pr)},${st.Y(pc.y)} L${st.X(pc.x + pr)},${st.Y(y2 + s2 / 2)}`);
          rect(b1, pc.x - pr, y1, s1);
          rect(b2, pc.x + pr, y2, s2);
          l1.setAttribute("x", st.X(pc.x - pr).toFixed(1));
          l1.setAttribute("y", (st.Y(y1) + 5).toFixed(1));
          l2.setAttribute("x", st.X(pc.x + pr).toFixed(1));
          l2.setAttribute("y", (st.Y(y2) + 5).toFixed(1));
          if (T_ !== undefined) {
            T1.set(st.X(pc.x - pr) - 14, st.Y(y1 + s1 / 2), 0, -T_ * k);
            T2.set(st.X(pc.x + pr) + 14, st.Y(y2 + s2 / 2), 0, -T_ * k);
          }
          W1.set(st.X(pc.x - pr) - 14, st.Y(y1 - s1 / 2), 0, m1 * g * k);
          W2.set(st.X(pc.x + pr) + 14, st.Y(y2 - s2 / 2), 0, m2 * g * k);
          ro.textContent = `t = ${fmt(t, "time")}   s = ${fmt(s(t), "length")}   v = ${fmt(vel(t), "speed")}   a = ${fmt(v.a, "accel")}`;
        };
      }
      const tableY = 5;
      const pc = { x: 7.6, y: tableY + 0.4 };
      const pr = 0.4;
      st.path([[0.4, tableY], [7.2, tableY], [7.2, 0.3], [6.9, 0.3], [6.9, tableY - 0.3], [0.4, tableY - 0.3]], "wedge", true);
      el("circle", { cx: st.X(pc.x), cy: st.Y(pc.y), r: st.L(pr), class: "pulley" }, st.g);
      st.line(7.2, tableY, pc.x, pc.y, "rope");
      return (t) => {
        const d = vis(t);
        const x1 = 3.4 + d;
        const y2 = 2.6 - d;
        ropeL.setAttribute("d", `M${st.X(x1 + s1 / 2)},${st.Y(tableY + s1 / 2)} L${st.X(pc.x)},${st.Y(pc.y + pr)}`);
        ropeR.setAttribute("d", `M${st.X(pc.x + pr)},${st.Y(pc.y)} L${st.X(pc.x + pr)},${st.Y(y2 + s2 / 2)}`);
        rect(b1, x1, tableY + s1 / 2, s1);
        rect(b2, pc.x + pr, y2, s2);
        l1.setAttribute("x", st.X(x1).toFixed(1));
        l1.setAttribute("y", (st.Y(tableY + s1 / 2) + 5).toFixed(1));
        l2.setAttribute("x", st.X(pc.x + pr).toFixed(1));
        l2.setAttribute("y", (st.Y(y2) + 5).toFixed(1));
        if (T_ !== undefined) {
          T1.set(st.X(x1 + s1 / 2), st.Y(tableY + s1 / 2), T_ * k, 0);
          T2.set(st.X(pc.x + pr) + 14, st.Y(y2 + s2 / 2), 0, -T_ * k);
        }
        W1.set(st.X(x1), st.Y(tableY), 0, m1 * g * k * 0.6);
        W2.set(st.X(pc.x + pr) + 14, st.Y(y2 - s2 / 2), 0, m2 * g * k);
        ro.textContent = `t = ${fmt(t, "time")}   s = ${fmt(s(t), "length")}   v = ${fmt(vel(t), "speed")}   a = ${fmt(v.a, "accel")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ circular motion

const circular: Builder = (v, variant) => {
  const miss = need(v, [["r", "radius"], ["v", "speed"]]);
  if (miss) return miss;
  if (!(v.v > 0)) return "The object isn't moving (v = 0).";
  const Tp = Number.isFinite(v.Tp) ? v.Tp : (2 * Math.PI * v.r) / v.v;
  const r = v.r;
  const vertical = variant.startsWith("vertical");
  const orbit = variant === "orbit";
  return {
    box: { x0: -r * 1.7, y0: -r * 1.45, x1: r * 1.7, y1: r * 1.45 },
    duration: Tp,
    loop: true,
    caption: vertical
      ? "Side view, drawn at constant speed. Forces shown at the point the problem asks about."
      : orbit
        ? "Orbit seen from above."
        : variant === "banked"
          ? `Top view of the curve; the road is banked at ${fmt(v.theta, "angle")}.`
          : "Top view.",
    build(st) {
      st.path(Array.from({ length: 121 }, (_, i) => [r * Math.cos((i / 120) * 2 * Math.PI), r * Math.sin((i / 120) * 2 * Math.PI)] as [number, number]), "orbit-path");
      if (orbit) {
        el("circle", { cx: st.X(0), cy: st.Y(0), r: st.L(r * 0.28), class: "planet" }, st.g);
      } else {
        el("circle", { cx: st.X(0), cy: st.Y(0), r: 3, class: "centre" }, st.g);
      }
      if (vertical) {
        st.line(-r * 1.6, -r * 1.25, r * 1.6, -r * 1.25, "ground");
        const at = variant === "vertical_top" ? r : -r;
        st.text(0, at + (at > 0 ? r * 0.12 : -r * 0.18), variant === "vertical_top" ? "top" : "bottom", "scene-text dim");
      }
      const string = el("line", { class: "rope" }, st.g);
      const ball = el("circle", { r: 10, class: "ball" }, st.g);
      const va = st.arrow("arrow-v", "v");
      const aa = st.arrow("arrow-a", "a_c");
      const wa = st.arrow("arrow-w", "mg");
      const ro = st.label(16, 26, "");
      return (t) => {
        // Vertical circles start at the bottom and go counter-clockwise; others start on the right.
        const phi = (vertical ? -Math.PI / 2 : 0) + (2 * Math.PI * t) / Tp;
        const x = r * Math.cos(phi);
        const y = r * Math.sin(phi);
        const px = st.X(x);
        const py = st.Y(y);
        ball.setAttribute("cx", px.toFixed(1));
        ball.setAttribute("cy", py.toFixed(1));
        if (!orbit && variant !== "flat_curve" && variant !== "banked") {
          string.setAttribute("x1", st.X(0).toFixed(1));
          string.setAttribute("y1", st.Y(0).toFixed(1));
          string.setAttribute("x2", px.toFixed(1));
          string.setAttribute("y2", py.toFixed(1));
        }
        va.set(px, py, -Math.sin(phi) * 70, -Math.cos(phi) * 70);
        aa.set(px, py, -Math.cos(phi) * 50, Math.sin(phi) * 50);
        if (vertical) wa.set(px, py, 0, 40);
        ro.textContent = `v = ${fmt(v.v, "speed")}   a_c = ${fmt(v.ac ?? (v.v * v.v) / r, "accel")}   T = ${fmt(Tp, "time")}   t = ${fmt(t, "time")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ rotation

const rotation: Builder = (v, variant) => {
  const w0 = Number.isFinite(v.w0) ? v.w0 : 0;
  const al = Number.isFinite(v.al) ? v.al : 0;
  if (!w0 && !al) return "Give an initial angular velocity or an angular acceleration to see it turn.";
  const T = Number.isFinite(v.t) && v.t > 0 ? v.t : 3;
  const th = (t: number) => w0 * t + 0.5 * al * t * t;
  const w = (t: number) => w0 + al * t;
  const wmax = maxAbs(w, T);
  const rod = variant.startsWith("rod");
  const aboutEnd = variant === "rod_end";
  return {
    box: { x0: -1.9, y0: -1.45, x1: 1.9, y1: 1.45 },
    duration: T,
    graphs: [graph("Angle Δθ(t)", th, "angle_rad"), graph("Angular velocity ω(t)", w, "angvel")],
    build(st) {
      const R = 1.1;
      const body = el("g", { class: "rotor" }, st.g);
      const cx = st.X(0);
      const cy = st.Y(0);
      const Rp = st.L(R);
      if (rod) {
        const x0 = aboutEnd ? 0 : -Rp;
        el("rect", { x: x0, y: -7, width: aboutEnd ? Rp : 2 * Rp, height: 14, rx: 4, class: "body" }, body);
      } else if (variant === "hoop") {
        el("circle", { cx: 0, cy: 0, r: Rp, class: "hoop" }, body);
      } else if (variant === "point") {
        el("line", { x1: 0, y1: 0, x2: Rp, y2: 0, class: "rope" }, body);
        el("circle", { cx: Rp, cy: 0, r: 10, class: "ball" }, body);
      } else {
        el("circle", { cx: 0, cy: 0, r: Rp, class: "body disk" }, body);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 2 * Math.PI;
          el("line", { x1: 0, y1: 0, x2: Rp * Math.cos(a), y2: Rp * Math.sin(a), class: "spoke" }, body);
        }
      }
      el("circle", { cx: aboutEnd || rod ? (aboutEnd ? Rp : Rp) : Rp, cy: 0, r: 5, class: "marker" }, body);
      el("circle", { cx, cy, r: 4, class: "centre" }, st.g);
      const vt = st.arrow("arrow-v", "v_t");
      const fa = st.arrow("arrow-app", "F");
      const ro = st.label(16, 26, "");
      return (t) => {
        const a = th(t);
        body.setAttribute("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${((-a * 180) / Math.PI).toFixed(2)})`);
        const mx = cx + Rp * Math.cos(a);
        const my = cy - Rp * Math.sin(a);
        const k = (w(t) / wmax) * 70;
        vt.set(mx, my, -Math.sin(a) * k, -Math.cos(a) * k);
        if (Number.isFinite(v.F) && v.F) fa.set(cx + Rp, cy, 0, -Math.sign(v.F) * 55);
        ro.textContent = `t = ${fmt(t, "time")}   Δθ = ${fmt(a, "angle_rad")} (${(a / (2 * Math.PI)).toFixed(2)} rev)   ω = ${fmt(w(t), "angvel")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ energy

const energy: Builder = (v, variant) => {
  const miss = need(v, [["h1", "initial height"], ["h2", "final height"], ["v1", "initial speed"]]);
  if (miss) return miss;
  const g = v.g ?? 9.8;
  const m = Number.isFinite(v.m) ? v.m : 1;
  const perKg = !Number.isFinite(v.m);
  const spring = variant.includes("spring");
  const k = spring && Number.isFinite(v.k) ? v.k : 0;
  const x1 = v.x1 ?? 0;
  const x2 = v.x2 ?? 0;
  const Wnc = v.Wnc ?? 0;
  const span = Math.max(Math.abs(v.h1 - v.h2), Math.max(Math.abs(v.h1), Math.abs(v.h2)), 1);
  const Lx = span * 2.2;
  const y = (x: number) => v.h2 + ((v.h1 - v.h2) * (1 + Math.cos((Math.PI * x) / Lx))) / 2;
  const E0 = 0.5 * m * v.v1 * v.v1 + m * g * v.h1 + 0.5 * k * x1 * x1;
  const KE = (u: number) => E0 + Wnc * u - m * g * y(u * Lx) - (u >= 1 ? 0.5 * k * x2 * x2 : 0);
  // Integrate the trip along the track: dt = ds / v.
  const N = 400;
  const ts = [0];
  const us = [0];
  let stopped = false;
  const vFloor = 0.02 * Math.sqrt(2 * g * span) + 1e-6;
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    const ke = KE(u);
    if (ke < 0) {
      stopped = true;
      break;
    }
    const xA = ((i - 1) / N) * Lx;
    const xB = u * Lx;
    const ds = Math.hypot(xB - xA, y(xB) - y(xA));
    const speed = Math.max(Math.sqrt((2 * Math.max(ke, 0)) / m), vFloor);
    ts.push(ts[ts.length - 1] + ds / speed);
    us.push(u);
  }
  const T = ts[ts.length - 1] || 1;
  const uAt = (t: number) => {
    let i = 1;
    while (i < ts.length && ts[i] < t) i++;
    if (i >= ts.length) return us[us.length - 1];
    const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1] || 1);
    return us[i - 1] + f * (us[i] - us[i - 1]);
  };
  const speedAt = (t: number) => Math.sqrt((2 * Math.max(KE(uAt(t)), 0)) / m);
  const Emax = Math.max(E0, E0 + Math.max(Wnc, 0), 1e-12);
  return {
    box: { x0: -span * 0.35, y0: Math.min(0, v.h1, v.h2) - span * 0.15, x1: Lx + span * 1.7, y1: Math.max(v.h1, v.h2) + span * 0.35 },
    duration: T,
    graphs: [graph("Speed v(t)", speedAt, "speed")],
    caption: `${stopped ? "The object runs out of energy before reaching the end. " : ""}${perKg ? "No mass given, so the energy bars are per kilogram." : ""}`,
    build(st) {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 120; i++) pts.push([(i / 120) * Lx, y((i / 120) * Lx)]);
      st.path([...pts, [Lx, Math.min(0, v.h1, v.h2) - span * 0.05], [0, Math.min(0, v.h1, v.h2) - span * 0.05]], "wedge", true);
      st.path(pts, "track");
      st.text(-span * 0.05, v.h1, `h₁ = ${fmt(v.h1, "length")}`, "scene-text", "end");
      st.text(Lx + span * 0.05, v.h2 + span * 0.08, `h₂ = ${fmt(v.h2, "length")}`, "scene-text", "start");
      // Springs: a launcher at the start (compressed by x₁) and/or a stopper at the end (x₂).
      const rest = Lx * 0.1;
      const s1 = spring && x1 > 0 ? el("path", { class: "spring" }, st.g) : null;
      const s2 = spring && x2 > 0 ? el("path", { class: "spring" }, st.g) : null;
      if (s1) st.line(-Lx * 0.05, v.h1 - span * 0.05, -Lx * 0.05, v.h1 + span * 0.12, "wall");
      if (s2) st.line(Lx * 1.05, v.h2 - span * 0.05, Lx * 1.05, v.h2 + span * 0.12, "wall");
      const ball = el("circle", { r: 10, class: "ball" }, st.g);
      const va = st.arrow("arrow-v", "v");
      // Energy bars, in screen space at the right.
      const bx = st.X(Lx + span * 0.55);
      const by = st.Y(Math.min(0, v.h1, v.h2));
      const bh = Math.min(240, by - 60);
      const bars = ["K", "U", "Lost"].map((name, i) => {
        const r = el("rect", { x: bx + i * 46, width: 30, class: `ebar ebar-${i}` }, st.g);
        const t = el("text", { x: bx + i * 46 + 15, y: by + 16, class: "scene-text", "text-anchor": "middle" }, st.g);
        t.textContent = name;
        return r;
      });
      el("line", { x1: bx - 6, y1: by - bh, x2: bx + 130, y2: by - bh, class: "dim" }, st.g);
      const ro = st.label(16, 26, "");
      return (t) => {
        const u = uAt(t);
        const x = u * Lx;
        const px = st.X(x);
        const py = st.Y(y(x)) - 10;
        ball.setAttribute("cx", px.toFixed(1));
        ball.setAttribute("cy", py.toFixed(1));
        if (s1) {
          const end = Math.min(st.X(Math.max(x, 0)) - 10, st.X(rest - Lx * 0.05));
          s1.setAttribute("d", springPath(st.X(-Lx * 0.05), py, Math.max(end, st.X(-Lx * 0.05) + 8), py, 8, 8));
        }
        if (s2) {
          const yEnd = st.Y(y(Lx)) - 10;
          const start = Math.max(px + 10, st.X(Lx * 1.05 - rest));
          s2.setAttribute("d", springPath(Math.min(start, st.X(Lx * 1.05) - 8), yEnd, st.X(Lx * 1.05), yEnd, 8, 8));
        }
        const sp = Math.sqrt((2 * Math.max(KE(u), 0)) / m);
        const slope = (y(x + 1e-6 * Lx) - y(x)) / (1e-6 * Lx);
        const n = Math.hypot(1, slope);
        const vmax = Math.sqrt((2 * Emax) / m) || 1;
        va.set(px, py, (sp / vmax) * 70 / n, (-slope * (sp / vmax) * 70) / n);
        const K = Math.max(KE(u), 0);
        const U = m * g * y(x) + (u >= 1 ? 0.5 * k * x2 * x2 : u === 0 ? 0.5 * k * x1 * x1 : 0);
        const lost = Math.max(-Wnc * u, 0);
        [K, U, lost].forEach((e, i) => {
          const h = (Math.max(e, 0) / Emax) * bh;
          bars[i].setAttribute("y", (by - h).toFixed(1));
          bars[i].setAttribute("height", h.toFixed(1));
        });
        ro.textContent = `v = ${fmt(sp, "speed")}   K = ${fmt(K, "energy")}   U = ${fmt(U, "energy")}${perKg ? " (per kg)" : ""}`;
      };
    },
  };
};

// ------------------------------------------------------------------ collisions

const collision: Builder = (v, variant) => {
  const miss = need(v, [["m1", "mass 1"], ["m2", "mass 2"], ["u1", "velocity of 1 before"], ["u2", "velocity of 2 before"], ["v1", "velocity of 1 after"], ["v2", "velocity of 2 after"]]);
  if (miss) return miss;
  if (v.u1 <= v.u2) return "Object 1 never catches object 2 with these velocities (it must be moving faster to the right).";
  const T = 4;
  const tc = 2;
  const vs = Math.max(Math.abs(v.u1), Math.abs(v.u2), Math.abs(v.v1), Math.abs(v.v2), 1e-9);
  const w1 = vs * 0.5 * Math.cbrt(v.m1 / Math.max(v.m1, v.m2));
  const w2 = vs * 0.5 * Math.cbrt(v.m2 / Math.max(v.m1, v.m2));
  const x1 = (t: number) => (t < tc ? v.u1 * (t - tc) : v.v1 * (t - tc)) - w1 / 2;
  const x2 = (t: number) => (t < tc ? v.u2 * (t - tc) : v.v2 * (t - tc)) + w2 / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const t = (i / 100) * T;
    lo = Math.min(lo, x1(t) - w1 / 2, x2(t) - w2 / 2);
    hi = Math.max(hi, x1(t) + w1 / 2, x2(t) + w2 / 2);
  }
  const span = hi - lo;
  const pI = v.m1 * v.u1 + v.m2 * v.u2;
  const pF = v.m1 * v.v1 + v.m2 * v.v2;
  const kI = 0.5 * v.m1 * v.u1 ** 2 + 0.5 * v.m2 * v.u2 ** 2;
  const kF = 0.5 * v.m1 * v.v1 ** 2 + 0.5 * v.m2 * v.v2 ** 2;
  return {
    box: { x0: lo - span * 0.05, y0: -span * 0.2, x1: hi + span * 0.05, y1: span * 0.25 },
    duration: T,
    graphs: [
      graph("Velocity of 1", (t) => (t < tc ? v.u1 : v.v1), "speed"),
      graph("Velocity of 2", (t) => (t < tc ? v.u2 : v.v2), "speed"),
    ],
    caption: `${variant === "inelastic" ? "They stick together. " : ""}The approach is drawn over 2 s; only velocities are physical.`,
    build(st) {
      st.line(lo - span * 0.05, 0, hi + span * 0.05, 0, "ground");
      const b1 = el("rect", { class: "body" }, st.g);
      const b2 = el("rect", { class: "body alt" }, st.g);
      const l1 = el("text", { class: "mass-label", "text-anchor": "middle" }, st.g);
      const l2 = el("text", { class: "mass-label", "text-anchor": "middle" }, st.g);
      l1.textContent = "1";
      l2.textContent = "2";
      const a1 = st.arrow("arrow-v", "v₁");
      const a2 = st.arrow("arrow-v", "v₂");
      const ro = st.label(16, 26, "");
      const ro2 = st.label(16, 48, "", "scene-readout dim");
      const place = (r: SVGRectElement, l: SVGTextElement, x: number, w: number) => {
        r.setAttribute("x", st.X(x - w / 2).toFixed(1));
        r.setAttribute("y", st.Y(w).toFixed(1));
        r.setAttribute("width", st.L(w).toFixed(1));
        r.setAttribute("height", st.L(w).toFixed(1));
        l.setAttribute("x", st.X(x).toFixed(1));
        l.setAttribute("y", (st.Y(w / 2) + 5).toFixed(1));
      };
      return (t) => {
        place(b1, l1, x1(t), w1);
        place(b2, l2, x2(t), w2);
        const before = t < tc;
        const k = 80 / vs;
        a1.set(st.X(x1(t)), st.Y(w1) - 14, (before ? v.u1 : v.v1) * k, 0);
        a2.set(st.X(x2(t)), st.Y(w2) - 14, (before ? v.u2 : v.v2) * k, 0);
        ro.textContent = before
          ? `Before: p = ${fmt(pI, "momentum")}   K = ${fmt(kI, "energy")}`
          : `After: p = ${fmt(pF, "momentum")}   K = ${fmt(kF, "energy")}`;
        ro2.textContent = before ? "" : `Kinetic energy lost: ${fmt(kI - kF, "energy")}`;
      };
    },
  };
};

// ------------------------------------------------------------------ oscillations

const shm: Builder = (v, variant) => {
  const miss = need(v, [["w", "angular frequency"], ["A", "amplitude"]]);
  if (miss) return miss;
  const w = v.w;
  const Tp = (2 * Math.PI) / w;
  const A = v.A;
  const x = (t: number) => A * Math.cos(w * t);
  const vel = (t: number) => -A * w * Math.sin(w * t);
  const graphs = [graph("Position x(t)", x, "length"), graph("Velocity v(t)", vel, "speed")];
  if (variant === "pendulum") {
    const L = v.L;
    if (!Number.isFinite(L)) return "To animate the pendulum, the solver still needs its length.";
    const th0 = A / L;
    return {
      box: { x0: -L * 0.9, y0: -L * 1.15, x1: L * 0.9, y1: L * 0.12 },
      duration: 2 * Tp,
      loop: true,
      graphs,
      caption: th0 < rad(4) ? "Small swing drawn to scale." : undefined,
      build(st) {
        st.line(-L * 0.3, 0, L * 0.3, 0, "ground");
        st.path(Array.from({ length: 41 }, (_, i) => {
          const a = -th0 + (2 * th0 * i) / 40;
          return [L * Math.sin(a), -L * Math.cos(a)] as [number, number];
        }), "trajectory");
        st.line(0, 0, 0, -L, "dim");
        const rope = el("line", { x1: st.X(0), y1: st.Y(0), class: "rope" }, st.g);
        const bob = el("circle", { r: 13, class: "ball" }, st.g);
        const va = st.arrow("arrow-v", "v");
        const ro = st.label(16, 26, "");
        const vmax = A * w || 1;
        return (t) => {
          const a = th0 * Math.cos(w * t);
          const px = st.X(L * Math.sin(a));
          const py = st.Y(-L * Math.cos(a));
          rope.setAttribute("x2", px.toFixed(1));
          rope.setAttribute("y2", py.toFixed(1));
          bob.setAttribute("cx", px.toFixed(1));
          bob.setAttribute("cy", py.toFixed(1));
          const sp = vel(t) / vmax;
          va.set(px, py, Math.cos(a) * sp * 70, Math.sin(a) * sp * 70);
          ro.textContent = `t = ${fmt(t, "time")}   θ = ${fmt((a * 180) / Math.PI, "angle")}   v = ${fmt(vel(t), "speed")}   T = ${fmt(Tp, "time")}`;
        };
      },
    };
  }
  return {
    box: { x0: -A * 3.2, y0: -A * 0.9, x1: A * 1.7, y1: A * 0.9 },
    duration: 2 * Tp,
    loop: true,
    graphs,
    build(st) {
      const wallX = -A * 3;
      st.line(wallX, -A * 0.6, wallX, A * 0.7, "wall");
      st.line(wallX, -A * 0.3, A * 1.7, -A * 0.3, "ground");
      st.line(0, -A * 0.3, 0, A * 0.6, "dim");
      st.text(0, A * 0.7, "x = 0", "scene-text dim");
      const spring = el("path", { class: "spring" }, st.g);
      const box = el("rect", { class: "body" }, st.g);
      const va = st.arrow("arrow-v", "v");
      const ro = st.label(16, 26, "");
      const bw = st.L(A * 0.6);
      const vmax = A * w || 1;
      return (t) => {
        const px = st.X(x(t));
        const cy = st.Y(0);
        spring.setAttribute("d", springPath(st.X(wallX), cy, px - bw / 2, cy, 12, Math.min(14, bw * 0.3)));
        box.setAttribute("x", (px - bw / 2).toFixed(1));
        box.setAttribute("y", (cy - bw / 2).toFixed(1));
        box.setAttribute("width", bw.toFixed(1));
        box.setAttribute("height", bw.toFixed(1));
        va.set(px, cy - bw / 2 - 12, (vel(t) / vmax) * 70, 0);
        ro.textContent = `t = ${fmt(t, "time")}   x = ${fmt(x(t), "length")}   v = ${fmt(vel(t), "speed")}   T = ${fmt(Tp, "time")}`;
      };
    },
  };
};

const BUILDERS: Record<MotionType, Builder> = {
  kinematics_1d: kinematics1d,
  projectile,
  incline,
  pulley,
  circular,
  rotation,
  energy,
  collision,
  shm,
};

export function buildScene(type: MotionType, variant: string, values: Values): Scene | string {
  try {
    return BUILDERS[type](values, variant);
  } catch (e) {
    return `Couldn't draw this problem: ${(e as Error).message}`;
  }
}

export { VW };
