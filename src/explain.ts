// Builds the step-by-step walkthrough played over the animated schematic.

import type { Circuit, Component } from "./types";
import { evaluateAsk, evaluateGiven, type Solution } from "./solver";
import { KIND_LABEL, formatSI, formatValue } from "./format";

export interface Step {
  title: string;
  lines: { text: string; mono?: boolean }[];
  highlight: { components: string[]; nodes: number[] } | null;
}

const MAX_COMPONENT_STEPS = 14;

export function buildSteps(c: Circuit, sol: Solution): Step[] {
  const topo = sol.topology;
  const nodeOfComp = (k: Component) => [topo.nodeOf.get(k.a)!, topo.nodeOf.get(k.b)!];
  const nn = (n: number) => topo.nodeNames[n];
  const V = (n: number) => formatSI(sol.nodeVoltage[n], "V", 4);
  const steps: Step[] = [];

  steps.push({
    title: "Read the circuit",
    lines: [
      { text: `${c.components.length} components and ${topo.nodeCount} electrical nodes.` },
      ...c.components.map((k) => ({
        text: `${k.id}: ${KIND_LABEL[k.kind]}, ${k.value === null ? "unknown value" : formatValue(k.kind, k.value)}`,
      })),
    ],
    highlight: null,
  });

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
    const sym = terms.map((t, i) => `${t.sign < 0 ? (i ? " − " : "−") : i ? " + " : ""}I(${t.k.id})`).join("");
    const num = terms
      .map((t, i) => {
        const v = formatSI(sol.compI[t.k.id], "A", 3);
        return `${t.sign < 0 ? (i ? " − " : "−") : i ? " + " : ""}(${v})`;
      })
      .join("");
    const lines: Step["lines"] = [
      { text: `Kirchhoff's current law: the currents leaving ${nn(n)} through its components sum to zero.` },
      { text: `${sym} = 0`, mono: true },
    ];
    for (const t of terms) {
      if (t.k.kind !== "resistor") continue;
      const [na, nb] = nodeOfComp(t.k);
      lines.push({
        text: `I(${t.k.id}) = (V(${nn(na)}) − V(${nn(nb)})) / ${t.k.id}`,
        mono: true,
      });
    }
    lines.push({ text: `With the solved values: ${num} = 0`, mono: true });
    steps.push({ title: `KCL at node ${nn(n)}`, lines, highlight: { components: terms.map((t) => t.k.id), nodes: [n] } });
  }

  if (sol.solvedUnknowns.length) {
    steps.push({
      title: "Solve for the unknown values",
      lines: [
        { text: "Using the given quantities:" },
        ...c.givens.map((g) => ({ text: `${describeQuantity(g)} = ${formatSI(g.value, unitOf(g.quantity))}`, mono: true })),
        { text: "the solver finds:" },
        ...sol.solvedUnknowns.map((u) => {
          const k = c.components.find((x) => x.id === u.id)!;
          return { text: `${u.id} = ${formatValue(k.kind, u.value)}`, mono: true };
        }),
      ],
      highlight: { components: sol.solvedUnknowns.map((u) => u.id), nodes: [] },
    });
  } else if (c.givens.length) {
    steps.push({
      title: "Check the given quantities",
      lines: c.givens.map((g) => ({
        text: `${describeQuantity(g)}: given ${formatSI(g.value, unitOf(g.quantity))}, computed ${formatSI(evaluateGiven(c, sol, g), unitOf(g.quantity))}`,
        mono: true,
      })),
      highlight: null,
    });
  }

  steps.push({
    title: "Node voltages",
    lines: topo.nodeNames.map((name, n) => ({ text: `V(${name}) = ${V(n)}`, mono: true })),
    highlight: { components: [], nodes: [...Array(topo.nodeCount).keys()] },
  });

  for (const k of c.components.slice(0, MAX_COMPONENT_STEPS)) {
    const v = sol.compV[k.id];
    const i = sol.compI[k.id];
    const p = sol.compP[k.id];
    const lines: Step["lines"] = [
      { text: `V(${k.id}) = ${formatSI(v, "V")}`, mono: true },
      { text: `I(${k.id}) = ${formatSI(i, "A")}`, mono: true },
    ];
    if (k.kind === "resistor") {
      lines.push({ text: `Ohm's law: ${formatSI(v, "V", 3)} / ${formatValue(k.kind, sol.values[k.id])} = ${formatSI(i, "A", 3)}`, mono: true });
    }
    lines.push({
      text: `P = V·I = ${formatSI(Math.abs(p), "W")} ${p >= 0 ? "absorbed" : "delivered"}`,
      mono: true,
    });
    steps.push({ title: `${k.id} (${KIND_LABEL[k.kind]})`, lines, highlight: { components: [k.id], nodes: [] } });
  }

  const delivered = c.components.reduce((s, k) => s + Math.max(0, -sol.compP[k.id]), 0);
  const absorbed = c.components.reduce((s, k) => s + Math.max(0, sol.compP[k.id]), 0);
  steps.push({
    title: "Power balance",
    lines: [
      { text: `Delivered by sources: ${formatSI(delivered, "W")}`, mono: true },
      { text: `Absorbed by the rest: ${formatSI(absorbed, "W")}`, mono: true },
      { text: "Energy is conserved, so the two match." },
    ],
    highlight: null,
  });

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
  const v = evaluateAsk(c, sol, a);
  if (a.quantity === "component_value") {
    const k = c.components.find((x) => x.id === a.component);
    return k ? formatValue(k.kind, v) : String(v);
  }
  if (a.quantity === "component_power") return `${formatSI(Math.abs(v), "W")} ${v >= 0 ? "absorbed" : "delivered"}`;
  return formatSI(v, unitOf(a.quantity));
}

function unitOf(q: string): string {
  if (q === "component_current") return "A";
  if (q === "component_power") return "W";
  return "V";
}

function describeQuantity(g: { quantity: string; component: string | null; a: string | null; b: string | null }): string {
  switch (g.quantity) {
    case "component_current":
      return `I(${g.component})`;
    case "component_voltage":
      return `V(${g.component})`;
    case "component_power":
      return `P(${g.component})`;
    default:
      return `V(${g.a}, ${g.b})`;
  }
}
