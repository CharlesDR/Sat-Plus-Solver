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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#z=tVlNb-M2EP0rBs9iYLMpkvVxFwiaQ4AFWqCHhQ9jaWyzpkgtP5K4gfvbC1K2I8uRPEzRSxBQb958aB5NDd9YjR7Y_I09s_nsrmAVePgN3IbNGdsXbAWlN1aiY_Mfb0xWbM6kNZq_GLt1rGAaamRz9miNnvx5WFtbE5rHCHUerEfLCmbxZ0DnoyMPdo0-Ei72BQsanJNrjdVj3RjbrhessdJY6XdsPi2YNj4GwJ5gi27iNzhpFPjDvysLNU7aOHeTJijlbpJDZ4Ito93bvmD-BWF78HnIIxl2cnhIRA8tUU4ab0x6rNmc1aYKCixPzBENHtn8131unqTwnUdUvJZKvafwe1ybPLVr47G25kuE-hTo7fT_ibQ0oHhjXlIFD5F-M6Am3w9r75U-oq7U-eUU8-z-_uYX8eV2v4hGpWxSHAyURN365BDWNer4_uYrUA4LtpSmBuf4MljdWS7BLk2yqtDyFPUaNVrwpgOKywPPVrJ0RstQ81VAxa2puA6lQrCHUBoF2r_DIyj9uaSSRsu_seJjGIXwjI4PZKPkzyCr-HSMo96VqCQMkRzD3yB4tLze8hlfGqnQ8stkP2fFnZKxJa7bNir4fI-XVnSPwUK2v77NVW_iUxUdsaJ7zKroiBXdY0ZFB2163hr01igMNS_NFoe0-UHQY9q0ptyiH5WfM6qjrwEBnUDp4Vm7tGt0ZC_tYXxp6gZKn-GhZ0H2tIKllSUZSOZtdzYykMx72O3oSDJzA-UW1ljx8233H_FlNiu__AeCJd7erSgRnLVjLp6c54vpaHYcRuQU5D4Vmf0pspVwYUH2RFSCyFOCoCpB5ClBkJUgMpUgBht5dgezKaVCQwSA1fLunkCQpwTxKSUImhLEsBKSs7NNuHv8zAIT-eMPIwl5_ouah6Z5cEGtgiXmegam8IucWor8WopUSwqGxpZT7z6a5iGj3uJavYOXRp-9IPSbnUKNfA2OjiQxv5bSY8WbjYmnt5LX4P15BmQj7lRYU5z2t42PERSmza6yZo2ahqIwdr8L6UgK8_lum4OlsGvwwcaD-bUO6QApvJ1zOhlI4fXBLgmFOMGucwqyTESmTMRnZDJoRJSJuFpzQSy2IMlEZMhEkGUiMmUiMmTSx1LYiTIReTIRVJmIPJkImkzEoEziuoxtfvy45i40aPnm-aMuHEP7OMjsA9vd9blr8CFh-8X3KdyQX0H028cN89Hi6-Mu-EangReTlrERSTrZfjj22GdOkdMwuO0XNwFdTVLYk0NabmK02o3P9BeHIXLnmuJ9aH8ajqeFyVdwcThfGqWgcXg8xJ_G1b1J9XFIfYFfxBmr3nZctrcSrGAra-r-TYk33TuHwyQ7IZIZK-L1Acbh9VbqxBaUilcw3oJ2sYSdZ0tUPnLKWPPZ_hS7NVW-_ziGu_C-kq9YvY_Zp8RAFgWrcAVB-TSHN8u_sPQyfcL-YK4EW8aXv4jhKLSgS2Tz6c10Op0VDJRHq1MJTz22MQqfoNzEPujM4J0_ddVxYHca_u8LVsPrHykiHZQqGDwbWT2oIKuvu8aaKpTR0NsQ9ytZN0qmqNLKPrZlhd-NUZFr_y8)** in the planner, or
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
