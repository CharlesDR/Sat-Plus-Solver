# SF+ 2026.4.651 recipes read from the mod files

Source: `SatisfactoryModsNov5-2026.zip` (SHA-256 2d036b8c…1612), SF+ `SatisfactoryPlus.uplugin` VersionName 2026.4.651. Recipes read directly from the mod paks (tagged properties, no mappings needed) with the SatisfactoryPlus DataForge and KPatchwork YAML patches applied on top.

- Machine recipes in the mod files: **648** (25 tagged `KMods.PlannerExclude` by SF+, left out below)
- Matched to a `game_data.json` recipe: **484**; identical: **432**; different: **52**
- In the mod files but not matched to the dataset: **139** (see `not-in-dataset-2026.4.651.json`). Five of them are confirmed in game and applied below. The rest are disabled or absent in game (Refined Power, Ficsit Farming plots, Trigon repaints), T10 decor, or recipes nothing unlocks.
- Dataset recipes with no recipe asset in the mods: **662** (vanilla recipes SF+ leaves alone, miners, generators/heaters and other entries the wiki builds from building data). These are copied unchanged.

## What this covers

- Every recipe asset in the installed mods (SF+, KLib, Refined Power, Ficsit Farming, AB Fluid Extras and the rest of the zip), with SF+ DataForge and KPatchwork YAML patches applied (`target:` patches). Verified on Washed Iron against the in-game spot check.
- `game_data-2026.4.651.json` is `game_data.json` with the "Changed recipes" below replaced by the mod-file values (in-game per-batch amounts and batch time, dataset part names). Everything else (Parts, Machines, Tier, Alternate, power, miners, heaters) is copied unchanged.
- Not covered: base-game recipes SF+ does not patch (not in the mod files; dataset values kept), runtime Blueprint patches (packaging, see the Packaging section), 15 query-style YAML patches (they add the A.I. Fluid Packer as a second machine for Packager recipes and similar; no rate changes), variable power, and new tiers or unlocks.

Rates are per minute at 100% clock. Fluids in m³.

Flags: **[U]** no unlock for this recipe was found in the mod schematics; it may be unlocked another way (building recipe lists, research) or be unused.

## Changed recipes

| Recipe                       | Machine                                 | Batch (s) | Old /min                                                                                                                                         | New /min                                                                                                                                      |
| ---------------------------- | --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Modular Steel Frame          | Assembler                               | 24        | Steel Beam 7.5, Reinforced Iron Plate 10 → Modular Frame 5                                                                                       | Reinforced Iron Plate 7.5, Steel Beam 5 → Modular Frame 5                                                                                     |
| Large FaxIT Disk [U]         | Blender                                 | 80 → 20   | Medium FaxIT Disk 2.25, Power Management Relay 3.75, Alumina Solution 15, Coolant 15 → Large FaxIT Disk 0.75                                     | Medium FaxIT Disk 9, Power Management Relay 15, Alumina Solution 30, Coolant 30 → Large FaxIT Disk 3                                          |
| Diamond Power Fragment       | Chemical Reactor                        | 60 → 30   | Diamonds 8, Spent Slug Slime 12 → Power Shard Fragment 6                                                                                         | Diamonds 16, Spent Slug Slime 24 → Power Shard Fragment 12                                                                                    |
| Enriched Uranium             | Chemical Reactor                        | 6 → 12    | Uranium Chloride 60, Water 40, Concrete 40 → Encased Uranium Cell 10, Uranium Chloride 30, Muriatic Acid 80                                      | Uranium Chloride 30, Water 20, Concrete 20 → Encased Uranium Cell 5, Uranium Chloride 15, Muriatic Acid 40                                    |
| Spent Orange Slime           | Composter                               | 4 → 10    | Orange Slug 15 → Spent Slug Slime 30                                                                                                             | Orange Slug 18 → Spent Slug Slime 60                                                                                                          |
| Cobalt Plates                | Constructor                             | 4 → 8     | Cobalt Ingot 60 → Cobalt Plates 30                                                                                                               | Cobalt Ingot 30 → Cobalt Plates 15                                                                                                            |
| Pure Steel Pipe              | Constructor                             | 10        | Steel Ingot 24 → Steel Pipe 12                                                                                                                   | Steel Ingot 24 → Steel Pipe 24                                                                                                                |
| Diamond Simulant             | Converter                               | 12        | Petroleum Coke 200, Silica 40 → Diamonds 20                                                                                                      | Petroleum Coke 200, Silica 80 → Diamonds 40                                                                                                   |
| Apple Pie                    | Cooking Hub                             | 120       | Wheat 30, Apple 40, Water 10 → Apple Pie 0.5                                                                                                     | Wheat 30, Apple 40, Water 10 → Berry Pie 0.5                                                                                                  |
| Banana Bread                 | Cooking Hub                             | 15        | Wheat 40, Banana 40, Water 80 → Banana Bread 4                                                                                                   | Wheat 60, Banana 60, Water 80 → Bread 4                                                                                                       |
| Banana Pie                   | Cooking Hub                             | 120       | Wheat 30, Banana 40, Water 10 → Banana Pie 0.5                                                                                                   | Wheat 30, Banana 40, Water 10 → Berry Pie 0.5                                                                                                 |
| Corn Muffin                  | Cooking Hub                             | 120       | Wheat 30, Corn 20, Water 10 → Corn Muffin 1                                                                                                      | Wheat 30, Corn 20, Water 10 → Wheat Muffin 1                                                                                                  |
| Protein Meal [U]             | Cooking Hub                             | 24        | Alien Protein 2.5, Vegetable Meal 30 → Protein Meal 15                                                                                           | Alien Protein 2.5, Vegetable Meal 30 → Protein Meal 30                                                                                        |
| Pumpkin Pie                  | Cooking Hub                             | 120       | Wheat 30, Pumpkin 40, Water 10 → Pumpkin Pie 0.5                                                                                                 | Wheat 30, Pumpkin 40, Water 10 → Berry Pie 0.5                                                                                                |
| Synthetic Protein            | Cooking Hub                             | 12        | Biomass 150, Mycelia 60, Nutrient Mixture 37.5 → Alien Protein 5                                                                                 | Biomass 150, Mycelia 60, Nutrient Mixture 30 → Alien Protein 5                                                                                |
| Yosse Muffin                 | Cooking Hub                             | 120       | Wheat 30, Yosse Berry 20, Water 10 → Yosse Muffin 1                                                                                              | Wheat 30, Yosse Berry 20, Water 10 → Wheat Muffin 1                                                                                           |
| Potato (enriched) [U]        | Farming Platform (Crop Plot / Fluid)    | 10        | Potato Seed 30, Water 30 → Potato 30, Leaves 12                                                                                                  | Potato Seed 30, Water 30 → Potato 30, Leaves 18                                                                                               |
| Wheat (enriched) [U]         | Farming Platform (Crop Plot / Fluid)    | 10        | Wheat Seed 30, Water 30 → Wheat 30, Leaves 12                                                                                                    | Wheat Seed 30, Water 30 → Wheat 30, Leaves 18                                                                                                 |
| Carrot                       | Farming Platform (Crop Plot)            | 30        | Carrot Seed 10 → Carrot 10, Leaves 4                                                                                                             | Carrot Seed 10 → Carrot 10, Leaves 6                                                                                                          |
| Corn                         | Farming Platform (Crop Plot)            | 30        | Corn Seed 10 → Corn 10, Leaves 4                                                                                                                 | Corn Seed 10 → Corn 10, Leaves 6                                                                                                              |
| Cotton                       | Farming Platform (Crop Plot)            | 30        | Cotton Seed 10 → Cotton 10, Leaves 4                                                                                                             | Cotton Seed 10 → Cotton 10, Leaves 6                                                                                                          |
| Potato                       | Farming Platform (Crop Plot)            | 30        | Potato Seed 10 → Potato 10, Leaves 4                                                                                                             | Potato Seed 10 → Potato 10, Leaves 6                                                                                                          |
| Wheat                        | Farming Platform (Crop Plot)            | 30        | Wheat Seed 10 → Wheat 10, Leaves 4                                                                                                               | Wheat Seed 10 → Wheat 10, Leaves 6                                                                                                            |
| Mycelia (fertilized) [U]     | Farming Platform (Mycelia Plot / Fluid) | 30        | Mycelia Seed 50, Nutrient Mixture 10 → Mycelia 50, Leaves 10                                                                                     | Mycelia Seed 50, Nutrient Mixture 10 → Mycelia 50, Leaves 20                                                                                  |
| Apple                        | Farming Platform (Tree Plot)            | 60        | Apple Seed 10 → Apple 15, Leaves 2                                                                                                               | Apple Seed 10 → Apple 15, Leaves 10                                                                                                           |
| Molten Caterium              | Flexible Blast Furnace                  | 6         | Crushed Caterium 160 → Molten Caterium 80, Tailings Slurry 10                                                                                    | Crushed Caterium 160 → Molten Caterium 80, Tailings Slurry 5                                                                                  |
| Molten Cobalt                | Flexible Blast Furnace                  | 12        | Crushed Cobalt 90, Hydrogen 40 → Molten Cobalt 45, Tailings Slurry 45                                                                            | Crushed Cobalt 90, Hydrogen 40 → Molten Cobalt 45, Tailings Slurry 22.5                                                                       |
| Molten Magnitar              | Flexible Blast Furnace                  | 6         | Molten Nickel 20, Crushed Cobalt 20, Molten Iron 40 → Molten Magnitar 60, Tailings Slurry 40                                                     | Molten Nickel 20, Crushed Cobalt 20, Molten Iron 40 → Molten Magnitar 60, Tailings Slurry 20                                                  |
| Molten Nickel                | Flexible Blast Furnace                  | 16        | Crushed Nickel 90, Hydrogen 30 → Molten Nickel 45, Tailings Slurry 30                                                                            | Crushed Nickel 90, Hydrogen 30 → Molten Nickel 45, Tailings Slurry 15                                                                         |
| Molten Zinc                  | Flexible Blast Furnace                  | 6         | Crushed Zinc 120 → Molten Zinc 60, Tailings Slurry 20                                                                                            | Crushed Zinc 120 → Molten Zinc 60, Tailings Slurry 10                                                                                         |
| Electric Motor               | Manufacturer                            | 40        | Bar Magnet 19.5, Rotor 15, Cobalt Plates 7.5, Carbon Powder 24 → Motor 15                                                                        | Rotor 15, Bar Magnet 19.5, Cobalt Plates 9, Carbon Powder 24 → Motor 15                                                                       |
| Medium FaxIT Disk [U]        | Manufacturer                            | 80 → 40   | Small FaxIT Disk 1.5, Photon Pair Converter 3, High-Speed Connector 3.75 → Medium FaxIT Disk 0.75                                                | Small FaxIT Disk 3, Photon Pair Converter 6, High-Speed Connector 7.5 → Medium FaxIT Disk 1.5                                                 |
| Rubberized Belt Drive        | Manufacturer                            | 96 → 48   | Smooth Belt Drive 5, Solder Rod 3.75, Steel Pipe 7.5, Rubber 25 → Rubberized Belt Drive 3.125                                                    | Smooth Belt Drive 10, Solder Rod 7.5, Steel Pipe 15, Rubber 50 → Rubberized Belt Drive 6.25                                                   |
| RF Connection Unit           | Quantum Encoder                         | 32        | Quartz Crystal 56.25, Radiator 22.5, High-Speed Connector 11.25, Excited Photonic Matter 90 → Radio Control Unit 11.25, Energetic Dark Matter 30 | Quartz Crystal 75, Radiator 30, High-Speed Connector 15, Excited Photonic Matter 90 → Radio Control Unit 11.25, Energetic Dark Matter 30      |
| Synthetic Power Shard        | Quantum Encoder                         | 64        | Power Shard Fragment 3.75, Time Crystal 3.75, Dark Matter Crystal 7.5, Excited Photonic Matter 75 → Power Shard 7.5, Energetic Dark Matter 37.5  | Power Shard Fragment 3.75, Time Crystal 3.75, Dark Matter Crystal 7.5, Excited Photonic Matter 60 → Power Shard 7.5, Energetic Dark Matter 30 |
| Refined Slurry               | Refinery                                | 4         | Tailings Slurry 30 → Crushed Gangue 60, Water 7.5                                                                                                | Tailings Slurry 15 → Crushed Gangue 60, Water 7.5                                                                                             |
| Cast Copper Ingot            | Reformer                                | 5 → 4     | Molten Copper 48, Water 24 → Copper Ingot 144, Steam 24                                                                                          | Molten Copper 60, Water 30 → Copper Ingot 180, Steam 30                                                                                       |
| Red Brass Ingot              | Reformer                                | 16        | Molten Copper 30, Zinc Ingot 45, Molten Tin 30 → Brass Ingot 75, Bronze Ingot 75                                                                 | Molten Copper 22.5, Zinc Ingot 22.5, Molten Tin 22.5 → Brass Ingot 75, Bronze Ingot 75                                                        |
| Crushed Lead                 | Sorter                                  | 6 → 4     | Crushed Larrussite 120, Air 60 → Crushed Lead 100, Silica 20                                                                                     | Crushed Larrussite 180, Air 90 → Crushed Lead 150, Silica 30                                                                                  |
| Monochrome Crushed Bauxite   | Sorter                                  | 6         | Crushed Montanion 120, Kyalite 120, Universal Paint 30 → Crushed Bauxite 300                                                                     | Crushed Montanion 120, Kyalite 120, Universal Paint 10 → Crushed Bauxite 300                                                                  |
| Monochrome Crushed Caterium  | Sorter                                  | 6         | Crushed Aurovite 120, Crushed Montanion 120, Universal Paint 30 → Crushed Caterium 300                                                           | Crushed Aurovite 120, Crushed Montanion 120, Universal Paint 10 → Crushed Caterium 300                                                        |
| Monochrome Crushed Copper    | Sorter                                  | 6         | Crushed Callanite 120, Crushed Aurovite 90, Universal Paint 30 → Crushed Copper 300                                                              | Crushed Callanite 120, Crushed Aurovite 90, Universal Paint 10 → Crushed Copper 300                                                           |
| Monochrome Crushed Iron      | Sorter                                  | 6         | Crushed Siterite 120, Crushed Larrussite 120, Universal Paint 30 → Crushed Iron 300                                                              | Crushed Siterite 120, Crushed Larrussite 120, Universal Paint 10 → Crushed Iron 300                                                           |
| Monochrome Crushed Lead      | Sorter                                  | 6         | Crushed Larrussite 100, Crushed Aurovite 90, Universal Paint 30 → Crushed Lead 300                                                               | Crushed Larrussite 100, Crushed Aurovite 90, Universal Paint 10 → Crushed Lead 300                                                            |
| Monochrome Crushed Magnesium | Sorter                                  | 6         | Crushed Callanite 240, Crushed Montanion 240, Universal Paint 30 → Crushed Magnesium 300                                                         | Crushed Callanite 240, Crushed Montanion 240, Universal Paint 10 → Crushed Magnesium 300                                                      |
| Monochrome Crushed Zinc      | Sorter                                  | 6         | Crushed Larrussite 120, Carbon Powder 80, Universal Paint 30 → Crushed Zinc 300                                                                  | Crushed Larrussite 120, Carbon Powder 80, Universal Paint 10 → Crushed Zinc 300                                                               |
| Washed Copper                | Wet Washer                              | 20        | Callanite Ore 24, Water 24 → Crushed Copper 36, Tailings Slurry 24                                                                               | Callanite Ore 24, Water 24 → Crushed Copper 36, Tailings Slurry 12                                                                            |
| Washed Iron                  | Wet Washer                              | 12        | Siterite Ore 40, Water 40 → Crushed Iron 60, Tailings Slurry 40                                                                                  | Siterite Ore 40, Water 40 → Crushed Iron 60, Tailings Slurry 20                                                                               |
| Washed Magnesium             | Wet Washer                              | 15        | Callanite Ore 80, Muriatic Acid 20 → Crushed Magnesium 80, Tailings Slurry 32                                                                    | Callanite Ore 80, Muriatic Acid 20 → Crushed Magnesium 80, Tailings Slurry 16                                                                 |
| Washed Rutile                | Wet Washer                              | 12        | Siterite Ore 100, Nitric Acid 10 → Pure Rutile 20, Tailings Slurry 40                                                                            | Siterite Ore 100, Nitric Acid 10 → Pure Rutile 20, Tailings Slurry 20                                                                         |
| Washed Tin                   | Wet Washer                              | 8         | Siterite Ore 60, Water 30 → Crushed Tin 45, Tailings Slurry 60                                                                                   | Siterite Ore 60, Water 30 → Crushed Tin 45, Tailings Slurry 15                                                                                |
| Washed Zinc                  | Wet Washer                              | 15        | Larrussite Ore 60, Water 40 → Crushed Zinc 60, Wastewater 24                                                                                     | Larrussite Ore 60, Water 40 → Crushed Zinc 60, Wastewater 12                                                                                  |

## Moved or added (confirmed in game by Charles, 2026-11-05)

| Recipe                                                               | Machine                          | Batch (s) | Old /min                                                      | New /min                                                                              |
| -------------------------------------------------------------------- | -------------------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Universal Paint (Copper Slug)                                        | Composter → Particle Accelerator | 10 → 10   | Copper Slug 6, Energetic Dark Matter 60 → Universal Paint 30  | Copper Slug 12, Energetic Dark Matter 60 → Universal Paint 90                         |
| Universal Paint (Golden Slug)                                        | Composter → Particle Accelerator | 20 → 10   | Golden Slug 3, Energetic Dark Matter 30 → Universal Paint 30  | Golden Slug 12, Energetic Dark Matter 60 → Universal Paint 120                        |
| Universal Paint (Iron Slug)                                          | Composter → Particle Accelerator | 5 → 10    | Iron Slug 12, Energetic Dark Matter 60 → Universal Paint 30   | Iron Slug 12, Energetic Dark Matter 60 → Universal Paint 60                           |
| Universal Paint (Orange Slug)                                        | Composter → Particle Accelerator | 4 → 10    | Orange Slug 15, Energetic Dark Matter 45 → Universal Paint 15 | Orange Slug 18, Energetic Dark Matter 120 → Universal Paint 60                        |
| Strange Universal Matter - Alpha (new, tier 10-0 like Mercer Sphere) | Wet Washer                       | 12        | none                                                          | Larrussite Ore 10, Siterite Ore 40, Coal 20, Sulfur 10, Universal Paint 12.5 → SAM 75 |

Accelerator power for the paint recipes: 100 MW + 400 MW variable (dataset fields MinPower -500, AveragePower -300).

Not in game (Charles, 2026-11-05): Refined Power recipes (disabled by SF+), Ficsit Farming's own plot recipes (plots give Leaves only), the Trigon repaints, and the new Small FaxIT Disk recipe (the Assembler still uses Poled Kerr Crystal + Smart Plating, as in the dataset).

## Packaging recipes: dataset kept (36)

SF+ rewrites packaging recipes while the game loads (`CDORequirement_Packager`), so the files are not authoritative for them. Several gas recipes show twice the fluid in the files, but in game Packaged and Unpackage Air run at the dataset rate (Charles, 2026-11-05), so every packaging recipe keeps its dataset values.

Packaged Air, Packaged Algal Mass, Packaged Chlorine Gas, Packaged Energized Slug Slime, Packaged Ethylene Gas, Packaged Hydrogen, Packaged Natural Gas, Packaged Purified Crude Oil, Packaged Raw Sludge, Packaged Slug Slime, Packaged Sour Gas, Packaged Spent Slug Slime, Packaged Steam, Packaged Toxic Air, Packaged Universal Paint, Packaged Wastewater, Unpacked Air, Unpacked Algal Mass, Unpacked Caustic Soda, Unpacked Chlorine Gas, Unpacked Coolant, Unpacked Energized Slug Slime, Unpacked Ethylene Gas, Unpacked Flue Gas, Unpacked Hydrogen, Unpacked Muriatic Acid, Unpacked Natural Gas, Unpacked Purified Crude Oil, Unpacked Raw Sludge, Unpacked Slug Slime, Unpacked Sour Gas, Unpacked Spent Slug Slime, Unpacked TiCl Gas, Unpacked Toxic Air, Unpacked Universal Paint, Unpacked Wastewater

## Same rates, different batch size (no effect on plans; dataset keeps its batch)

- AI Expansion Server (Quantum Encoder): 15 s in the dataset, 30 s in the mod files
- Brass Belt Drive (Reformer): 30 s in the dataset, 15 s in the mod files
- Condensed Graphene (Refinery): 8 s in the dataset, 12 s in the mod files
- Dark Matter Condensate (Particle Accelerator): 8 s in the dataset, 12 s in the mod files
- Energetic Dark Matter (Converter): 4.8 s in the dataset, 12 s in the mod files
- Excited Photonic Matter (Converter): 6 s in the dataset, 12 s in the mod files
- Heavy Modular Frame (Manufacturer): 48 s in the dataset, 24 s in the mod files
- Instant Titanium Plate (Blender): 12 s in the dataset, 4 s in the mod files
- Magnitide Billet (Foundry): 24 s in the dataset, 12 s in the mod files
- Nitro Rocket Fuel (Blender): 6 s in the dataset, 2.4 s in the mod files
- TiCl Gas (Refinery): 16 s in the dataset, 4 s in the mod files
- Titanium Plates (Blender): 10 s in the dataset, 5 s in the mod files
- Turbo Thermoplastic (Reformer): 20 s in the dataset, 8 s in the mod files

## Name differences (in-game name vs dataset name, matched by machine and parts)

- AI Limiter (Assembler): in game "A.I. Limiter"
- Brass Belt Drive (Reformer): in game "Cast Brass Belt Drive"
- Brass Pipes (Assembler): in game "Brass Pipe"
- Brass Plates (Constructor): in game "Brass Plate"
- Bronze Plates (Constructor): in game "Bronze Plate"
- Carrot (enriched) (Farming Platform (Crop Plot / Fluid)): in game "Carrot (Watered)"
- Carrot (fertilized) (Farming Platform (Crop Plot / Fluid)): in game "Fertilized Carrots"
- Cast Steel Pipe (Foundry): in game "Steel Pipe"
- Cobalt Plates (Constructor): in game "Cobalt Plate"
- Corn (enriched) (Farming Platform (Crop Plot / Fluid)): in game "Corn (Watered)"
- Corn (fertilized) (Farming Platform (Crop Plot / Fluid)): in game "Fertilized Corn"
- Fan Blades (Assembler): in game "Fan Blade"
- Fused Alloy Quickwire (Reformer): in game "Alternate: Fused Quickwire"
- Iron Plate (Constructor): in game "Iron Plate: 2"
- MOX Uranium Cells (Particle Accelerator): in game "Alternate: MOX Uranium Cell"
- Mycelia (enriched) (Farming Platform (Mycelia Plot / Fluid)): in game "Enriched Mycelia"
- Mycelia (fertilized) (Farming Platform (Mycelia Plot / Fluid)): in game "Fertilized Mycelia"
- Plastic Smart Plating (Assembler): in game "Alternate: Plastic Plating"
- Polyethylene Plastic & Rubber (Reformer): in game "Polyethylene"
- Potato (enriched) (Farming Platform (Crop Plot / Fluid)): in game "Potato (Watered)"
- Potato (fertilized) (Farming Platform (Crop Plot / Fluid)): in game "Fertilized Potato"
- Radiator (Refinery): in game "Aluminum Radiator"
- Residual Magnesium (Constructor): in game "Residual Magnesium Granules"
- Screws (Constructor): in game "Iron Screw"
- Silica (Larrussite) (Sorter): in game "Silica (Larrusite)"
- Silicon High-speed Interface (Quantum Encoder): in game "Alternate: Silicon High-Speed Interface"
- Sloppy Glass (Smelter): in game "Impure Glass"
- Synthetic Diamond (Particle Accelerator): in game "Synthetic Diamonds"
- Synthetic Protein (Cooking Hub): in game "Artificial Protein"
- Tin Sheet (Assembler): in game "Tinned Sheet"
- Titanium Plates (Blender): in game "Titanium Plate"
- Turbo Motor (Manufacturer): in game "Turbomotor"
- Unpacked Air (A.I. Fluid Packer): in game "Unpackage Air"
- Unpacked Algal Mass (A.I. Fluid Packer): in game "Unpackage Algal Mass"
- Unpacked Caustic Soda (A.I. Fluid Packer): in game "Unpackage Caustic Soda"
- Unpacked Chlorine Gas (A.I. Fluid Packer): in game "Unpackage Chlorine Gas"
- Unpacked Coolant (A.I. Fluid Packer): in game "Unpackage Coolant"
- Unpacked Energized Slug Slime (A.I. Fluid Packer): in game "Unpackage Energized Slug Slime"
- Unpacked Ethylene Gas (A.I. Fluid Packer): in game "Unpackage Ethylene Gas"
- Unpacked Flue Gas (A.I. Fluid Packer): in game "Unpackage Flue Gas"
- Unpacked Hydrogen (A.I. Fluid Packer): in game "Unpackage Hydrogen"
- Unpacked Muriatic Acid (A.I. Fluid Packer): in game "Unpackage Muriatic Acid"
- Unpacked Natural Gas (A.I. Fluid Packer): in game "Unpackage Natural Gas"
- Unpacked Purified Crude Oil (A.I. Fluid Packer): in game "Unpackage Purified Crude Oil"
- Unpacked Raw Sludge (A.I. Fluid Packer): in game "Unpackage Raw Sludge"
- Unpacked Slug Slime (A.I. Fluid Packer): in game "Unpackage Slug Slime"
- Unpacked Sour Gas (A.I. Fluid Packer): in game "Unpackage Sour Gas"
- Unpacked Spent Slug Slime (A.I. Fluid Packer): in game "Unpackage Spent Slug Slime"
- Unpacked TiCl Gas (A.I. Fluid Packer): in game "Unpackage TiCl Gas"
- Unpacked Toxic Air (A.I. Fluid Packer): in game "Unpackage Toxic Air"
- Unpacked Universal Paint (A.I. Fluid Packer): in game "Unpackage Universal Paint"
- Unpacked Wastewater (A.I. Fluid Packer): in game "Unpackage Wastewater"
- Wheat (enriched) (Farming Platform (Crop Plot / Fluid)): in game "Wheat (Watered)"
- Wheat (fertilized) (Farming Platform (Crop Plot / Fluid)): in game "Fertilized Wheat"
- Wire (Constructor): in game "Copper Wire"
- Zinc Plates (Constructor): in game "Zinc Plate"
