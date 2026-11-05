# SF+ mod versions

One folder per Satisfactory Plus mod version, each with that version's full `game_data.json` (read-only; fixes go in `data/`). Each world in the planner names its version, and new worlds start on the newest (ARCHITECTURE A111). `pnpm build:data` builds every folder into `data/generated/<version>/`.

| Version    | Source                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026.3.489 | The released modpack. The dataset the planner used before mod versions (it matches the SF+ wiki export of 2026-08-30). Golden fixtures and data tests stay on this version. |
| 2026.4.651 | The dev beta, read from the mod files on 2026-11-05 with `tooling/mod-extract/`. What changed from 2026.3.489 is in `2026.4.651/changes.md`.                                |

To add a version, follow `tooling/mod-extract/README.md`.
