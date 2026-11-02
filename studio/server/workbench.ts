import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { timestamp } from './workflow';
import { uuid } from './validation';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
export class Workbench {
  constructor(private readonly db: StudioDatabase) {}
  async activity(identity: Identity, query: Record<string, unknown>) {
    if (
      Object.keys(query).some((k) => k !== 'date') ||
      typeof query.date !== 'string' ||
      !/^\d{4}-\d\d-\d\d$/.test(query.date)
    )
      throw new BadRequestException();
    const start = timestamp(query.date + 'T00:00:00+08:00');
    // One database snapshot. Shared material visibility is not task visibility.
    // Counts come from existing facts/events; reads never mutate usage counters.
    const [counts] = await this.db
      .client`WITH bounds AS (SELECT ${start}::timestamptz AS start_at,${start}::timestamptz + interval '24 hours' AS end_at), scoped AS (
      SELECT t.id,t.kind,p.experiment_id,p.shooting_request_id
      FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id
      LEFT JOIN studio_os.business_accounts a ON a.id=t.account_id LEFT JOIN studio_os.shooting_requests sr ON sr.id=p.shooting_request_id
      WHERE (sr.id IS NULL OR sr.assignee_id IS NOT NULL)
      AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND(t.kind IN('action','shooting') OR(a.active AND a.responsible_member_id=m.id))))
    ) SELECT
      (SELECT count(*)::int FROM studio_os.materials m,bounds b WHERE m.created_at>=b.start_at AND m.created_at<b.end_at) AS materials,
      (SELECT count(*)::int FROM studio_os.lab_experiments e,bounds b WHERE e.created_at>=b.start_at AND e.created_at<b.end_at AND (${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM scoped s WHERE s.experiment_id=e.id))) AS experiments,
      (SELECT count(*)::int FROM studio_os.publications n JOIN scoped s ON s.id=n.task_id CROSS JOIN bounds b WHERE n.published_at>=b.start_at AND n.published_at<b.end_at) AS publications,
      (SELECT count(*)::int FROM studio_os.action_completions c JOIN scoped s ON s.id=c.task_id CROSS JOIN bounds b WHERE c.completed_at>=b.start_at AND c.completed_at<b.end_at) AS actions,
      (SELECT count(*)::int FROM studio_os.shooting_requests r,bounds b WHERE r.status='已完成' AND r.last_completed_at>=b.start_at AND r.last_completed_at<b.end_at AND EXISTS(SELECT 1 FROM scoped s WHERE s.shooting_request_id=r.id)) AS shooting,
      CASE WHEN ${identity.role === 'admin'} THEN (SELECT count(*)::int FROM studio_os.knowledge_assets k,bounds b WHERE k.created_at>=b.start_at AND k.created_at<b.end_at) ELSE NULL END AS knowledge,
      CASE WHEN ${identity.role === 'admin'} THEN (SELECT coalesce(sum(CASE WHEN jsonb_typeof(e.detail->'items')='array' THEN jsonb_array_length(e.detail->'items') ELSE 0 END),0)::int FROM studio_os.title_events e,bounds b WHERE e.action IN('created','appended') AND e.created_at>=b.start_at AND e.created_at<b.end_at) ELSE NULL END AS titles,
      (SELECT coalesce(sum(CASE WHEN jsonb_typeof(e.detail->'entryIds')='array' THEN jsonb_array_length(e.detail->'entryIds') ELSE 0 END),0)::int FROM studio_os.title_events e,bounds b WHERE e.action='copied' AND e.created_at>=b.start_at AND e.created_at<b.end_at AND (${identity.role === 'admin'} OR e.actor_id=${identity.id})) AS "titleCopies"`;
    return {
      date: query.date,
      scope: identity.role === 'admin' ? 'team' : 'assigned',
      counts: {
        materials: counts.materials,
        experiments: counts.experiments,
        publications: counts.publications,
        actions: counts.actions,
        shooting: counts.shooting,
        ...(identity.role === 'admin'
          ? { knowledge: counts.knowledge, titles: counts.titles }
          : {}),
        titleCopies: counts.titleCopies,
      },
    };
  }
  async completed(identity: Identity, query: Record<string, unknown>) {
    if (
      Object.keys(query).some((k) => !['date', 'source', 'member'].includes(k))
    )
      throw new BadRequestException();
    const date =
      typeof query.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(query.date)
        ? query.date
        : '';
    if (!date) throw new BadRequestException();
    const start = timestamp(date + 'T00:00:00+08:00');
    const source = query.source === undefined ? 'all' : String(query.source);
    if (
      !['all', 'material', 'product', 'template', 'shooting'].includes(source)
    )
      throw new BadRequestException();
    if (query.member !== undefined && identity.role !== 'admin')
      throw new ForbiddenException();
    const member = query.member === undefined ? null : uuid(query.member);
    // One statement/snapshot, same current task ownership as Workflow.tasks.
    // Completion timestamps are facts, never inferred from a planned date or quantity.
    const rows = await this.db.client`WITH scoped AS (
      SELECT t.id,t.kind,p.title,p.source_type,p.id AS plan_id,p.product_id,p.experiment_id,p.shooting_request_id,
      m.display_name AS assignee,coalesce(a.name,CASE WHEN t.kind='shooting' THEN '拍摄协作' ELSE '无需账号' END) AS account_name,
      coalesce(g.name,sg.name,lg.name,nullif(sr.product_description,''),nullif(e.product,'')) AS product_name,sr.status AS shooting_status,sr.last_completed_at
      FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id
      LEFT JOIN studio_os.business_accounts a ON a.id=t.account_id LEFT JOIN studio_os.products g ON g.id=p.product_id
      LEFT JOIN studio_os.lab_experiments e ON e.id=p.experiment_id LEFT JOIN studio_os.products lg ON lg.id=e.product_id LEFT JOIN studio_os.shooting_requests sr ON sr.id=p.shooting_request_id LEFT JOIN studio_os.products sg ON sg.id=sr.product_id
      WHERE (${source}='all' OR p.source_type=${source}) AND (${member}::uuid IS NULL OR m.id=${member})
      AND (sr.id IS NULL OR sr.assignee_id IS NOT NULL)
      AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND(t.kind IN('action','shooting') OR(a.active AND a.responsible_member_id=m.id))))
    ),facts AS (
      SELECT n.id,n.task_id,n.published_at AS occurred_at,'publication'::text AS kind,n.url AS evidence_url,''::text AS feedback
      FROM studio_os.publications n WHERE n.published_at>=${start} AND n.published_at<(${start}::timestamptz + interval '24 hours')
      UNION ALL SELECT c.task_id,c.task_id,c.completed_at,'action',c.evidence_url,c.feedback
      FROM studio_os.action_completions c WHERE c.completed_at>=${start} AND c.completed_at<(${start}::timestamptz + interval '24 hours')
      UNION ALL SELECT r.id,t.id,r.last_completed_at,'shooting','',r.feedback
      FROM studio_os.shooting_requests r JOIN studio_os.plans p ON p.shooting_request_id=r.id JOIN studio_os.tasks t ON t.plan_id=p.id AND t.kind='shooting'
      WHERE r.status='已完成' AND r.last_completed_at>=${start} AND r.last_completed_at<(${start}::timestamptz + interval '24 hours')
    ) SELECT f.id,f.task_id AS "taskId",f.occurred_at AS "occurredAt",f.kind,f.evidence_url AS "evidenceUrl",f.feedback,s.title,s.source_type AS "sourceType",s.plan_id AS "planId",s.product_id AS "productId",s.experiment_id AS "experimentId",s.shooting_request_id AS "shootingRequestId",s.assignee,s.account_name AS "accountName",s.product_name AS "productName"
      FROM facts f JOIN scoped s ON s.id=f.task_id ORDER BY f.occurred_at,f.kind,f.id LIMIT 1001`;
    if (rows.length > 1000)
      throw new PayloadTooLargeException('请按业务来源或成员缩小范围');
    return { date, rows };
  }
  refills(identity: Identity) {
    // Same task/object boundary as Workflow.snapshot. Only missing FIRST data;
    // no inferred reminder schedule, team sharing, or second task state.
    return this.db
      .client`SELECT n.id,n.task_id AS "taskId",n.url,n.published_at AS "publishedAt",p.title,p.source_type AS "sourceType",p.experiment_id AS "experimentId",p.product_id AS "productId",t.template_id AS "templateId",nt.name AS "templateName",p.id AS "planId",m.display_name AS assignee,a.name AS "accountName",
      (SELECT jsonb_build_object('id',r.id,'title',r.title,'sourceUrl',r.source_url,'coverId',(SELECT f.id FROM studio_os.material_assets f WHERE f.material_id=r.id AND f.mime LIKE 'image/%' ORDER BY f.created_at,f.id LIMIT 1))
       FROM studio_os.plan_materials link JOIN studio_os.materials r ON r.id=link.material_id
       WHERE link.plan_id=p.id AND (n.material_id IS NULL OR r.id=n.material_id)
       AND ((t.template_id IS NULL AND p.source_type='material') OR (t.template_id IS NULL AND p.source_type='product' AND EXISTS(SELECT 1 FROM studio_os.task_materials tm WHERE tm.task_id=t.id AND tm.material_id=r.id)) OR (t.template_id IS NOT NULL AND r.id=t.template_material_id))
       ORDER BY r.created_at,r.id LIMIT 1) AS reference,
      (SELECT count(*)::int FROM studio_os.plan_materials link WHERE link.plan_id=p.id AND ((t.template_id IS NULL AND p.source_type='material') OR (t.template_id IS NULL AND p.source_type='product' AND EXISTS(SELECT 1 FROM studio_os.task_materials tm WHERE tm.task_id=t.id AND tm.material_id=link.material_id)) OR (t.template_id IS NOT NULL AND link.material_id=t.template_material_id))) AS "referenceCount",
      (SELECT f.id FROM studio_os.publication_assets f WHERE f.publication_id=n.id AND f.mime LIKE 'image/%' ORDER BY f.created_at,f.id LIMIT 1) AS "actualCoverId"
      FROM studio_os.publications n JOIN studio_os.tasks t ON t.id=n.task_id JOIN studio_os.plans p ON p.id=t.plan_id
      LEFT JOIN studio_os.lab_experiments e ON e.id=p.experiment_id LEFT JOIN studio_os.products g ON g.id=p.product_id
      JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id LEFT JOIN studio_os.note_templates nt ON nt.id=t.template_id
      WHERE t.kind='publication' AND p.source_type IN ('material','product','template') AND (e.id IS NULL OR e.status='testing') AND (g.id IS NULL OR g.active)
      AND NOT EXISTS(SELECT 1 FROM studio_os.data_snapshots s WHERE s.publication_id=n.id)
      AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id))
      ORDER BY n.published_at,n.id`;
  }
  materialRefills(identity: Identity) {
    // Only missing first observations; no guessed daily observation cadence or thresholds.
    return this.db
      .client`SELECT n.id,n.task_id AS "taskId",n.url,n.published_at AS "publishedAt",p.title,p.experiment_id AS "experimentId",p.id AS "planId",m.display_name AS assignee,a.name AS "accountName",
   (SELECT jsonb_build_object('id',r.id,'title',r.title,'sourceUrl',r.source_url,'coverId',(SELECT f.id FROM studio_os.material_assets f WHERE f.material_id=r.id AND f.mime LIKE 'image/%' ORDER BY f.created_at,f.id LIMIT 1)) FROM studio_os.plan_materials link JOIN studio_os.materials r ON r.id=link.material_id WHERE link.plan_id=p.id AND(n.material_id IS NULL OR r.id=n.material_id) AND(t.template_id IS NULL OR r.id=t.template_material_id) ORDER BY r.created_at,r.id LIMIT 1) AS reference,
   (SELECT count(*)::int FROM studio_os.plan_materials link WHERE link.plan_id=p.id AND(t.template_id IS NULL OR link.material_id=t.template_material_id)) AS "referenceCount",
   (SELECT f.id FROM studio_os.publication_assets f WHERE f.publication_id=n.id AND f.mime LIKE 'image/%' ORDER BY f.created_at,f.id LIMIT 1) AS "actualCoverId"
   FROM studio_os.publications n JOIN studio_os.tasks t ON t.id=n.task_id JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.lab_experiments e ON e.id=p.experiment_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE p.source_type='material' AND e.status='testing' AND NOT EXISTS(SELECT 1 FROM studio_os.data_snapshots s WHERE s.publication_id=n.id) AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) ORDER BY n.published_at,n.id`;
  }
}
