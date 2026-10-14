// Builds the step-by-step walkthrough played over the animated schematic.

import type { Circuit, Component } from "./types";
import { evaluateAskComplex, evaluateGiven, impedanceOf, type Solution } from "./solver";
import { KIND_LABEL, describeValue, formatDeg, formatPhasor, formatRect, formatSI } from "./format";
import { abs, argDeg, type Complex } from "./complex";

export interface Step {
  title: string;
  lines: { text: string; mono?: boolean }[];
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

export function buildSteps(c: Circuit, sol: Solution): Step[] {
  const topo = sol.topology;
  const nodeOfComp = (k: Component) => [topo.nodeOf.get(k.a)!, topo.nodeOf.get(k.b)!];
  const nn = (n: number) => topo.nodeNames[n];
  const Q = (z: Complex, unit: string, d = 4) => formatQ(sol, z, unit, d);
  const steps: Step[] = [];
  const amp = sol.analysis.amplitude === "rms" ? "RMS" : "peak";

  steps.push({
    title: "Read the circuit",
    lines: [
      { text: `${c.components.length} components and ${topo.nodeCount} electrical nodes${sol.ac ? ", AC (phasor) analysis" : ", DC analysis"}.` },
      ...c.components.map((k) => ({
        text: `${k.id}: ${KIND_LABEL[k.kind]}, ${k.value === null ? "unknown value" : describeValue(k, sol.ac)}`,
      })),
    ],
    highlight: null,
  });

  if (sol.ac) {
    const f = sol.analysis.frequency;
    const lines: Step["lines"] = [];
    if (f) lines.push({ text: `ω = 2πf = 2π × ${formatSI(f, "Hz")} = ${formatSI(sol.omega, "rad/s")}`, mono: true });
    else lines.push({ text: "No frequency is needed: every reactive part is already given as an impedance." });
    for (const k of c.components) {
      if (k.kind === "voltage_source" || k.kind === "current_source") {
        const unit = k.kind === "voltage_source" ? "V" : "A";
        const A = formatSI(sol.values[k.id], unit, 4);
        lines.push({ text: `${k.id}: ${A} cos(ωt ${(k.phase ?? 0) < 0 ? "−" : "+"} ${Math.abs(k.phase ?? 0)}°) → ${A} ∠ ${formatDeg(k.phase ?? 0)}`, mono: true });
      }
    }
    for (const k of c.components) {
      const z = impedanceOf(k, sol);
      if (!z) continue;
      const v = sol.values[k.id];
      if (k.kind === "capacitor") lines.push({ text: `Z(${k.id}) = 1/(jωC) = 1/(j·${formatSI(sol.omega, "", 4).trim()}·${formatSI(v, "F", 3)}) = ${formatRect(z, "Ω")}`, mono: true });
      else if (k.kind === "inductor") lines.push({ text: `Z(${k.id}) = jωL = j·${formatSI(sol.omega, "", 4).trim()}·${formatSI(v, "H", 3)} = ${formatRect(z, "Ω")}`, mono: true });
      else lines.push({ text: `Z(${k.id}) = ${formatRect(z, "Ω")}`, mono: true });
    }
    lines.push({ text: `Magnitudes are ${amp} values; every voltage and current below is a phasor (magnitude ∠ phase).` });
    steps.push({
      title: "Convert to the frequency domain",
      lines,
      highlight: { components: c.components.filter((k) => impedanceOf(k, sol) || k.kind.endsWith("source")).map((k) => k.id), nodes: [] },
    });
  }

  steps.push({
    title: "Choose a reference node",
    lines: [
      { text: `Node ${nn(topo.ground)} is ground: every node voltage is measured relative to it (0 V).` },
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
    const sign = (t: { sign: number }, i: number) => (t.sign < 0 ? (i ? " − " : "−") : i ? " + " : "");
    const sym = terms.map((t, i) => `${sign(t, i)}I(${t.k.id})`).join("");
    const num = terms.map((t, i) => `${sign(t, i)}(${Q(sol.compI[t.k.id], "A", 3)})`).join("");
    const lines: Step["lines"] = [
      {
        text: `Kirchhoff's current law: the ${sol.ac ? "phasor " : ""}currents leaving ${nn(n)} through its components sum to zero.`,
      },
      { text: `${sym} = 0`, mono: true },
    ];
    for (const t of terms) {
      if (!impedanceOf(t.k, sol)) continue;
      const [na, nb] = nodeOfComp(t.k);
      lines.push({ text: `I(${t.k.id}) = (V(${nn(na)}) − V(${nn(nb)})) / Z(${t.k.id})`, mono: true });
    }
    lines.push({ text: `With the solved values: ${num} = 0`, mono: true });
    steps.push({ title: `KCL at node ${nn(n)}`, lines, highlight: { components: terms.map((t) => t.k.id), nodes: [n] } });
  }

  const givenUnit = (q: string) => (q === "component_current" ? "A" : q === "component_power" ? "W" : "V");
  if (sol.solvedUnknowns.length) {
    steps.push({
      title: "Solve for the unknown values",
      lines: [
        { text: sol.ac ? "Using the given magnitudes:" : "Using the given quantities:" },
        ...c.givens.map((g) => ({ text: `${describeQuantity(g, sol.ac)} = ${formatSI(g.value, givenUnit(g.quantity))}`, mono: true })),
        { text: "the solver finds:" },
        ...sol.solvedUnknowns.map((u) => {
          const k = c.components.find((x) => x.id === u.id)!;
          return {
            text: u.field === "reactance" ? `X(${u.id}) = ${formatSI(u.value, "Ω")}` : `${u.id} = ${describeValue({ ...k, value: u.value, reactance: 0 }, false)}`,
            mono: true,
          };
        }),
      ],
      highlight: { components: sol.solvedUnknowns.map((u) => u.id), nodes: [] },
    });
  } else if (c.givens.length) {
    steps.push({
      title: "Check the given quantities",
      lines: c.givens.map((g) => ({
        text: `${describeQuantity(g, sol.ac)}: given ${formatSI(g.value, givenUnit(g.quantity))}, computed ${formatSI(evaluateGiven(c, sol, g), givenUnit(g.quantity))}`,
        mono: true,
      })),
      highlight: null,
    });
  }

  steps.push({
    title: "Node voltages",
    lines: topo.nodeNames.map((name, n) => ({ text: `V(${name}) = ${Q(sol.nodeV[n], "V")}`, mono: true })),
    highlight: { components: [], nodes: [...Array(topo.nodeCount).keys()] },
  });

  for (const k of c.components.slice(0, MAX_COMPONENT_STEPS)) {
    const v = sol.compV[k.id];
    const i = sol.compI[k.id];
    const s = sol.compS[k.id];
    const z = impedanceOf(k, sol);
    const lines: Step["lines"] = [
      { text: `V(${k.id}) = ${Q(v, "V")}`, mono: true },
      { text: `I(${k.id}) = ${Q(i, "A")}`, mono: true },
    ];
    if (z && abs(z) > 0) {
      lines.push({
        text: sol.ac
          ? `Ohm's law: I = V / Z = ${formatPhasor(v, "V", 3)} / ${formatPhasor(z, "Ω", 3)}`
          : `Ohm's law: ${formatSI(v.re, "V", 3)} / ${formatSI(z.re, "Ω", 3)} = ${formatSI(i.re, "A", 3)}`,
        mono: true,
      });
    }
    if (sol.ac) {
      lines.push({ text: `S = ${formatRect(s, "VA", 4)}  (${formatPower(sol, s)})`, mono: true });
      if (abs(i) > 0 && abs(v) > 0) {
        const pf = Math.cos(((argDeg(v) - argDeg(i)) * Math.PI) / 180);
        lines.push({ text: `Phase of V relative to I: ${formatDeg(argDeg(v) - argDeg(i))}, power factor ${pf.toFixed(3)}`, mono: true });
      }
    } else {
      lines.push({ text: `P = V·I = ${formatPower(sol, s)}`, mono: true });
    }
    steps.push({ title: `${k.id} (${KIND_LABEL[k.kind]})`, lines, highlight: { components: [k.id], nodes: [] } });
  }

  const sumPos = (f: (s: Complex) => number) => c.components.reduce((acc, k) => acc + Math.max(0, f(sol.compS[k.id])), 0);
  const sumNeg = (f: (s: Complex) => number) => c.components.reduce((acc, k) => acc + Math.max(0, -f(sol.compS[k.id])), 0);
  const balance: Step["lines"] = [
    { text: `${sol.ac ? "Average power d" : "D"}elivered by sources: ${formatSI(sumNeg((s) => s.re), "W")}`, mono: true },
    { text: `${sol.ac ? "Average power a" : "A"}bsorbed by the rest: ${formatSI(sumPos((s) => s.re), "W")}`, mono: true },
  ];
  if (sol.ac) {
    balance.push({ text: `Reactive power: ${formatSI(sumNeg((s) => s.im), "var")} supplied, ${formatSI(sumPos((s) => s.im), "var")} taken`, mono: true });
    balance.push({ text: "Both real and reactive power balance (Tellegen's theorem)." });
  } else {
    balance.push({ text: "Energy is conserved, so the two match." });
  }
  steps.push({ title: "Power balance", lines: balance, highlight: null });

  if (c.asks.length) {
    steps.push({
      title: "Answers",
      lines: c.asks.map((a) => {
        try {
          return { text: `${a.label}: ${formatAsk(c, sol, a)}`, mono: true };
        } catch (e) {
          return { text: `${a.label}: ${(e as Error).message}` };
        }
      }),
      highlight: { components: c.asks.map((a) => a.component).filter((x): x is string => !!x), nodes: [] },
    });
  }
  return steps;
}

export function formatAsk(c: Circuit, sol: Solution, a: Circuit["asks"][number]): string {
  if (a.quantity === "component_value") {
    const k = c.components.find((x) => x.id === a.component);
    return k ? describeValue(solvedPart(k, sol), sol.ac) : "—";
  }
  const z = evaluateAskComplex(c, sol, a);
  if (a.quantity === "component_power") return formatPower(sol, z);
  return formatQ(sol, z, a.quantity === "component_current" ? "A" : "V");
}

function describeQuantity(g: { quantity: string; component: string | null; a: string | null; b: string | null }, ac: boolean): string {
  const bars = (s: string) => (ac ? `|${s}|` : s);
  switch (g.quantity) {
    case "component_current":
      return bars(`I(${g.component})`);
    case "component_voltage":
      return bars(`V(${g.component})`);
    case "component_power":
      return `P(${g.component})`;
    default:
      return bars(`V(${g.a}, ${g.b})`);
  }
}
