// Physical dimensions, unit parsing ("72 km/h", "35°", "300 rpm") and number formatting for the motion solver.
// Values are stored in SI, except angles of kind "angle", which are stored in degrees.

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

interface DimInfo {
  unit: string; // plain text
  tex: string; // TeX
  /** Accepted unit spellings -> factor to the stored unit. */
  aliases: Record<string, number>;
}

const DIMS: Record<Dim, DimInfo> = {
  time: { unit: "s", tex: "\\mathrm{s}", aliases: { s: 1, sec: 1, ms: 1e-3, min: 60, h: 3600, hr: 3600 } },
  length: {
    unit: "m",
    tex: "\\mathrm{m}",
    aliases: { m: 1, cm: 0.01, mm: 1e-3, km: 1000, ft: 0.3048, in: 0.0254, mi: 1609.344 },
  },
  speed: {
    unit: "m/s",
    tex: "\\mathrm{m/s}",
    aliases: { "m/s": 1, "km/h": 1 / 3.6, kph: 1 / 3.6, "km/hr": 1 / 3.6, mph: 0.44704, "ft/s": 0.3048, "cm/s": 0.01 },
  },
  accel: { unit: "m/s²", tex: "\\mathrm{m/s^2}", aliases: { "m/s²": 1, "m/s^2": 1, "m/s2": 1, "ft/s²": 0.3048, "ft/s^2": 0.3048, g: 9.8 } },
  mass: { unit: "kg", tex: "\\mathrm{kg}", aliases: { kg: 1, g: 1e-3, lb: 0.45359237, t: 1000 } },
  force: { unit: "N", tex: "\\mathrm{N}", aliases: { n: 1, kn: 1000, lbf: 4.4482216 } },
  angle: { unit: "°", tex: "^\\circ", aliases: { "°": 1, deg: 1, degrees: 1, rad: 180 / Math.PI } },
  angle_rad: { unit: "rad", tex: "\\,\\mathrm{rad}", aliases: { rad: 1, rev: 2 * Math.PI, "°": Math.PI / 180, deg: Math.PI / 180 } },
  angvel: {
    unit: "rad/s",
    tex: "\\mathrm{rad/s}",
    aliases: { "rad/s": 1, rpm: (2 * Math.PI) / 60, "rev/min": (2 * Math.PI) / 60, "rev/s": 2 * Math.PI, rps: 2 * Math.PI, "°/s": Math.PI / 180, "deg/s": Math.PI / 180 },
  },
  angacc: { unit: "rad/s²", tex: "\\mathrm{rad/s^2}", aliases: { "rad/s²": 1, "rad/s^2": 1, "rad/s2": 1, "rev/s²": 2 * Math.PI, "rev/s^2": 2 * Math.PI } },
  energy: { unit: "J", tex: "\\mathrm{J}", aliases: { j: 1, kj: 1000, mj: 1e6, cal: 4.184 } },
  momentum: { unit: "kg·m/s", tex: "\\mathrm{kg\\cdot m/s}", aliases: { "kg·m/s": 1, "kg*m/s": 1, "kgm/s": 1, "n·s": 1, "n*s": 1, ns: 1 } },
  freq: { unit: "Hz", tex: "\\mathrm{Hz}", aliases: { hz: 1, khz: 1000 } },
  torque: { unit: "N·m", tex: "\\mathrm{N\\cdot m}", aliases: { "n·m": 1, "n*m": 1, nm: 1 } },
  inertia: { unit: "kg·m²", tex: "\\mathrm{kg\\cdot m^2}", aliases: { "kg·m²": 1, "kg*m^2": 1, "kgm^2": 1, "kg·m^2": 1 } },
  spring: { unit: "N/m", tex: "\\mathrm{N/m}", aliases: { "n/m": 1, "kn/m": 1000, "n/cm": 100 } },
  count: { unit: "", tex: "", aliases: { rev: 1, revs: 1, revolutions: 1 } },
  unitless: { unit: "", tex: "", aliases: {} },
};

export const unitOf = (d: Dim) => DIMS[d].unit;

/**
 * Parses user input for a quantity. Returns null for "" or "?" (unknown), NaN if unreadable.
 * The unit is optional; a missing unit means the stored unit.
 */
export function parseQuantity(text: string, dim: Dim): number | null {
  const t = text.trim().replace(/−/g, "-").replace(/,/g, "");
  if (t === "" || t === "?") return null;
  const m = t.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(.*)$/i);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const unit = m[2].trim();
  if (!unit) return v;
  const info = DIMS[dim];
  const factor = info.aliases[unit] ?? info.aliases[unit.toLowerCase()] ?? (unit === info.unit ? 1 : undefined);
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

export function formatQuantity(v: number, dim: Dim, digits = 4): string {
  const u = DIMS[dim].unit;
  if (dim === "angle") return `${formatNumber(v, digits)}°`;
  return u ? `${formatNumber(v, digits)} ${u}` : formatNumber(v, digits);
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

export function texQuantity(v: number, dim: Dim, digits = 4): string {
  const info = DIMS[dim];
  if (dim === "angle") return `${texNumber(v, digits)}^\\circ`;
  if (!info.tex) return texNumber(v, digits);
  if (dim === "angle_rad") return `${texNumber(v, digits)}${info.tex}`;
  return `${texNumber(v, digits)}\\,${info.tex}`;
}
