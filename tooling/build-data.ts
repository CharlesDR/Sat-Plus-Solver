/**
 * `pnpm build:data`: runs the data pipeline (docs/ARCHITECTURE.md §6) and the
 * solver-side free-lunch check, then writes data/generated/{model.json,report.md}.
 * Exits non-zero on any validation error, so CI fails on bad data.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, renderReport, type BuildResult, type ReportSection } from '@sps/data/build';
import { createHighsBackend, findFreeLunch } from '@sps/solver';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readInputs(root = ROOT) {
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  return {
    gameData: read('game_data.json'),
    nodesCsv: read('data/nodes.csv'),
    minerModel: read('data/miner-model.json'),
    overrides: read('data/overrides.json'),
  };
}

/** Builds the model and adds the free-lunch result as an issue + report section. */
export async function runPipeline(
  inputs = readInputs(),
): Promise<{ result: BuildResult; report: string }> {
  const result = buildModel(inputs);
  const sections: ReportSection[] = [];
  if (result.model) {
    const whitelist = new Set(
      Object.keys(
        (JSON.parse(inputs.overrides) as { freeLunchWhitelist?: Record<string, string> })
          .freeLunchWhitelist ?? {},
      ),
    );
    const lunch = await findFreeLunch(result.model, createHighsBackend(), whitelist);
    const name = new Map(result.model.items.map((i) => [i.id, i.name]));
    if (lunch.found) {
      result.issues.push({
        severity: 'error',
        code: 'freeLunch',
        message:
          `${lunch.kind === 'power' ? 'Power' : 'Item'} loop: recipes ${lunch.recipes.map((r) => r.id).join(', ')} create ` +
          `${lunch.items.map((i) => `${name.get(i.id) ?? i.id} ${i.net.toFixed(3)}/min`).join(', ')} from nothing`,
      });
      delete result.model;
    }
    sections.push({
      title: 'Free-lunch check',
      body: lunch.found
        ? `**Failed.** A loop of ${lunch.recipes.length} recipe(s) nets ${lunch.kind === 'power' ? 'power' : 'items'} with no extraction or imports (see Errors).`
        : `Passed. No set of recipes with inputs nets any item from nothing (with grid power available), ` +
          'and none nets power once its own machines are paid for.' +
          (whitelist.size ? ` Whitelisted: ${[...whitelist].join(', ')}.` : ''),
    });
  }
  return { result, report: renderReport(result, sections) };
}

async function main() {
  const { result, report } = await runPipeline();
  const outDir = join(ROOT, 'data', 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.md'), report);
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.length - errors.length;
  if (!result.model || errors.length) {
    for (const e of errors) console.error(`error [${e.code}] ${e.message}`);
    console.error(`\nData build FAILED: ${errors.length} error(s). See data/generated/report.md`);
    process.exit(1);
  }
  writeFileSync(join(outDir, 'model.json'), JSON.stringify(result.model));
  console.log(
    `Data build OK: ${result.model.recipes.length} recipes, ${result.model.items.length} items, ` +
      `${result.model.nodes.length} node classes, ${warnings} warning(s). Wrote data/generated/.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
