import "./style.css";
import type { Circuit, ComponentKind } from "./types";
import { analysisOf } from "./types";
import { analyze, buildTopology, evaluateGiven, CircuitError, type Solution } from "./solver";
import { CircuitView } from "./render";
import { Editor, type Tool } from "./editor";
import { changeKind, emptyCircuit, flipComponent, renameComponent } from "./edit-ops";
import { buildSteps, formatAsk, type Step } from "./explain";
import { Scope } from "./scope";
import { extractCircuit, prepareImage, ExtractError } from "./extract";
import { EXAMPLES } from "./examples";
import { KIND_LABEL, formatPhasorShort, formatRect, formatSI, formatValue, parseComplex, parseSI, unitFor } from "./format";
import type { Complex } from "./complex";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY_STORAGE = "circuit-lens.api-key";
const STEP_MS = 3200;

// ------------------------------------------------------------------ state

let circuit: Circuit | null = null;
let solution: Solution | null = null;
let steps: Step[] = [];
let stepIndex = -1;
let stepTimer: number | undefined;
let image: { base64: string; mediaType: "image/jpeg"; url: string } | null = null;
let abort: AbortController | null = null;
let apiKey = safeGet(KEY_STORAGE) ?? "";

let selectedId: string | null = null;

const view = new CircuitView($<HTMLElement>("schematic") as unknown as SVGSVGElement, $("tooltip"));
const editor = new Editor(view, () => circuit);
const scope = new Scope($<HTMLElement>("scope-svg") as unknown as SVGSVGElement, $("scope-caption"));
view.onFrame = (theta) => scope.frame(theta);
editor.onChange = () => {
  normalizeSelection();
  renderEditor();
  solve();
  renderProps();
};

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: key lives for this session only */
  }
}

// ------------------------------------------------------------------ circuit lifecycle

/** Coerces model / user JSON into a well-formed Circuit (missing arrays, stray types). */
function normalize(raw: unknown): Circuit {
  const r = (raw ?? {}) as Partial<Circuit>;
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    title: String(r.title ?? "Circuit"),
    points: (r.points ?? []).map((p) => ({ id: String(p.id), x: Number(p.x), y: Number(p.y) })),
    wires: (r.wires ?? []).map((w) => ({ a: String(w.a), b: String(w.b) })),
    components: (r.components ?? []).map((k) => ({
      id: String(k.id),
      kind: k.kind,
      a: String(k.a),
      b: String(k.b),
      value: k.value === null || k.value === undefined ? null : Number(k.value),
      ctrl_a: str(k.ctrl_a),
      ctrl_b: str(k.ctrl_b),
      ctrl_component: str(k.ctrl_component),
      ...(k.phase !== undefined && k.phase !== null ? { phase: Number(k.phase) } : {}),
      ...(k.kind === "impedance" ? { reactance: k.reactance === null || k.reactance === undefined ? null : Number(k.reactance) } : {}),
    })),
    ground: str(r.ground),
    givens: (r.givens ?? []).map((g) => ({ ...g, component: str(g.component), a: str(g.a), b: str(g.b), value: Number(g.value) })),
    asks: (r.asks ?? []).map((a) => ({ ...a, label: String(a.label), component: str(a.component), a: str(a.a), b: str(a.b) })),
    notes: String(r.notes ?? ""),
    analysis: {
      mode: r.analysis?.mode === "ac" ? "ac" : "dc",
      frequency: r.analysis?.frequency ? Number(r.analysis.frequency) : null,
      amplitude: r.analysis?.amplitude === "rms" ? "rms" : "peak",
    },
  };
}

function loadCircuit(c: Circuit) {
  circuit = c;
  selectedId = null;
  editor.resetHistory();
  renderEditor();
  solve();
  renderProps();
}

/** Drops the selection if the selected part no longer exists (deleted, undone). */
function normalizeSelection() {
  if (selectedId && !circuit?.components.some((k) => k.id === selectedId)) selectedId = null;
}

function solve() {
  if (!circuit) return;
  stopWalkthrough();
  const errors: string[] = [];
  solution = null;
  if (circuit.components.length > 0) {
    try {
      solution = analyze(circuit);
    } catch (e) {
      errors.push(e instanceof CircuitError ? e.message : `Unexpected error: ${(e as Error).message}`);
    }
  }
  view.setCircuit(circuit, solution); // a new circuit object plays the intro; edits re-render in place
  $("empty").hidden = true;
  $<HTMLTextAreaElement>("json-text").value = JSON.stringify(circuit, null, 2);
  renderResults(errors);
  updateScope();
  steps = solution ? buildSteps(circuit, solution) : [];
  $("stepper").hidden = steps.length === 0;
  showStep(-1);
}

// ------------------------------------------------------------------ editor

function renderEditor() {
  if (!circuit) return;
  $("edit-card").hidden = false;
  renderAnalysis();
  const tbody = $("comp-table").querySelector("tbody")!;
  tbody.replaceChildren();
  for (const k of circuit.components) {
    const tr = document.createElement("tr");
    const id = document.createElement("td");
    id.textContent = k.id;
    const kind = document.createElement("td");
    kind.textContent = KIND_LABEL[k.kind] ?? k.kind;
    kind.className = "muted";
    const valTd = document.createElement("td");
    const input = document.createElement("input");
    input.value = k.value === null ? "?" : valueToText(k.kind, k.value);
    input.classList.toggle("unknown", k.value === null);
    input.setAttribute("aria-label", `${k.id} value`);
    input.title = `Unit: ${unitFor(k.kind)}`;
    if (k.kind === "impedance") {
      input.value = k.value === null || k.reactance === null ? "?" : formatRect({ re: k.value, im: k.reactance ?? 0 }, "").replace(/\s+/g, "").replace("−", "-");
      input.title = "Impedance R + jX in ohms, e.g. 3+j4 or -j5. Use the Selected part panel for unknowns.";
      input.addEventListener("change", () => {
        const z = parseComplex(input.value);
        if (!z || Number.isNaN(z.re) || Number.isNaN(z.im)) {
          input.classList.add("invalid");
          return;
        }
        input.classList.remove("invalid", "unknown");
        editor.snapshot();
        k.value = z.re;
        k.reactance = z.im;
        solve();
        renderProps();
      });
      valTd.appendChild(input);
      tr.append(id, kind, valTd);
      tbody.appendChild(tr);
      continue;
    }
    input.addEventListener("change", () => {
      const v = parseSI(input.value);
      if (Number.isNaN(v)) {
        input.classList.add("invalid");
        return;
      }
      input.classList.remove("invalid");
      input.classList.toggle("unknown", v === null);
      editor.snapshot();
      k.value = v;
      solve();
      renderProps();
    });
    valTd.appendChild(input);
    tr.append(id, kind, valTd);
    tbody.appendChild(tr);
  }

  const gt = $("given-table").querySelector("tbody")!;
  gt.replaceChildren();
  $("givens-wrap").hidden = circuit.givens.length === 0;
  for (const g of circuit.givens) {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = describeGiven(g);
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.value = String(g.value);
    input.addEventListener("change", () => {
      const v = parseSI(input.value);
      if (v === null || Number.isNaN(v)) {
        input.classList.add("invalid");
        return;
      }
      input.classList.remove("invalid");
      editor.snapshot();
      g.value = v;
      solve();
      renderProps();
    });
    td.appendChild(input);
    tr.append(label, td);
    gt.appendChild(tr);
  }
}

// ------------------------------------------------------------------ analysis settings (DC / AC)

const modeDc = $<HTMLButtonElement>("mode-dc");
const modeAc = $<HTMLButtonElement>("mode-ac");
const freqInput = $<HTMLInputElement>("freq");
const ampSelect = $<HTMLSelectElement>("amplitude");

function renderAnalysis() {
  if (!circuit) return;
  const an = analysisOf(circuit);
  const ac = an.mode === "ac";
  modeDc.setAttribute("aria-pressed", String(!ac));
  modeAc.setAttribute("aria-pressed", String(ac));
  $("ac-settings").hidden = !ac;
  freqInput.value = an.frequency ? formatSI(an.frequency, "", 6).replace(/\s+/g, "") : "";
  ampSelect.value = an.amplitude;
  $("omega").textContent = an.frequency ? `ω = ${formatSI(2 * Math.PI * an.frequency, "rad/s", 4)}` : "no frequency: impedances only";
}

function setAnalysis(patch: Partial<NonNullable<Circuit["analysis"]>>) {
  if (!circuit) return;
  editor.snapshot();
  circuit.analysis = { ...analysisOf(circuit), ...patch };
  editor.onChange();
}

modeDc.addEventListener("click", () => setAnalysis({ mode: "dc" }));
modeAc.addEventListener("click", () => {
  const an = circuit ? analysisOf(circuit) : null;
  setAnalysis({ mode: "ac", frequency: an?.frequency ?? 60 });
});
freqInput.addEventListener("change", () => {
  const v = parseSI(freqInput.value);
  if (v !== null && (Number.isNaN(v) || v <= 0)) {
    freqInput.classList.add("invalid");
    return;
  }
  freqInput.classList.remove("invalid");
  setAnalysis({ frequency: v });
});
ampSelect.addEventListener("change", () => setAnalysis({ amplitude: ampSelect.value as "peak" | "rms" }));

function valueToText(kind: ComponentKind, v: number): string {
  return unitFor(kind).includes("/") ? String(v) : formatSI(v, "", 6).replace(/\s+$/, "").replace(" ", "");
}

function describeGiven(g: Circuit["givens"][number]): string {
  if (g.quantity === "component_current") return `I(${g.component})`;
  if (g.quantity === "component_voltage") return `V(${g.component})`;
  if (g.quantity === "component_power") return `P(${g.component})`;
  return `V(${g.a},${g.b})`;
}

// ------------------------------------------------------------------ results panel

function renderResults(errors: string[]) {
  const c = circuit!;
  const sol = solution;

  // Answers
  const answers = $("answers");
  answers.replaceChildren();
  const asks = [...c.asks];
  if (sol) {
    for (const u of sol.solvedUnknowns) {
      if (!asks.some((a) => a.quantity === "component_value" && a.component === u.id)) {
        asks.unshift({ label: u.id, quantity: "component_value", component: u.id, a: null, b: null });
      }
    }
  }
  $("answers-card").hidden = !sol || asks.length === 0;
  if (sol) {
    for (const a of asks) {
      const li = document.createElement("li");
      const l = document.createElement("span");
      l.className = "label";
      l.textContent = a.label;
      const v = document.createElement("span");
      v.className = "value";
      try {
        v.textContent = formatAsk(c, sol, a);
      } catch (e) {
        v.textContent = "—";
        l.textContent += ` (${(e as Error).message})`;
      }
      li.append(l, v);
      if (a.component) {
        li.style.cursor = "pointer";
        li.addEventListener("click", () => view.select(a.component));
      }
      answers.appendChild(li);
    }
  }

  // Component table
  const tbody = $("results").querySelector("tbody")!;
  tbody.replaceChildren();
  $("results-card").hidden = !sol;
  if (sol) {
    for (const k of c.components) {
      const tr = document.createElement("tr");
      tr.dataset.id = k.id;
      const q = (z: Complex, unit: string) => (sol.ac ? formatPhasorShort(z, unit) : formatSI(z.re, unit, 3));
      for (const text of [k.id, q(sol.compV[k.id], "V"), q(sol.compI[k.id], "A"), formatSI(sol.compS[k.id].re, "W", 3)]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      tr.addEventListener("click", () => view.select(k.id));
      tbody.appendChild(tr);
    }
  }

  // Notes
  const notes = $("notes");
  notes.replaceChildren();
  const items: { text: string; error?: boolean }[] = errors.map((text) => ({ text, error: true }));
  if (sol) items.push(...sol.warnings.map((text) => ({ text })));
  if (sol && sol.solvedUnknowns.length === 0) {
    for (const g of c.givens) {
      const got = evaluateGiven(c, sol, g);
      if (Math.abs(got - g.value) > 1e-6 * Math.max(1, Math.abs(g.value))) {
        items.push({ text: `Given ${describeGiven(g)} = ${g.value} but the circuit gives ${Number(got.toPrecision(5))}. Check the values or orientation.`, error: true });
      }
    }
  }
  if (c.notes) items.push({ text: c.notes });
  $("notes-card").hidden = items.length === 0;
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it.text;
    if (it.error) li.className = "error";
    notes.appendChild(li);
  }
}

view.onSelect = (id) => {
  $("results")
    .querySelectorAll("tbody tr")
    .forEach((tr) => tr.classList.toggle("selected", (tr as HTMLElement).dataset.id === id));
  selectedId = id;
  renderProps();
  updateScope();
};

/** The scope follows the selected part, or the first source. */
function updateScope() {
  const ac = !!solution?.ac;
  $("scope-card").hidden = !ac;
  if (!ac || !circuit) return scope.set(null, null);
  const id =
    (selectedId && circuit.components.some((k) => k.id === selectedId) ? selectedId : null) ??
    circuit.components.find((k) => k.kind === "voltage_source" || k.kind === "current_source")?.id ??
    circuit.components[0]?.id ??
    null;
  $("scope-title").textContent = id ? `Waveforms · ${id}` : "Waveforms";
  const kind = circuit.components.find((k) => k.id === id)?.kind ?? "";
  scope.set(solution, id, /source|^vc|^cc/.test(kind));
}

// ------------------------------------------------------------------ selected-part panel

const QUANTITY_OPTIONS: [Circuit["givens"][number]["quantity"], string, string][] = [
  ["component_current", "Current", "A"],
  ["component_voltage", "Voltage", "V"],
  ["component_power", "Power", "W"],
];

function field(key: string, label: string, control: HTMLElement): HTMLElement[] {
  const l = document.createElement("label");
  l.textContent = label;
  control.id = `prop-${key}`;
  l.htmlFor = control.id;
  return [l, control];
}

function option(value: string, text: string, selected = false): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  o.selected = selected;
  return o;
}

/** Applies an edit from the panel as one undoable step. */
function commit(mutate: () => void) {
  editor.snapshot();
  mutate();
  editor.onChange();
}

function renderProps() {
  const card = $("props-card");
  const body = $("props-body");
  const c = circuit;
  const k = c?.components.find((x) => x.id === selectedId);
  card.hidden = !k;
  body.replaceChildren();
  if (!c || !k) return;

  const grid = document.createElement("div");
  grid.className = "props-grid";

  const name = document.createElement("input");
  name.value = k.id;
  name.addEventListener("change", () => {
    const old = k.id;
    editor.snapshot();
    const err = renameComponent(c, old, name.value);
    if (err) {
      editor.dropSnapshot();
      setStatus(err, "error");
      name.value = old;
      return;
    }
    selectedId = k.id;
    editor.onChange();
    view.select(k.id);
  });
  grid.append(...field("name", "Name", name));

  const kind = document.createElement("select");
  for (const [value, text] of Object.entries(KIND_LABEL)) kind.appendChild(option(value, text, value === k.kind));
  kind.addEventListener("change", () => {
    commit(() => changeKind(c, k, kind.value as ComponentKind));
    selectedId = k.id;
    view.select(k.id);
  });
  grid.append(...field("kind", "Type", kind));

  const value = document.createElement("input");
  value.value = k.value === null ? "?" : valueToText(k.kind, k.value);
  value.placeholder = "? = unknown";
  value.title = `Unit: ${unitFor(k.kind)}. Use ? if this is what you're solving for.`;
  value.addEventListener("change", () => {
    const v = parseSI(value.value);
    if (Number.isNaN(v)) {
      value.classList.add("invalid");
      return;
    }
    commit(() => (k.value = v));
  });
  const ac = analysisOf(c).mode === "ac";
  const isSource = k.kind === "voltage_source" || k.kind === "current_source";
  const valueLabel = k.kind === "impedance" ? "R (Ω)" : isSource && ac ? `Amplitude (${unitFor(k.kind)})` : `Value (${unitFor(k.kind)})`;
  grid.append(...field("value", valueLabel, value));

  if (k.kind === "impedance") {
    const x = document.createElement("input");
    x.value = k.reactance === null || k.reactance === undefined ? "?" : valueToText(k.kind, k.reactance);
    x.placeholder = "? = unknown";
    x.title = "Reactance in ohms: positive = inductive (+jX), negative = capacitive (−jX).";
    x.addEventListener("change", () => {
      const v = parseSI(x.value);
      if (Number.isNaN(v)) {
        x.classList.add("invalid");
        return;
      }
      commit(() => (k.reactance = v));
    });
    grid.append(...field("reactance", "X (Ω)", x));
  }
  if (isSource && ac) {
    const ph = document.createElement("input");
    ph.value = String(k.phase ?? 0);
    ph.title = "Phase in degrees, cosine reference: A·cos(ωt + phase). For a sine source use phase − 90°.";
    ph.addEventListener("change", () => {
      const v = parseSI(ph.value);
      if (v === null || Number.isNaN(v)) {
        ph.classList.add("invalid");
        return;
      }
      commit(() => (k.phase = v));
    });
    grid.append(...field("phase", "Phase (°)", ph));
  }

  // Controlling quantity for dependent sources.
  if (k.kind === "vcvs" || k.kind === "vccs") {
    let topo: ReturnType<typeof buildTopology> | null = null;
    try {
      topo = buildTopology(c);
    } catch {
      /* invalid wiring; the error is shown in Notes */
    }
    if (topo) {
      const nodeSelect = (current: string | null, apply: (point: string) => void) => {
        const s = document.createElement("select");
        const cur = current !== null ? topo!.nodeOf.get(current) : undefined;
        s.appendChild(option("", "choose node…", cur === undefined));
        topo!.nodePoints.forEach((pts, n) => s.appendChild(option(pts[0], topo!.nodeNames[n], n === cur)));
        s.addEventListener("change", () => s.value && commit(() => apply(s.value)));
        return s;
      };
      grid.append(...field("ctrl-a", "Vx + node", nodeSelect(k.ctrl_a, (p) => (k.ctrl_a = p))));
      grid.append(...field("ctrl-b", "Vx − node", nodeSelect(k.ctrl_b, (p) => (k.ctrl_b = p))));
    }
  }
  if (k.kind === "ccvs" || k.kind === "cccs") {
    const s = document.createElement("select");
    s.appendChild(option("", "choose part…", !k.ctrl_component));
    for (const other of c.components) {
      if (other.id !== k.id) s.appendChild(option(other.id, other.id, other.id === k.ctrl_component));
    }
    s.addEventListener("change", () => s.value && commit(() => (k.ctrl_component = s.value)));
    grid.append(...field("ctrl-component", "Ix through", s));
  }
  body.appendChild(grid);

  const note = document.createElement("p");
  note.className = "props-note";
  note.textContent =
    k.kind === "voltage_source" || k.kind === "vcvs" || k.kind === "ccvs"
      ? "The + terminal is at the end you placed first."
      : k.kind === "current_source" || k.kind === "vccs" || k.kind === "cccs"
        ? "The arrow points from the first end to the second."
        : "Positive current flows from the first end to the second.";
  body.appendChild(note);

  // Known measurements on this part (used to solve for unknown values).
  const h = document.createElement("h3");
  h.textContent = "Known measurements";
  body.appendChild(h);
  const mine = c.givens.filter((g) => g.component === k.id);
  if (mine.length) {
    const ul = document.createElement("ul");
    ul.className = "given-list";
    for (const g of mine) {
      const li = document.createElement("li");
      const [, label, unit] = QUANTITY_OPTIONS.find(([q]) => q === g.quantity) ?? [g.quantity, g.quantity, ""];
      const span = document.createElement("span");
      span.textContent = `${label} = ${formatSI(g.value, unit)}`;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Remove ${label} measurement`);
      del.addEventListener("click", () => commit(() => (c.givens = c.givens.filter((x) => x !== g))));
      li.append(span, del);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  } else {
    const p = document.createElement("p");
    p.className = "props-note";
    p.textContent = "Add one for each unknown (?) value elsewhere, e.g. a measured current.";
    body.appendChild(p);
  }
  const add = document.createElement("div");
  add.className = "given-add";
  const q = document.createElement("select");
  q.setAttribute("aria-label", "Measured quantity");
  for (const [value, text] of QUANTITY_OPTIONS) q.appendChild(option(value, text));
  const v = document.createElement("input");
  v.placeholder = "e.g. 2m";
  v.setAttribute("aria-label", "Measured value");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ghost";
  addBtn.textContent = "Add";
  addBtn.addEventListener("click", () => {
    const n = parseSI(v.value);
    if (n === null || Number.isNaN(n)) {
      v.classList.add("invalid");
      return;
    }
    commit(() =>
      c.givens.push({ quantity: q.value as Circuit["givens"][number]["quantity"], component: k.id, a: null, b: null, value: n }),
    );
  });
  add.append(q, v, addBtn);
  body.appendChild(add);

  const actions = document.createElement("div");
  actions.className = "row";
  const flip = document.createElement("button");
  flip.type = "button";
  flip.className = "ghost";
  flip.textContent = "⇄ Flip direction";
  flip.addEventListener("click", () => commit(() => flipComponent(k)));
  const del = document.createElement("button");
  del.type = "button";
  del.className = "ghost danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => editor.deleteSelection(k.id));
  actions.append(flip, del);
  body.appendChild(actions);
}

// ------------------------------------------------------------------ edit mode

const editToggle = $<HTMLButtonElement>("edit-toggle");
const depTool = $<HTMLSelectElement>("dep-tool");

function setEditMode(on: boolean) {
  if (on && !circuit) loadCircuit(emptyCircuit());
  editor.setActive(on);
  editToggle.setAttribute("aria-pressed", String(on));
  editToggle.textContent = on ? "✓ Done editing" : "✎ Edit circuit";
  $("edit-toolbar").hidden = !on;
  $("edit-hint").hidden = !on;
  $("empty").hidden = true;
}

editToggle.addEventListener("click", () => setEditMode(!editor.active));
$("new-btn").addEventListener("click", () => {
  if (circuit && circuit.components.length && !confirm("Start a new blank circuit? The current one will be cleared.")) return;
  loadCircuit(emptyCircuit());
  setStatus("Blank circuit. Pick a tool and click on the grid to draw.");
  setEditMode(true);
  editor.setTool("resistor");
});
$("edit-toolbar")
  .querySelectorAll<HTMLButtonElement>("[data-tool]")
  .forEach((b) => b.addEventListener("click", () => editor.setTool(b.dataset.tool as Tool)));
depTool.addEventListener("change", () => {
  if (depTool.value) editor.setTool(depTool.value as Tool);
});
$("undo-btn").addEventListener("click", () => editor.undo());
$("redo-btn").addEventListener("click", () => editor.redo());

editor.onTool = (tool, hint) => {
  $("edit-toolbar")
    .querySelectorAll<HTMLButtonElement>("[data-tool]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
  const dep = ["vcvs", "vccs", "ccvs", "cccs"].includes(tool);
  depTool.classList.toggle("active", dep);
  if (!dep) depTool.value = "";
  $("edit-hint").textContent = hint;
};
editor.onHistory = (canUndo, canRedo) => {
  $<HTMLButtonElement>("undo-btn").disabled = !canUndo;
  $<HTMLButtonElement>("redo-btn").disabled = !canRedo;
};
view.onLegend = (range) => {
  $("legend").hidden = !range;
  if (range) {
    $("legend-label").textContent = range.ac ? "v(t)" : "";
    $("legend-min").textContent = formatSI(range.min, "V", 3);
    $("legend-max").textContent = (range.ac ? "+" : "") + formatSI(range.max, "V", 3);
  }
};

// ------------------------------------------------------------------ walkthrough

function showStep(i: number) {
  stepIndex = i;
  const title = $("step-title");
  const body = $("step-body");
  body.replaceChildren();
  if (i < 0 || i >= steps.length) {
    title.textContent = solution ? "Solved. Press play for a step-by-step walkthrough." : "";
    $("step-count").textContent = `${steps.length} steps`;
    $<HTMLElement>("step-progress").style.width = "0";
    view.setHighlight(null);
    return;
  }
  const s = steps[i];
  title.textContent = s.title;
  for (const line of s.lines) {
    const p = document.createElement("p");
    p.textContent = line.text;
    if (line.mono) p.className = "mono";
    body.appendChild(p);
  }
  // Re-trigger the fade animation.
  const card = title.parentElement!;
  card.style.animation = "none";
  void card.offsetWidth;
  card.style.animation = "";
  $("step-count").textContent = `${i + 1} / ${steps.length}`;
  $<HTMLElement>("step-progress").style.width = `${((i + 1) / steps.length) * 100}%`;
  view.setHighlight(s.highlight);
}

function playWalkthrough() {
  if (stepTimer !== undefined) {
    stopWalkthrough();
    return;
  }
  $("step-play").textContent = "❚❚ Pause";
  if (stepIndex >= steps.length - 1) showStep(0);
  else showStep(stepIndex + 1);
  stepTimer = window.setInterval(() => {
    if (stepIndex >= steps.length - 1) {
      stopWalkthrough();
      return;
    }
    showStep(stepIndex + 1);
  }, STEP_MS);
}

function stopWalkthrough() {
  if (stepTimer !== undefined) clearInterval(stepTimer);
  stepTimer = undefined;
  $("step-play").textContent = "▶ Play walkthrough";
}

$("step-play").addEventListener("click", playWalkthrough);
$("step-prev").addEventListener("click", () => {
  stopWalkthrough();
  showStep(Math.max(-1, stepIndex - 1));
});
$("step-next").addEventListener("click", () => {
  stopWalkthrough();
  showStep(Math.min(steps.length - 1, stepIndex + 1));
});

// ------------------------------------------------------------------ toolbar

const flowBtn = $<HTMLButtonElement>("flow-toggle");
flowBtn.addEventListener("click", () => {
  const playing = !view.opts.playing;
  view.setOptions({ playing });
  flowBtn.textContent = playing ? "Pause flow" : "Play flow";
  flowBtn.setAttribute("aria-pressed", String(playing));
});
$<HTMLInputElement>("speed").addEventListener("input", (e) => view.setOptions({ speed: Number((e.target as HTMLInputElement).value) }));
$<HTMLInputElement>("electron").addEventListener("change", (e) => view.setOptions({ electronFlow: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("labels").addEventListener("change", (e) => view.setOptions({ showLabels: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("vcolor").addEventListener("change", (e) => view.setOptions({ showNodeVoltages: (e.target as HTMLInputElement).checked }));
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  view.setOptions({ speed: 0.4 });
  $<HTMLInputElement>("speed").value = "0.4";
}

// ------------------------------------------------------------------ examples

const exampleSelect = $<HTMLSelectElement>("example-select");
EXAMPLES.forEach((ex, i) => {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = ex.title;
  exampleSelect.appendChild(o);
});
exampleSelect.addEventListener("change", () => {
  if (exampleSelect.value === "") return;
  loadCircuit(structuredClone(EXAMPLES[Number(exampleSelect.value)]));
  setStatus(`Loaded example: ${EXAMPLES[Number(exampleSelect.value)].title}`);
  exampleSelect.value = "";
});

// ?example=N opens an example directly (handy for sharing a demo link).
const exampleParam = new URLSearchParams(location.search).get("example");
if (exampleParam !== null && EXAMPLES[Number(exampleParam)]) loadCircuit(structuredClone(EXAMPLES[Number(exampleParam)]));

// ------------------------------------------------------------------ JSON editor

$("json-apply").addEventListener("click", () => {
  try {
    loadCircuit(normalize(JSON.parse($<HTMLTextAreaElement>("json-text").value)));
    setStatus("Applied JSON.");
  } catch (e) {
    setStatus(`Invalid JSON: ${(e as Error).message}`, "error");
  }
});

// ------------------------------------------------------------------ upload

const dropzone = $("dropzone");
const fileInput = $<HTMLInputElement>("file-input");
const readBtn = $<HTMLButtonElement>("read-btn");

async function acceptFile(file: File | Blob | null | undefined) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("That isn't an image file.", "error");
    return;
  }
  try {
    image = await prepareImage(file);
  } catch {
    setStatus("Couldn't open that image.", "error");
    return;
  }
  const img = $<HTMLImageElement>("preview");
  img.src = image.url;
  img.hidden = false;
  $("drop-hint").hidden = true;
  readBtn.disabled = false;
  setStatus(apiKey ? "Ready. Press “Read circuit”." : "Add your API key (top right) to read the photo.");
}

fileInput.addEventListener("change", () => acceptFile(fileInput.files?.[0]));
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  acceptFile(e.dataTransfer?.files[0]);
});
window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (item) acceptFile(item.getAsFile());
});

readBtn.addEventListener("click", async () => {
  if (!image) return;
  if (!apiKey) {
    openSettings();
    return;
  }
  abort = new AbortController();
  readBtn.disabled = true;
  $("cancel-btn").hidden = false;
  setStatus("Reading the circuit… this can take up to a minute.", "working");
  try {
    const c = normalize(
      await extractCircuit({
        apiKey,
        imageBase64: image.base64,
        mediaType: image.mediaType,
        hint: $<HTMLTextAreaElement>("hint").value,
        signal: abort.signal,
      }),
    );
    loadCircuit(c);
    setStatus(`Read “${c.title}”. Check the values on the left; edits re-solve instantly.`);
  } catch (e) {
    setStatus(e instanceof ExtractError ? e.message : `Something went wrong: ${(e as Error).message}`, "error");
  } finally {
    readBtn.disabled = false;
    $("cancel-btn").hidden = true;
    abort = null;
  }
});
$("cancel-btn").addEventListener("click", () => abort?.abort());

function setStatus(text: string, kind: "" | "error" | "working" = "") {
  const s = $("status");
  s.textContent = text;
  s.className = `status ${kind}`;
}

// ------------------------------------------------------------------ settings

const dialog = $<HTMLDialogElement>("settings");
const keyInput = $<HTMLInputElement>("api-key");
function openSettings() {
  keyInput.value = apiKey;
  dialog.showModal();
}
$("settings-btn").addEventListener("click", openSettings);
dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  apiKey = keyInput.value.trim();
  safeSet(KEY_STORAGE, $<HTMLInputElement>("remember-key").checked && apiKey ? apiKey : null);
  updateKeyButton();
  if (image) setStatus(apiKey ? "Ready. Press “Read circuit”." : "Add your API key to read the photo.");
});
$("clear-key").addEventListener("click", () => {
  apiKey = "";
  keyInput.value = "";
  safeSet(KEY_STORAGE, null);
  updateKeyButton();
  dialog.close();
});
function updateKeyButton() {
  $("settings-btn").textContent = apiKey ? "API key ✓" : "API key";
}
updateKeyButton();

// Expose for debugging in the console.
Object.assign(window, { circuitLens: { get circuit() { return circuit; }, get solution() { return solution; }, formatValue } });
