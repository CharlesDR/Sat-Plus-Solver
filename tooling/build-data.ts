/**
 * `pnpm build:data`: runs the data pipeline (docs/ARCHITECTURE.md §6) and the
 * solver-side free-lunch check for every SF+ mod version in mod-versions/
 * (A111), then writes data/generated/<version>/{model.json,report.md}.
 * Exits non-zero on any validation error, so CI fails on bad data.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareModVersions } from '@sps/data';
import { buildModel, renderReport, type BuildResult, type ReportSection } from '@sps/data/build';
import { createHighsBackend, findFreeLunch } from '@sps/solver';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The version golden fixtures, the layout-score baseline and the data tests
 * stay on (A111), so a new mod version never moves them.
 */
export const PINNED_VERSION = '2026.3.489';

/** The mod versions in mod-versions/, oldest first; the last is the newest. */
export function modVersions(root = ROOT): string[] {
  return readdirSync(join(root, 'mod-versions'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(compareModVersions);
}

/** One mod version's pipeline inputs: its own game data plus the shared data files. */
export function readInputs(version = PINNED_VERSION, root = ROOT) {
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  return {
    gameData: read(`mod-versions/${version}/game_data.json`),
    nodesCsv: read('data/nodes.csv'),
    minerModel: read('data/miner-model.json'),
    overrides: read('data/overrides.json'),
    areas: read('data/areas.json'),
    alternateUnlocks: read('data/alternate-unlocks.json'),
    scarcityUsage: read('data/scarcity-usage.json'),
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

/** Where `pnpm build:data` writes a version's model and report. */
export function generatedDir(version: string, root = ROOT): string {
  return join(root, 'data', 'generated', version);
}

async function main() {
  // A version removed from mod-versions/ leaves no stale model behind.
  rmSync(join(ROOT, 'data', 'generated'), { recursive: true, force: true });
  let failed = false;
  for (const version of modVersions()) {
    const { result, report } = await runPipeline(readInputs(version));
    const outDir = generatedDir(version);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'report.md'), report);
    const errors = result.issues.filter((i) => i.severity === 'error');
    const warnings = result.issues.length - errors.length;
    if (!result.model || errors.length) {
      for (const e of errors) console.error(`${version}: error [${e.code}] ${e.message}`);
      console.error(
        `${version}: data build FAILED, ${errors.length} error(s). See data/generated/${version}/report.md`,
      );
      failed = true;
      continue;
    }
    writeFileSync(join(outDir, 'model.json'), JSON.stringify(result.model));
    console.log(
      `${version}: data build OK: ${result.model.recipes.length} recipes, ${result.model.items.length} items, ` +
        `${result.model.nodes.length} node classes, ${warnings} warning(s). Wrote data/generated/${version}/.`,
    );
  }
  if (failed) process.exit(1);
}

// Not inside the CLI bundle, where every module shares the bundle's URL.
if (
  !process.env.SPS_CLI_BUNDLE &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  await main();
}
