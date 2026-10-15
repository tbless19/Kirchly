// Motion mode: the problem editor (type, situation, variables), solving, answers and the animation.

import katex from "katex";
import type { Step } from "../explain";
import { MODELS, modelOf, type MotionType } from "./models";
import { solveProblem, MotionError, type MotionSolution, type Problem } from "./solve";
import { buildMotionSteps } from "./explain";
import { buildScene } from "./scenes";
import { MotionView } from "./view";
import { formatQuantity, formatNumber, parseQuantity, unitOf } from "./units";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Editable text for a number: plain when moderate, e-notation when huge or tiny (5.972e24). */
function inputText(v: number): string {
  const a = Math.abs(v);
  if (a === 0 || (a >= 1e-3 && a < 1e6)) return String(Number(v.toPrecision(6)));
  return v.toExponential(4).replace("e+", "e");
}

export interface MotionDeps {
  setSteps(steps: Step[]): void;
  /** Called after every change, e.g. to keep undo snapshots; optional. */
  onChange?(): void;
}

export interface MotionUI {
  load(p: Problem): void;
  /** Re-renders the shared panels (answers, notes, walkthrough) for motion mode. */
  refresh(): void;
  current(): Problem | null;
}

export function initMotion(deps: MotionDeps): MotionUI {
  let problem: Problem | null = null;
  let solution: MotionSolution | null = null;

  const view = new MotionView(
    $<HTMLElement>("motion-svg") as unknown as SVGSVGElement,
    $<HTMLElement>("graphs-svg") as unknown as SVGSVGElement,
    $("m-readout"),
  );
  const typeSel = $<HTMLSelectElement>("m-type");
  const variantSel = $<HTMLSelectElement>("m-variant");
  const playBtn = $<HTMLButtonElement>("m-play");
  const timeSlider = $<HTMLInputElement>("m-time");
  const clock = $("m-clock");

  for (const m of MODELS) {
    const o = document.createElement("option");
    o.value = m.type;
    o.textContent = m.title;
    typeSel.appendChild(o);
  }

  function fillVariants() {
    const model = modelOf(problem!.type)!;
    variantSel.replaceChildren();
    for (const v of model.variants) {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.label;
      o.selected = v.id === problem!.variant;
      variantSel.appendChild(o);
    }
    variantSel.disabled = model.variants.length < 2;
  }

  typeSel.addEventListener("change", () => {
    if (!problem) return;
    const model = modelOf(typeSel.value)!;
    // Keep any values whose keys exist in the new model.
    const keys = new Set(model.variants.flatMap((v) => model.build(v.id).vars.map((d) => d.key)));
    problem = {
      ...problem,
      type: model.type as MotionType,
      variant: model.variants[0].id,
      values: Object.fromEntries(Object.entries(problem.values).filter(([k]) => keys.has(k))),
      asks: problem.asks.filter((a) => keys.has(a.key)),
    };
    fillVariants();
    update(true);
  });
  variantSel.addEventListener("change", () => {
    if (!problem) return;
    problem.variant = variantSel.value;
    update(true);
  });

  playBtn.addEventListener("click", () => {
    view.playing = !view.playing;
    playBtn.textContent = view.playing ? "Pause" : "Play";
  });
  timeSlider.addEventListener("input", () => {
    view.playing = false;
    playBtn.textContent = "Play";
    view.seek(Number(timeSlider.value) / 1000);
  });
  $<HTMLInputElement>("m-speed").addEventListener("input", (e) => (view.speed = Number((e.target as HTMLInputElement).value)));
  view.onTime = (t, duration, rate) => {
    if (document.activeElement !== timeSlider) timeSlider.value = String(Math.round((t / duration) * 1000));
    const pace = rate > 1.05 ? `sped up ×${formatNumber(rate, 2)}` : rate < 0.95 ? `slowed ×${formatNumber(1 / rate, 2)}` : "real time";
    clock.textContent = `t = ${formatQuantity(t, "time", 3)} of ${formatQuantity(duration, "time", 3)} · ${pace}`;
  };

  /** The variables table: symbol, name, value input, and a "find" checkbox. */
  function renderVars() {
    const tbody = $("m-vars").querySelector("tbody")!;
    tbody.replaceChildren();
    if (!problem || !solution) return;
    for (const d of solution.spec.vars) {
      const tr = document.createElement("tr");
      const sym = document.createElement("td");
      katex.render(d.tex, sym, { throwOnError: false });
      const name = document.createElement("td");
      name.textContent = d.label;
      name.className = "muted var-name";
      const valTd = document.createElement("td");
      const input = document.createElement("input");
      const given = problem.values[d.key];
      const known = solution.values[d.key];
      input.value = typeof given === "number" ? inputText(given) : "";
      const assumed = !(d.key in problem.values) && d.default !== undefined;
      input.placeholder = known !== undefined ? `= ${formatNumber(known, 4)}` : "?";
      input.classList.toggle("solved", typeof given !== "number" && known !== undefined);
      input.classList.toggle("assumed", assumed);
      input.title =
        `${d.label}${unitOf(d.dim) ? ` in ${d.dim === "angle" ? "degrees" : unitOf(d.dim)}` : ""}. ` +
        (assumed ? `Assumed ${formatQuantity(d.default!, d.dim)} because the problem doesn't say; type a value to change it.` : "Leave blank or type ? if unknown.");
      input.setAttribute("aria-label", d.label);
      input.addEventListener("change", () => {
        const v = parseQuantity(input.value, d.dim);
        if (Number.isNaN(v)) {
          input.classList.add("invalid");
          return;
        }
        input.classList.remove("invalid");
        if (v === null) problem!.values[d.key] = null;
        else problem!.values[d.key] = v;
        update(false);
      });
      const unit = document.createElement("span");
      unit.className = "unit";
      unit.textContent = d.dim === "angle" ? "°" : unitOf(d.dim);
      valTd.append(input, unit);
      const findTd = document.createElement("td");
      const find = document.createElement("input");
      find.type = "checkbox";
      find.checked = problem.asks.some((a) => a.key === d.key);
      find.title = "Ask for this quantity";
      find.setAttribute("aria-label", `Find ${d.label}`);
      find.addEventListener("change", () => {
        if (find.checked) problem!.asks.push({ label: d.label, key: d.key });
        else problem!.asks = problem!.asks.filter((a) => a.key !== d.key);
        update(false);
      });
      findTd.appendChild(find);
      tr.append(sym, name, valTd, findTd);
      tbody.appendChild(tr);
    }
  }

  function renderPanels() {
    if (!problem) return;
    const answers = $("answers");
    answers.replaceChildren();
    $("answers-card").hidden = !solution || problem.asks.length === 0;
    if (solution) {
      for (const a of problem.asks) {
        const li = document.createElement("li");
        const l = document.createElement("span");
        l.className = "label";
        l.textContent = a.label;
        const v = document.createElement("span");
        v.className = "value";
        const d = solution.defs.get(a.key);
        const x = solution.values[a.key];
        v.textContent = d && x !== undefined ? formatQuantity(x, d.dim) : "not enough information";
        li.append(l, v);
        answers.appendChild(li);
      }
    }
    const notes = $("notes");
    notes.replaceChildren();
    const items: { text: string; error?: boolean }[] = [];
    if (solution) {
      items.push(...solution.warnings.map((text) => ({ text, error: true })));
      const missing = problem.asks.filter((a) => solution!.values[a.key] === undefined);
      if (missing.length) {
        items.push({ text: `Not enough information for: ${missing.map((a) => a.label.toLowerCase()).join(", ")}. Add another given value.`, error: true });
      }
    }
    if (problem.notes) items.push({ text: problem.notes });
    $("notes-card").hidden = items.length === 0;
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it.text;
      if (it.error) li.className = "error";
      notes.appendChild(li);
    }
    deps.setSteps(solution ? buildMotionSteps(problem, solution) : []);
  }

  function update(resetScene: boolean) {
    if (!problem) return;
    try {
      solution = solveProblem(problem);
    } catch (e) {
      solution = null;
      $("notes-card").hidden = false;
      $("notes").textContent = e instanceof MotionError ? e.message : String(e);
    }
    renderVars();
    renderPanels();
    if (solution) {
      const scene = buildScene(problem.type, problem.variant, solution.values);
      if (typeof scene === "string") view.show(null, scene);
      else view.show(scene);
      $("m-caption").textContent = typeof scene === "string" ? "" : (scene.caption ?? "");
    } else {
      view.show(null, "This problem can't be solved as entered.");
    }
    if (resetScene) {
      view.playing = true;
      playBtn.textContent = "Pause";
    }
    deps.onChange?.();
  }

  return {
    load(p) {
      problem = structuredClone(p);
      typeSel.value = problem.type;
      fillVariants();
      $("motion-card").hidden = false;
      $("motion-empty").hidden = true;
      update(true);
    },
    refresh() {
      if (problem) {
        renderPanels();
      } else {
        $("answers-card").hidden = true;
        $("notes-card").hidden = true;
        deps.setSteps([]);
      }
    },
    current: () => problem,
  };
}
