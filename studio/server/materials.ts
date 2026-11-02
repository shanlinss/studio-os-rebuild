// Card/metadata contract adapted from historical InboxPanel/MaterialForm.
// Private byte storage is intentionally independent of the old platform bucket.
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { mediaFile } from './media';
import { materialSource } from './material-source';
import {
  objectInput,
  shortText,
  httpsUrl,
  longText,
  uuid,
  version,
} from './validation';
function requireContributor(identity: Identity) {
  if (!identity) throw new UnauthorizedException();
  if (!['admin', 'employee'].includes(identity.role))
    throw new ForbiddenException();
}
const optional = (v: unknown, n = 200) =>
  v === undefined || v === '' ? '' : longText(v, n);
const choices = (v: unknown, list: string[], fallback: string) => {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !list.includes(v))
    throw new BadRequestException();
  return v;
};
function metadata(v: unknown) {
  const b = objectInput(v ?? {}, [
    'mediaType',
    'product',
    'category',
    'scene',
    'source',
    'tags',
    'rating',
    'status',
    'notes',
    'referenceTitles',
    'expectedTestCount',
  ]);
  const tags = b.tags === undefined ? [] : b.tags;
  if (!Array.isArray(tags) || tags.length > 30) throw new BadRequestException();
  const rating = b.rating ?? 3,
    count = b.expectedTestCount ?? 3;
  if (
    !Number.isInteger(rating) ||
    Number(rating) < 1 ||
    Number(rating) > 5 ||
    !Number.isInteger(count) ||
    Number(count) < 1 ||
    Number(count) > 20
  )
    throw new BadRequestException();
  return {
    mediaType: choices(b.mediaType, ['图文', '视频'], '图文'),
    product: optional(b.product),
    category: choices(
      b.category,
      ['', '标题', '图片', '场景', '文案', '内页'],
      '',
    ),
    scene: optional(b.scene),
    source: choices(
      b.source,
      ['素人笔记', '竞品对标', '跨类目', '其他'],
      '素人笔记',
    ),
    tags: [...new Set(tags.map((t) => shortText(t, 40)))],
    rating,
    expectedTestCount: count,
    status: choices(
      b.status,
      ['未测试', '测试中', '有效', '待复用', '淘汰'],
      '未测试',
    ),
    notes: optional(b.notes, 4000),
    referenceTitles: optional(b.referenceTitles, 4000),
  };
}
export class Materials {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity) {
    requireContributor(identity);
    const items = await this.db
      .client`SELECT m.id,m.title,m.source_url AS "sourceUrl",m.metadata,m.version,m.created_at AS "createdAt",
      coalesce(creator.display_name,CASE WHEN a.id IS NULL THEN '历史成员' WHEN a.role='admin' THEN '管理员' ELSE '团队成员' END) AS "creatorName",
      coalesce((SELECT jsonb_agg(s.store_id ORDER BY s.store_id) FROM studio_os.material_stores s WHERE s.material_id=m.id),'[]') AS "storeIds",
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'kind',f.kind,'size',octet_length(f.content),
        'download',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('name',coalesce(downloader.display_name,CASE WHEN da.id IS NULL THEN '历史成员' WHEN da.role='admin' THEN '管理员' ELSE '团队成员' END),'at',d.confirmed_at) END) ORDER BY f.created_at,f.id)
        FROM studio_os.material_assets f LEFT JOIN studio_os.material_asset_downloads d ON d.asset_id=f.id AND d.first_for_asset
        LEFT JOIN studio_os.accounts da ON da.id=d.requested_by LEFT JOIN studio_os.members downloader ON downloader.login_account_id=da.id WHERE f.material_id=m.id),'[]') AS assets
      FROM studio_os.materials m LEFT JOIN studio_os.accounts a ON a.id=m.created_by LEFT JOIN studio_os.members creator ON creator.login_account_id=a.id ORDER BY m.created_at DESC,m.id`;
    const identified = items.map((m) => ({
      ...m,
      id: String(m.id),
      sourceIdentity: materialSource(String(m.sourceUrl || '')),
    }));
    if (identity.role !== 'admin') return identified;
    const counts = await this.db
      .client`SELECT r.material_id AS id,count(DISTINCT p.id) FILTER(WHERE e.id IS NOT NULL)::int AS rounds,count(DISTINCT e.id)::int AS experiments,count(DISTINCT e.id) FILTER(WHERE e.status='testing')::int AS testing,count(DISTINCT e.id) FILTER(WHERE e.status='concluded')::int AS concluded,
      count(DISTINCT n.id)::int AS published,
      count(DISTINCT n.id) FILTER(WHERE EXISTS(SELECT 1 FROM studio_os.data_snapshots s WHERE s.publication_id=n.id))::int AS filled
      FROM studio_os.plan_materials r JOIN studio_os.plans p ON p.id=r.plan_id
      JOIN studio_os.lab_experiments e ON e.id=p.experiment_id
      LEFT JOIN studio_os.tasks t ON t.plan_id=p.id LEFT JOIN studio_os.publications n ON n.task_id=t.id GROUP BY r.material_id`;
    const progress = new Map(
      counts.map((c) => [
        c.id,
        {
          experiments: c.experiments,
          rounds: c.rounds,
          testing: c.testing,
          concluded: c.concluded,
          published: c.published,
          filled: c.filled,
        },
      ]),
    );
    return identified.map((m) => ({
      ...m,
      progress: progress.get(m.id) || {
        experiments: 0,
        rounds: 0,
        testing: 0,
        concluded: 0,
        published: 0,
        filled: 0,
      },
    }));
  }
  async detail(identity: Identity, id: string) {
    uuid(id);
    const item = (await this.list(identity)).find((m) => m.id === id);
    if (!item) throw new NotFoundException();
    const plans =
      identity.role === 'admin'
        ? await this.db
            .client`SELECT p.id,p.title,p.source_type AS "sourceType",p.product_id AS "productId",coalesce(nullif(e.finding,''),p.conclusion) AS conclusion,p.experiment_id AS "experimentId",p.round_no AS "roundNo",e.status AS "experimentStatus",
            (SELECT coalesce(sum(t.target_count),0)::int FROM studio_os.tasks t WHERE t.plan_id=p.id) AS "targetCount",
            (SELECT count(*)::int FROM studio_os.publications n JOIN studio_os.tasks t ON t.id=n.task_id WHERE t.plan_id=p.id) AS "publishedCount",
            (SELECT count(DISTINCT n.id)::int FROM studio_os.publications n JOIN studio_os.tasks t ON t.id=n.task_id JOIN studio_os.data_snapshots s ON s.publication_id=n.id WHERE t.plan_id=p.id) AS "filledCount"
            FROM studio_os.plans p JOIN studio_os.plan_materials r ON r.plan_id=p.id LEFT JOIN studio_os.lab_experiments e ON e.id=p.experiment_id WHERE r.material_id=${id} ORDER BY p.created_at DESC,p.id`
        : [];
    return { ...item, plans };
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireContributor(identity);
    if (id) uuid(id);
    const b = objectInput(value, [
      'title',
      'sourceUrl',
      'metadata',
      'storeIds',
      ...(id ? ['expectedVersion'] : []),
    ]);
    const title = shortText(b.title, 200),
      link = httpsUrl(b.sourceUrl) ?? '',
      meta = metadata(b.metadata);
    const ids = b.storeIds ?? [];
    if (!Array.isArray(ids) || ids.length > 50) throw new BadRequestException();
    const storeIds = [...new Set(ids.map(uuid))];
    const expected = id ? version(b.expectedVersion) : undefined;
    return this.db.client.begin(async (tx) => {
      if (id) {
        const [before] =
          await tx`SELECT version FROM studio_os.materials WHERE id=${id} FOR UPDATE`;
        if (!before) throw new NotFoundException();
        if (before.version !== expected) throw new ConflictException();
      }
      for (const s of storeIds)
        if (
          !(
            await tx`SELECT id FROM studio_os.stores WHERE id=${s} AND (active OR (${id ?? null}::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.material_stores r WHERE r.material_id=${id ?? null}::uuid AND r.store_id=${s}))) FOR SHARE`
          ).length
        )
          throw new BadRequestException();
      let saved;
      if (id)
        [saved] =
          await tx`UPDATE studio_os.materials SET title=${title},source_url=${link},metadata=${JSON.stringify(meta)}::jsonb,version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
      else
        [saved] =
          await tx`INSERT INTO studio_os.materials(title,source_url,metadata,created_by) VALUES(${title},${link},${JSON.stringify(meta)}::jsonb,${identity.id}) RETURNING id,version`;
      await tx`DELETE FROM studio_os.material_stores WHERE material_id=${saved.id}`;
      for (const s of storeIds)
        await tx`INSERT INTO studio_os.material_stores(material_id,store_id) VALUES(${saved.id},${s})`;
      await tx`INSERT INTO studio_os.material_events(material_id,actor_id,action) VALUES(${saved.id},${identity.id},${id ? 'updated' : 'created'})`;
      return { id: saved.id, version: saved.version, title, sourceUrl: link };
    });
  }
  async replaceStores(identity: Identity, id: string, value: unknown) {
    requireContributor(identity);
    id = uuid(id);
    const b = objectInput(value, ['expectedVersion', 'storeIds']),
      expected = version(b.expectedVersion);
    if (!Array.isArray(b.storeIds) || b.storeIds.length > 50)
      throw new BadRequestException();
    const desired = [...new Set(b.storeIds.map(uuid))].sort();
    return this.db.client.begin(async (tx) => {
      const [actor] =
        await tx`SELECT role FROM studio_os.accounts WHERE id=${identity.id} AND active FOR SHARE`;
      if (!actor) throw new UnauthorizedException();
      if (!['admin', 'employee'].includes(actor.role))
        throw new ForbiddenException();
      const [material] =
        await tx`SELECT version FROM studio_os.materials WHERE id=${id} FOR UPDATE`;
      if (!material) throw new NotFoundException();
      if (expected > material.version) throw new ConflictException();
      const before = (
        await tx`SELECT store_id FROM studio_os.material_stores WHERE material_id=${id} ORDER BY store_id`
      ).map((r) => String(r.store_id));
      // A lost-success retry may confirm the desired state without another event.
      if (JSON.stringify(before) === JSON.stringify(desired))
        return { id, version: material.version, storeIds: before };
      if (expected !== material.version) throw new ConflictException();
      for (const store of desired) {
        const [valid] =
          await tx`SELECT id FROM studio_os.stores WHERE id=${store} AND(active OR id=ANY(${tx.array(before, 2950)})) FOR SHARE`;
        if (!valid) throw new BadRequestException();
      }
      await tx`DELETE FROM studio_os.material_stores WHERE material_id=${id}`;
      for (const store of desired)
        await tx`INSERT INTO studio_os.material_stores(material_id,store_id) VALUES(${id},${store})`;
      const [saved] =
        await tx`UPDATE studio_os.materials SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
      await tx`INSERT INTO studio_os.material_events(material_id,actor_id,action) VALUES(${id},${identity.id},'updated')`;
      return { id, version: saved.version, storeIds: desired };
    });
  }
  async remove(identity: Identity, id: string, expected: unknown) {
    requireAdministrator(identity);
    uuid(id);
    version(expected);
    return this.db.client.begin(async (tx) => {
      const [m] =
        await tx`SELECT version FROM studio_os.materials WHERE id=${id} FOR UPDATE`;
      if (!m) throw new NotFoundException();
      if (
        m.version !== expected ||
        (
          await tx`SELECT id FROM studio_os.material_elements WHERE material_id=${id} LIMIT 1`
        ).length > 0 ||
        (
          await tx`SELECT id FROM studio_os.candidate_references WHERE material_id=${id} LIMIT 1`
        ).length > 0 ||
        (
          await tx`SELECT id FROM studio_os.shooting_items WHERE material_id=${id} LIMIT 1`
        ).length > 0 ||
        (
          await tx`SELECT id FROM studio_os.note_templates WHERE source_material_id=${id} LIMIT 1`
        ).length > 0 ||
        (
          await tx`SELECT id FROM studio_os.tasks WHERE template_material_id=${id} LIMIT 1`
        ).length > 0 ||
        (
          await tx`SELECT plan_id FROM studio_os.plan_materials WHERE material_id=${id}`
        ).length
      )
        throw new ConflictException();
      await tx`DELETE FROM studio_os.materials WHERE id=${id}`;
      await tx`INSERT INTO studio_os.material_events(material_id,actor_id,action) VALUES(${id},${identity.id},'deleted')`;
      return { ok: true };
    });
  }
  async upload(
    identity: Identity,
    id: string,
    bytes: unknown,
    name: unknown,
    kind: unknown,
    mime: unknown,
  ) {
    requireContributor(identity);
    uuid(id);
    const file = mediaFile(bytes, name, mime);
    const k = choices(kind, ['screenshot', 'reference'], 'screenshot');
    if (k === 'reference' && file.mime === 'video/mp4')
      throw new BadRequestException();
    const filename = file.name,
      actual = file.mime,
      content = file.content;
    return this.db.client.begin(async (tx) => {
      if (
        !(
          await tx`SELECT id FROM studio_os.materials WHERE id=${id} FOR UPDATE`
        ).length
      )
        throw new NotFoundException();
      const [usage] =
        await tx`SELECT count(*)::int AS n,coalesce(sum(octet_length(content)),0)::int AS size FROM studio_os.material_assets WHERE material_id=${id}`;
      if (usage.n >= 20 || usage.size + content.length > 67108864)
        throw new ConflictException();
      const [asset] =
        await tx`INSERT INTO studio_os.material_assets(material_id,name,mime,kind,content,created_by) VALUES(${id},${filename},${actual},${k},${content},${identity.id}) RETURNING id,name,mime,kind`;
      await tx`UPDATE studio_os.materials SET version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.material_events(material_id,actor_id,action) VALUES(${id},${identity.id},'uploaded')`;
      return asset;
    });
  }
  async asset(identity: Identity, id: string, assetId: string) {
    requireContributor(identity);
    uuid(id);
    uuid(assetId);
    const [asset] = await this.db
      .client`SELECT name,mime,content FROM studio_os.material_assets WHERE id=${assetId} AND material_id=${id}`;
    if (!asset) throw new NotFoundException();
    return asset;
  }
  async download(identity: Identity, id: string, assetId: string) {
    requireContributor(identity);
    uuid(id);
    uuid(assetId);
    return this.db.client.begin(async (tx) => {
      const [file] = await tx<
        { id: string; name: string; mime: string; content: Buffer }[]
      >`SELECT id,name,mime,content FROM studio_os.material_assets WHERE id=${assetId} AND material_id=${id} FOR UPDATE`;
      if (!file) throw new NotFoundException();
      await tx`DELETE FROM studio_os.material_asset_downloads WHERE requested_by=${identity.id} AND confirmed_at IS NULL AND expires_at<=clock_timestamp()`;
      const [receipt] =
        await tx`INSERT INTO studio_os.material_asset_downloads(asset_id,requested_by) VALUES(${assetId},${identity.id}) RETURNING id`;
      return { ...file, receipt: receipt.id };
    });
  }
  async confirmDownload(
    identity: Identity,
    id: string,
    assetId: string,
    receipt: string,
  ) {
    requireContributor(identity);
    uuid(id);
    uuid(assetId);
    uuid(receipt);
    return this.db.client.begin(async (tx) => {
      // Serialize confirmations on the actual asset; the first owner is stable
      // even when two people complete their downloads at the same time.
      const [file] =
        await tx`SELECT id FROM studio_os.material_assets WHERE id=${assetId} AND material_id=${id} FOR UPDATE`;
      if (!file) throw new NotFoundException();
      const [ticket] =
        await tx`SELECT id,confirmed_at,expires_at>clock_timestamp() AS valid FROM studio_os.material_asset_downloads WHERE id=${receipt} AND asset_id=${assetId} AND requested_by=${identity.id}`;
      if (!ticket) throw new NotFoundException();
      if (!ticket.confirmed_at) {
        if (!ticket.valid) throw new ConflictException();
        await tx`UPDATE studio_os.material_asset_downloads SET confirmed_at=clock_timestamp(),first_for_asset=NOT EXISTS(SELECT 1 FROM studio_os.material_asset_downloads WHERE asset_id=${assetId} AND first_for_asset) WHERE id=${receipt}`;
      }
      return { ok: true };
    });
  }
  async taskAsset(
    identity: Identity,
    task: string,
    material: string,
    asset: string,
  ) {
    uuid(task);
    uuid(material);
    uuid(asset);
    const [file] = await this.db
      .client`SELECT f.name,f.mime,f.content FROM studio_os.material_assets f WHERE f.id=${asset} AND f.material_id=${material} AND EXISTS(
      SELECT 1 FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id JOIN studio_os.plan_materials r ON r.plan_id=t.plan_id JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id
      WHERE t.id=${task} AND r.material_id=f.material_id AND((t.template_id IS NOT NULL AND t.template_material_id=f.material_id) OR(t.template_id IS NULL AND(p.source_type<>'product' OR EXISTS(SELECT 1 FROM studio_os.task_materials tm WHERE tm.task_id=t.id AND tm.material_id=f.material_id)))) AND (${identity.role === 'admin'} OR (m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)))`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async removeAsset(identity: Identity, id: string, assetId: string) {
    requireContributor(identity);
    uuid(id);
    uuid(assetId);
    return this.db.client.begin(async (tx) => {
      if (
        !(
          await tx`SELECT id FROM studio_os.materials WHERE id=${id} FOR UPDATE`
        ).length
      )
        throw new NotFoundException();
      if (
        (
          await tx`SELECT id FROM studio_os.material_elements WHERE asset_id=${assetId} LIMIT 1`
        ).length
      )
        throw new ConflictException('证据图片仍被参考元素引用，请先核对来源');
      if (
        (
          await tx`SELECT plan_id FROM studio_os.plan_candidate_sources WHERE source_snapshot @> ${JSON.stringify({ references: [{ assetId }] })}::jsonb LIMIT 1`
        ).length
      )
        throw new ConflictException('证据图片已进入实验来源，请保留历史');
      if (
        !(
          await tx`DELETE FROM studio_os.material_assets WHERE id=${assetId} AND material_id=${id} RETURNING id`
        ).length
      )
        throw new NotFoundException();
      await tx`UPDATE studio_os.materials SET version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.material_events(material_id,actor_id,action) VALUES(${id},${identity.id},'asset_deleted')`;
      return { ok: true };
    });
  }
}
