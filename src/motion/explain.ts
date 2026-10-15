// Walkthrough for motion problems, built from the solver's recorded steps.

import type { Step, StepLine } from "../explain";
import { modelOf, type VarDef } from "./models";
import type { MotionSolution, Problem } from "./solve";
import { formatQuantity, texQuantity } from "./units";

const eqTex = (d: VarDef, v: number) => `${d.tex} = ${texQuantity(v, d.dim)}`;

export function buildMotionSteps(p: Problem, sol: MotionSolution): Step[] {
  const model = modelOf(p.type)!;
  const variant = model.variants.find((v) => v.id === p.variant) ?? model.variants[0];
  const def = (k: string) => sol.defs.get(k)!;
  const steps: Step[] = [];

  const givenLines: StepLine[] = [...sol.given].map((k) => ({ text: `${def(k).label}: `, tex: eqTex(def(k), sol.values[k]) }));
  const assumed = sol.steps.filter((s) => s.kind === "assume");
  steps.push({
    title: "What we know",
    lines: [
      { text: `${model.title}: ${variant.label.toLowerCase()}.` },
      ...givenLines,
      ...assumed.map((s) => ({ text: `Assumed (not stated): ${def(s.key).label.toLowerCase()} `, tex: eqTex(def(s.key), s.value) })),
      ...(p.asks.length ? [{ text: `Find: ${p.asks.map((a) => a.label).join("; ")}.` }] : []),
    ],
    highlight: null,
  });

  steps.push({
    title: "The physics",
    lines: [
      { text: "These equations describe the situation:" },
      ...sol.spec.eqs.map((e) => (e.name ? { text: `${e.name}: `, tex: e.tex } : { tex: e.tex })),
    ],
    highlight: null,
  });

  for (const s of sol.steps) {
    if (s.kind === "single") {
      const d = def(s.key);
      const used = s.eq.vars.filter((k) => k !== s.key);
      const lines: StepLine[] = [];
      if (s.eq.name) lines.push({ text: `${s.eq.name}:` });
      lines.push({ tex: s.eq.tex });
      if (used.length) lines.push({ text: "Substitute ", tex: used.map((k) => eqTex(def(k), sol.values[k])).join(",\\quad ") });
      lines.push({ text: `and solve for ${d.label.toLowerCase()}: `, tex: eqTex(d, s.value) });
      if (s.others.length) {
        const alt = s.others.map((o) => formatQuantity(o, d.dim)).join(", ");
        lines.push({
          text: `The equation also allows ${alt}. ${d.prefer === "largest" ? "We take the later/larger one, which is the physical answer here." : "We take the first non-negative one; check which fits the question."}`,
        });
      }
      steps.push({ title: `Find ${d.label.toLowerCase()}`, lines, highlight: null });
    } else if (s.kind === "system") {
      const names = s.keys.map((k) => def(k).label.toLowerCase());
      steps.push({
        title: `Solve for ${names.join(" and ")} together`,
        lines: [
          { text: `No single equation has just one unknown, so solve these ${s.eqs.length} simultaneously:` },
          ...s.eqs.map((e) => ({ tex: e.tex })),
          { text: "giving" },
          ...s.keys.map((k, i) => ({ tex: eqTex(def(k), s.values[i]) })),
        ],
        highlight: null,
      });
    }
  }

  if (sol.warnings.length) {
    steps.push({ title: "Check", lines: sol.warnings.map((w) => ({ text: w })), highlight: null });
  }

  if (p.asks.length) {
    steps.push({
      title: "Answers",
      lines: p.asks.map((a) => {
        const d = sol.defs.get(a.key);
        if (!d) return { text: `${a.label}: not part of this model.` };
        const v = sol.values[a.key];
        return v === undefined ? { text: `${a.label}: not enough information.` } : { text: `${a.label}: `, tex: eqTex(d, v) };
      }),
      highlight: null,
    });
  }
  return steps;
}
