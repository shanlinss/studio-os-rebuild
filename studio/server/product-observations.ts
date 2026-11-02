// Whole-test observations from product-testing.saveSnapshot; no fixed slots,
// platform owner identities, implicit missing=0, or destructive upserts.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { objectInput, uuid, longText, version } from './validation';
import { timestamp } from './workflow';
export class ProductObservations {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity, productId: string) {
    requireAdministrator(identity);
    uuid(productId);
    const [product] = await this.db
      .client`SELECT id FROM studio_os.products WHERE id=${productId}`;
    if (!product) throw new NotFoundException();
    // One statement gives rows and audit history the same MVCC snapshot when
    // another administrator corrects a record during this request.
    return this.db
      .client`SELECT o.id,o.observed_at AS "observedAt",o.views,o.likes,o.favorites,o.comments,o.notes,o.version,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'observationId',e.observation_id,'createdAt',e.created_at,'before',e.before_value,'after',e.after_value,'actorName',coalesce(m.display_name,'管理员')) ORDER BY (e.after_value->>'version')::integer,e.created_at,e.id)
        FROM studio_os.product_observation_events e LEFT JOIN studio_os.members m ON m.login_account_id=e.actor_id WHERE e.observation_id=o.id),'[]'::jsonb) AS history
      FROM studio_os.product_observations o WHERE o.product_id=${productId} ORDER BY o.observed_at DESC,o.id`;
  }
  async save(
    identity: Identity,
    productId: string,
    value: unknown,
    id?: string,
  ) {
    requireAdministrator(identity);
    uuid(productId);
    if (id) uuid(id);
    const b = objectInput(value, [
      'requestKey',
      'observedAt',
      'views',
      'likes',
      'favorites',
      'comments',
      'notes',
      ...(id ? ['expectedVersion'] : []),
    ]);
    const key = uuid(b.requestKey),
      at = timestamp(b.observedAt),
      expected = id ? version(b.expectedVersion) : null;
    const numbers = ['views', 'likes', 'favorites', 'comments'].map((name) => {
      const n = b[name];
      if (n === null || n === undefined) return null;
      if (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 2147483647)
        throw new BadRequestException();
      return Number(n);
    });
    if (numbers.every((n) => n === null)) throw new BadRequestException();
    const [views, likes, favorites, comments] = numbers;
    const notes =
      b.notes === undefined || b.notes === '' ? '' : longText(b.notes, 2000);
    const hash = createHash('sha256')
      .update(
        JSON.stringify([productId, id || null, expected, at, numbers, notes]),
      )
      .digest('hex');
    try {
      return await this.db.client.begin(async (tx) => {
        const [product] =
          await tx`SELECT active FROM studio_os.products WHERE id=${productId} FOR UPDATE`;
        if (!product) throw new NotFoundException();
        await tx`INSERT INTO studio_os.product_observation_requests(actor_id,request_key,product_id,request_hash) VALUES(${identity.id},${key},${productId},${hash}) ON CONFLICT(actor_id,request_key) DO NOTHING`;
        const [prior] =
          await tx`SELECT request_hash,result FROM studio_os.product_observation_requests WHERE actor_id=${identity.id} AND request_key=${key} FOR UPDATE`;
        if (prior.request_hash !== hash) throw new ConflictException();
        if (prior.result) return prior.result;
        if (!product.active) throw new ConflictException();
        let before, after;
        if (id) {
          [before] =
            await tx`SELECT id,observed_at AS "observedAt",views,likes,favorites,comments,notes,version FROM studio_os.product_observations WHERE id=${id} AND product_id=${productId} FOR UPDATE`;
          if (!before) throw new NotFoundException();
          if (before.version !== expected) throw new ConflictException();
          [after] =
            await tx`UPDATE studio_os.product_observations SET observed_at=${at},views=${views},likes=${likes},favorites=${favorites},comments=${comments},notes=${notes},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,observed_at AS "observedAt",views,likes,favorites,comments,notes,version`;
        } else {
          [after] =
            await tx`INSERT INTO studio_os.product_observations(product_id,observed_at,views,likes,favorites,comments,notes) VALUES(${productId},${at},${views},${likes},${favorites},${comments},${notes}) RETURNING id,observed_at AS "observedAt",views,likes,favorites,comments,notes,version`;
        }
        await tx`INSERT INTO studio_os.product_observation_events(observation_id,actor_id,before_value,after_value) VALUES(${after.id},${identity.id},${before ? JSON.stringify(before) : null}::jsonb,${JSON.stringify(after)}::jsonb)`;
        const result = { id: after.id, version: after.version };
        await tx`UPDATE studio_os.product_observation_requests SET result=${JSON.stringify(result)}::jsonb WHERE actor_id=${identity.id} AND request_key=${key}`;
        return result;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
}
