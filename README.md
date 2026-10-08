# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, resource limits and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The **File** menu in the top bar keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.
5. **Getting around.** Press **Ctrl+K** (Cmd+K on a Mac) to jump to a factory or add a target by name. The top bar also switches between light, dark and your system theme, and the factory settings sidebar can be hidden to give the flowchart the whole width.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a 300 MW Coal Power plant.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMAGANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQsEFFmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCAArFQ1qFwpForF4olbKs0hkODk8goinNLM8uFMZvjgAsliteGsNhRrBAIA1xGB2IMxnsIBQAMp2BkaUoshqE17Wd6fZLfEBZCB-Sx0hniABGyz+ELsaHQsJCYRIiJicQSSXRIHS7Ey2Pg+UKxQohMm01m-jJ2EWyzkVJoNMsDGYMEZiSWDgUnQoAGEfQ0NAAFZgBsbXUzmCj+p5OVzuEWID4PXzigI-aX-STPSHwADM6A1gVTDHYJlJIF9nAkydY4hgRn0kFEdgc8HoQwg2AVprAOsV0xivf7xEHIAYDwVYnE-pw9nE3t94l8k-wbAQ09nG8ZR63EB3PX3vpndHYDEmonYRjAoPcjJEOHEoiMDAay1bLeXJpu0vAc6FfF95W3exdynK9Z1NB8AC9YggxlaHAqCOgvPs4OwX8YCQLhFRHMcFQnJ4cNAkAGnYNwBGI5h0PlJjGUwmCQOvcBslmGiYAY0cInHVhJw42cvx-P9xFqZpWzAGRxFQRVmBZNdaFve9H2fFjxHfUSFG-fDW2knsmXkxTFxU1s1LvMRNNQnTAXEYgaP2A99IkkFjLXOSFKUyzAKMFgHyfezdMozjxMMqTlhMnzzOU39-waQLbJC7T3yclyOXCsSDMkrzZLMvzEvEaYYGCrTwLCtyCjyzyYu8oqLJKsqKtCxznPYVzcNqjyjIawrxAAJmK1T1NSyr5WqnrIvygbTOG0arPGtr0o6rK9N6qKCoWkbmrXRoUtWqrAU22b6pk3aloCoK7LWj9Ou6qjzv6y6fL2hK11au6TosGqXuit75I+-zvrS37Mq67KarrKARF-ELvUqddw1Pc89xytJktu8GpscgGAMacrPEx8ZmAYSooHs7S2OwmrJhoj9h0Y8DmYE4ghJE0mGfotmxx2uL+J1TaeaZkjBIFprxY5x7oZ60WhYl+bBe9BJukV-x6eYRmNcB2KitVkx1b5wTZZF7XeelvXGt8+gFQ4BhzZ1k2Ocl22YHt29IaeziFZd63BsU-DCM1+WLbF5h2YDhag+WEPvblqi-att3FLAbiGXYOBufD3XU6ZDPeITp3Lcj-nlaKo2KZgXwPxouiI5YgA-IaAE5UFQBhW5LiOo-zquZBrlD66MUvm6VAAWAB2WhE993P-fz5OWYZHu84r3zl+0s2c+dlON8U6RTt30u+4PqRmHWqG18Xje9ulm-96Bxb-Z3rW97LpXn5Gw3jYfk-e7l2-ijNWTBdZvzDh-M+wC7YO0fp-V2d9QQewdsXAB69gHB3xO-U+QD9aLSwTLDa6Db7APTjxLO8DoH4JGuQzOfEIFJwXk-Ghy5GCD1ruIEeY9XxN1QFPGAGBHYkJYTbEaA8h511oqPRuvCYCxAVFPAAHFQvBYinLMJXoKERCDo7vQ0R-bexCcGAK-qwo+f1IG4LMeoixaCTH2XzvOVgi5mwxlXLBJhOttJOIXEuFca5GHz28eBJxqMgmzgVj48+sN4YQERswSoa9onP0UrE7W8TnxIwgPYqxH4Un4MUsQAY6F-zuIog4gpNsiklOmMucprYInYCiaEpBzjXH1MkB45JrTgHtP8Q03JXj6JVMGj-cMPT5Ru3GZuJpVhc6jKuukhGWTElz0iQs3prDlmZJRsjOZLSplIOKQ0UpnTunoMWfok5ZyAmNOMZAwKCE9FFWgKQbIv4YhbhIE7J5S585vI+WeHJ+gSBDOCX8iQAKAAeNY7AfhMKQIotkGBMnwD2X5UBnkwrhShRFyKHyotHFAEyzkOzgo2djbF58WKYupak+yBztaQpeb5d5OARDbjpf88+7LOVngpc05lWKeUMoQuwZC+TXzcqhefcVkrGUPK8Sy-O3DZGr13iq8+aqGJGOvpqkVsqGWKCgGVViPyDX0sKZ+fAZrvlEP1e-LVDKRAU2gKhGVrLFKuspoqx1jzDVevEKalxWjPX5xDYuPVPtKXOtYYCz5IKLVOsDdM8QCbgX2sFfMqlor42wqlAipFt0iXooqQGq16iIAFvhcuYtKK0UksCclfQ2aGZxvUbSy1ebO3gSZbmo1rC+XMC5d2wd6jh3bjbcKytYzxDypQl2lNs6roLqlfKftHa506uZkuitPbt3SJ4RupVELU1IJNXa0FodlXnuAZejo5qHUxqFQO1lI0fXur3beld+jP1U2jes19W6rqRrDWO99wbphRr7ae2ckb2BfNpmwJypg1ykCQJlclcyENIeBVhFDxS6xGUw3SJQm1cM5MFhhtG0EejZsozHJkmHkP3P9VRRjgswAsfwzBJydhyOk048DKSPH0ZsZfR8aDiGqMiZo6x-jyoKPSa+fo7jtGCMSaA1JlxMmrrqYU2RmUNUwPaRprxumPUwaTTfPjOqZSAyAWJptOx-syLCXLQOKgWoERRD1CiQ0VIMSmixLkC0uJrSWDDL6DQBViAaHKjgDQRnqgqaqGIBo2RRipjtCSR05JXSrFhFcYwJgUieisDYDFQZ9ggG5A8HsGgABCJAOTYG9IMGAZXYiiQ9JKTYLY2TBksNGWM7XtZNG65YrzVZqKIbdHmfrSYmjWjoCIGUkp1AX1YG6Z0zAKBgjmNgKUG3hD+JW218AgJsqgBkIhgbAxBQLA6KIYgqISa3fuxQJUDRPDOk4L2VA3n1hLcsO+PQ7RI5CC29IHbegWAHeOEdyUvxodLl0tgAEq53h3dEJsNS0KeuqmyhgZ75U3tJBx19ywP2-sfAB2gbzs3Vz0AGLmUAzAFQACsIBMHYCHXgVhnFwtyLNlgiVyqzDyMMCs6BUDYF9D2E12CeqSCRb+coDBSAyZvZxb01gAtok2s4GsdZ8uY5gNCgAKgz+AX5BgK6QMpHABxkoCCa9kdIgJvy5jhu4EIhRVzRm1vMKgQA)** in the planner, or
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
