// TemplatesPanel / phase2@89c1d41, adapted to first-party members and source tasks.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator, requireContributor } from './access';
import {
  objectInput,
  uuid,
  shortText,
  longText,
  version,
  webLink,
} from './validation';
import { mediaFile } from './media';
import { timestamp } from './workflow';
const optional = (value: unknown, max = 2000) =>
  value === undefined || value === null || value === ''
    ? ''
    : longText(value, max);
const optionalId = (value: unknown) =>
  value === undefined || value === null || value === '' ? null : uuid(value);
function positive(value: unknown) {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    throw new BadRequestException();
  return Number(value);
}
function planInput(value: unknown, editing = false) {
  const b = objectInput(value, [
    'title',
    ...(editing ? ['expectedVersion'] : ['requestKey']),
    'requirements',
    'plannedPublishOn',
    'productId',
    'stageId',
    'expectedProductVersion',
    'assignments',
  ]);
  const title = shortText(b.title, 200),
    key = editing ? null : uuid(b.requestKey),
    requirements = optional(b.requirements),
    product = optionalId(b.productId),
    stage = optionalId(b.stageId);
  if (!!product !== !!stage) throw new BadRequestException();
  const productVersion = product ? version(b.expectedProductVersion) : null;
  let date: string | null = null;
  if (
    b.plannedPublishOn !== undefined &&
    b.plannedPublishOn !== null &&
    b.plannedPublishOn !== ''
  ) {
    if (
      typeof b.plannedPublishOn !== 'string' ||
      !/^\d{4}-\d\d-\d\d$/.test(b.plannedPublishOn)
    )
      throw new BadRequestException();
    timestamp(b.plannedPublishOn + 'T00:00:00Z');
    date = b.plannedPublishOn;
  }
  if (
    !Array.isArray(b.assignments) ||
    !b.assignments.length ||
    b.assignments.length > 100
  )
    throw new BadRequestException();
  const assignments = b.assignments
    .map((value) => {
      const r = objectInput(value, [
        'templateId',
        'expectedVersion',
        'accountId',
        'targetCount',
        'requirements',
      ]);
      return {
        templateId: uuid(r.templateId),
        expectedVersion: version(r.expectedVersion),
        accountId: uuid(r.accountId),
        targetCount: positive(r.targetCount),
        requirements: optional(r.requirements),
      };
    })
    .sort((a, b) =>
      (a.templateId + a.accountId).localeCompare(b.templateId + b.accountId),
    );
  if (
    new Set(assignments.map((a) => a.templateId + a.accountId)).size !==
    assignments.length
  )
    throw new BadRequestException();
  positive(assignments.reduce((sum, a) => sum + a.targetCount, 0));
  return {
    title,
    key,
    requirements,
    product,
    stage,
    productVersion,
    date,
    assignments,
    v: editing ? version(b.expectedVersion) : null,
  };
}
type TemplateRow = {
  id: string;
  name: string;
  structure: string;
  product: string;
  scene: string;
  description: string;
  note: string | null;
  tags: string[];
  rating: string | null;
  benchmarkUrl: string | null;
  sourceMaterialId: string | null;
  sourceExperimentId: string | null;
  sourceCoverId: string | null;
  archived: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  assets: { id: string; name: string; mime: string; size: number }[];
};
export class Templates {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity) {
    requireContributor(identity);
    const items = await this.db.client<
      TemplateRow[]
    >`SELECT n.id,n.name,n.structure,n.product,n.scene,n.description,CASE WHEN ${identity.role === 'admin'} THEN n.note ELSE NULL END AS note,n.tags,CASE WHEN ${identity.role === 'admin'} THEN n.rating ELSE NULL END AS rating,n.benchmark_url AS "benchmarkUrl",n.source_material_id AS "sourceMaterialId",CASE WHEN ${identity.role === 'admin'} THEN n.source_experiment_id ELSE NULL END AS "sourceExperimentId",n.archived,n.version,n.created_at AS "createdAt",n.updated_at AS "updatedAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',octet_length(f.content)) ORDER BY f.created_at,f.id) FROM studio_os.template_assets f WHERE f.template_id=n.id),'[]') AS assets,(SELECT f.id FROM studio_os.material_assets f WHERE f.material_id=n.source_material_id AND f.mime LIKE 'image/%' ORDER BY f.created_at,f.id LIMIT 1) AS "sourceCoverId" FROM studio_os.note_templates n ORDER BY n.updated_at DESC,n.id`;
    const usages = await this.usages(identity);
    const accountCounts = await this.db
      .client`SELECT t.template_id AS id,count(DISTINCT t.account_id)::int AS n FROM studio_os.tasks t JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.template_id IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.publications n WHERE n.task_id=t.id) AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) GROUP BY t.template_id`;
    return items.map((item) => {
      const tasks = usages.filter((task) => task.templateId === item.id),
        published = tasks.flatMap(
          (t) =>
            t.publications as {
              id: string;
              publishedAt: string;
              conversions: number | null;
              hasConversion: boolean | null;
            }[],
        ),
        counts = published
          .map((p) => p.conversions)
          .filter((v): v is number => v !== null);
      return {
        ...item,
        stats: {
          publishedCount: published.length,
          pendingCount: tasks.reduce(
            (sum, t) =>
              sum +
              (t.productActive
                ? Math.max(
                    0,
                    Number(t.targetCount) -
                      (t.publications as unknown[]).length,
                  )
                : 0),
            0,
          ),
          convertedCount: published.some((p) => p.hasConversion !== null)
            ? published.filter((p) => p.hasConversion === true).length
            : null,
          conversionRate: published.some((p) => p.hasConversion !== null)
            ? published.filter((p) => p.hasConversion === true).length /
              published.filter((p) => p.hasConversion !== null).length
            : null,
          conversionOrders: counts.length
            ? counts.reduce((sum, n) => sum + n, 0)
            : null,
          accountCount: accountCounts.find((row) => row.id === item.id)?.n ?? 0,
          userCount:
            identity.role === 'admin'
              ? new Set(
                  tasks
                    .filter((t) => (t.publications as unknown[]).length)
                    .map((t) => t.memberId),
                ).size
              : null,
          recentPublishTime:
            published
              .map((p) => p.publishedAt)
              .sort()
              .at(-1) || null,
        },
      };
    });
  }
  private usages(identity: Identity, id?: string) {
    return this.db
      .client`SELECT t.id,t.plan_id AS "planId",p.version AS "planVersion",t.template_id AS "templateId",p.title,p.source_type AS "sourceType",p.product_id AS "productId",p.stage_id AS "stageId",g.name AS "productName",coalesce(g.active,true) AS "productActive",t.target_count AS "targetCount",t.instructions,p.requirements,p.planned_publish_on::text AS "plannedPublishOn",CASE WHEN ${identity.role === 'admin'} THEN t.account_id ELSE NULL END AS "accountId",a.name AS "accountName",CASE WHEN ${identity.role === 'admin'} THEN t.member_id ELSE NULL END AS "memberId",m.display_name AS assignee,coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'url',n.url,'publishedAt',n.published_at,'conversions',(SELECT s.conversions FROM studio_os.data_snapshots s WHERE s.publication_id=n.id ORDER BY s.observed_at DESC,s.id DESC LIMIT 1),'hasConversion',(SELECT coalesce(s.has_conversion,CASE WHEN s.conversions IS NULL THEN NULL ELSE s.conversions>0 END) FROM studio_os.data_snapshots s WHERE s.publication_id=n.id ORDER BY s.observed_at DESC,s.id DESC LIMIT 1)) ORDER BY n.created_at,n.id) FROM studio_os.publications n WHERE n.task_id=t.id),'[]') AS publications FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id LEFT JOIN studio_os.products g ON g.id=p.product_id WHERE t.template_id IS NOT NULL AND (${!id} OR t.template_id=${id ?? null}) AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) ORDER BY p.created_at DESC,t.id`;
  }
  async detail(identity: Identity, id: string) {
    uuid(id);
    const item = (await this.list(identity)).find((n) => n.id === id);
    if (!item) throw new NotFoundException();
    return { ...item, usages: await this.usages(identity, id) };
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const keys = [
      'name',
      'structure',
      'product',
      'scene',
      'description',
      'note',
      'tags',
      'rating',
      'benchmarkUrl',
      'sourceMaterialId',
      'sourceExperimentId',
    ];
    const b = objectInput(value, id ? [...keys, 'expectedVersion'] : keys);
    const name = shortText(b.name, 200),
      structure = longText(b.structure, 4000),
      product = optional(b.product, 200),
      scene = optional(b.scene, 100),
      description = optional(b.description),
      note = optional(b.note),
      rating =
        b.rating === undefined || b.rating === null || b.rating === ''
          ? null
          : shortText(b.rating, 1),
      url = b.benchmarkUrl ? webLink(b.benchmarkUrl) : null,
      material = optionalId(b.sourceMaterialId),
      experiment = optionalId(b.sourceExperimentId);
    if (rating && !['S', 'A', 'B', 'C'].includes(rating))
      throw new BadRequestException();
    const tags = b.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 30)
      throw new BadRequestException();
    const normalized = [...new Set(tags.map((t) => shortText(t, 40)))];
    return this.db.client.begin(async (tx) => {
      if (
        material &&
        !(
          await tx`SELECT id FROM studio_os.materials WHERE id=${material} FOR SHARE`
        ).length
      )
        throw new BadRequestException();
      if (
        experiment &&
        !(
          await tx`SELECT id FROM studio_os.lab_experiments WHERE id=${experiment} AND status='concluded' FOR SHARE`
        ).length
      )
        throw new BadRequestException();
      let before, row;
      if (id) {
        [before] =
          await tx`SELECT id,name,structure,product,scene,description,note,tags,rating,benchmark_url,source_material_id,source_experiment_id,version FROM studio_os.note_templates WHERE id=${id} FOR UPDATE`;
        if (!before) throw new NotFoundException();
        if (before.version !== version(b.expectedVersion))
          throw new ConflictException();
        [row] =
          await tx`UPDATE studio_os.note_templates SET name=${name},structure=${structure},product=${product},scene=${scene},description=${description},note=${note},tags=${JSON.stringify(normalized)}::jsonb,rating=${rating},benchmark_url=${url},source_material_id=${material},source_experiment_id=${experiment},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      } else
        [row] =
          await tx`INSERT INTO studio_os.note_templates(name,structure,product,scene,description,note,tags,rating,benchmark_url,source_material_id,source_experiment_id) VALUES(${name},${structure},${product},${scene},${description},${note},${JSON.stringify(normalized)}::jsonb,${rating},${url},${material},${experiment}) RETURNING id,version`;
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${row.id},${identity.id},${id ? 'updated' : 'created'},${JSON.stringify({ before: before ?? null, after: { name, structure, product, scene, description, note, tags: normalized, rating, benchmarkUrl: url, sourceMaterialId: material, sourceExperimentId: experiment } })}::jsonb)`;
      return row;
    });
  }
  async archive(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion', 'archived']);
    if (typeof b.archived !== 'boolean') throw new BadRequestException();
    const v = version(b.expectedVersion),
      archived = b.archived;
    return this.db.client.begin(async (tx) => {
      const [row] =
        await tx`UPDATE studio_os.note_templates SET archived=${archived},version=version+1,updated_at=now() WHERE id=${id} AND version=${v} RETURNING id,version`;
      if (!row) throw new ConflictException();
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action) VALUES(${id},${identity.id},${b.archived ? 'archived' : 'restored'})`;
      return row;
    });
  }
  async remove(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [before] =
        await tx`SELECT id,name,version FROM studio_os.note_templates WHERE id=${id} FOR UPDATE`;
      if (!before) throw new NotFoundException();
      if (before.version !== v) throw new ConflictException();
      const used =
        (
          await tx`SELECT id FROM studio_os.tasks WHERE template_id=${id} LIMIT 1`
        ).length > 0 ||
        (
          await tx`SELECT id FROM studio_os.candidate_references WHERE template_id=${id} LIMIT 1`
        ).length > 0;
      if (used)
        await tx`UPDATE studio_os.note_templates SET archived=true,version=version+1,updated_at=now() WHERE id=${id}`;
      else await tx`DELETE FROM studio_os.note_templates WHERE id=${id}`;
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${id},${identity.id},${used ? 'archived' : 'deleted'},${JSON.stringify({ before })}::jsonb)`;
      return { ok: true, archived: used };
    });
  }
  async file(identity: Identity, id: string, assetId: string) {
    requireContributor(identity);
    uuid(id);
    uuid(assetId);
    const [file] = await this.db.client<
      { name: string; mime: string; content: Buffer }[]
    >`SELECT f.name,f.mime,f.content FROM studio_os.template_assets f WHERE f.id=${assetId} AND f.template_id=${id}`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async upload(
    identity: Identity,
    id: string,
    bytes: unknown,
    name: unknown,
    mime: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    const file = mediaFile(bytes, name, mime);
    return this.db.client.begin(async (tx) => {
      if (
        !(
          await tx`SELECT id FROM studio_os.note_templates WHERE id=${id} FOR UPDATE`
        ).length
      )
        throw new NotFoundException();
      const [usage] =
        await tx`SELECT count(*)::int AS n,coalesce(sum(octet_length(content)),0)::int AS size FROM studio_os.template_assets WHERE template_id=${id}`;
      if (usage.n >= 20 || usage.size + file.content.length > 67108864)
        throw new ConflictException();
      const [asset] =
        await tx`INSERT INTO studio_os.template_assets(template_id,name,mime,content) VALUES(${id},${file.name},${file.mime},${file.content}) RETURNING id,name,mime`;
      await tx`UPDATE studio_os.note_templates SET version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${id},${identity.id},'uploaded',${JSON.stringify({ assetId: asset.id })}::jsonb)`;
      return asset;
    });
  }
  async removeFile(identity: Identity, id: string, assetId: string) {
    requireAdministrator(identity);
    uuid(id);
    uuid(assetId);
    return this.db.client.begin(async (tx) => {
      if (
        !(
          await tx`SELECT id FROM studio_os.note_templates WHERE id=${id} FOR UPDATE`
        ).length
      )
        throw new NotFoundException();
      if (
        !(
          await tx`DELETE FROM studio_os.template_assets WHERE template_id=${id} AND id=${assetId} RETURNING id`
        ).length
      )
        throw new NotFoundException();
      await tx`UPDATE studio_os.note_templates SET version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${id},${identity.id},'asset_deleted',${JSON.stringify({ assetId })}::jsonb)`;
      return { ok: true };
    });
  }
  async assign(identity: Identity, value: unknown) {
    requireAdministrator(identity);
    const {
      title,
      key,
      requirements,
      product,
      stage,
      productVersion,
      date,
      assignments,
    } = planInput(value);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          title,
          requirements,
          product,
          stage,
          productVersion,
          date,
          assignments,
        }),
      )
      .digest('hex');
    return this.db.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key!}))`;
      const [old] =
        await tx`SELECT id,request_hash FROM studio_os.plans WHERE request_key=${key!}`;
      if (old) {
        if (old.request_hash !== hash) throw new ConflictException();
        return { id: old.id };
      }
      if (product) {
        const [p] =
          await tx`SELECT version,active FROM studio_os.products WHERE id=${product} FOR UPDATE`;
        if (!p) throw new NotFoundException();
        if (!p.active || p.version !== productVersion)
          throw new ConflictException();
        if (
          !(
            await tx`SELECT id FROM studio_os.product_stages WHERE product_id=${product} AND id=${stage}`
          ).length
        )
          throw new BadRequestException();
      }
      const owners = new Map<string, string>(),
        materials = new Set<string>(),
        templateSources = new Map<string, string | null>();
      for (const row of assignments) {
        const [template] =
          await tx`SELECT id,version,archived,source_material_id FROM studio_os.note_templates WHERE id=${row.templateId} FOR SHARE`;
        if (!template) throw new NotFoundException();
        if (template.archived || template.version !== row.expectedVersion)
          throw new ConflictException();
        templateSources.set(row.templateId, template.source_material_id);
        if (template.source_material_id)
          materials.add(template.source_material_id);
        const [a] =
          await tx`SELECT m.id AS member FROM studio_os.business_accounts a JOIN studio_os.members m ON m.id=a.responsible_member_id JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE a.id=${row.accountId} AND a.active AND m.active AND l.active FOR SHARE OF a,m,l`;
        if (!a) throw new BadRequestException();
        owners.set(row.accountId, a.member);
      }
      const [plan] =
        await tx`INSERT INTO studio_os.plans(title,request_key,request_hash,created_by,source_type,product_id,stage_id,requirements,planned_publish_on) VALUES(${title},${key!},${hash},${identity.id},'template',${product},${stage},${requirements},${date}::date) RETURNING id`;
      for (const material of materials)
        await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${plan.id},${material})`;
      for (const row of assignments) {
        const [task] =
          await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,template_id,template_material_id,template_version,target_count,instructions) VALUES(${plan.id},${owners.get(row.accountId)!},${row.accountId},${row.templateId},${templateSources.get(row.templateId) ?? null},${row.expectedVersion},${row.targetCount},${row.requirements}) RETURNING id`;
        await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${row.templateId},${identity.id},'assigned',${JSON.stringify({ planId: plan.id, taskId: task.id, targetCount: row.targetCount })}::jsonb)`;
      }
      if (product)
        await tx`UPDATE studio_os.products SET version=version+1,updated_at=now() WHERE id=${product}`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${plan.id},${identity.id},'dispatched',${plan.id})`;
      return plan;
    });
  }
  async editPlan(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const {
      title,
      requirements,
      product,
      stage,
      productVersion,
      date,
      assignments,
      v,
    } = planInput(value, true);
    return this.db.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const [exists] =
        await tx`SELECT id FROM studio_os.plans WHERE id=${id} AND source_type='template'`;
      if (!exists) throw new NotFoundException();
      // Lock the source tasks before the plan, as publication writes also take task locks.
      // Do not count publications in the same statement that may wait on task locks.
      await tx`SELECT id FROM studio_os.tasks WHERE plan_id=${id} ORDER BY id FOR UPDATE`;
      const tasks =
        await tx`SELECT t.id,t.template_id,t.account_id,t.member_id,t.template_material_id,t.template_version,t.target_count,t.instructions,(SELECT count(*)::int FROM studio_os.publications n WHERE n.task_id=t.id) AS published FROM studio_os.tasks t WHERE t.plan_id=${id} ORDER BY t.id`;
      const [before] =
        await tx`SELECT id,title,version,product_id,stage_id,requirements,planned_publish_on FROM studio_os.plans WHERE id=${id} FOR UPDATE`;
      if (before.version !== v) throw new ConflictException();
      if (before.product_id !== product) throw new BadRequestException();
      if (product) {
        const [g] =
          await tx`SELECT active,version FROM studio_os.products WHERE id=${product} FOR UPDATE`;
        if (!g?.active || g.version !== productVersion)
          throw new ConflictException();
        if (
          !(
            await tx`SELECT id FROM studio_os.product_stages WHERE id=${stage} AND product_id=${product}`
          ).length
        )
          throw new BadRequestException();
      }
      const masters = new Map<
          string,
          { source: string | null; version: number }
        >(),
        owners = new Map<string, string>();
      for (const row of assignments) {
        const [master] =
          await tx`SELECT source_material_id,version,archived FROM studio_os.note_templates WHERE id=${row.templateId} FOR SHARE`;
        if (
          !master ||
          master.archived ||
          master.version !== row.expectedVersion
        )
          throw new ConflictException();
        masters.set(row.templateId, {
          source: master.source_material_id,
          version: master.version,
        });
        const [a] =
          await tx`SELECT m.id AS member FROM studio_os.business_accounts a JOIN studio_os.members m ON m.id=a.responsible_member_id JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE a.id=${row.accountId} AND a.active AND m.active AND l.active FOR SHARE OF a,m,l`;
        if (!a) throw new BadRequestException();
        owners.set(row.accountId, a.member);
      }
      for (const task of tasks) {
        const next = assignments.find(
          (a) =>
            a.templateId === task.template_id &&
            a.accountId === task.account_id,
        );
        if (
          task.published &&
          (!next ||
            next.targetCount < task.published ||
            owners.get(task.account_id) !== task.member_id)
        )
          throw new ConflictException();
      }
      for (const task of tasks) {
        if (
          !assignments.some(
            (a) =>
              a.templateId === task.template_id &&
              a.accountId === task.account_id,
          )
        )
          await tx`DELETE FROM studio_os.tasks WHERE id=${task.id}`;
      }
      for (const row of assignments) {
        const previous = tasks.find(
          (t) =>
            t.template_id === row.templateId && t.account_id === row.accountId,
        );
        if (previous)
          await tx`UPDATE studio_os.tasks SET member_id=${owners.get(row.accountId)!},target_count=${row.targetCount},instructions=${row.requirements} WHERE id=${previous.id}`;
        else {
          const master = masters.get(row.templateId)!;
          await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,template_id,template_material_id,template_version,target_count,instructions) VALUES(${id},${owners.get(row.accountId)!},${row.accountId},${row.templateId},${master.source},${master.version},${row.targetCount},${row.requirements})`;
        }
      }
      await tx`DELETE FROM studio_os.plan_materials WHERE plan_id=${id}`;
      await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) SELECT DISTINCT plan_id,template_material_id FROM studio_os.tasks WHERE plan_id=${id} AND template_material_id IS NOT NULL`;
      const [updated] =
        await tx`UPDATE studio_os.plans SET title=${title},requirements=${requirements},stage_id=${stage},planned_publish_on=${date}::date,version=version+1 WHERE id=${id} RETURNING id,version`;
      if (product)
        await tx`UPDATE studio_os.products SET version=version+1,updated_at=now() WHERE id=${product}`;
      for (const templateId of new Set([
        ...assignments.map((a) => a.templateId),
        ...tasks.map((t) => String(t.template_id)),
      ]))
        await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${templateId},${identity.id},'plan_updated',${JSON.stringify({ planId: id, before, previousTasks: tasks, after: assignments, title, requirements, stage, date })}::jsonb)`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${id},${identity.id},'plan_updated',${id})`;
      return updated;
    });
  }
  async plan(identity: Identity, id: string) {
    uuid(id);
    const usages = (await this.usages(identity)).filter((t) => t.planId === id);
    const [plan] = await this.db
      .client`SELECT p.id,p.title,p.version,p.requirements,p.planned_publish_on::text AS "plannedPublishOn",p.product_id AS "productId",p.stage_id AS "stageId",g.name AS "productName",CASE WHEN ${identity.role === 'admin'} THEN g.version ELSE NULL END AS "productVersion" FROM studio_os.plans p LEFT JOIN studio_os.products g ON g.id=p.product_id WHERE p.id=${id} AND p.source_type='template' AND(${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.tasks t JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.plan_id=p.id AND m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id))`;
    if (!plan) throw new NotFoundException();
    return { ...plan, usages };
  }
  async cancelTask(
    identity: Identity,
    id: string,
    taskId: string,
    value: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    uuid(taskId);
    const b = objectInput(value, ['expectedPlanVersion']),
      v = version(b.expectedPlanVersion);
    return this.db.client.begin(async (tx) => {
      const [task] =
        await tx`SELECT t.id,t.plan_id FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id WHERE t.id=${taskId} AND t.template_id=${id} AND p.source_type='template' FOR UPDATE OF t`;
      if (!task) throw new NotFoundException();
      const [plan] =
        await tx`SELECT version,product_id FROM studio_os.plans WHERE id=${task.plan_id} FOR UPDATE`;
      if (plan.version !== v) throw new ConflictException();
      if (
        (
          await tx`SELECT id FROM studio_os.publications WHERE task_id=${taskId} LIMIT 1`
        ).length
      )
        throw new ConflictException();
      await tx`DELETE FROM studio_os.tasks WHERE id=${taskId}`;
      await tx`UPDATE studio_os.plans SET version=version+1 WHERE id=${task.plan_id}`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${task.plan_id},${identity.id},'assignment_cancelled',${taskId})`;
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${id},${identity.id},'assignment_cancelled',${JSON.stringify({ taskId, planId: task.plan_id })}::jsonb)`;
      return { ok: true };
    });
  }
}
