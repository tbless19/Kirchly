// Physics problem types. Each is a set of variables and the equations that relate them;
// the solver (solve.ts) finds whatever unknowns the givens determine.
// Conventions: SI units; angles of dim "angle" are in degrees.

import type { Dim } from "./units";

export type Values = Record<string, number>;

export interface VarDef {
  key: string;
  tex: string;
  label: string;
  dim: Dim;
  min?: number;
  max?: number;
  /** Which root to keep when an equation has several: default = smallest non-negative. */
  prefer?: "smallest" | "largest";
  /** Typical magnitude, used for numeric starting guesses. */
  scale: number;
  /** Value assumed when the problem doesn't give one (shown as "assumed" in the walkthrough). */
  default?: number;
}

export interface Eq {
  tex: string;
  vars: string[];
  /** Returns [left side, right side]. */
  f: (v: Values) => [number, number];
  /** Short name shown in the walkthrough, e.g. "Newton's second law". */
  name?: string;
}

export interface ModelSpec {
  vars: VarDef[];
  eqs: Eq[];
}

export type MotionType =
  | "kinematics_1d"
  | "projectile"
  | "incline"
  | "pulley"
  | "circular"
  | "rotation"
  | "energy"
  | "collision"
  | "shm";

export interface MotionModel {
  type: MotionType;
  title: string;
  variants: { id: string; label: string }[];
  build(variant: string): ModelSpec;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const G_CONST = 6.674e-11;

function V(key: string, tex: string, label: string, dim: Dim, scale: number, extra: Partial<VarDef> = {}): VarDef {
  return { key, tex, label, dim, scale, ...extra };
}

const g = () => V("g", "g", "Gravitational acceleration", "accel", 9.8, { min: 1e-9, default: 9.8 });

/** Constant-acceleration equations for displacement d, speeds v0 → v, acceleration a, time t. */
function kinematics(d = "d", dTex = "\\Delta x"): { vars: VarDef[]; eqs: Eq[] } {
  return {
    vars: [
      V("v0", "v_0", "Initial velocity", "speed", 10),
      V("v", "v", "Final velocity", "speed", 10),
      V("a", "a", "Acceleration", "accel", 5),
      V("t", "t", "Time", "time", 3, { min: 0 }),
      V(d, dTex, "Displacement", "length", 20),
    ],
    eqs: [
      { tex: "v = v_0 + a t", vars: ["v", "v0", "a", "t"], f: (x) => [x.v, x.v0 + x.a * x.t] },
      { tex: `${dTex} = v_0 t + \\tfrac{1}{2} a t^2`, vars: [d, "v0", "a", "t"], f: (x) => [x[d], x.v0 * x.t + 0.5 * x.a * x.t * x.t] },
      { tex: `v^2 = v_0^2 + 2 a\\,${dTex}`, vars: ["v", "v0", "a", d], f: (x) => [x.v * x.v, x.v0 * x.v0 + 2 * x.a * x[d]] },
      { tex: `${dTex} = \\tfrac{1}{2}(v_0 + v)\\,t`, vars: [d, "v0", "v", "t"], f: (x) => [x[d], 0.5 * (x.v0 + x.v) * x.t] },
    ],
  };
}

// ------------------------------------------------------------------ 1D constant acceleration

const kinematics1d: MotionModel = {
  type: "kinematics_1d",
  title: "1D motion (constant acceleration)",
  variants: [
    { id: "horizontal", label: "Horizontal (car, runner…)" },
    { id: "free_fall", label: "Vertical, free fall (a = −g, up is +)" },
  ],
  build(variant) {
    const k = kinematics();
    if (variant === "free_fall") {
      k.vars.push(g());
      k.vars.find((x) => x.key === "d")!.tex = "\\Delta y";
      k.eqs = kinematics("d", "\\Delta y").eqs;
      k.eqs.push({ tex: "a = -g", vars: ["a", "g"], f: (x) => [x.a, -x.g], name: "Free fall" });
    }
    return k;
  },
};

// ------------------------------------------------------------------ projectile

const projectile: MotionModel = {
  type: "projectile",
  title: "Projectile motion",
  variants: [{ id: "standard", label: "Launched at an angle (or horizontally)" }],
  build() {
    return {
      vars: [
        V("v0", "v_0", "Launch speed", "speed", 20, { min: 0 }),
        V("theta", "\\theta", "Launch angle above horizontal", "angle", 30, { min: -90, max: 90 }),
        V("h0", "h_0", "Launch height", "length", 5, { default: 0 }),
        V("hL", "h_L", "Landing height", "length", 5, { default: 0 }),
        g(),
        V("vx", "v_x", "Horizontal velocity", "speed", 15),
        V("vy0", "v_{0y}", "Initial vertical velocity", "speed", 10),
        V("t", "t", "Time of flight", "time", 3, { min: 0, prefer: "largest" }),
        V("R", "R", "Horizontal range", "length", 40),
        V("H", "H", "Maximum height", "length", 15),
        V("tp", "t_{\\text{peak}}", "Time to maximum height", "time", 1.5),
        V("vL", "v_L", "Speed at landing", "speed", 20, { min: 0 }),
      ],
      eqs: [
        { tex: "v_x = v_0\\cos\\theta", vars: ["vx", "v0", "theta"], f: (x) => [x.vx, x.v0 * Math.cos(rad(x.theta))] },
        { tex: "v_{0y} = v_0\\sin\\theta", vars: ["vy0", "v0", "theta"], f: (x) => [x.vy0, x.v0 * Math.sin(rad(x.theta))] },
        { tex: "v_{0y} = g\\,t_{\\text{peak}}", vars: ["vy0", "g", "tp"], f: (x) => [x.vy0, x.g * x.tp], name: "Vertical velocity is zero at the peak" },
        { tex: "H = h_0 + \\dfrac{v_{0y}^2}{2g}", vars: ["H", "h0", "vy0", "g"], f: (x) => [x.H, x.h0 + (x.vy0 * x.vy0) / (2 * x.g)] },
        { tex: "h_L = h_0 + v_{0y}\\,t - \\tfrac{1}{2} g t^2", vars: ["hL", "h0", "vy0", "t", "g"], f: (x) => [x.hL, x.h0 + x.vy0 * x.t - 0.5 * x.g * x.t * x.t], name: "Vertical position at landing" },
        { tex: "R = v_x\\,t", vars: ["R", "vx", "t"], f: (x) => [x.R, x.vx * x.t], name: "Horizontal motion is uniform" },
        { tex: "v_L^2 = v_x^2 + (v_{0y} - g t)^2", vars: ["vL", "vx", "vy0", "g", "t"], f: (x) => [x.vL * x.vL, x.vx * x.vx + (x.vy0 - x.g * x.t) ** 2] },
      ],
    };
  },
};

// ------------------------------------------------------------------ inclined plane

const incline: MotionModel = {
  type: "incline",
  title: "Inclined plane (with friction)",
  variants: [
    { id: "down", label: "Sliding down the slope" },
    { id: "up", label: "Moving up the slope" },
  ],
  build(variant) {
    const s = variant === "up" ? -1 : 1;
    const k = kinematics("d", "d");
    k.vars.find((x) => x.key === "d")!.label = "Distance along the slope";
    k.vars.find((x) => x.key === "d")!.min = 0;
    k.vars.find((x) => x.key === "a")!.label = "Acceleration (along the motion)";
    return {
      vars: [
        V("m", "m", "Mass", "mass", 5, { min: 1e-12 }),
        V("theta", "\\theta", "Incline angle", "angle", 30, { min: 0, max: 90 }),
        V("mu", "\\mu_k", "Coefficient of kinetic friction", "unitless", 0.2, { min: 0, default: 0 }),
        g(),
        V("F", "F", "Applied force (up the slope)", "force", 10, { default: 0 }),
        V("N", "N", "Normal force", "force", 40, { min: 0 }),
        V("f", "f_k", "Friction force", "force", 10, { min: 0 }),
        ...k.vars,
      ],
      eqs: [
        { tex: "N = m g\\cos\\theta", vars: ["N", "m", "g", "theta"], f: (x) => [x.N, x.m * x.g * Math.cos(rad(x.theta))], name: "Perpendicular to the slope: forces balance" },
        { tex: "f_k = \\mu_k N", vars: ["f", "mu", "N"], f: (x) => [x.f, x.mu * x.N], name: "Kinetic friction" },
        s > 0
          ? { tex: "m a = m g\\sin\\theta - F - f_k", vars: ["m", "a", "g", "theta", "F", "f"], f: (x) => [x.m * x.a, x.m * x.g * Math.sin(rad(x.theta)) - x.F - x.f], name: "Newton's second law along the slope (down is +)" }
          : { tex: "m a = F - m g\\sin\\theta - f_k", vars: ["m", "a", "g", "theta", "F", "f"], f: (x) => [x.m * x.a, x.F - x.m * x.g * Math.sin(rad(x.theta)) - x.f], name: "Newton's second law along the slope (up is +)" },
        ...k.eqs,
      ],
    };
  },
};

// ------------------------------------------------------------------ pulleys

const pulley: MotionModel = {
  type: "pulley",
  title: "Pulleys (Atwood machine, block on a table)",
  variants: [
    { id: "atwood", label: "Atwood machine (two hanging masses)" },
    { id: "table", label: "Block on a table pulled by a hanging mass" },
  ],
  build(variant) {
    const k = kinematics("d", "d");
    k.vars.find((x) => x.key === "v0")!.default = 0;
    k.vars.find((x) => x.key === "d")!.label = "Distance moved";
    k.vars.find((x) => x.key === "a")!.label = "Acceleration (m₂ moving down is +)";
    const table = variant === "table";
    const vars = [
      V("m1", "m_1", table ? "Mass on the table" : "Mass 1 (left)", "mass", 2, { min: 1e-12 }),
      V("m2", "m_2", table ? "Hanging mass" : "Mass 2 (right)", "mass", 3, { min: 1e-12 }),
      g(),
      V("Ft", "T", "Rope tension", "force", 20, { min: 0 }),
      ...k.vars,
    ];
    const eqs: Eq[] = [
      { tex: "m_2 g - T = m_2 a", vars: ["m2", "g", "Ft", "a"], f: (x) => [x.m2 * x.g - x.Ft, x.m2 * x.a], name: "Newton's second law for m₂" },
    ];
    if (table) {
      vars.splice(2, 0, V("mu", "\\mu_k", "Coefficient of kinetic friction (table)", "unitless", 0.2, { min: 0, default: 0 }));
      eqs.push({ tex: "T - \\mu_k m_1 g = m_1 a", vars: ["Ft", "mu", "m1", "g", "a"], f: (x) => [x.Ft - x.mu * x.m1 * x.g, x.m1 * x.a], name: "Newton's second law for m₁" });
    } else {
      eqs.push({ tex: "T - m_1 g = m_1 a", vars: ["Ft", "m1", "g", "a"], f: (x) => [x.Ft - x.m1 * x.g, x.m1 * x.a], name: "Newton's second law for m₁" });
    }
    return { vars, eqs: [...eqs, ...k.eqs] };
  },
};

// ------------------------------------------------------------------ uniform circular motion

const circular: MotionModel = {
  type: "circular",
  title: "Circular motion",
  variants: [
    { id: "horizontal", label: "Horizontal circle (string tension)" },
    { id: "flat_curve", label: "Car on a flat curve (friction)" },
    { id: "banked", label: "Banked curve (no friction)" },
    { id: "vertical_top", label: "Vertical circle, at the top" },
    { id: "vertical_bottom", label: "Vertical circle, at the bottom" },
    { id: "orbit", label: "Orbit (gravity)" },
  ],
  build(variant) {
    const vars = [
      V("m", "m", "Mass", "mass", 2, { min: 1e-12 }),
      V("r", "r", "Radius", "length", 5, { min: 1e-12 }),
      V("v", "v", "Speed", "speed", 10, { min: 0 }),
      V("w", "\\omega", "Angular speed", "angvel", 2, { min: 0 }),
      V("Tp", "T", "Period", "time", 3, { min: 1e-12 }),
      V("fr", "f", "Frequency", "freq", 0.5, { min: 0 }),
      V("ac", "a_c", "Centripetal acceleration", "accel", 10, { min: 0 }),
      V("Fc", "F_c", "Centripetal force", "force", 20, { min: 0 }),
    ];
    const eqs: Eq[] = [
      { tex: "v = \\omega r", vars: ["v", "w", "r"], f: (x) => [x.v, x.w * x.r] },
      { tex: "\\omega = \\dfrac{2\\pi}{T}", vars: ["w", "Tp"], f: (x) => [x.w * x.Tp, 2 * Math.PI] },
      { tex: "f = \\dfrac{1}{T}", vars: ["fr", "Tp"], f: (x) => [x.fr * x.Tp, 1] },
      { tex: "a_c = \\dfrac{v^2}{r}", vars: ["ac", "v", "r"], f: (x) => [x.ac * x.r, x.v * x.v], name: "Centripetal acceleration" },
      { tex: "F_c = m a_c", vars: ["Fc", "m", "ac"], f: (x) => [x.Fc, x.m * x.ac], name: "Newton's second law (toward the centre)" },
    ];
    switch (variant) {
      case "horizontal":
        vars.push(V("Ft", "T_s", "String tension", "force", 20, { min: 0 }));
        eqs.push({ tex: "T_s = F_c", vars: ["Ft", "Fc"], f: (x) => [x.Ft, x.Fc], name: "Tension supplies the centripetal force" });
        break;
      case "flat_curve":
        vars.push(V("mu", "\\mu_s", "Minimum coefficient of static friction", "unitless", 0.5, { min: 0 }), g());
        eqs.push({ tex: "F_c = \\mu_s m g", vars: ["Fc", "mu", "m", "g"], f: (x) => [x.Fc, x.mu * x.m * x.g], name: "Static friction supplies the centripetal force" });
        eqs.push({ tex: "\\mu_s = \\dfrac{v^2}{r g}", vars: ["mu", "v", "r", "g"], f: (x) => [x.mu * x.r * x.g, x.v * x.v], name: "Mass cancels" });
        break;
      case "banked":
        vars.push(V("theta", "\\theta", "Bank angle", "angle", 20, { min: 0, max: 89.999 }), g());
        eqs.push({ tex: "\\tan\\theta = \\dfrac{v^2}{r g}", vars: ["theta", "v", "r", "g"], f: (x) => [Math.tan(rad(x.theta)) * x.r * x.g, x.v * x.v], name: "Normal force supplies the centripetal force" });
        break;
      case "vertical_top":
        vars.push(V("Ft", "T_s", "Tension (or normal force) at the top", "force", 20, { min: 0 }), g());
        eqs.push({ tex: "T_s + m g = F_c", vars: ["Ft", "m", "g", "Fc"], f: (x) => [x.Ft + x.m * x.g, x.Fc], name: "At the top, gravity and tension both point to the centre" });
        break;
      case "vertical_bottom":
        vars.push(V("Ft", "T_s", "Tension (or normal force) at the bottom", "force", 40, { min: 0 }), g());
        eqs.push({ tex: "T_s - m g = F_c", vars: ["Ft", "m", "g", "Fc"], f: (x) => [x.Ft - x.m * x.g, x.Fc], name: "At the bottom, tension points up to the centre and gravity down" });
        break;
      case "orbit":
        vars.push(V("M", "M", "Central mass", "mass", 6e24, { min: 1e-12 }));
        eqs.push({ tex: "\\dfrac{G M}{r^2} = a_c", vars: ["M", "r", "ac"], f: (x) => [(G_CONST * x.M) / (x.r * x.r), x.ac], name: "Gravity supplies the centripetal force (G = 6.674×10⁻¹¹)" });
        break;
    }
    return { vars, eqs };
  },
};

// ------------------------------------------------------------------ rotation

const SHAPES: Record<string, { k: number; label: string; tex: string }> = {
  solid_disk: { k: 0.5, label: "Solid disk / cylinder", tex: "\\tfrac{1}{2} m R^2" },
  hoop: { k: 1, label: "Hoop / thin ring", tex: "m R^2" },
  solid_sphere: { k: 0.4, label: "Solid sphere", tex: "\\tfrac{2}{5} m R^2" },
  hollow_sphere: { k: 2 / 3, label: "Hollow sphere", tex: "\\tfrac{2}{3} m R^2" },
  rod_center: { k: 1 / 12, label: "Rod about its centre (R = length)", tex: "\\tfrac{1}{12} m L^2" },
  rod_end: { k: 1 / 3, label: "Rod about one end (R = length)", tex: "\\tfrac{1}{3} m L^2" },
  point: { k: 1, label: "Point mass at radius R", tex: "m R^2" },
};

const rotation: MotionModel = {
  type: "rotation",
  title: "Rotation (angular motion, torque)",
  variants: [...Object.entries(SHAPES).map(([id, s]) => ({ id, label: s.label })), { id: "custom", label: "Moment of inertia given directly" }],
  build(variant) {
    const shape = SHAPES[variant];
    const rod = variant.startsWith("rod");
    const vars = [
      V("w0", "\\omega_0", "Initial angular velocity", "angvel", 5),
      V("w", "\\omega", "Final angular velocity", "angvel", 10),
      V("al", "\\alpha", "Angular acceleration", "angacc", 2),
      V("t", "t", "Time", "time", 3, { min: 0 }),
      V("th", "\\Delta\\theta", "Angular displacement", "angle_rad", 20),
      V("nrev", "N", "Revolutions", "count", 3),
      V("R", rod ? "L" : "R", rod ? "Rod length" : "Radius", "length", 0.5, { min: 1e-12 }),
      V("vt", "v_t", "Tangential speed (rim, final)", "speed", 5),
      V("at", "a_t", "Tangential acceleration (rim)", "accel", 1),
      V("I", "I", "Moment of inertia", "inertia", 1, { min: 1e-15 }),
      V("tau", "\\tau", "Net torque", "torque", 5),
      V("F", "F", "Force at the rim (perpendicular)", "force", 10),
      V("KE", "K_{\\text{rot}}", "Rotational kinetic energy (final)", "energy", 50, { min: 0 }),
    ];
    const eqs: Eq[] = [
      { tex: "\\omega = \\omega_0 + \\alpha t", vars: ["w", "w0", "al", "t"], f: (x) => [x.w, x.w0 + x.al * x.t] },
      { tex: "\\Delta\\theta = \\omega_0 t + \\tfrac{1}{2}\\alpha t^2", vars: ["th", "w0", "al", "t"], f: (x) => [x.th, x.w0 * x.t + 0.5 * x.al * x.t * x.t] },
      { tex: "\\omega^2 = \\omega_0^2 + 2\\alpha\\,\\Delta\\theta", vars: ["w", "w0", "al", "th"], f: (x) => [x.w * x.w, x.w0 * x.w0 + 2 * x.al * x.th] },
      { tex: "\\Delta\\theta = \\tfrac{1}{2}(\\omega_0 + \\omega)\\,t", vars: ["th", "w0", "w", "t"], f: (x) => [x.th, 0.5 * (x.w0 + x.w) * x.t] },
      { tex: "\\Delta\\theta = 2\\pi N", vars: ["th", "nrev"], f: (x) => [x.th, 2 * Math.PI * x.nrev], name: "One revolution is 2π rad" },
      { tex: `v_t = \\omega ${rod ? "L" : "R"}`, vars: ["vt", "w", "R"], f: (x) => [x.vt, x.w * x.R] },
      { tex: `a_t = \\alpha ${rod ? "L" : "R"}`, vars: ["at", "al", "R"], f: (x) => [x.at, x.al * x.R] },
      { tex: "\\tau = I\\alpha", vars: ["tau", "I", "al"], f: (x) => [x.tau, x.I * x.al], name: "Newton's second law for rotation" },
      { tex: `\\tau = ${rod ? "L" : "R"} F`, vars: ["tau", "R", "F"], f: (x) => [x.tau, x.R * x.F], name: "Torque from a perpendicular force" },
      { tex: "K_{\\text{rot}} = \\tfrac{1}{2} I \\omega^2", vars: ["KE", "I", "w"], f: (x) => [x.KE, 0.5 * x.I * x.w * x.w] },
    ];
    if (shape) {
      vars.push(V("m", "m", "Mass", "mass", 2, { min: 1e-12 }));
      eqs.push({ tex: `I = ${shape.tex}`, vars: ["I", "m", "R"], f: (x) => [x.I, shape.k * x.m * x.R * x.R], name: `Moment of inertia (${shape.label.toLowerCase()})` });
    }
    return { vars, eqs };
  },
};

// ------------------------------------------------------------------ energy

const energy: MotionModel = {
  type: "energy",
  title: "Energy and work",
  variants: [
    { id: "basic", label: "Conservation of energy (no friction)" },
    { id: "friction", label: "With friction (work done by friction)" },
    { id: "spring", label: "With a spring" },
    { id: "friction_spring", label: "With a spring and friction" },
  ],
  build(variant) {
    const friction = variant.includes("friction");
    const spring = variant.includes("spring");
    const vars = [
      V("m", "m", "Mass", "mass", 2, { min: 1e-12 }),
      g(),
      V("h1", "h_1", "Initial height", "length", 10, { default: 0 }),
      V("h2", "h_2", "Final height", "length", 2, { default: 0 }),
      V("v1", "v_1", "Initial speed", "speed", 5, { min: 0 }),
      V("v2", "v_2", "Final speed", "speed", 10, { min: 0 }),
      V("KE1", "K_1", "Initial kinetic energy", "energy", 50, { min: 0 }),
      V("KE2", "K_2", "Final kinetic energy", "energy", 50, { min: 0 }),
      V("PE1", "U_1", "Initial potential energy", "energy", 100),
      V("PE2", "U_2", "Final potential energy", "energy", 50),
      V("Wnc", "W_{nc}", "Work by non-conservative forces", "energy", 20, friction ? {} : { default: 0 }),
    ];
    const eqs: Eq[] = [
      { tex: "K_1 = \\tfrac{1}{2} m v_1^2", vars: ["KE1", "m", "v1"], f: (x) => [x.KE1, 0.5 * x.m * x.v1 * x.v1] },
      { tex: "K_2 = \\tfrac{1}{2} m v_2^2", vars: ["KE2", "m", "v2"], f: (x) => [x.KE2, 0.5 * x.m * x.v2 * x.v2] },
      spring
        ? { tex: "U_1 = m g h_1 + \\tfrac{1}{2} k x_1^2", vars: ["PE1", "m", "g", "h1", "k", "x1"], f: (x) => [x.PE1, x.m * x.g * x.h1 + 0.5 * x.k * x.x1 * x.x1] }
        : { tex: "U_1 = m g h_1", vars: ["PE1", "m", "g", "h1"], f: (x) => [x.PE1, x.m * x.g * x.h1] },
      spring
        ? { tex: "U_2 = m g h_2 + \\tfrac{1}{2} k x_2^2", vars: ["PE2", "m", "g", "h2", "k", "x2"], f: (x) => [x.PE2, x.m * x.g * x.h2 + 0.5 * x.k * x.x2 * x.x2] }
        : { tex: "U_2 = m g h_2", vars: ["PE2", "m", "g", "h2"], f: (x) => [x.PE2, x.m * x.g * x.h2] },
      { tex: "K_1 + U_1 + W_{nc} = K_2 + U_2", vars: ["KE1", "PE1", "Wnc", "KE2", "PE2"], f: (x) => [x.KE1 + x.PE1 + x.Wnc, x.KE2 + x.PE2], name: "Work–energy theorem" },
    ];
    if (!friction && !spring) {
      eqs.push({ tex: "v_2^2 = v_1^2 + 2 g (h_1 - h_2)", vars: ["v2", "v1", "g", "h1", "h2"], f: (x) => [x.v2 * x.v2, x.v1 * x.v1 + 2 * x.g * (x.h1 - x.h2)], name: "Mass cancels when only gravity does work" });
    }
    if (friction) {
      vars.push(V("Ff", "f", "Friction force", "force", 10, { min: 0 }), V("d", "d", "Distance slid with friction", "length", 5, { min: 0 }));
      eqs.push({ tex: "W_{nc} = -f\\,d", vars: ["Wnc", "Ff", "d"], f: (x) => [x.Wnc, -x.Ff * x.d], name: "Friction removes energy" });
    }
    if (spring) {
      vars.push(
        V("k", "k", "Spring constant", "spring", 500, { min: 1e-12 }),
        V("x1", "x_1", "Initial spring compression", "length", 0.2, { default: 0 }),
        V("x2", "x_2", "Final spring compression", "length", 0.2, { default: 0 }),
      );
    }
    return { vars, eqs };
  },
};

// ------------------------------------------------------------------ collisions

const collision: MotionModel = {
  type: "collision",
  title: "Collisions (1D momentum)",
  variants: [
    { id: "elastic", label: "Elastic (kinetic energy conserved)" },
    { id: "inelastic", label: "Perfectly inelastic (stick together)" },
    { id: "general", label: "Partially elastic (restitution e)" },
  ],
  build(variant) {
    const vars = [
      V("m1", "m_1", "Mass 1", "mass", 2, { min: 1e-12 }),
      V("m2", "m_2", "Mass 2", "mass", 2, { min: 1e-12 }),
      V("u1", "u_1", "Velocity of 1 before (right is +)", "speed", 5),
      V("u2", "u_2", "Velocity of 2 before", "speed", -2),
      V("v1", "v_1", "Velocity of 1 after", "speed", 2),
      V("v2", "v_2", "Velocity of 2 after", "speed", 2),
      V("p", "p", "Total momentum", "momentum", 10),
      V("KEi", "K_i", "Kinetic energy before", "energy", 30, { min: 0 }),
      V("KEf", "K_f", "Kinetic energy after", "energy", 20, { min: 0 }),
      V("dKE", "\\Delta K_{\\text{lost}}", "Kinetic energy lost", "energy", 10),
    ];
    const eqs: Eq[] = [
      { tex: "m_1 u_1 + m_2 u_2 = m_1 v_1 + m_2 v_2", vars: ["m1", "u1", "m2", "u2", "v1", "v2"], f: (x) => [x.m1 * x.u1 + x.m2 * x.u2, x.m1 * x.v1 + x.m2 * x.v2], name: "Conservation of momentum" },
      { tex: "p = m_1 u_1 + m_2 u_2", vars: ["p", "m1", "u1", "m2", "u2"], f: (x) => [x.p, x.m1 * x.u1 + x.m2 * x.u2] },
      { tex: "K_i = \\tfrac{1}{2} m_1 u_1^2 + \\tfrac{1}{2} m_2 u_2^2", vars: ["KEi", "m1", "u1", "m2", "u2"], f: (x) => [x.KEi, 0.5 * x.m1 * x.u1 * x.u1 + 0.5 * x.m2 * x.u2 * x.u2] },
      { tex: "K_f = \\tfrac{1}{2} m_1 v_1^2 + \\tfrac{1}{2} m_2 v_2^2", vars: ["KEf", "m1", "v1", "m2", "v2"], f: (x) => [x.KEf, 0.5 * x.m1 * x.v1 * x.v1 + 0.5 * x.m2 * x.v2 * x.v2] },
      { tex: "\\Delta K_{\\text{lost}} = K_i - K_f", vars: ["dKE", "KEi", "KEf"], f: (x) => [x.dKE, x.KEi - x.KEf] },
    ];
    if (variant === "elastic") {
      eqs.push({ tex: "v_2 - v_1 = u_1 - u_2", vars: ["v1", "v2", "u1", "u2"], f: (x) => [x.v2 - x.v1, x.u1 - x.u2], name: "Elastic: the relative velocity reverses" });
    } else if (variant === "inelastic") {
      eqs.push({ tex: "v_1 = v_2", vars: ["v1", "v2"], f: (x) => [x.v1, x.v2], name: "The objects stick together" });
    } else {
      vars.push(V("e", "e", "Coefficient of restitution", "unitless", 0.5, { min: 0, max: 1 }));
      eqs.push({ tex: "v_2 - v_1 = e\\,(u_1 - u_2)", vars: ["v1", "v2", "e", "u1", "u2"], f: (x) => [x.v2 - x.v1, x.e * (x.u1 - x.u2)], name: "Definition of the coefficient of restitution" });
    }
    return { vars, eqs };
  },
};

// ------------------------------------------------------------------ simple harmonic motion

const shm: MotionModel = {
  type: "shm",
  title: "Oscillations (spring, pendulum)",
  variants: [
    { id: "spring", label: "Mass on a spring" },
    { id: "pendulum", label: "Simple pendulum (small angles)" },
  ],
  build(variant) {
    const pend = variant === "pendulum";
    const vars = [
      V("w", "\\omega", "Angular frequency", "angvel", 3, { min: 1e-12 }),
      V("Tp", "T", "Period", "time", 2, { min: 1e-12 }),
      V("fr", "f", "Frequency", "freq", 0.5, { min: 1e-12 }),
      V("A", "A", pend ? "Amplitude (arc length)" : "Amplitude", "length", 0.2, { min: 0 }),
      V("vmax", "v_{\\max}", "Maximum speed", "speed", 1, { min: 0 }),
      V("amax", "a_{\\max}", "Maximum acceleration", "accel", 3, { min: 0 }),
      V("m", "m", "Mass", "mass", 1, { min: 1e-12 }),
      V("E", "E", "Total mechanical energy", "energy", 2, { min: 0 }),
      V("t", "t", "Time after release", "time", 1, { min: 0 }),
      V("xt", "x(t)", "Position at time t", "length", 0.1),
      V("vt", "v(t)", "Velocity at time t", "speed", 0.5),
    ];
    const eqs: Eq[] = [
      { tex: "\\omega = \\dfrac{2\\pi}{T}", vars: ["w", "Tp"], f: (x) => [x.w * x.Tp, 2 * Math.PI] },
      { tex: "f = \\dfrac{1}{T}", vars: ["fr", "Tp"], f: (x) => [x.fr * x.Tp, 1] },
      { tex: "v_{\\max} = A\\omega", vars: ["vmax", "A", "w"], f: (x) => [x.vmax, x.A * x.w] },
      { tex: "a_{\\max} = A\\omega^2", vars: ["amax", "A", "w"], f: (x) => [x.amax, x.A * x.w * x.w] },
      { tex: "E = \\tfrac{1}{2} m v_{\\max}^2", vars: ["E", "m", "vmax"], f: (x) => [x.E, 0.5 * x.m * x.vmax * x.vmax] },
      { tex: "x(t) = A\\cos(\\omega t)", vars: ["xt", "A", "w", "t"], f: (x) => [x.xt, x.A * Math.cos(x.w * x.t)], name: "Released from rest at x = A" },
      { tex: "v(t) = -A\\omega\\sin(\\omega t)", vars: ["vt", "A", "w", "t"], f: (x) => [x.vt, -x.A * x.w * Math.sin(x.w * x.t)] },
    ];
    if (pend) {
      vars.push(
        V("L", "L", "Length", "length", 1, { min: 1e-12 }),
        g(),
        V("th0", "\\theta_0", "Amplitude angle", "angle", 10, { min: 0, max: 90 }),
      );
      eqs.unshift({ tex: "\\omega = \\sqrt{\\dfrac{g}{L}}", vars: ["w", "g", "L"], f: (x) => [x.w * x.w * x.L, x.g], name: "Small-angle pendulum" });
      eqs.push({ tex: "A = L\\,\\theta_0", vars: ["A", "L", "th0"], f: (x) => [x.A, x.L * rad(x.th0)], name: "Arc length (θ₀ in radians)" });
    } else {
      vars.push(V("k", "k", "Spring constant", "spring", 50, { min: 1e-12 }));
      eqs.unshift({ tex: "\\omega = \\sqrt{\\dfrac{k}{m}}", vars: ["w", "k", "m"], f: (x) => [x.w * x.w * x.m, x.k], name: "Mass–spring system" });
      eqs.push({ tex: "E = \\tfrac{1}{2} k A^2", vars: ["E", "k", "A"], f: (x) => [x.E, 0.5 * x.k * x.A * x.A] });
    }
    return { vars, eqs };
  },
};

export const MODELS: MotionModel[] = [kinematics1d, projectile, incline, pulley, circular, rotation, energy, collision, shm];

export function modelOf(type: string): MotionModel | undefined {
  return MODELS.find((m) => m.type === type);
}

/** Every variable key used by any model (for the extraction schema). */
export function allKeys(): string[] {
  const keys = new Set<string>();
  for (const m of MODELS) for (const v of m.variants) for (const d of m.build(v.id).vars) keys.add(d.key);
  return [...keys];
}

export function allVariants(): string[] {
  return [...new Set(MODELS.flatMap((m) => m.variants.map((v) => v.id)))];
}
