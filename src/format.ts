import type { ComponentKind } from "./types";

const PREFIXES: [number, string][] = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** Engineering notation: formatSI(0.0012, "A") -> "1.2 mA". */
export function formatSI(v: number, unit: string, digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 1e-15) return `0 ${unit}`;
  const abs = Math.abs(v);
  const [scale, prefix] = PREFIXES.find(([s]) => abs >= s * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  const n = Number((v / scale).toPrecision(digits));
  return `${n} ${prefix}${unit}`;
}

const MULTIPLIERS: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, meg: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12,
};

/** Parses "4.7k", "2 mA", "10e-3", "1meg" into a number. Returns null for empty / "?" (unknown). */
export function parseSI(text: string): number | null | typeof NaN {
  const t = text.trim();
  if (t === "" || t === "?") return null;
  const m = t.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(meg|[TGMkKmuµnp])?\s*[a-zA-ZΩ]*$/);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? MULTIPLIERS[m[2]] : 1);
}

export function unitFor(kind: ComponentKind): string {
  switch (kind) {
    case "resistor":
      return "Ω";
    case "voltage_source":
      return "V";
    case "current_source":
      return "A";
    case "capacitor":
      return "F";
    case "inductor":
      return "H";
    case "vcvs":
      return "V/V";
    case "vccs":
      return "A/V";
    case "ccvs":
      return "V/A";
    case "cccs":
      return "A/A";
  }
}

export const KIND_LABEL: Record<ComponentKind, string> = {
  resistor: "Resistor",
  voltage_source: "Voltage source",
  current_source: "Current source",
  capacitor: "Capacitor",
  inductor: "Inductor",
  vcvs: "VCVS",
  vccs: "VCCS",
  ccvs: "CCVS",
  cccs: "CCCS",
};

export function formatValue(kind: ComponentKind, v: number): string {
  const u = unitFor(kind);
  if (u.includes("/")) return `${Number(v.toPrecision(4))} ${u}`;
  return formatSI(v, u);
}
