# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, node budget and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The "Save and share" panel keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a 300 MW Coal Power plant.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCDMAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwC5RiwIACEDLG93c3jGABt7ECM2FlYoAE8EAAYUm18QAFkYKQ41KGIINSMC3HbO7upmBSH6JmZKnoMCgsIAOkp0XjMQYdGdeUVzADERyDUd8ZZqzH1GY1MySxhrW2LHFzcPEC8fbl4bMDIwVJnb0TrRQOfoIACsFECmBCRHCkWisXi1iS-hSaUy2WgZHyRUwpVY5SqtXqHDISxW1xsEAKojArFmxS2EDIAGUqQU1E16biQI9XJYXm9Eh8QBUIN9zJYINTRAAjCAKB6g+AARhqkKCMLCESiMTiCRRaIyWRy2MYhWK+MJ1XgdRAwkYDTJVAp5jojBgNPi4nuclGZAAwh6OQAFRg+uxnQwmVbe3285z83KeW45JKfcU-cRKmxoGrq1EJuisIykxAgT3sMRx5iiGAGXSQYQ2OzwWhzCCYWUEsCwuUGZhRVvtwidkB0W6ykSib1pWvuz2ibxD3AsBAjscLmlbpcQFcTdee0c0Vh0QgiVgGMCA1w0oRYUTCAx0AoK2s1md9ZuHjs0W83mVl1sVdhyPMcCWEVgAC9ogAmlqH-ICRgPNswMwV8YCQDg5R7PtZQHIcf2PEAClYFw+BwxgEJlaiaSQkCiLHMBKjoalWBgSjezCftB3uVDf3tZ8MNrLp+lrMApFEFU5UYelbEBU9z0gq84NEe9GLkIS31EUSW1pSTpKnOTa2oRSLxU2i1NSURCFI7YN00l9tN0+SJKkmTjM-AwmGU69LPU-jiKfJyARc8SDI8193wKbzzL8-97xsuzmUCsdguEnSFT0tzDNkqLRAHGBfNUgKHMEkKRKy1yIqM-LCuK-zrNs1h7LQ8qMrC-TRAAJki+TTLPOKStSDT2ucqrwp6vqTLMhqEqa5LRvS8axK63ravk3pYrmmVSra5bQomtbpq8nzL3i3aFpalKyoOyrVrc9a8vk+rzuGsxbq0w6Hskp7PNeiz5ofZrWoE0soCEV8VPdNpRB3eiULKrazsBy6Hzumdw02r9cjKoQ6DaKBVMshG11SzBz1Ih9uyo-8aa4wgeMI8mLEKCj6b7Tqcs42FRsp9ncO4rmasFxmQZutr+ep0XMp+9z3TicYebCPm2elxgGdl7KIoVowlY57jxdVqnlcZ4X3NoWU2DoY2BY1zmju5y3raS67bfVzXzekjCsN8MqpdNrXqvcn3sKNlmA4Ns3HYi5jWNIuAI7VwOvdpFi2I48P-eTqOg8m6S9YJmBvAfUjyPV2iAD9uoAThVFU6Br92U5j9zC6kYvYLLgw7ar+UABYAHZqAlgTI5l1Px9p6lm9zyec4JSys8lhf7aF1vpMkEak5NueN4kc1gcWne7c91v1tF2eJ-PwPl7H1ez7l3rdf1y+T49h2n7hjXC6J3O7+IlPR+2sprO1PFfNe0cv5gLoK7UGgCH6fxAb1UOfsV672vl-VBcDR4IIwZAvOx044ZwgcA4OvViEJxwaQpB5CZz0A7iXUQ3de63kriqQeMA1Q23fi3L+7dO6lzIj3CubCYDRFlIPAAHDQ9eX8p60VkVA5BNlV5L2PtnfBZDJq9S3h9dBp9aE6IPldeBY4A6WVThOZgU5qzhjnM3Sx+9rG2MxuIOc1DeFOLltJHcADzHJ28SAgu0BIYQGhowNojj-yp3BmEiJsN-EU0CTE-ehAZgIXfPYvimiKJBODtJdJBRMluI8Uk1mJt8nGJcdOWcOSDEPiqcdGpdj3HyXKRY1JX8tzRJlObZ+wZPG5MaV0lRcTCjhOvDDXBATKmjLoeMqGUzIkQCGQ01S-SbIZIHKU+p985l9JvkUkpdTawdMKN5CChDubQGIJUV8UQlxEGNpc6cqdbn3L3Ks3QRA1n7NeWId5AAPYsNgHxGGII6C8sDexQBbC8qAVzgWgtghCqFkEYW4D0rZBsfy8EAuuRFRRO8CWp3UW7EliK3n7zuVgIQy4EVIppZUOljBlx4tmaS-eEFoKwWJZorlPjRA8pgiMmU5yYpUsBfvFhoiZ6UqZUK2VlFyVmOSZKxVwTHy4EKnRZ5CrqVCvkFAXVTyxYaPQYKrV+NCZwUZYa61jACbQFUhKq1BTRAmpsdPIoBrpVCq9VOVVMz1XuuMR8h53z9UCqlYSqaEavlmo5aG2NmyIAgrFOCyFZ1MVwr2fi1NN900oqzei08tIsXtJiroZNFSw3HX5Zawt0D-xuubSo2l9K9z2v9R2llXaxBts1XQkVfLbw9rjb1UdYqaRDodXQ5VNNG3-PbQu4RrDxUWpXcO4xxrTU-LQdu+du6dUjD1eailMad3HRtS65dBbr2PSss6omwaJ2bMDT699N9P1vpZoG1gjzSZnOMPJYgSAkq4vKQBoDXzkIsC2aWESEGpSKn-QObsjzubgd3PuBD0GMOAdWdzMAEHgO1pg8R2OZG4MgRsjYNDZVKPHRw+RgjNiiMsZo3hs5DGJRMcI1h36tJuPAQmBRwTVGpqkdw2J-DfHRq-v-CTWjiM2oAwuneayGMPy9CKrjNqejA74V4qBDsFBNShDhLqREBpuCFgdOiE0WI8jmh5FaNgRJbQkkaEGT0agwqEDUEVLAahUNgA6JJoLIgCiVEWJCKMFwjDplFKsG4dxIz2n9OYNktwWxqHSEQZkmB3SzBgMl6IjEXSpbNBGRk2WQBhjqyVwofQKv6PM4WUiwgZAij4NiPoToaBCAlKKVQB9mC9cwEwMgQJSSYDFKNwQtTBvFfAKkFKoApCAdjDMIoQQIZFUIEiZMIBtvCFWPKAo7hpvsFbCqCzywavmHvDoYYGsBDjckJNnQM3zBzZ0Itz7051KYF+GkF453VimSBZVkEuZVTqmmyMYQx2EiQ522QK7N3Xh3YQA9hL2AIC0BmMKcsjBZQACsIAMFYL7bgCZzwDlYpwQsTAopFVYrUeY+YagqkwJ6FsxqyxlXEJC18LQ6DECI4e4i7pLC2eRKNRwxZSy+GAEEXsQKAAqeP4BPlmEERzEAwwWkQBZoAA)** in the planner, or
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
