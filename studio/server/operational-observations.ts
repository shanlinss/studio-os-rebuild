import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Identity } from './auth';
import type { StudioDatabase } from './database';
import { requireContributor, requireAdministrator } from './access';
import {
  objectInput,
  optionalLongText,
  shortText,
  uuid,
  version,
} from './validation';
import { mediaFile } from './media';
import { timestamp } from './workflow';

function pageQuery(
  value: unknown,
  keys: string[] = ['page', 'q', 'author', 'from', 'to'],
) {
  const q = objectInput(value ?? {}, keys);
  if (
    q.page !== undefined &&
    (typeof q.page !== 'string' || !/^[1-9]\d{0,5}$/.test(q.page))
  )
    throw new BadRequestException();
  if (
    q.q !== undefined &&
    (typeof q.q !== 'string' ||
      q.q.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(q.q))
  )
    throw new BadRequestException();
  const date = (v: unknown) => {
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v))
      throw new BadRequestException();
    timestamp(v + 'T00:00:00+08:00');
    return v;
  };
  const from = date(q.from),
    to = date(q.to);
  if (from && to && from > to) throw new BadRequestException();
  return {
    page: Number(q.page || 1),
    q: String(q.q || '')
      .trim()
      .toLowerCase(),
    author: q.author ? uuid(q.author) : null,
    from,
    to,
  };
}
function images(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6)
    throw new PayloadTooLargeException('每条观察最多6张截图');
  let bytes = 0;
  return value.map((v) => {
    const f = objectInput(v, ['name', 'mime', 'data']);
    if (
      typeof f.data !== 'string' ||
      f.data.length > 11184812 ||
      !f.data.length ||
      f.data.length % 4 !== 0
    )
      throw new BadRequestException('截图内容无效');
    const content = Buffer.from(f.data, 'base64');
    if (content.toString('base64') !== f.data) throw new BadRequestException();
    const file = mediaFile(
      content,
      encodeURIComponent(shortText(f.name, 200)),
      f.mime,
    );
    if (!file.mime.startsWith('image/'))
      throw new BadRequestException('仅支持PNG、JPEG、WebP或GIF截图');
    bytes += content.length;
    if (bytes > 16777216)
      throw new PayloadTooLargeException('每条观察截图合计最多16MiB');
    return {
      ...file,
      digest: createHash('sha256').update(content).digest('hex'),
    };
  });
}
export class OperationalObservations {
  constructor(private readonly db: StudioDatabase) {}
  async catalog(identity: Identity, value: unknown) {
    requireContributor(identity);
    const raw = objectInput(value ?? {}, ['page', 'q', 'author', 'from', 'to']);
    if (identity.role !== 'admin' && raw.author !== undefined)
      throw new ForbiddenException();
    const q = pageQuery(raw),
      sql = this.db.client;
    const [result] = await sql`WITH matched AS (
    SELECT o.id,o.body,o.version,o.author_id AS "authorId",coalesce(m.display_name,a.username) AS "authorName",o.created_at,o.updated_at AS "updatedAt",(SELECT count(*)::int FROM studio_os.operational_observation_assets f WHERE f.observation_id=o.id) AS "imageCount"
    FROM studio_os.operational_observations o JOIN studio_os.accounts a ON a.id=o.author_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id
    WHERE (${identity.role === 'admin'} OR o.author_id=${identity.id}) AND (${q.author}::uuid IS NULL OR o.author_id=${q.author})
    AND (${q.q}='' OR strpos(lower(o.body),${q.q})>0)
    AND (${q.from}::date IS NULL OR o.created_at>=(${q.from}::date::timestamp AT TIME ZONE 'Asia/Shanghai'))
    AND (${q.to}::date IS NULL OR o.created_at<((${q.to}::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai'))
   ),bounds AS (SELECT count(*)::int AS total,greatest(1,least(${q.page},ceil(count(*)/20.0)::int)) AS page FROM matched),paged AS (SELECT * FROM matched ORDER BY created_at DESC,id LIMIT 20 OFFSET ((SELECT page FROM bounds)-1)*20)
   SELECT total,page,coalesce((SELECT jsonb_agg((to_jsonb(paged)-'created_at')||jsonb_build_object('createdAt',created_at) ORDER BY created_at DESC,id) FROM paged),'[]'::jsonb) AS items FROM bounds`;
    return {
      ...result,
      pageSize: 20,
      pageCount: Math.max(1, Math.ceil(result.total / 20)),
    };
  }
  authors(identity: Identity) {
    requireAdministrator(identity);
    return this.db
      .client`SELECT DISTINCT a.id,coalesce(m.display_name,a.username) AS name FROM studio_os.operational_observations o JOIN studio_os.accounts a ON a.id=o.author_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id ORDER BY name,a.id`;
  }
  async detail(identity: Identity, id: string) {
    requireContributor(identity);
    uuid(id);
    const [row] = await this.db
      .client`SELECT o.id,o.body,o.version,o.author_id AS "authorId",coalesce(m.display_name,a.username) AS "authorName",o.created_at AS "createdAt",o.updated_at AS "updatedAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',octet_length(f.content),'addedVersion',f.added_version) ORDER BY f.created_at,f.id) FROM studio_os.operational_observation_assets f WHERE f.observation_id=o.id),'[]'::jsonb) AS assets FROM studio_os.operational_observations o JOIN studio_os.accounts a ON a.id=o.author_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE o.id=${id} AND (${identity.role === 'admin'} OR o.author_id=${identity.id})`;
    if (!row) throw new NotFoundException();
    return row;
  }
  async history(identity: Identity, id: string, value: unknown) {
    await this.detail(identity, id);
    const q = pageQuery(value, ['page']);
    const [result] = await this.db
      .client`WITH matched AS (SELECT e.id,e.actor_id AS "actorId",e.actor_name AS "actorName",e.before_value AS before,e.after_value AS after,e.created_at FROM studio_os.operational_observation_events e JOIN studio_os.operational_observations o ON o.id=e.observation_id WHERE o.id=${id} AND (${identity.role === 'admin'} OR o.author_id=${identity.id})),bounds AS (SELECT count(*)::int AS total,greatest(1,least(${q.page},ceil(count(*)/20.0)::int)) AS page FROM matched),paged AS (SELECT * FROM matched ORDER BY created_at DESC,id LIMIT 20 OFFSET ((SELECT page FROM bounds)-1)*20) SELECT total,page,coalesce((SELECT jsonb_agg((to_jsonb(paged)-'created_at')||jsonb_build_object('createdAt',created_at) ORDER BY created_at DESC,id) FROM paged),'[]'::jsonb) AS items FROM bounds`;
    return {
      ...result,
      pageSize: 20,
      pageCount: Math.max(1, Math.ceil(result.total / 20)),
    };
  }
  async receipt(identity: Identity, key: string) {
    requireContributor(identity);
    uuid(key);
    if (identity.role !== 'employee') throw new ForbiddenException();
    const [row] = await this.db
      .client`SELECT observation_id AS id,(after_value->>'version')::int AS version FROM studio_os.operational_observation_events WHERE actor_id=${identity.id} AND request_key=${key}`;
    if (!row) throw new NotFoundException();
    return row;
  }
  async file(identity: Identity, id: string, fileId: string) {
    requireContributor(identity);
    uuid(id);
    uuid(fileId);
    const [file] = await this.db
      .client`SELECT f.name,f.mime,f.content FROM studio_os.operational_observation_assets f JOIN studio_os.operational_observations o ON o.id=f.observation_id WHERE o.id=${id} AND f.id=${fileId} AND (${identity.role === 'admin'} OR o.author_id=${identity.id})`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireContributor(identity);
    if (identity.role !== 'employee') throw new ForbiddenException();
    if (id) uuid(id);
    const b = objectInput(
      value,
      id
        ? ['body', 'images', 'expectedVersion', 'requestKey']
        : ['body', 'images', 'requestKey'],
    );
    const body = optionalLongText(b.body, 4000),
      added = images(b.images),
      key = uuid(b.requestKey),
      expected = id ? version(b.expectedVersion) : null;
    if (!id && !body && !added.length)
      throw new BadRequestException('请填写观察内容或添加截图');
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          id: id ?? null,
          body,
          expected,
          images: added.map((f) => ({
            name: f.name,
            mime: f.mime,
            digest: f.digest,
          })),
        }),
      )
      .digest('hex');
    return this.db.client.begin(async (tx) => {
      const [actor] =
        await tx`SELECT a.active,a.role,coalesce(m.display_name,a.username) AS name FROM studio_os.accounts a LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE a.id=${identity.id} FOR SHARE OF a`;
      if (!actor?.active) throw new UnauthorizedException();
      if (actor.role !== 'employee') throw new ForbiddenException();
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity.id + ':obs:' + key},0))`;
      const [replay] =
        await tx`SELECT observation_id,request_hash,after_value FROM studio_os.operational_observation_events WHERE actor_id=${identity.id} AND request_key=${key}`;
      if (replay) {
        if (replay.request_hash !== hash) throw new ConflictException();
        return {
          id: replay.observation_id,
          version: replay.after_value.version,
        };
      }
      const [old] = id
        ? await tx`SELECT id,body,version FROM studio_os.operational_observations WHERE id=${id} AND author_id=${identity.id} FOR UPDATE`
        : [];
      if (id && !old) throw new NotFoundException();
      if (old && old.version !== expected)
        throw new ConflictException('观察已被修改，请刷新核对');
      const previous = id
        ? await tx`SELECT id,name,mime,octet_length(content)::int AS size,added_version AS "addedVersion" FROM studio_os.operational_observation_assets WHERE observation_id=${id} ORDER BY created_at,id`
        : [];
      if (
        previous.length + added.length > 6 ||
        previous.reduce((n, f) => n + f.size, 0) +
          added.reduce((n, f) => n + f.content.length, 0) >
          16777216
      )
        throw new PayloadTooLargeException(
          '每条观察最多6张截图、合计16MiB；已保存截图保留',
        );
      if (!body && !previous.length && !added.length)
        throw new BadRequestException('请填写观察内容或添加截图');
      const [row] = old
        ? await tx`UPDATE studio_os.operational_observations SET body=${body},version=version+1,updated_at=now() WHERE id=${id!} RETURNING id,version`
        : await tx`INSERT INTO studio_os.operational_observations(author_id,body) VALUES(${identity.id},${body}) RETURNING id,version`;
      for (const file of added)
        await tx`INSERT INTO studio_os.operational_observation_assets(observation_id,added_version,name,mime,content,digest) VALUES(${row.id},${row.version},${file.name},${file.mime},${file.content},${file.digest})`;
      const assets =
        await tx`SELECT id,name,mime,octet_length(content)::int AS size,added_version AS "addedVersion" FROM studio_os.operational_observation_assets WHERE observation_id=${row.id} ORDER BY created_at,id`;
      const before = old
          ? { body: old.body, version: old.version, assets: previous }
          : null,
        after = { body, version: row.version, assets };
      await tx`INSERT INTO studio_os.operational_observation_events(observation_id,actor_id,actor_name,request_key,request_hash,before_value,after_value) VALUES(${row.id},${identity.id},${actor.name},${key},${hash},${before ? JSON.stringify(before) : null}::jsonb,${JSON.stringify(after)}::jsonb)`;
      return row;
    });
  }
}
