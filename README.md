# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, resource limits and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The "Save and share" panel keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a 300 MW Coal Power plant.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCsAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwDMIzYWVigATwQABjlGG18QAFkYKQ41KGIINSMAG1wKqprqZgUW+iZmTNqDOrrCADp7EEdCRgNmOg4PCipeMxBW9p15RXMAMTbINQ3OlmzMfQmTRcsYa1sRxxc3DxAvH25eGzAyMEYsPovRZcUHRpoCiBTAhIjhSLRWLxaxJfwpNJsLK5fKFMjXDgTKYzRBzdALMiWCAQOqiMCsfojNYQMgAZRsJLUxQpdQxt0s90eiWeIAyEDe5iJJNEACMIAproD4ABGHLAoJgsIRKIxOIJOEI1jpZHwPIgYQFHHkByYybTXzAPEE8x0RgwUnxcRXOTtMgAYTtdTUAAVGE67EdDKcyI7naNnK4OYgHhdvNy-C9+e9xJKbAgAMw5OXw8N0VhGHGge3sMSh5iiGAGXSQYQ2OzwWgDCCYEVasDg0WTKL1xuEZsgOgXEUiUSOrC2US2+2ibzd3AsBC9-tT0krmcQOddRf2vs0Vh0cbCVgGMC-VykoRYUTCAx0Ori8tl0cNWvbps0c9n4Wz2zzns7-stSPAAvaIv1JahPx-NotwbADMHvGAkA4UU2w7EUuyuOD3xAOpWBcPhUMYSDhRI0loL-N9d3ATJpjwmAiPbMJO2YbsqP7G87wfURqkacswCkURpVFRgKQnah90PY9TzI0RL3YuRb0Q8teLrMlBOE4cxPLCSDxEaTwLkz5REIPD1iXRSuJ+VSJwEoSRO058DCYI8T0M+TsOozjlJ48U1LszTRPvR86mc-S3Nky8TLMmlPI4pTuJs-iNIc4LREmGBXJkz8PIs-UEusvzbJSrS0oyrL3OM0zWHM+D8qslSiuS0QACZUvEyTwuy4Vcrq7zEqa9TWvanTOoqyKqpihT6p8pKhra0qJ3qMLxpyz5pv6wq+PmkanJcgyJqvarapwzbGu2uyFqCidyoOtazDys7fIuwSrsc26Ivu6KativKCygIR7zc21yknT1103Bc4pSUL9s+nrjKep96ky9xodGRg6HKKBDNkijYLy8Y8KvVtiM-UmmMIFi2PRonCIpjs5oCxjwWmumSbQ5imZKzmqeO366vZlmucG5nbTiTphd8QnGGJqXnv8lLxaMSWGeY-m2dl+neYV4r7NoEU2DoTW5bVqnuf1mBDf3b6TuooWzd15rhMQ5DpcFrWOcYSmnaGl3xTd22BZwh2dYt4SwFoklWDgWnPfl8OySj+ig5N7XvcZ0WUpVrGYG8K88IIr2yIAPxagBOaVpTocu069n3E5zqQ87AwuDHT0uxQAFgAdmoYP7fjx3E9DsmSTrhOs-s0fZI1uPTbDqfhMkdb5-Thul4kRhJp+ifh6nhbeb3xeXuGx255lheM5F0+2uV1Wj7X+vM9vsGJYYeWL49q+N9fg2jePtfc2B9fhWyNqnJ+k9X6uxxJfdeL9FbDRgXzKakD96v0jnRGOgDf6ILapg6ODEv4hyHifPBo56DN3zqINuHdzwl2lD3GAspjZoLIXrNqTcW4F3wu3Yu9CYDRBFD3AAHDghBHCTKkLHqyNhQDfaXSkVfWeqC4HPxvuQleD1v7wI0ZIrREC1GGUToOZgw5Sx+nHP+EhctZImKHCOMcE5iGD1sZ+Ex4MXH9iFnYze-1AYQGBowcoE9fGn2Ev42WgTTwgwgIYnRV4wmIOEoQPokFHyWKwkYpJesUlpMmKOTJ5YvGYB8e4kBpjzGFPEFY0J5TX6VMcUU+JNjCI5OanfT0dThQW06dOEpFh47tJ2pEoGMTgkD28UM+p5DRnRLBqDAZZSekgNSXUdJ1TamQOGYotZGynHFNUd-ZyQEFEpWgMQTI94ogziICbE5I5E4XKuRuOJugiAtNcQ8sQTyAAeeYbBXiMMQAo+k6BklwHWe5UBTl-IBWBYFoKjzgvbFANSpkqyfKmbDWFm8yLQtxeEwySzZbfLOfZS5WAhCzgJY8zelLqUbixaU0lMK6VEqAqwUCiTzy0p+ZvTl3LiVHJsWSxOtD+Hj3nmKzeEqiIqN3tKtl-KiXyCgBlcidylWEuSdeXAGrbkoMVZfGVRKhBY2gOBPl5LhLmuxsK41xzlU2tEOqsxMjrWJzdcOBVdtsWmvIc865bytUmudb00QQbXmGuZYMnF7LA3-L5ECkF+0UWQqyU6nVkiIBJsBaOVNYKIVoucaFXQsaiYBskfi7VCbq2fhJfGlV5CGWMBpbW5tkjW2zgray7NHTRCCrAjWsN-adpDp5cKRtVaB1ytJiOrNdbZ28LoVOkVXzw0gLVQa957tRWbtftutomqjV+pZU28lbU7WWoXfusdijr0419ZM89M6dreo9R2y9rrJg+obeu-s3rWA3PxiwEyxgJzECQNFTFAygMgdeTBMDqSCwqWg0SCU6N4NxOZlBiGv4uixuw37Mk0HQOHMdThYjzMwBkcQ3+EyNhMN5Wo69HidHIYUbPQ8X9wGcNsbw+Rxj4oBQsd4zcxRtH8NIa4y+njZi+M7Sk0JjDom6oftknjejBM6ofW6heRGBUMn+mfKjaaBjHYYVYpmpseJgihAhCqaE6puA5lSFqJE2RdSoiNB6e0agkqEDUJlLAahVOVHExUEQdRMjDBNOMM0hY5g5mOMYJI1oLBWChS6dYIB6QXDrGoAAQkQGkmBbT9BgEYPs2jbP4l5IsMsVJXTmF9P6EYFWGjVeiOxYECFgMyB5HwEMDQ0Q0CEAKXkqgt7MEG5gJgZA-gzEwHySbghHGjbK+AT4sVQBSGA41vorIggA0yoQGEaM9sHbIGKOo7h5vsHrNKK0DWyCXh0K0b2AhpuSFmzoBb5gls6FW99kc8lMAfHHPcfbwhFgSV+T1gEaYZRynm20YQ52EjQ+u+YW792HiPYQM9vr2AIC0D6PGUAjARQACsIAMFYG7bgFhTEAuyDmJgwVMrTFyIMLMORpSYHtHWNVsC6riBBfeUodBiB8b3dRW0lhnOwmmo4PMBYLRBHbL8gAKoT+AN5+hBANOOX0stZgUCAA)** in the planner, or
- download the file and use **Save and share → Import world file**, or
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
