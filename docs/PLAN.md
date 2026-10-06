# Sat-Plus-Solver — Execution Plan (rev 2)

Every milestone is merged on its own and leaves `main` green: lint, typecheck, test and build all pass.
Order: data → factory solver → an early end-to-end slice → full objectives → **world core (pure logic)** → factory UI → world UI → sharing → hardening.
References like §4.3 point into `ARCHITECTURE.md`.

| #   | Milestone                   | Ships                                                                                                        | Depends on |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| M0  | Scaffold and CI             | Empty workspaces, toolchain, CI                                                                              | —          |
| M1  | Data pipeline               | `model.json` + validation report                                                                             | M0         |
| M2  | Factory solver core + CLI   | `pnpm solve` prints a plan table                                                                             | M1         |
| M3  | **Vertical slice (web)**    | Page: one target → summary table. The store is already a one-factory `World`.                                | M2         |
| M4  | Full objectives + power     | 6 objectives, lexicographic stack, tolerance, MILP, import costing, `MW` pseudo-item                         | M2         |
| M5  | **World core** (pure) + CLI | `world` package: links, resolution, node pool, ledgers, groups; `pnpm world`                                 | M4         |
| M6  | Factory controls            | Factory view: targets, toggles, tier filter, resource limits, imports, objective stack                       | M3, M4     |
| M7  | Factory flowchart           | Interactive factory graph synced with the table                                                              | M6         |
| M8  | **World UI**                | Outer canvas, groups, link editor, ledgers, power, nodes, item trace, drill-down                             | M5, M7     |
| M9  | Saves and sharing           | Local save slots, JSON export/import, URL share, versioning                                                  | M8         |
| M10 | Hardening and release       | Perf, diagnostics UX, E2E, Pages deploy                                                                      | M9         |
| M11 | Backlog (after v1)          | Joint world optimization, SF+ golden cases, multiple power grids, transport calculators, per-group overclock | M10        |
| M12 | Plan tweaks                 | Ban, swap or import a recipe group from the flowchart; tweak list with Undo and Revert all (A35)             | M10        |
| M13 | Manual mode (proposed)      | Per-factory switch that freezes the plan for hand editing; awaiting decisions, not started                   | M12        |

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
- Tweaks are kept per factory, in order, in the `World` document (v5, A35), so they save and share. The list is the undo history: **Undo** (also Ctrl+Z) drops the last tweak, **Revert all** drops them all and returns to the pure solver plan, and each tweak can be removed on its own. There is no cap on the history.
- **Acceptance:** A ban, a swap and an import each change the plan as described and survive save → load. Undo walks back 100+ tweaks one at a time, and Revert all gives a plan identical to the untweaked solve. A v4 save migrates with no tweaks. A swap to a recipe above the max tier is offered as blocked.

### M13 — Manual mode (proposed)

- A highly visible per-factory **Solver | Manual** switch freezes the plan for hand editing without re-solving. The plan, its approaches and the decisions it needs are in the project's manual-mode plan; this milestone is not started until those decisions are made.

---

**Review checkpoints:** after M1 (miner and fracking numbers in `report.md`), after M3 (try the slice), and after M5 (world semantics, using the CLI on a sample of your own save layout).
