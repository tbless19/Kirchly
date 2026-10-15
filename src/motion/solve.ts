// Generic equation solver for the motion models, working the way a student would:
// repeatedly pick an equation with exactly one unknown and solve it; when stuck, solve the
// smallest group of equations that has as many unknowns as equations (2–4) simultaneously.
// Every step is recorded so the walkthrough can show it.

import type { Eq, ModelSpec, MotionType, Values, VarDef } from "./models";
import { modelOf } from "./models";
import { formatQuantity } from "./units";

export interface Problem {
  title: string;
  type: MotionType;
  variant: string;
  /** Given values (stored units). null = explicitly unknown. Missing = unknown, or its default if it has one. */
  values: Record<string, number | null>;
  asks: { label: string; key: string }[];
  notes: string;
  /** Units the problem is written in; the display switches to match when it loads. */
  units?: "metric" | "imperial";
}

export type SolveStep =
  | { kind: "assume"; key: string; value: number }
  | { kind: "single"; eq: Eq; key: string; value: number; others: number[] }
  | { kind: "system"; eqs: Eq[]; keys: string[]; values: number[] };

export interface MotionSolution {
  spec: ModelSpec;
  defs: Map<string, VarDef>;
  values: Values;
  given: Set<string>;
  steps: SolveStep[];
  /** Unknowns the givens don't determine. */
  unsolved: string[];
  warnings: string[];
}

export class MotionError extends Error {}


// ------------------------------------------------------------------ one equation, one unknown

function grid(def: VarDef): number[] {
  const lo = def.min ?? -Infinity;
  const hi = def.max ?? Infinity;
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    const n = 4000;
    return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  }
  const mags: number[] = [];
  for (let e = -7; e <= 9; e += 0.01) mags.push(10 ** e);
  const pts: number[] = [];
  if (lo < 0) for (let i = mags.length - 1; i >= 0; i--) if (-mags[i] >= lo) pts.push(-mags[i]);
  if (lo <= 0 && hi >= 0) pts.push(0);
  if (Number.isFinite(lo) && lo > 0) pts.push(lo);
  for (const m of mags) if (m >= lo && m <= hi) pts.push(m);
  return pts.sort((a, b) => a - b);
}

/**
 * Typical size of an equation's sides, with the unknowns at their typical scale. Residuals are
 * measured against this, so an equation whose sides are both ~0 at the answer (e.g. landing at
 * height 0) still has a meaningful tolerance.
 */
function eqScale(eq: Eq, vals: Values, defs: Map<string, VarDef>): number {
  const v = { ...vals };
  for (const k of eq.vars) if (!(k in v)) v[k] = defs.get(k)!.scale;
  const [l, r] = eq.f(v);
  let s = Math.abs(l) + Math.abs(r);
  // Add each term's size, |x·∂(l−r)/∂x|, so sides that cancel to ~0 still have a meaningful scale.
  for (const k of eq.vars) {
    const x = v[k];
    if (!x) continue;
    const [l2, r2] = eq.f({ ...v, [k]: x * (1 + 1e-6) });
    const term = Math.abs(l2 - r2 - (l - r)) / 1e-6;
    if (Number.isFinite(term)) s += term;
  }
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** All roots of `eq` in variable `key` within the variable's domain. */
export function roots1D(eq: Eq, key: string, vals: Values, defs: Map<string, VarDef>): number[] {
  const def = defs.get(key)!;
  const scale = eqScale(eq, vals, defs);
  const at = (x: number) => {
    const [l, r] = eq.f({ ...vals, [key]: x });
    return { g: l - r, rel: Math.abs(l - r) / Math.max(Math.abs(l) + Math.abs(r), scale) };
  };
  const xs = grid(def);
  const ev = xs.map(at);
  const found: number[] = [];
  const accept = (x: number) => {
    const e = at(x);
    if (Number.isFinite(e.g) && e.rel < 1e-8) found.push(x);
  };
  for (let i = 0; i < xs.length; i++) {
    const a = ev[i];
    if (!Number.isFinite(a.g)) continue;
    if (a.g === 0) {
      found.push(xs[i]);
      continue;
    }
    // Sign change -> bisection (poles are rejected by the residual check in accept()).
    if (i + 1 < xs.length && Number.isFinite(ev[i + 1].g) && ev[i + 1].g !== 0 && Math.sign(a.g) !== Math.sign(ev[i + 1].g)) {
      let lo = xs[i];
      let hi = xs[i + 1];
      let glo = a.g;
      for (let k = 0; k < 200; k++) {
        const mid = (lo + hi) / 2;
        const gm = at(mid).g;
        if (Math.sign(gm) === Math.sign(glo)) (lo = mid), (glo = gm);
        else hi = mid;
      }
      accept((lo + hi) / 2);
    }
    // Touching roots (e.g. v² = 0): local minimum of the residual -> golden-section search.
    if (i > 0 && i + 1 < xs.length && a.rel < 1e-2 && a.rel <= ev[i - 1].rel && a.rel <= ev[i + 1].rel) {
      let lo = xs[i - 1];
      let hi = xs[i + 1];
      const phi = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 200; k++) {
        const x1 = hi - phi * (hi - lo);
        const x2 = lo + phi * (hi - lo);
        if (Math.abs(at(x1).g) < Math.abs(at(x2).g)) hi = x2;
        else lo = x1;
      }
      accept((lo + hi) / 2);
    }
  }
  found.sort((p, q) => p - q);
  const out: number[] = [];
  for (const x of found) {
    if (!out.length || Math.abs(x - out[out.length - 1]) > 1e-7 * Math.max(1, Math.abs(x))) out.push(x);
  }
  return out;
}

/** A root of exactly 0 is usually the trivial "at the start" answer; drop it when there are others. */
function meaningful(roots: number[]): number[] {
  const nonzero = roots.filter((r) => Math.abs(r) > 1e-9);
  return nonzero.length && nonzero.length < roots.length ? nonzero : roots;
}

function pick(roots: number[], def: VarDef): number {
  if (def.prefer === "largest") return roots[roots.length - 1];
  if (def.prefer === "smallest") return roots[0];
  const nonNeg = roots.filter((r) => r >= -1e-12);
  return nonNeg.length ? nonNeg[0] : roots[roots.length - 1];
}

// ------------------------------------------------------------------ small simultaneous systems

function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function solveSystem(eqs: Eq[], keys: string[], vals: Values, defs: Map<string, VarDef>): number[] | null {
  const ds = keys.map((k) => defs.get(k)!);
  const clamp = (x: number, d: VarDef) => Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, x));
  const scales = eqs.map((e) => eqScale(e, vals, defs));
  const residual = (p: number[]) => {
    const v = { ...vals };
    keys.forEach((k, i) => (v[k] = p[i]));
    return eqs.map((e, i) => {
      const [l, r] = e.f(v);
      return (l - r) / Math.max(Math.abs(l) + Math.abs(r), scales[i]);
    });
  };
  /** Rejects solutions of dependent equations (e.g. the four kinematics equations with only two independent). */
  const fullRank = (p: number[]) => {
    const r = residual(p);
    const J = r.map(() => new Array(p.length).fill(0));
    for (let j = 0; j < p.length; j++) {
      const h = 1e-6 * Math.max(Math.abs(p[j]), ds[j].scale * 1e-3);
      const q = [...p];
      q[j] += h;
      const rq = residual(q);
      for (let i = 0; i < r.length; i++) J[i][j] = ((rq[i] - r[i]) / h) * Math.max(Math.abs(p[j]), ds[j].scale * 1e-3);
    }
    // Gaussian elimination with full pivot tracking: compare the smallest pivot to the largest.
    const M = J.map((row) => [...row]);
    const n = M.length;
    let maxPivot = 0;
    let minPivot = Infinity;
    for (let c = 0; c < n; c++) {
      let pr = c;
      for (let rr = c + 1; rr < n; rr++) if (Math.abs(M[rr][c]) > Math.abs(M[pr][c])) pr = rr;
      [M[c], M[pr]] = [M[pr], M[c]];
      const pv = Math.abs(M[c][c]);
      maxPivot = Math.max(maxPivot, pv);
      minPivot = Math.min(minPivot, pv);
      if (pv === 0) return false;
      for (let rr = c + 1; rr < n; rr++) {
        const f = M[rr][c] / M[c][c];
        for (let k = c; k < n; k++) M[rr][k] -= f * M[c][k];
      }
    }
    return minPivot > 1e-6 * maxPivot;
  };
  const norm = (r: number[]) => r.reduce((s, x) => s + x * x, 0);
  const mults = [1, 0.3, 3, 0.1, 10, 0.03, 30, 0.01, 100];
  const starts: number[][] = [];
  for (const s of mults) {
    starts.push(ds.map((d) => clamp(d.scale * s, d)));
    starts.push(ds.map((d, i) => clamp((i % 2 ? -1 : 1) * d.scale * s, d)));
  }
  for (const start of starts) {
    let p = start;
    let r = residual(p);
    if (r.some((x) => !Number.isFinite(x))) continue;
    let lambda = 1e-3;
    for (let it = 0; it < 300; it++) {
      if (Math.max(...r.map(Math.abs)) < 1e-12) break;
      const J = r.map(() => new Array(p.length).fill(0));
      for (let j = 0; j < p.length; j++) {
        const h = 1e-7 * Math.max(Math.abs(p[j]), ds[j].scale * 1e-3);
        const q = [...p];
        q[j] += h;
        const rq = residual(q);
        for (let i = 0; i < r.length; i++) J[i][j] = (rq[i] - r[i]) / h;
      }
      const n = p.length;
      const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
      const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
      let improved = false;
      for (let tries = 0; tries < 25; tries++) {
        const M = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-30 : v)));
        const d = gauss(M, Jtr.map((v) => -v));
        if (d) {
          const pn = p.map((v, i) => clamp(v + d[i], ds[i]));
          const rn = residual(pn);
          if (rn.every(Number.isFinite) && norm(rn) < norm(r)) {
            p = pn;
            r = rn;
            lambda = Math.max(lambda / 10, 1e-12);
            improved = true;
            break;
          }
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    if (Math.max(...r.map(Math.abs)) < 1e-9) return fullRank(p) ? p : null;
  }
  return null;
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}

// ------------------------------------------------------------------ entry point

export function solveProblem(p: Problem): MotionSolution {
  const model = modelOf(p.type);
  if (!model) throw new MotionError(`Unknown problem type "${p.type}".`);
  const variant = model.variants.some((v) => v.id === p.variant) ? p.variant : model.variants[0].id;
  const spec = model.build(variant);
  const defs = new Map(spec.vars.map((d) => [d.key, d]));
  const values: Values = {};
  const given = new Set<string>();
  const steps: SolveStep[] = [];
  const warnings: string[] = [];

  for (const d of spec.vars) {
    const v = p.values[d.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      values[d.key] = v;
      given.add(d.key);
      if ((d.min !== undefined && v < d.min - 1e-12) || (d.max !== undefined && v > d.max + 1e-12)) {
        warnings.push(`${d.label} = ${formatQuantity(v, d.dim)} is outside the physical range for this quantity.`);
      }
    } else if (v === undefined && d.default !== undefined) {
      values[d.key] = d.default;
      steps.push({ kind: "assume", key: d.key, value: d.default });
    }
  }

  const known = (k: string) => k in values;
  let progress = true;
  while (progress) {
    progress = false;
    // Among equations with one unknown, take one with a unique answer first; ambiguous ones
    // (v² = …, sin θ = …) wait in case another equation settles the value without a choice.
    let best: { eq: Eq; key: string; roots: number[] } | null = null;
    for (const eq of spec.eqs) {
      const unknown = eq.vars.filter((k) => !known(k));
      if (unknown.length !== 1) continue;
      const key = unknown[0];
      const roots = meaningful(roots1D(eq, key, values, defs));
      if (!roots.length) continue;
      if (!best || (roots.length === 1 && best.roots.length > 1)) best = { eq, key, roots };
      if (roots.length === 1) break;
    }
    if (best) {
      const value = pick(best.roots, defs.get(best.key)!);
      values[best.key] = value;
      steps.push({ kind: "single", eq: best.eq, key: best.key, value, others: best.roots.filter((r) => r !== value) });
      progress = true;
      continue;
    }
    // Stuck: look for k equations sharing exactly k unknowns.
    const open = spec.eqs.filter((e) => e.vars.some((k) => !known(k)));
    for (let k = 2; k <= 4 && !progress; k++) {
      const candidates = open.filter((e) => e.vars.filter((x) => !known(x)).length <= k);
      for (const group of combinations(candidates, k)) {
        const keys = [...new Set(group.flatMap((e) => e.vars.filter((x) => !known(x))))];
        if (keys.length !== k) continue;
        const sol = solveSystem(group, keys, values, defs);
        if (!sol) continue;
        keys.forEach((key, i) => (values[key] = sol[i]));
        steps.push({ kind: "system", eqs: group, keys, values: sol });
        progress = true;
        break;
      }
    }
  }

  // Equations that were never needed double-check the givens.
  for (const eq of spec.eqs) {
    if (!eq.vars.every(known)) continue;
    const [l, r] = eq.f(values);
    if (Math.abs(l - r) / Math.max(Math.abs(l) + Math.abs(r), eqScale(eq, values, defs)) > 1e-3) {
      const which = eq.vars.filter((k) => given.has(k)).map((k) => defs.get(k)!.label.toLowerCase());
      warnings.push(
        `The given values don't all agree${eq.name ? ` (${eq.name.toLowerCase()})` : ""}. ` +
          `Check: ${which.length ? which.join(", ") : "the givens"}.`,
      );
    }
  }

  const unsolved = spec.vars.map((d) => d.key).filter((k) => !known(k));
  return { spec, defs, values, given, steps, unsolved, warnings };
}
