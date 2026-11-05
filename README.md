# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded. For one factory on its own, try [simple mode](https://charlesdr.github.io/Sat-Plus-Solver/simple/), which keeps its own saves.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, resource limits and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The **File** menu in the top bar keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.
5. **Getting around.** Press **Ctrl+K** (Cmd+K on a Mac) to jump to a factory or add a target by name. The top bar also switches between light, dark and your system theme, and the factory settings sidebar can be hidden to give the flowchart the whole width.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a Coal Power plant sized so world power nets to 0 MW.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#z=tVlNb-M2EP0rAs9iYHPTJvFxCwTNIcACLdrDIoexNLZZU6SWH0ncwP3tBSnbkeXIHqboJQioN28-NI-mhm-sQQ9s9sae2Wx6W7IaPPwKbsVmjJWsMfUfaJ00ms2YmIifr75cXd_esW3JFlB5YyU6Nvv-xmTNZkxao_mLsWvHSqahQTZjD9bo4s_d2tKa0D5EqPNgPVpWMos_AjofQ_Bgl-gj4dO2ZEGDc3KpsX5oWmO79ZK1Vhor_YbNJiXTxscA2COs0RV-hUWrwO_-XVhosOji3BRtUMpdJYfOBFtFu7dtyfwLwnrnc5dHMuzlcJ-I7juinDTemPTYsFmsY1BgeWKOaPDIZj9tc_Mkhe88ouKNVOo9hd_iWvHYrZ2PtTOfIzSHQK8n_0-klQHFW_OSKriL9BcDqvi2W3uv9B51oc4vh5int7dXX8Td9fYpGlWyTXEwUBJ155NDWDao4_ubLUA5LNlcmgac4_NgdW-5Ajs3yapGy1PUS9RowZseKC6PPFvIyhktQ8MXARW3puY6VArB7kJpFWj_Do-g9OeUShot_8aan8MohGd0fCQbJX8EWcen5ziaTYVKwhjJPvwVgkfLmzWf8rmRCi0_TfZzVtwpGVvism2rgs_3eGpF9xgsZPsb2lz0Jj5V0TNWdI9ZFT1jRfeYUdFRm4G3Fr01CkPDK7PGMW1-EPQ5bVpTrdGflZ8zqqevEQEdQOnhUbt0a3TkIO1xfGWaFiqf4WFgQfa0gLmVFRlI5u12NjKQzLvb7ehIMnML1RqWWPPjbfcfcTedVnf_gWCO1zcLSgRH7ZiLJ-f5YnqaPQ8jcgpyn4rM_hTZSjixIHsiKkHkKUFQlSDylCDIShCZShCjjTy9gemEUqExAsB6fnNLIMhTgviUEgRNCWJcCcnZ0SbcP35mgYn88YeRhDz-Rc1D0zy4oBbBEnM9AlP4RU4tRX4tRaolBUNjy6n3EE3zkFFvcanewUujj14Q-tVGoUa-BEdHkphfK-mx5u3KxNNbxRvw_jgDshF3KiwpTofbxscICtNqU1uzRE1DURj734V0JIX5eLfNwVLYNfhg48H8Uof0gBTe3jmdDKTw-mDnhEIcYJc5BVkmIlMm4jMyGTUiykRcrLkgFluQZCIyZCLIMhGZMhEZMhliKexEmYg8mQiqTESeTARNJmJUJnFdxjbff1xzF1q0fPX8UReeQ_s4yBwCu931uW_wIWH3xfcp3JhfQfQ7xI3z0eIb4k74zk4DTyYt50Yk6WT74dhjmzlFTsPgrl9cAbouUtjFLi1XGK0252f6T7shcu-a4n1ofxiOp4XiK7g4nK-MUtA63B_iD-PqwaR6P6Q-wT_FGate91x2txKsZAtrmuFNiTf9O4fdJDshkll3DYNxeL2WOrEFpeIVjLegXSxh79kclY-cMtZ8uj3Ebk2d7z-O4U68L-Qr1u9j9gkxkKeS1biAoHyaw5v5X1h5mT5hvzNXga3iy3-K4Si0oCtks8nVZDKZlgyUR6tTCQ89tjIKH6FaxT7ozeCdP3TVfmB3GP5vS9bA6-8pIh2UKhk8G1nfqyDrr5vWmjpU0dDbEPcr2bRKpqjSyja2ZY3fjFGRa_sv)** in the planner, or
- download the file and use **File → Import world file**, or
- print it from the command line with `pnpm world solve examples/world.json`.

- Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Milestones: [`docs/PLAN.md`](docs/PLAN.md)
- Contributor rules: [`CLAUDE.md`](CLAUDE.md)

## Development

Requires Node 22+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev         # web app (needs pnpm build:data first)
pnpm lint        # ESLint (incl. package dependency rule) + Prettier
pnpm typecheck   # tsc for every workspace
pnpm test        # Vitest
pnpm build       # production build of the web app
pnpm e2e         # Playwright end-to-end suite against the build (run pnpm build first)
pnpm build:data  # data/generated/model.json + report.md
pnpm solve --target "Iron Plate:60" [--import "Iron Ingot:30"] [--objective scarcity]
pnpm world solve examples/world.json [--json]
```

`pnpm solve` prints one factory's plan (recipes, machines, imports, byproducts, nodes, power). Run it without arguments for every option. The web app shows the same table: pick a target item and rate, and it solves in a Web Worker. `pnpm world solve` resolves a saved world (factories, links, groups) and prints its factory, link, item-ledger, power and node tables.

In a sandbox with a preinstalled Chromium, point Playwright at it with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm e2e`.

| Workspace         | Role                                                  |
| ----------------- | ----------------------------------------------------- |
| `packages/data`   | Build-time pipeline: raw SF+ JSON → `model.json`      |
| `packages/solver` | Factory layer: LP/MILP model, objectives, diagnostics |
| `packages/world`  | World layer: factories, groups, links, ledgers        |
| `packages/graph`  | Flowchart / world graph construction and layout       |
| `apps/web`        | React UI                                              |

## Deployment

CI deploys `main` to GitHub Pages: after lint, typecheck, tests, the build and the end-to-end suite pass on a push to `main`, the `deploy` job publishes `apps/web/dist`. The build uses relative asset paths, so it works under the `/Sat-Plus-Solver/` project path. Pages must be set to deploy from GitHub Actions once (repository Settings → Pages → Source: GitHub Actions).

The end-to-end suite (`apps/web/e2e`) covers the full journey (world → link → drill-down → recipe toggle → back → export → import → reload), the diagnostics fixes, saves and sharing, the flowchart, and an accessibility pass (axe, WCAG 2.1 A/AA, light and dark, plus keyboard use). Every test fails on any console error.

## Icons

The item and machine icons in `apps/web/public/icons` come from Satisfactory Modeler and are game art (Satisfactory, Satisfactory Plus). They are **not** covered by this repository's MIT licence; see [`apps/web/public/icons/NOTICE.md`](apps/web/public/icons/NOTICE.md). `python3 tooling/import-icons.py <modeler>/images/icons` regenerates them after `pnpm build:data`.
