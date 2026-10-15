// Physical dimensions, unit parsing ("72 km/h", "35°", "60 mph") and number formatting for the motion solver.
// Values are always stored in SI (angles of kind "angle" in degrees). The display system (metric or
// imperial) only changes how values are shown and how unit-less input is read.

export type Dim =
  | "time"
  | "length"
  | "speed"
  | "accel"
  | "mass"
  | "force"
  | "angle" // degrees
  | "angle_rad"
  | "angvel"
  | "angacc"
  | "energy"
  | "momentum"
  | "freq"
  | "torque"
  | "inertia"
  | "spring"
  | "count"
  | "unitless";

export type UnitSystem = "metric" | "imperial";

interface DisplayUnit {
  unit: string; // plain text
  tex: string; // TeX
  /** Stored (SI) value of one display unit. */
  factor: number;
}

interface DimInfo {
  metric: DisplayUnit;
  /** Omitted when the unit is the same in both systems (time, angles, frequency). */
  imperial?: DisplayUnit;
  /** Accepted unit spellings -> SI factor. Lower-case keys also match case-insensitively. */
  aliases: Record<string, number>;
}

const FT = 0.3048;
const LB = 0.45359237; // pound-mass, kg
const LBF = 4.4482216152605; // pound-force, N

const si = (unit: string, tex: string): DisplayUnit => ({ unit, tex, factor: 1 });

const DIMS: Record<Dim, DimInfo> = {
  time: { metric: si("s", "\\mathrm{s}"), aliases: { s: 1, sec: 1, ms: 1e-3, min: 60, h: 3600, hr: 3600 } },
  length: {
    metric: si("m", "\\mathrm{m}"),
    imperial: { unit: "ft", tex: "\\mathrm{ft}", factor: FT },
    aliases: { m: 1, cm: 0.01, mm: 1e-3, km: 1000, ft: FT, feet: FT, foot: FT, in: 0.0254, inch: 0.0254, inches: 0.0254, yd: 0.9144, mi: 1609.344 },
  },
  speed: {
    metric: si("m/s", "\\mathrm{m/s}"),
    imperial: { unit: "ft/s", tex: "\\mathrm{ft/s}", factor: FT },
    aliases: { "m/s": 1, "km/h": 1 / 3.6, kph: 1 / 3.6, "km/hr": 1 / 3.6, "cm/s": 0.01, mph: 0.44704, "mi/h": 0.44704, "ft/s": FT, fps: FT, "in/s": 0.0254 },
  },
  accel: {
    metric: si("m/s²", "\\mathrm{m/s^2}"),
    imperial: { unit: "ft/s²", tex: "\\mathrm{ft/s^2}", factor: FT },
    aliases: { "m/s²": 1, "m/s^2": 1, "m/s2": 1, "ft/s²": FT, "ft/s^2": FT, "ft/s2": FT, g: 9.8 },
  },
  mass: {
    metric: si("kg", "\\mathrm{kg}"),
    imperial: { unit: "lb", tex: "\\mathrm{lb}", factor: LB },
    aliases: { kg: 1, g: 1e-3, t: 1000, lb: LB, lbs: LB, lbm: LB, oz: LB / 16, slug: 14.593903, slugs: 14.593903 },
  },
  force: {
    metric: si("N", "\\mathrm{N}"),
    imperial: { unit: "lbf", tex: "\\mathrm{lbf}", factor: LBF },
    aliases: { n: 1, kn: 1000, lbf: LBF, lb: LBF, lbs: LBF, kip: 1000 * LBF },
  },
  angle: { metric: si("°", "^\\circ"), aliases: { "°": 1, deg: 1, degrees: 1, rad: 180 / Math.PI } },
  angle_rad: { metric: si("rad", "\\,\\mathrm{rad}"), aliases: { rad: 1, rev: 2 * Math.PI, "°": Math.PI / 180, deg: Math.PI / 180 } },
  angvel: {
    metric: si("rad/s", "\\mathrm{rad/s}"),
    aliases: { "rad/s": 1, rpm: (2 * Math.PI) / 60, "rev/min": (2 * Math.PI) / 60, "rev/s": 2 * Math.PI, rps: 2 * Math.PI, "°/s": Math.PI / 180, "deg/s": Math.PI / 180 },
  },
  angacc: { metric: si("rad/s²", "\\mathrm{rad/s^2}"), aliases: { "rad/s²": 1, "rad/s^2": 1, "rad/s2": 1, "rev/s²": 2 * Math.PI, "rev/s^2": 2 * Math.PI } },
  energy: {
    metric: si("J", "\\mathrm{J}"),
    imperial: { unit: "ft·lbf", tex: "\\mathrm{ft\\cdot lbf}", factor: FT * LBF },
    aliases: { j: 1, kj: 1000, mj: 1e6, cal: 4.184, "ft·lbf": FT * LBF, "ft*lbf": FT * LBF, "ft-lbf": FT * LBF, "ft·lb": FT * LBF, "ft-lb": FT * LBF, ftlb: FT * LBF, btu: 1055.06 },
  },
  momentum: {
    metric: si("kg·m/s", "\\mathrm{kg\\cdot m/s}"),
    imperial: { unit: "lb·ft/s", tex: "\\mathrm{lb\\cdot ft/s}", factor: LB * FT },
    aliases: { "kg·m/s": 1, "kg*m/s": 1, "kgm/s": 1, "n·s": 1, "n*s": 1, ns: 1, "lb·ft/s": LB * FT, "lb*ft/s": LB * FT, "lbf·s": LBF, "lbf*s": LBF },
  },
  freq: { metric: si("Hz", "\\mathrm{Hz}"), aliases: { hz: 1, khz: 1000 } },
  torque: {
    metric: si("N·m", "\\mathrm{N\\cdot m}"),
    imperial: { unit: "lbf·ft", tex: "\\mathrm{lbf\\cdot ft}", factor: LBF * FT },
    aliases: { "n·m": 1, "n*m": 1, nm: 1, "lbf·ft": LBF * FT, "lbf*ft": LBF * FT, "lb·ft": LBF * FT, "lb-ft": LBF * FT, "ft·lb": LBF * FT, "lbf·in": LBF * 0.0254, "lb·in": LBF * 0.0254 },
  },
  inertia: {
    metric: si("kg·m²", "\\mathrm{kg\\cdot m^2}"),
    imperial: { unit: "lb·ft²", tex: "\\mathrm{lb\\cdot ft^2}", factor: LB * FT * FT },
    aliases: { "kg·m²": 1, "kg*m^2": 1, "kgm^2": 1, "kg·m^2": 1, "lb·ft²": LB * FT * FT, "lb*ft^2": LB * FT * FT, "lb·ft^2": LB * FT * FT, "slug·ft²": 14.593903 * FT * FT, "slug*ft^2": 14.593903 * FT * FT },
  },
  spring: {
    metric: si("N/m", "\\mathrm{N/m}"),
    imperial: { unit: "lbf/ft", tex: "\\mathrm{lbf/ft}", factor: LBF / FT },
    aliases: { "n/m": 1, "kn/m": 1000, "n/cm": 100, "lbf/ft": LBF / FT, "lb/ft": LBF / FT, "lbf/in": LBF / 0.0254, "lb/in": LBF / 0.0254 },
  },
  count: { metric: si("", ""), aliases: { rev: 1, revs: 1, revolutions: 1 } },
  unitless: { metric: si("", ""), aliases: {} },
};

let system: UnitSystem = "metric";

export function setUnitSystem(s: UnitSystem) {
  system = s;
}

export function unitSystem(): UnitSystem {
  return system;
}

function display(dim: Dim): DisplayUnit {
  const info = DIMS[dim];
  return (system === "imperial" && info.imperial) || info.metric;
}

/** Unit label in the current display system. */
export const unitOf = (d: Dim) => display(d).unit;

/** SI value -> number in the current display unit. */
export const toDisplay = (v: number, dim: Dim) => v / display(dim).factor;

/**
 * Parses user input for a quantity, returning SI. Returns null for "" or "?" (unknown), NaN if unreadable.
 * A number without a unit is read in the current display unit.
 */
export function parseQuantity(text: string, dim: Dim): number | null {
  const t = text.trim().replace(/−/g, "-").replace(/,/g, "");
  if (t === "" || t === "?") return null;
  const m = t.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(.*)$/i);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const unit = m[2].trim();
  if (!unit) return v * display(dim).factor;
  const info = DIMS[dim];
  const own = [info.metric, info.imperial].find((u) => u && u.unit === unit);
  const factor = info.aliases[unit] ?? info.aliases[unit.toLowerCase()] ?? own?.factor;
  return factor === undefined ? NaN : v * factor;
}

/** "4.08", "0.00325" -> "3.25×10⁻³" style numbers with 4 significant figures. */
export function formatNumber(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0 || Math.abs(v) < 1e-12) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return String(Number(v.toPrecision(digits)));
  const [mant, exp] = v.toExponential(digits - 1).split("e");
  const sup = String(Number(exp)).replace(/[-0-9]/g, (ch) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(ch)]);
  return `${Number(mant)}×10${sup}`;
}

/** An SI value formatted in the current display system: "12.2 m" or "40.03 ft". */
export function formatQuantity(v: number, dim: Dim, digits = 4): string {
  const d = display(dim);
  const n = formatNumber(v / d.factor, digits);
  if (dim === "angle") return `${n}°`;
  return d.unit ? `${n} ${d.unit}` : n;
}

/** TeX number: 4.08, 3.25\times10^{-3}. */
export function texNumber(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "?";
  if (v === 0 || Math.abs(v) < 1e-12) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return String(Number(v.toPrecision(digits)));
  const [mant, exp] = v.toExponential(digits - 1).split("e");
  return `${Number(mant)}\\times10^{${Number(exp)}}`;
}

/** An SI value as TeX in the current display system. */
export function texQuantity(v: number, dim: Dim, digits = 4): string {
  const d = display(dim);
  const n = texNumber(v / d.factor, digits);
  if (dim === "angle") return `${n}^\\circ`;
  if (!d.tex) return n;
  if (dim === "angle_rad") return `${n}${d.tex}`;
  return `${n}\\,${d.tex}`;
}
