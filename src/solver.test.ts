import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./examples";
import { analyze, evaluateAskComplex } from "./solver";
import { parseSI, formatSI, parseComplex, formatPhasor, formatRect } from "./format";
import { abs, argDeg } from "./complex";
import type { Circuit } from "./types";

const byTitle = (t: string) => structuredClone(EXAMPLES.find((e) => e.title === t)!);
const none = { ctrl_a: null, ctrl_b: null, ctrl_component: null };

describe("DC solver", () => {
  it("solves a series-parallel divider", () => {
    const c = byTitle("Series–parallel divider");
    const s = analyze(c);
    // R2 || R3 = 1.2k, total 2.2k -> I = 12/2.2k
    expect(s.compI.R1.re).toBeCloseTo(12 / 2200, 9);
    expect(s.compV.R3.re).toBeCloseTo((12 * 1200) / 2200, 9);
    // Source delivers power (negative absorbed).
    expect(s.compS.V1.re).toBeCloseTo(-12 * (12 / 2200), 9);
    // Wire p2->p3 carries R3's current.
    expect(s.wireI[0].re).toBeCloseTo(s.compI.R3.re, 9);
  });

  it("finds an unknown resistor from a given current", () => {
    const c = byTitle("Find the unknown resistor");
    const s = analyze(c);
    expect(s.values.Rx).toBeCloseTo(3000, 4);
    expect(evaluateAskComplex(c, s, c.asks[1]).re).toBeCloseTo(0.002 * 0.002 * 3000, 9);
  });

  it("solves a two-mesh circuit", () => {
    const c = byTitle("Two-source, two-mesh");
    const s = analyze(c);
    // Node N(p2): (V-10)/2 + V/4 + (V-5)/6 = 0 -> 11V = 70
    const v = 70 / 11;
    expect(s.compV.R2.re).toBeCloseTo(v, 9);
    expect(s.compI.R2.re).toBeCloseTo(v / 4, 9);
  });

  it("handles a VCVS", () => {
    const c = byTitle("Dependent source amplifier");
    const s = analyze(c);
    expect(s.compV.R1.re).toBeCloseTo(2, 9);
    expect(s.compV.R2.re).toBeCloseTo(4, 9);
    expect(s.compI.R2.re).toBeCloseTo(0.002, 9);
  });

  it("handles a CCCS and a VCCS", () => {
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
    expect(s.compV.R2.re).toBeCloseTo(3, 9);
    expect(s.compV.R3.re).toBeCloseTo(1.5, 9);
  });

  it("reports a floating circuit instead of returning garbage", () => {
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

/** Series loop: V1 (a+ to g) -> X (a to m) -> Y (m to g). */
function seriesLoop(parts: Circuit["components"], analysis: Circuit["analysis"]): Circuit {
  return {
    title: "",
    points: ["a", "m", "g"].map((id, i) => ({ id, x: i, y: 0 })),
    wires: [],
    components: parts,
    ground: "g",
    givens: [],
    asks: [],
    notes: "",
    analysis,
  };
}

describe("AC solver", () => {
  it("RC low-pass at its corner frequency: |Vc| = V/√2, −45°", () => {
    const R = 1000;
    const C = 1e-6;
    const f = 1 / (2 * Math.PI * R * C);
    const s = analyze(
      seriesLoop(
        [
          { id: "V1", kind: "voltage_source", a: "a", b: "g", value: 10, phase: 0, ...none },
          { id: "R1", kind: "resistor", a: "a", b: "m", value: R, ...none },
          { id: "C1", kind: "capacitor", a: "m", b: "g", value: C, ...none },
        ],
        { mode: "ac", frequency: f, amplitude: "peak" },
      ),
    );
    expect(abs(s.compV.C1)).toBeCloseTo(10 / Math.SQRT2, 9);
    expect(argDeg(s.compV.C1)).toBeCloseTo(-45, 6);
    // Average power with peak phasors: ½|I|²R, and the capacitor absorbs no real power.
    expect(s.compS.R1.re).toBeCloseTo(0.5 * abs(s.compI.R1) ** 2 * R, 9);
    expect(s.compS.C1.re).toBeCloseTo(0, 12);
  });

  it("series RLC at resonance is purely resistive", () => {
    const L = 0.05;
    const C = 100e-6;
    const f = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const c: Circuit = {
      title: "",
      points: ["a", "m1", "m2", "g"].map((id, i) => ({ id, x: i, y: 0 })),
      wires: [],
      components: [
        { id: "V1", kind: "voltage_source", a: "a", b: "g", value: 120, phase: 30, ...none },
        { id: "R1", kind: "resistor", a: "a", b: "m1", value: 10, ...none },
        { id: "L1", kind: "inductor", a: "m1", b: "m2", value: L, ...none },
        { id: "C1", kind: "capacitor", a: "m2", b: "g", value: C, ...none },
      ],
      ground: "g",
      givens: [],
      asks: [],
      notes: "",
      analysis: { mode: "ac", frequency: f, amplitude: "rms" },
    };
    const s = analyze(c);
    expect(abs(s.compI.R1)).toBeCloseTo(12, 6);
    expect(argDeg(s.compI.R1)).toBeCloseTo(30, 6);
    // RMS phasors: P = |V||I| = 1440 W delivered.
    expect(s.compS.V1.re).toBeCloseTo(-1440, 4);
  });

  it("uses impedances given directly (no frequency)", () => {
    // 10∠0 across (3 + j4) Ω: |I| = 2 A at −53.13°
    const s = analyze(
      seriesLoop(
        [
          { id: "V1", kind: "voltage_source", a: "a", b: "g", value: 10, phase: 0, ...none },
          { id: "Z1", kind: "impedance", a: "a", b: "m", value: 3, reactance: 4, ...none },
          { id: "R1", kind: "resistor", a: "m", b: "g", value: 0, ...none },
        ],
        { mode: "ac", frequency: null, amplitude: "peak" },
      ),
    );
    expect(abs(s.compI.Z1)).toBeCloseTo(2, 9);
    expect(argDeg(s.compI.Z1)).toBeCloseTo(-53.1301, 3);
  });

  it("finds an unknown capacitor from a measured current magnitude", () => {
    // 10 V peak, 1 kHz, R = 1k; |I| = 5 mA -> |Z| = 2k -> Xc = √3 k -> C = 1/(ω·√3k)
    const c = seriesLoop(
      [
        { id: "V1", kind: "voltage_source", a: "a", b: "g", value: 10, phase: 0, ...none },
        { id: "R1", kind: "resistor", a: "a", b: "m", value: 1000, ...none },
        { id: "C1", kind: "capacitor", a: "m", b: "g", value: null, ...none },
      ],
      { mode: "ac", frequency: 1000, amplitude: "peak" },
    );
    c.givens.push({ quantity: "component_current", component: "R1", a: null, b: null, value: 0.005 });
    const s = analyze(c);
    expect(s.values.C1).toBeCloseTo(1 / (2 * Math.PI * 1000 * Math.sqrt(3) * 1000), 12);
  });

  it("requires a frequency when capacitors or inductors are present", () => {
    expect(() =>
      analyze(
        seriesLoop(
          [
            { id: "V1", kind: "voltage_source", a: "a", b: "g", value: 1, ...none },
            { id: "R1", kind: "resistor", a: "a", b: "m", value: 1, ...none },
            { id: "C1", kind: "capacitor", a: "m", b: "g", value: 1e-6, ...none },
          ],
          { mode: "ac", frequency: null, amplitude: "peak" },
        ),
      ),
    ).toThrow(/needs a frequency/);
  });

  it("solves the built-in AC examples", () => {
    for (const ex of EXAMPLES.filter((e) => e.analysis?.mode === "ac")) {
      expect(() => analyze(structuredClone(ex)), ex.title).not.toThrow();
    }
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

  it("parses and formats complex values", () => {
    expect(parseComplex("3+j4")).toEqual({ re: 3, im: 4 });
    expect(parseComplex("-j5")).toEqual({ re: 0, im: -5 });
    expect(parseComplex("2k - j1.5k")).toEqual({ re: 2000, im: -1500 });
    expect(parseComplex("10")).toEqual({ re: 10, im: 0 });
    expect(formatRect({ re: 3, im: -4 }, "Ω")).toBe("3 − j4 Ω");
    expect(formatPhasor({ re: 0, im: -2 }, "A")).toBe("2 A ∠ −90.0°");
  });
});
