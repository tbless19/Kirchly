import { describe, expect, it } from "vitest";
import katex from "katex";
import { EXAMPLES } from "./examples";
import { analyze } from "./solver";
import { buildSteps } from "./explain";
import { partSym, phasor, rect, si } from "./tex";

describe("walkthrough equations", () => {
  for (const ex of EXAMPLES) {
    it(`every equation typesets: ${ex.title}`, () => {
      const c = structuredClone(ex);
      const steps = buildSteps(c, analyze(c));
      const tex = steps.flatMap((s) => s.lines.map((l) => l.tex).filter((t): t is string => !!t));
      expect(tex.length).toBeGreaterThan(3);
      for (const t of tex) expect(() => katex.renderToString(t, { throwOnError: true, strict: "error" }), t).not.toThrow();
    });
  }

  it("formats symbols and values as TeX", () => {
    expect(partSym("R1")).toBe("R_{1}");
    expect(partSym("Vs", true)).toBe("v_{s}");
    expect(partSym("Rload")).toBe("R_{\\mathrm{load}}");
    expect(si(4700, "Ω")).toBe("4.7\\,\\mathrm{k}\\Omega");
    expect(si(1e-6, "F")).toBe("1\\,\\mu \\mathrm{F}");
    expect(rect({ re: 0, im: -26.53 }, "Ω")).toBe("-j26.53\\,\\Omega");
    expect(phasor({ re: 0, im: 2 }, "A")).toBe("2\\,\\mathrm{A}\\angle 90^\\circ");
  });
});
