// DC circuit solver: Modified Nodal Analysis with one explicit current unknown per component,
// plus a Levenberg-Marquardt outer loop that finds unknown component values from given quantities.
// Steady-state DC: capacitors are open circuits, inductors are short circuits.

import type { Ask, Circuit, Component, Given, QuantityKind } from "./types";

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
  /** Final component values (unknowns filled in). */
  values: Record<string, number>;
  nodeVoltage: number[];
  compV: Record<string, number>;
  compI: Record<string, number>;
  compP: Record<string, number>;
  /** Current through each wire (same order as circuit.wires), positive from wire.a to wire.b. */
  wireI: number[];
  solvedUnknowns: { id: string; value: number }[];
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

function validate(c: Circuit): void {
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
}

// ---------------------------------------------------------------- linear algebra

/** Solves A x = b in place with partial pivoting. Returns null if singular. */
export function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  const eps = 1e-12 * (scale || 1);
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
  nodeVoltage: number[];
  compI: Record<string, number>;
}

function solveMNA(c: Circuit, topo: Topology, values: Record<string, number>): Raw | null {
  const { nodeOf, nodeCount, ground } = topo;
  const vcol: number[] = [];
  let col = 0;
  for (let n = 0; n < nodeCount; n++) vcol.push(n === ground ? -1 : col++);
  const nv = col;
  const icol = new Map<string, number>();
  for (const k of c.components) icol.set(k.id, col++);
  const N = col;

  const A: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  const b = new Array(N).fill(0);
  const addV = (row: number, point: string, coef: number) => {
    const ci = vcol[nodeOf.get(point)!];
    if (ci >= 0) A[row][ci] += coef;
  };

  // KCL rows: current leaving each non-ground node through components sums to zero.
  for (const k of c.components) {
    const na = vcol[nodeOf.get(k.a)!];
    const nb = vcol[nodeOf.get(k.b)!];
    const ic = icol.get(k.id)!;
    if (na >= 0) A[na][ic] += 1;
    if (nb >= 0) A[nb][ic] -= 1;
  }

  // Branch rows.
  c.components.forEach((k, i) => {
    const row = nv + i;
    const ic = icol.get(k.id)!;
    const v = values[k.id];
    switch (k.kind) {
      case "resistor":
        addV(row, k.a, 1);
        addV(row, k.b, -1);
        A[row][ic] -= v;
        break;
      case "voltage_source":
        addV(row, k.a, 1);
        addV(row, k.b, -1);
        b[row] = v;
        break;
      case "inductor": // DC: short circuit
        addV(row, k.a, 1);
        addV(row, k.b, -1);
        break;
      case "current_source":
        A[row][ic] = 1;
        b[row] = v;
        break;
      case "capacitor": // DC: open circuit
        A[row][ic] = 1;
        break;
      case "vcvs":
        addV(row, k.a, 1);
        addV(row, k.b, -1);
        addV(row, k.ctrl_a!, -v);
        addV(row, k.ctrl_b!, v);
        break;
      case "vccs":
        A[row][ic] = 1;
        addV(row, k.ctrl_a!, -v);
        addV(row, k.ctrl_b!, v);
        break;
      case "ccvs":
        addV(row, k.a, 1);
        addV(row, k.b, -1);
        A[row][icol.get(k.ctrl_component!)!] -= v;
        break;
      case "cccs":
        A[row][ic] = 1;
        A[row][icol.get(k.ctrl_component!)!] -= v;
        break;
    }
  });

  const x = gaussSolve(A, b);
  if (!x || x.some((v) => !Number.isFinite(v))) return null;
  const nodeVoltage = vcol.map((ci) => (ci < 0 ? 0 : x[ci]));
  const compI: Record<string, number> = {};
  for (const k of c.components) compI[k.id] = x[icol.get(k.id)!];
  return { nodeVoltage, compI };
}

// ---------------------------------------------------------------- quantities

function pointV(topo: Topology, nodeVoltage: number[], point: string): number {
  const n = topo.nodeOf.get(point);
  if (n === undefined) throw new CircuitError(`Point "${point}" is not connected to anything.`);
  return nodeVoltage[n];
}

export function measure(
  c: Circuit,
  topo: Topology,
  raw: Raw,
  q: { quantity: QuantityKind | "component_value"; component: string | null; a: string | null; b: string | null },
  values?: Record<string, number>,
): number {
  const comp = q.component ? c.components.find((k) => k.id === q.component) : undefined;
  const needComp = () => {
    if (!comp) throw new CircuitError(`Unknown component "${q.component}".`);
    return comp;
  };
  const compVoltage = (k: Component) => pointV(topo, raw.nodeVoltage, k.a) - pointV(topo, raw.nodeVoltage, k.b);
  switch (q.quantity) {
    case "component_current":
      return raw.compI[needComp().id];
    case "component_voltage":
      return compVoltage(needComp());
    case "component_power": {
      const k = needComp();
      return compVoltage(k) * raw.compI[k.id];
    }
    case "voltage_between":
      if (!q.a || !q.b) throw new CircuitError("voltage_between needs points a and b.");
      return pointV(topo, raw.nodeVoltage, q.a) - pointV(topo, raw.nodeVoltage, q.b);
    case "component_value":
      return values![needComp().id];
  }
}

// ---------------------------------------------------------------- unknown component values

function solveUnknowns(
  c: Circuit,
  topo: Topology,
  unknown: Component[],
  givens: Given[],
): { values: Record<string, number>; raw: Raw } {
  const base: Record<string, number> = {};
  for (const k of c.components) if (k.value !== null) base[k.id] = k.value;

  const residual = (p: number[]): number[] | null => {
    const vals = { ...base };
    unknown.forEach((k, i) => (vals[k.id] = p[i]));
    const raw = solveMNA(c, topo, vals);
    if (!raw) return null;
    return givens.map((g) => (measure(c, topo, raw, g) - g.value) / Math.max(Math.abs(g.value), 1e-9));
  };
  const norm = (r: number[]) => r.reduce((s, v) => s + v * v, 0);

  const guessFor = (k: Component, scale: number) => (k.kind === "resistor" ? 1000 : 1) * scale;
  const starts = [1, 0.1, 10, 0.01, 100, -1];

  for (const s of starts) {
    let p = unknown.map((k) => guessFor(k, s));
    let r = residual(p);
    if (!r) continue;
    let lambda = 1e-3;
    for (let iter = 0; iter < 300 && r; iter++) {
      if (Math.max(...r.map(Math.abs)) < 1e-10) break;
      // Finite-difference Jacobian.
      const J: number[][] = givens.map(() => new Array(p.length).fill(0));
      let ok = true;
      for (let j = 0; j < p.length; j++) {
        const h = 1e-7 * Math.max(Math.abs(p[j]), 1e-3);
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
      const JtJ = Array.from({ length: n }, (_, a) =>
        Array.from({ length: n }, (_, b2) => J.reduce((s, row) => s + row[a] * row[b2], 0)),
      );
      const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r![i], 0));
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
      const values = { ...base };
      unknown.forEach((k, i) => (values[k.id] = p[i]));
      return { values, raw: solveMNA(c, topo, values)! };
    }
  }
  throw new CircuitError(
    `Could not find values for ${unknown.map((k) => k.id).join(", ")} that satisfy the given quantities. ` +
      `Check the givens and component orientation.`,
  );
}

// ---------------------------------------------------------------- wire currents

/**
 * Distributes each node's component currents over its wire segments so the animation can show
 * current flowing along wires. Within a node every wire is ideal, so we treat each wire segment as
 * a unit conductance and solve a small Laplacian; on tree-shaped wiring this gives the exact KCL flow.
 */
function wireCurrents(c: Circuit, topo: Topology, compI: Record<string, number>): number[] {
  const out = new Array(c.wires.length).fill(0);
  // s[p] = net current point p pushes into components.
  const s = new Map<string, number>();
  for (const k of c.components) {
    s.set(k.a, (s.get(k.a) ?? 0) + compI[k.id]);
    s.set(k.b, (s.get(k.b) ?? 0) - compI[k.id]);
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
    const rhs = pts.slice(1).map((p) => -(s.get(p) ?? 0));
    const phiRest = gaussSolve(A, rhs);
    if (!phiRest) continue;
    const phi = [0, ...phiRest];
    for (const wi of wires) {
      const w = c.wires[wi];
      out[wi] = phi[idx.get(w.a)!] - phi[idx.get(w.b)!];
    }
  }
  return out;
}

// ---------------------------------------------------------------- entry point

export function analyze(c: Circuit): Solution {
  validate(c);
  const topo = buildTopology(c);
  const warnings: string[] = [];
  if (topo.nodeCount < 2) throw new CircuitError("The circuit needs at least two nodes.");

  const unknown = c.components.filter((k) => k.value === null);
  let values: Record<string, number>;
  let raw: Raw;
  if (unknown.length === 0) {
    values = Object.fromEntries(c.components.map((k) => [k.id, k.value as number]));
    if (c.givens.length > 0) {
      warnings.push("Given quantities were not needed (no unknown component values); they are checked below instead.");
    }
    const r = solveMNA(c, topo, values);
    if (!r) throw singularError(c);
    raw = r;
  } else {
    if (c.givens.length < unknown.length) {
      throw new CircuitError(
        `${unknown.length} unknown component value(s) (${unknown.map((k) => k.id).join(", ")}) but only ` +
          `${c.givens.length} given quantity/quantities. Add a given (e.g. a measured current) for each unknown.`,
      );
    }
    ({ values, raw } = solveUnknowns(c, topo, unknown, c.givens));
  }

  for (const k of c.components) {
    if (k.kind === "resistor" && values[k.id] < 0) warnings.push(`${k.id} came out negative (${values[k.id]}).`);
  }
  if (c.components.some((k) => k.kind === "capacitor" || k.kind === "inductor")) {
    warnings.push("DC steady state: capacitors are treated as open circuits and inductors as short circuits.");
  }

  const compV: Record<string, number> = {};
  const compP: Record<string, number> = {};
  for (const k of c.components) {
    compV[k.id] = pointV(topo, raw.nodeVoltage, k.a) - pointV(topo, raw.nodeVoltage, k.b);
    compP[k.id] = compV[k.id] * raw.compI[k.id];
  }

  return {
    topology: topo,
    values,
    nodeVoltage: raw.nodeVoltage,
    compV,
    compI: raw.compI,
    compP,
    wireI: wireCurrents(c, topo, raw.compI),
    solvedUnknowns: unknown.map((k) => ({ id: k.id, value: values[k.id] })),
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

export function evaluateAsk(c: Circuit, sol: Solution, ask: Ask): number {
  return measure(c, sol.topology, { nodeVoltage: sol.nodeVoltage, compI: sol.compI }, ask, sol.values);
}

export function evaluateGiven(c: Circuit, sol: Solution, g: Given): number {
  return measure(c, sol.topology, { nodeVoltage: sol.nodeVoltage, compI: sol.compI }, g);
}
