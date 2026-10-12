/**
 * The plan's headline numbers in one line above the flowchart (UX-2): status,
 * power, machines and resource nodes. The objective value is a tooltip on the
 * status (UX-7). The tables below keep the detail.
 */
import { formatExact, groupThousands, type PlanSummary } from '@sps/solver';
import type { ReactNode } from 'react';
import type { ScopeView } from './stats/scope';
import { OBJECTIVE_CODES, OBJECTIVE_LABELS } from './controls/ObjectiveStack';
import { StatusChip } from './ui/StatusChip';
import { useNumbers } from './ui/numbers';

function Stat(props: { label: string; children: ReactNode; detail?: ReactNode; title?: string }) {
  return (
    <div className="stat" title={props.title}>
      <dt>{props.label}</dt>
      <dd>
        <span className="stat-value">{props.children}</span>
        {props.detail !== undefined && <span className="stat-detail">{props.detail}</span>}
      </dd>
    </div>
  );
}

export function PlanStats(props: {
  plan: PlanSummary;
  manual: boolean;
  timing: string;
  /** The stats scope (A81), when it is not the open factory's plan alone. */
  scope?: ScopeView | undefined;
}) {
  const { plan, manual, timing, scope } = props;
  const fmt = useNumbers().rate;
  const totals = scope?.kind === 'scope' ? scope.totals : undefined;
  const p = totals?.power ?? plan.power;
  const built = totals?.machines ?? plan.recipes.reduce((s, r) => s + r.machinesCeil, 0);
  const running = totals?.running ?? plan.recipes.reduce((s, r) => s + r.machines, 0);
  const nodes = (totals?.nodes ?? plan.nodes).reduce((s, n) => s + n.used, 0);
  const pick = scope?.kind === 'pick';
  const objective =
    !manual && plan.objectiveValue !== undefined
      ? `Objective: ${OBJECTIVE_LABELS[plan.objective]} (${OBJECTIVE_CODES[plan.objective]}) = ${formatExact(plan.objectiveValue)}`
      : undefined;
  return (
    <dl className="plan-stats" aria-label="Plan at a glance">
      <Stat label="Status" detail={timing} {...(objective ? { title: objective } : {})}>
        {manual ? (
          <StatusChip status="manual" label="manual, not solver-checked" />
        ) : (
          <StatusChip status={plan.status} />
        )}
      </Stat>
      {!pick && (
        <Stat
          label="Power net"
          detail={`${fmt(p.consumptionMW)} draw · ${fmt(p.generationMW)} generated`}
        >
          {fmt(p.netMW)} MW
        </Stat>
      )}
      {!pick && (
        <Stat label="Machines" detail={`${fmt(running)} running`}>
          {groupThousands(String(built))}
        </Stat>
      )}
      {!pick && nodes > 0 && <Stat label="Resource nodes used">{fmt(nodes)}</Stat>}
    </dl>
  );
}
