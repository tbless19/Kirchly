// Circuit description shared by the extractor (Claude), the solver and the renderer.
//
// Sign conventions (passive sign convention, used everywhere):
//   - Every two-terminal component has terminals `a` and `b` (point ids).
//   - Its current I is positive when it flows from a to b THROUGH the component.
//   - Its voltage V = V(a) - V(b).
//   - Power absorbed P = V * I (negative means the component delivers power).
//   - Voltage source: a is the + terminal, value = V(a) - V(b).
//   - Current source: value amps flow from a to b through the source (arrow points a -> b).
//   - Dependent sources: value is the gain; controlled by V(ctrl_a) - V(ctrl_b)
//     or by the current through `ctrl_component`.
//
// AC (phasor) analysis: sources are A∠phase with a time function A·cos(ωt + phase).
// `amplitude` says whether A is the peak or the RMS value; results use the same convention.

export type ComponentKind =
  | "resistor"
  | "voltage_source"
  | "current_source"
  | "capacitor"
  | "inductor"
  | "impedance" // generic Z = value + j·reactance (AC); just its resistance in DC
  | "vcvs" // voltage-controlled voltage source: V = gain * Vctrl
  | "vccs" // voltage-controlled current source: I = gain * Vctrl
  | "ccvs" // current-controlled voltage source: V = gain * Ictrl
  | "cccs"; // current-controlled current source: I = gain * Ictrl

export interface Point {
  id: string;
  x: number;
  y: number;
}

export interface Wire {
  a: string;
  b: string;
}

export interface Component {
  id: string;
  kind: ComponentKind;
  a: string;
  b: string;
  /**
   * SI base units (ohm, volt, amp, farad, henry) or gain. For sources in AC this is the amplitude;
   * for an impedance it is the resistance (real part). null = unknown to solve for.
   */
  value: number | null;
  ctrl_a: string | null;
  ctrl_b: string | null;
  ctrl_component: string | null;
  /** AC sources: phase in degrees (cosine reference). */
  phase?: number | null;
  /** Impedance only: reactance X in ohms (Z = value + jX). null = unknown. */
  reactance?: number | null;
}

export type QuantityKind = "component_current" | "component_voltage" | "component_power" | "voltage_between";

export interface Given {
  quantity: QuantityKind;
  component: string | null;
  a: string | null;
  b: string | null;
  /** In AC: a magnitude (current/voltage) or average power. */
  value: number;
}

export interface Ask {
  label: string;
  quantity: QuantityKind | "component_value";
  component: string | null;
  a: string | null;
  b: string | null;
}

export interface Analysis {
  mode: "dc" | "ac";
  /** Source frequency in hertz (AC). May be null when only impedances are given. */
  frequency: number | null;
  /** Whether AC source magnitudes are peak or RMS values. */
  amplitude: "peak" | "rms";
}

export interface Circuit {
  title: string;
  points: Point[];
  wires: Wire[];
  components: Component[];
  ground: string | null;
  givens: Given[];
  asks: Ask[];
  notes: string;
  analysis?: Analysis;
}

export const DC_ANALYSIS: Analysis = { mode: "dc", frequency: null, amplitude: "peak" };

export function analysisOf(c: Circuit): Analysis {
  return c.analysis ?? DC_ANALYSIS;
}
