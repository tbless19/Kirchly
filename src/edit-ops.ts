// Pure circuit-editing operations used by the interactive editor. All of them mutate the circuit in place.

import type { Circuit, Component, ComponentKind } from "./types";

export const PREFIX: Record<ComponentKind, string> = {
  resistor: "R",
  voltage_source: "V",
  current_source: "I",
  capacitor: "C",
  inductor: "L",
  impedance: "Z",
  vcvs: "E",
  vccs: "G",
  ccvs: "H",
  cccs: "F",
};

export const DEFAULT_VALUE: Record<ComponentKind, number> = {
  resistor: 1000,
  voltage_source: 5,
  current_source: 0.001,
  capacitor: 1e-6,
  inductor: 1e-3,
  impedance: 10,
  vcvs: 2,
  vccs: 0.01,
  ccvs: 1000,
  cccs: 2,
};

export function emptyCircuit(): Circuit {
  return { title: "New circuit", points: [], wires: [], components: [], ground: null, givens: [], asks: [], notes: "" };
}

/** Smallest unused id with the kind's prefix: R1, R2, ... */
export function nextId(c: Circuit, kind: ComponentKind): string {
  const used = new Set(c.components.map((k) => k.id));
  for (let n = 1; ; n++) if (!used.has(`${PREFIX[kind]}${n}`)) return `${PREFIX[kind]}${n}`;
}

/** Id of the point at grid (x, y), creating one if needed. */
export function pointAt(c: Circuit, x: number, y: number): string {
  const found = c.points.find((p) => p.x === x && p.y === y);
  if (found) return found.id;
  const used = new Set(c.points.map((p) => p.id));
  let n = c.points.length + 1;
  while (used.has(`p${n}`)) n++;
  c.points.push({ id: `p${n}`, x, y });
  return `p${n}`;
}

export function addComponent(c: Circuit, kind: ComponentKind, from: { x: number; y: number }, to: { x: number; y: number }): string {
  const id = nextId(c, kind);
  c.components.push({
    id,
    kind,
    a: pointAt(c, from.x, from.y),
    b: pointAt(c, to.x, to.y),
    value: DEFAULT_VALUE[kind],
    ctrl_a: null,
    ctrl_b: null,
    ctrl_component: null,
    ...(kind === "voltage_source" || kind === "current_source" ? { phase: 0 } : {}),
    ...(kind === "impedance" ? { reactance: 10 } : {}),
  });
  normalize(c);
  return id;
}

export function addWire(c: Circuit, from: { x: number; y: number }, to: { x: number; y: number }): void {
  c.wires.push({ a: pointAt(c, from.x, from.y), b: pointAt(c, to.x, to.y) });
  normalize(c);
}

export function removeComponent(c: Circuit, id: string): void {
  c.components = c.components.filter((k) => k.id !== id);
  for (const k of c.components) if (k.ctrl_component === id) k.ctrl_component = null;
  c.givens = c.givens.filter((g) => g.component !== id);
  c.asks = c.asks.filter((a) => a.component !== id);
  normalize(c);
}

export function removeWire(c: Circuit, index: number): void {
  c.wires.splice(index, 1);
  normalize(c);
}

/** Renames a component everywhere it is referenced. Returns an error message, or null on success. */
export function renameComponent(c: Circuit, from: string, to: string): string | null {
  to = to.trim();
  if (!to) return "Name can't be empty.";
  if (to === from) return null;
  if (c.components.some((k) => k.id === to)) return `${to} already exists.`;
  for (const k of c.components) {
    if (k.id === from) k.id = to;
    if (k.ctrl_component === from) k.ctrl_component = to;
  }
  for (const g of c.givens) if (g.component === from) g.component = to;
  for (const a of c.asks) if (a.component === from) a.component = to;
  return null;
}

/** Changes a component's kind, re-prefixing auto-style ids (R3 -> V1) and resetting the value. */
export function changeKind(c: Circuit, k: Component, kind: ComponentKind): void {
  if (k.kind === kind) return;
  const autoId = new RegExp(`^${PREFIX[k.kind]}\\d+$`).test(k.id);
  k.kind = kind;
  k.value = DEFAULT_VALUE[kind];
  if (autoId) renameComponent(c, k.id, nextId(c, kind));
  if (kind !== "vcvs" && kind !== "vccs") k.ctrl_a = k.ctrl_b = null;
  if (kind !== "ccvs" && kind !== "cccs") k.ctrl_component = null;
  if (kind === "impedance") k.reactance = 10;
  else delete k.reactance;
  if (kind === "voltage_source" || kind === "current_source") k.phase ??= 0;
  else delete k.phase;
}

export function flipComponent(k: Component): void {
  [k.a, k.b] = [k.b, k.a];
}

/**
 * Restores invariants after any edit:
 *  - points at the same grid position are merged,
 *  - a point lying inside a straight wire splits it (T-junction),
 *  - zero-length and duplicate wires and zero-length components are removed,
 *  - points nothing refers to are dropped.
 */
export function normalize(c: Circuit): void {
  // 1. Merge coincident points.
  const byPos = new Map<string, string>();
  const rename = new Map<string, string>();
  for (const p of c.points) {
    const key = `${p.x},${p.y}`;
    const keep = byPos.get(key);
    if (keep) rename.set(p.id, keep);
    else byPos.set(key, p.id);
  }
  if (rename.size) {
    const r = (id: string | null) => (id !== null && rename.has(id) ? rename.get(id)! : id);
    c.points = c.points.filter((p) => !rename.has(p.id));
    for (const w of c.wires) {
      w.a = r(w.a)!;
      w.b = r(w.b)!;
    }
    for (const k of c.components) {
      k.a = r(k.a)!;
      k.b = r(k.b)!;
      k.ctrl_a = r(k.ctrl_a);
      k.ctrl_b = r(k.ctrl_b);
    }
    c.ground = r(c.ground);
    for (const g of [...c.givens, ...c.asks]) {
      g.a = r(g.a);
      g.b = r(g.b);
    }
  }

  // 2. Split straight wires at interior points.
  const pos = new Map(c.points.map((p) => [p.id, p]));
  let split = true;
  while (split) {
    split = false;
    for (let i = 0; i < c.wires.length && !split; i++) {
      const w = c.wires[i];
      const a = pos.get(w.a);
      const b = pos.get(w.b);
      if (!a || !b || (a.x !== b.x && a.y !== b.y)) continue;
      const inside = c.points.find(
        (p) =>
          p.id !== a.id &&
          p.id !== b.id &&
          ((a.x === b.x && p.x === a.x && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)) ||
            (a.y === b.y && p.y === a.y && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x))),
      );
      if (inside) {
        c.wires.splice(i, 1, { a: w.a, b: inside.id }, { a: inside.id, b: w.b });
        split = true;
      }
    }
  }

  // 3. Drop degenerate and duplicate wires; drop zero-length components.
  const seen = new Set<string>();
  c.wires = c.wires.filter((w) => {
    if (w.a === w.b) return false;
    const key = [w.a, w.b].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  c.components = c.components.filter((k) => k.a !== k.b);

  // 4. Rejoin a straight wire that was split at a point nothing else uses any more.
  const pinned = new Set<string>();
  for (const k of c.components) {
    pinned.add(k.a).add(k.b);
    if (k.ctrl_a) pinned.add(k.ctrl_a);
    if (k.ctrl_b) pinned.add(k.ctrl_b);
  }
  if (c.ground) pinned.add(c.ground);
  for (const g of [...c.givens, ...c.asks]) {
    if (g.a) pinned.add(g.a);
    if (g.b) pinned.add(g.b);
  }
  for (const p of c.points) {
    if (pinned.has(p.id)) continue;
    const touching = c.wires.filter((w) => w.a === p.id || w.b === p.id);
    if (touching.length !== 2) continue;
    const ends = touching.map((w) => pos.get(w.a === p.id ? w.b : w.a)!);
    const collinear = ends.every((e) => e && e.x === p.x) || ends.every((e) => e && e.y === p.y);
    const opposite = collinear && (ends[0].x - p.x) * (ends[1].x - p.x) + (ends[0].y - p.y) * (ends[1].y - p.y) < 0;
    if (!opposite) continue;
    c.wires = c.wires.filter((w) => !touching.includes(w));
    c.wires.push({ a: ends[0].id, b: ends[1].id });
  }

  // 5. Drop orphan points.
  const used = new Set<string>(pinned);
  for (const w of c.wires) used.add(w.a).add(w.b);
  c.points = c.points.filter((p) => used.has(p.id));
  if (c.ground && !c.points.some((p) => p.id === c.ground)) c.ground = null;
}
