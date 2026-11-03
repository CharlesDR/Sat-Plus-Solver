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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#z=tVlNb-M2EP0rBs9iYLNpk_VxCwTNIcACLdDDwoexNLZZU6SWH0ncwP3tBSnbkeVIHqboJQioN28-NI-mhm-sRg9s_sae2Xz2S8Eq8PAbuA2bM7Yv2ApKb6xEx-bf35is2JxJazR_MXbrWME01Mjm7NEaPfnzsLa2JjSPEeo8WI-WFczij4DOR0ce7Bp9JFzsCxY0OCfXGqvHujG2XS9YY6Wx0u_YfFowbXwMgD3BFt3Eb3DSKPCHf1cWapy0ce4mTVDK3SSHzgRbRru3fcH8C8L24POQRzLs5PCQiB5aopw03pj0WLM5q00VFFiemCMaPLL5z_vcPEnhO4-oeC2Vek_h97g2eWrXxmNtzZcI9SnQ2-n_E2lpQPHGvKQKHiL91YCafDusvVf6iLpS55dTzLP7-5ufxJfb_SIalbJJcTBQEnXrk0NY16jj-5uvQDks2FKaGpzjy2B1Z7kEuzTJqkLLU9Rr1GjBmw4oLg88W8nSGS1DzVcBFbem4jqUCsEeQmkUaP8Oj6D055JKGi3_xoqPYRTCMzo-kI2SP4Ks4tMxjnpXopIwRHIMf4Pg0fJ6y2d8aaRCyy-T_ZwVd0rGlrhu26jg8z1eWtE9BgvZ_vo2V72JT1V0xIruMauiI1Z0jxkVHbTpeWvQW6Mw1Lw0WxzS5gdBj2nTmnKLflR-zqiOvgYEdAKlh2ft0q7Rkb20h_GlqRsofYaHngXZ0wqWVpZkIJm33dnIQDLvYbejI8nMDZRbWGPFz7fdf8SX2az88h8Ilnh7t6JEcNaOuXhyni-mo9lxGJFTkPtUZPanyFbChQXZE1EJIk8JgqoEkacEQVaCyFSCGGzk2R3MppQKDREAVsu7ewJBnhLEp5QgaEoQw0pIzs424e7xMwtM5I8_jCTk-S9qHprmwQW1CpaY6xmYwi9yainyaylSLSkYGltOvftomoeMeotr9Q5eGn32gtBvdgo18jU4OpLE_FpKjxVvNiae3kpeg_fnGZCNuFNhTXHa3zY-RlCYNrvKmjVqGorC2P0upCMpzOe7bQ6Wwq7BBxsP5tc6pAOk8HbO6WQghdcHuyQU4gS7zinIMhGZMhGfkcmgEVEm4mrNBbHYgiQTkSETQZaJyJSJyJBJH0thJ8pE5MlEUGUi8mQiaDIRgzKJ6zK2-fHjmrvQoOWb54-6cAzt4yCzD2x31-euwYeE7Rffp3BDfgXRbx83zEeLr4-74BudBl5MWsZGJOlk--HYY585RU7D4LZf3AR0NUlhTw5puYnRajc-018chsida4r3of1pOJ4WJl_BxeF8aZSCxuHxEH8aV_cm1cch9QV-EWesettx2d5KsIKtrKn7NyXedO8cDpPshEhmrIjXBxiH11upE1tQKl7BeAvaxRJ2ni1R-cgpY81n-1Ps1lT5_uMY7sL7Sr5i9T5mnxIDWRSswhUE5dMc3iz_wtLL9An7nbkSbBlf_iKGo9CCLpHNpzfT6XRWMFAerU4lPPXYxih8gnIT-6Azg3f-1FXHgd1p-L8vWA2vf6SIdFCqYPBsZPWggqy-7hprqlBGQ29D3K9k3SiZokor-9iWFX4zRkWu_b8)** in the planner, or
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
