// Reads a photo of a physics (motion) problem with Claude and returns a Problem for the solver.
// The variable catalogue in the prompt is generated from models.ts, so it always matches the solver.

import { extractStructured, type ExtractOptions } from "../extract";
import { MODELS, allKeys, allVariants } from "./models";
import { unitOf } from "./units";
import type { Problem } from "./solve";

function catalogue(): string {
  return MODELS.map((m) => {
    const keys = new Map<string, string>();
    for (const v of m.variants) {
      for (const d of m.build(v.id).vars) {
        if (!keys.has(d.key)) keys.set(d.key, `${d.key}: ${d.label}${d.dim === "angle" ? " [degrees]" : unitOf(d.dim) ? ` [${unitOf(d.dim)}]` : ""}`);
      }
    }
    return [
      `## type "${m.type}": ${m.title}`,
      `variants: ${m.variants.map((v) => `"${v.id}" (${v.label})`).join(", ")}`,
      `variables: ${[...keys.values()].join("; ")}`,
    ].join("\n");
  }).join("\n\n");
}

const SYSTEM_PROMPT = `You read photos or screenshots of physics problems about motion and forces (textbook pages, worksheets, handwriting) and transcribe them into JSON for a solver and an animation. You transcribe; you do not solve.

Pick the one problem type and variant that fits best, then list every quantity the problem states as a {key, value} pair, and every quantity it asks for under "asks".

Units and signs
- Values are in SI units (m, s, kg, N, J, m/s, m/s², rad/s, Hz), whatever units the problem uses. Convert: 72 km/h -> 20, 50 cm -> 0.5, 300 g -> 0.3, 1200 rpm -> 125.66 rad/s, 3 rev (as angular displacement) -> 18.85 rad (or give it as nrev = 3). US units: 1 ft = 0.3048 m, 1 in = 0.0254 m, 1 mi = 1609.344 m, 60 mph = 26.8224 m/s, 1 lb of mass = 0.45359 kg, 1 slug = 14.594 kg, 1 lb of force = 4.4482 N, 1 ft·lb = 1.3558 J; g = 32.2 ft/s² is 9.81 m/s². A weight given in pounds is a force: the mass is weight / g.
- unit_system: "imperial" if the problem is written in US customary units (ft, mph, lb, slug), otherwise "metric".
- Variables marked [degrees] stay in degrees.
- "From rest" means the initial speed is 0. "Comes to a stop" means the final speed is 0. "Dropped" means initial velocity 0.
- kinematics_1d free_fall: up is positive, so a falling object has negative displacement (dropped from 45 m to the ground: d = -45).
- projectile: theta is measured above the horizontal (negative below); launched horizontally means theta = 0. h0 is the launch height and hL the landing height, both measured from the same ground level.
- incline: a is the acceleration along the direction of motion (negative when slowing). Frictionless means mu = 0.
- pulley: a is positive when m2 moves down.
- collision: right is positive; give velocities with signs. Something at rest has velocity 0.
- Only include g if the problem states a value (e.g. "use g = 10 m/s²"); otherwise 9.8 is used.
- Do not include quantities the problem doesn't give. Don't compute anything yourself.

asks: each quantity requested, with a short label in the problem's words (e.g. "maximum height", "time to hit the ground") and its key. If the problem asks for something no variable covers, mention it in notes instead.
notes: brief remarks on assumptions or parts of the problem the model can't represent (e.g. air resistance, 2D collisions). Empty string if none.

# Problem types and variables
${catalogue()}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "unit_system", "type", "variant", "values", "asks", "notes"],
  properties: {
    title: { type: "string" },
    unit_system: { type: "string", enum: ["metric", "imperial"] },
    type: { type: "string", enum: MODELS.map((m) => m.type) },
    variant: { type: "string", enum: allVariants() },
    values: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: { key: { type: "string", enum: allKeys() }, value: { type: "number" } },
      },
    },
    asks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "key"],
        properties: { label: { type: "string" }, key: { type: "string", enum: allKeys() } },
      },
    },
    notes: { type: "string" },
  },
};

interface Raw {
  title: string;
  unit_system?: "metric" | "imperial";
  type: Problem["type"];
  variant: string;
  values: { key: string; value: number }[];
  asks: { label: string; key: string }[];
  notes: string;
}

export async function extractMotion(opts: ExtractOptions): Promise<Problem> {
  const raw = (await extractStructured(opts, SYSTEM_PROMPT, SCHEMA, "Transcribe this physics problem into the JSON format.")) as Raw;
  return fromRaw(raw);
}

export function fromRaw(raw: Raw): Problem {
  const values: Problem["values"] = {};
  for (const { key, value } of raw.values ?? []) if (Number.isFinite(value)) values[key] = value;
  // Asked-for quantities are unknown even if they have a default (e.g. "find the launch height").
  for (const a of raw.asks ?? []) if (!(a.key in values)) values[a.key] = null;
  return {
    title: String(raw.title ?? "Motion problem"),
    type: raw.type,
    variant: raw.variant,
    values,
    asks: (raw.asks ?? []).map((a) => ({ label: String(a.label), key: String(a.key) })),
    notes: String(raw.notes ?? ""),
    units: raw.unit_system === "imperial" ? "imperial" : "metric",
  };
}

export { SYSTEM_PROMPT as MOTION_PROMPT };
