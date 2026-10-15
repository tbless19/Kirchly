// Builds the step-by-step walkthrough played over the animated schematic.
// Prose lines are plain text; equations are TeX, typeset with KaTeX when shown.

import type { Circuit, Component } from "./types";
import { evaluateAskComplex, evaluateGiven, impedanceOf, type Solution } from "./solver";
import { KIND_LABEL, describeValue, formatPhasor, formatSI, unitFor } from "./format";
import { abs, argDeg, polar, type Complex } from "./complex";
import * as T from "./tex";

export interface StepLine {
  /** Prose, shown as plain text. */
  text?: string;
  /** An equation in TeX, typeset after the prose (if any). */
  tex?: string;
}

export interface Step {
  title: string;
  lines: StepLine[];
  highlight: { components: string[]; nodes: number[] } | null;
}

const MAX_COMPONENT_STEPS = 14;

/** A voltage/current as text: signed real in DC, polar phasor in AC. */
export function formatQ(sol: Solution, z: Complex, unit: string, digits = 4): string {
  return sol.ac ? formatPhasor(z, unit, digits) : formatSI(z.re, unit, digits);
}

/** Power as text, with its direction spelled out: "x W absorbed"; in AC also "y var delivered". */
export function formatPower(sol: Solution, s: Complex): string {
  const dir = (v: number) => (v >= 0 ? "absorbed" : "delivered");
  const p = `${formatSI(Math.abs(s.re), "W")} ${dir(s.re)}`;
  if (!sol.ac) return p;
  if (Math.abs(s.im) < 1e-12 * Math.max(1, Math.abs(s.re))) return `${p}, no reactive power`;
  return `${p}, ${formatSI(Math.abs(s.im), "var")} ${dir(s.im)}`;
}

/** The part as it is after solving (unknowns filled in). */
function solvedPart(k: Component, sol: Solution): Component {
  return { ...k, value: sol.values[k.id], reactance: k.kind === "impedance" ? sol.reactances[k.id] : k.reactance };
}

const isIndependentSource = (k: Component) => k.kind === "voltage_source" || k.kind === "current_source";

/** A part's value in TeX: "1\,k\Omega", "3 + j4\,\Omega", "120\,V\angle 30°". */
function partValueTex(k: Component, sol: Solution): string {
  const v = sol.values[k.id];
  if (k.kind === "impedance") return T.rect({ re: v, im: sol.ac ? sol.reactances[k.id] : 0 }, "Ω");
  if (sol.ac && isIndependentSource(k)) return T.phasor(polar(v, k.phase ?? 0), unitFor(k.kind));
  const u = unitFor(k.kind);
  return u.includes("/") ? `${Number(v.toPrecision(4))}\\,\\mathrm{${u}}` : T.si(v, u);
}

export function buildSteps(c: Circuit, sol: Solution): Step[] {
  const topo = sol.topology;
  const ac = sol.ac;
  const nodeOfComp = (k: Component) => [topo.nodeOf.get(k.a)!, topo.nodeOf.get(k.b)!];
  const nn = (n: number) => topo.nodeNames[n];
  const I = (id: string) => T.q("I", id);
  const V = (id: string) => T.q("V", id);
  const Vn = (n: number) => T.q("V", nn(n));
  const val = (z: Complex, unit: string, d = 4) => T.value(z, unit, ac, d);
  /** The "law" symbol for a passive part: R_1 in DC, Z_{R_1} in AC (Z_2 for an impedance named Z2). */
  const zSym = (k: Component) => (ac && k.kind !== "impedance" ? `Z_{${T.partSym(k.id)}}` : T.partSym(k.id));
  const steps: Step[] = [];

  steps.push({
    title: "Read the circuit",
    lines: [
      { text: `${c.components.length} components and ${topo.nodeCount} electrical nodes, ${ac ? "AC (phasor)" : "DC"} analysis.` },
      ...c.components.map((k) => ({
        text: `${KIND_LABEL[k.kind]}: `,
        tex: k.value === null || (k.kind === "impedance" && k.reactance === null) ? `${T.partSym(k.id)} = \\;?` : `${T.partSym(k.id)} = ${partValueTex(k, sol)}`,
      })),
    ],
    highlight: null,
  });

  if (ac) {
    const f = sol.analysis.frequency;
    const lines: StepLine[] = [];
    if (f) lines.push({ text: "Angular frequency: ", tex: `\\omega = 2\\pi f = 2\\pi\\,(${T.si(f, "Hz")}) = ${T.si(sol.omega, "rad/s")}` });
    else lines.push({ text: "No frequency is needed: every reactive part is already given as an impedance." });
    lines.push({ text: `Sources become phasors (${sol.analysis.amplitude === "rms" ? "RMS" : "peak"} magnitudes):` });
    for (const k of c.components.filter(isIndependentSource)) {
      const u = unitFor(k.kind);
      const A = T.num(sol.values[k.id]);
      const ph = k.phase ?? 0;
      const tf = `${A}\\cos(\\omega t ${ph < 0 ? "-" : "+"} ${T.deg(Math.abs(ph))})\\,\\mathrm{${u}}`;
      lines.push({ tex: `${T.partSym(k.id, true)}(t) = ${tf} \\;\\longrightarrow\\; ${T.partSym(k.id)} = ${T.phasor(polar(sol.values[k.id], ph), u)}` });
    }
    const reactive = c.components.filter((k) => impedanceOf(k, sol) && k.kind !== "resistor");
    if (reactive.length) lines.push({ text: "Each part becomes an impedance:" });
    for (const k of reactive) {
      const z = impedanceOf(k, sol)!;
      const s = T.partSym(k.id);
      const v = sol.values[k.id];
      const w = T.num(sol.omega);
      if (k.kind === "capacitor") {
        lines.push({ tex: `Z_{${s}} = \\dfrac{1}{j\\omega ${s}} = \\dfrac{1}{j\\,(${w})(${T.si(v, "F", 3)})} = ${T.rect(z, "Ω")}` });
      } else if (k.kind === "inductor") {
        lines.push({ tex: `Z_{${s}} = j\\omega ${s} = j\\,(${w})(${T.si(v, "H", 3)}) = ${T.rect(z, "Ω")}` });
      } else {
        lines.push({ tex: `${s} = ${T.rect(z, "Ω")} = ${T.phasor(z, "Ω")}` });
      }
    }
    steps.push({
      title: "Convert to the frequency domain",
      lines,
      highlight: { components: c.components.filter((k) => impedanceOf(k, sol) || isIndependentSource(k)).map((k) => k.id), nodes: [] },
    });
  }

  steps.push({
    title: "Choose a reference node",
    lines: [
      { text: `Node ${nn(topo.ground)} is ground; every node voltage is measured relative to it:`, tex: `${Vn(topo.ground)} = 0` },
      { text: "Each remaining node gets an unknown voltage, and each component an unknown current." },
    ],
    highlight: { components: [], nodes: [topo.ground] },
  });

  // KCL at every non-ground node.
  for (let n = 0; n < topo.nodeCount; n++) {
    if (n === topo.ground) continue;
    const terms: { k: Component; sign: number }[] = [];
    for (const k of c.components) {
      const [na, nb] = nodeOfComp(k);
      if (na === nb) continue;
      if (na === n) terms.push({ k, sign: 1 });
      if (nb === n) terms.push({ k, sign: -1 });
    }
    if (terms.length === 0) continue;
    const join = (parts: string[]) =>
      parts.map((p, i) => (terms[i].sign < 0 ? (i ? ` - ${p}` : `-${p}`) : i ? ` + ${p}` : p)).join("");
    const lines: StepLine[] = [
      { text: `Kirchhoff's current law: the ${ac ? "phasor " : ""}currents leaving ${nn(n)} sum to zero.` },
      { tex: `${join(terms.map((t) => I(t.k.id)))} = 0` },
    ];
    for (const t of terms) {
      if (!impedanceOf(t.k, sol)) continue;
      const [na, nb] = nodeOfComp(t.k);
      lines.push({ tex: `${I(t.k.id)} = \\dfrac{${Vn(na)} - ${Vn(nb)}}{${zSym(t.k)}}` });
    }
    lines.push({ text: "With the solved values:" });
    lines.push({ tex: `${join(terms.map((t) => `(${val(sol.compI[t.k.id], "A", 3)})`))} = 0` });
    steps.push({ title: `KCL at node ${nn(n)}`, lines, highlight: { components: terms.map((t) => t.k.id), nodes: [n] } });
  }

  const givenUnit = (qk: string) => (qk === "component_current" ? "A" : qk === "component_power" ? "W" : "V");
  if (sol.solvedUnknowns.length) {
    steps.push({
      title: "Solve for the unknown values",
      lines: [
        { text: ac ? "The given magnitudes:" : "The given quantities:" },
        ...c.givens.map((g) => ({ tex: `${quantityTex(g, ac)} = ${T.si(g.value, givenUnit(g.quantity))}` })),
        { text: "fix the unknowns:" },
        ...sol.solvedUnknowns.map((u) => {
          const k = c.components.find((x) => x.id === u.id)!;
          return {
            tex:
              u.field === "reactance"
                ? `X_{${T.partSym(u.id)}} = ${T.si(u.value, "Ω")}`
                : `${T.partSym(u.id)} = ${k.kind === "impedance" ? T.si(u.value, "Ω") : T.si(u.value, unitFor(k.kind))}`,
          };
        }),
      ],
      highlight: { components: sol.solvedUnknowns.map((u) => u.id), nodes: [] },
    });
  } else if (c.givens.length) {
    steps.push({
      title: "Check the given quantities",
      lines: c.givens.map((g) => ({
        text: "Given and computed: ",
        tex: `${quantityTex(g, ac)} = ${T.si(g.value, givenUnit(g.quantity))} \\;\\text{vs.}\\; ${T.si(evaluateGiven(c, sol, g), givenUnit(g.quantity))}`,
      })),
      highlight: null,
    });
  }

  steps.push({
    title: "Node voltages",
    lines: topo.nodeNames.map((_, n) => ({ tex: `${Vn(n)} = ${val(sol.nodeV[n], "V")}` })),
    highlight: { components: [], nodes: [...Array(topo.nodeCount).keys()] },
  });

  for (const k of c.components.slice(0, MAX_COMPONENT_STEPS)) {
    const v = sol.compV[k.id];
    const i = sol.compI[k.id];
    const s = sol.compS[k.id];
    const z = impedanceOf(k, sol);
    const lines: StepLine[] = [{ tex: `${V(k.id)} = ${val(v, "V")}, \\qquad ${I(k.id)} = ${val(i, "A")}` }];
    if (z && abs(z) > 0) {
      lines.push({
        text: "Ohm's law: ",
        tex: ac
          ? `${I(k.id)} = \\dfrac{${V(k.id)}}{${zSym(k)}} = \\dfrac{${T.phasor(v, "V", 3)}}{${T.phasor(z, "Ω", 3)}} = ${T.phasor(i, "A", 3)}`
          : `${I(k.id)} = \\dfrac{${V(k.id)}}{${T.partSym(k.id)}} = \\dfrac{${T.si(v.re, "V", 3)}}{${T.si(z.re, "Ω", 3)}} = ${T.si(i.re, "A", 3)}`,
      });
    }
    if (ac) {
      const half = sol.analysis.amplitude === "peak" ? "\\tfrac{1}{2}\\," : "";
      lines.push({ text: "Complex power: ", tex: `${T.q("S", k.id)} = ${half}${V(k.id)}\\,${I(k.id)}^{*} = ${T.rect(s, "VA")}` });
      lines.push({ text: `→ ${formatPower(sol, s)}` });
      if (abs(i) > 0 && abs(v) > 0) {
        const th = argDeg(v) - argDeg(i);
        lines.push({ text: "Power factor: ", tex: `\\cos(\\theta_v - \\theta_i) = \\cos(${T.deg(th)}) = ${Math.cos((th * Math.PI) / 180).toFixed(3)}` });
      }
    } else {
      lines.push({ text: "Power: ", tex: `${T.q("P", k.id)} = ${V(k.id)}\\,${I(k.id)} = ${T.si(s.re, "W")}` });
      lines.push({ text: `→ ${formatPower(sol, s)}` });
    }
    steps.push({ title: `${k.id} (${KIND_LABEL[k.kind]})`, lines, highlight: { components: [k.id], nodes: [] } });
  }

  const sumNeg = (f: (s: Complex) => number) => c.components.reduce((acc, k) => acc + Math.max(0, -f(sol.compS[k.id])), 0);
  const balance: StepLine[] = [
    { tex: `\\sum P_{\\text{delivered}} = ${T.si(sumNeg((s) => s.re), "W")} = \\sum P_{\\text{absorbed}}` },
  ];
  if (ac) {
    balance.push({ tex: `\\sum Q_{\\text{delivered}} = ${T.si(sumNeg((s) => s.im), "var")} = \\sum Q_{\\text{absorbed}}` });
    balance.push({ text: "Both real and reactive power balance (Tellegen's theorem)." });
  } else {
    balance.push({ text: "Energy is conserved, so what the sources deliver, the rest absorbs." });
  }
  steps.push({ title: "Power balance", lines: balance, highlight: null });

  if (c.asks.length) {
    steps.push({
      title: "Answers",
      lines: c.asks.map((a) => {
        try {
          return { text: `${a.label}: `, tex: askTex(c, sol, a) };
        } catch (e) {
          return { text: `${a.label}: ${(e as Error).message}` };
        }
      }),
      highlight: { components: c.asks.map((a) => a.component).filter((x): x is string => !!x), nodes: [] },
    });
  }
  return steps;
}

/** Answer as a TeX equation. */
function askTex(c: Circuit, sol: Solution, a: Circuit["asks"][number]): string {
  const id = a.component ?? "";
  if (a.quantity === "component_value") {
    const k = c.components.find((x) => x.id === id);
    return k ? `${T.partSym(k.id)} = ${partValueTex(k, sol)}` : "?";
  }
  const z = evaluateAskComplex(c, sol, a);
  if (a.quantity === "component_power") {
    return sol.ac ? `${T.q("S", id)} = ${T.rect(z, "VA")}` : `${T.q("P", id)} = ${T.si(z.re, "W")}`;
  }
  if (a.quantity === "voltage_between") return `${T.q2("V", a.a ?? "", a.b ?? "")} = ${T.value(z, "V", sol.ac)}`;
  return `${a.quantity === "component_current" ? T.q("I", id) : T.q("V", id)} = ${T.value(z, a.quantity === "component_current" ? "A" : "V", sol.ac)}`;
}

/** Plain-text answer for the Answers panel. */
export function formatAsk(c: Circuit, sol: Solution, a: Circuit["asks"][number]): string {
  if (a.quantity === "component_value") {
    const k = c.components.find((x) => x.id === a.component);
    return k ? describeValue(solvedPart(k, sol), sol.ac) : "—";
  }
  const z = evaluateAskComplex(c, sol, a);
  if (a.quantity === "component_power") return formatPower(sol, z);
  return formatQ(sol, z, a.quantity === "component_current" ? "A" : "V");
}

function quantityTex(g: { quantity: string; component: string | null; a: string | null; b: string | null }, ac: boolean): string {
  const bars = (s: string) => (ac ? `\\lvert ${s} \\rvert` : s);
  const id = g.component ?? "";
  switch (g.quantity) {
    case "component_current":
      return bars(T.q("I", id));
    case "component_voltage":
      return bars(T.q("V", id));
    case "component_power":
      return T.q("P", id);
    default:
      return bars(T.q2("V", g.a ?? "", g.b ?? ""));
  }
}
