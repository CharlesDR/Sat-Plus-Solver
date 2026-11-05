# Adding an SF+ mod version

The planner keeps one read-only `game_data.json` per SF+ mod version in `mod-versions/<version>/` (ARCHITECTURE A111). These tools read a new version's recipes straight from the mod files and write its dataset. They need .NET and the mod files, so they are not run in CI.

Used for 2026.4.651 (2026-11-05). Mod paks are cooked with tagged properties, so no .usmap is needed. Run the Python scripts with `python3 -I` from outside the work folders.

1. Get the mods zip into the container. Device staging caps files at 400 MB, so split it on the PC first (byte-exact 380 MB parts) and `cat` them back; check the SHA-256.
2. Unzip `*.utoc *.ucas *.pak *.yml *.uplugin` into `mods/`. The version is `VersionName` in `SatisfactoryPlus.uplugin`.
3. `apt-get install dotnet-sdk-10.0`; build `RecipeDump.csproj` (CUE4Parse from NuGet). It only lists files and saves raw package bytes; it cannot parse IoStore packages without the game's global.utoc, which is why the Python reader exists.
   `dotnet RecipeDump.dll mods raw '/(Recipe_|Desc_|Build_|Res_|SlugDesc_|ST_|StringTable|Schematic)[^/]*\.uasset$|/Content/CDO/' raw`
4. `strtables.py raw strtables.json`, then `reach.py raw mods out/reach.json`.
5. The base dataset `<base>` is the newest `mod-versions/<version>/game_data.json`. Loop three times: `build.py raw mods strtables.json <base> out`, then `align.py out/extracted-recipes.json <base> out/learned-names.json`; run `build.py` once more.
6. `final.py out/extracted-recipes.json <base> out <new version>` writes `game_data-<new version>.json` (the base with the changed recipes replaced by the mod-file values), `changes-<new version>.md` and `not-in-dataset-<new version>.json` (mod recipes the dataset lacks).
7. Check the changes in game where they look surprising, and add any in-game confirmations to `final.py` (see the 2026.4.651 block). Packaging recipes keep the dataset values: SF+ rewrites them while the game loads.
8. Copy the dataset to `mod-versions/<new version>/game_data.json` and the change list to `changes.md` beside it, then run `pnpm build:data`. It builds every version and fails on any error. If the new version changes something a shared file in `data/` describes (node counts, scarcity weights, areas, alternate unlocks, overrides), that file may have to become per-version first (A111).

Readers: `zen.py`/`uasset.py` parse UE 5.5-format zen packages (package version UE5 1017) and tagged properties; `cityhash.py` resolves imports to the right class in packages that hold several (checked against every export hash).
