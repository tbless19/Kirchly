# Circuit Lens

Upload a photo of a circuit problem and Circuit Lens solves it. It shows animated current flow, colors nodes by voltage, and walks through the solution step by step.

- **Reads the picture:** Claude's vision model turns the photo into a netlist (components, values, unknowns, given quantities, layout).
- **Solves locally:** Modified Nodal Analysis finds every node voltage and component current. Unknown component values are solved from the given quantities, e.g. "find Rx if I = 2 mA".
- **Animates:** current dots move at a speed scaled to the current, wires are colored by voltage, resistors glow by power, and a walkthrough steps through KCL at each node, Ohm's law, the power balance, and the answers.
- **Editable:** fix any misread value and the circuit re-solves instantly.
- **Circuit editor:** click **✎ Edit circuit** (or **New** for a blank grid) to add, move, rewire and delete parts. Shortcuts: S select, W wire, R/V/I/C/L parts, G ground, D delete, Ctrl+Z / Ctrl+Y undo/redo. A part ending on a wire's middle joins it automatically. Select a part to rename it, change its type or value (`?` = unknown), flip its direction, pick a dependent source's control, or add known measurements.

Supported parts: resistors, capacitors, inductors, impedances (R + jX), independent voltage and current sources, and VCVS / VCCS / CCVS / CCCS.

- **DC:** steady state (capacitors open, inductors shorted).
- **AC:** single-frequency phasor analysis. Sources are A∠φ (cosine reference, peak or RMS), Z_C = 1/(jωC), Z_L = jωL. Results are polar phasors with real and reactive power. The animation shows current sloshing with i(t), wires pulse with v(t), and the **Waveforms** panel shows the selected part's rotating phasors and v(t)/i(t) traces.

Transients and op-amps aren't supported yet.

## API key

Reading photos calls the Anthropic API from the browser with the visitor's own key. It is entered under **API key** and kept only in that browser's local storage. Because the site is static, there is no server that could hold a key. The built-in examples and manual JSON editing work without a key.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # solver unit tests
npm run build    # static site in dist/
```

Open `?example=0` … `?example=6` to load an example directly (4–6 are AC).

## Deploy to GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Each push to `main` then runs the tests, builds, and publishes to `https://<user>.github.io/<repo>/`.

## Layout

| File | Purpose |
|---|---|
| `src/extract.ts` | Claude vision call and the JSON schema for the netlist |
| `src/solver.ts` | DC/AC MNA solver (complex), unknown-value solver, wire current distribution |
| `src/complex.ts` | Complex arithmetic for phasors |
| `src/scope.ts` | AC phasor diagram and waveform panel |
| `src/render.ts` | SVG schematic and current-flow animation |
| `src/explain.ts` | Step-by-step walkthrough |
| `src/main.ts` | UI wiring |
| `src/examples.ts` | Built-in example circuits |
