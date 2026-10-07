/**
 * The plan's headline numbers in one strip above the flowchart: status,
 * power, machines, nodes and the objective. The tables below keep the detail.
 */
import { formatRate as fmt, groupThousands, type PlanSummary } from '@sps/solver';
import type { ReactNode } from 'react';
import { StatusChip } from './ui/StatusChip';

function Stat(props: { label: string; children: ReactNode; detail?: ReactNode }) {
  return (
    <div className="stat">
      <dt>{props.label}</dt>
      <dd>
        <span className="stat-value">{props.children}</span>
        {props.detail !== undefined && <span className="stat-detail">{props.detail}</span>}
      </dd>
    </div>
  );
}

export function PlanStats(props: { plan: PlanSummary; manual: boolean; timing: string }) {
  const { plan, manual, timing } = props;
  const p = plan.power;
  const built = plan.recipes.reduce((s, r) => s + r.machinesCeil, 0);
  const running = plan.recipes.reduce((s, r) => s + r.machines, 0);
  const nodes = plan.nodes.reduce((s, n) => s + n.used, 0);
  return (
    <dl className="plan-stats" aria-label="Plan at a glance">
      <Stat label="Status" detail={timing}>
        {manual ? (
          <StatusChip status="manual" label="manual, not solver-checked" />
        ) : (
          <StatusChip status={plan.status} />
        )}
      </Stat>
      <Stat
        label="Power net"
        detail={`${fmt(p.consumptionMW)} draw · ${fmt(p.generationMW)} generated`}
      >
        {fmt(p.netMW)} MW
      </Stat>
      <Stat label="Machines" detail={`${fmt(running)} running`}>
        {groupThousands(String(built))}
      </Stat>
      {nodes > 0 && <Stat label="Nodes">{fmt(nodes)}</Stat>}
      {!manual && plan.objectiveValue !== undefined && (
        <Stat label="Objective" detail={plan.objective}>
          {fmt(plan.objectiveValue)}
        </Stat>
      )}
    </dl>
  );
}
