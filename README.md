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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMBWANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQABgVmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCHQVDWoXCkWisXiiVsqzSGQ4OXyhWKFGeXCmMzmiAWSxWvDWGwo1ggEAa4jA7EGYz2EAoAGU7HSNKUmQ18a9rO9PslviAshA-pYaXTxAAjZZ-CF2NB5GEhMIkBExOIJJJokDpdiZLHwAogURFYmUJwE6azfzAUnLOQUmhUywMZgwemJJYOBSdCgAYW9DQ0AAVmP6xtdTOYKH6nrbBZ5EB8Hr5RQEfpL-pJnpD4BgAEwAdmGABYABzVssw20MdgmYmgH2cCRJ1jiGBGfSQUR2BzwehDCDYOXGsBa+XTGLD0fEccgBgPOVicR+nD2cRen3iXzz-BsBCL5d7+kXg8QI89U8+pd0dgMSaidhGMCg9z0kQ4cSiIwGAaZZuy7TcmkHe8xzob8v1lQ97GPBcH2XY03wAL1iOD6VoWCEI6O8RxQ7BgJgJAuHlKcZzlOcniI6CQAadg3AESjmFw2UOPpfCkKgx9wGyWYmJgNjpwiWdWHnPjlwAoCQPEWpmm7MAZHEVB5WYJkd1oZ9X3fT8uPEX9pIUQDSO7RShwZVT1PXLTux0l8xH07CjMBcRiCY-Yz1MuSQUsncVLUjT7PAowWDfD9XOM+j+Nk8yFOWKygtszTgNAhpwucqLDN-DyvLZWKZLM+SAuUmyQvS8RphgSKDNgmKfItEr-KSwKKrsqqarq6L3M89hvOI5q-IstryvEEtKu03Tsvq2VGqG+LSrG6yJqmhyZp63K+oKkzhoSsrVsmzqd0aLKtoawE9qW1qlKO9awoilztr-frBoYm7RruoLjrSnduuey6LCaz7Eu+1TftCgGcqB-KBsKpqWygERgKir1Kl3MNr1vE8irSTKnph+b3NBsDGlqtMmpEBhKigVzDJ4wimsmJi-0ndjYPZsTiAkqS8asZhWdEmdDpS4WIj2lnWK5kWVrFmXxLehGhqltmqPE0WKq9BJunF-xmcF6X1Z5zXgu1kxdYVnmlclw21eYbmweSir6DlDgGFtoWrad9rgtd924fe-jVb1n3xvU0jyP1lW7dD02I+WKPA+VhiQ+9+OGUEul2Dgfm0+NsPVvUsAs+E5PPaNh3ZfB4KLZpmBfD-JiWPtriAD8SwATlQVAGE7iv7cdjO65kBusOboxK-bhVKzLWgU+D2P07lir845ukB7jlfgrXwybbzpeC4z6QroPr2j+39ST9e3az8roft+O43N+Xmun6rxXb4N8+P5Nx-MZ1kwPWL8L5vwAXXOm3t97f3vtXZ2a1-bPhAb-QuP1QQwDds+cud9B5wN9pNSOxIYG4I1v-Qh1sv4xx-g-MBJchI52QTQ+Bk06HZxEtAqhsDSFgJHmPJuzFJ6t2-G3VAZYYCoDyB7HBW8eGMFHo3cQE8p7CJgLEOUZZqyMLweNSau9vxaO4cwjyh9170g4anExTD8FSGYKfYhMijHX2wfYwyGdVysHXJ2aM25kIWKFq4y+u41wbi3Ducxi9-GwTcVjcJy4Q4BJrupJGKMIBo2YJUTeCT4FJOgCktJGNYnYHiVEwJxABi4VAt4uiLiSmJI8uU6Ym4qndkKQLSJspTaTXcZ4ppkgfGZNqUY7pITmnOM4X+LJ1iLwDI6f-K8rTimzJ4bkwWqTPzowXnE2OkydGbhWajdZ6SIBjL8axHZ90ykNAqb0-p0jzloMudc0JLTKF+PCmhVBFVoCkGyMBGIB4SCe3eRuDO3zfk3mOfoEgJyInAokKCgAHk2Owf4TCkCKM5BgDJ8BDiBVAD5iLkVYTRRit8WLpxQCsp5PsMKtkEwJYErieKGV1L3q82F+KQWBJ+TgEQh5mVcrqTyvlN5aVFMFnCz5wU0LsEwhM-RZ9JUZxlXK1yCyJWcvhYEpRQiN6Ks1VKiOAjlGynVfSwV2T-z4BqtxQF+qWWWsUFAG1AKKHwwFVqup1NabYQ9YatyNNoBqvZXSpVgTnUeNMX6jOEb1xsvdfai11iwV-MhXa7+YawEpoha6sVbTM1GIgEiiUqL0VPXJTi6pVCC3JuLSizcZbMXYspWEzK+g80sxrbsplibPVGPjUHUNBrOkKWyLy5g-Le1SsmsKidoqzVdvuiqrCPaM3Dv-su+VpqQ3ivNX26xOq2KrureusBh72YDs2buxdaCnUuqhdHN5p6jF3o6Lat1g7r3Pusd6oNx6n0Op-cwQNdNL3Rv-rGqNU6R2QbA-zWN7B-mMzYPUlsFkkD5Rpa0hDSGIUERQ2UtDCkMM0iUHtHDxyxakAw8hl5CamoUaLgyGjeGkJ5sY2LMALGcYtLsGR+D0xJz-LQdR7GiEejscE4hyjENiNifw7xxU5GpPCdk1x+TbHsMqZk2tdTtGPJ8alAxwTpjXK0b2tDOaP4SYtUqf6cCFM9pOO9jRSSVaxxUA1PCKIOpkT6gpOiY0mJchmhxNaUMPoNBlWIBoWqOANCkbANUbTMWxANGyKMW0kx7StmdOSAIwRAhXGMCYFIHorA2FxYGfYIBOQPCHBoAAQiQNk2AvSDBgKV2I0l3Tik2F2FkQZLBRhjG1wWTQuvAxQg2RiiHXQ5j64mJouI6AiClOKdQNjWCumwCwCgYI5jYAlOt4QITlutfAICQqoAZCIf6wMfkCwOiiGICiNMN27sUAVA0Twu3ODDlQJ59Yi3LC-j0O0B2QhNvSG23oPblgDt6GO1DjcxlsAAm3O8W7ohNg6QRd15UhUJFPdqq9pIWPPuWG+79j4-20CeaK7gCA9ABjZlAMwOUAArCATB2BR14FYdxyLciM5YOlWqsx8jDDyDL1A2AfRDidUQoakh0XAXKAwUg0nH38S9NYPzqI9rOCbC2R0IRpwIoACp0-gABQY8ukCaRwAcTKAhGvZHSICQC2ZkbuCKQNRoz4sghd9xAEIlptxRkFvMKgQA)** in the planner, or
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
