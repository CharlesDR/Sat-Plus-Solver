# Sat-Plus-Solver — Execution Plan

Every milestone is merged on its own and leaves `main` green: lint, typecheck, test and build all pass.
Order: data → solver → an early end-to-end slice → full objectives → UI depth → sharing → hardening.
References like §2.3 point into `ARCHITECTURE.md`.

| # | Milestone | Ships | Depends on |
|---|---|---|---|
| M0 | Scaffold and CI | Empty workspaces, toolchain, CI | — |
| M1 | Data pipeline | `model.json` + validation report | M0 |
| M2 | Solver core (LP, single objective) + CLI | `pnpm solve` prints a plan table | M1 |
| M3 | **Vertical slice (web)** | Page: pick one target → summary table | M2 |
| M4 | Full objectives | All 6 objectives, lexicographic stack, tolerance, MILP, supplied-input costing | M2 |
| M5 | Planner controls | Multiple targets, recipe toggles, tier filter, caps and weights, supply inputs | M3, M4 |
| M6 | Graph view | Interactive node graph synced with the table | M5 |
| M7 | Sharing and persistence | URL + JSON export/import, versioning | M5 |
| M8 | Hardening and release | Perf, diagnostics UX, E2E, Pages deploy | M6, M7 |
| M9 | Post-v1 (backlog) | SF+ golden cases, power self-sufficiency, per-group overclock | M8 |

---

### M0 — Scaffold and CI
- pnpm workspaces `packages/{data,solver,graph}` and `apps/web`, TS strict, ESLint (including the boundary rule from §6), Prettier, Vitest, GitHub Actions.
- **Acceptance:** CI runs lint, typecheck and test on every PR and passes. The import-boundary rule fails on a deliberate violation in a test fixture.

### M1 — Data pipeline
- Convert the xlsx to `data/nodes.csv`, adding a `site_rate_m3_min` column. Add `data/miner-model.json` and `data/overrides.json`.
- Rational parser; normalize to per minute, positive-is-draw power, stable IDs; resolve MultiMachines.
- Extraction route generator (§2.3) for Modular Miners, overclocked extractors, fracking sites and unlimited sources.
- Validations (§5) and the free-lunch loop check (which needs the LP backend in Node, so HiGHS is pulled into M1).
- **Acceptance:**
  - `pnpm build:data` produces `model.json` and `report.md`. Injecting a bad amount, an unknown part or an unmapped node resource each fails the build with a clear message.
  - Unit test: pure Montanion, Mk.3, Slug Slime, 3 full boosters → 1800/min total, 900 on each belt.
  - Every generated route at 0 boosters matches its dataset row, except the deviations whitelisted in `overrides.json`, which are listed in the report.
  - Snapshot: Iron Plate is 30 Iron Ingot/min in and 20 Iron Plate/min out, on a Constructor at 4 MW.

### M2 — Solver core + CLI
- `solver` package: `LpBackend` interface, HiGHS backend (Node), model builder (§3.1–3.2), O1 and O2, surplus and byproducts, node caps, reachability pruning, diagnostics (§3.5), and post-processing: `ceil` machine counts, power, byproducts, node usage by (resource, purity, route).
- Hand-built **vanilla-mini** dataset and 5+ golden cases you can check in satisfactory-tools. Golden harness and fixture format (§8).
- CLI: `pnpm solve --target "Iron Plate:60" [--objective scarcity]` prints the summary table.
- **Acceptance:**
  - Property tests (§8) pass on 500 random cases.
  - Vanilla-mini golden cases pass within 1e-6 relative.
  - Unreachable, infeasible and unbounded fixtures each return the expected diagnostic.
  - Benchmark: the full SF+ model with 5 targets solves in under 1 s in Node.

### M3 — Vertical slice (web)
- Vite + React app. The solver and HiGHS WASM run in a Web Worker. One target picker (item + rate), default objective O2, and a summary table: recipes, machines (fractional and rounded up), node usage, byproducts, power.
- **Acceptance:** From a fresh load, picking "Iron Plate, 60/min" shows the same table as the CLI. Playwright smoke test. The main thread never blocks for more than 50 ms during a solve.

### M4 — Full objectives
- O3 to O6 (§3.3), the lexicographic driver, the tolerance input (0.01%–90%, default 0.01%, validated), the whole-machines MILP, and the supplied-input embodied-cost toggle with its cache.
- **Acceptance:**
  - Golden cases where the secondary objective changes the plan and the primary stays within tolerance.
  - O6 picks fewer resource types than O1 on a designed fixture.
  - O5 hits the cap on a fixed-input fixture.
  - With the toggle on, the embodied cost of a supplied item equals the standalone LP optimum.
  - Tolerance values outside 0.01%–90% are rejected.
  - A MILP timeout returns the incumbent and its gap.

### M5 — Planner controls
- Multiple targets. Recipe toggles: standard on, alternates off, bulk on/off, search, max-Tier filter. Node cap and scarcity weight editor, seeded from `nodes.csv`. Supplied inputs. Objective stack editor.
- **Acceptance:** Turning on an alternate makes it eligible and it appears in the plan when it is better. The tier filter removes recipes above the selected tier. Lowering a cap below usage produces the infeasibility diagnostic.

### M6 — Graph view
- `graph` package: result → nodes and edges, ELK layered layout in a worker. React Flow view with recipe, resource-node, target and byproduct node types. Edges are labeled with rates. Clicking a node highlights its table row and the reverse.
- **Acceptance:** For every node, incoming minus outgoing edge rates equal that recipe's net rates (unit test). Layout is deterministic. A cyclic plan (Converter loop) renders without overlap. A 150-node plan lays out in under 2 s.

### M7 — Sharing and persistence
- A serializable `PlannerState` (`v`, `dataHash`), lz-string URL hash, JSON export and import, and a migration hook for version changes. The last session is autosaved to localStorage, wrapped in try/catch.
- **Acceptance:** Round-trip test (state → URL → state is deep-equal). An old `v` fixture migrates. A mismatched `dataHash` shows a warning banner and still loads. URLs stay under 2 KB for typical plans.

### M8 — Hardening and release
- Diagnostics UX polish, loading states, error boundaries, a11y pass, the full Playwright suite, a GitHub Pages deploy workflow, and a README.
- **Acceptance:** CI deploys `main` to Pages. The E2E suite covers target → plan → toggle → graph → share → reload. There are no console errors.

### M9 — Backlog (after v1)
- Your SF+ golden cases. Booster power values (R1). Verifying A3, A4 and A6 in game.
- Power self-sufficiency (MW as an item, generator chains). Overclock and Somersloop settings per machine group.

---

**Review checkpoints:** after M1 (you check `report.md` and the miner and fracking numbers) and after M3 (you try the slice).
