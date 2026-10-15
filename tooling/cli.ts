/**
 * The prebuilt solver CLI (scenario tooling): one entry for `pnpm solve` and
 * `pnpm world`, bundled by tooling/bundle-cli.ts into `dist-cli/` with the
 * model and the HiGHS WASM beside it, so a thread can solve without cloning,
 * installing or building.
 *
 *   node sps.mjs solve --target "Iron Plate:60" [--summary] …
 *   node sps.mjs world solve <world.json | share link | -> [--summary] …
 */
import { fileURLToPath } from 'node:url';
import { runCli } from './solve';
import { runWorldCli } from './world';

export const CLI_USAGE = `Usage: sps solve <pnpm solve options>
       sps world solve <world.json | share link | -> [--json | --summary]`;

export async function runSps(
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [command, ...rest] = argv;
  if (command === 'solve') return runCli(rest);
  if (command === 'world') return runWorldCli(rest);
  return { code: 2, stdout: '', stderr: `${CLI_USAGE}\n` };
}

if (
  process.env.SPS_CLI_BUNDLE ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
) {
  const { code, stdout, stderr } = await runSps(process.argv.slice(2));
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(code);
}
