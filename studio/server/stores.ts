import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { objectInput, uuid, version } from './validation';

type StoreInput = {
  name?: unknown;
  active?: unknown;
  expectedVersion?: unknown;
};
function input(value: unknown, update = false): StoreInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException();
  const allowed = update ? ['name', 'active', 'expectedVersion'] : ['name'];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BadRequestException();
  return value;
}
function nameOf(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new BadRequestException();
  return value.trim();
}
function idOf(value: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException();
  return value;
}
export class Stores {
  constructor(private readonly db: StudioDatabase) {}
  async folders() {
    const [result] = await this.db
      .client`SELECT l.version,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'version',s.version) ORDER BY s.active DESC,p.position NULLS LAST,s.name,s.id),'[]'::jsonb) FROM studio_os.stores s LEFT JOIN studio_os.material_folder_positions p ON p.store_id=s.id) AS stores FROM studio_os.material_folder_layout l WHERE singleton`;
    if (!result) throw new ServiceUnavailableException();
    return result;
  }
  async moveFolder(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    id = uuid(id).toLowerCase();
    const b = objectInput(value, [
      'direction',
      'expectedVersion',
      'neighborId',
      'expectedNeighborVersion',
      'expectedLayoutVersion',
    ]);
    const expected = version(b.expectedVersion),
      neighbor = uuid(b.neighborId).toLowerCase(),
      expectedNeighbor = version(b.expectedNeighborVersion),
      expectedLayout = version(b.expectedLayoutVersion);
    if (b.direction !== 1 && b.direction !== -1)
      throw new BadRequestException();
    const direction = b.direction;
    return this.db.client.begin(async (tx) => {
      const [actor] =
        await tx`SELECT id FROM studio_os.accounts WHERE id=${identity.id} AND role='admin' AND active FOR SHARE`;
      if (!actor) throw new ForbiddenException();
      const [layout] =
        await tx`SELECT version FROM studio_os.material_folder_layout WHERE singleton FOR UPDATE`;
      if (!layout) throw new ServiceUnavailableException();
      if (layout.version !== expectedLayout) throw new ConflictException();
      // EXCLUSIVE also waits for existing SELECT FOR UPDATE store writers;
      // a weaker table lock could deadlock with their subsequent UPDATE.
      // Ordinary readers remain available. Business identity/version is unchanged.
      await tx`LOCK TABLE studio_os.stores IN EXCLUSIVE MODE`;
      const rows =
        await tx`SELECT s.id,s.version FROM studio_os.stores s LEFT JOIN studio_os.material_folder_positions p ON p.store_id=s.id WHERE s.active ORDER BY p.position NULLS LAST,s.name,s.id`;
      const index = rows.findIndex((row) => row.id === id),
        other = index + direction;
      if (
        index < 0 ||
        other < 0 ||
        other >= rows.length ||
        rows[index].version !== expected ||
        rows[other].id !== neighbor ||
        rows[other].version !== expectedNeighbor
      )
        throw new ConflictException();
      const ordered = [...rows];
      [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
      for (const [position, row] of ordered.entries()) {
        await tx`INSERT INTO studio_os.material_folder_positions(store_id,position) VALUES(${row.id},${position}) ON CONFLICT(store_id) DO UPDATE SET position=excluded.position`;
      }
      await tx`UPDATE studio_os.material_folder_layout SET version=version+1 WHERE singleton`;
      await tx`INSERT INTO studio_os.material_folder_events(actor_id,before_ids,after_ids) VALUES(${identity.id},${tx.array(
        rows.map((r) => String(r.id)),
        2950,
      )},${tx.array(
        ordered.map((r) => String(r.id)),
        2950,
      )})`;
      const [result] =
        await tx`SELECT l.version,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'version',s.version) ORDER BY s.active DESC,p.position NULLS LAST,s.name,s.id),'[]'::jsonb) FROM studio_os.stores s LEFT JOIN studio_os.material_folder_positions p ON p.store_id=s.id) AS stores FROM studio_os.material_folder_layout l WHERE singleton`;
      return result;
    });
  }
  list() {
    return this.db
      .client`SELECT id, name, active, version, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM studio_os.stores ORDER BY active DESC, name, id`;
  }
  async create(value: unknown, actorId: string) {
    const name = nameOf(input(value).name);
    try {
      return await this.db.client.begin(async (tx) => {
        const [row] =
          await tx`INSERT INTO studio_os.stores (name) VALUES (${name}) RETURNING id, name, active, version`;
        await tx`INSERT INTO studio_os.store_events (store_id, actor_id, action, after_value)
          VALUES (${row.id}, ${actorId}, 'created', ${JSON.stringify({ name: row.name, active: row.active, version: row.version })})`;
        return row;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
  async update(id: string, value: unknown, actorId: string) {
    idOf(id);
    const patch = input(value, true);
    if (
      !Number.isSafeInteger(patch.expectedVersion) ||
      Number(patch.expectedVersion) < 1 ||
      (patch.name === undefined && patch.active === undefined)
    )
      throw new BadRequestException();
    if (patch.active !== undefined && typeof patch.active !== 'boolean')
      throw new BadRequestException();
    const name = patch.name !== undefined ? nameOf(patch.name) : undefined;
    try {
      return await this.db.client.begin(async (tx) => {
        const [before] =
          await tx`SELECT id, name, active, version FROM studio_os.stores WHERE id = ${id} FOR UPDATE`;
        if (!before) throw new NotFoundException();
        if (before.version !== patch.expectedVersion)
          throw new ConflictException();
        const [after] =
          await tx`UPDATE studio_os.stores SET name = ${name ?? before.name}, active = ${patch.active ?? before.active}, version = version + 1, updated_at = now()
          WHERE id = ${id} RETURNING id, name, active, version`;
        await tx`INSERT INTO studio_os.store_events (store_id, actor_id, action, before_value, after_value)
          VALUES (${id}, ${actorId}, 'updated', ${JSON.stringify({ name: before.name, active: before.active, version: before.version })}, ${JSON.stringify({ name: after.name, active: after.active, version: after.version })})`;
        return after;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
}
