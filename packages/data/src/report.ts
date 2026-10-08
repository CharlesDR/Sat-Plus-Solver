import type { BuildResult } from './build';
import type { Issue } from './issues';
import type { Model, Recipe } from './model';
import { toString } from './rational';

export interface ReportSection {
  title: string;
  body: string;
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) =>
    `| ${cells.map((c) => (typeof c === 'number' ? fmt(c) : c)).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

function issueList(issues: Issue[]): string {
  if (issues.length === 0) return '_None._';
  const byCode = new Map<string, Issue[]>();
  for (const i of issues) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  return [...byCode]
    .map(
      ([code, list]) =>
        `**${code}** (${list.length})\n\n${list.map((i) => `- ${i.message}`).join('\n')}`,
    )
    .join('\n\n');
}

function minerTables(model: Model): string {
  const name = new Map(model.items.map((i) => [i.id, i.name]));
  const routes = model.recipes.filter((r) => r.route);
  const byResource = new Map<string, Recipe[]>();
  for (const r of routes)
    byResource.set(r.route!.resource, [...(byResource.get(r.route!.resource) ?? []), r]);
  const out: string[] = [];
  for (const [resource, list] of [...byResource].sort((a, b) =>
    name.get(a[0])!.localeCompare(name.get(b[0])!),
  )) {
    const combos = new Map<string, Recipe[]>();
    for (const r of list) {
      const key = `${r.route!.processing ?? ''}|${r.route!.fluid ?? ''}`;
      combos.set(key, [...(combos.get(key) ?? []), r]);
    }
    const rows = [...combos.values()].map((rs) => {
      // Ratios from the normal-purity route where it exists (impure can differ, e.g. A5).
      const r0 = rs.find((x) => x.route!.purity === 'normal') ?? rs[0]!;
      const cell = (p: 'impure' | 'normal' | 'pure') => {
        const r = rs.find((x) => x.route!.purity === p);
        return r ? fmt(r.outputs[0]!.rate) : '–';
      };
      const byproducts = r0.outputs
        .slice(1)
        .map((f) => `${name.get(f.item)} ×${fmt(f.rate / r0.outputs[0]!.rate)}`)
        .join(', ');
      const fluidIn = rs
        .map((r) =>
          r.inputs[0] ? `${r.route!.purity[0]!.toUpperCase()}:${fmt(r.inputs[0].rate)}` : '',
        )
        .filter(Boolean)
        .join(' ');
      return [
        name.get(r0.outputs[0]!.item)!,
        r0.route!.fluid ? name.get(r0.route!.fluid)! : '—',
        cell('impure'),
        cell('normal'),
        cell('pure'),
        byproducts || '—',
        fluidIn || '—',
        fmt(r0.powerMW),
      ];
    });
    out.push(
      `#### ${name.get(resource)}\n\n` +
        table(
          [
            'Output',
            'Fluid',
            'Impure /min',
            'Normal /min',
            'Pure /min',
            'Byproduct (per output)',
            'Fluid in m³/min',
            'MW',
          ],
          rows,
        ),
    );
  }
  return out.join('\n\n');
}

export function renderReport(result: BuildResult, extra: ReportSection[] = []): string {
  const { model, details } = result;
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const s: string[] = ['# Data build report', ''];
  s.push(
    errors.length === 0
      ? `**Status: OK** — ${warnings.length} warning(s).`
      : `**Status: FAILED** — ${errors.length} error(s), ${warnings.length} warning(s).`,
  );

  if (model) {
    const kinds = (k: Recipe['kind']) => model.recipes.filter((r) => r.kind === k).length;
    s.push(
      '',
      '## Summary',
      '',
      table(
        ['What', 'Count'],
        [
          ['Data hash', model.meta.dataHash],
          ['Items (incl. Power and virtual targets)', model.items.length],
          ['Machines used', model.machines.length],
          ['Production recipes', kinds('production')],
          ['Generator recipes', kinds('generator')],
          ['Extraction recipes (incl. generated)', kinds('extraction')],
          [
            'Heater recipes (A17: fuel and exhaust per whole machine)',
            model.recipes.filter((r) => r.heater).length,
          ],
          ['Generated Modular Miner routes', model.recipes.filter((r) => r.route).length],
          ['Node classes', model.nodes.length],
          ['Largest fluid rate (m³/min)', details?.maxFluidRate ?? 0],
        ],
      ),
    );

    const name = new Map(model.items.map((i) => [i.id, i.name]));
    s.push('', '## Node pool and best output per node', '');
    s.push(
      'Best output = highest primary output per node over every route on that node class, at max output (Mk.' +
        `${model.meta.minerMk}, full boosters, overclocked extractors).`,
      '',
    );
    s.push(
      table(
        ['Resource', 'Purity', 'Nodes', 'NNE/node', 'Routes', 'Best output /min per node', 'via'],
        model.nodes.map((n) => {
          const rs = model.recipes.filter((r) => r.node === n.id);
          const best = rs.reduce<Recipe | undefined>(
            (b, r) => (!b || r.outputs[0]!.rate > b.outputs[0]!.rate ? r : b),
            undefined,
          );
          return [
            name.get(n.resource)!,
            n.purity,
            n.count,
            n.nne,
            rs.length,
            best ? fmt(best.outputs[0]!.rate) : '–',
            best
              ? `${name.get(best.outputs[0]!.item)}${best.route?.fluid ? ` + ${name.get(best.route.fluid)}` : ''}`
              : '–',
          ];
        }),
      ),
    );

    s.push('', '## Modular Miner routes (per node, max output)', '');
    s.push(
      'Rates are per node (one miner) and split evenly over the miner’s two belt outputs. ' +
        'Byproducts are given as a ratio of the primary output.',
      '',
      minerTables(model),
    );

    const others = model.recipes.filter((r) => r.kind === 'extraction' && r.node && !r.route);
    s.push('', '## Other node-limited extractors', '');
    s.push(
      table(
        ['Recipe', 'Output /min per node or site', 'Clock', 'MW per node'],
        others.map((r) => [
          r.name,
          fmt(r.outputs[0]!.rate),
          `${fmt(r.clock * 100)}%`,
          fmt(r.powerMW),
        ]),
      ),
    );

    const unlimited = model.recipes.filter((r) => r.kind === 'extraction' && !r.node);
    s.push('', '## Unlimited extraction (no node limit; machines and power still count)', '');
    s.push(
      table(
        ['Recipe', 'Output /min per machine', 'MW'],
        unlimited.map((r) => [
          r.name,
          r.outputs.map((f) => `${name.get(f.item)} ${fmt(f.rate)}`).join(', '),
          fmt(r.powerMW),
        ]),
      ),
    );
  }

  if (details) {
    s.push('', '## Derived fluid-module parameters', '');
    const rows: string[][] = [];
    for (const ore of [...details.extraction.ores].sort((a, b) =>
      a.resource.localeCompare(b.resource),
    )) {
      for (const f of [...ore.fluids.values()].sort((a, b) => a.fluid.localeCompare(b.fluid))) {
        rows.push([ore.resource, f.fluid, toString(f.bonus), toString(f.base)]);
      }
    }
    s.push(table(['Ore', 'Fluid', 'Bonus', 'Fluid m³/min at purity 1'], rows));

    const cc = details.extraction.crossCheck;
    s.push(
      '',
      '## Cross-check against dataset Modular Miner rows (zero boosters)',
      '',
      `${cc.checked} rows checked, ${cc.mismatches.length} mismatch(es).`,
    );
    if (cc.mismatches.length) {
      s.push(
        '',
        table(
          ['Row', 'Whitelisted', 'Detail'],
          cc.mismatches.map((m) => [m.recipe, m.whitelisted ? 'yes' : 'no', m.detail]),
        ),
      );
    }

    const o = details.overrides;
    const applied: string[][] = [
      ...Object.entries(o.markAsFluid).map(([k, v]) => ['Mark as fluid', k, v]),
      ...Object.entries(o.ignoredNodeResources).map(([k, v]) => ['Ignored node resource', k, v]),
      ...o.routeAmountOverrides.map((r) => [
        'Route amount',
        `${r.resource} ${r.purity} → ${r.processing}: ${r.part} = ${r.amount} per base unit`,
        r.reason,
      ]),
      ...Object.entries(o.generatorOverrides).map(([k, v]) => [
        'Generator',
        `${k}: ${v.generationMW} MW`,
        v.reason,
      ]),
      ...Object.entries(o.virtualTargetMachines).map(([k, v]) => ['Virtual target', k, v]),
      ...Object.entries(o.crossCheckWhitelist).map(([k, v]) => ['Cross-check whitelist', k, v]),
      ...Object.entries(o.freeLunchWhitelist).map(([k, v]) => ['Free-lunch whitelist', k, v]),
    ];
    s.push(
      '',
      '## Overrides applied (data/overrides.json)',
      '',
      table(['Kind', 'Target', 'Reason'], applied),
    );

    s.push('', '## Excluded recipes', '');
    const byReason = new Map<string, string[]>();
    for (const e of details.exclusions)
      byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e.recipe]);
    s.push(
      table(
        ['Reason', 'Count', 'Recipes'],
        [...byReason].map(([reason, list]) => [
          reason,
          list.length,
          list.slice(0, 8).join('; ') + (list.length > 8 ? '; …' : ''),
        ]),
      ),
    );
    if (details.areas && model) {
      const name = new Map(model.items.map((i) => [i.id, i.name]));
      const why = {
        listed: 'listed',
        raw: 'raw or one step on',
        signature: 'signature',
        nearest: 'closest family',
        fallback: 'no match',
      } as const;
      s.push('', '## Flowchart areas (data/areas.json, A62)', '');
      s.push(
        'Where each item’s recipes are drawn, and why. The signature is the raw resources of ' +
          'the item’s simplest route; depth is its steps from raw (– when no route reaches it). ' +
          'Recipes that make a plan’s target are drawn in the targets area instead.',
      );
      for (const a of details.areas.areas) {
        const list = details.areas.items.filter((i) => i.area === a.id);
        s.push('', `### ${a.name} (${list.length})`, '');
        if (!list.length) {
          s.push(a.rule === 'targets' ? '_Recipes making a target._' : '_None._');
          continue;
        }
        s.push(
          table(
            ['Item', 'Why', 'Depth', 'Signature'],
            list.map((i) => [
              name.get(i.item) ?? i.item,
              why[i.reason],
              i.depth < 0 ? '–' : i.depth,
              i.signature.map((r) => name.get(r) ?? r).join(', ') || '–',
            ]),
          ),
        );
      }
    }
    s.push(
      '',
      `## Unused parts (${details.unusedParts.length})`,
      '',
      details.unusedParts.join(', ') || '_None._',
    );
  }

  for (const sec of extra) s.push('', `## ${sec.title}`, '', sec.body);
  s.push('', '## Errors', '', issueList(errors), '', '## Warnings', '', issueList(warnings), '');
  return s.join('\n');
}
