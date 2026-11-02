// Selective restoration of ProductTestingPanel@c480973. No legacy SQL/platform identity.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import {
  objectInput,
  uuid,
  shortText,
  longText,
  version,
  httpsUrl,
} from './validation';
import { mediaFile } from './media';
import { Workflow, timestamp } from './workflow';
import { productSummary } from './product-summary';
import {
  type ExistingTemplateTask,
  productTemplateInput,
  productTemplateSources,
  syncProductTemplateTasks,
} from './product-template-tasks';
const optional = (value: unknown, max = 2000) =>
  value === undefined || value === null || value === ''
    ? ''
    : longText(value, max);
const positive = (value: unknown) => {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    throw new BadRequestException();
  return Number(value);
};
function planInput(value: unknown) {
  const b = objectInput(value, [
    'expectedVersion',
    'requestKey',
    'stageId',
    'title',
    'requirements',
    'plannedPublishOn',
    'kind',
    'memberId',
    'items',
    'templateAssignments',
  ]);
  const key = uuid(b.requestKey),
    stage = uuid(b.stageId),
    title = shortText(b.title, 200),
    requirements = optional(b.requirements),
    v = version(b.expectedVersion);
  if (!['action', 'publication'].includes(String(b.kind)))
    throw new BadRequestException();
  const kind = String(b.kind),
    member = kind === 'action' ? uuid(b.memberId) : null;
  let date: string | null = null;
  if (b.plannedPublishOn !== undefined && b.plannedPublishOn !== '') {
    if (
      typeof b.plannedPublishOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.plannedPublishOn) ||
      timestamp(b.plannedPublishOn + 'T00:00:00Z').slice(0, 10) !==
        b.plannedPublishOn
    )
      throw new BadRequestException();
    date = b.plannedPublishOn;
  }
  if (
    kind === 'publication' &&
    b.items !== undefined &&
    !Array.isArray(b.items)
  )
    throw new BadRequestException();
  const items =
    kind === 'action'
      ? []
      : Array.isArray(b.items)
        ? b.items.map((value) => {
            const r = objectInput(value, [
              'materialId',
              'accountId',
              'targetCount',
              'requirements',
              'topicReference',
              'titleReference',
              'coverReference',
            ]);
            return {
              materialId: uuid(r.materialId),
              accountId: uuid(r.accountId),
              targetCount: positive(r.targetCount),
              requirements: optional(r.requirements),
              topic: optional(r.topicReference, 1000),
              title: optional(r.titleReference, 1000),
              cover: optional(r.coverReference, 1000),
            };
          })
        : [];
  const templateAssignments = productTemplateInput(b.templateAssignments);
  if (kind === 'action' && templateAssignments.length)
    throw new BadRequestException();
  if (
    kind === 'publication' &&
    ((!items.length && !templateAssignments.length) ||
      items.length + templateAssignments.length > 100 ||
      new Set(items.map((i) => i.accountId + ':' + i.materialId)).size !==
        items.length)
  )
    throw new BadRequestException();
  return {
    key,
    stage,
    title,
    requirements,
    v,
    date,
    kind,
    member,
    items,
    templateAssignments,
    hasTemplateAssignments: b.templateAssignments !== undefined,
  };
}
export class Products {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity) {
    return this.db
      .client`SELECT p.id,p.name,p.active,p.version,p.created_at AS "createdAt",EXISTS(SELECT 1 FROM studio_os.product_images i WHERE i.product_id=p.id) AS "hasImage",CASE WHEN ${identity.role === 'admin'} THEN p.notes ELSE NULL END AS notes,CASE WHEN ${identity.role === 'admin'} THEN s.name ELSE NULL END AS "storeName" FROM studio_os.products p LEFT JOIN studio_os.stores s ON s.id=p.store_id WHERE ${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.plans q JOIN studio_os.tasks t ON t.plan_id=q.id JOIN studio_os.members m ON m.id=t.member_id LEFT JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE q.product_id=p.id AND m.login_account_id=${identity.id} AND m.active AND (t.kind='action' OR(a.active AND a.responsible_member_id=m.id))) ORDER BY p.updated_at DESC,p.id`;
  }
  async detail(identity: Identity, id: string) {
    uuid(id);
    const product = (await this.list(identity)).find((p) => p.id === id);
    if (!product) throw new NotFoundException();
    const tasks = (await new Workflow(this.db).tasks(identity)).filter(
      (t) => t.productId === id,
    );
    const stages = await this.db
      .client`SELECT id,name,position FROM studio_os.product_stages WHERE product_id=${id} AND (${identity.role === 'admin'} OR id IN(SELECT stage_id FROM studio_os.plans WHERE id=ANY(${this.db.client.array(
      tasks.map((t) => String(t.planId)),
      2950,
    )}))) ORDER BY position,id`;
    const plans = await this.db
      .client`SELECT id,title,version,stage_id AS "stageId",requirements,planned_publish_on::text AS "plannedPublishOn" FROM studio_os.plans WHERE product_id=${id} AND (${identity.role === 'admin'} OR id=ANY(${this.db.client.array(
      tasks.map((t) => String(t.planId)),
      2950,
    )})) ORDER BY created_at,id`;
    const executions = await Promise.all(
      tasks.map((t) => new Workflow(this.db).detail(identity, String(t.id))),
    );
    const reviews =
      identity.role === 'admin'
        ? await this.db
            .client`SELECT id,decision,reason,created_at AS "createdAt" FROM studio_os.product_reviews WHERE product_id=${id} ORDER BY created_at,id`
        : [];
    const [privateFields] =
      identity.role === 'admin'
        ? await this.db
            .client`SELECT store_id AS "storeId" FROM studio_os.products WHERE id=${id}`
        : [];
    return {
      ...product,
      ...privateFields,
      stages,
      plans,
      tasks,
      executions,
      reviews,
      ...(identity.role === 'admin'
        ? { summary: productSummary(stages, plans, executions) }
        : {}),
    };
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const b = objectInput(
      value,
      id
        ? ['name', 'notes', 'storeId', 'expectedVersion']
        : ['name', 'notes', 'storeId', 'stages'],
    );
    const name = shortText(b.name, 200),
      notes = optional(b.notes),
      store = b.storeId ? uuid(b.storeId) : null;
    const stages = id
      ? []
      : Array.isArray(b.stages)
        ? b.stages.map((s) => shortText(s, 100))
        : [];
    if (
      !id &&
      (!stages.length ||
        stages.length > 20 ||
        new Set(stages).size !== stages.length)
    )
      throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      if (
        store &&
        !(
          await tx`SELECT id FROM studio_os.stores WHERE id=${store} AND (active OR EXISTS(SELECT 1 FROM studio_os.products WHERE id=${id ?? null} AND store_id=${store})) FOR SHARE`
        ).length
      )
        throw new BadRequestException();
      let row;
      if (id) {
        const [old] =
          await tx`SELECT id,version FROM studio_os.products WHERE id=${id} FOR UPDATE`;
        if (!old) throw new NotFoundException();
        if (old.version !== version(b.expectedVersion))
          throw new ConflictException();
        [row] =
          await tx`UPDATE studio_os.products SET name=${name},notes=${notes},store_id=${store},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      } else {
        [row] =
          await tx`INSERT INTO studio_os.products(name,notes,store_id,created_by) VALUES(${name},${notes},${store},${identity.id}) RETURNING id,version`;
        for (const [i, stage] of stages.entries())
          await tx`INSERT INTO studio_os.product_stages(product_id,name,position) VALUES(${row.id},${stage},${i + 1})`;
      }
      await tx`INSERT INTO studio_os.product_events(product_id,actor_id,action,detail) VALUES(${row.id},${identity.id},${id ? 'updated' : 'created'},${JSON.stringify({ name, notes, storeId: store, stages })}::jsonb)`;
      return row;
    });
  }
  async stages(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion', 'stages']);
    if (!Array.isArray(b.stages) || !b.stages.length || b.stages.length > 20)
      throw new BadRequestException();
    const stages = b.stages.map((value) => {
      const s = objectInput(value, ['id', 'name']);
      return { id: s.id ? uuid(s.id) : null, name: shortText(s.name, 100) };
    });
    if (
      new Set(stages.map((s) => s.name)).size !== stages.length ||
      new Set(stages.filter((s) => s.id).map((s) => s.id)).size !==
        stages.filter((s) => s.id).length
    )
      throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      const [p] =
        await tx`SELECT version FROM studio_os.products WHERE id=${id} FOR UPDATE`;
      if (!p) throw new NotFoundException();
      if (p.version !== version(b.expectedVersion))
        throw new ConflictException();
      const old =
        await tx`SELECT id FROM studio_os.product_stages WHERE product_id=${id}`;
      if (stages.some((s) => s.id && !old.some((o) => o.id === s.id)))
        throw new BadRequestException();
      for (const stage of old.filter(
        (o) => !stages.some((s) => s.id === o.id),
      )) {
        if (
          (
            await tx`SELECT id FROM studio_os.plans WHERE stage_id=${stage.id} LIMIT 1`
          ).length
        )
          throw new ConflictException();
        await tx`DELETE FROM studio_os.product_stages WHERE id=${stage.id}`;
      }
      for (const [i, s] of stages.entries())
        if (s.id)
          await tx`UPDATE studio_os.product_stages SET name=${s.name},position=${i + 1} WHERE id=${s.id}`;
        else
          await tx`INSERT INTO studio_os.product_stages(product_id,name,position) VALUES(${id},${s.name},${i + 1})`;
      const [result] =
        await tx`UPDATE studio_os.products SET version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.product_events(product_id,actor_id,action,detail) VALUES(${id},${identity.id},'stages_updated',${JSON.stringify(stages)}::jsonb)`;
      return result;
    });
  }
  async image(identity: Identity, id: string) {
    uuid(id);
    const [file] = await this.db.client<
      { name: string; mime: string; content: Buffer }[]
    >`SELECT i.name,i.mime,i.content FROM studio_os.product_images i WHERE i.product_id=${id} AND (${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.plans p JOIN studio_os.tasks t ON t.plan_id=p.id JOIN studio_os.members m ON m.id=t.member_id LEFT JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE p.product_id=i.product_id AND m.login_account_id=${identity.id} AND m.active AND(t.kind='action' OR(a.active AND a.responsible_member_id=m.id))))`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async upload(
    identity: Identity,
    id: string,
    bytes: unknown,
    name: unknown,
    mime: unknown,
    expectedVersion: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    const file = mediaFile(bytes, name, mime);
    if (file.mime === 'video/mp4') throw new BadRequestException();
    const v = version(Number(expectedVersion));
    return this.db.client.begin(async (tx) => {
      const [p] =
        await tx`SELECT version FROM studio_os.products WHERE id=${id} FOR UPDATE`;
      if (!p) throw new NotFoundException();
      if (p.version !== v) throw new ConflictException();
      await tx`INSERT INTO studio_os.product_images(product_id,name,mime,content) VALUES(${id},${file.name},${file.mime},${file.content}) ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,mime=excluded.mime,content=excluded.content`;
      const [result] =
        await tx`UPDATE studio_os.products SET version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.product_events(product_id,actor_id,action) VALUES(${id},${identity.id},'image_updated')`;
      return result;
    });
  }
  async review(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion', 'decision', 'reason']);
    if (!['continue', 'adjust', 'stop'].includes(String(b.decision)))
      throw new BadRequestException();
    const reason = longText(b.reason);
    return this.db.client.begin(async (tx) => {
      const [p] =
        await tx`SELECT version FROM studio_os.products WHERE id=${id} FOR UPDATE`;
      if (!p) throw new NotFoundException();
      if (p.version !== version(b.expectedVersion))
        throw new ConflictException();
      await tx`INSERT INTO studio_os.product_reviews(product_id,actor_id,decision,reason) VALUES(${id},${identity.id},${String(b.decision)},${reason})`;
      const [result] =
        await tx`UPDATE studio_os.products SET active=${b.decision !== 'stop'},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      return result;
    });
  }
  async dispatch(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const {
      key,
      stage,
      title,
      requirements,
      v,
      date,
      kind,
      member,
      items,
      templateAssignments,
    } = planInput(value);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          id,
          stage,
          title,
          requirements,
          v,
          date,
          kind,
          member,
          items,
          ...(templateAssignments.length ? { templateAssignments } : {}),
        }),
      )
      .digest('hex');
    return this.db.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const [old] =
        await tx`SELECT id,request_hash FROM studio_os.plans WHERE request_key=${key}`;
      if (old) {
        if (old.request_hash !== hash) throw new ConflictException();
        return { id: old.id };
      }
      const [p] =
        await tx`SELECT version,active FROM studio_os.products WHERE id=${id} FOR UPDATE`;
      if (!p) throw new NotFoundException();
      if (p.version !== v || !p.active) throw new ConflictException();
      if (
        !(
          await tx`SELECT id FROM studio_os.product_stages WHERE id=${stage} AND product_id=${id}`
        ).length
      )
        throw new BadRequestException();
      if (
        member &&
        !(
          await tx`SELECT m.id FROM studio_os.members m JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE m.id=${member} AND m.active AND l.active FOR SHARE OF m,l`
        ).length
      )
        throw new BadRequestException();
      const owners = new Map<string, string>();
      for (const item of items) {
        if (
          !(
            await tx`SELECT id FROM studio_os.materials WHERE id=${item.materialId} FOR SHARE`
          ).length
        )
          throw new BadRequestException();
        const [a] =
          await tx`SELECT a.responsible_member_id AS member FROM studio_os.business_accounts a JOIN studio_os.members m ON m.id=a.responsible_member_id JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE a.id=${item.accountId} AND a.active AND m.active AND l.active FOR SHARE OF a,m,l`;
        if (!a) throw new BadRequestException();
        owners.set(item.accountId, a.member);
      }
      const templateSources = await productTemplateSources(
        tx,
        templateAssignments,
      );
      const [plan] =
        await tx`INSERT INTO studio_os.plans(title,request_key,request_hash,created_by,source_type,product_id,stage_id,requirements,planned_publish_on) VALUES(${title},${key},${hash},${identity.id},'product',${id},${stage},${requirements},${date}::date) RETURNING id`;
      for (const material of new Set(items.map((i) => i.materialId)))
        await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${plan.id},${material})`;
      if (kind === 'action')
        await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count,kind) VALUES(${plan.id},${member},NULL,1,'action')`;
      for (const [account, owner] of owners) {
        const ownItems = items.filter((i) => i.accountId === account),
          total = ownItems.reduce((sum, i) => sum + i.targetCount, 0);
        positive(total);
        const [task] =
          await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count) VALUES(${plan.id},${owner},${account},${total}) RETURNING id`;
        for (const item of ownItems)
          await tx`INSERT INTO studio_os.task_materials(task_id,material_id,target_count,requirements,topic_reference,title_reference,cover_reference) VALUES(${task.id},${item.materialId},${item.targetCount},${item.requirements},${item.topic},${item.title},${item.cover})`;
      }
      const templateMaterials = await syncProductTemplateTasks(
        tx,
        identity,
        plan.id,
        templateAssignments,
        templateSources,
      );
      for (const material of templateMaterials)
        await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${plan.id},${material}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${plan.id},${identity.id},'dispatched',${plan.id})`;
      await tx`UPDATE studio_os.products SET version=version+1,updated_at=now() WHERE id=${id}`;
      return plan;
    });
  }
  async editPlan(
    identity: Identity,
    id: string,
    planId: string,
    value: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    uuid(planId);
    const {
      stage,
      title,
      requirements,
      v,
      date,
      kind,
      member,
      items,
      templateAssignments,
      hasTemplateAssignments,
    } = planInput(value);
    return this.db.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${planId}))`;
      if (
        !(
          await tx`SELECT id FROM studio_os.plans WHERE id=${planId} AND product_id=${id} AND source_type='product'`
        ).length
      )
        throw new NotFoundException();
      // Lock first, then read evidence in a new READ COMMITTED statement.
      // A publication can commit while this lock waits without updating the task row.
      await tx`SELECT id FROM studio_os.tasks WHERE plan_id=${planId} ORDER BY id FOR UPDATE`;
      const tasks = await tx<
        (ExistingTemplateTask & { kind: string; completed: boolean })[]
      >`SELECT t.id,t.member_id,t.account_id,t.kind,t.template_id,t.template_material_id,t.template_version,t.target_count,t.instructions,(SELECT count(*)::int FROM studio_os.publications n WHERE n.task_id=t.id) AS published,EXISTS(SELECT 1 FROM studio_os.action_completions c WHERE c.task_id=t.id) AS completed FROM studio_os.tasks t WHERE plan_id=${planId} ORDER BY id`;
      if (tasks.some((t) => t.template_id) && !hasTemplateAssignments)
        throw new ConflictException();
      const plainTasks = tasks.filter((t) => !t.template_id);
      // Execution writes lock tasks before their workflow-event FK needs the plan.
      const [before] =
        await tx`SELECT id,title,stage_id,requirements,planned_publish_on,version FROM studio_os.plans WHERE id=${planId} AND product_id=${id} FOR UPDATE`;
      if (!before) throw new NotFoundException();
      if (before.version !== v) throw new ConflictException();
      if (!tasks.length || tasks.some((t) => t.kind !== kind))
        throw new BadRequestException();
      const [product] =
        await tx`SELECT active FROM studio_os.products WHERE id=${id} FOR UPDATE`;
      if (!product?.active) throw new ConflictException();
      if (
        !(
          await tx`SELECT id FROM studio_os.product_stages WHERE id=${stage} AND product_id=${id}`
        ).length
      )
        throw new BadRequestException();
      if (kind === 'action') {
        if (
          !(
            await tx`SELECT m.id FROM studio_os.members m JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE m.id=${member} AND m.active AND l.active FOR SHARE OF m,l`
          ).length
        )
          throw new BadRequestException();
        if (tasks[0].completed && tasks[0].member_id !== member)
          throw new ConflictException();
        await tx`UPDATE studio_os.tasks SET member_id=${member} WHERE id=${tasks[0].id}`;
      } else {
        const beforeAllocations =
          await tx`SELECT task_id,material_id,target_count,requirements,topic_reference,title_reference,cover_reference FROM studio_os.task_materials WHERE task_id IN ${tx(tasks.map((t) => t.id))}`;
        const published =
          await tx`SELECT task_id,material_id,count(*)::int AS n FROM studio_os.publications WHERE task_id IN ${tx(tasks.map((t) => t.id))} GROUP BY task_id,material_id`;
        const owners = new Map<string, string>();
        for (const item of items) {
          if (
            !(
              await tx`SELECT id FROM studio_os.materials WHERE id=${item.materialId} FOR SHARE`
            ).length
          )
            throw new BadRequestException();
          const [a] =
            await tx`SELECT a.responsible_member_id AS member FROM studio_os.business_accounts a JOIN studio_os.members m ON m.id=a.responsible_member_id JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE a.id=${item.accountId} AND a.active AND m.active AND l.active FOR SHARE OF a,m,l`;
          if (!a) throw new BadRequestException();
          owners.set(item.accountId, a.member);
        }
        for (const task of plainTasks) {
          if (task.published && !owners.has(task.account_id))
            throw new ConflictException();
          if (task.published && owners.get(task.account_id) !== task.member_id)
            throw new ConflictException();
          for (const row of published.filter((n) => n.task_id === task.id)) {
            const allocation = items.find(
              (i) =>
                i.accountId === task.account_id &&
                i.materialId === row.material_id,
            );
            if (!allocation || allocation.targetCount < row.n)
              throw new ConflictException();
          }
        }
        const templateSources = await productTemplateSources(
          tx,
          templateAssignments,
          tasks,
        );
        // Only tasks without publication evidence can be removed or reassigned.
        for (const task of plainTasks.filter((t) => !owners.has(t.account_id)))
          await tx`DELETE FROM studio_os.tasks WHERE id=${task.id}`;
        for (const [account, owner] of owners) {
          const ownItems = items.filter((i) => i.accountId === account),
            total = positive(
              ownItems.reduce((sum, i) => sum + i.targetCount, 0),
            );
          let task = plainTasks.find((t) => t.account_id === account);
          if (task)
            await tx`UPDATE studio_os.tasks SET member_id=${owner},target_count=${total} WHERE id=${task.id}`;
          else
            [task] =
              await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count) VALUES(${planId},${owner},${account},${total}) RETURNING id`;
          await tx`DELETE FROM studio_os.task_materials WHERE task_id=${task!.id}`;
          for (const item of ownItems)
            await tx`INSERT INTO studio_os.task_materials(task_id,material_id,target_count,requirements,topic_reference,title_reference,cover_reference) VALUES(${task!.id},${item.materialId},${item.targetCount},${item.requirements},${item.topic},${item.title},${item.cover})`;
        }
        await tx`DELETE FROM studio_os.plan_materials WHERE plan_id=${planId}`;
        for (const materialId of new Set(items.map((i) => i.materialId)))
          await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${planId},${materialId})`;
        const templateMaterials = await syncProductTemplateTasks(
          tx,
          identity,
          planId,
          templateAssignments,
          templateSources,
          tasks,
        );
        for (const material of templateMaterials)
          await tx`INSERT INTO studio_os.plan_materials(plan_id,material_id) VALUES(${planId},${material}) ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO studio_os.product_events(product_id,actor_id,action,detail) VALUES(${id},${identity.id},'allocations_updated',${JSON.stringify({ planId, before: beforeAllocations, after: items, beforeTemplates: tasks.filter((t) => t.template_id), afterTemplates: templateAssignments })}::jsonb)`;
      }
      const [result] =
        await tx`UPDATE studio_os.plans SET title=${title},stage_id=${stage},requirements=${requirements},planned_publish_on=${date}::date,version=version+1 WHERE id=${planId} RETURNING id,version`;
      await tx`UPDATE studio_os.products SET version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.product_events(product_id,actor_id,action,detail) VALUES(${id},${identity.id},'plan_updated',${JSON.stringify({ planId, before, after: { title, stage, requirements, date, member } })}::jsonb)`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${planId},${identity.id},'plan_updated',${planId})`;
      return result;
    });
  }
  async complete(identity: Identity, taskId: string, value: unknown) {
    uuid(taskId);
    const b = objectInput(value, ['evidenceUrl', 'feedback']),
      url = httpsUrl(b.evidenceUrl),
      feedback = optional(b.feedback);
    if (!url && !feedback) throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      const [task] =
        await tx`SELECT t.plan_id,p.product_id FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id WHERE t.id=${taskId} AND t.kind='action' AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active)) FOR UPDATE OF t FOR SHARE OF m`;
      if (!task) throw new NotFoundException();
      const [product] =
        await tx`SELECT active FROM studio_os.products WHERE id=${task.product_id} FOR SHARE`;
      if (!product?.active) throw new ConflictException();
      const [existing] =
        await tx`SELECT evidence_url,feedback FROM studio_os.action_completions WHERE task_id=${taskId}`;
      if (existing) {
        if (existing.evidence_url !== url || existing.feedback !== feedback)
          throw new ConflictException();
        return { ok: true };
      }
      await tx`INSERT INTO studio_os.action_completions(task_id,evidence_url,feedback,completed_by) VALUES(${taskId},${url},${feedback},${identity.id})`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${task.plan_id},${identity.id},'action_completed',${taskId})`;
      return { ok: true };
    });
  }
}
