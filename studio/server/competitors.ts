// CompetitorObservationPanel/service@379db8c. Business sub-accounts are not logins.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import {
  objectInput,
  uuid,
  shortText,
  longText,
  version,
  webLink,
} from './validation';
import { mediaFile } from './media';
import { timestamp } from './workflow';
import { optionalMoney, moneyText } from './money';
function conflict(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException();
  throw error;
}
const optional = (v: unknown, max = 2000) =>
  v === undefined || v === null || v === '' ? '' : longText(v, max);
const optionalId = (v: unknown) =>
  v === undefined || v === null || v === '' ? null : uuid(v);
const link = (v: unknown) =>
  v === undefined || v === null || v === '' ? null : webLink(v);
function day(v: unknown) {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v))
    throw new BadRequestException();
  timestamp(v + 'T00:00:00+08:00');
  return v;
}
function ids(v: unknown) {
  if (!Array.isArray(v) || v.length > 100) throw new BadRequestException();
  return [...new Set(v.map(uuid))];
}
function observedPrice(value: unknown) {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim())
  )
    return { cents: null, label: '' };
  const text = shortText(value, 200);
  try {
    return { cents: optionalMoney(text), label: '' };
  } catch (error) {
    if (error instanceof BadRequestException)
      return { cents: null, label: text };
    throw error;
  }
}
function sales(v: unknown) {
  if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 2147483647)
    throw new BadRequestException();
  return Number(v);
}
const kinds = [
  'sub-accounts',
  'products',
  'snapshots',
  'observations',
] as const;
type Kind = (typeof kinds)[number];
function kind(v: string): Kind {
  if (!(kinds as readonly string[]).includes(v)) throw new NotFoundException();
  return v as Kind;
}
export class Competitors {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity) {
    requireAdministrator(identity);
    return this.db.client.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      const roots =
        await tx`SELECT id,name,xhs_id AS "xhsId",profile_url AS "profileUrl",status,notes,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM studio_os.competitor_accounts ORDER BY updated_at DESC,id`;
      const subs =
        await tx`SELECT id,competitor_id AS "competitorId",name,xhs_id AS "xhsId",profile_url AS "profileUrl",notes FROM studio_os.competitor_sub_accounts ORDER BY created_at,id`;
      const products =
        await tx`SELECT p.id,p.competitor_id AS "competitorId",p.name,p.product_url AS "productUrl",p.linked_product_id AS "linkedProductId",g.name AS "linkedProductName",p.price_cents AS "priceCents",p.price_label AS "priceLabel",p.notes FROM studio_os.competitor_products p LEFT JOIN studio_os.products g ON g.id=p.linked_product_id ORDER BY p.created_at,p.id`;
      const snapshots = await tx<
        {
          id: string;
          competitorId: string;
          productId: string;
          snapshotDate: string;
          sales: number;
          priceCents: number | null;
          priceLabel: string;
        }[]
      >`SELECT id,competitor_id AS "competitorId",product_id AS "productId",snapshot_date::text AS "snapshotDate",sales,price_cents AS "priceCents",price_label AS "priceLabel" FROM studio_os.competitor_sales_snapshots ORDER BY snapshot_date DESC,id`;
      const observations =
        await tx`SELECT id,competitor_id AS "competitorId",sub_account_id AS "subAccountId",observation_date::text AS "observationDate",content FROM studio_os.competitor_observations ORDER BY observation_date DESC,created_at DESC,id`;
      const files =
        await tx`SELECT id,competitor_id AS "competitorId",sub_account_id AS "subAccountId",product_id AS "productId",observation_id AS "observationId",name,mime,octet_length(content) AS size FROM studio_os.competitor_files ORDER BY created_at,id`;
      const stores =
        await tx`SELECT r.competitor_id AS "competitorId",s.id,s.name,s.active FROM studio_os.competitor_store_links r JOIN studio_os.stores s ON s.id=r.store_id ORDER BY s.name,s.id`;
      const links =
        await tx`SELECT r.competitor_id AS "competitorId",g.id,g.name,g.active FROM studio_os.competitor_product_links r JOIN studio_os.products g ON g.id=r.product_id ORDER BY g.name,g.id`;
      return roots.map((r) => ({
        ...r,
        linkedStores: stores.filter((s) => s.competitorId === r.id),
        linkedProducts: links.filter((p) => p.competitorId === r.id),
        files: files.filter((f) => f.competitorId === r.id),
        subAccounts: subs.filter((s) => s.competitorId === r.id),
        observations: observations.filter((o) => o.competitorId === r.id),
        products: products
          .filter((p) => p.competitorId === r.id)
          .map((p) => {
            const history = snapshots
              .filter((s) => s.productId === p.id)
              .map((s) => ({
                ...s,
                price: s.priceLabel || moneyText(s.priceCents),
              }));
            return {
              ...p,
              price: p.priceLabel || moneyText(p.priceCents),
              snapshots: history,
              latestSnapshot: history[0] || null,
              salesChange:
                history.length > 1 ? history[0].sales - history[1].sales : null,
            };
          }),
      }));
    });
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const b = objectInput(value, [
        'name',
        'xhsId',
        'profileUrl',
        'status',
        'notes',
        'storeIds',
        'productIds',
        ...(id ? ['expectedVersion'] : []),
      ]),
      name = shortText(b.name, 200),
      xhs = shortText(b.xhsId, 100),
      url = link(b.profileUrl),
      notes = optional(b.notes),
      status = shortText(b.status, 20),
      stores = ids(b.storeIds ?? []),
      products = ids(b.productIds ?? []);
    if (!['重点观察', '普通观察', '暂停观察'].includes(status))
      throw new BadRequestException();
    try {
      return await this.db.client.begin(async (tx) => {
        let before, row;
        if (id) {
          [before] =
            await tx`SELECT id,name,xhs_id,profile_url,status,notes,version FROM studio_os.competitor_accounts WHERE id=${id} FOR UPDATE`;
          if (!before) throw new NotFoundException();
          if (before.version !== version(b.expectedVersion))
            throw new ConflictException();
        }
        for (const store of stores)
          if (
            !(
              await tx`SELECT id FROM studio_os.stores WHERE id=${store} FOR SHARE`
            ).length
          )
            throw new BadRequestException();
        for (const product of products)
          if (
            !(
              await tx`SELECT id FROM studio_os.products WHERE id=${product} FOR SHARE`
            ).length
          )
            throw new BadRequestException();
        if (id)
          [row] =
            await tx`UPDATE studio_os.competitor_accounts SET name=${name},xhs_id=${xhs},profile_url=${url},notes=${notes},status=${status},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
        else
          [row] =
            await tx`INSERT INTO studio_os.competitor_accounts(name,xhs_id,profile_url,notes,status,created_by) VALUES(${name},${xhs},${url},${notes},${status},${identity.id}) RETURNING id,version`;
        await tx`DELETE FROM studio_os.competitor_store_links WHERE competitor_id=${row.id}`;
        for (const store of stores)
          await tx`INSERT INTO studio_os.competitor_store_links(competitor_id,store_id) VALUES(${row.id},${store})`;
        await tx`DELETE FROM studio_os.competitor_product_links WHERE competitor_id=${row.id}`;
        for (const product of products)
          await tx`INSERT INTO studio_os.competitor_product_links(competitor_id,product_id) VALUES(${row.id},${product})`;
        await tx`INSERT INTO studio_os.competitor_events(competitor_id,actor_id,action,detail) VALUES(${row.id},${identity.id},${id ? 'account_updated' : 'account_created'},${JSON.stringify({ before: before ?? null, after: { name, xhs, profileUrl: url, notes, status, stores, products } })}::jsonb)`;
        return row;
      });
    } catch (e) {
      conflict(e);
    }
  }
  async child(
    identity: Identity,
    id: string,
    collection: string,
    value: unknown,
    childId?: string,
  ) {
    requireAdministrator(identity);
    uuid(id);
    if (childId) uuid(childId);
    const k = kind(collection);
    const fields =
      k === 'sub-accounts'
        ? ['name', 'xhsId', 'profileUrl', 'notes']
        : k === 'products'
          ? ['name', 'productUrl', 'linkedProductId', 'price', 'notes']
          : k === 'snapshots'
            ? ['productId', 'snapshotDate', 'sales', 'price']
            : ['subAccountId', 'observationDate', 'content'];
    const b = objectInput(value, [...fields, 'expectedVersion']),
      v = version(b.expectedVersion);
    const sub =
      k === 'sub-accounts'
        ? {
            name: shortText(b.name, 200),
            xhs: shortText(b.xhsId, 100),
            url: link(b.profileUrl),
            notes: optional(b.notes),
          }
        : null;
    const product =
      k === 'products'
        ? {
            name: shortText(b.name, 200),
            url: link(b.productUrl),
            linked: optionalId(b.linkedProductId),
            price: observedPrice(b.price),
            notes: optional(b.notes),
          }
        : null;
    const snap =
      k === 'snapshots'
        ? {
            product: uuid(b.productId),
            date: day(b.snapshotDate),
            sales: sales(b.sales),
            price: observedPrice(b.price),
          }
        : null;
    const observation =
      k === 'observations'
        ? {
            sub: optionalId(b.subAccountId),
            date: day(b.observationDate),
            content: longText(b.content, 4000),
          }
        : null;
    try {
      return await this.db.client.begin(async (tx) => {
        const [root] =
          await tx`SELECT version FROM studio_os.competitor_accounts WHERE id=${id} FOR UPDATE`;
        if (!root) throw new NotFoundException();
        if (root.version !== v) throw new ConflictException();
        let before, row;
        if (sub) {
          if (childId) {
            [before] =
              await tx`SELECT id,name,xhs_id,profile_url,notes FROM studio_os.competitor_sub_accounts WHERE competitor_id=${id} AND id=${childId}`;
            if (!before) throw new NotFoundException();
            [row] =
              await tx`UPDATE studio_os.competitor_sub_accounts SET name=${sub.name},xhs_id=${sub.xhs},profile_url=${sub.url},notes=${sub.notes} WHERE id=${childId} RETURNING id`;
          } else
            [row] =
              await tx`INSERT INTO studio_os.competitor_sub_accounts(competitor_id,name,xhs_id,profile_url,notes) VALUES(${id},${sub.name},${sub.xhs},${sub.url},${sub.notes}) RETURNING id`;
        } else if (product) {
          if (
            product.linked &&
            !(
              await tx`SELECT id FROM studio_os.products WHERE id=${product.linked} FOR SHARE`
            ).length
          )
            throw new BadRequestException();
          if (childId) {
            [before] =
              await tx`SELECT id,name,product_url,linked_product_id,price_cents,price_label,notes FROM studio_os.competitor_products WHERE competitor_id=${id} AND id=${childId}`;
            if (!before) throw new NotFoundException();
            [row] =
              await tx`UPDATE studio_os.competitor_products SET name=${product.name},product_url=${product.url},linked_product_id=${product.linked},price_cents=${product.price.cents},price_label=${product.price.label},notes=${product.notes} WHERE id=${childId} RETURNING id`;
          } else
            [row] =
              await tx`INSERT INTO studio_os.competitor_products(competitor_id,name,product_url,linked_product_id,price_cents,price_label,notes) VALUES(${id},${product.name},${product.url},${product.linked},${product.price.cents},${product.price.label},${product.notes}) RETURNING id`;
        } else if (snap) {
          if (
            !(
              await tx`SELECT id FROM studio_os.competitor_products WHERE competitor_id=${id} AND id=${snap.product}`
            ).length
          )
            throw new NotFoundException();
          if (childId) {
            [before] =
              await tx`SELECT id,product_id,snapshot_date,sales,price_cents,price_label FROM studio_os.competitor_sales_snapshots WHERE competitor_id=${id} AND id=${childId}`;
            if (!before) throw new NotFoundException();
            if (before.product_id !== snap.product)
              throw new BadRequestException();
            [row] =
              await tx`UPDATE studio_os.competitor_sales_snapshots SET snapshot_date=${snap.date}::date,sales=${snap.sales},price_cents=${snap.price.cents},price_label=${snap.price.label} WHERE id=${childId} RETURNING id`;
          } else
            [row] =
              await tx`INSERT INTO studio_os.competitor_sales_snapshots(competitor_id,product_id,snapshot_date,sales,price_cents,price_label,created_by) VALUES(${id},${snap.product},${snap.date}::date,${snap.sales},${snap.price.cents},${snap.price.label},${identity.id}) RETURNING id`;
        } else if (observation) {
          if (
            observation.sub &&
            !(
              await tx`SELECT id FROM studio_os.competitor_sub_accounts WHERE competitor_id=${id} AND id=${observation.sub}`
            ).length
          )
            throw new NotFoundException();
          if (childId) {
            [before] =
              await tx`SELECT id,sub_account_id,observation_date,content FROM studio_os.competitor_observations WHERE competitor_id=${id} AND id=${childId}`;
            if (!before) throw new NotFoundException();
            [row] =
              await tx`UPDATE studio_os.competitor_observations SET sub_account_id=${observation.sub},observation_date=${observation.date}::date,content=${observation.content} WHERE id=${childId} RETURNING id`;
          } else
            [row] =
              await tx`INSERT INTO studio_os.competitor_observations(competitor_id,sub_account_id,observation_date,content,created_by) VALUES(${id},${observation.sub},${observation.date}::date,${observation.content},${identity.id}) RETURNING id`;
        }
        if (!row) throw new BadRequestException();
        const [updated] =
          await tx`UPDATE studio_os.competitor_accounts SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
        await tx`INSERT INTO studio_os.competitor_events(competitor_id,actor_id,action,detail) VALUES(${id},${identity.id},${k + (childId ? '_updated' : '_created')},${JSON.stringify({ entityId: row.id, before: before ?? null, after: sub ?? product ?? snap ?? observation })}::jsonb)`;
        return { ...row, version: updated.version };
      });
    } catch (e) {
      conflict(e);
    }
  }
  async remove(
    identity: Identity,
    id: string,
    value: unknown,
    collection?: string,
    childId?: string,
  ) {
    requireAdministrator(identity);
    uuid(id);
    if (childId) uuid(childId);
    const k = collection ? kind(collection) : null,
      b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    const tables = {
      'sub-accounts': 'competitor_sub_accounts',
      products: 'competitor_products',
      snapshots: 'competitor_sales_snapshots',
      observations: 'competitor_observations',
    };
    return this.db.client.begin(async (tx) => {
      const [root] =
        await tx`SELECT * FROM studio_os.competitor_accounts WHERE id=${id} FOR UPDATE`;
      if (!root) throw new NotFoundException();
      if (root.version !== v) throw new ConflictException();
      if (
        k &&
        (!childId ||
          !(
            await tx.unsafe(
              'SELECT id FROM studio_os.' +
                tables[k] +
                ' WHERE competitor_id=$1 AND id=$2',
              [id, childId],
            )
          ).length)
      )
        throw new NotFoundException();
      // A deletion audit retains the pre-deletion facts, never private bytes.
      const [before] = await tx`SELECT
       (SELECT jsonb_agg(s) FROM studio_os.competitor_sub_accounts s WHERE competitor_id=${id}) AS subs,
       (SELECT jsonb_agg(p) FROM studio_os.competitor_products p WHERE competitor_id=${id}) AS products,
       (SELECT jsonb_agg(s) FROM studio_os.competitor_sales_snapshots s WHERE competitor_id=${id}) AS snapshots,
       (SELECT jsonb_agg(o) FROM studio_os.competitor_observations o WHERE competitor_id=${id}) AS observations,
       (SELECT jsonb_agg(f) FROM (SELECT id,sub_account_id,product_id,observation_id,name,mime,octet_length(content) AS size FROM studio_os.competitor_files WHERE competitor_id=${id}) f) AS files,
       (SELECT jsonb_agg(s) FROM studio_os.competitor_store_links s WHERE competitor_id=${id}) AS stores,
       (SELECT jsonb_agg(p) FROM studio_os.competitor_product_links p WHERE competitor_id=${id}) AS links`;
      let updated;
      if (k) {
        await tx.unsafe(
          'DELETE FROM studio_os.' +
            tables[k] +
            ' WHERE competitor_id=$1 AND id=$2',
          [id, childId!],
        );
        [updated] =
          await tx`UPDATE studio_os.competitor_accounts SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
      } else await tx`DELETE FROM studio_os.competitor_accounts WHERE id=${id}`;
      await tx`INSERT INTO studio_os.competitor_events(competitor_id,actor_id,action,detail) VALUES(${id},${identity.id},${(k || 'account') + '_deleted'},${JSON.stringify({ entityId: childId ?? id, before: { root, ...before } })}::jsonb)`;
      return { ok: true, ...updated };
    });
  }
  async upload(
    identity: Identity,
    id: string,
    bytes: unknown,
    name: unknown,
    mime: unknown,
    parentKind: unknown,
    parentId: unknown,
    expected: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    if (
      !['account', 'sub-account', 'product', 'observation'].includes(
        String(parentKind),
      ) ||
      typeof parentKind !== 'string'
    )
      throw new BadRequestException();
    if (parentKind === 'account' && parentId !== undefined && parentId !== '')
      throw new BadRequestException();
    const child = parentKind === 'account' ? null : uuid(parentId),
      file = mediaFile(bytes, name, mime);
    if (
      !file.mime.startsWith('image/') ||
      typeof expected !== 'string' ||
      !/^\d{1,10}$/.test(expected)
    )
      throw new BadRequestException();
    const v = version(Number(expected)),
      sub = parentKind === 'sub-account' ? child : null,
      product = parentKind === 'product' ? child : null,
      observation = parentKind === 'observation' ? child : null;
    return this.db.client.begin(async (tx) => {
      const [root] =
        await tx`SELECT version FROM studio_os.competitor_accounts WHERE id=${id} FOR UPDATE`;
      if (!root) throw new NotFoundException();
      if (root.version !== v) throw new ConflictException();
      if (
        sub &&
        !(
          await tx`SELECT id FROM studio_os.competitor_sub_accounts WHERE competitor_id=${id} AND id=${sub}`
        ).length
      )
        throw new NotFoundException();
      if (
        product &&
        !(
          await tx`SELECT id FROM studio_os.competitor_products WHERE competitor_id=${id} AND id=${product}`
        ).length
      )
        throw new NotFoundException();
      if (
        observation &&
        !(
          await tx`SELECT id FROM studio_os.competitor_observations WHERE competitor_id=${id} AND id=${observation}`
        ).length
      )
        throw new NotFoundException();
      const previous =
        await tx`SELECT id,name,mime,octet_length(content) AS size FROM studio_os.competitor_files WHERE competitor_id=${id} AND sub_account_id IS NOT DISTINCT FROM ${sub}::uuid AND product_id IS NOT DISTINCT FROM ${product}::uuid AND observation_id IS NOT DISTINCT FROM ${observation}::uuid`;
      if (observation) {
        if (
          previous.length >= 20 ||
          previous.reduce((n, f) => n + Number(f.size), 0) +
            file.content.length >
            67108864
        )
          throw new ConflictException();
      } else
        await tx`DELETE FROM studio_os.competitor_files WHERE competitor_id=${id} AND sub_account_id IS NOT DISTINCT FROM ${sub}::uuid AND product_id IS NOT DISTINCT FROM ${product}::uuid AND observation_id IS NULL`;
      const [saved] =
        await tx`INSERT INTO studio_os.competitor_files(competitor_id,sub_account_id,product_id,observation_id,name,mime,content) VALUES(${id},${sub},${product},${observation},${file.name},${file.mime},${file.content}) RETURNING id`;
      const [updated] =
        await tx`UPDATE studio_os.competitor_accounts SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
      await tx`INSERT INTO studio_os.competitor_events(competitor_id,actor_id,action,detail) VALUES(${id},${identity.id},'file_uploaded',${JSON.stringify({ entityId: child ?? id, kind: parentKind, fileId: saved.id, name: file.name, mime: file.mime, size: file.content.length, replaced: observation ? [] : previous })}::jsonb)`;
      return { ...saved, version: updated.version };
    });
  }
  async file(identity: Identity, id: string, fileId: string) {
    requireAdministrator(identity);
    uuid(id);
    uuid(fileId);
    const [file] = await this.db.client<
      { name: string; mime: string; content: Buffer }[]
    >`SELECT name,mime,content FROM studio_os.competitor_files WHERE competitor_id=${id} AND id=${fileId}`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async removeFile(
    identity: Identity,
    id: string,
    fileId: string,
    value: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    uuid(fileId);
    const b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      const [root] =
        await tx`SELECT version FROM studio_os.competitor_accounts WHERE id=${id} FOR UPDATE`;
      if (!root) throw new NotFoundException();
      if (root.version !== v) throw new ConflictException();
      const [file] =
        await tx`DELETE FROM studio_os.competitor_files WHERE competitor_id=${id} AND id=${fileId} RETURNING id,name,mime,octet_length(content) AS size`;
      if (!file) throw new NotFoundException();
      const [updated] =
        await tx`UPDATE studio_os.competitor_accounts SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
      await tx`INSERT INTO studio_os.competitor_events(competitor_id,actor_id,action,detail) VALUES(${id},${identity.id},'file_deleted',${JSON.stringify(file)}::jsonb)`;
      return { ok: true, version: updated.version };
    });
  }
}
