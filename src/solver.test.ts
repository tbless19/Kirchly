import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./examples";
import { analyze, evaluateAsk } from "./solver";
import { parseSI, formatSI } from "./format";

const byTitle = (t: string) => EXAMPLES.find((e) => e.title === t)!;

describe("solver", () => {
  it("solves a series-parallel divider", () => {
    const c = byTitle("Series–parallel divider");
    const s = analyze(c);
    // R2 || R3 = 1.2k, total 2.2k -> I = 12/2.2k
    expect(s.compI.R1).toBeCloseTo(12 / 2200, 9);
    expect(s.compV.R3).toBeCloseTo((12 * 1200) / 2200, 9);
    // Source delivers power (negative absorbed).
    expect(s.compP.V1).toBeCloseTo(-12 * (12 / 2200), 9);
    // Wire p2->p3 carries R3's current.
    expect(s.wireI[0]).toBeCloseTo(s.compI.R3, 9);
  });

  it("finds an unknown resistor from a given current", () => {
    const c = byTitle("Find the unknown resistor");
    const s = analyze(c);
    expect(s.values.Rx).toBeCloseTo(3000, 4);
    expect(evaluateAsk(c, s, c.asks[1])).toBeCloseTo(0.002 * 0.002 * 3000, 9);
  });

  it("solves a two-mesh circuit", () => {
    const c = byTitle("Two-source, two-mesh");
    const s = analyze(c);
    // Node N(p2): (V-10)/2 + V/4 + (V-5)/6 = 0 -> 11V = 70
    const v = 70 / 11;
    expect(s.compV.R2).toBeCloseTo(v, 9);
    expect(s.compI.R2).toBeCloseTo(v / 4, 9);
  });

  it("handles a VCVS", () => {
    const c = byTitle("Dependent source amplifier");
    const s = analyze(c);
    expect(s.compV.R1).toBeCloseTo(2, 9);
    expect(s.compV.R2).toBeCloseTo(4, 9);
    expect(s.compI.R2).toBeCloseTo(0.002, 9);
  });

  it("handles a CCCS and a VCCS", () => {
    const none = { ctrl_a: null, ctrl_b: null, ctrl_component: null };
    // V1=10V across R1=1k (I=10mA); F1 = 3*I(R1) into R2=100 -> V(R2) = 3V; G1 = 0.01*V(R2) into R3=50 -> 1.5V
    const s = analyze({
      title: "",
      points: ["a", "b", "c", "d", "g"].map((id, i) => ({ id, x: i, y: 0 })),
      wires: [],
      components: [
        { id: "V1", kind: "voltage_source", a: "a", b: "g", value: 10, ...none },
        { id: "R1", kind: "resistor", a: "a", b: "g", value: 1000, ...none },
        { id: "F1", kind: "cccs", a: "g", b: "b", value: 3, ctrl_a: null, ctrl_b: null, ctrl_component: "R1" },
        { id: "R2", kind: "resistor", a: "b", b: "g", value: 100, ...none },
        { id: "G1", kind: "vccs", a: "g", b: "c", value: 0.01, ctrl_a: "b", ctrl_b: "g", ctrl_component: null },
        { id: "R3", kind: "resistor", a: "c", b: "g", value: 50, ...none },
      ],
      ground: "g",
      givens: [],
      asks: [],
      notes: "",
    });
    expect(s.compV.R2).toBeCloseTo(3, 9);
    expect(s.compV.R3).toBeCloseTo(1.5, 9);
  });

  it("reports a floating circuit instead of returning garbage", () => {
    const none = { ctrl_a: null, ctrl_b: null, ctrl_component: null };
    expect(() =>
      analyze({
        title: "",
        points: ["a", "b", "c", "d"].map((id, i) => ({ id, x: i, y: 0 })),
        wires: [],
        components: [
          { id: "V1", kind: "voltage_source", a: "a", b: "b", value: 1, ...none },
          { id: "R1", kind: "resistor", a: "a", b: "b", value: 1, ...none },
          { id: "R2", kind: "resistor", a: "c", b: "d", value: 1, ...none },
        ],
        ground: "b",
        givens: [],
        asks: [],
        notes: "",
      }),
    ).toThrow(/no unique solution/);
  });
});

describe("format", () => {
  it("parses and formats SI values", () => {
    expect(parseSI("4.7k")).toBeCloseTo(4700);
    expect(parseSI("2 mA")).toBeCloseTo(0.002);
    expect(parseSI("1meg")).toBeCloseTo(1e6);
    expect(parseSI("?")).toBeNull();
    expect(formatSI(0.0012, "A")).toBe("1.2 mA");
    expect(formatSI(4700, "Ω")).toBe("4.7 kΩ");
  });
});
