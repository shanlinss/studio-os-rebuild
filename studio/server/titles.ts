// TitlesPanel@dd8337d: explicit batches, directions, grouped copying and usage.
// Platform Drizzle services replaced with guarded SQL and atomic batch versions.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator, requireContributor } from './access';
import { objectInput, shortText, uuid, version } from './validation';
function rows(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    throw new BadRequestException();
  return value.map((value) => {
    const b = objectInput(value, ['title', 'direction']);
    return {
      title: shortText(b.title, 500),
      direction: b.direction ? shortText(b.direction, 100) : '未分类',
    };
  });
}
function date(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException();
  return value;
}
export class Titles {
  constructor(private readonly db: StudioDatabase) {}
  list(identity: Identity) {
    requireContributor(identity);
    return this.db
      .client`SELECT b.id,b.name,b.batch_date::text AS "batchDate",b.version,b.created_at AS "createdAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'direction',e.direction,'usageCount',e.usage_count) ORDER BY e.position,e.id) FROM studio_os.title_entries e WHERE e.batch_id=b.id),'[]'::jsonb) AS items FROM studio_os.title_batches b ORDER BY b.created_at DESC,b.id`;
  }
  async catalog(identity: Identity, query: Record<string, unknown>) {
    requireContributor(identity);
    if (
      Object.keys(query).some((k) => !['q', 'page'].includes(k)) ||
      (query.q !== undefined &&
        (typeof query.q !== 'string' ||
          query.q.length > 500 ||
          /[\u0000-\u001f\u007f]/.test(query.q))) ||
      (query.page !== undefined &&
        (typeof query.page !== 'string' || !/^[1-9]\d{0,5}$/.test(query.page)))
    )
      throw new BadRequestException();
    const needle = String(query.q || '')
        .trim()
        .toLowerCase(),
      requestedPage = Number(query.page || '1');
    // One snapshot for count, clamped page and metadata. No title bodies in a catalog page.
    const [result] = await this.db.client`WITH matched AS (
      SELECT b.* FROM studio_os.title_batches b WHERE ${needle}='' OR strpos(lower(b.name),${needle})>0 OR EXISTS(
        SELECT 1 FROM studio_os.title_entries e WHERE e.batch_id=b.id AND strpos(lower(e.title||' '||e.direction),${needle})>0)
    ), bounds AS (
      SELECT count(*)::int AS total,greatest(1,least(${requestedPage},ceil(count(*)/20.0)::int)) AS page FROM matched
    ), paged AS (
      SELECT * FROM matched ORDER BY created_at DESC,id LIMIT 20 OFFSET ((SELECT page FROM bounds)-1)*20
    ) SELECT total,page,coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',b.id,'name',b.name,'batchDate',b.batch_date::text,'version',b.version,
      'titleCount',(SELECT count(*)::int FROM studio_os.title_entries e WHERE e.batch_id=b.id),
      'directionCount',(SELECT count(DISTINCT direction)::int FROM studio_os.title_entries e WHERE e.batch_id=b.id),
      'directions',ARRAY(SELECT direction FROM studio_os.title_entries e WHERE e.batch_id=b.id GROUP BY direction ORDER BY min(position),direction LIMIT 5),
      'usageCount',(SELECT coalesce(sum(usage_count),0)::float8 FROM studio_os.title_entries e WHERE e.batch_id=b.id)
    ) ORDER BY b.created_at DESC,b.id) FROM paged b),'[]'::jsonb) AS items FROM bounds`;
    return {
      ...result,
      pageSize: 20,
      pageCount: Math.max(1, Math.ceil(result.total / 20)),
    };
  }
  async detail(identity: Identity, id: string) {
    requireContributor(identity);
    uuid(id);
    const [result] = await this.db
      .client`SELECT b.id,b.name,b.batch_date::text AS "batchDate",b.version,b.created_at AS "createdAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'direction',e.direction,'usageCount',e.usage_count) ORDER BY e.position,e.id) FROM studio_os.title_entries e WHERE e.batch_id=b.id),'[]'::jsonb) AS items FROM studio_os.title_batches b WHERE b.id=${id}`;
    if (!result) throw new NotFoundException();
    return result;
  }
  async create(identity: Identity, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, ['name', 'batchDate', 'items']),
      name = shortText(b.name),
      batchDate = date(b.batchDate),
      items = rows(b.items);
    return this.db.client.begin(async (tx) => {
      const [batch] =
        await tx`INSERT INTO studio_os.title_batches(name,batch_date,created_by) VALUES(${name},${batchDate},${identity.id}) RETURNING id,version`;
      for (const [position, item] of items.entries())
        await tx`INSERT INTO studio_os.title_entries(batch_id,title,direction,position) VALUES(${batch.id},${item.title},${item.direction},${position})`;
      await tx`INSERT INTO studio_os.title_events(batch_id,actor_id,action,detail) VALUES(${batch.id},${identity.id},'created',${JSON.stringify({ name, batchDate, items })}::jsonb)`;
      return batch;
    });
  }
  async mutate(
    identity: Identity,
    id: string,
    action: 'renamed' | 'appended' | 'edited' | 'removed' | 'deleted',
    value: unknown,
    entryId?: string,
  ) {
    requireAdministrator(identity);
    uuid(id);
    if (entryId) uuid(entryId);
    const b = objectInput(
      value,
      action === 'renamed'
        ? ['expectedVersion', 'name']
        : action === 'appended'
          ? ['expectedVersion', 'items']
          : action === 'edited'
            ? ['expectedVersion', 'title', 'direction']
            : ['expectedVersion'],
    );
    const expected = version(b.expectedVersion);
    const name = action === 'renamed' ? shortText(b.name) : null;
    const items =
      action === 'appended'
        ? rows(b.items)
        : action === 'edited'
          ? rows([{ title: b.title, direction: b.direction }])
          : [];
    return this.db.client.begin(async (tx) => {
      const [batch] =
        await tx`SELECT id,name,version FROM studio_os.title_batches WHERE id=${id} FOR UPDATE`;
      if (!batch) throw new NotFoundException();
      if (batch.version !== expected) throw new ConflictException();
      let before: unknown = batch;
      if (action === 'deleted')
        await tx`DELETE FROM studio_os.title_batches WHERE id=${id}`;
      else {
        if (action === 'renamed')
          await tx`UPDATE studio_os.title_batches SET name=${name} WHERE id=${id}`;
        if (action === 'appended') {
          const [count] =
            await tx`SELECT count(*)::int AS n,coalesce(max(position),-1)::int AS last FROM studio_os.title_entries WHERE batch_id=${id}`;
          if (count.n + items.length > 1000) throw new BadRequestException();
          for (const [i, item] of items.entries())
            await tx`INSERT INTO studio_os.title_entries(batch_id,title,direction,position) VALUES(${id},${item.title},${item.direction},${count.last + i + 1})`;
        }
        if (action === 'edited' || action === 'removed') {
          const [entry] =
            await tx`SELECT id,title,direction FROM studio_os.title_entries WHERE id=${entryId!} AND batch_id=${id}`;
          if (!entry) throw new NotFoundException();
          before = entry;
          if (action === 'edited')
            await tx`UPDATE studio_os.title_entries SET title=${items[0].title},direction=${items[0].direction} WHERE id=${entryId!} AND batch_id=${id}`;
          else
            await tx`DELETE FROM studio_os.title_entries WHERE id=${entryId!} AND batch_id=${id}`;
        }
        await tx`UPDATE studio_os.title_batches SET version=version+1,updated_at=now() WHERE id=${id}`;
      }
      await tx`INSERT INTO studio_os.title_events(batch_id,actor_id,action,detail) VALUES(${id},${identity.id},${action},${JSON.stringify({ before, name, items, entryId })}::jsonb)`;
      return { id, version: expected + 1 };
    });
  }
  async copied(identity: Identity, id: string, value: unknown) {
    requireContributor(identity);
    uuid(id);
    const b = objectInput(value, ['requestId', 'entryIds', 'expectedVersion']),
      requestId = uuid(b.requestId),
      expected = version(b.expectedVersion);
    if (
      !Array.isArray(b.entryIds) ||
      !b.entryIds.length ||
      b.entryIds.length > 1000
    )
      throw new BadRequestException();
    const ids = b.entryIds.map(uuid).sort();
    if (new Set(ids).size !== ids.length) throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      // One lock order for edits and copy counters. A retry cannot double-count.
      const [batch] =
        await tx`SELECT version FROM studio_os.title_batches WHERE id=${id} FOR UPDATE`;
      if (!batch) throw new NotFoundException();
      const [old] =
        await tx`SELECT batch_id,actor_id,entry_ids FROM studio_os.title_copy_receipts WHERE id=${requestId}`;
      if (old) {
        if (
          old.batch_id !== id ||
          old.actor_id !== identity.id ||
          JSON.stringify(old.entry_ids) !== JSON.stringify(ids)
        )
          throw new ConflictException();
        return { ok: true, replayed: true };
      }
      if (batch.version !== expected) throw new ConflictException();
      const entries =
        await tx`SELECT id FROM studio_os.title_entries WHERE batch_id=${id} AND id IN ${tx(ids)}`;
      if (entries.length !== ids.length) throw new NotFoundException();
      // A cross-batch request ID race is refused by the PK; transaction rolls back.
      const inserted =
        await tx`INSERT INTO studio_os.title_copy_receipts(id,batch_id,actor_id,entry_ids) VALUES(${requestId},${id},${identity.id},${JSON.stringify(ids)}::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`;
      if (!inserted.length) throw new ConflictException();
      await tx`UPDATE studio_os.title_entries SET usage_count=usage_count+1 WHERE batch_id=${id} AND id IN ${tx(ids)}`;
      await tx`INSERT INTO studio_os.title_events(batch_id,actor_id,action,detail) VALUES(${id},${identity.id},'copied',${JSON.stringify({ requestId, entryIds: ids })}::jsonb)`;
      return { ok: true, replayed: false };
    });
  }
}
