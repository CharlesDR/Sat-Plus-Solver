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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCsAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwDMIzYWVigATwQABjlGG18QAFkYKQ41KGIINSMAG1wKqprqZgUW+iZmTNqDOrrCADp7EEdCRgNmOg4PIKhxCDKkwPReMxBW9p15RXMAMTbINT3OlmzMfQmTdcsYa1sRxxc3DxAvH25eGzAyMEYsPp3USbRQORpoCgrYKhcKRaKxeLWZYpNJsLK5fKFMiPDgTKYzRBzBZLbgrNZkSwQCB1URgVj9EY7CBkADKNmpamK9LqOOelle70SnxAGQgP3MlOpogARosfmCbAgAIw5SFBEJEWFRGJxBLIkCpVjpdHwPIgYQFAnkBy4ybTXzAImLGSkqjk8x0RgwGnxBZ2OTtMgAYS9dTUAAVGH6RpdjKYyL6Hja+e5EG87t4hX4vmLfuJHuD4ABmHKq-w2uisIwE0De9hiRPMUQwAy6SDCGx2eC0AYQTDSo1gTUyyZRLs9wh9kB0O7SkSiX1YWyiT3e0TeMe4FgICdT1c0-friCbro772TmisOjjYSsAxgYGuGlCLCiYQGOh1RZNxsLhods9exoJ9HylDdbC3cdzynI1bwAL2iUCaWoEDwLaU9u2gzAvxgJAOBlQdh2lUcHkwoCQDqVgXD4AjGBQqV6JpNDIMAi9wEyaZKJgWihzCEdmDHVip3fT9v1EapGibMApFEJUZUYell2oK8bzvB9GNEF8hLkD8cKbCTO1pGS5LnRSm2U68RDUpDNP+URCEo3Zdx00SgQM5dpNk+SzL-AwmFve8bK0si2JEvTxMWQzPJMhSvx-Oo-KswKNJfezHOZELhN0sT3Kk4zvLi0RJhgAL1JA4LnPNbK3Mijz8tMwritKoK7Ic1gnKwqrXP02q8tEAAmAqlJUpKyqlCrOrCnLeqMgahvMkbmpS1r0u0rrwty2bBoa5d6kSpbyv+NappqyStvm3z-Os5bXzajryJOnqzs87bYuXJrrsOsxKseiLnpk16fI+5KvrS9qMsq6soCEL9As9coV1DI8T23TKUgSq6QfGuzft-eoStTSqhDocooBsjTmIwyrxko18BzokD6d4wh+MEtGLEYWmeOHTbou5sI1ppmimZ5ma+ZFvi7ohzqhbpwi+N5-LPTiTp+d8anOeF+WWcVrzlaMVWJZZqXBc1uXGGZv6ovy2hpTYOhTa5o2rbqrzbftsH7rY2W1Zdvq5JwvD1Zls3fd1gPFiDz3pfIn3nfD2kOOpVg4HZuPtb92a5LAJOuOjx2tYt0X-q8g2SZgbxX0o6jzcYgA-fqAE4lSVOhG4L83LYTsupArxDq4MQv69lAAWAB2agY+90P47F-L04Z6kO7DuevIXjSTbTmeM4TyQjq3p2d9XuS99u1aD8LrvV+27Xl9nkub6LyXz41w+n516-EZVhg1bvo+H6-mXMmztN6v0vsXa2c13ZXj-u-TOL1gQwDtlefOF9O4QNdoNQOBIwHoIVp-bBxsX4hzflfABOdOIp1gWQyBg0KHJ24qAkh4D8EAJ7n3KuVFB61yfHXJUY8YAqgdmglebD6C90rqIAeQ9eEwGiNKMeAAOahGC+qDXXk+FRrDaH2W3ovGkTDY56JoZgiQjB964NETo0+qDLEaQTjOZgc4GxRiXFBIxXN7HHxXLOeci5lyGOnp4kCDikaBKnD7LxJc5JQxhhAOGjByjLyiZAmJ0A4kJIRuEzAkSQneMIH0FCP5XGkTsXk6J9lCmTAXCUps2SObBKlLrQajjnE1PEG45J5SdGtL8bU2xzDXwpNMfuLpTTP6Hnqbk8ZbD0mc3iQ+eGU8Imh2GWohcczYaLMSRAAZHiaJrPOgUuoRT2mdJEYchBxzTn+LqcQjxflYLwPytAYgmQvxRHXEQR2jz5wJ1ee848uzdBED2UE35Yh-kAA9Kw2FfEYYgBQrJ0FpLgTsPyoBPOhbCxCCKkW3hRUOKAhkHKtjBSsjGWLvGMQxVSipG97ngsxX87xbysBCA3LSllFS2UcuPOSnJnMIXPK8rBVgCEhmaIPsKhOYqJU2SmUK5lkLvHSJ4UvaVyqRUBy4TIqUirKXctSW+XAxUmLfM1XS418goBmq+UQ8GXKVUVOJqTJCTrtW2RJtABVjKKUyu8bapx+iPUJyDXOBljrLVGtMQCj5wKLWvwDQAuNQL7UCoacmnREAYWinhYiq6hK0WlJIVm2Nua4ULgLci1FxKAkJV0BmmmZb1k0ujc6nRkavb+q1c08SmR2WME5e2kVg1eVDv5Qalt505WITbUm3tn9Z2Sv1X6wVhqO2mLVbRedpbF0AO3fTLtyz13ToQTau1ILg4PP3Toi9bRzUOu7ae29pjXU+t3Teq1b7GDerJse0Nn9w0hpHX24DAH2bhtYJ8ymLBKnVn0kgNKZL6lQZg0C9CcGCkIfEkhykCg1pod2XzYgSHYN3KjZVIjWdaRkYw5BDN1G+ZgDoyjOpNgCOQcmAOT5CDSPIwgl0Rj3HoPEYBrhgTmH2NykIyJ3j4mWOSYY6huTYm5qKfI-ZDj4oqPcf0TZcja1gZjWfDjaqxS-R-gJmtGxztiICRLb2Cg6oYQRG1AiPUpIURGjRNkU0mIrQhm9GoXKhA1AlSwGofDYBKiqbCyIOomRhg2nGHaGsToSR+ECOWPQhgjBJHdBYKw6KAy7BAGyO4nY1AACEiDMkwJ6foMB8vRCEm6EU6xGyMkDOYSM0YGucwaC1760FITYWgy6bMHWEwNCxDQIQ4oRSqDMcwF0mAmBkBBDMTAopFuCD8bN+r4B-gZVAFIaDnW+g8jmG0YQhBESpjOxdsgso6juHW+wLsSpnOrGm+YF8OhWgWwEMtyQq2dAbfMFtnQu2Qfzi0pgP4S5XjneEOsZSULWsKgyiqG7JV7sJBR898wr33tvE+8qZzOWly0D6FmUAjBpQACsIAMFYEHbgoxbT4k4DlpgcUSrTFyIMUsOQlSYG9J2G1ODOriERV+UodBiCievWxT0lgPNIjWo4Ss1YHRBCHFCgAKhT+A75+hBAtEuSMnNZgUCAA)** in the planner, or
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
