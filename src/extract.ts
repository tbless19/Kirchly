// Reads a circuit photo with Claude's vision model and returns a structured Circuit.
// Claude only *reads* the schematic; all solving happens locally in solver.ts.

import Anthropic from "@anthropic-ai/sdk";
import type { Circuit } from "./types";

const MODEL = "claude-opus-5-5";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const quantityEnum = ["component_current", "component_voltage", "component_power", "voltage_between"];

const CIRCUIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "analysis", "points", "wires", "components", "ground", "givens", "asks", "notes"],
  properties: {
    title: { type: "string" },
    analysis: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "frequency", "amplitude"],
      properties: {
        mode: { type: "string", enum: ["dc", "ac"] },
        frequency: { anyOf: [{ type: "number" }, { type: "null" }] },
        amplitude: { type: "string", enum: ["peak", "rms"] },
      },
    },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "x", "y"],
        properties: { id: { type: "string" }, x: { type: "integer" }, y: { type: "integer" } },
      },
    },
    wires: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "b"],
        properties: { a: { type: "string" }, b: { type: "string" } },
      },
    },
    components: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "a", "b", "value", "phase", "reactance", "ctrl_a", "ctrl_b", "ctrl_component"],
        properties: {
          id: { type: "string" },
          kind: {
            type: "string",
            enum: ["resistor", "voltage_source", "current_source", "capacitor", "inductor", "impedance", "vcvs", "vccs", "ccvs", "cccs"],
          },
          a: { type: "string" },
          b: { type: "string" },
          value: { anyOf: [{ type: "number" }, { type: "null" }] },
          phase: { anyOf: [{ type: "number" }, { type: "null" }] },
          reactance: { anyOf: [{ type: "number" }, { type: "null" }] },
          ctrl_a: nullableString,
          ctrl_b: nullableString,
          ctrl_component: nullableString,
        },
      },
    },
    ground: nullableString,
    givens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quantity", "component", "a", "b", "value"],
        properties: {
          quantity: { type: "string", enum: quantityEnum },
          component: nullableString,
          a: nullableString,
          b: nullableString,
          value: { type: "number" },
        },
      },
    },
    asks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "quantity", "component", "a", "b"],
        properties: {
          label: { type: "string" },
          quantity: { type: "string", enum: [...quantityEnum, "component_value"] },
          component: nullableString,
          a: nullableString,
          b: nullableString,
        },
      },
    },
    notes: { type: "string" },
  },
};

const SYSTEM_PROMPT = `You convert photos or screenshots of electrical circuit problems (textbook figures, hand drawings, whiteboards) into a JSON netlist that a DC and AC (phasor) circuit solver and a schematic animator will use. You transcribe; you do not solve.

Layout
- "points" are connection points on an integer grid that mirrors the drawing: x grows to the right, y grows downward. Use a spacing of about 3 grid units per component so labels fit (e.g. a simple loop spans x 0..3 or 0..6). Place points where the drawing has corners, junctions and component terminals.
- Every component sits between two points ("a" and "b"). Keep each component's two points on the same row or column, matching its orientation in the drawing.
- "wires" are plain conductors between points. Draw them as straight horizontal or vertical segments; add corner points rather than diagonal wires. Points joined by wires form one electrical node. Two components that touch the same junction must share a point or be wired together.

Components (values in SI base units: ohms, volts, amps, farads, henries; 4.7 kΩ -> 4700, 2 mA -> 0.002)
- Current through a component is positive from a to b through the component; its voltage is V(a) - V(b).
- voltage_source: a = the + terminal (longer battery plate, or the + sign), value = the source voltage.
- current_source: the arrow points from a to b, value = the source current.
- Dependent sources (diamond symbols): vcvs (V = gain·Vx), vccs (I = gain·Vx), ccvs (V = gain·Ix), cccs (I = gain·Ix). value = the gain in SI units (e.g. 0.5 V/mA -> 500). For voltage control set ctrl_a/ctrl_b to points so that Vx = V(ctrl_a) - V(ctrl_b) matches the +/- marks of Vx in the drawing. For current control set ctrl_component to the component that carries Ix, and orient that component's a->b along the drawn Ix arrow. Otherwise ctrl_* fields are null.
- Use the labels in the drawing as ids (R1, Vs, Rx, ...). If a component is unlabeled, invent a short id.
- A value that the problem asks you to find, or that is not shown, is null.
- If a current arrow is drawn next to a component, orient that component's a->b along the arrow.
- phase and reactance are null except as described under AC below.

AC problems (sinusoidal sources, phasors, impedances, "jω", ∠ angles, frequencies)
- Set analysis.mode = "ac" and analysis.frequency in hertz. If only ω is given, frequency = ω / (2π) (e.g. ω = 377 rad/s -> 60). If the problem gives impedances directly and no frequency, frequency = null. For DC problems: mode "dc", frequency null, amplitude "peak".
- Sources: value = amplitude, phase = angle in degrees using the cosine reference. 10 cos(377t + 30°) -> value 10, phase 30. A sine source 5 sin(ωt) -> value 5, phase -90. A phasor 10∠30° -> value 10, phase 30.
- analysis.amplitude = "rms" when magnitudes are RMS (e.g. "120 V rms", household mains, "Vrms"); otherwise "peak".
- Capacitors and inductors given as C or L values stay capacitor / inductor. A part given only as an impedance (e.g. "−j5 Ω", "j4 Ω", "3 + j4 Ω", or a box labelled Z) is kind "impedance" with value = resistance (real part, 0 if none) and reactance = imaginary part in ohms (−j5 -> -5). An unknown reactance is null.
- In AC, givens are magnitudes (|I|, |V|) or average power.

Problem statement
- "givens": quantities the problem states as known that are not component values (e.g. "I1 = 2 mA through R1", "Vab = 3 V"). They let the solver find components with null values. component_* quantities reference a component id; voltage_between uses points a and b (V(a) - V(b)).
- "asks": every quantity the problem asks for, with a short label such as "i_x" or "Power absorbed by R3". Use component_value for an unknown component value.
- "ground": the point at the ground symbol, or the negative terminal of the main source if none is drawn, or null.
- "notes": brief remarks on anything ambiguous, assumptions you made, or parts of the problem the DC solver cannot handle (AC, transients, op-amps). Empty string if none.`;

export interface ExtractOptions {
  apiKey: string;
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  hint: string;
  signal?: AbortSignal;
}

export class ExtractError extends Error {}

export async function extractCircuit(opts: ExtractOptions): Promise<Circuit> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const text =
    "Transcribe this circuit problem into the JSON format." + (opts.hint.trim() ? `\n\nExtra context from the user: ${opts.hint.trim()}` : "");

  let message;
  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: CIRCUIT_SCHEMA } },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.imageBase64 } },
              { type: "text", text },
            ],
          },
        ],
      },
      { signal: opts.signal },
    );
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ExtractError("The API key was rejected. Check it in Settings.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new ExtractError("This API key doesn't have access to the model.");
    if (err instanceof Anthropic.RateLimitError) throw new ExtractError("Rate limited by the API. Wait a moment and try again.");
    if (err instanceof Anthropic.APIUserAbortError) throw new ExtractError("Cancelled.");
    if (err instanceof Anthropic.APIConnectionError) throw new ExtractError("Couldn't reach the Anthropic API. Check your connection.");
    if (err instanceof Anthropic.APIError) throw new ExtractError(`API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }

  if (message.stop_reason === "refusal") throw new ExtractError("The model declined to read this image.");
  if (message.stop_reason === "max_tokens") throw new ExtractError("The response was cut off; try a tighter crop of the circuit.");
  const json = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  try {
    return JSON.parse(json) as Circuit;
  } catch {
    throw new ExtractError("The model returned malformed JSON.");
  }
}

/** Downscales an image file to at most `maxSide` px and returns base64 JPEG. */
export async function prepareImage(file: Blob, maxSide = 1568): Promise<{ base64: string; mediaType: "image/jpeg"; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return { base64: url.slice(url.indexOf(",") + 1), mediaType: "image/jpeg", url };
}
