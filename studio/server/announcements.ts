// DashboardPanel + announcements service at a6a1fa1; first-party adaptation.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { objectInput, uuid, shortText, longText, version } from './validation';
const flag = (v: unknown) => {
  if (typeof v !== 'boolean') throw new BadRequestException();
  return v;
};
function dto(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isActive: row.is_active,
    isPinned: row.is_pinned,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export class Announcements {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity) {
    const rows = await this.db
      .client`SELECT id,title,content,is_active,is_pinned,version,created_at,updated_at FROM studio_os.announcements WHERE deleted_at IS NULL AND (${identity.role === 'admin'} OR is_active) ORDER BY is_pinned DESC,created_at DESC,id LIMIT 1001`;
    if (rows.length > 1000)
      throw new PayloadTooLargeException('公告过多，请管理员清理历史公告');
    return rows.map(dto);
  }
  async detail(identity: Identity, id: string) {
    id = uuid(id);
    const [row] = await this.db
      .client`SELECT id,title,content,is_active,is_pinned,version,created_at,updated_at FROM studio_os.announcements WHERE id=${id} AND deleted_at IS NULL AND (${identity.role === 'admin'} OR is_active)`;
    if (!row) throw new NotFoundException();
    return dto(row);
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) id = uuid(id);
    const b = objectInput(
      value,
      id
        ? ['title', 'content', 'isActive', 'isPinned', 'expectedVersion']
        : ['title', 'content', 'requestKey'],
    );
    const expected = id ? version(b.expectedVersion) : null;
    if (
      id &&
      !['title', 'content', 'isActive', 'isPinned'].some((k) =>
        Object.hasOwn(b, k),
      )
    )
      throw new BadRequestException();
    const title =
      b.title === undefined && id ? undefined : shortText(b.title, 120);
    const content =
      b.content === undefined && id ? undefined : longText(b.content, 3000);
    const active = b.isActive === undefined ? undefined : flag(b.isActive),
      pinned = b.isPinned === undefined ? undefined : flag(b.isPinned);
    const key = id ? null : uuid(b.requestKey);
    const hash = createHash('sha256')
      .update(JSON.stringify({ title, content }))
      .digest('hex');
    return this.db.client.begin(async (tx) => {
      const [actor] =
        await tx`SELECT role FROM studio_os.accounts WHERE id=${identity.id} AND active FOR SHARE`;
      if (!actor) throw new UnauthorizedException();
      if (actor.role !== 'admin') throw new ForbiddenException();
      let old, row;
      if (id) {
        [old] =
          await tx`SELECT * FROM studio_os.announcements WHERE id=${id} AND deleted_at IS NULL FOR UPDATE`;
        if (!old) throw new NotFoundException();
        if (old.version !== expected) throw new ConflictException();
        [row] =
          await tx`UPDATE studio_os.announcements SET title=${title ?? old.title},content=${content ?? old.content},is_active=${active ?? old.is_active},is_pinned=${pinned ?? old.is_pinned},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      } else {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity.id + ':' + key},0))`;
        const [prior] =
          await tx`SELECT * FROM studio_os.announcements WHERE created_by=${identity.id} AND request_key=${key}`;
        if (prior) {
          if (prior.request_hash !== hash || prior.deleted_at)
            throw new ConflictException();
          return dto(prior);
        }
        [row] =
          await tx`INSERT INTO studio_os.announcements(title,content,created_by,request_key,request_hash) VALUES(${title!},${content!},${identity.id},${key},${hash}) RETURNING *`;
      }
      await tx`INSERT INTO studio_os.announcement_events(announcement_id,actor_id,action,before_value,after_value) VALUES(${row.id},${identity.id},${id ? 'updated' : 'created'},${old ? JSON.stringify(dto(old)) : null}::jsonb,${JSON.stringify(dto(row))}::jsonb)`;
      return dto(row);
    });
  }
  async remove(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    id = uuid(id);
    const b = objectInput(value, ['expectedVersion']),
      expected = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [actor] =
        await tx`SELECT role FROM studio_os.accounts WHERE id=${identity.id} AND active FOR SHARE`;
      if (!actor) throw new UnauthorizedException();
      if (actor.role !== 'admin') throw new ForbiddenException();
      const [old] =
        await tx`SELECT * FROM studio_os.announcements WHERE id=${id} AND deleted_at IS NULL FOR UPDATE`;
      if (!old) throw new NotFoundException();
      if (old.version !== expected) throw new ConflictException();
      await tx`UPDATE studio_os.announcements SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.announcement_events(announcement_id,actor_id,action,before_value) VALUES(${id},${identity.id},'deleted',${JSON.stringify(dto(old))}::jsonb)`;
      return { deleted: true };
    });
  }
}
