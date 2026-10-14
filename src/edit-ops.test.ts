import { describe, expect, it } from "vitest";
import { addComponent, addWire, changeKind, emptyCircuit, normalize, removeComponent, renameComponent } from "./edit-ops";
import { analyze } from "./solver";

describe("edit-ops", () => {
  it("builds a solvable circuit from scratch", () => {
    const c = emptyCircuit();
    addComponent(c, "voltage_source", { x: 0, y: 0 }, { x: 0, y: 3 });
    addComponent(c, "resistor", { x: 0, y: 0 }, { x: 3, y: 0 });
    addComponent(c, "resistor", { x: 3, y: 0 }, { x: 3, y: 3 });
    addWire(c, { x: 3, y: 3 }, { x: 0, y: 3 });
    expect(c.points).toHaveLength(4);
    expect(c.components.map((k) => k.id)).toEqual(["V1", "R1", "R2"]);
    const s = analyze(c);
    expect(s.compI.R1).toBeCloseTo(5 / 2000, 9);
  });

  it("splits a wire when a component lands in its middle", () => {
    const c = emptyCircuit();
    addWire(c, { x: 0, y: 0 }, { x: 6, y: 0 });
    addComponent(c, "resistor", { x: 3, y: 0 }, { x: 3, y: 3 });
    expect(c.wires).toHaveLength(2);
    const junction = c.components[0].a;
    expect(c.wires.every((w) => w.a === junction || w.b === junction)).toBe(true);
  });

  it("rejoins a split wire when the part at the junction is deleted", () => {
    const c = emptyCircuit();
    addWire(c, { x: 0, y: 0 }, { x: 6, y: 0 });
    addComponent(c, "resistor", { x: 3, y: 0 }, { x: 3, y: 3 });
    expect(c.wires).toHaveLength(2);
    removeComponent(c, "R1");
    expect(c.wires).toHaveLength(1);
    expect(c.points).toHaveLength(2);
  });

  it("keeps a wire corner even when nothing else uses it", () => {
    const c = emptyCircuit();
    addWire(c, { x: 0, y: 0 }, { x: 3, y: 0 });
    addWire(c, { x: 3, y: 0 }, { x: 3, y: 3 });
    expect(c.wires).toHaveLength(2);
    expect(c.points).toHaveLength(3);
  });

  it("merges points moved onto each other and drops orphans", () => {
    const c = emptyCircuit();
    addComponent(c, "resistor", { x: 0, y: 0 }, { x: 3, y: 0 });
    addComponent(c, "resistor", { x: 4, y: 0 }, { x: 7, y: 0 });
    const moved = c.points.find((p) => p.x === 4)!;
    moved.x = 3;
    normalize(c);
    expect(c.points).toHaveLength(3);
    expect(c.components[0].b).toBe(c.components[1].a);
  });

  it("removes a component and its references", () => {
    const c = emptyCircuit();
    addComponent(c, "resistor", { x: 0, y: 0 }, { x: 3, y: 0 });
    addComponent(c, "cccs", { x: 0, y: 3 }, { x: 3, y: 3 });
    c.components[1].ctrl_component = "R1";
    c.givens.push({ quantity: "component_current", component: "R1", a: null, b: null, value: 1 });
    removeComponent(c, "R1");
    expect(c.components.map((k) => k.id)).toEqual(["F1"]);
    expect(c.components[0].ctrl_component).toBeNull();
    expect(c.givens).toHaveLength(0);
    expect(c.points).toHaveLength(2);
  });

  it("renames and re-prefixes ids", () => {
    const c = emptyCircuit();
    addComponent(c, "resistor", { x: 0, y: 0 }, { x: 3, y: 0 });
    addComponent(c, "resistor", { x: 3, y: 0 }, { x: 6, y: 0 });
    expect(renameComponent(c, "R1", "R2")).toMatch(/already exists/);
    expect(renameComponent(c, "R1", "Rload")).toBeNull();
    changeKind(c, c.components[1], "voltage_source");
    expect(c.components[1].id).toBe("V1");
    expect(c.components[1].value).toBe(5);
  });
});
