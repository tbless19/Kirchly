// Linear circuit solver: Modified Nodal Analysis in complex arithmetic, with one explicit current
// unknown per component, plus a Levenberg-Marquardt outer loop that finds unknown component values
// from given quantities.
//   - DC: steady state; capacitors are open circuits, inductors are short circuits, phases ignored.
//   - AC: single-frequency phasor analysis; Z_C = 1/(jωC), Z_L = jωL, sources are A∠φ.

import type { Analysis, Ask, Circuit, Component, Given, QuantityKind } from "./types";
import { analysisOf } from "./types";
import { abs, add, conj, cx, mul, polar, scale, solveComplex, sub, ZERO, type Complex } from "./complex";

export class CircuitError extends Error {}

export interface Topology {
  /** point id -> node index */
  nodeOf: Map<string, number>;
  nodeCount: number;
  /** point ids belonging to each node */
  nodePoints: string[][];
  ground: number;
  /** Human-readable node names: "GND", "N1", "N2", ... */
  nodeNames: string[];
}

export interface Solution {
  topology: Topology;
  analysis: Analysis;
  ac: boolean;
  /** Angular frequency in rad/s (0 in DC). */
  omega: number;
  /** Final component values (unknowns filled in). */
  values: Record<string, number>;
  /** Final reactances of impedance parts. */
  reactances: Record<string, number>;
  /** Node voltages (phasors in AC; imaginary part 0 in DC). */
  nodeV: Complex[];
  compV: Record<string, Complex>;
  compI: Record<string, Complex>;
  /** Complex power absorbed, S = P + jQ (P is average power in AC). */
  compS: Record<string, Complex>;
  /** Current through each wire (same order as circuit.wires), positive from wire.a to wire.b. */
  wireI: Complex[];
  solvedUnknowns: { id: string; field: "value" | "reactance"; value: number }[];
  warnings: string[];
}

const KINDS_WITH_VOLTAGE_CTRL = new Set(["vcvs", "vccs"]);
const KINDS_WITH_CURRENT_CTRL = new Set(["ccvs", "cccs"]);

// ---------------------------------------------------------------- topology

export function buildTopology(c: Circuit): Topology {
  const ids = new Set(c.points.map((p) => p.id));
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) {
      const next = parent.get(y)!;
      parent.set(y, r);
      y = next;
    }
    return r;
  };
  for (const w of c.wires) {
    if (!ids.has(w.a) || !ids.has(w.b)) throw new CircuitError(`Wire ${w.a}–${w.b} references an unknown point.`);
    parent.set(find(w.a), find(w.b));
  }

  // Only points that something connects to become part of a node.
  const used = new Set<string>();
  for (const w of c.wires) used.add(w.a).add(w.b);
  for (const comp of c.components) used.add(comp.a).add(comp.b);

  const rootIndex = new Map<string, number>();
  const nodeOf = new Map<string, number>();
  const nodePoints: string[][] = [];
  for (const p of c.points) {
    if (!used.has(p.id)) continue;
    const r = find(p.id);
    if (!rootIndex.has(r)) {
      rootIndex.set(r, nodePoints.length);
      nodePoints.push([]);
    }
    const n = rootIndex.get(r)!;
    nodeOf.set(p.id, n);
    nodePoints[n].push(p.id);
  }

  const nodeCount = nodePoints.length;
  let ground = -1;
  if (c.ground && nodeOf.has(c.ground)) ground = nodeOf.get(c.ground)!;
  if (ground < 0) {
    const vs = c.components.find((k) => k.kind === "voltage_source");
    if (vs && nodeOf.has(vs.b)) ground = nodeOf.get(vs.b)!;
  }
  if (ground < 0) {
    // Fall back to the node with the most component terminals.
    const deg = new Array(nodeCount).fill(0);
    for (const k of c.components) {
      if (nodeOf.has(k.a)) deg[nodeOf.get(k.a)!]++;
      if (nodeOf.has(k.b)) deg[nodeOf.get(k.b)!]++;
    }
    ground = deg.indexOf(Math.max(...deg));
  }

  const nodeNames: string[] = [];
  let k = 1;
  for (let n = 0; n < nodeCount; n++) nodeNames.push(n === ground ? "GND" : `N${k++}`);
  return { nodeOf, nodeCount, nodePoints, ground, nodeNames };
}

// ---------------------------------------------------------------- validation

function validate(c: Circuit, an: Analysis): void {
  if (c.components.length === 0) throw new CircuitError("The circuit has no components.");
  const pointIds = new Set(c.points.map((p) => p.id));
  const compIds = new Set<string>();
  for (const k of c.components) {
    if (compIds.has(k.id)) throw new CircuitError(`Duplicate component id "${k.id}".`);
    compIds.add(k.id);
  }
  for (const k of c.components) {
    for (const t of [k.a, k.b]) {
      if (!pointIds.has(t)) throw new CircuitError(`${k.id} is connected to unknown point "${t}".`);
    }
    if (KINDS_WITH_VOLTAGE_CTRL.has(k.kind)) {
      if (!k.ctrl_a || !k.ctrl_b || !pointIds.has(k.ctrl_a) || !pointIds.has(k.ctrl_b)) {
        throw new CircuitError(`${k.id} (${k.kind}) needs valid ctrl_a / ctrl_b points.`);
      }
    }
    if (KINDS_WITH_CURRENT_CTRL.has(k.kind)) {
      if (!k.ctrl_component || !compIds.has(k.ctrl_component)) {
        throw new CircuitError(`${k.id} (${k.kind}) needs a valid ctrl_component.`);
      }
    }
  }
  if (an.mode === "ac" && !(an.frequency && an.frequency > 0)) {
    const needsF = c.components.filter((k) => k.kind === "capacitor" || k.kind === "inductor");
    if (needsF.length) {
      throw new CircuitError(
        `AC analysis needs a frequency for ${needsF.map((k) => k.id).join(", ")}. Set it under Analysis, ` +
          `or give these parts as impedances (jX) instead.`,
      );
    }
  }
}

// ---------------------------------------------------------------- real linear algebra (used by LM + wires)

/** Solves A x = b in place with partial pivoting. Returns null if singular. */
export function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let scaleMax = 0;
  for (const row of A) for (const v of row) scaleMax = Math.max(scaleMax, Math.abs(v));
  const eps = 1e-12 * (scaleMax || 1);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < eps) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// ---------------------------------------------------------------- MNA

interface Raw {
  nodeV: Complex[];
  compI: Record<string, Complex>;
}

interface Params {
  values: Record<string, number>;
  reactances: Record<string, number>;
}

function solveMNA(c: Circuit, topo: Topology, p: Params, ac: boolean, omega: number): Raw | null {
  const { nodeOf, nodeCount, ground } = topo;
  const vcol: number[] = [];
  let col = 0;
  for (let n = 0; n < nodeCount; n++) vcol.push(n === ground ? -1 : col++);
  const nv = col;
  const icol = new Map<string, number>();
  for (const k of c.components) icol.set(k.id, col++);
  const N = col;

  const A: Complex[][] = Array.from({ length: N }, () => new Array(N).fill(ZERO));
  const b: Complex[] = new Array(N).fill(ZERO);
  const put = (r: number, ci: number, v: Complex) => (A[r][ci] = add(A[r][ci], v));
  const addV = (row: number, point: string, coef: Complex) => {
    const ci = vcol[nodeOf.get(point)!];
    if (ci >= 0) put(row, ci, coef);
  };
  const one = cx(1);
  const neg = cx(-1);

  // KCL rows: current leaving each non-ground node through components sums to zero.
  for (const k of c.components) {
    const na = vcol[nodeOf.get(k.a)!];
    const nb = vcol[nodeOf.get(k.b)!];
    const ic = icol.get(k.id)!;
    if (na >= 0) put(na, ic, one);
    if (nb >= 0) put(nb, ic, neg);
  }

  // Branch rows.
  c.components.forEach((k, i) => {
    const row = nv + i;
    const ic = icol.get(k.id)!;
    const v = p.values[k.id];
    const vdrop = () => {
      addV(row, k.a, one);
      addV(row, k.b, neg);
    };
    switch (k.kind) {
      case "resistor":
        vdrop();
        put(row, ic, cx(-v));
        break;
      case "impedance":
        vdrop();
        put(row, ic, cx(-v, ac ? -p.reactances[k.id] : 0));
        break;
      case "voltage_source":
        vdrop();
        b[row] = ac ? polar(v, k.phase ?? 0) : cx(v);
        break;
      case "inductor":
        vdrop(); // DC: short circuit. AC: V = jωL·I
        if (ac) put(row, ic, cx(0, -omega * v));
        break;
      case "current_source":
        put(row, ic, one);
        b[row] = ac ? polar(v, k.phase ?? 0) : cx(v);
        break;
      case "capacitor":
        put(row, ic, one); // DC: open circuit. AC: I = jωC·V
        if (ac) {
          addV(row, k.a, cx(0, -omega * v));
          addV(row, k.b, cx(0, omega * v));
        }
        break;
      case "vcvs":
        vdrop();
        addV(row, k.ctrl_a!, cx(-v));
        addV(row, k.ctrl_b!, cx(v));
        break;
      case "vccs":
        put(row, ic, one);
        addV(row, k.ctrl_a!, cx(-v));
        addV(row, k.ctrl_b!, cx(v));
        break;
      case "ccvs":
        vdrop();
        put(row, icol.get(k.ctrl_component!)!, cx(-v));
        break;
      case "cccs":
        put(row, ic, one);
        put(row, icol.get(k.ctrl_component!)!, cx(-v));
        break;
    }
  });

  const x = solveComplex(A, b);
  if (!x || x.some((v) => !Number.isFinite(v.re) || !Number.isFinite(v.im))) return null;
  const nodeV = vcol.map((ci) => (ci < 0 ? ZERO : x[ci]));
  const compI: Record<string, Complex> = {};
  for (const k of c.components) compI[k.id] = x[icol.get(k.id)!];
  return { nodeV, compI };
}

// ---------------------------------------------------------------- quantities

function pointV(topo: Topology, nodeV: Complex[], point: string): Complex {
  const n = topo.nodeOf.get(point);
  if (n === undefined) throw new CircuitError(`Point "${point}" is not connected to anything.`);
  return nodeV[n];
}

/** Power factor applied to V·conj(I): ½ for peak phasors, 1 for RMS phasors and for DC. */
function powerScale(an: Analysis): number {
  return an.mode === "ac" && an.amplitude === "peak" ? 0.5 : 1;
}

type Quantity = { quantity: QuantityKind | "component_value"; component: string | null; a: string | null; b: string | null };

/** Phasor (or complex power) value of a quantity. */
function measureComplex(c: Circuit, topo: Topology, raw: Raw, an: Analysis, q: Quantity, p?: Params): Complex {
  const comp = q.component ? c.components.find((k) => k.id === q.component) : undefined;
  const needComp = () => {
    if (!comp) throw new CircuitError(`Unknown component "${q.component}".`);
    return comp;
  };
  const compVoltage = (k: Component) => sub(pointV(topo, raw.nodeV, k.a), pointV(topo, raw.nodeV, k.b));
  switch (q.quantity) {
    case "component_current":
      return raw.compI[needComp().id];
    case "component_voltage":
      return compVoltage(needComp());
    case "component_power": {
      const k = needComp();
      return scale(mul(compVoltage(k), conj(raw.compI[k.id])), powerScale(an));
    }
    case "voltage_between":
      if (!q.a || !q.b) throw new CircuitError("voltage_between needs points a and b.");
      return sub(pointV(topo, raw.nodeV, q.a), pointV(topo, raw.nodeV, q.b));
    case "component_value": {
      const k = needComp();
      if (k.kind === "impedance") return cx(p!.values[k.id], p!.reactances[k.id]);
      return cx(p!.values[k.id]);
    }
  }
}

/** The real number a given quantity is compared against: signed in DC, magnitude (or average power) in AC. */
function scalarOf(q: Quantity, z: Complex, an: Analysis): number {
  if (q.quantity === "component_power") return z.re;
  return an.mode === "ac" ? abs(z) : z.re;
}

// ---------------------------------------------------------------- unknown component values

interface Unknown {
  k: Component;
  field: "value" | "reactance";
}

function guessFor(u: Unknown, s: number): number {
  if (u.field === "reactance") return 10 * s;
  switch (u.k.kind) {
    case "resistor":
    case "impedance":
      return 1000 * s;
    case "capacitor":
      return 1e-6 * s;
    case "inductor":
      return 1e-3 * s;
    default:
      return s;
  }
}

function solveUnknowns(
  c: Circuit,
  topo: Topology,
  an: Analysis,
  ac: boolean,
  omega: number,
  base: Params,
  unknown: Unknown[],
  givens: Given[],
): { params: Params; raw: Raw } {
  const withP = (p: number[]): Params => {
    const values = { ...base.values };
    const reactances = { ...base.reactances };
    unknown.forEach((u, i) => (u.field === "value" ? (values[u.k.id] = p[i]) : (reactances[u.k.id] = p[i])));
    return { values, reactances };
  };
  const residual = (p: number[]): number[] | null => {
    const raw = solveMNA(c, topo, withP(p), ac, omega);
    if (!raw) return null;
    return givens.map((g) => (scalarOf(g, measureComplex(c, topo, raw, an, g), an) - g.value) / Math.max(Math.abs(g.value), 1e-9));
  };
  const norm = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  const starts = [1, 0.1, 10, 0.01, 100, -1];

  for (const s of starts) {
    let p = unknown.map((u) => guessFor(u, s));
    let r = residual(p);
    if (!r) continue;
    let lambda = 1e-3;
    for (let iter = 0; iter < 300 && r; iter++) {
      if (Math.max(...r.map(Math.abs)) < 1e-10) break;
      // Finite-difference Jacobian.
      const J: number[][] = givens.map(() => new Array(p.length).fill(0));
      let ok = true;
      for (let j = 0; j < p.length; j++) {
        const h = 1e-7 * Math.max(Math.abs(p[j]), Math.abs(guessFor(unknown[j], 1)) * 1e-3);
        const q = [...p];
        q[j] += h;
        const rq = residual(q);
        if (!rq) {
          ok = false;
          break;
        }
        for (let i = 0; i < r.length; i++) J[i][j] = (rq[i] - r[i]) / h;
      }
      if (!ok) break;
      // (JᵀJ + λ·diag(JᵀJ)) δ = −Jᵀr
      const n = p.length;
      const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b2) => J.reduce((acc, row) => acc + row[a] * row[b2], 0)));
      const Jtr = Array.from({ length: n }, (_, a) => J.reduce((acc, row, i) => acc + row[a] * r![i], 0));
      let improved = false;
      for (let tries = 0; tries < 30; tries++) {
        const M = JtJ.map((row, a) => row.map((v, b2) => (a === b2 ? v * (1 + lambda) + 1e-30 : v)));
        const delta = gaussSolve(M, Jtr.map((v) => -v));
        if (delta) {
          const pn = p.map((v, i) => v + delta[i]);
          const rn = residual(pn);
          if (rn && norm(rn) < norm(r!)) {
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
    if (r && Math.max(...r.map(Math.abs)) < 1e-6) {
      const params = withP(p);
      return { params, raw: solveMNA(c, topo, params, ac, omega)! };
    }
  }
  throw new CircuitError(
    `Could not find values for ${unknown.map((u) => u.k.id).join(", ")} that satisfy the given quantities. ` +
      `Check the givens and component orientation.`,
  );
}

// ---------------------------------------------------------------- wire currents

/**
 * Distributes each node's component currents over its wire segments so the animation can show
 * current flowing along wires. Within a node every wire is ideal, so we treat each wire segment as
 * a unit conductance and solve a small Laplacian (separately for real and imaginary parts);
 * on tree-shaped wiring this gives the exact KCL flow.
 */
function wireCurrents(c: Circuit, topo: Topology, compI: Record<string, Complex>): Complex[] {
  const out: Complex[] = new Array(c.wires.length).fill(ZERO);
  // s[p] = net current point p pushes into components.
  const s = new Map<string, Complex>();
  for (const k of c.components) {
    s.set(k.a, add(s.get(k.a) ?? ZERO, compI[k.id]));
    s.set(k.b, sub(s.get(k.b) ?? ZERO, compI[k.id]));
  }
  for (const pts of topo.nodePoints) {
    if (pts.length < 2) continue;
    const idx = new Map(pts.map((p, i) => [p, i]));
    const n = pts.length;
    const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const wires: number[] = [];
    c.wires.forEach((w, wi) => {
      const i = idx.get(w.a);
      const j = idx.get(w.b);
      if (i === undefined || j === undefined || i === j) return;
      wires.push(wi);
      L[i][i] += 1;
      L[j][j] += 1;
      L[i][j] -= 1;
      L[j][i] -= 1;
    });
    if (wires.length === 0) continue;
    // L·φ = −s, with φ[0] = 0.
    const A = L.slice(1).map((row) => row.slice(1));
    const phiRe = gaussSolve(A, pts.slice(1).map((p) => -(s.get(p)?.re ?? 0)));
    const phiIm = gaussSolve(A, pts.slice(1).map((p) => -(s.get(p)?.im ?? 0)));
    if (!phiRe || !phiIm) continue;
    const re = [0, ...phiRe];
    const im = [0, ...phiIm];
    for (const wi of wires) {
      const w = c.wires[wi];
      const i = idx.get(w.a)!;
      const j = idx.get(w.b)!;
      out[wi] = cx(re[i] - re[j], im[i] - im[j]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- entry point

export function analyze(c: Circuit): Solution {
  const an = analysisOf(c);
  validate(c, an);
  const topo = buildTopology(c);
  const ac = an.mode === "ac";
  const omega = ac && an.frequency ? 2 * Math.PI * an.frequency : 0;
  const warnings: string[] = [];
  if (topo.nodeCount < 2) throw new CircuitError("The circuit needs at least two nodes.");

  const unknown: Unknown[] = [];
  const base: Params = { values: {}, reactances: {} };
  for (const k of c.components) {
    if (k.value === null) unknown.push({ k, field: "value" });
    else base.values[k.id] = k.value;
    if (k.kind === "impedance") {
      if (k.reactance === null) {
        if (ac) unknown.push({ k, field: "reactance" });
        else base.reactances[k.id] = 0;
      } else base.reactances[k.id] = k.reactance ?? 0;
    }
  }

  let params: Params;
  let raw: Raw;
  if (unknown.length === 0) {
    params = base;
    const r = solveMNA(c, topo, params, ac, omega);
    if (!r) throw singularError(c);
    raw = r;
  } else {
    const label = (u: Unknown) => (u.field === "reactance" ? `X(${u.k.id})` : u.k.id);
    if (c.givens.length < unknown.length) {
      throw new CircuitError(
        `${unknown.length} unknown value(s) (${unknown.map(label).join(", ")}) but only ` +
          `${c.givens.length} given quantity/quantities. Add a given (e.g. a measured current) for each unknown.`,
      );
    }
    ({ params, raw } = solveUnknowns(c, topo, an, ac, omega, base, unknown, c.givens));
  }

  for (const k of c.components) {
    if (["resistor", "capacitor", "inductor"].includes(k.kind) && params.values[k.id] < 0) {
      warnings.push(`${k.id} came out negative (${params.values[k.id]}).`);
    }
  }
  if (!ac && c.components.some((k) => k.kind === "capacitor" || k.kind === "inductor")) {
    warnings.push("DC steady state: capacitors are treated as open circuits and inductors as short circuits.");
  }
  if (!ac && c.components.some((k) => k.kind === "impedance" && k.reactance)) {
    warnings.push("DC analysis uses only the resistance of impedances; switch to AC to include their reactance.");
  }
  if (ac && an.mode === "ac" && !an.frequency) {
    warnings.push("No frequency given; the impedances are taken as stated.");
  }

  const ps = powerScale(an);
  const compV: Record<string, Complex> = {};
  const compS: Record<string, Complex> = {};
  for (const k of c.components) {
    compV[k.id] = sub(pointV(topo, raw.nodeV, k.a), pointV(topo, raw.nodeV, k.b));
    compS[k.id] = scale(mul(compV[k.id], conj(raw.compI[k.id])), ps);
  }
  // Round-off leaves ideal L/C with ~1e-13 of the real power (and R with ~1e-13 reactive); call that zero.
  const smax = Math.max(1e-300, ...Object.values(compS).map(abs));
  for (const id of Object.keys(compS)) {
    const s = compS[id];
    compS[id] = cx(Math.abs(s.re) < 1e-9 * smax ? 0 : s.re, Math.abs(s.im) < 1e-9 * smax ? 0 : s.im);
  }

  return {
    topology: topo,
    analysis: an,
    ac,
    omega,
    values: params.values,
    reactances: params.reactances,
    nodeV: raw.nodeV,
    compV,
    compI: raw.compI,
    compS,
    wireI: wireCurrents(c, topo, raw.compI),
    solvedUnknowns: unknown.map((u) => ({
      id: u.k.id,
      field: u.field,
      value: u.field === "value" ? params.values[u.k.id] : params.reactances[u.k.id],
    })),
    warnings,
  };
}

function singularError(c: Circuit): CircuitError {
  const hasLoopOfVSources = c.components.filter((k) => k.kind === "voltage_source" || k.kind === "inductor").length > 1;
  return new CircuitError(
    "The circuit equations have no unique solution. Common causes: a floating section with no path to ground, " +
      "a current source in series with an open circuit (capacitor)" +
      (hasLoopOfVSources ? ", or a loop made only of voltage sources / inductors." : "."),
  );
}

const rawOf = (sol: Solution): Raw => ({ nodeV: sol.nodeV, compI: sol.compI });

/** Phasor value (complex power for power quantities) of an asked-for quantity. */
export function evaluateAskComplex(c: Circuit, sol: Solution, ask: Ask): Complex {
  return measureComplex(c, sol.topology, rawOf(sol), sol.analysis, ask, { values: sol.values, reactances: sol.reactances });
}

/** Real value comparable with a Given: signed in DC; magnitude / average power in AC. */
export function evaluateGiven(c: Circuit, sol: Solution, g: Given): number {
  return scalarOf(g, measureComplex(c, sol.topology, rawOf(sol), sol.analysis, g), sol.analysis);
}

/** Impedance of a passive part at the solution's frequency (null for sources). */
export function impedanceOf(k: Component, sol: Solution): Complex | null {
  const v = sol.values[k.id];
  switch (k.kind) {
    case "resistor":
      return cx(v);
    case "impedance":
      return cx(v, sol.ac ? sol.reactances[k.id] : 0);
    case "inductor":
      return sol.ac ? cx(0, sol.omega * v) : cx(0);
    case "capacitor":
      return sol.ac ? cx(0, -1 / (sol.omega * v)) : null; // DC: open
    default:
      return null;
  }
}
