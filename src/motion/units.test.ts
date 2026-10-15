import { afterEach, describe, expect, it } from "vitest";
import katex from "katex";
import { formatQuantity, parseQuantity, setUnitSystem, texQuantity, toDisplay } from "./units";
import { solveProblem } from "./solve";
import { buildMotionSteps } from "./explain";
import { MOTION_EXAMPLES } from "./examples";

afterEach(() => setUnitSystem("metric"));

describe("units", () => {
  it("reads bare numbers in the display system", () => {
    expect(parseQuantity("10", "length")).toBeCloseTo(10);
    setUnitSystem("imperial");
    expect(parseQuantity("10", "length")).toBeCloseTo(3.048);
    expect(parseQuantity("1", "force")).toBeCloseTo(4.4482216, 6);
    expect(parseQuantity("35", "angle")).toBe(35); // angles don't change
  });

  it("accepts explicit units in either system", () => {
    expect(parseQuantity("60 mph", "speed")).toBeCloseTo(26.8224, 6);
    expect(parseQuantity("6 in", "length")).toBeCloseTo(0.1524, 6);
    expect(parseQuantity("150 lb", "mass")).toBeCloseTo(68.0389, 3);
    expect(parseQuantity("150 lb", "force")).toBeCloseTo(667.233, 2);
    expect(parseQuantity("2 slug", "mass")).toBeCloseTo(29.1878, 3);
    expect(parseQuantity("100 N", "force")).toBe(100);
    setUnitSystem("imperial");
    expect(parseQuantity("3 m", "length")).toBe(3);
    expect(parseQuantity("2 furlongs", "length")).toBeNaN();
  });

  it("displays SI values in the chosen system", () => {
    expect(formatQuantity(9.8, "accel")).toBe("9.8 m/s²");
    setUnitSystem("imperial");
    expect(formatQuantity(9.8, "accel")).toBe("32.15 ft/s²");
    expect(formatQuantity(1, "mass")).toBe("2.205 lb");
    expect(formatQuantity(100, "energy")).toBe("73.76 ft·lbf");
    expect(formatQuantity(3, "time")).toBe("3 s");
    expect(toDisplay(0.3048, "length")).toBeCloseTo(1, 12);
    expect(texQuantity(4.4482216152605, "force")).toBe("1\\,\\mathrm{lbf}");
  });

  it("the imperial example solves and its walkthrough typesets in feet", () => {
    const ex = MOTION_EXAMPLES.find((e) => e.units === "imperial")!;
    setUnitSystem("imperial");
    const sol = solveProblem(structuredClone(ex));
    // v0 = 80 ft/s at 70° from 4 ft: H = 4 + (80 sin70)²/(2g)
    const g = 9.8 / 0.3048;
    expect(toDisplay(sol.values.H, "length")).toBeCloseTo(4 + (80 * Math.sin((70 * Math.PI) / 180)) ** 2 / (2 * g), 6);
    const tex = buildMotionSteps(ex, sol).flatMap((s) => s.lines.map((l) => l.tex).filter((t): t is string => !!t));
    expect(tex.some((t) => t.includes("\\mathrm{ft}"))).toBe(true);
    for (const t of tex) expect(() => katex.renderToString(t, { throwOnError: true, strict: "error" })).not.toThrow();
  });
});
