import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator, requireContributor } from './access';
import {
  objectInput,
  shortText,
  optionalLongText,
  uuid,
  version,
  httpsUrl,
} from './validation';
import { materialSource } from './material-source';
const text = optionalLongText;
export type CandidateOrigin = { candidateId: string; expectedVersion: number };
export async function researchActor(
  tx: TransactionSql,
  identity: Identity,
  admin = false,
) {
  const [a] =
    await tx`SELECT active,role FROM studio_os.accounts WHERE id=${identity.id} FOR SHARE`;
  if (!a?.active) throw new UnauthorizedException();
  if (admin && a.role !== 'admin') throw new ForbiddenException();
  return a;
}
export async function candidateSnapshot(tx: TransactionSql, id: string) {
  const [candidate] =
    await tx`SELECT id,title,hypothesis,scope,evidence_level AS "evidenceLevel",priority,status,version FROM studio_os.research_candidates WHERE id=${id}`;
  if (!candidate) throw new NotFoundException();
  const refs =
    await tx`SELECT r.id,r.material_id AS "materialId",r.element_id AS "elementId",r.template_id AS "templateId",r.idea,
   coalesce(m.title,em.title,n.name,'内部想法') AS title,coalesce(m.source_url,em.source_url,n.benchmark_url) AS "sourceUrl",
   e.content,e.reason,e.evidence,e.asset_id AS "assetId",e.material_id AS "elementMaterialId",e.dimension_id AS "dimensionId",d.name AS dimension,e.version AS "elementVersion",d.version AS "dimensionVersion",
   e.store_id AS "storeId",e.product_id AS "productId",e.theme,n.structure AS "templateStructure",n.version AS "templateVersion",n.archived AS "templateArchived"
   FROM studio_os.candidate_references r LEFT JOIN studio_os.materials m ON m.id=r.material_id LEFT JOIN studio_os.material_elements e ON e.id=r.element_id LEFT JOIN studio_os.materials em ON em.id=e.material_id LEFT JOIN studio_os.reference_dimensions d ON d.id=e.dimension_id LEFT JOIN studio_os.note_templates n ON n.id=r.template_id WHERE r.candidate_id=${id} ORDER BY r.id`;
  return { ...candidate, references: Array.from(refs) };
}
// Called inside Workflow's transaction; candidate, elements and configuration stay
// locked until the existing experiment/plans/tasks and provenance commit together.
export async function prepareCandidate(
  tx: TransactionSql,
  identity: Identity,
  origin: CandidateOrigin,
) {
  await researchActor(tx, identity, true);
  const [c] =
    await tx`SELECT id,version,status FROM studio_os.research_candidates WHERE id=${uuid(origin.candidateId)} FOR UPDATE`;
  if (!c) throw new NotFoundException();
  if (c.version !== version(origin.expectedVersion) || c.status !== 'pending')
    throw new ConflictException('候选已变化，请重新预览');
  await tx`SELECT e.id FROM studio_os.material_elements e JOIN studio_os.candidate_references r ON r.element_id=e.id WHERE r.candidate_id=${c.id} ORDER BY e.id FOR SHARE OF e`;
  await tx`SELECT d.id FROM studio_os.reference_dimensions d JOIN studio_os.material_elements e ON e.dimension_id=d.id JOIN studio_os.candidate_references r ON r.element_id=e.id WHERE r.candidate_id=${c.id} ORDER BY d.id FOR SHARE OF d`;
  await tx`SELECT m.id FROM studio_os.candidate_references r LEFT JOIN studio_os.material_elements e ON e.id=r.element_id JOIN studio_os.materials m ON m.id=coalesce(r.material_id,e.material_id) WHERE r.candidate_id=${c.id} ORDER BY m.id FOR SHARE OF m`;
  await tx`SELECT n.id FROM studio_os.note_templates n JOIN studio_os.candidate_references r ON r.template_id=n.id WHERE r.candidate_id=${c.id} ORDER BY n.id FOR SHARE OF n`;
  return candidateSnapshot(tx, String(c.id));
}
export class Research {
  constructor(private readonly db: StudioDatabase) {}
  dimensions() {
    return this.db
      .client`SELECT id,name,description,ai_rule AS "aiRule",position,active,version FROM studio_os.reference_dimensions ORDER BY position,id`;
  }
  async dimension(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    const b = objectInput(value, [
      'name',
      'description',
      'aiRule',
      'position',
      'active',
      'expectedVersion',
      'requestKey',
    ]);
    const name = shortText(b.name, 60),
      description = text(b.description),
      aiRule = text(b.aiRule, 4000);
    if (
      !Number.isSafeInteger(b.position) ||
      Number(b.position) < 0 ||
      Number(b.position) > 10000 ||
      typeof b.active !== 'boolean'
    )
      throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      await researchActor(tx, identity, true);
      const key = id ? null : uuid(b.requestKey);
      if (key) {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'dimension:' + key}))`;
        const [old] =
          await tx`SELECT id,name,description,ai_rule,position,active,version FROM studio_os.reference_dimensions WHERE request_key=${key}`;
        if (old) {
          if (
            old.name !== name ||
            old.description !== description ||
            old.ai_rule !== aiRule ||
            old.position !== b.position ||
            old.active !== b.active
          )
            throw new ConflictException();
          return { id: old.id, version: old.version };
        }
      }
      const [r] = id
        ? await tx`UPDATE studio_os.reference_dimensions SET name=${name},description=${description},ai_rule=${aiRule},position=${Number(b.position)},active=${b.active === true},version=version+1 WHERE id=${uuid(id)} AND version=${version(b.expectedVersion)} RETURNING id,version`
        : await tx`INSERT INTO studio_os.reference_dimensions(request_key,name,description,ai_rule,position,active) VALUES(${key},${name},${description},${aiRule},${Number(b.position)},${b.active === true}) RETURNING id,version`;
      if (!r) throw new ConflictException();
      await tx`INSERT INTO studio_os.research_events(entity_id,actor_id,action) VALUES(${r.id},${identity.id},'dimension_saved')`;
      return r;
    });
  }
  elements(materialId: string) {
    return this.db
      .client`SELECT e.id,e.material_id AS "materialId",e.dimension_id AS "dimensionId",e.content,e.reason,e.evidence,e.asset_id AS "assetId",e.store_id AS "storeId",e.product_id AS "productId",e.theme,e.version,d.name AS dimension,d.active AS "dimensionActive" FROM studio_os.material_elements e JOIN studio_os.reference_dimensions d ON d.id=e.dimension_id WHERE e.material_id=${uuid(materialId)} ORDER BY e.created_at,e.id`;
  }
  async element(
    identity: Identity,
    materialId: string,
    value: unknown,
    id?: string,
  ) {
    uuid(materialId);
    const b = objectInput(value, [
      'dimensionId',
      'content',
      'reason',
      'evidence',
      'assetId',
      'storeId',
      'productId',
      'theme',
      'expectedVersion',
      'requestKey',
    ]);
    const dim = uuid(b.dimensionId),
      content = shortOrLong(b.content),
      reason = text(b.reason),
      evidence = text(b.evidence),
      theme = text(b.theme, 200);
    const asset = b.assetId ? uuid(b.assetId) : null,
      store = b.storeId ? uuid(b.storeId) : null,
      product = b.productId ? uuid(b.productId) : null;
    return this.db.client.begin(async (tx) => {
      const actor = await researchActor(tx, identity);
      const key = id ? null : uuid(b.requestKey);
      if (key) {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'element:' + key}))`;
        const [old] =
          await tx`SELECT id,version,material_id,dimension_id,content,reason,evidence,asset_id,store_id,product_id,theme FROM studio_os.material_elements WHERE request_key=${key}`;
        if (old) {
          if (
            old.material_id !== materialId ||
            old.dimension_id !== dim ||
            old.content !== content ||
            old.reason !== reason ||
            old.evidence !== evidence ||
            old.asset_id !== asset ||
            old.store_id !== store ||
            old.product_id !== product ||
            old.theme !== theme
          )
            throw new ConflictException();
          return { id: old.id, version: old.version };
        }
      }
      const [d] =
        await tx`SELECT active FROM studio_os.reference_dimensions WHERE id=${dim} FOR SHARE`;
      const [old] = id
        ? await tx`SELECT dimension_id,product_id FROM studio_os.material_elements WHERE id=${uuid(id)} AND material_id=${materialId} FOR UPDATE`
        : [];
      if (!d || (!d.active && old?.dimension_id !== dim))
        throw new ConflictException('此维度已停用');
      if (
        !(
          await tx`SELECT id FROM studio_os.materials WHERE id=${materialId} FOR SHARE`
        ).length
      )
        throw new NotFoundException();
      if (
        asset &&
        !(
          await tx`SELECT id FROM studio_os.material_assets WHERE id=${asset} AND material_id=${materialId} FOR SHARE`
        ).length
      )
        throw new NotFoundException();
      if (
        store &&
        !(await tx`SELECT id FROM studio_os.stores WHERE id=${store} FOR SHARE`)
          .length
      )
        throw new NotFoundException();
      // Preserve shared metadata without granting a product directory. A newly
      // linked product for staff must be needed by their current assigned task.
      if (
        product &&
        actor.role !== 'admin' &&
        old?.product_id !== product &&
        !(
          await tx`SELECT t.id FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id LEFT JOIN studio_os.lab_experiments e ON e.id=p.experiment_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE coalesce(p.product_id,e.product_id)=${product} AND m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id LIMIT 1`
        ).length
      )
        throw new NotFoundException();
      if (
        product &&
        !(
          await tx`SELECT id FROM studio_os.products WHERE id=${product} FOR SHARE`
        ).length
      )
        throw new NotFoundException();
      const [r] = id
        ? await tx`UPDATE studio_os.material_elements SET dimension_id=${dim},content=${content},reason=${reason},evidence=${evidence},asset_id=${asset},store_id=${store},product_id=${product},theme=${theme},version=version+1 WHERE id=${id} AND material_id=${materialId} AND version=${version(b.expectedVersion)} RETURNING id,version`
        : await tx`INSERT INTO studio_os.material_elements(request_key,material_id,dimension_id,content,reason,evidence,asset_id,store_id,product_id,theme,created_by) VALUES(${key},${materialId},${dim},${content},${reason},${evidence},${asset},${store},${product},${theme},${identity.id}) RETURNING id,version`;
      if (!r) throw new ConflictException();
      await tx`INSERT INTO studio_os.research_events(entity_id,actor_id,action) VALUES(${r.id},${identity.id},'element_saved')`;
      return r;
    });
  }
  async catalog(
    identity: Identity,
    kind: 'inspirations' | 'candidates',
    value: unknown,
  ) {
    requireContributor(identity);
    const q = objectInput(
      value ?? {},
      kind === 'candidates' ? ['page', 'q', 'status'] : ['page', 'q'],
    );
    if (
      (q.page !== undefined &&
        (typeof q.page !== 'string' || !/^[1-9]\d{0,5}$/.test(q.page))) ||
      (q.q !== undefined &&
        (typeof q.q !== 'string' ||
          q.q.length > 200 ||
          /[\u0000-\u001f\u007f]/.test(q.q))) ||
      (q.status !== undefined &&
        !['all', 'pending', 'scheduled', 'deferred', 'archived'].includes(
          String(q.status),
        ))
    )
      throw new BadRequestException();
    const needle = String(q.q || '')
        .trim()
        .toLowerCase(),
      requestedPage = Number(q.page || '1'),
      status = String(q.status || 'all'),
      sql = this.db.client;
    // Like Titles.catalog: count/page clamping/items share one SQL snapshot.
    // Owner and full-directory filters run before counting or paging.
    const matched =
      kind === 'inspirations'
        ? sql`SELECT id,title,content,source_url AS "sourceUrl",version,created_at FROM studio_os.personal_inspirations WHERE owner_id=${identity.id} AND (${needle}='' OR strpos(lower(concat_ws(' ',title,content,source_url)),${needle})>0)`
        : sql`SELECT id,title,hypothesis,scope,evidence_level AS "evidenceLevel",priority,status,version,created_at FROM studio_os.research_candidates WHERE (${status}='all' OR status=${status}) AND (${needle}='' OR strpos(lower(concat_ws(' ',title,hypothesis,scope,evidence_level,priority)),${needle})>0)`;
    const [result] =
      await sql`WITH matched AS (${matched}), bounds AS (SELECT count(*)::int AS total,greatest(1,least(${requestedPage},ceil(count(*)/20.0)::int)) AS page FROM matched), paged AS (SELECT * FROM matched ORDER BY created_at DESC,id LIMIT 20 OFFSET ((SELECT page FROM bounds)-1)*20) SELECT total,page,coalesce((SELECT jsonb_agg(to_jsonb(paged)-'created_at' ORDER BY created_at DESC,id) FROM paged),'[]'::jsonb) AS items FROM bounds`;
    return {
      ...result,
      pageSize: 20,
      pageCount: Math.max(1, Math.ceil(result.total / 20)),
    };
  }
  // Legacy bounded array contract; the current UI uses catalog for complete access.
  inspirations(identity: Identity) {
    return this.db
      .client`SELECT id,title,content,source_url AS "sourceUrl",version FROM studio_os.personal_inspirations WHERE owner_id=${identity.id} ORDER BY created_at DESC,id LIMIT 200`;
  }
  async inspiration(identity: Identity, value: unknown, id?: string) {
    const b = objectInput(value, [
        'title',
        'content',
        'sourceUrl',
        'requestKey',
        'expectedVersion',
      ]),
      title = shortText(b.title, 200),
      content = text(b.content, 4000),
      url = httpsUrl(b.sourceUrl);
    return this.db.client.begin(async (tx) => {
      await researchActor(tx, identity);
      if (!id) {
        const key = uuid(b.requestKey);
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'inspiration:' + identity.id + key}))`;
        const [old] =
          await tx`SELECT id,title,content,source_url FROM studio_os.personal_inspirations WHERE owner_id=${identity.id} AND request_key=${key}`;
        if (old) {
          if (
            old.title !== title ||
            old.content !== content ||
            old.source_url !== url
          )
            throw new ConflictException();
          return { id: old.id };
        }
        const [r] =
          await tx`INSERT INTO studio_os.personal_inspirations(owner_id,request_key,title,content,source_url) VALUES(${identity.id},${key},${title},${content},${url}) RETURNING id,version`;
        return r;
      }
      if (
        !(
          await tx`SELECT id FROM studio_os.personal_inspirations WHERE id=${uuid(id)} AND owner_id=${identity.id} FOR UPDATE`
        ).length
      )
        throw new NotFoundException();
      const [r] =
        await tx`UPDATE studio_os.personal_inspirations SET title=${title},content=${content},source_url=${url},version=version+1 WHERE id=${id} AND owner_id=${identity.id} AND version=${version(b.expectedVersion)} RETURNING id,version`;
      if (!r) throw new ConflictException();
      return r;
    });
  }
  // Legacy array compatibility, not the current directory/pagination API.
  async candidates() {
    return this.db
      .client`SELECT id,title,hypothesis,scope,evidence_level AS "evidenceLevel",priority,status,version FROM studio_os.research_candidates ORDER BY created_at DESC,id LIMIT 200`;
  }
  detail(identity: Identity, id: string) {
    return this.db.client.begin('read only', async (tx) => {
      const snapshot = await candidateSnapshot(tx, uuid(id));
      const arrangements =
        await tx`SELECT p.id AS "planId",p.experiment_id AS "experimentId",p.title FROM studio_os.plan_candidate_sources s JOIN studio_os.plans p ON p.id=s.plan_id WHERE s.candidate_id=${id} AND (${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.tasks t JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.plan_id=p.id AND m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) ORDER BY p.created_at,p.id`;
      return { ...snapshot, arrangements };
    });
  }
  async candidate(identity: Identity, value: unknown) {
    const b = objectInput(value, [
      'title',
      'hypothesis',
      'scope',
      'evidenceLevel',
      'priority',
      'references',
      'requestKey',
    ]);
    const title = shortText(b.title, 200),
      hypothesis = text(b.hypothesis),
      scope = text(b.scope),
      level = text(b.evidenceLevel, 200),
      priority = text(b.priority, 100),
      key = uuid(b.requestKey);
    if (
      !Array.isArray(b.references) ||
      !b.references.length ||
      b.references.length > 30
    )
      throw new BadRequestException();
    const refs = b.references.map((v) => {
      const r = objectInput(v, [
        'materialId',
        'elementId',
        'templateId',
        'idea',
      ]);
      if (Object.values(r).filter(Boolean).length !== 1)
        throw new BadRequestException();
      return {
        materialId: r.materialId ? uuid(r.materialId) : null,
        elementId: r.elementId ? uuid(r.elementId) : null,
        templateId: r.templateId ? uuid(r.templateId) : null,
        idea: text(r.idea, 4000),
      };
    });
    return this.db.client.begin(async (tx) => {
      await researchActor(tx, identity);
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'candidate:' + key}))`;
      const [old] =
        await tx`SELECT id,created_by,title,hypothesis,scope,evidence_level,priority FROM studio_os.research_candidates WHERE request_key=${key}`;
      if (old) {
        const snap = await candidateSnapshot(tx, String(old.id));
        const previous = snap.references.map((r) => ({
          materialId: r.materialId,
          elementId: r.elementId,
          templateId: r.templateId,
          idea: r.idea,
        }));
        const sorted = (v: unknown[]) =>
          v
            .map((x) => JSON.stringify(x))
            .sort()
            .join('|');
        if (
          old.created_by !== identity.id ||
          old.title !== title ||
          old.hypothesis !== hypothesis ||
          old.scope !== scope ||
          old.evidence_level !== level ||
          old.priority !== priority ||
          sorted(previous) !== sorted(refs)
        )
          throw new ConflictException();
        return { id: old.id };
      }
      for (const r of refs) {
        if (
          r.materialId &&
          !(
            await tx`SELECT id FROM studio_os.materials WHERE id=${r.materialId} FOR SHARE`
          ).length
        )
          throw new NotFoundException();
        if (
          r.elementId &&
          !(
            await tx`SELECT e.id FROM studio_os.material_elements e JOIN studio_os.reference_dimensions d ON d.id=e.dimension_id WHERE e.id=${r.elementId} AND d.active FOR SHARE OF e,d`
          ).length
        )
          throw new ConflictException('参考维度已停用或元素不存在');
        if (
          r.templateId &&
          !(
            await tx`SELECT id FROM studio_os.note_templates WHERE id=${r.templateId} AND NOT archived FOR SHARE`
          ).length
        )
          throw new ConflictException();
      }
      const [row] =
        await tx`INSERT INTO studio_os.research_candidates(title,hypothesis,scope,evidence_level,priority,created_by,request_key) VALUES(${title},${hypothesis},${scope},${level},${priority},${identity.id},${key}) RETURNING id,version`;
      for (const r of refs)
        await tx`INSERT INTO studio_os.candidate_references(candidate_id,material_id,element_id,template_id,idea)VALUES(${row.id},${r.materialId},${r.elementId},${r.templateId},${r.idea})`;
      await tx`INSERT INTO studio_os.research_events(entity_id,actor_id,action)VALUES(${row.id},${identity.id},'candidate_submitted')`;
      return row;
    });
  }
  async status(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, ['status', 'expectedVersion']);
    if (!['pending', 'deferred', 'archived'].includes(String(b.status)))
      throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      await researchActor(tx, identity, true);
      const [r] =
        await tx`UPDATE studio_os.research_candidates SET status=${String(b.status)},version=version+1 WHERE id=${uuid(id)} AND version=${version(b.expectedVersion)} AND status<>'scheduled' RETURNING id,version`;
      if (!r) throw new ConflictException();
      await tx`INSERT INTO studio_os.research_events(entity_id,actor_id,action,detail) VALUES(${id},${identity.id},'candidate_status',${JSON.stringify({ status: b.status, version: r.version })}::jsonb)`;
      return r;
    });
  }
  async duplicates(value: unknown) {
    const b = objectInput(value, ['sourceUrl']),
      url = httpsUrl(b.sourceUrl),
      source = materialSource(url);
    if (!url) return { source, matches: [] };
    const rows = await this.db
      .client`SELECT id,title,source_url FROM studio_os.materials WHERE source_url=${url} OR (${source.noteId}::text IS NOT NULL AND lower(substring(source_url from '(?i)^https://(?:www\\.)?xiaohongshu\\.com/(?:explore|discovery/item)/([a-f0-9]{24})(?:[/?#]|$)'))=${source.noteId}) ORDER BY created_at,id LIMIT 30`;
    return {
      source,
      matches: rows.map((r) => ({
        id: r.id,
        title: r.title,
        sourceUrl: r.source_url,
      })),
    };
  }
}
function shortOrLong(v: unknown) {
  const r = text(v, 4000);
  if (!r) throw new BadRequestException();
  return r;
}
