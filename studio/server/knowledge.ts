import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
const optional = (v: unknown, max: number) =>
  v === undefined || v === null || v === '' ? '' : longText(v, max);
function articleBody(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  longText(value, 20000);
  return value as string;
}
export class Knowledge {
  constructor(private readonly db: StudioDatabase) {}
  async navigation(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const b = objectInput(value, ['title', 'category', 'summary', 'tags', 'sourceUrl', ...(id ? ['expectedVersion'] : [])]);
    const title = shortText(b.title, 200), category = optional(b.category, 100), summary = optional(b.summary, 2000);
    const sourceUrl = webLink(b.sourceUrl), url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn')))
      throw new BadRequestException('请填写 HTTPS 飞书文档链接');
    if (!Array.isArray(b.tags) || b.tags.length > 30) throw new BadRequestException();
    const tags = [...new Set(b.tags.map((tag) => shortText(tag, 40)))];
    if (!id) return this.save(identity, { title, category, summary, tags, sourceUrl, entryType: 'knowledge', kind: 'link' });
    const expected = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [before] = await tx`SELECT * FROM studio_os.knowledge_assets WHERE id=${id} AND entry_type='knowledge' FOR UPDATE`;
      if (!before) throw new NotFoundException();
      if (before.version !== expected) throw new ConflictException();
      if (before.kind === 'conclusion') throw new BadRequestException('请保留原结论引用，另建飞书文档导航');
      // Navigation updates preserve legacy bodies, source relations and cover assets.
      const [row] = await tx`UPDATE studio_os.knowledge_assets SET title=${title},category=${category},summary=${summary},tags=${JSON.stringify(tags)}::jsonb,source_url=${sourceUrl},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.knowledge_events(asset_id,actor_id,action,before_value,after_value) VALUES(${id},${identity.id},'updated',${JSON.stringify(before)}::jsonb,${JSON.stringify({title,category,summary,tags,sourceUrl})}::jsonb)`;
      return row;
    });
  }
  list(identity: Identity) {
    requireContributor(identity);
    return this.db
      .client`SELECT k.id,k.title,k.entry_type AS "entryType",k.kind,k.category,k.summary,k.body,k.source_url AS "sourceUrl",k.experiment_id AS "experimentId",k.product_review_id AS "productReviewId",k.tags,k.version,k.created_at AS "createdAt",k.updated_at AS "updatedAt",EXISTS(SELECT 1 FROM studio_os.knowledge_covers c WHERE c.asset_id=k.id) AS "hasCover",coalesce(e.finding,r.reason) AS "sourceFinding",e.recommendation AS "sourceRecommendation",coalesce(e.title,p.name) AS "sourceTitle",CASE WHEN e.id IS NOT NULL THEN 'experiment' WHEN r.id IS NOT NULL THEN 'product' ELSE NULL END AS "sourceKind",coalesce(e.id,p.id) AS "sourceParentId" FROM studio_os.knowledge_assets k LEFT JOIN studio_os.lab_experiments e ON e.id=k.experiment_id LEFT JOIN studio_os.product_reviews r ON r.id=k.product_review_id LEFT JOIN studio_os.products p ON p.id=r.product_id ORDER BY k.updated_at DESC,k.id`;
  }
  sources(identity: Identity) {
    requireAdministrator(identity);
    return this.db
      .client`SELECT 'experiment' AS kind,e.id,e.id AS "parentId",e.title,e.finding AS summary,e.recommendation,e.ended_at AS "createdAt" FROM studio_os.lab_experiments e WHERE e.status='concluded' AND length(coalesce(e.finding,''))>0 UNION ALL SELECT 'product' AS kind,r.id,p.id AS "parentId",p.name AS title,r.reason AS summary,'' AS recommendation,r.created_at AS "createdAt" FROM studio_os.product_reviews r JOIN studio_os.products p ON p.id=r.product_id ORDER BY "createdAt" DESC,id`;
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const keys = [
      'title',
      'entryType',
      'kind',
      'category',
      'summary',
      'body',
      'sourceUrl',
      'experimentId',
      'productReviewId',
      'tags',
    ];
    const b = objectInput(value, id ? [...keys, 'expectedVersion'] : keys);
    const title = shortText(b.title, 200),
      entryType = shortText(b.entryType ?? 'knowledge', 20),
      kind = shortText(b.kind, 20),
      category = optional(b.category, 100),
      summary = optional(b.summary, 2000),
      body = articleBody(b.body),
      url =
        b.sourceUrl === undefined || b.sourceUrl === null || b.sourceUrl === ''
          ? null
          : webLink(b.sourceUrl),
      experiment =
        b.experimentId === undefined ||
        b.experimentId === null ||
        b.experimentId === ''
          ? null
          : uuid(b.experimentId),
      review =
        b.productReviewId === undefined ||
        b.productReviewId === null ||
        b.productReviewId === ''
          ? null
          : uuid(b.productReviewId);
    if (
      !['knowledge', 'learning'].includes(entryType) ||
      !['article', 'link', 'conclusion'].includes(kind)
    )
      throw new BadRequestException();
    const tags = b.tags === undefined ? [] : b.tags;
    if (!Array.isArray(tags) || tags.length > 30)
      throw new BadRequestException();
    const normalizedTags = [...new Set(tags.map((tag) => shortText(tag, 40)))];
    if (
      (kind === 'article' && (!body || experiment || review)) ||
      (kind === 'link' && (!url || body || experiment || review)) ||
      (kind === 'conclusion' &&
        (body || url || Number(!!experiment) + Number(!!review) !== 1))
    )
      throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      if (
        experiment &&
        !(
          await tx`SELECT id FROM studio_os.lab_experiments WHERE id=${experiment} AND status='concluded' AND length(coalesce(finding,''))>0 FOR SHARE`
        ).length
      )
        throw new BadRequestException();
      if (
        review &&
        !(
          await tx`SELECT id FROM studio_os.product_reviews WHERE id=${review} FOR SHARE`
        ).length
      )
        throw new BadRequestException();
      let before, row;
      if (id) {
        [before] =
          await tx`SELECT id,title,entry_type,kind,category,summary,body,source_url,experiment_id,product_review_id,tags,version FROM studio_os.knowledge_assets WHERE id=${id} FOR UPDATE`;
        if (!before) throw new NotFoundException();
        if (before.version !== version(b.expectedVersion))
          throw new ConflictException();
        [row] =
          await tx`UPDATE studio_os.knowledge_assets SET title=${title},entry_type=${entryType},kind=${kind},category=${category},summary=${summary},body=${body},source_url=${url},experiment_id=${experiment},product_review_id=${review},tags=${JSON.stringify(normalizedTags)}::jsonb,version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      } else
        [row] =
          await tx`INSERT INTO studio_os.knowledge_assets(title,entry_type,kind,category,summary,body,source_url,experiment_id,product_review_id,tags) VALUES(${title},${entryType},${kind},${category},${summary},${body},${url},${experiment},${review},${JSON.stringify(normalizedTags)}::jsonb) RETURNING id,version`;
      await tx`INSERT INTO studio_os.knowledge_events(asset_id,actor_id,action,before_value,after_value) VALUES(${row.id},${identity.id},${id ? 'updated' : 'created'},${before ? JSON.stringify(before) : null}::jsonb,${JSON.stringify({ title, entryType, kind, category, summary, body, sourceUrl: url, experimentId: experiment, productReviewId: review, tags: normalizedTags })}::jsonb)`;
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
        await tx`SELECT id,title,entry_type,kind,category,summary,body,source_url,experiment_id,product_review_id,tags,version FROM studio_os.knowledge_assets WHERE id=${id} FOR UPDATE`;
      if (!before) throw new NotFoundException();
      if (before.version !== v) throw new ConflictException();
      await tx`DELETE FROM studio_os.knowledge_assets WHERE id=${id}`;
      await tx`INSERT INTO studio_os.knowledge_events(asset_id,actor_id,action,before_value) VALUES(${id},${identity.id},'deleted',${JSON.stringify(before)}::jsonb)`;
      return { ok: true };
    });
  }
  async cover(identity: Identity, id: string) {
    requireContributor(identity);
    uuid(id);
    const [file] = await this.db.client<
      { name: string; mime: string; content: Buffer }[]
    >`SELECT name,mime,content FROM studio_os.knowledge_covers WHERE asset_id=${id}`;
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
      const [row] =
        await tx`SELECT version FROM studio_os.knowledge_assets WHERE id=${id} FOR UPDATE`;
      if (!row) throw new NotFoundException();
      if (row.version !== v) throw new ConflictException();
      await tx`INSERT INTO studio_os.knowledge_covers(asset_id,name,mime,content) VALUES(${id},${file.name},${file.mime},${file.content}) ON CONFLICT(asset_id) DO UPDATE SET name=excluded.name,mime=excluded.mime,content=excluded.content`;
      const [result] =
        await tx`UPDATE studio_os.knowledge_assets SET version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.knowledge_events(asset_id,actor_id,action,after_value) VALUES(${id},${identity.id},'cover_updated',${JSON.stringify({ name: file.name, mime: file.mime, size: file.content.length })}::jsonb)`;
      return result;
    });
  }
  async clearCover(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [row] =
        await tx`SELECT version FROM studio_os.knowledge_assets WHERE id=${id} FOR UPDATE`;
      if (!row) throw new NotFoundException();
      if (row.version !== v) throw new ConflictException();
      if (
        !(
          await tx`DELETE FROM studio_os.knowledge_covers WHERE asset_id=${id} RETURNING asset_id`
        ).length
      )
        throw new NotFoundException();
      const [result] =
        await tx`UPDATE studio_os.knowledge_assets SET version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      await tx`INSERT INTO studio_os.knowledge_events(asset_id,actor_id,action) VALUES(${id},${identity.id},'cover_deleted')`;
      return result;
    });
  }
}
