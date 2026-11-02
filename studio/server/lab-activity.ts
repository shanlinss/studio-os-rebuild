// Read-only history adapter. The old TestDynamicsBoard/Detail organize reviews
// and executions together; their platform API and automatic thresholds are not reused.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { uuid } from './validation';

const labels: Record<string, string> = {
  created: '发起实验',
  round_created: '安排下一轮',
  priority: '调整重点标记',
  product_linked: '调整关联商品',
  reviewed: '添加本轮判断',
  finished: '结束实验并沉淀结论',
  conclusion_updated: '修订实验结论',
  dispatched: '派发执行安排',
  published: '记录已发布笔记',
  publication_updated: '修改发布资料',
  snapshot: '保存数据回填',
  conclusion: '记录原计划结论',
};
const verdicts: Record<string, string> = {
  reusable: '可复用',
  conditional: '有条件可复用',
  rejected: '验证无效',
  unclear: '暂未验证清楚',
};
const metricNames: Record<string, string> = {
  views: '浏览',
  likes: '点赞',
  favorites: '收藏',
  comments: '评论',
  productClicks: '商品点击',
  addToCart: '加购',
  conversions: '成交',
};
function conclusion(value: unknown) {
  const v = (value ?? {}) as Record<string, unknown>;
  return [
    verdicts[String(v.verdict)] ?? '尚未记录',
    typeof v.finding === 'string' ? v.finding : '',
    typeof v.recommendation === 'string' ? v.recommendation : '',
    Array.isArray(v.tags)
      ? v.tags.filter((t) => typeof t === 'string').join('、')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
export async function labActivity(
  db: StudioDatabase,
  identity: Identity,
  id: string,
  cursor: unknown,
) {
  requireAdministrator(identity);
  uuid(id);
  let at: string | null = null,
    source: string | null = null,
    eventId: string | null = null;
  if (cursor !== undefined) {
    if (
      typeof cursor !== 'string' ||
      cursor.length > 300 ||
      !/^[\w-]+$/.test(cursor)
    )
      throw new BadRequestException();
    try {
      const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        c.experiment !== id ||
        !['lab', 'workflow'].includes(c.source) ||
        typeof c.at !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(c.at) ||
        new Date(c.at).toISOString() !== c.at.slice(0, 23) + 'Z'
      )
        throw new Error();
      at = c.at;
      source = c.source;
      eventId = uuid(c.id);
    } catch {
      throw new BadRequestException();
    }
  }
  if (
    !(await db.client`SELECT id FROM studio_os.lab_experiments WHERE id=${id}`)
      .length
  )
    throw new NotFoundException();
  const rows = await db.client`
    WITH events AS (
      SELECT e.id,'lab'::text AS source,e.created_at,e.actor_id,e.action,e.detail,
        p.id AS plan_id,p.round_no,r.decision,r.note,
        NULL::text AS account_name,NULL::timestamptz AS observed_at,NULL::jsonb AS metrics
      FROM studio_os.lab_events e
      LEFT JOIN studio_os.plans p ON p.experiment_id=e.experiment_id AND p.id::text=e.detail->>'planId'
      LEFT JOIN studio_os.lab_reviews r ON r.experiment_id=e.experiment_id AND r.id::text=e.detail->>'reviewId'
      WHERE e.experiment_id=${id}
      UNION ALL
      SELECT e.id,'workflow'::text,e.created_at,e.actor_id,e.action,'{}'::jsonb,
        p.id,p.round_no,NULL::text,NULL::text,b.name,s.observed_at,
        CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('views',s.views,'likes',s.likes,'favorites',s.favorites,'comments',s.comments,'productClicks',s.product_clicks,'addToCart',s.add_to_cart,'conversions',s.conversions) END
      FROM studio_os.workflow_events e JOIN studio_os.plans p ON p.id=e.plan_id
      LEFT JOIN studio_os.data_snapshots s ON e.action='snapshot' AND s.id=e.reference_id
      LEFT JOIN studio_os.publications n ON (e.action IN ('published','publication_updated') AND n.id=e.reference_id) OR (e.action='snapshot' AND n.id=s.publication_id)
      LEFT JOIN studio_os.tasks t ON t.id=n.task_id AND t.plan_id=p.id
      LEFT JOIN studio_os.business_accounts b ON b.id=t.account_id
      WHERE p.experiment_id=${id}
    )
    SELECT e.*,to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
      coalesce(m.display_name,CASE WHEN a.role='admin' THEN '管理员' ELSE '团队成员' END) AS actor
    FROM events e LEFT JOIN studio_os.accounts a ON a.id=e.actor_id
    LEFT JOIN studio_os.members m ON m.login_account_id=a.id
    WHERE (${at}::timestamptz IS NULL OR (e.created_at,e.source,e.id)<(${at}::timestamptz,${source}::text,${eventId}::uuid))
    ORDER BY e.created_at DESC,e.source DESC,e.id DESC LIMIT 51`;
  const page = rows.slice(0, 50),
    last = page.at(-1);
  return {
    items: page.map((r) => {
      const detail = r.detail as Record<string, unknown>;
      let note = '';
      if (r.action === 'reviewed')
        note = [r.decision, r.note].filter(Boolean).join('\n');
      if (r.action === 'product_linked') {
        const before = detail.before as { name?: string } | null,
          after = detail.after as { name?: string } | null;
        note = `${before?.name || '未关联商品'} → ${after?.name || '未关联商品'}`;
      }
      if (r.action === 'priority')
        note = detail.priority === true ? '标记为重点测试' : '取消重点标记';
      if (r.action === 'snapshot' && r.metrics)
        note = Object.entries(metricNames)
          .map(([key, label]) => `${label}：${r.metrics[key] ?? '—'}`)
          .join(' · ');
      return {
        id: `${r.source}:${r.id}`,
        action: r.action,
        title: labels[String(r.action)] ?? '实验记录',
        createdAt: r.cursorAt,
        actor: r.actor,
        roundId: r.plan_id,
        roundNo: r.round_no,
        accountName: r.account_name,
        observedAt: r.observed_at,
        note,
        change: ['finished', 'conclusion_updated'].includes(String(r.action))
          ? {
              before: conclusion(detail.before),
              after: conclusion(detail.after),
            }
          : null,
      };
    }),
    nextCursor:
      rows.length > 50 && last
        ? Buffer.from(
            JSON.stringify({
              experiment: id,
              at: last.cursorAt,
              source: last.source,
              id: last.id,
            }),
          ).toString('base64url')
        : null,
  };
}
