import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { Materials } from './materials';
import {
  prepareCandidate,
  researchActor,
  type CandidateOrigin,
} from './research';
import { labInput } from './lab-input';
import {
  longText,
  optionalLongText,
  objectInput,
  shortText,
  uuid,
  version,
  httpsUrl,
} from './validation';
export function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new BadRequestException();
  if (
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    (value[16] === ':' && Number(value.slice(17, 19)) > 59)
  )
    throw new BadRequestException();
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    throw new BadRequestException();
  return new Date(value).toISOString();
}
function positive(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    throw new BadRequestException();
  return Number(value);
}
function conflict(error: unknown): never {
  if ((error as { code?: string }).code === '23505')
    throw new ConflictException();
  throw error;
}
export async function productPlanWritable(tx: TransactionSql, planId: string) {
  const [product] =
    await tx`SELECT g.active FROM studio_os.products g JOIN studio_os.plans p ON p.product_id=g.id WHERE p.id=${planId} FOR SHARE OF g`;
  if (product && !product.active) throw new ConflictException();
}
export class Workflow {
  constructor(private readonly db: StudioDatabase) {}
  materials(identity: Identity) {
    return new Materials(this.db).list(identity);
  }
  createMaterial(identity: Identity, value: unknown) {
    return new Materials(this.db).save(identity, value);
  }
  async createPlan(
    identity: Identity,
    value: unknown,
    parent?: { experimentId: string; expectedVersion: number },
    research?: {
      origin: CandidateOrigin;
      preview?: boolean;
      sourceHash?: string;
      productId?: string | null;
    },
    options: { allowUnassigned?: boolean } = {},
  ) {
    requireAdministrator(identity);
    const b = objectInput(value, [
      'title',
      'requestKey',
      'materialIds',
      'assignments',
      'templateAssignments',
      'lab',
    ]);
    const lab = labInput(b.lab);
    const executionConditions =
      lab.executionConditions ?? (research ? lab.testVariable : '');
    if (parent) {
      uuid(parent.experimentId);
      version(parent.expectedVersion);
      if (!lab.adjustment) throw new BadRequestException();
    }
    const title = shortText(b.title, 200);
    const key = uuid(b.requestKey);
    if (
      !Array.isArray(b.materialIds) ||
      !b.materialIds.length ||
      b.materialIds.length > 100 ||
      !Array.isArray(b.assignments) ||
      (!b.assignments.length && !options.allowUnassigned) ||
      b.assignments.length > 100
    )
      throw new BadRequestException();
    const materialIds = b.materialIds.map(uuid).sort();
    if (new Set(materialIds).size !== materialIds.length)
      throw new BadRequestException();
    const assignments = b.assignments
      .map((v) => {
        const a = objectInput(v, ['memberId', 'accountId', 'targetCount']);
        return {
          memberId: uuid(a.memberId),
          accountId: uuid(a.accountId),
          targetCount: positive(a.targetCount),
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));
    if (
      new Set(assignments.map((a) => a.accountId)).size !== assignments.length
    )
      throw new BadRequestException();
    const templateAssignments =
      b.templateAssignments === undefined
        ? []
        : (() => {
            if (
              !Array.isArray(b.templateAssignments) ||
              b.templateAssignments.length > 100
            )
              throw new BadRequestException();
            return b.templateAssignments
              .map((value) => {
                const row = objectInput(value, [
                  'templateId',
                  'expectedVersion',
                  'memberId',
                  'accountId',
                  'targetCount',
                  'requirements',
                ]);
                return {
                  templateId: uuid(row.templateId),
                  expectedVersion: version(row.expectedVersion),
                  memberId: uuid(row.memberId),
                  accountId: uuid(row.accountId),
                  targetCount: positive(row.targetCount),
                  ...(row.requirements !== undefined
                    ? { requirements: optionalLongText(row.requirements, 2000) }
                    : {}),
                };
              })
              .sort((a, b) =>
                (a.templateId + a.accountId).localeCompare(
                  b.templateId + b.accountId,
                ),
              );
          })();
    if (
      assignments.length + templateAssignments.length > 100 ||
      new Set(templateAssignments.map((a) => a.templateId + a.accountId))
        .size !== templateAssignments.length
    )
      throw new BadRequestException();
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          title,
          materialIds,
          assignments,
          ...(templateAssignments.length ? { templateAssignments } : {}),
          ...(b.lab !== undefined ? { lab } : {}),
          ...(parent ? { parent } : {}),
          ...(research
            ? {
                origin: research.origin,
                sourceHash: research.sourceHash,
                productId: research.productId ?? null,
              }
            : {}),
        }),
      )
      .digest('hex');
    return this.db.client.begin(async (tx) => {
      await researchActor(tx, identity, true);
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const [previous] =
        await tx`SELECT id,request_hash,experiment_id FROM studio_os.plans WHERE request_key=${key}`;
      if (previous) {
        if (previous.request_hash !== hash) throw new ConflictException();
        return { id: previous.id, experimentId: previous.experiment_id };
      }
      const source = research
        ? await prepareCandidate(tx, identity, research.origin)
        : null;
      const sourceHash = source
        ? createHash('sha256').update(JSON.stringify(source)).digest('hex')
        : null;
      if (research && !research.preview && sourceHash !== research.sourceHash)
        throw new ConflictException('参考内容已变化，请重新预览');
      if (
        research?.productId &&
        !(
          await tx`SELECT id FROM studio_os.products WHERE id=${uuid(research.productId)} AND active FOR SHARE`
        ).length
      )
        throw new ConflictException();
      if (source) {
        const required = source.references.flatMap((r) =>
          r.materialId || r.elementMaterialId
            ? [String(r.materialId || r.elementMaterialId)]
            : [],
        );
        if (required.some((id) => !materialIds.includes(id)))
          throw new BadRequestException('计划须保留候选参考素材');
      }
      for (const id of materialIds)
        if (
          !(
            await tx`SELECT id FROM studio_os.materials WHERE id=${id} FOR SHARE`
          ).length
        )
          throw new BadRequestException();
      for (const a of [...assignments, ...templateAssignments]) {
        if (
          !(
            await tx`SELECT b.id FROM studio_os.business_accounts b JOIN studio_os.members m ON m.id=b.responsible_member_id JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE b.id=${a.accountId} AND m.id=${a.memberId} AND b.active AND m.active AND l.active FOR SHARE OF b,m,l`
          ).length
        )
          throw new BadRequestException();
      }
      const templateSources = new Map<string, string | null>();
      for (const a of templateAssignments) {
        const [template] =
          await tx`SELECT id,version,archived,source_material_id FROM studio_os.note_templates WHERE id=${a.templateId} FOR SHARE`;
        if (
          !template ||
          template.archived ||
          template.version !== a.expectedVersion
        )
          throw new ConflictException();
        templateSources.set(a.templateId, template.source_material_id);
      }
      if (research?.preview)
        return {
          id: '',
          experimentId: '',
          preview: {
            title,
            lab,
            materialIds,
            assignments,
            templateAssignments,
            targetCount: [...assignments, ...templateAssignments].reduce(
              (sum, a) => sum + a.targetCount,
              0,
            ),
            source,
            sourceHash,
            productId: research.productId ?? null,
          },
        };
      let experimentId: string,
        roundNo = 1;
      if (parent) {
        const [root] =
          await tx`SELECT id,status,version FROM studio_os.lab_experiments WHERE id=${parent.experimentId} FOR UPDATE`;
        if (!root) throw new NotFoundException();
        if (
          root.status !== 'testing' ||
          root.version !== parent.expectedVersion
        )
          throw new ConflictException();
        experimentId = root.id;
        const [latest] =
          await tx`SELECT coalesce(max(round_no),0)::int AS n FROM studio_os.plans WHERE experiment_id=${root.id}`;
        roundNo = latest.n + 1;
        await tx`UPDATE studio_os.lab_experiments SET version=version+1 WHERE id=${root.id}`;
      } else {
        const [root] =
          await tx`INSERT INTO studio_os.lab_experiments(title,hypothesis,direction,product,priority,created_by) VALUES(${title},${lab.hypothesis},${lab.direction},${lab.product},${lab.priority},${identity.id}) RETURNING id`;
        experimentId = root.id;
      }
      if (research?.productId)
        await tx`UPDATE studio_os.lab_experiments SET product_id=${research.productId} WHERE id=${experimentId}`;
      const [plan] =
        await tx`INSERT INTO studio_os.plans(title,request_key,request_hash,created_by,experiment_id,round_no,adjustment,test_variable,planned_publish_on,requirements) VALUES(${title},${key},${hash},${identity.id},${experimentId},${roundNo},${lab.adjustment},${lab.testVariable},${lab.plannedPublishOn}::date,${executionConditions}) RETURNING id`;
      await tx`INSERT INTO studio_os.lab_events(experiment_id,actor_id,action,detail) VALUES(${experimentId},${identity.id},${parent ? 'round_created' : 'created'},${JSON.stringify({ planId: plan.id, roundNo })}::jsonb)`;
      for (const id of materialIds)
        await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${plan.id},${id})`;
      for (const a of assignments)
        await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count) VALUES(${plan.id},${a.memberId},${a.accountId},${a.targetCount})`;
      for (const material of new Set(templateSources.values()))
        if (material && !materialIds.includes(material))
          await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${plan.id},${material})`;
      for (const a of templateAssignments) {
        const [task] =
          await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count,template_id,template_material_id,template_version,instructions) VALUES(${plan.id},${a.memberId},${a.accountId},${a.targetCount},${a.templateId},${templateSources.get(a.templateId) ?? null},${a.expectedVersion},${a.requirements ?? ''}) RETURNING id`;
        await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${a.templateId},${identity.id},'assigned',${JSON.stringify({ planId: plan.id, taskId: task.id, targetCount: a.targetCount, requirements: a.requirements ?? '', experimentId })}::jsonb)`;
      }
      if (parent && !research)
        await tx`INSERT INTO studio_os.plan_candidate_sources(plan_id,candidate_id,source_snapshot) SELECT ${plan.id},s.candidate_id,s.source_snapshot || jsonb_build_object('arrangement',jsonb_build_object('hypothesis',coalesce(nullif(${lab.hypothesis},''),s.source_snapshot->'arrangement'->>'hypothesis',e.hypothesis),'executionConditions',${executionConditions}::text)) FROM studio_os.plan_candidate_sources s JOIN studio_os.plans previous ON previous.id=s.plan_id JOIN studio_os.lab_experiments e ON e.id=previous.experiment_id WHERE previous.experiment_id=${experimentId} ORDER BY previous.round_no DESC LIMIT 1`;
      if (research && source) {
        await tx`INSERT INTO studio_os.plan_candidate_sources(plan_id,candidate_id,source_snapshot) VALUES(${plan.id},${research.origin.candidateId},${JSON.stringify({ ...source, arrangement: { hypothesis: lab.hypothesis, executionConditions } })}::jsonb)`;
        await tx`UPDATE studio_os.research_candidates SET status='scheduled',version=version+1 WHERE id=${research.origin.candidateId}`;
        await tx`INSERT INTO studio_os.research_events(entity_id,actor_id,action,detail) VALUES(${research.origin.candidateId},${identity.id},'scheduled',${JSON.stringify({ planId: plan.id, experimentId })}::jsonb)`;
      }
      if (assignments.length || templateAssignments.length)
        await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${plan.id},${identity.id},'dispatched',${plan.id})`;
      return { ...plan, experimentId };
    });
  }
  async tasks(identity: Identity) {
    return this.db
      .client`SELECT t.id,t.plan_id AS "planId",p.title,coverage.fulfilled AS "fulfilledCount",CASE WHEN coverage.fulfilled IS NULL THEN NULL ELSE greatest(0,t.target_count-coverage.fulfilled) END AS "remainingCount",CASE WHEN ${identity.role === 'admin'} THEN coalesce(e.finding,p.conclusion) ELSE NULL END AS conclusion,CASE WHEN sr.archived OR sr.status='已完成' OR (p.product_id IS NOT NULL AND NOT g.active) THEN 'concluded' ELSE coalesce(e.status,'testing') END AS "experimentStatus",CASE WHEN ${identity.role === 'admin'} THEN t.member_id ELSE NULL END AS "memberId",CASE WHEN ${identity.role === 'admin'} THEN t.account_id ELSE NULL END AS "accountId",p.source_type AS "sourceType",p.experiment_id AS "experimentId",p.product_id AS "productId",coalesce(g.name,sg.name,lg.name,nullif(sr.product_description,''),nullif(e.product,'')) AS "productName",s.name AS "stageName",CASE WHEN pcs.plan_id IS NOT NULL THEN coalesce(pcs.source_snapshot->'arrangement'->>'hypothesis',e.hypothesis,'') ELSE NULL END AS "finalHypothesis",CASE WHEN pcs.plan_id IS NOT NULL THEN coalesce(nullif(p.requirements,''),CASE WHEN pcs.plan_id IS NOT NULL AND p.round_no=1 AND NOT(pcs.source_snapshot ? 'arrangement') THEN p.test_variable ELSE '' END) ELSE NULL END AS "executionConditions",concat_ws(E'\n',nullif(coalesce(nullif(p.requirements,''),CASE WHEN pcs.plan_id IS NOT NULL AND p.round_no=1 AND NOT(pcs.source_snapshot ? 'arrangement') THEN p.test_variable ELSE '' END),''),nullif(t.instructions,'')) AS requirements,t.instructions,t.template_id AS "templateId",t.template_material_id AS "templateMaterialId",nt.name AS "templateName",CASE WHEN t.schedule_overridden THEN t.planned_publish_on ELSE p.planned_publish_on END::text AS "plannedPublishOn",t.schedule_version AS "scheduleVersion",t.kind,CASE WHEN t.kind='shooting' THEN CASE WHEN sr.status='已完成' THEN sr.last_completed_at ELSE NULL END ELSE c.completed_at END AS "completedAt",sr.id AS "shootingRequestId",sr.status AS "shootingStatus",sr.archived AS "shootingArchived",(SELECT count(*)::int FROM studio_os.shooting_items si WHERE si.request_id=sr.id AND si.completed AND NOT si.archived) AS "shootingCompletedCount",t.target_count AS "targetCount",coalesce(b.name,CASE WHEN t.kind='shooting' THEN '拍摄协作' ELSE '无需账号' END) AS "accountName",b.profile_url AS "accountUrl",m.display_name AS "assignee",
   (SELECT count(*)::int FROM studio_os.publications n WHERE n.task_id=t.id) AS "publishedCount",
   (SELECT count(*)::int FROM studio_os.publications n WHERE n.task_id=t.id AND EXISTS(SELECT 1 FROM studio_os.data_snapshots d WHERE d.publication_id=n.id)) AS "filledCount"
   FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id LEFT JOIN studio_os.plan_candidate_sources pcs ON pcs.plan_id=p.id LEFT JOIN studio_os.lab_experiments e ON e.id=p.experiment_id LEFT JOIN studio_os.products lg ON lg.id=e.product_id LEFT JOIN studio_os.shooting_requests sr ON sr.id=p.shooting_request_id LEFT JOIN studio_os.products sg ON sg.id=sr.product_id JOIN studio_os.members m ON m.id=t.member_id LEFT JOIN studio_os.business_accounts b ON b.id=t.account_id LEFT JOIN studio_os.products g ON g.id=p.product_id LEFT JOIN studio_os.product_stages s ON s.id=p.stage_id LEFT JOIN studio_os.action_completions c ON c.task_id=t.id LEFT JOIN studio_os.note_templates nt ON nt.id=t.template_id
   LEFT JOIN LATERAL (SELECT coalesce(sum(least(tm.target_count,coalesce(n.published,0))),0)::int AS fulfilled FROM studio_os.task_materials tm LEFT JOIN (SELECT material_id,count(*)::int AS published FROM studio_os.publications WHERE task_id=t.id GROUP BY material_id) n ON n.material_id=tm.material_id WHERE tm.task_id=t.id) coverage ON p.source_type='product' AND t.template_id IS NULL AND t.kind='publication'
   WHERE (sr.id IS NULL OR sr.assignee_id IS NOT NULL) AND (${identity.role === 'admin'} OR (m.login_account_id=${identity.id} AND m.active AND (t.kind IN('action','shooting') OR(b.active AND b.responsible_member_id=m.id)))) ORDER BY p.created_at DESC,t.id`;
  }
  async detail(identity: Identity, id: string) {
    uuid(id);
    const rows = await this.tasks(identity);
    const task = rows.find((t) => t.id === id);
    if (!task) throw new NotFoundException();
    const materials = await this.db
      .client`SELECT m.id,m.title,m.source_url AS "sourceUrl",tm.target_count AS "targetCount",tm.requirements,tm.topic_reference AS "topicReference",tm.title_reference AS "titleReference",tm.cover_reference AS "coverReference",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime) ORDER BY f.created_at,f.id) FROM studio_os.material_assets f WHERE f.material_id=m.id),'[]') AS assets FROM studio_os.materials m JOIN studio_os.plan_materials r ON r.material_id=m.id LEFT JOIN studio_os.task_materials tm ON tm.material_id=m.id AND tm.task_id=${id} WHERE r.plan_id=${task.planId} AND ((${!!task.templateId} AND m.id=${task.templateMaterialId ?? null}) OR (${!task.templateId} AND ((${task.sourceType === 'material'}) OR (${task.sourceType === 'product'} AND tm.task_id IS NOT NULL))))`;
    const publications = await this.db
      .client`SELECT n.id,n.url,n.title,n.note,n.version,n.template_id AS "templateId",n.material_id AS "materialId",n.published_at AS "publishedAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',octet_length(f.content)) ORDER BY f.created_at,f.id) FROM studio_os.publication_assets f WHERE f.publication_id=n.id),'[]') AS assets FROM studio_os.publications n WHERE n.task_id=${id} ORDER BY n.created_at,n.id`;
    const snapshots = await this.db
      .client`SELECT s.id,s.publication_id AS "publicationId",s.observed_at AS "observedAt",s.views,s.likes,s.favorites,s.comments,s.product_clicks AS "productClicks",s.add_to_cart AS "addToCart",s.conversions,s.has_conversion AS "hasConversion" FROM studio_os.data_snapshots s JOIN studio_os.publications n ON n.id=s.publication_id WHERE n.task_id=${id} ORDER BY s.observed_at,s.id`;
    const [completion] = await this.db
      .client`SELECT evidence_url AS "evidenceUrl",feedback,completed_at AS "completedAt" FROM studio_os.action_completions WHERE task_id=${id}`;
    const [template] = task.templateId
      ? await this.db
          .client`SELECT n.id,n.name,n.structure,n.description,n.product,n.scene,n.tags,n.benchmark_url AS "benchmarkUrl",n.version AS "currentVersion",t.template_version AS "assignedVersion",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime) ORDER BY f.created_at,f.id) FROM studio_os.template_assets f WHERE f.template_id=n.id),'[]') AS assets FROM studio_os.note_templates n JOIN studio_os.tasks t ON t.template_id=n.id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.id=${id} AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id))`
      : [];
    const [candidateSource] = await this.db
      .client`SELECT candidate_id AS "candidateId",source_snapshot AS snapshot FROM studio_os.plan_candidate_sources WHERE plan_id=${task.planId}`;
    return {
      candidateSource: candidateSource ?? null,
      task,
      template: template ?? null,
      materials,
      publications,
      snapshots,
      completion: completion ?? null,
    };
  }
  async publish(identity: Identity, id: string, value: unknown) {
    uuid(id);
    const b = objectInput(value, [
      'url',
      'publishedAt',
      'materialId',
      'title',
      'note',
    ]);
    const title =
        b.title === undefined || b.title === null || b.title === ''
          ? ''
          : shortText(b.title, 200),
      note =
        b.note === undefined || b.note === null || b.note === ''
          ? ''
          : longText(b.note);
    let materialId = b.materialId ? uuid(b.materialId) : null;
    const url = httpsUrl(b.url);
    if (!url) throw new BadRequestException();
    const at = timestamp(b.publishedAt);
    try {
      return await this.db.client.begin(async (tx) => {
        const [t] =
          await tx`SELECT t.id,t.plan_id,t.template_id,t.template_material_id,p.experiment_id,p.source_type FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.id=${id} AND (${identity.role === 'admin'} OR (m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) FOR SHARE OF t,m,a`;
        if (!t) throw new NotFoundException();
        await productPlanWritable(tx, String(t.plan_id));
        if (t.experiment_id) {
          const [e] =
            await tx`SELECT status FROM studio_os.lab_experiments WHERE id=${t.experiment_id} FOR SHARE`;
          if (e?.status === 'concluded') throw new ConflictException();
        }
        if (t.template_id) {
          if (materialId && materialId !== t.template_material_id)
            throw new BadRequestException();
          materialId = t.template_material_id;
        } else if (t.source_type === 'product') {
          if (
            !materialId ||
            !(
              await tx`SELECT material_id FROM studio_os.task_materials WHERE task_id=${id} AND material_id=${materialId}`
            ).length
          )
            throw new BadRequestException();
        } else if (
          materialId &&
          !(
            await tx`SELECT material_id FROM studio_os.plan_materials WHERE plan_id=${t.plan_id} AND material_id=${materialId}`
          ).length
        )
          throw new BadRequestException();
        const [row] =
          await tx`INSERT INTO studio_os.publications(task_id,url,published_at,created_by,material_id,template_id,title,note) VALUES(${id},${url},${at},${identity.id},${materialId},${t.template_id},${title},${note}) RETURNING id`;
        await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${t.plan_id},${identity.id},'published',${row.id})`;
        return row;
      });
    } catch (e) {
      conflict(e);
    }
  }
  async editPublication(
    identity: Identity,
    id: string,
    publicationId: string,
    value: unknown,
  ) {
    uuid(id);
    uuid(publicationId);
    const b = objectInput(value, [
      'expectedVersion',
      'url',
      'publishedAt',
      'title',
      'note',
    ]);
    const v = version(b.expectedVersion),
      url = httpsUrl(b.url),
      at = timestamp(b.publishedAt),
      title =
        b.title === undefined || b.title === null || b.title === ''
          ? ''
          : shortText(b.title, 200),
      note =
        b.note === undefined || b.note === null || b.note === ''
          ? ''
          : longText(b.note);
    if (!url) throw new BadRequestException();
    try {
      return await this.db.client.begin(async (tx) => {
        const [t] =
          await tx`SELECT t.plan_id,p.experiment_id,n.version FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.publications n ON n.task_id=t.id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.id=${id} AND n.id=${publicationId} AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) FOR SHARE OF t,m,a FOR UPDATE OF n`;
        if (!t) throw new NotFoundException();
        if (t.version !== v) throw new ConflictException();
        await productPlanWritable(tx, String(t.plan_id));
        if (t.experiment_id) {
          const [root] =
            await tx`SELECT status FROM studio_os.lab_experiments WHERE id=${t.experiment_id} FOR SHARE`;
          if (root?.status === 'concluded') throw new ConflictException();
        }
        const [result] =
          await tx`UPDATE studio_os.publications SET url=${url},published_at=${at},title=${title},note=${note},version=version+1 WHERE id=${publicationId} RETURNING id,version`;
        await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${t.plan_id},${identity.id},'publication_updated',${publicationId})`;
        return result;
      });
    } catch (error) {
      conflict(error);
    }
  }
  async snapshot(
    identity: Identity,
    id: string,
    publicationId: string,
    value: unknown,
  ) {
    uuid(id);
    uuid(publicationId);
    const b = objectInput(value, [
      'observedAt',
      'views',
      'likes',
      'favorites',
      'comments',
      'productClicks',
      'addToCart',
      'conversions',
      'hasConversion',
    ]);
    const at = timestamp(b.observedAt);
    const metrics = [
      'views',
      'likes',
      'favorites',
      'comments',
      'productClicks',
      'addToCart',
      'conversions',
    ].map((k) => {
      const v = b[k];
      if (v === undefined || v === null) return null;
      if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 2147483647)
        throw new BadRequestException();
      return Number(v);
    });
    const hasConversion =
      b.hasConversion === undefined || b.hasConversion === null
        ? null
        : b.hasConversion;
    if (hasConversion !== null && typeof hasConversion !== 'boolean')
      throw new BadRequestException();
    if (
      hasConversion !== null &&
      metrics[6] !== null &&
      hasConversion !== metrics[6]! > 0
    )
      throw new BadRequestException();
    if (metrics.every((v) => v === null) && hasConversion === null)
      throw new BadRequestException();
    try {
      return await this.db.client.begin(async (tx) => {
        const [t] =
          await tx`SELECT t.plan_id,p.experiment_id FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id JOIN studio_os.publications n ON n.task_id=t.id WHERE t.id=${id} AND n.id=${publicationId} AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) FOR SHARE OF t,m,a,n`;
        if (!t) throw new NotFoundException();
        await productPlanWritable(tx, String(t.plan_id));
        if (t.experiment_id) {
          const [e] =
            await tx`SELECT status FROM studio_os.lab_experiments WHERE id=${t.experiment_id} FOR SHARE`;
          if (e?.status === 'concluded') throw new ConflictException();
        }
        const [row] =
          await tx`INSERT INTO studio_os.data_snapshots(publication_id,observed_at,views,likes,favorites,comments,product_clicks,add_to_cart,conversions,has_conversion,created_by) VALUES(${publicationId},${at},${metrics[0]},${metrics[1]},${metrics[2]},${metrics[3]},${metrics[4]},${metrics[5]},${metrics[6]},${hasConversion as boolean | null},${identity.id}) RETURNING id`;
        await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${t.plan_id},${identity.id},'snapshot',${row.id})`;
        return row;
      });
    } catch (e) {
      conflict(e);
    }
  }
  async conclude(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['conclusion', 'expectedVersion']);
    const text = longText(b.conclusion, 2000);
    const expected = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [plan] =
        await tx`UPDATE studio_os.plans SET conclusion=${text},version=version+1 WHERE id=${id} AND version=${expected} AND source_type='material' RETURNING id,version,conclusion`;
      if (!plan) throw new ConflictException();
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${id},${identity.id},'conclusion',${id})`;
      return plan;
    });
  }
  plans(identity: Identity) {
    requireAdministrator(identity);
    return this.db
      .client`SELECT id,title,conclusion,version FROM studio_os.plans WHERE source_type='material' ORDER BY created_at DESC,id`;
  }
}
