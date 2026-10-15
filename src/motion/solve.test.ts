import { describe, expect, it } from "vitest";
import { solveProblem, type Problem } from "./solve";
import type { MotionType } from "./models";

const solve = (type: MotionType, variant: string, values: Problem["values"]) =>
  solveProblem({ title: "", type, variant, values, asks: [], notes: "" });

describe("1D kinematics", () => {
  it("car braking to a stop", () => {
    const s = solve("kinematics_1d", "horizontal", { v0: 20, v: 0, a: -5 });
    expect(s.values.d).toBeCloseTo(40, 6);
    expect(s.values.t).toBeCloseTo(4, 6);
  });
  it("dropped from 45 m", () => {
    const s = solve("kinematics_1d", "free_fall", { v0: 0, d: -45 });
    expect(s.values.t).toBeCloseTo(Math.sqrt(90 / 9.8), 6);
    expect(s.values.v).toBeCloseTo(-Math.sqrt(2 * 9.8 * 45), 6);
  });
  it("thrown up: time to come back to the start is the non-zero root", () => {
    const s = solve("kinematics_1d", "free_fall", { v0: 15, d: 0, t: null });
    // d = v0 t − ½ g t² = 0 has roots 0 and 2v0/g; the solver goes via v first.
    expect(s.values.v).toBeCloseTo(-15, 6);
    expect(s.values.t).toBeCloseTo(30 / 9.8, 6);
  });
});

describe("projectiles", () => {
  it("from the ground at 30°", () => {
    const s = solve("projectile", "standard", { v0: 20, theta: 30 });
    expect(s.values.t).toBeCloseTo((2 * 20 * 0.5) / 9.8, 6);
    expect(s.values.R).toBeCloseTo((400 * Math.sin(Math.PI / 3)) / 9.8, 5);
    expect(s.values.H).toBeCloseTo(100 / (2 * 9.8), 6);
  });
  it("horizontal launch off a 20 m cliff", () => {
    const s = solve("projectile", "standard", { v0: 15, theta: 0, h0: 20 });
    expect(s.values.t).toBeCloseTo(Math.sqrt(40 / 9.8), 6);
    expect(s.values.R).toBeCloseTo(15 * Math.sqrt(40 / 9.8), 5);
  });
  it("launch speed from range at 45°", () => {
    const s = solve("projectile", "standard", { R: 50, theta: 45, v0: null });
    expect(s.values.v0).toBeCloseTo(Math.sqrt(50 * 9.8), 4);
  });
  it("angle from range: lower angle, with the complementary one noted", () => {
    const s = solve("projectile", "standard", { v0: 20, R: 30, theta: null });
    const low = (Math.asin((30 * 9.8) / 400) * 180) / Math.PI / 2;
    expect(s.values.theta).toBeCloseTo(low, 3);
  });
});

describe("forces", () => {
  it("block sliding down a rough incline", () => {
    const s = solve("incline", "down", { m: 10, theta: 30, mu: 0.2, v0: 0, d: 5 });
    const a = 9.8 * (0.5 - 0.2 * Math.cos(Math.PI / 6));
    expect(s.values.a).toBeCloseTo(a, 6);
    expect(s.values.t).toBeCloseTo(Math.sqrt(10 / a), 6);
    expect(s.values.N).toBeCloseTo(98 * Math.cos(Math.PI / 6), 6);
  });
  it("Atwood machine", () => {
    const s = solve("pulley", "atwood", { m1: 2, m2: 3 });
    expect(s.values.a).toBeCloseTo(1.96, 6);
    expect(s.values.Ft).toBeCloseTo(23.52, 6);
  });
  it("block on a rough table pulled by a hanging mass", () => {
    const s = solve("pulley", "table", { m1: 4, m2: 2, mu: 0.25 });
    expect(s.values.a).toBeCloseTo(9.8 / 6, 6);
    expect(s.values.Ft).toBeCloseTo(2 * (9.8 - 9.8 / 6), 6);
  });
});

describe("circular motion", () => {
  it("flat curve and banked curve", () => {
    expect(solve("circular", "flat_curve", { v: 20, r: 50 }).values.mu).toBeCloseTo(400 / 490, 6);
    expect(solve("circular", "banked", { v: 20, r: 50 }).values.theta).toBeCloseTo((Math.atan(400 / 490) * 180) / Math.PI, 4);
  });
  it("minimum speed at the top of a vertical loop", () => {
    expect(solve("circular", "vertical_top", { r: 2, Ft: 0, m: 1 }).values.v).toBeCloseTo(Math.sqrt(19.6), 6);
  });
  it("ISS orbit", () => {
    const s = solve("circular", "orbit", { M: 5.972e24, r: 6.771e6 });
    expect(s.values.v).toBeCloseTo(Math.sqrt((6.674e-11 * 5.972e24) / 6.771e6), 1);
    expect(s.values.Tp / 60).toBeCloseTo(92.4, 0);
  });
});

describe("rotation", () => {
  it("wheel spinning up from rest", () => {
    const s = solve("rotation", "solid_disk", { w0: 0, al: 2, t: 5 });
    expect(s.values.w).toBeCloseTo(10, 6);
    expect(s.values.th).toBeCloseTo(25, 6);
    expect(s.values.nrev).toBeCloseTo(25 / (2 * Math.PI), 6);
  });
  it("torque on a solid disk", () => {
    const s = solve("rotation", "solid_disk", { m: 2, R: 0.5, tau: 1 });
    expect(s.values.I).toBeCloseTo(0.25, 9);
    expect(s.values.al).toBeCloseTo(4, 9);
    expect(s.values.F).toBeCloseTo(2, 9);
  });
});

describe("energy", () => {
  it("free drop without a mass", () => {
    expect(solve("energy", "basic", { h1: 10, v1: 0, h2: 0 }).values.v2).toBeCloseTo(14, 6);
  });
  it("spring launcher", () => {
    expect(solve("energy", "spring", { m: 0.5, k: 200, x1: 0.1, v1: 0, h1: 0, h2: 0 }).values.v2).toBeCloseTo(2, 6);
  });
  it("sliding down with friction", () => {
    expect(solve("energy", "friction", { m: 2, h1: 5, v1: 0, h2: 0, Ff: 4, d: 10 }).values.v2).toBeCloseTo(Math.sqrt(58), 6);
  });
});

describe("collisions", () => {
  it("elastic, equal masses swap velocities", () => {
    const s = solve("collision", "elastic", { m1: 1, m2: 1, u1: 5, u2: 0 });
    expect(s.values.v1).toBeCloseTo(0, 6);
    expect(s.values.v2).toBeCloseTo(5, 6);
    expect(s.values.dKE).toBeCloseTo(0, 6);
  });
  it("perfectly inelastic", () => {
    const s = solve("collision", "inelastic", { m1: 2, m2: 1, u1: 3, u2: 0 });
    expect(s.values.v1).toBeCloseTo(2, 6);
    expect(s.values.dKE).toBeCloseTo(3, 6);
  });
});

describe("oscillations", () => {
  it("mass on a spring", () => {
    const s = solve("shm", "spring", { k: 200, m: 0.5, A: 0.1 });
    expect(s.values.w).toBeCloseTo(20, 6);
    expect(s.values.Tp).toBeCloseTo(Math.PI / 10, 6);
    expect(s.values.vmax).toBeCloseTo(2, 6);
  });
  it("pendulum period", () => {
    expect(solve("shm", "pendulum", { L: 1 }).values.Tp).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 9.8), 6);
  });
});

describe("solver behaviour", () => {
  it("flags inconsistent givens", () => {
    const s = solve("kinematics_1d", "horizontal", { v0: 0, v: 10, a: 2, t: 3 });
    expect(s.warnings.join(" ")).toMatch(/don't all agree/);
  });
  it("reports what it can't determine", () => {
    const s = solve("kinematics_1d", "horizontal", { v0: 3 });
    expect(s.unsolved).toEqual(expect.arrayContaining(["v", "a", "t", "d"]));
  });
});

import { MOTION_EXAMPLES } from "./examples";
import { buildMotionSteps } from "./explain";
import { MOTION_PROMPT } from "./extract";
import katex from "katex";

describe("motion examples", () => {
  for (const ex of MOTION_EXAMPLES) {
    it(`answers every question and typesets: ${ex.title}`, () => {
      const s = solveProblem(structuredClone(ex));
      for (const a of ex.asks) expect(s.values[a.key], `${a.label}`).toBeTypeOf("number");
      expect(s.warnings).toEqual([]);
      const steps = buildMotionSteps(ex, s);
      for (const st of steps) for (const l of st.lines) if (l.tex) expect(() => katex.renderToString(l.tex!, { throwOnError: true, strict: "error" }), l.tex).not.toThrow();
    });
  }
  it("builds the extraction prompt from the models", () => {
    expect(MOTION_PROMPT).toContain('type "projectile"');
    expect(MOTION_PROMPT).toContain("theta: Launch angle above horizontal [degrees]");
  });
});
