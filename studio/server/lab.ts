// Restores manual experiment/round/review interactions from material-lab-v1.
// Reuses real plans/tasks/publications/snapshots, never platform identities or thresholds.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { Workflow } from './workflow';
import { requireAdministrator } from './access';
import { optionalLabText } from './lab-input';
import { researchActor } from './research';
import { objectInput, uuid, version, longText, shortText } from './validation';
export class MaterialLab {
  constructor(private readonly db: StudioDatabase) {}
  async createDraft(identity: Identity, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, ['title','requestKey','materialIds','lab']);
    return new Workflow(this.db).createPlan(identity, {...b,assignments:[]}, undefined, undefined, {allowUnassigned:true});
  }
  async dispatchReceipt(identity: Identity, id: string, plan: string, key: string) {
    requireAdministrator(identity);uuid(id);uuid(plan);uuid(key);
    const [row]=await this.db.client`SELECT task_ids AS "taskIds",result_version AS version FROM studio_os.lab_dispatch_requests WHERE request_key=${key} AND experiment_id=${id} AND plan_id=${plan} AND actor_id=${identity.id}`;
    if(!row)throw new NotFoundException();
    return {...row,experimentId:id,planId:plan};
  }
  async dispatch(identity: Identity, id: string, plan: string, value: unknown) {
    requireAdministrator(identity);uuid(id);uuid(plan);
    const b=objectInput(value,['expectedVersion','requestKey','assignments']);
    const expected=version(b.expectedVersion),key=uuid(b.requestKey);
    if(!Array.isArray(b.assignments)||!b.assignments.length||b.assignments.length>100)throw new BadRequestException();
    const assignments=b.assignments.map(value=>{
      const a=objectInput(value,['memberId','accountId','targetCount']);
      if(!Number.isInteger(a.targetCount)||Number(a.targetCount)<1||Number(a.targetCount)>10000)throw new BadRequestException();
      return {memberId:uuid(a.memberId),accountId:uuid(a.accountId),targetCount:Number(a.targetCount)};
    }).sort((a,b)=>a.accountId.localeCompare(b.accountId));
    if(new Set(assignments.map(a=>a.accountId)).size!==assignments.length)throw new BadRequestException();
    const hash=createHash('sha256').update(JSON.stringify({id,plan,assignments})).digest('hex');
    return this.db.client.begin(async tx=>{
      await researchActor(tx,identity,true);
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'studio-lab-dispatch:'+key}))`;
      const [receipt]=await tx`SELECT * FROM studio_os.lab_dispatch_requests WHERE request_key=${key}`;
      if(receipt){
        if(receipt.request_hash!==hash||receipt.actor_id!==identity.id)throw new ConflictException();
        return {experimentId:id,planId:plan,taskIds:receipt.task_ids,version:receipt.result_version};
      }
      const [root]=await tx`SELECT status,version FROM studio_os.lab_experiments WHERE id=${id} FOR UPDATE`;
      if(!root)throw new NotFoundException();
      if(root.status!=='testing'||root.version!==expected)throw new ConflictException();
      const [round]=await tx`SELECT id FROM studio_os.plans WHERE id=${plan} AND experiment_id=${id} FOR SHARE`;
      if(!round)throw new NotFoundException();
      const taskIds=[];
      for(const a of assignments){
        const [owner]=await tx`SELECT m.id FROM studio_os.members m JOIN studio_os.business_accounts b ON b.responsible_member_id=m.id WHERE m.id=${a.memberId} AND b.id=${a.accountId} AND m.active AND b.active FOR SHARE OF m,b`;
        if(!owner)throw new BadRequestException('执行账号与负责人不匹配，或已停用');
        if((await tx`SELECT id FROM studio_os.tasks WHERE plan_id=${plan} AND account_id=${a.accountId}`).length)throw new ConflictException('这个账号已有本轮执行事项，请先查看原事项');
        const [task]=await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count) VALUES(${plan},${a.memberId},${a.accountId},${a.targetCount}) RETURNING id`;
        taskIds.push(String(task.id));
      }
      const resultVersion=Number(root.version)+1;
      await tx`UPDATE studio_os.lab_experiments SET version=${resultVersion} WHERE id=${id}`;
      await tx`INSERT INTO studio_os.lab_dispatch_requests(request_key,request_hash,experiment_id,plan_id,actor_id,task_ids,result_version) VALUES(${key},${hash},${id},${plan},${identity.id},${JSON.stringify(taskIds)}::jsonb,${resultVersion})`;
      await tx`INSERT INTO studio_os.lab_events(experiment_id,actor_id,action,detail) VALUES(${id},${identity.id},'assigned',${JSON.stringify({planId:plan,taskIds,requestKey:key})}::jsonb)`;
      await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${plan},${identity.id},'dispatched',${plan})`;
      return {experimentId:id,planId:plan,taskIds,version:resultVersion};
    });
  }
  private async visiblePlans(identity: Identity) {
    return this.db
      .client`SELECT p.id,p.experiment_id AS "experimentId",p.title,p.round_no AS "roundNo",p.adjustment,p.test_variable AS "testVariable",p.requirements AS "executionConditions",p.planned_publish_on::text AS "plannedPublishOn",p.created_at AS "createdAt",CASE WHEN ${identity.role === 'admin'} THEN p.request_key ELSE NULL END AS "requestKey",CASE WHEN ${identity.role === 'admin'} THEN p.conclusion ELSE NULL END AS "legacyConclusion"
   FROM studio_os.plans p WHERE p.experiment_id IS NOT NULL AND (${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.tasks t JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.plan_id=p.id AND m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) ORDER BY p.round_no,p.created_at,p.id`;
  }
  async list(identity: Identity) {
    const plans = await this.visiblePlans(identity),
      tasks = await new Workflow(this.db).tasks(identity);
    const roots = await this.db
      .client`SELECT e.id,e.title,e.hypothesis,e.direction,e.product,CASE WHEN ${identity.role === 'admin'} THEN e.product_id ELSE NULL END AS "linkedProductId",g.name AS "linkedProductName",e.priority,e.status,e.version,e.created_at AS "createdAt",e.ended_at AS "endedAt",CASE WHEN ${identity.role === 'admin'} THEN e.verdict ELSE NULL END AS verdict,CASE WHEN ${identity.role === 'admin'} THEN e.finding ELSE NULL END AS finding,CASE WHEN ${identity.role === 'admin'} THEN e.recommendation ELSE NULL END AS recommendation,CASE WHEN ${identity.role === 'admin'} THEN e.tags ELSE '[]'::jsonb END AS tags
   FROM studio_os.lab_experiments e LEFT JOIN studio_os.products g ON g.id=e.product_id WHERE ${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.plans p JOIN studio_os.tasks t ON t.plan_id=p.id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE p.experiment_id=e.id AND m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id) ORDER BY e.priority DESC,e.created_at DESC,e.id`;
    const refs = await this.db
      .client`SELECT r.plan_id AS "planId",m.id,m.title,m.source_url AS "sourceUrl",m.metadata->>'product' AS product,(SELECT f.id FROM studio_os.material_assets f WHERE f.material_id=m.id AND f.mime LIKE 'image/%' ORDER BY CASE WHEN f.kind='screenshot' THEN 0 ELSE 1 END,f.created_at,f.id LIMIT 1) AS "coverId" FROM studio_os.plan_materials r JOIN studio_os.materials m ON m.id=r.material_id JOIN studio_os.plans p ON p.id=r.plan_id WHERE p.experiment_id IS NOT NULL AND (${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.tasks t JOIN studio_os.members n ON n.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.plan_id=p.id AND n.login_account_id=${identity.id} AND n.active AND a.active AND a.responsible_member_id=n.id))`;
    const accountRefs =
      identity.role === 'admin'
        ? await this.db
            .client`SELECT id,account_id AS "accountId" FROM studio_os.tasks`
        : [];
    const reviews =
      identity.role === 'admin'
        ? await this.db
            .client`SELECT experiment_id AS "experimentId",plan_id AS "planId",decision,created_at AS "createdAt" FROM studio_os.lab_reviews ORDER BY created_at DESC,id`
        : [];
    return roots.flatMap((root) => {
      const rounds = plans
        .filter((p) => p.experimentId === root.id)
        .map((p) => ({
          ...p,
          tasks: tasks
            .filter((t) => t.planId === p.id)
            .map((t) => ({
              ...t,
              id: String(t.id),
              accountId:
                identity.role === 'admin'
                  ? accountRefs.find((a) => a.id === t.id)?.accountId
                  : null,
            })),
          materials: refs.filter((m) => m.planId === p.id),
          review: reviews.find((r) => r.planId === p.id) ?? null,
        }));
      if (!rounds.length) return [];
      return [{ ...root, id: String(root.id), rounds }];
    });
  }
  async detail(identity: Identity, id: string) {
    uuid(id);
    const experiment = (await this.list(identity)).find((e) => e.id === id);
    if (!experiment) throw new NotFoundException();
    const workflow = new Workflow(this.db);
    const rounds = await Promise.all(
      experiment.rounds.map(async (round) => ({
        ...round,
        executions: await Promise.all(
          round.tasks.map((t) => workflow.detail(identity, String(t.id))),
        ),
      })),
    );
    const reviews =
      identity.role === 'admin'
        ? await this.db
            .client`SELECT r.id,r.plan_id AS "planId",r.decision,r.note,r.created_at AS "createdAt",coalesce(m.display_name,a.username,'管理员') AS reviewer FROM studio_os.lab_reviews r LEFT JOIN studio_os.accounts a ON a.id=r.actor_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE r.experiment_id=${id} ORDER BY r.created_at,r.id`
        : [];
    return { ...experiment, rounds, reviews };
  }
  async nextRound(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, [
      'expectedVersion',
      'title',
      'requestKey',
      'materialIds',
      'assignments',
      'templateAssignments',
      'lab',
    ]);
    const { expectedVersion, ...body } = b;
    return new Workflow(this.db).createPlan(identity, body, {
      experimentId: id,
      expectedVersion: version(expectedVersion),
    }, undefined, { allowUnassigned: true });
  }
  async linkProduct(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion', 'linkedProductId']);
    const expected = version(b.expectedVersion);
    if (b.linkedProductId !== null && typeof b.linkedProductId !== 'string')
      throw new BadRequestException();
    const product = b.linkedProductId === null ? null : uuid(b.linkedProductId);
    return this.db.client.begin(async (tx) => {
      const [actor] =
        await tx`SELECT active,role FROM studio_os.accounts WHERE id=${identity.id} FOR SHARE`;
      if (!actor?.active) throw new UnauthorizedException();
      if (actor.role !== 'admin') throw new ForbiddenException();
      const [root] =
        await tx`SELECT id,status,version,product_id FROM studio_os.lab_experiments WHERE id=${id} FOR UPDATE`;
      if (!root) throw new NotFoundException();
      if (expected > root.version) throw new ConflictException();
      // Desired-state PATCH: replay of an applied setter is read-only, even if
      // other metadata changed or the experiment later concluded. Never reapply
      // an old desired value after a different association has been saved.
      if (root.product_id === product)
        return { id, version: root.version, linkedProductId: product };
      if (root.version !== expected || root.status !== 'testing')
        throw new ConflictException();
      const previous = root.product_id
        ? (
            await tx`SELECT id,name FROM studio_os.products WHERE id=${root.product_id} FOR SHARE`
          )[0]
        : null;
      const next = product
        ? (
            await tx`SELECT id,name FROM studio_os.products WHERE id=${product} FOR SHARE`
          )[0]
        : null;
      if (product && !next) throw new NotFoundException();
      const [updated] =
        await tx`UPDATE studio_os.lab_experiments SET product_id=${product},version=version+1 WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.lab_events(experiment_id,actor_id,action,detail) VALUES(${id},${identity.id},'product_linked',${JSON.stringify({ before: previous ?? null, after: next ?? null, version: updated.version })}::jsonb)`;
      return { ...updated, linkedProductId: product };
    });
  }
  async priority(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['priority', 'expectedVersion']);
    const expected = version(b.expectedVersion);
    if (typeof b.priority !== 'boolean') throw new BadRequestException();
    const priority = b.priority;
    return this.db.client.begin(async (tx) => {
      const [row] =
        await tx`UPDATE studio_os.lab_experiments SET priority=${priority},version=version+1 WHERE id=${id} AND version=${expected} RETURNING id,version`;
      if (!row) {
        if (
          !(await tx`SELECT id FROM studio_os.lab_experiments WHERE id=${id}`)
            .length
        )
          throw new NotFoundException();
        throw new ConflictException();
      }
      await tx`INSERT INTO studio_os.lab_events(experiment_id,actor_id,action,detail) VALUES(${id},${identity.id},'priority',${JSON.stringify({ priority: b.priority })}::jsonb)`;
      return row;
    });
  }
  async review(identity: Identity, id: string, plan: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    uuid(plan);
    const b = objectInput(value, [
      'expectedVersion',
      'decision',
      'note',
      'requestKey',
    ]);
    const expected = version(b.expectedVersion),
      key = uuid(b.requestKey),
      note = longText(b.note);
    if (
      !['表现好', '有信号，继续验证', '表现差', '暂时无法判断'].includes(
        String(b.decision),
      )
    )
      throw new BadRequestException();
    const decision = String(b.decision),
      hash = createHash('sha256')
        .update(JSON.stringify({ id, plan, decision, note }))
        .digest('hex');
    return this.db.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'studio-lab-review:' + key}))`;
      // All experiment changes use the same row lock; retry keys cannot cross experiments.
      const [root] =
        await tx`SELECT status,version FROM studio_os.lab_experiments WHERE id=${id} FOR UPDATE`;
      if (!root) throw new NotFoundException();
      const [before] =
        await tx`SELECT id,request_hash FROM studio_os.lab_reviews WHERE request_key=${key}`;
      if (before) {
        if (before.request_hash !== hash) throw new ConflictException();
        return { id: before.id };
      }
      if (root.status !== 'testing' || root.version !== expected)
        throw new ConflictException();
      if (
        !(
          await tx`SELECT id FROM studio_os.plans WHERE id=${plan} AND experiment_id=${id}`
        ).length
      )
        throw new NotFoundException();
      const [row] =
        await tx`INSERT INTO studio_os.lab_reviews(experiment_id,plan_id,actor_id,decision,note,request_key,request_hash) VALUES(${id},${plan},${identity.id},${decision},${note},${key},${hash}) RETURNING id`;
      await tx`UPDATE studio_os.lab_experiments SET version=version+1 WHERE id=${id}`;
      await tx`INSERT INTO studio_os.lab_events(experiment_id,actor_id,action,detail) VALUES(${id},${identity.id},'reviewed',${JSON.stringify({ planId: plan, reviewId: row.id })}::jsonb)`;
      return row;
    });
  }
  async finish(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, [
      'expectedVersion',
      'verdict',
      'finding',
      'recommendation',
      'tags',
    ]);
    const expected = version(b.expectedVersion),
      finding = longText(b.finding),
      recommendation = optionalLabText(b.recommendation);
    if (
      !['reusable', 'conditional', 'rejected', 'unclear'].includes(
        String(b.verdict),
      ) ||
      !Array.isArray(b.tags) ||
      b.tags.length > 20
    )
      throw new BadRequestException();
    const tags = [...new Set(b.tags.map((t) => shortText(t, 40)))];
    return this.db.client.begin(async (tx) => {
      const [before] =
        await tx`SELECT status,version,verdict,finding,recommendation,tags FROM studio_os.lab_experiments WHERE id=${id} FOR UPDATE`;
      if (!before) throw new NotFoundException();
      if (before.version !== expected) throw new ConflictException();
      const [row] =
        await tx`UPDATE studio_os.lab_experiments SET status='concluded',verdict=${String(b.verdict)},finding=${finding},recommendation=${recommendation},tags=${JSON.stringify(tags)}::jsonb,ended_at=coalesce(ended_at,now()),version=version+1 WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.lab_events(experiment_id,actor_id,action,detail) VALUES(${id},${identity.id},${before.status === 'concluded' ? 'conclusion_updated' : 'finished'},${JSON.stringify({ before: { verdict: before.verdict, finding: before.finding, recommendation: before.recommendation, tags: before.tags }, after: { verdict: b.verdict, finding, recommendation, tags } })}::jsonb)`;
      return row;
    });
  }
}
