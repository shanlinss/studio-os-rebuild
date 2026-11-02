// Aggregate the existing product execution facts, never copied task state.
// Workflow.detail supplies snapshots ordered by observed_at,id ascending.
const metricKeys = [
  'views',
  'likes',
  'favorites',
  'comments',
  'productClicks',
  'addToCart',
  'conversions',
] as const;
type Row = Record<string, unknown>;
type Execution = { task: Row; publications: Row[]; snapshots: Row[] };
function bucket(id: string, name: string) {
  return {
    id,
    name,
    targetCount: 0,
    publishedCount: 0,
    fulfilledCount: 0,
    remainingCount: 0,
    filledCount: 0,
    snapshotCount: 0,
    actionCount: 0,
    completedActions: 0,
    metrics: Object.fromEntries(
      metricKeys.map((key) => [
        key,
        { total: null as string | null, coveredCount: 0 },
      ]),
    ),
  };
}
export function productSummary(
  stages: Row[],
  plans: Row[],
  executions: Execution[],
) {
  const total = bucket('total', '商品合计');
  const stageRows = new Map(
    stages.map((s) => [String(s.id), bucket(String(s.id), String(s.name))]),
  );
  const accountRows = new Map<string, ReturnType<typeof bucket>>();
  for (const execution of executions) {
    const t = execution.task;
    const plan = plans.find((p) => p.id === t.planId);
    const stage = stageRows.get(String(plan?.stageId));
    const groups = [total, ...(stage ? [stage] : [])];
    if (t.kind !== 'action' && t.accountId) {
      const key = String(t.accountId);
      if (!accountRows.has(key))
        accountRows.set(key, bucket(key, String(t.accountName)));
      groups.push(accountRows.get(key)!);
    }
    if (t.kind === 'action') {
      for (const group of groups) {
        group.actionCount++;
        if (t.completedAt) group.completedActions++;
      }
      continue;
    }
    const latest = new Map<unknown, Row>();
    for (const snapshot of execution.snapshots)
      latest.set(snapshot.publicationId, snapshot);
    for (const group of groups) {
      group.targetCount += Number(t.targetCount);
      group.publishedCount += execution.publications.length;
      const fulfilled = Math.min(
        Number(t.targetCount),
        Number(t.fulfilledCount ?? execution.publications.length),
      );
      group.fulfilledCount += fulfilled;
      group.remainingCount += Math.max(0, Number(t.targetCount) - fulfilled);
      group.snapshotCount += execution.snapshots.length;
      for (const publication of execution.publications) {
        const snapshot = latest.get(publication.id);
        if (!snapshot) continue;
        group.filledCount++;
        for (const key of metricKeys) {
          const value = snapshot[key];
          if (typeof value !== 'number') continue;
          const metric = group.metrics[key];
          metric.total = (
            BigInt(metric.total ?? '0') + BigInt(value)
          ).toString();
          metric.coveredCount++;
        }
      }
    }
  }
  return {
    total,
    stages: [...stageRows.values()],
    accounts: [...accountRows.values()],
  };
}
