import type { ComponentKind } from "./types";
import { abs, argDeg, type Complex } from "./complex";

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

/** Polar phasor: "5.2 V ∠ −30.0°". */
export function formatPhasor(z: Complex, unit: string, digits = 4): string {
  const m = abs(z);
  if (m < 1e-15) return `0 ${unit}`;
  const deg = argDeg(z);
  return `${formatSI(m, unit, digits)} ∠ ${formatDeg(deg)}`;
}

/** Compact phasor for crowded places: "1.59 mA∠−30°". */
export function formatPhasorShort(z: Complex, unit: string): string {
  const m = abs(z);
  if (m < 1e-15) return `0 ${unit}`;
  const deg = Math.round(argDeg(z));
  return `${formatSI(m, unit, 3)}∠${deg < 0 ? "−" : ""}${Math.abs(deg === -180 ? 180 : deg)}°`;
}

export function formatDeg(deg: number): string {
  const d = Math.abs(deg) < 0.05 ? 0 : deg;
  return `${d < 0 ? "−" : ""}${Math.abs(d).toFixed(1)}°`;
}

/** Rectangular form: "3 + j4 Ω", "−j15.9 Ω". */
export function formatRect(z: Complex, unit: string, digits = 4): string {
  const r = Number(z.re.toPrecision(digits));
  const x = Number(z.im.toPrecision(digits));
  const tiny = (v: number) => Math.abs(v) < 1e-12 * Math.max(1, Math.abs(z.re), Math.abs(z.im));
  const sep = unit ? ` ${unit}` : "";
  if (tiny(z.im)) return `${r}${sep}`;
  const jx = `j${Math.abs(x)}`;
  if (tiny(z.re)) return `${x < 0 ? "−" : ""}${jx}${sep}`;
  return `${r} ${x < 0 ? "−" : "+"} ${jx}${sep}`;
}

const MULTIPLIERS: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, meg: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12,
};

/** Parses "4.7k", "2 mA", "10e-3", "1meg" into a number. Returns null for empty / "?" (unknown). */
export function parseSI(text: string): number | null | typeof NaN {
  const t = text.trim();
  if (t === "" || t === "?") return null;
  const m = t.match(/^([-+−]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(meg|[TGMkKmuµnp])?\s*[a-zA-ZΩ°]*$/);
  if (!m) return NaN;
  return parseFloat(m[1].replace("−", "-")) * (m[2] ? MULTIPLIERS[m[2]] : 1);
}

/** Parses "3+j4", "-j5", "10", "2k - j1.5k" into a complex number (SI prefixes allowed). NaN parts on failure. */
export function parseComplex(text: string): Complex | null {
  const t = text.replace(/\s+/g, "").replace(/−/g, "-").replace(/Ω|ohms?/gi, "");
  if (!t) return null;
  const m = t.match(/^([-+]?[\d.]+(?:e[-+]?\d+)?(?:meg|[TGMkKmuµnp])?)?(?:([-+])j([\d.]+(?:e[-+]?\d+)?(?:meg|[TGMkKmuµnp])?)?)?$/);
  const jOnly = t.match(/^([-+]?)j([\d.]+(?:e[-+]?\d+)?(?:meg|[TGMkKmuµnp])?)?$/);
  if (jOnly) {
    const x = jOnly[2] ? (parseSI(jOnly[2]) as number) : 1;
    return { re: 0, im: jOnly[1] === "-" ? -x : x };
  }
  if (!m || (!m[1] && !m[2])) return { re: NaN, im: NaN };
  const re = m[1] ? (parseSI(m[1]) as number) : 0;
  const im = m[2] ? (m[3] ? (parseSI(m[3]) as number) : 1) * (m[2] === "-" ? -1 : 1) : 0;
  return { re, im };
}

export function unitFor(kind: ComponentKind): string {
  switch (kind) {
    case "resistor":
    case "impedance":
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
  impedance: "Impedance",
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

/**
 * Full value text for a part: "4.7 kΩ", "3 + j4 Ω", "10 V ∠ 30.0°" (AC source), "?" parts for unknowns.
 */
export function describeValue(
  k: { kind: ComponentKind; value: number | null; phase?: number | null; reactance?: number | null },
  ac: boolean,
): string {
  if (k.kind === "impedance") {
    if (k.value === null || k.reactance === null || k.reactance === undefined) {
      const r = k.value === null ? "?" : String(Number(k.value.toPrecision(4)));
      const x = k.reactance === null || k.reactance === undefined ? "?" : String(Number(Math.abs(k.reactance).toPrecision(4)));
      const sign = k.reactance !== null && k.reactance !== undefined && k.reactance < 0 ? "−" : "+";
      return `${r} ${sign} j${x} Ω`;
    }
    return formatRect({ re: k.value, im: ac ? k.reactance : 0 }, "Ω");
  }
  if (k.value === null) return "?";
  const base = formatValue(k.kind, k.value);
  if (ac && (k.kind === "voltage_source" || k.kind === "current_source") && k.phase) return `${base} ∠ ${formatDeg(k.phase)}`;
  return base;
}
