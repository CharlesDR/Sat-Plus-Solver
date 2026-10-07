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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCcAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwDMIzYWVigATwQABjlGG18QAFkYKQ41KGIINSMAG1wKqprqZgUW+iZmTNqDOrrCADp7EEdCRgNmOg4PIKhxCDKkwPReMxBW9p15RXMAMTbINT3OlmzMfQmTdcsYa1sRxxc3DxAvH25eGzAyMEYsPp3USbRQORoIACsFBWwVC4Ui0Vi8WsyxSaTYWVy+UKZEeHAmUxmiDmCyW3BWazIlggEDqojArH6Ix2EDIAGUbLS1MVGXU8c9LK93olPiAMhAfuZqbTRAAjRY-ME2BAARhy0KCISI8KiMTiCVRIFSrHSmPgeRAwgKRPIDnxk2mvmAJMWMnJVEp5jojBgdPiCzscnaZAAwj66moAAqMAMjS7GUxkf0PO0C9yIN53bwivxfCW-cSPcHwADMOXV-jtdFYRiJoF97DEyeYohgBl0kGENjs8FoAwgmFlJrA2rlkyiPb7hAHIDod1lIlE-qwtlE3t9om8E9wLAQU5n67ph83EG3XT3vunNFYdHGwlYBjAwNcdKEWFEwgMdDqixbzaXDRdhe-Y0C+z4ylutg7pOl4zia94AF7ROBdLUGBkFtOevawZgP4wEgHBysOo6yuODzYSBIB1KwLh8ERjBoTKjF0hh0HAVe4CZNM1EwPRI5hGOzATuxM6ft+v6iNUjQtmAUiiCqcqMIyq7UDed4Pk+zGiG+IlyF+eEtlJ3b0nJCkLspLaqbeIgaSh2n-KIhDUbs+56eJQJGausnyYpFkAQYTD3o+dk6RRHFiQZkmLMZ3lmUpP5-nUAU2cFWlvo5zmsmFon6RJnkyaZvkJaIkwwEFmlgaFrmWrlHnRV5hXmcVpXlSFDlOawLk4TV7mGfVBWiAATEVKlqSlFUylV3URXl-UmUNI2WWNrVpe1mW6T1kX5fNw1Nau9TJStlX-BtM11dJO2Lf5gW2at74dV1lFnX1F3ebt8Wri1t3HWY1XPVFr1ye9flfalP0ZZ1WXVbWUBCD+wXeuUa7hieZ67tlKRJTdYOTQ5-3-vUZXptVQh0OUUB2VprFYdV4zUe+Q4MWBjP8YQgnCRjFiMPTfGjttsW82EG103RLN83NAtiwJD1Q91IsM8RAn84V3pxJ0gu+LT3Oi4rbPKz5qtGOrUtszLwvawrjCswDMWFbQspsHQ5s8ybNsNT59uOxDj0cfLGtuwNCl4QRmtyxb-v60Hiwh97suUX7ruR-SXG0qwcCcwnusB-NClgCnPGx87OtW+LgM+UbZMwN477UbRlvMQAfoNqAqiqdCoEXlvW0nFdSFXyG1wYxeN-KAAsADs1Bx774eJxLhWZ0ztKdxH88+YvWlmxns9Z0nkgndvLu72vCn7-d62H8X3dr7tusr3PZe3yX0sX1rR-P3rN-I2rDAa-fx+P2-hXCmrst5vyvqXW2C1PY3n-h-bOb1gQwAdjeQul8u6QPdsNYORJwEYKVl-HBptX5h3ftfQBeduJpzgeQqBw1KGp14mA0hECCGAN7v3GuNEh71xfA3FU48YBqidug1e7D6B92rqIQew8+EwGiLKceAAOGhmCBrDQ3i+VRbC6GOR3kvOkzD476NoVgiQjAD54LEbos+aCrFaSTnOZgC4mwxhXDBYxPMHEnzXPORcy5VxGJnl4sCjiUZBJnH7bxZcFIwzhhABGjBygr2iVA2J0B4mJKRhEzAUTQk+MIH0NCf43HkXsfkmJjkimTCXKUlsOSuYhJlPrYaTiXG1PEO4lJFTdFtP8XUuxLD3ypLMYebpzSv7HgaXkiZ7CMncwSU+RG09InhxGeopc8z4ZLKSRAQZni6LrMuoUuoxSOldNEUcxBJyzkBPqSQzxAV4IIMKtAYgmQfxRE3EQZ2TzFxJzeR808ezdBEH2cEv5YgAUAA9qw2HfEYYgBQbJ0HpLgbsvyoDPJhXC5CiLkX3lRSOKAxknLtnBasrG2KfHMUxdSypm8HkQqxf8nx7ysBCC3HS1llT2WctPBS3J3NIUvJ8vBVgSFhlaMPiKpO4rJV2WmcKllUKfEyN4cvGVKrRVB24bImUSqqU8rSR+XApUWI-K1fSk18goDmu+cQyG3LVWVNJuTFCzqdX2TJtARVTLKWyp8Xa5xBjPVJ2DQuRlTqrXGrMYCz5ILLVv0DYA+NwKHWCsaSm3REBYXigRUim6RL0VlNIdmuNeb4VLkLSitFJLAlJV0Jmum5aNm0pjS63RUafYBu1S0ySmQOWMC5R20Vw0+XDoFYa1tl15XIXbcmvtX851SoNf6oVRrO1mPVfRBdZal2AJ3YzbtKyN0zsQba+1oLQ6PIPboy9bQLWOp7Weu9Zi3W+r3be6177GA+opiesNX8I2htHf2kDgHOYRtYF86mLAqm1kMkgDK5KGnQdg8CzC8HCmIcksh6kCgNrob2QLYgyG4P3OjdVYjOd6Tkcw9BTNNGBZgHo2jepNhCNQcmEOL5iCyOoygl0JjPGYMkaBnhwTWGOMKiI6JvjEnWNScY2h+T4mFpKYo45TjkpqM8YMXZCjG1QYTVfHjWqJSAwASJhtWxrtSJCVLf2Cgmo4QRF1EiA05I0QmgxNkc02IbRhl9GofKhA1BlSwGoAjYBKhqfCyIOomRhh2nGA6OsLoyR+ECJWPQhgjBJE9BYKwGKgy7BAByO43Y1AACEiCskwN6foMACvRBEh6MU6xmzMmDOYaMsZGvcwaK136sFoS4Rg26XMnWkwNBxDQIQkoxSqHMcwN0mAmBkBBDMTA4oluCH8XNhr4B-hZVAFIGDXW+h8jmG0YQhBkTpnO5dsg8o6juA2+wHsKoXOrBm+YN8OhWhWwECtyQa2dCbfMNtnQe3QeLh0pgP4K5XgXeEOsVS0K2tKiymqW7ZUHsJFRy98wb2PtvC+6qFzuWVy0D6DmUAjBZQACsIAMFYCHbgFgnFwuyLlpgCUyrTFyIMcsOQVSYF9N2W1uDuriCRT+UodBiBiZvRxb0lhPMog2o4astYnRBBHNCgAKpT+An5+iS6QEpLAewkp8Bq5kVI-wvw5lhq4IIVoVzRm5rMCgQA)** in the planner, or
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
