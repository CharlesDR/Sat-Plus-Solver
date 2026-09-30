# Sat-Plus-Solver — Architecture

Status: **draft for review**. Scope: a client-side production planner with satisfactory-tools parity, driven by the Satisfactory Plus (SF+) dataset in `game_data.json`.

Items marked **[A#]** are assumptions. They are collected in §9 so they can be confirmed or corrected.

---

## 1. Decisions at a glance

| Area | Decision | Why (short) |
|---|---|---|
| Formulation | LP over recipe rates, plus node-usage variables for extraction. It becomes a MILP only when an objective needs integers. | Handles cycles, byproducts and several producers per item directly. A tree walk can't. |
| Solver | HiGHS compiled to WASM (`highs` npm), run in a Web Worker | Fast, numerically robust, has MILP, MIT license. Model size is about 1.5k variables × 450 rows. |
| Scarce resource | **Nodes per (resource, purity)** taken from `data/nodes.csv`. Not ore/min. | Fluid modules and boosters make output per node non-linear in purity. |
| Extraction | Modular Miner routes are **generated** from a rate model that assumes max output. The dataset's miner rows are only used to calibrate and cross-check it. | You asked for max output (Mk.3, full boosters) and module combinations the dataset doesn't list. |
| Data pipeline | Build-time TS script: raw JSON → parse → normalize → validate (zod + graph checks) → `model.json` | The solver only ever sees one unit system. Bad data fails the build. |
| Units | items/min, fluids m³/min, power MW (positive = consumption) | One canonical system. |
| Stack | TypeScript, pnpm workspaces, Vite, React, Zustand, React Flow + ELK.js, TanStack Table, Vitest + fast-check | Details in §7. |
| Hosting | Static site on GitHub Pages. No backend. | Everything runs client-side. |
| Sharing | URL hash (compressed JSON) and JSON export/import, carrying schema version and dataset hash | Links show a warning when the dataset has changed. |

---

## 2. Source data

### 2.1 Inputs

| File | Role |
|---|---|
| `game_data.json` (+ `data.schema.json`) | 428 parts (51 fluids), 1146 recipes (128 alternates), 111 machines, 16 MultiMachines |
| `Nodecount Sat Plus.xlsx` → converted once to **`data/nodes.csv`** | Node counts by resource: fracking sites, impure, normal, pure. The xlsx stays in the repo for reference. `nodes.csv` gains an optional `site_rate_m3_min` override column. |
| `data/miner-model.json` (new, hand-maintained) | Parameters for the miner rate model (§2.3) |
| `data/overrides.json` (new, hand-maintained) | Exclusions, ore↔node mapping, per-recipe fixes, overclock policy |

### 2.2 Raw conventions → canonical form

| Raw | Canonical |
|---|---|
| `Amount` is a string: `"3"`, `"7.5"`, `"1/3"`, or `"1 1/3"` (a mixed number) | Parsed as an exact rational number, then converted to a float once, at the end |
| `Amount < 0` is an input, `> 0` is an output | `inputs[]` and `outputs[]`, both with positive rates |
| `BatchTime` is in seconds and is also a string (`"1/2"` to `"600"`) | `ratePerMin = amount × 60 / batchTime` |
| Fluids are already in m³. Water Extractor gives 180/min. | No ×1000 conversion. Validation fails if any fluid rate is above 10⁴/min. |
| Machine `AveragePower`: negative is draw, positive is generation | `powerMW`: positive is draw, negative is generation |
| Recipe-level `MinPower`/`AveragePower` (67 variable-power recipes) | `AveragePower` is used as the draw. The swapped pairs are logged as warnings **[A1]**. |
| Recipe `Machine` may name a MultiMachine group | Resolved to a concrete machine through MultiMachine defaults or the generated miner routes |
| Two duplicate recipe names | IDs are `slug(name)`, plus `~` and a short content hash when names collide. IDs stay stable across builds. |

Excluded by default through `overrides.json`: `Handgun` (building crafting), `Ficsmas`, storage containers, Dimensional Depot, AWESOME Sink, and Geyser (no recipes). Space Elevator phases can be picked as targets. `IgnoreInputMultiplier` and `SpaceElevatorMultiplier` are ignored **[A2]**.

### 2.3 Extraction model (the part that matters most)

**Modular Miner.** The formula comes from the SF+-aware PioneerProductionPlanner (`SFPMinerRates`) and was calibrated against every fluid-module row in the dataset:

```
effective   = max(0.5, purity + (fluidBonus + boosterBonus) × processingMalus)
primaryRate = A_mk × 60 × effective × conversionRatio      (split evenly over 2 belt outputs)
wasteRate   = primaryRate × wasteRatio                     (e.g. Crushed Gangue 1/3, Tailings Slurry 1/3)
fluidIn     = fluidBasePerMin × purity                     (not affected by boosters)
```

| Parameter | Value used | Source |
|---|---|---|
| `purity` | impure ½, normal 1, pure 2 | MultiMachine `Capacities` |
| `A_mk` | Mk.1 = 1, Mk.2 = 2, **Mk.3 = 4 (always used)** | MultiMachine `PartsRatio` 60/120/240 |
| `fluidBonus` | Derived per (ore, fluid) from the dataset. Water 0.5, Muriatic 1.0, Slug Slime 2.5 (Kerr Crystal: 0.5), Energized Slime 2.5, Sulfuric 0.5, Nitric 1.0. | Solved from the 400+ fluid-module rows. Every row agrees with this formula. |
| `fluidBasePerMin` | 30 (Water, Sulfuric), 15 (Muriatic, Nitric, Energized Slime), Slug Slime 15 or 30 depending on ore | Dataset |
| `boosterBonus` | **+3.0** (three booster slots, each full at +100%) | k-mods planner changelog v2.3 |
| `processingMalus` | none 1.0, **Crusher 0.5**, **Smelter 0.5 [A3]** | Crusher value derived from the dataset's Fluid-Crusher rows |
| `conversionRatio` | From the dataset's Crusher/Smelter rows (e.g. Sand `1 1/3`) | Dataset |
| Miner clock | 100%. Boosters take the place of overclocking. | Planner changelog v2.3 |

Check against your example: pure Montanion, Mk.3, Slug Slime → 4 × 60 × (2 + 2.5 + 3.0) = **1800/min = 900 on each belt** ✔. This is a unit test (M1).

**Route generation.** For each ore *r*, the generator produces routes over purity × processing × fluid:
- **Processing:** none, or one of the Crusher/Smelter products the dataset lists for *r*.
- **Fluid:** none, or one of the fluids the dataset lists for *r*. The no-fluid option is dropped when the dataset has no plain route for *r* (Uranium, Kerr Crystal, Sulfur).
- **Processing combined with fluid** is allowed for every ore **[A4]**. The dataset shows this only for Sulfur Powder, but the planner source treats fluid as optional on all processing routes.

Each route uses exactly one node of (*r*, purity). That comes to roughly 15 ores × 3 purities × ~3 processing options × ~4 fluid options, or about 500 routes. They replace the ~420 Modular Miner rows in the dataset. The build cross-checks each generated route at `boosterBonus = 0` and Mk 1/2/3 against the matching dataset row, and writes any mismatch to the validation report. One is already known: impure Sulfur Powder gangue is 20 in the dataset versus 15 from the formula **[A5]**.

**Other node-limited extractors.** These all run at the max clock of 250%. Power scales as clock^`OverclockPowerExponent`.

| Resource | Per node or site at max | Basis |
|---|---|---|
| Crude Oil (Oil Extractor nodes) | 90 × purity × 2.5 → 112.5 / 225 / 450 | Dataset 1.5/s |
| Algal Mass | 60 × 2.5 = 150 | Dataset + MultiMachine |
| Toxic Air (Air Collector) | 90 × 2.5 = 225 | Dataset 9 per 6 s |
| **Fracking site** (Nitrogen, Chlorine, Crude Oil) | **1500 m³/min per site** [A6] | Nitrogen benchmark: SF+ map data has 6 N₂ clusters with 10 to 20 normal-node-equivalents of satellites each, 13.33 on average. × 45 m³/min per extractor (dataset) × 2.5 (pressurizer fully overclocked) ≈ 1500. The same figure is used for Chlorine and Crude Oil, as you asked. It can be overridden per resource in `nodes.csv`. |

**Unlimited resources** (Water, Air, Excited Photonic Matter, Well Water) have no node constraint. Their extractor recipes stay in the LP as ordinary recipes, so their **machines and power are still counted**. They run at 100% clock, the most power-efficient setting.

**Farming** needs no special handling. All 20 farm recipes consume seeds, and seeds come only from Seed Extractors, which consume Dirt, Peat or Loam (1 soil → 1 of each of 3–4 seeds every 2 s). Crops are therefore limited by soil nodes through ordinary item balance. Any seeds that go unused show up as byproducts.

---

## 3. Problem formulation

### 3.1 Sets and variables

| Symbol | Meaning |
|---|---|
| *R* | Enabled recipes: dataset recipes after filters, plus generated extraction routes |
| *I* | Items |
| *N* | Node classes (resource, purity) and fracking sites, with capacity `cap_n` from `nodes.csv`, or the user's own cap if lower |
| `x_j ≥ 0` | Machine count for recipe *j*. Continuous, and the natural unit for machines and power. |
| `s_i ≥ 0` | Supplied (imported) input of item *i*, with `s_i ≤ supply_i` |
| `z_i ≥ 0` | Surplus of item *i*: byproducts and free disposal |
| `y_r ∈ {0,1}` | Whether resource type *r* is used. MILP objectives only. |
| `m_j ∈ ℤ≥0` | Whole machines. Only in "whole machines" mode. |

`a_ij` is the net rate per machine: outputs minus inputs, in items/min. For a generated miner route, one machine uses one node, so `x_j` is also its node usage.

### 3.2 Constraints

```
Item balance:     Σ_j a_ij·x_j + s_i − z_i = target_i            ∀ i ∈ I   (target_i = 0 for non-targets)
Node capacity:    Σ_{j uses n} x_j ≤ cap_n                        ∀ n ∈ N
Supply:           0 ≤ s_i ≤ supply_i
Unique resources: Σ_{j uses r} x_j ≤ cap_r · y_r                  (MILP objectives only)
Whole machines:   x_j ≤ m_j                                        (optional)
Lexicographic:    f_k(x) ≤ f_k* + tol·max(|f_k*|, ε)              for each objective already solved
```

**Byproducts.** Byproducts need no special handling. Surplus `z_i` is free disposal, and every multi-output recipe feeds the item balance of each output. Reuse of byproducts happens automatically whenever it lowers the objective.

**Cycles** (Converter ore loops, slug slime, Steam/Flue Gas) are just linear constraints, and the LP resolves them. Build-time check: the build solves `max Σ outputs` with no nodes and no supply. A nonzero result means a "free lunch" loop, which fails the build unless it is whitelisted. Excited Photonic Matter from nothing is whitelisted.

### 3.3 Objectives

All objectives are linear functions of `x`, `s` and `y`. Units are normalized so the tolerances mean the same thing across objectives.

| # | Objective | Expression | Type |
|---|---|---|---|
| O1 | Minimize raw resource use | Σ_n NNE_n · usage_n, where NNE (normal-node-equivalent) is impure ½, normal 1, pure 2, and a fracking site counts at its NNE (13.33) | LP |
| O2 | Minimize scarcity-weighted use | Σ_r usageNNE_r / totalNNE_r (using 10% of all Siterite costs the same as 10% of all Uranium). Weights can be overridden in the UI. | LP |
| O3 | Minimize machines | Σ_j x_j, or Σ m_j in whole-machines mode | LP / MILP |
| O4 | Minimize power | Σ_j powerMW_j · x_j (net) | LP |
| O5 | Maximize output given fixed inputs | max *t*, with target_i = *t* · ratio_i. Supply and node caps bound it. | LP |
| O6 | Minimize unique raw resource types | Σ_r y_r | MILP |

**Multi-priority.** The primary objective is solved first. Then its value is fixed within a tolerance and the next objective is solved, and so on. The tolerance is set by the user: **0.01% default, allowed range 0.01%–90%**, with a small absolute floor ε so an optimum of zero still behaves. After every stage, if the plan isn't unique, a tiny Σx_j regularizer (1e-9) picks a stable one.

**Supplied inputs.** Supplied items are free by default. With the "cost supplied inputs" toggle on, each supply variable `s_i` gets an **embodied cost**: the optimal value, under the same objective stack, of producing 1/min of *i* in a separate small LP. These LPs are cached for each combination of objective stack and settings. For O6, a supplied item brings in the set of resource types used by its embodied plan, through linking constraints. Either way, the result reports embodied resources separately.

### 3.4 Integer machine counts

- **Default (LP):** the result shows the fractional `x_j` and `ceil(x_j)`. Power is reported on the fractional count, since the last machine can be underclocked.
- **"Whole machines" toggle:** adds `m_j`. It only matters for O3 and O6, and those are the only places HiGHS runs branch-and-bound. Expected solve time is well under 1 s at this size **[A7]**, with a 5 s time limit that returns the best solution found and its gap.

### 3.5 Failure modes

| Case | Detection | What the user sees |
|---|---|---|
| Target unreachable | Before solving: backward reachability from targets over enabled recipes | "Nothing can produce X with the current recipe toggles", with the closest disabled recipes that would fix it |
| Infeasible (caps too tight) | HiGHS status `Infeasible` | Re-solve with elastic slacks on node caps and targets, at high penalty, and report the minimal relaxation: "needs 3.2 more pure Siterite nodes" |
| Unbounded | HiGHS status `Unbounded` (possible in O5 when unlimited sources exist) | Name the unbounded direction and ask for a cap. O5 always adds a sanity cap of 1e7/min. |
| Numerical trouble or a lexicographic stage that becomes infeasible | Status or `max |residual| > 1e-6` | Automatically retry that stage with 10× tolerance, and warn |
| Timeout (MILP) | Time limit hit | Return the incumbent solution with its optimality gap |

---

## 4. Solver choice

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **HiGHS via WASM** (`highs` npm) | Top-tier open-source LP/MILP, presolve, reliable status codes, MIT license, about 2.6 MB WASM | Large first download (lazy-loaded in a worker), string-based LP format input | **Chosen** |
| javascript-lp-solver | Tiny, pure JS | Naive simplex, fragile with 1/3-type coefficients, weak MILP, no real infeasibility info | Rejected |
| glpk.js | Mature | GPL license, slower MILP | Fallback only |
| Backend service | Any solver | Hosting, latency, and it breaks offline and static sharing | Not needed |

**Size and performance.** About 1.3k recipes and routes × about 450 items. Reverse-reachability pruning from the targets usually cuts this to a few hundred columns. An LP solve should take 10–100 ms and each lexicographic stage about the same **[A7]**. The solver runs in a Web Worker so the UI never blocks. The model is built once per settings change and reused across stages by changing objective and constraint rows, not by rebuilding.

The solver package defines an `LpBackend` interface with methods `solve(model, options) → {status, x, duals, objective}`. HiGHS is the production implementation and is injected at startup, so tests can run in Node against the same code path.

---

## 5. Data pipeline

```
game_data.json ─┐
nodes.csv ──────┼─► parse (rationals) ─► normalize (per-min, signs, IDs, MultiMachine resolve)
miner-model.json┤        ─► generate extraction routes ─► validate ─► model.json + report.md
overrides.json ─┘                                              │
                                                               └─ build fails on any error
```

| Validation | Severity |
|---|---|
| zod schema on the raw file, parts referenced but undefined, unparseable numbers | error |
| Every node resource in `nodes.csv` maps to a part; counts are non-negative integers | error |
| Every recipe's machine resolves; batch time > 0; fluid rates look like m³ | error |
| Free-lunch loop LP (§3.2) | error unless whitelisted |
| Generated routes differ from dataset rows at 0 boosters | warning, listed in the report |
| Swapped power pair, unused parts, duplicate names | warning |

The output `model.json` holds typed, flat arrays: `items[]`, `recipes[]` (id, machine, inputs and outputs per minute, power, flags, tier, alternate), `nodes[]` (id, resource, purity, cap, NNE), `extractionRoutes[]` (recipe id → node id), and `meta` (dataset hash, build parameters). It is imported statically by the web app and by the solver tests.

---

## 6. Module boundaries

```
packages/
  data/     build pipeline: raw → model.json. Node-only; depends on zod.
  solver/   pure TS, no DOM or framework: model builder, objectives, lexicographic driver,
            diagnostics, post-processing (machine counts, power, byproducts)
            → depends only on the model types and the LpBackend interface
  graph/    pure TS: SolveResult → graph (nodes/edges), ELK layout wrapper
apps/
  web/      React UI, Zustand store, persistence (URL/JSON), Web Worker hosting solver + HiGHS
```

| Package | Public API (sketch) |
|---|---|
| `data` | `buildModel(paths) → { model, report }`, `Model` types |
| `solver` | `solve(model, request, backend) → SolveResult`, `SolveRequest = { targets, supply, recipeToggles, nodeCaps, scarcityWeights, objectives[], tolerance, wholeMachines, costSupplied }` |
| `graph` | `toGraph(result, model) → { nodes, edges }`, `layout(graph) → positioned graph` |
| `web` | Everything else |

Rule: `solver` and `graph` never import from `web`. `web` never builds LP rows. ESLint enforces this with `no-restricted-imports`.

---

## 7. Tech stack

| Concern | Choice | Justification |
|---|---|---|
| Language / monorepo | TypeScript (strict), pnpm workspaces | Shared types from data to UI |
| Build | Vite | Handles the WASM and worker setup cleanly, fast dev server |
| UI | React 19 | Largest ecosystem for graph and table components |
| State | Zustand, plus a serializable `PlannerState` | Small; the state doubles as the share payload |
| Graph rendering | React Flow (@xyflow/react) | Interactive nodes and edges, pan and zoom, custom node UI |
| Graph layout | ELK.js (layered) in a worker | Handles cycles and ordered ports much better than dagre |
| Tables | TanStack Table | Sorting and grouping for the summary, recipes and resources tables |
| Styling | Tailwind | Quick, consistent styling |
| Sharing | lz-string compressed JSON in the URL hash, plus `.json` export/import | Works without a backend. Payload carries `v` (schema version) and `dataHash`. |
| Tests | Vitest, fast-check, Playwright (smoke tests) | Same toolchain as Vite |
| CI / deploy | GitHub Actions → GitHub Pages | |

---

## 8. Testing strategy

| Layer | Tests |
|---|---|
| Parsing | Table-driven: `"1 1/3"`, `"10/3"`, `"-7.5"`, bad strings |
| Miner model | Your example (pure Montanion + Slug Slime → 900 on each belt). Every generated route at 0 boosters matches its dataset row within 1e-9, except whitelisted deviations. |
| Normalization | Snapshot of a few normalized recipes (Iron Plate: 30 in → 20 out per min) |
| Solver: **property tests** (fast-check over random targets, toggles and caps) | Every item balances within 1e-6; all `x`, `s`, `z` ≥ −1e-9; node usage ≤ cap; disabled recipes unused; lexicographic stage k+1 never breaks stage k beyond the tolerance; scaling targets by k scales the LP optimum by k (single objective) |
| Solver: **golden tests** | `fixtures/golden/*.json` = `{dataset, request, expected: {recipes: {id: x}, resources, power}, tolerance}`. (a) A hand-built **vanilla-mini** dataset (~40 vanilla recipes in this schema) with cases you can check in satisfactory-tools. (b) **SF+ cases: harness ready, fixtures pending from you.** |
| Diagnostics | Infeasible, unreachable and unbounded fixtures, each producing the expected message |
| Graph | `toGraph` edge rates sum to recipe rates; layout is deterministic for a fixed input |
| Persistence | Round trip: state → URL → state is identical; an old `v` migrates; a dataset hash mismatch warns |
| E2E (Playwright) | Pick target → table shows; toggle alternate → plan changes; share URL reloads to the same plan |
| Performance | Benchmark test: the full SF+ model with 5 targets and a 3-stage objective stack finishes in under 1 s in Node (fails CI above 3 s) |

---

## 9. Risks, assumptions and open questions

| ID | Item | Impact | Mitigation / default |
|---|---|---|---|
| A1 | Variable-power recipes: `MinPower`/`AveragePower` look swapped in some rows | Power reporting | Use `AveragePower`; list the rows in the report |
| A2 | Meaning of `IgnoreInputMultiplier` / `SpaceElevatorMultiplier` unknown | Probably none | Ignored |
| A3 | Smelter-module malus assumed to be 0.5, like the Crusher | Smelter-route rates when boosted | One value in `miner-model.json`; verify in game |
| A4 | Crusher/Smelter + fluid combinations allowed for every ore | Route set | Flag in `miner-model.json` |
| A5 | Impure Sulfur Powder gangue: dataset says 20, formula says 15 | Tiny | The dataset value wins for that route (override) |
| A6 | Fracking = 1500 m³/min per site for N₂, Cl and Crude. From map data, actual Chlorine clusters are about 900. Your sheet has 3 oil sites; the map data has 2. | Scarcity of those gases | Per-resource override column in `nodes.csv` |
| A7 | Performance estimates are unmeasured | UX | Benchmark test in M2; pruning |
| R1 | **Booster module power draw is unknown** (not in the dataset) | O4 and power totals for miners | `miner-model.json.boosterPowerMW` defaults to 0 and is flagged in the UI. Please provide the value. |
| R2 | The SF+ wiki data export was archived in Mar 2026 and may lag the current SF+ version | Fracking and map numbers | All such numbers live in editable data files |
| R3 | Fractional node usage (e.g. 3.4 nodes) is an LP relaxation | Readability | The whole-machines toggle also makes node usage integer |
| R4 | Embodied-cost costing of supplied inputs adds one small LP per supplied item | Latency | Cached; only runs when the toggle is on |
| R5 | Graph readability with more than 100 recipe nodes | UX | Collapse extraction and logistics, group by tier, filter by item |

**Sources:** fluid bonuses, Crusher malus and `fluidBasePerMin` were derived from `game_data.json`. The miner rate formula is from `SFPMinerRates.h` in DerDoesewicht/PioneerProductionPlanner. Booster values are from the k-mods Production Planner changelog (v1.4-alpha and v2.3-beta). Resource-well cluster sizes are from `public/sf/map/resourceWells.json` in Satisfactory-KMods/SatisfactoryPlusWiki.
