// Minimal complex arithmetic for phasor analysis.

export interface Complex {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const ZERO = cx(0);
export const add = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
export const sub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
export const mul = (a: Complex, b: Complex): Complex => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a: Complex, k: number): Complex => cx(a.re * k, a.im * k);
export const conj = (a: Complex): Complex => cx(a.re, -a.im);
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
/** Argument in degrees. */
export const argDeg = (a: Complex): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
export function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
export const polar = (mag: number, deg: number): Complex => cx(mag * Math.cos((deg * Math.PI) / 180), mag * Math.sin((deg * Math.PI) / 180));
/** Instantaneous value Re(z·e^{jθ}) of a phasor at phase angle θ (radians). */
export const instant = (z: Complex, theta: number): number => z.re * Math.cos(theta) - z.im * Math.sin(theta);

/** Solves A x = b with partial pivoting. Returns null if singular. */
export function solveComplex(A: Complex[][], b: Complex[]): Complex[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let scaleMax = 0;
  for (const row of A) for (const v of row) scaleMax = Math.max(scaleMax, abs(v));
  const eps = 1e-12 * (scaleMax || 1);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (abs(M[r][col]) > abs(M[piv][col])) piv = r;
    if (abs(M[piv][col]) < eps) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = div(M[r][col], M[col][col]);
      if (f.re === 0 && f.im === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] = sub(M[r][k], mul(f, M[col][k]));
    }
  }
  return M.map((row, i) => div(row[n], row[i]));
}
