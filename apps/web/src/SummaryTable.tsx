import { formatRate as fmt, type PlanSummary, type SummaryFlow } from '@sps/solver';

/** The plan summary, laid out like the `pnpm solve` table (same sections and numbers). */
export function SummaryTable({ plan }: { plan: PlanSummary }) {
  const p = plan.power;
  return (
    <section className="summary" aria-label="Plan summary">
      <p data-testid="plan-status">
        Status: {plan.status} · Objective: {plan.objective}
        {plan.objectiveValue !== undefined && ` = ${fmt(plan.objectiveValue)}`}
      </p>
      {plan.diagnostics.length > 0 && (
        <ul className="diagnostics">
          {plan.diagnostics.map((d, k) => (
            <li key={k} className={d.severity}>
              {d.severity}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {plan.status === 'ok' && (
        <>
          <Table
            title="Recipes"
            head={['Recipe', 'Machine', 'Count', 'Build', 'MW']}
            textColumns={2}
            rows={plan.recipes.map((r) => [
              r.name,
              r.machine,
              fmt(r.machines),
              String(r.machinesCeil),
              fmt(r.powerMW),
            ])}
          />
          <Flows title="Targets" rows={plan.targets} />
          <Flows title="Imports" rows={plan.imports} />
          <Flows title="Surplus and byproducts" rows={plan.byproducts} />
          {plan.nodes.length > 0 && (
            <Table
              title="Nodes"
              head={['Node', 'Used', 'Budget', 'NNE']}
              rows={plan.nodes.map((n) => [n.label, fmt(n.used), fmt(n.budget), fmt(n.nne)])}
            />
          )}
          <p data-testid="power">
            Power: {fmt(p.consumptionMW)} MW draw, {fmt(p.generationMW)} MW generated, net{' '}
            {fmt(p.netMW)} MW
          </p>
        </>
      )}
    </section>
  );
}

function Flows({ title, rows }: { title: string; rows: SummaryFlow[] }) {
  if (!rows.length) return null;
  return (
    <Table title={title} head={['Item', 'Per min']} rows={rows.map((r) => [r.name, fmt(r.rate)])} />
  );
}

function Table(props: { title: string; head: string[]; rows: string[][]; textColumns?: number }) {
  const { title, head, rows, textColumns = 1 } = props;
  return (
    <table aria-label={title}>
      <caption>{title}</caption>
      <thead>
        <tr>
          {head.map((h, c) => (
            <th key={h} scope="col" className={c < textColumns ? 'text' : 'num'}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => (
          <tr key={k}>
            {r.map((v, c) => (
              <td key={c} className={c < textColumns ? 'text' : 'num'}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
