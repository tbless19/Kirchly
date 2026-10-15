// TeX snippets for the walkthrough equations (rendered with KaTeX).

import { abs, argDeg, type Complex } from "./complex";
import { formatSI } from "./format";

/** Escapes text for use inside \text{} / \mathrm{}. */
function esc(s: string): string {
  return s.replace(/[\\{}_^#$%&~]/g, (ch) => (ch === "\\" ? "\\textbackslash{}" : ch === "~" ? "\\textasciitilde{}" : ch === "^" ? "\\textasciicircum{}" : `\\${ch}`));
}

/** Upright subscript text: "R1" -> \mathrm{R1}. */
function sub(s: string): string {
  return /^[A-Za-z0-9]+$/.test(s) ? `\\mathrm{${s}}` : `\\text{${esc(s)}}`;
}

/** A part's name as a symbol: R1 -> R_{1}, Vs -> V_{s}, Rload -> R_{\mathrm{load}}. */
export function partSym(id: string, lower = false): string {
  const m = id.match(/^([A-Za-z])([A-Za-z0-9]*)$/);
  if (!m) return `\\text{${esc(id)}}`;
  const letter = lower ? m[1].toLowerCase() : m[1];
  if (!m[2]) return letter;
  return `${letter}_{${/^\d+$/.test(m[2]) || m[2].length === 1 ? m[2] : `\\mathrm{${m[2]}}`}}`;
}

/** Quantity of a part or node: q("I", "R1") -> I_{\mathrm{R1}}. */
export function q(symbol: string, id: string): string {
  return `${symbol}_{${sub(id)}}`;
}

/** Quantity between two points: q2("V", "p1", "p2") -> V_{\mathrm{p1},\mathrm{p2}}. */
export function q2(symbol: string, a: string, b: string): string {
  return `${symbol}_{${sub(a)},${sub(b)}}`;
}

/** Unit text in TeX: "kΩ" -> \mathrm{k\Omega}, "µF" -> \mu\mathrm{F}. */
function unitTex(u: string): string {
  if (!u) return "";
  const parts = u.replace(/µ/g, "\u0001").replace(/Ω/g, "\u0002");
  let out = "";
  let run = "";
  const flush = () => {
    if (run) out += `\\mathrm{${esc(run)}}`;
    run = "";
  };
  for (const ch of parts) {
    if (ch === "\u0001") (flush(), (out += "\\mu "));
    else if (ch === "\u0002") (flush(), (out += "\\Omega "));
    else run += ch;
  }
  flush();
  return out.trim();
}

/** Converts a formatSI string ("1.2 mA") to TeX ("1.2\,\mathrm{mA}"). */
function siToTex(s: string): string {
  const i = s.indexOf(" ");
  if (i < 0) return s;
  const num = s.slice(0, i).replace("−", "-");
  const unit = s.slice(i + 1);
  return unit ? `${num}\\,${unitTex(unit)}` : num;
}

export function si(v: number, unit: string, digits = 4): string {
  return siToTex(formatSI(v, unit, digits));
}

/** Plain number without unit. */
export function num(v: number, digits = 4): string {
  return siToTex(formatSI(v, "", digits)).replace(/\\,$/, "");
}

export function deg(d: number): string {
  const v = Math.abs(d) < 0.05 ? 0 : d;
  return `${Number(v.toFixed(1))}^\\circ`;
}

/** Polar phasor: 9.52\,\mathrm{A}\angle 37.5^\circ. */
export function phasor(z: Complex, unit: string, digits = 4): string {
  if (abs(z) < 1e-15) return `0\\,${unitTex(unit)}`;
  return `${si(abs(z), unit, digits)}\\angle ${deg(argDeg(z))}`;
}

/** Rectangular: 3 + j4\,\Omega, -j26.5\,\Omega. */
export function rect(z: Complex, unit: string, digits = 4): string {
  const tiny = (v: number) => Math.abs(v) < 1e-12 * Math.max(1, abs(z));
  const r = Number(z.re.toPrecision(digits));
  const x = Number(Math.abs(z.im).toPrecision(digits));
  const u = unit ? `\\,${unitTex(unit)}` : "";
  if (tiny(z.im)) return `${r}${u}`;
  if (tiny(z.re)) return `${z.im < 0 ? "-" : ""}j${x}${u}`;
  return `${r} ${z.im < 0 ? "-" : "+"} j${x}${u}`;
}

/** A voltage/current value: signed real in DC, polar phasor in AC. */
export function value(z: Complex, unit: string, ac: boolean, digits = 4): string {
  return ac ? phasor(z, unit, digits) : si(z.re, unit, digits);
}
