import type { Circuit } from "./types";

const none = { ctrl_a: null, ctrl_b: null, ctrl_component: null };

export const EXAMPLES: Circuit[] = [
  {
    title: "Series–parallel divider",
    points: [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 3, y: 0 },
      { id: "p3", x: 6, y: 0 },
      { id: "p4", x: 6, y: 3 },
      { id: "p5", x: 3, y: 3 },
      { id: "p6", x: 0, y: 3 },
    ],
    wires: [
      { a: "p2", b: "p3" },
      { a: "p4", b: "p5" },
      { a: "p5", b: "p6" },
    ],
    components: [
      { id: "V1", kind: "voltage_source", a: "p1", b: "p6", value: 12, ...none },
      { id: "R1", kind: "resistor", a: "p1", b: "p2", value: 1000, ...none },
      { id: "R2", kind: "resistor", a: "p2", b: "p5", value: 2000, ...none },
      { id: "R3", kind: "resistor", a: "p3", b: "p4", value: 3000, ...none },
    ],
    ground: "p6",
    givens: [],
    asks: [
      { label: "Current through R1", quantity: "component_current", component: "R1", a: null, b: null },
      { label: "Voltage across R3", quantity: "component_voltage", component: "R3", a: null, b: null },
    ],
    notes: "",
  },
  {
    title: "Find the unknown resistor",
    points: [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 4, y: 0 },
      { id: "p3", x: 4, y: 3 },
      { id: "p4", x: 0, y: 3 },
    ],
    wires: [{ a: "p3", b: "p4" }],
    components: [
      { id: "V1", kind: "voltage_source", a: "p1", b: "p4", value: 10, ...none },
      { id: "R1", kind: "resistor", a: "p1", b: "p2", value: 2000, ...none },
      { id: "Rx", kind: "resistor", a: "p2", b: "p3", value: null, ...none },
    ],
    ground: "p4",
    givens: [{ quantity: "component_current", component: "R1", a: null, b: null, value: 0.002 }],
    asks: [
      { label: "Rx", quantity: "component_value", component: "Rx", a: null, b: null },
      { label: "Power in Rx", quantity: "component_power", component: "Rx", a: null, b: null },
    ],
    notes: "I(R1) = 2 mA is given.",
  },
  {
    title: "Two-source, two-mesh",
    points: [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 3, y: 0 },
      { id: "p3", x: 6, y: 0 },
      { id: "p4", x: 6, y: 3 },
      { id: "p5", x: 3, y: 3 },
      { id: "p6", x: 0, y: 3 },
    ],
    wires: [
      { a: "p4", b: "p5" },
      { a: "p5", b: "p6" },
    ],
    components: [
      { id: "V1", kind: "voltage_source", a: "p1", b: "p6", value: 10, ...none },
      { id: "R1", kind: "resistor", a: "p1", b: "p2", value: 2, ...none },
      { id: "R2", kind: "resistor", a: "p2", b: "p5", value: 4, ...none },
      { id: "R3", kind: "resistor", a: "p2", b: "p3", value: 6, ...none },
      { id: "V2", kind: "voltage_source", a: "p3", b: "p4", value: 5, ...none },
    ],
    ground: "p6",
    givens: [],
    asks: [
      { label: "Current through R2", quantity: "component_current", component: "R2", a: null, b: null },
      { label: "Power delivered by V2", quantity: "component_power", component: "V2", a: null, b: null },
    ],
    notes: "",
  },
  {
    title: "Dependent source amplifier",
    points: [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 3, y: 0 },
      { id: "p3", x: 3, y: 3 },
      { id: "p4", x: 0, y: 3 },
      { id: "p5", x: 6, y: 0 },
      { id: "p6", x: 9, y: 0 },
      { id: "p7", x: 9, y: 3 },
      { id: "p8", x: 6, y: 3 },
    ],
    wires: [
      { a: "p1", b: "p2" },
      { a: "p3", b: "p4" },
      { a: "p5", b: "p6" },
      { a: "p7", b: "p8" },
      { a: "p8", b: "p3" },
    ],
    components: [
      { id: "I1", kind: "current_source", a: "p4", b: "p1", value: 0.002, ...none },
      { id: "R1", kind: "resistor", a: "p2", b: "p3", value: 1000, ...none },
      { id: "E1", kind: "vcvs", a: "p5", b: "p8", value: 2, ctrl_a: "p2", ctrl_b: "p3", ctrl_component: null },
      { id: "R2", kind: "resistor", a: "p6", b: "p7", value: 2000, ...none },
    ],
    ground: "p4",
    givens: [],
    asks: [
      { label: "Output voltage (across R2)", quantity: "component_voltage", component: "R2", a: null, b: null },
      { label: "Current through R2", quantity: "component_current", component: "R2", a: null, b: null },
    ],
    notes: "E1 = 2·V(R1).",
  },
];
