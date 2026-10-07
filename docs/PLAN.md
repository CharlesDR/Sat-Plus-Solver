# Sat-Plus-Solver — Execution Plan (rev 2)

Every milestone is merged on its own and leaves `main` green: lint, typecheck, test and build all pass.
Order: data → factory solver → an early end-to-end slice → full objectives → **world core (pure logic)** → factory UI → world UI → sharing → hardening.
References like §4.3 point into `ARCHITECTURE.md`.

| #   | Milestone                   | Ships                                                                                                            | Depends on           |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------- |
| M0  | Scaffold and CI             | Empty workspaces, toolchain, CI                                                                                  | —                    |
| M1  | Data pipeline               | `model.json` + validation report                                                                                 | M0                   |
| M2  | Factory solver core + CLI   | `pnpm solve` prints a plan table                                                                                 | M1                   |
| M3  | **Vertical slice (web)**    | Page: one target → summary table. The store is already a one-factory `World`.                                    | M2                   |
| M4  | Full objectives + power     | 6 objectives, lexicographic stack, tolerance, MILP, import costing, `MW` pseudo-item                             | M2                   |
| M5  | **World core** (pure) + CLI | `world` package: links, resolution, node pool, ledgers, groups; `pnpm world`                                     | M4                   |
| M6  | Factory controls            | Factory view: targets, toggles, tier filter, resource limits, imports, objective stack                           | M3, M4               |
| M7  | Factory flowchart           | Interactive factory graph synced with the table                                                                  | M6                   |
| M8  | **World UI**                | Outer canvas, groups, link editor, ledgers, power, nodes, item trace, drill-down                                 | M5, M7               |
| M9  | Saves and sharing           | Local save slots, JSON export/import, URL share, versioning                                                      | M8                   |
| M10 | Hardening and release       | Perf, diagnostics UX, E2E, Pages deploy                                                                          | M9                   |
| M11 | Backlog (after v1)          | Joint world optimization, SF+ golden cases, multiple power grids, transport calculators, per-group overclock     | M10                  |
| M12 | Plan tweaks                 | Ban, swap or import a recipe group from the flowchart; tweak list with Undo and Revert all (A35)                 | M10                  |
| M13 | Manual mode                 | Per-factory Solver / Manual switch: freeze the plan and edit machine counts by hand, no re-solve (A36)           | M12                  |
| M14 | Modeler files (.sfmd)       | Import a Satisfactory Modeler save as factories; export a factory or world as a `.sfmd` that Modeler opens (A37) | M13                  |
| M15 | In-game build flags         | Mark a factory as built; flag it when its plan, inputs, demand, limits or data move away from the build (A44)    | M13                  |
| M16 | Nested factories            | Factories inside factories, wired to their parent, drawn as boxes on the parent flowchart (A45)                  | M15, view path (A42) |

---

### M0 — Scaffold and CI

- pnpm workspaces `packages/{data,solver,world,graph}` and `apps/web`, TS strict, ESLint (with the dependency rule from §7), Prettier, Vitest, GitHub Actions.
- **Acceptance:** CI runs lint, typecheck and test on every PR and passes. A deliberate import from `solver` into `web` fails lint.

### M1 — Data pipeline

- `data/nodes.csv` (from the xlsx, with a `site_rate_m3_min` column), `miner-model.json` and `overrides.json`.
- Rational parser, normalization, stable IDs, MultiMachine resolution, the `MW` pseudo-item on generator recipes, belt capacities.
- Route generator (§2.3), validations and the free-lunch check (HiGHS runs in Node here).
- **Acceptance:**
  - `pnpm build:data` produces `model.json` and `report.md`. A bad amount, an unknown part or an unmapped node each fails with a clear message.
  - Pure Montanion, Mk.3, Slime, 3 full boosters → 1800/min total, 900 on each belt.
  - Generated routes match dataset rows at 0 boosters, except the whitelisted ones, which are listed in the report.
  - Iron Plate snapshot: 30 in, 20 out, 4 MW.
  - The Coal generator recipe outputs `MW` equal to its machine generation.
  - Heater snapshot (A17): Solid Fuel Heater Mk.1 (Coal) has a heater side of 15 Coal → 15 Flue Gas and a boiler side of 20 Water → 40 Steam; the Hydrogen heaters keep boiler Water and exhaust Water apart. An unclassified heater fails the build.

### M2 — Factory solver core + CLI

- `solver` package: `LpBackend` with a HiGHS Node backend; model builder (§3.1–3.2) with **imports** and **demand** inputs, so the world layer can plug in later; O1 and O2; surplus; node budgets; pruning; diagnostics (§3.5); post-processing.
- Vanilla-mini dataset and 5+ golden cases you can check in satisfactory-tools. Golden harness.
- CLI: `pnpm solve --target "Iron Plate:60" [--import "Iron Ingot:30"] [--objective scarcity]`.
- **Acceptance:**
  - 500 random property cases pass. Vanilla-mini golden cases pass within 1e-6 relative.
  - Unreachable, infeasible and unbounded fixtures return the expected diagnostics.
  - The full SF+ model with 5 targets solves in under 1 s.
  - Heaters (A17): a heater recipe's fuel and byproducts equal whole machines × recipe rate; boiler throughput ≤ capacity (20 Steam/min from Solid Fuel Mk.1 → 1 heater, 15 Coal, boiler at 50%). Random heater models pass the property check.

### M3 — Vertical slice (web)

- Vite + React. The solver and HiGHS run in a worker. The Zustand store holds a `World` with one implicit factory. One target picker and the summary table: recipes, machines (fractional and rounded up), node usage, byproducts, power.
- **Acceptance:** "Iron Plate, 60/min" matches the CLI table. Playwright smoke test. No main-thread block over 50 ms during a solve. A plan with heaters shows whole heaters and their boiler load % in both tables (A17).

### M4 — Full objectives + power

- O3–O6, the lexicographic driver, the tolerance input (0.01%–90%, default 0.01%), the whole-machines MILP, and import costing (standalone-LP mode; linked mode arrives in M5). `MW` targets for power-plant factories. Power report: draw vs generation.
- **Acceptance:**
  - Secondary objective changes the plan while the primary stays within tolerance.
  - O6 uses fewer resource types than O1 on a fixture. O5 reaches its cap.
  - Embodied cost = the standalone optimum at the imported rate (A18). Out-of-range tolerance is rejected. A MILP timeout returns the best solution and its gap.
  - O3 counts heaters as whole machines. Import cost of Steam is not inflated by heater rounding: 300/min is charged 8 heaters' fuel, not 300 (A17, A18).
  - A "2000 MW from Coal" target produces a valid fuel chain.

### M5 — World core (pure) + CLI

- `world` package: domain model (§4.1), link semantics (§4.2), resolution with SCC and fixed-point iteration (§4.3), memoized per-factory solves, node-pool accounting and the "allocate remaining" helper (§4.4), ledgers, power totals, group aggregation (§4.5), and linked-import embodied costing.
- CLI: `pnpm world solve examples/world.json` prints the factory, link, item-ledger, power and node tables.
- **Acceptance:**
  - World property tests pass: conservation, link delivery ≤ request, group aggregate = Σ descendants.
  - Scenario fixtures pass: chain, diamond, convergent cycle, non-convergent cycle, infeasible upstream marks links short, node over-allocation, power deficit closed by "size power plant".
  - Editing one factory re-solves only it and its upstream pull dependents.
  - A 30-factory world cold-solves in under 5 s.

### M6 — Factory controls (factory view)

- Multiple targets. Recipe toggles (world defaults plus per-factory overrides; standard on, alternates off; bulk, search, max-Tier filter). Resource limits editor (one row per raw resource: on/off and a max rate, A33). Unassigned imports. Objective stack editor (default: scarcity-weighted resources).
- **Acceptance:** Turning on an alternate makes it eligible and it is used when it's better. The tier filter excludes recipes above the tier. A resource limit below usage gives the infeasibility diagnostic. A per-factory override doesn't change other factories.

### M7 — Factory flowchart

- `graph.factoryGraph` plus ELK. A React Flow view with recipe, resource-node, import, export/target and byproduct nodes. Edges show rates. Selection syncs both ways with the table.
- **Acceptance:** Edge rates conserve at every node. Deterministic layout. A Converter-loop plan renders without overlap. A 150-node plan lays out in under 2 s.

### M8 — World UI

- World canvas as the home view: factory and group nodes with status, power and node badges; link edges labeled by item and rate; stubs for unmet imports and unclaimed surplus.
- Link editor: drag from a factory's export to another factory, pick the item, choose `fixed` or `pull`, set transport and see belt or pipe count.
- Groups: create, nest, collapse (boundary flows only). Breadcrumb drill-down into the M6/M7 factory view.
- Panels: item ledger (save-wide or per group), factory table, link table, power, node pool. Item trace highlighting.
- **Acceptance:**
  - E2E: create factories A and B, link Iron Plate A→B with `pull`, and A's demand updates. The ledger shows A's surplus and B's imports. Collapsing a group containing both hides the internal link.
  - Item trace highlights exactly the factories and links that touch the item.
  - Power panel totals equal the sum of the factory power values.

### M9 — Saves and sharing

- The `World` document gets a `v` field and `dataHash`, plus migrations. localStorage save slots (wrapped in try/catch), JSON export/import, and an lz-string URL share when the payload is under 8 KB (otherwise prompt to export). "Share this factory only" exports a one-factory world.
- **Acceptance:** Round trip World → JSON → World and World → URL → World is deep-equal. An old `v` fixture migrates. A `dataHash` mismatch shows a banner and still loads. Oversized worlds fall back to export.

### M10 — Hardening and release

- Diagnostics UX, loading and progress states for world solves, error boundaries, an a11y pass, the full Playwright suite, a Pages deploy workflow, and a README with a sample world.
- **Acceptance:** CI deploys `main`. E2E covers world → link → drill-down → toggle → back → export → import → reload. No console errors.

### M11 — Backlog (after v1)

- **Joint world optimization** (§4.6): opt-in, enforces map node limits exactly.
- Your SF+ golden cases. Booster power value (R1). In-game checks of A3, A4 and A6.
- Multiple power grids (A8). Transport calculators: trains, trucks, drones, Dimensional Depot. Overclock and Somersloop settings per machine group.

### M12 — Plan tweaks

- Selecting a recipe group (in the flowchart or the plan table) offers three tweaks: **Don't use this recipe**, **Swap recipe…** (the other recipes that make its main product, each with its previewed effect on the factory's machines, machine draw and raw resources) and **Import <product> instead**. Each tweak re-solves the world.
- Tweaks are kept per factory, in order, in the `World` document (v6, A35), so they save and share. The list is the undo history: **Undo** (also Ctrl+Z) drops the last tweak, **Revert all** drops them all and returns to the pure solver plan, and each tweak can be removed on its own. There is no cap on the history.
- **Acceptance:** A ban, a swap and an import each change the plan as described and survive save → load. Undo walks back 100+ tweaks one at a time, and Revert all gives a plan identical to the untweaked solve. A v5 save migrates with no tweaks. A swap to a recipe above the max tier is offered as blocked.

### M13 — Manual mode

- A large **Solver | Manual** switch at the top of the factory view. Switching to Manual freezes the current solved plan as recipe groups with fractional machine counts (A36). The factory is no longer solved; its flows are plain arithmetic on those counts and are labelled "not solver-checked". The view gets an amber frame and banner, the factory's controls are frozen, and its world-canvas node is marked Manual.
- Editing: select a group (flowchart or table) to set its machine count or remove it; add any recipe from a searchable palette. Belts are wired automatically, as in the solved flowchart. What the plan needs beyond its import caps shows as red **Missing** nodes and a "Missing inputs" table; leftovers are surplus.
- In the world: what the plan makes goes to its targets first, then its outgoing links, which run short when it makes too little. Incoming links supply up to what they carry (a pull link carries what is needed). An unbalanced plan is allowed and reported.
- **Undo** (also Ctrl+Z) and **Revert all** (back to the plan as frozen) work as for tweaks, with no cap on the history. Switching back to Solver keeps the manual plan for next time; **Discard manual plan** throws it away.
- **Acceptance:** Freezing a solved plan changes no flow, power or node figure (within 1e-6). After an edit, every Missing or surplus value matches hand arithmetic. A manual producer's links run short when it makes too little. Undo walks back 100+ edits. Save, share and reload keep manual mode and its plan. A v6 save migrates unchanged.

### M14 — Modeler files (.sfmd)

- Satisfactory Modeler stays a separate program: we read and write its save format only, and never ship its code or data (A37). Its item and machine icons are the one exception, used by the planner's own UI (A38).
- **Export.** "Export to Modeler" on a factory writes one `.sfmd` file with Modeler's calculator set to `Manual`. It works for solved and manual factories alike. Each recipe group becomes one Modeler node named by its recipe, with its machine count as an exact fraction in `Max`, its position from the flowchart layout, and an input connection for each belt in our flowchart. Raw resources become extractor nodes; imports and links become Modeler's own input points. Exporting the world writes one Outpost per factory, wired along the world's links.
- **Import.** "Import from Modeler" reads a `.sfmd` and makes one factory per top-level Outpost (or one factory when the save has none). Each factory starts in manual mode (M13, §4.7): its recipe nodes and `Max` counts become the frozen plan, so it is kept exactly as built, and its net outputs become its targets, so switching it to Solver re-solves for the same products. Our belts are wired automatically (A24), so Modeler's own wiring, splitters, mergers, storage, sinks and Dimensional Depots are not kept as nodes. A node with no `Max` (unlimited in Modeler) has no count we can freeze. Every node we can't map (an unknown name, a part or recipe missing from our data, a node without a count, a Modeler-only setting such as clock speed or Somersloops) is listed in an import report. Nothing is dropped silently.
- **Acceptance:** Exporting a solved or manual factory and importing the file back gives the same recipes and machine counts, exactly. A sample `.sfmd` fixture imports with the expected factories, counts and report entries. An exported multi-factory world opens in Modeler with every node and connection in place (checked by Charles in Modeler, since it is a closed Windows app). A malformed file shows an error and leaves the world unchanged.

### M15 — In-game build flags

- **Mark as built** in the plan toolbar stores the factory's current plan and boundary flows as its build (§4.8, A44, World v9). **Mark every factory as built** in the world view marks every factory with a plan at once.
- Every resolution checks each marked factory: can the built plan still run (inputs, demand, resource limits, recipes), and does today's plan match it. Each deficit is its own flag: **Can't get enough inputs**, **Needs expansion**, **Over a resource limit**, **Recipe no longer exists**, **Plan changed**, **Can be reduced**, **Game data changed**, with the items or recipes and rates involved, and the likely cause (own settings, world defaults, links, game data).
- The factory view shows the build state and the flags in a banner, with **Restore build** (manual mode with the built plan), **Re-mark as built** and **Clear mark**. The world canvas shows a build badge on each marked factory, and the summary counts factories off their build.
- **Acceptance:** Marking a solved or manual factory and re-resolving gives "matches" with no flags. Raising a target past the build gives Needs expansion with the exact shortfall; lowering a fixed import link gives Can't get enough inputs; lowering a resource limit gives Over a resource limit; banning a built recipe gives Plan changed with built and new counts; halving the target gives Can be reduced only. Whole-machine factories compare whole buildings. Restore build reproduces the built flows within 1e-6. A v8 save migrates with no marks, and marks survive save → load.

### M16 — Nested factories

- `Factory.parentId` (World v10, A45): a factory can sit inside another, to any depth, never in a cycle. Groups stay as folders.
- Adding a child creates pull links from the child to the parent for each of the child's targets; they can be edited like any link. The parent may also draw on a child's surplus without a link the user made. A child's links to factories outside its parent are drawn through the parent's boundary.
- The parent's flowchart draws each child as one box, with its flows as edges to and from the parent's recipes. Double-click opens the child, the breadcrumb shows the path, and Esc steps back one level (view path, A42). The world canvas draws a parent with children as a frame, or as one node with boundary flows when collapsed. Parent totals show "this factory" and "with sub-factories". Build flags (M15) roll up to the worst in the subtree.
- **Acceptance:** A child's output reaches its parent through the automatic links and the ledgers conserve. Esc from a grandchild returns to the child, then the parent, then the world. A parent cycle is rejected as an edit. A v9 save migrates with no parents. A collapsed parent shows only flows crossing its subtree.

### Graph readability track (G1–G5)

Charles, 2026-10-07: the flowchart and number-format ideas are built in five steps, each one PR, in dependency order (G1 foundations, G2 ports and routing, G3 edge and node visuals, G4 layout tuning, G5 areas). Each step adds its entry here when it is built.

#### G1 — Foundations

- **Number format (A41):** machine counts and rates show 1 to 4 decimals, rounded up to the next 0.0001; the plan tables add the exact mixed fraction where 4 decimals can't show the value ("2.3334 (2 1/3)").
- **Esc (A42):** Esc leaves a text field, then clears the selection, then backs out of the factory to the world. The view is a path, ready for nested factories.
- **Rename:** the factory settings section "Unassigned imports (n)" is now "Imports (n unassigned)".
- **Layout score (A43):** crossings, bends, edge length, area and smallest gap on three fixed plans, checked against a baseline, so later graph steps can show they improve the layout.
- **Acceptance:** 1/3 shows as 0.3334 and a 2/3 machine count as "0.6667 (2/3)" in the CLI and the web table alike. Esc from a focused field, then a selected row, then the factory view reaches the world in three presses. The layout score test passes on `main` and fails if a layout change adds crossings or crowds two boxes below 6 px.

#### G2 — Ports and routing

- **Ports (A46):** one port per item on the hexagon's slanted sides; the main product at the right vertex, other outputs above and below it. ELK picks the port order with the fewest crossings, then the ports are fixed in that order.
- **Raw-input band (A46):** imports, missing inputs, miners and other resource nodes, and recipes that take nothing (Water) sit along the top when they feed recipes at more than one stage and the chart does not feed them; one feeding a single stage sits in the chart. Their lines drop straight down beside each recipe that needs them, labelled with the rate beside the recipe. Imports are no longer pinned to the left.
- **Fan-out bundles (A46):** an output feeding several recipes draws one trunk labelled with the total, then splits; each branch shows its rate.
- **Acceptance:** on Reinforced Iron Plate 5/min, Water sits above every recipe and Iron Ingot shows one "30.0 Iron Ingot" trunk with two "15.0" branches. Every route is square and nothing overlaps on the 151-node plan, which still lays out in under 2 s. The layout score test passes against the baseline Charles approved for G2.

---

**Review checkpoints:** after M1 (miner and fracking numbers in `report.md`), after M3 (try the slice), and after M5 (world semantics, using the CLI on a sample of your own save layout).
