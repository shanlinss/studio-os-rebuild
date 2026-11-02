// ExpenseLedgerPanel/service@b9576d0: real expenses, statements and recorded
// reimbursements. First-party identities/private receipts replace platform APIs.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { objectInput, uuid, shortText, longText, version } from './validation';
import { timestamp } from './workflow';
import { optionalMoney } from './money';
import { mediaFile } from './media';
const optional = (v: unknown) =>
  v === undefined || v === null || v === '' ? '' : longText(v, 2000);
const optionalId = (v: unknown) =>
  v === undefined || v === null || v === '' ? null : uuid(v);
function day(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value))
    throw new BadRequestException();
  timestamp(value + 'T00:00:00+08:00');
  return value;
}
function amount(value: unknown) {
  const n = optionalMoney(value);
  if (n === null || n <= 0) throw new BadRequestException();
  return n;
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function conflict(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new ConflictException();
  throw error;
}
function expenseInput(value: unknown, editing: boolean) {
  const b = objectInput(value, [
    'expenseDate',
    'description',
    'amount',
    'paymentMode',
    'payerId',
    'storeId',
    'categoryId',
    'note',
    editing ? 'expectedVersion' : 'requestKey',
  ]);
  const mode = b.paymentMode;
  if (mode !== 'company' && mode !== 'advance') throw new BadRequestException();
  const payer = optionalId(b.payerId);
  if ((mode === 'advance' && !payer) || (mode === 'company' && payer))
    throw new BadRequestException();
  return {
    date: day(b.expenseDate),
    description: longText(b.description, 2000),
    cents: amount(b.amount),
    mode,
    payer,
    store: optionalId(b.storeId),
    category: optionalId(b.categoryId),
    note: optional(b.note),
    v: editing ? version(b.expectedVersion) : null,
    key: editing ? null : uuid(b.requestKey),
  };
}
async function actor(tx: TransactionSql, identity: Identity) {
  const [a] =
    await tx`SELECT role,active FROM studio_os.accounts WHERE id=${identity.id} FOR SHARE`;
  if (!a?.active) throw new UnauthorizedException();
  if (a.role !== 'admin') throw new ForbiddenException();
}
async function mutableExpense(tx: TransactionSql, id: string, v: number) {
  const [row] =
    await tx`SELECT *,expense_date::text AS "businessDate" FROM studio_os.expense_records WHERE id=${id} FOR UPDATE`;
  if (!row) throw new NotFoundException();
  if (row.version !== v) throw new ConflictException();
  if (
    (
      await tx`SELECT expense_id FROM studio_os.expense_settlement_items WHERE expense_id=${id}`
    ).length
  )
    throw new ConflictException();
  return row;
}
export class Finance {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity) {
    requireAdministrator(identity);
    return this.db.client.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      const categories =
        await tx`SELECT id,name,active,version FROM studio_os.expense_categories ORDER BY active DESC,name,id`;
      const stores =
        await tx`SELECT id,name,active,version FROM studio_os.stores ORDER BY active DESC,name,id`;
      const members =
        await tx`SELECT id,display_name AS "displayName",active FROM studio_os.members ORDER BY active DESC,display_name,id`;
      const records =
        await tx`SELECT r.id,r.expense_date::text AS "expenseDate",r.store_id AS "storeId",s.name AS "storeName",r.category_id AS "categoryId",c.name AS "categoryName",r.description,r.amount_cents AS "amountCents",r.payment_mode AS "paymentMode",r.payer_id AS "payerId",m.display_name AS "payerName",r.note,r.version,r.request_key AS "requestKey",r.created_at AS "createdAt",r.updated_at AS "updatedAt",i.settlement_id AS "settlementId",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',octet_length(f.content)) ORDER BY f.created_at,f.id) FROM studio_os.expense_receipts f WHERE f.expense_id=r.id),'[]') AS receipts FROM studio_os.expense_records r LEFT JOIN studio_os.stores s ON s.id=r.store_id LEFT JOIN studio_os.expense_categories c ON c.id=r.category_id LEFT JOIN studio_os.members m ON m.id=r.payer_id LEFT JOIN studio_os.expense_settlement_items i ON i.expense_id=r.id ORDER BY r.expense_date DESC,r.created_at DESC,r.id`;
      const settlements =
        await tx`SELECT s.id,s.payer_id AS "payerId",m.display_name AS "payerName",s.start_date::text AS "startDate",s.end_date::text AS "endDate",s.note,s.version,s.request_key AS "requestKey",s.created_at AS "createdAt",(SELECT coalesce(sum(i.amount_cents),0)::text FROM studio_os.expense_settlement_items i WHERE i.settlement_id=s.id) AS "totalCents",(SELECT coalesce(sum(p.amount_cents),0)::text FROM studio_os.expense_reimbursements p WHERE p.settlement_id=s.id) AS "paidCents",coalesce((SELECT jsonb_agg(jsonb_build_object('expenseId',i.expense_id,'amountCents',i.amount_cents) ORDER BY i.expense_id) FROM studio_os.expense_settlement_items i WHERE i.settlement_id=s.id),'[]') AS items FROM studio_os.expense_settlements s JOIN studio_os.members m ON m.id=s.payer_id ORDER BY s.created_at DESC,s.id`;
      const payments =
        await tx`SELECT p.id,p.settlement_id AS "settlementId",p.payer_id AS "payerId",m.display_name AS "payerName",p.amount_cents AS "amountCents",p.paid_date::text AS "paidDate",p.note,p.request_key AS "requestKey",p.created_at AS "createdAt" FROM studio_os.expense_reimbursements p JOIN studio_os.members m ON m.id=p.payer_id ORDER BY p.paid_date DESC,p.created_at DESC,p.id`;
      return { categories, stores, members, records, settlements, payments };
    });
  }
  async category(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const b = objectInput(
        value,
        id ? ['name', 'active', 'expectedVersion'] : ['name'],
      ),
      name = shortText(b.name, 100);
    if (id && typeof b.active !== 'boolean') throw new BadRequestException();
    try {
      return await this.db.client.begin(async (tx) => {
        await actor(tx, identity);
        let before, row;
        if (id) {
          [before] =
            await tx`SELECT id,name,active,version FROM studio_os.expense_categories WHERE id=${id} FOR UPDATE`;
          if (!before) throw new NotFoundException();
          if (before.version !== version(b.expectedVersion))
            throw new ConflictException();
          [row] =
            await tx`UPDATE studio_os.expense_categories SET name=${name},active=${b.active as boolean},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,name,active,version`;
        } else
          [row] =
            await tx`INSERT INTO studio_os.expense_categories(name) VALUES(${name}) RETURNING id,name,active,version`;
        await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('category',${row.id},${identity.id},${id ? 'updated' : 'created'},${JSON.stringify({ before: before ?? null, after: row })}::jsonb)`;
        return row;
      });
    } catch (e) {
      conflict(e);
    }
  }
  async save(identity: Identity, value: unknown, id?: string) {
    requireAdministrator(identity);
    if (id) uuid(id);
    const input = expenseInput(value, !!id),
      { date, description, cents, mode, payer, store, category, note, v, key } =
        input,
      requestHash = hash({
        actor: identity.id,
        date,
        description,
        cents,
        mode,
        payer,
        store,
        category,
        note,
      });
    try {
      return await this.db.client.begin(async (tx) => {
        await actor(tx, identity);
        let before, row;
        if (id) before = await mutableExpense(tx, id, v!);
        else {
          await tx`SELECT pg_advisory_xact_lock(hashtext(${key!}))`;
          const [old] =
            await tx`SELECT id,version,request_hash FROM studio_os.expense_records WHERE request_key=${key!}`;
          if (old) {
            if (old.request_hash !== requestHash) throw new ConflictException();
            return { id: old.id, version: old.version };
          }
        }
        if (
          payer &&
          !(
            await tx`SELECT id FROM studio_os.members WHERE id=${payer} FOR SHARE`
          ).length
        )
          throw new BadRequestException();
        if (store) {
          const [s] =
            await tx`SELECT active FROM studio_os.stores WHERE id=${store} FOR SHARE`;
          if (!s || (!s.active && before?.store_id !== store))
            throw new BadRequestException();
        }
        if (category) {
          const [c] =
            await tx`SELECT active FROM studio_os.expense_categories WHERE id=${category} FOR SHARE`;
          if (!c || (!c.active && before?.category_id !== category))
            throw new BadRequestException();
        }
        if (id)
          [row] =
            await tx`UPDATE studio_os.expense_records SET expense_date=${date}::date,description=${description},amount_cents=${cents},payment_mode=${mode},payer_id=${payer},store_id=${store},category_id=${category},note=${note},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
        else
          [row] =
            await tx`INSERT INTO studio_os.expense_records(expense_date,description,amount_cents,payment_mode,payer_id,store_id,category_id,note,request_key,request_hash,created_by) VALUES(${date}::date,${description},${cents},${mode},${payer},${store},${category},${note},${key!},${requestHash},${identity.id}) RETURNING id,version`;
        await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('expense',${row.id},${identity.id},${id ? 'updated' : 'created'},${JSON.stringify({ before: before ?? null, after: { date, description, cents, mode, payer, store, category, note } })}::jsonb)`;
        return row;
      });
    } catch (e) {
      conflict(e);
    }
  }
  async remove(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    uuid(id);
    const b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      await actor(tx, identity);
      const before = await mutableExpense(tx, id, v),
        files =
          await tx`SELECT id,name,mime,octet_length(content) AS size FROM studio_os.expense_receipts WHERE expense_id=${id}`;
      await tx`DELETE FROM studio_os.expense_records WHERE id=${id}`;
      await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('expense',${id},${identity.id},'deleted',${JSON.stringify({ before, receipts: files })}::jsonb)`;
      return { ok: true };
    });
  }
  async settle(identity: Identity, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, [
        'payerId',
        'startDate',
        'endDate',
        'items',
        'note',
        'requestKey',
      ]),
      payer = uuid(b.payerId),
      start = day(b.startDate),
      end = day(b.endDate),
      note = optional(b.note),
      key = uuid(b.requestKey);
    if (
      start > end ||
      !Array.isArray(b.items) ||
      !b.items.length ||
      b.items.length > 500
    )
      throw new BadRequestException();
    const items = b.items
      .map((item) => {
        const r = objectInput(item, ['expenseId', 'expectedVersion']);
        return { id: uuid(r.expenseId), v: version(r.expectedVersion) };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(items.map((r) => r.id)).size !== items.length)
      throw new BadRequestException();
    const requestHash = hash({
      actor: identity.id,
      payer,
      start,
      end,
      note,
      items,
    });
    try {
      return await this.db.client.begin(async (tx) => {
        await actor(tx, identity);
        await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const [old] =
          await tx`SELECT id,version,request_hash FROM studio_os.expense_settlements WHERE request_key=${key}`;
        if (old) {
          if (old.request_hash !== requestHash) throw new ConflictException();
          return { id: old.id, version: old.version };
        }
        for (const item of items) {
          const row = await mutableExpense(tx, item.id, item.v);
          if (
            row.payment_mode !== 'advance' ||
            row.payer_id !== payer ||
            String(row.businessDate) < start ||
            String(row.businessDate) > end
          )
            throw new BadRequestException();
        }
        const [statement] =
          await tx`INSERT INTO studio_os.expense_settlements(payer_id,start_date,end_date,note,request_key,request_hash,created_by) VALUES(${payer},${start}::date,${end}::date,${note},${key},${requestHash},${identity.id}) RETURNING id,version`;
        for (const item of items) {
          await tx`INSERT INTO studio_os.expense_settlement_items(settlement_id,expense_id,amount_cents) SELECT ${statement.id},id,amount_cents FROM studio_os.expense_records WHERE id=${item.id}`;
          await tx`UPDATE studio_os.expense_records SET version=version+1,updated_at=now() WHERE id=${item.id}`;
        }
        await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('settlement',${statement.id},${identity.id},'confirmed',${JSON.stringify({ payer, start, end, note, items })}::jsonb)`;
        return statement;
      });
    } catch (e) {
      conflict(e);
    }
  }
  async pay(identity: Identity, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, [
        'settlementId',
        'amount',
        'paidDate',
        'note',
        'expectedVersion',
        'requestKey',
      ]),
      id = uuid(b.settlementId),
      cents = amount(b.amount),
      date = day(b.paidDate),
      note = optional(b.note),
      v = version(b.expectedVersion),
      key = uuid(b.requestKey),
      requestHash = hash({ actor: identity.id, id, cents, date, note });
    try {
      return await this.db.client.begin(async (tx) => {
        await actor(tx, identity);
        await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const [old] =
          await tx`SELECT p.id,p.request_hash,s.version FROM studio_os.expense_reimbursements p JOIN studio_os.expense_settlements s ON s.id=p.settlement_id WHERE p.request_key=${key}`;
        if (old) {
          if (old.request_hash !== requestHash) throw new ConflictException();
          return { id: old.id, version: old.version };
        }
        const [statement] =
          await tx`SELECT id,payer_id,version FROM studio_os.expense_settlements WHERE id=${id} FOR UPDATE`;
        if (!statement) throw new NotFoundException();
        if (statement.version !== v) throw new ConflictException();
        const [totals] =
          await tx`SELECT (SELECT coalesce(sum(amount_cents),0)::text FROM studio_os.expense_settlement_items WHERE settlement_id=${id}) AS total,(SELECT coalesce(sum(amount_cents),0)::text FROM studio_os.expense_reimbursements WHERE settlement_id=${id}) AS paid`;
        if (BigInt(cents) > BigInt(totals.total) - BigInt(totals.paid))
          throw new ConflictException();
        const [payment] =
          await tx`INSERT INTO studio_os.expense_reimbursements(settlement_id,payer_id,amount_cents,paid_date,note,request_key,request_hash,created_by) VALUES(${id},${statement.payer_id},${cents},${date}::date,${note},${key},${requestHash},${identity.id}) RETURNING id`;
        const [updated] =
          await tx`UPDATE studio_os.expense_settlements SET version=version+1 WHERE id=${id} RETURNING version`;
        await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('payment',${payment.id},${identity.id},'recorded',${JSON.stringify({ settlementId: id, payerId: statement.payer_id, cents, date, note })}::jsonb)`;
        return { ...payment, version: updated.version };
      });
    } catch (e) {
      conflict(e);
    }
  }
  async upload(
    identity: Identity,
    id: string,
    bytes: unknown,
    name: unknown,
    mime: unknown,
    expected: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    if (typeof expected !== 'string' || !/^\d{1,10}$/.test(expected))
      throw new BadRequestException();
    const v = version(Number(expected)),
      file = mediaFile(bytes, name, mime, 10485760);
    if (!file.mime.startsWith('image/')) throw new BadRequestException();
    return this.db.client.begin(async (tx) => {
      await actor(tx, identity);
      await mutableExpense(tx, id, v);
      const [total] =
        await tx`SELECT count(*)::int AS n,coalesce(sum(octet_length(content)),0)::int AS size FROM studio_os.expense_receipts WHERE expense_id=${id}`;
      if (total.n >= 20 || total.size + file.content.length > 104857600)
        throw new ConflictException();
      const [saved] =
        await tx`INSERT INTO studio_os.expense_receipts(expense_id,name,mime,content) VALUES(${id},${file.name},${file.mime},${file.content}) RETURNING id`;
      const [updated] =
        await tx`UPDATE studio_os.expense_records SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
      await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('receipt',${saved.id},${identity.id},'uploaded',${JSON.stringify({ expenseId: id, name: file.name, mime: file.mime, size: file.content.length })}::jsonb)`;
      return { ...saved, version: updated.version };
    });
  }
  async file(identity: Identity, id: string, receiptId: string) {
    requireAdministrator(identity);
    uuid(id);
    uuid(receiptId);
    const [file] = await this.db.client<
      { name: string; mime: string; content: Buffer }[]
    >`SELECT name,mime,content FROM studio_os.expense_receipts WHERE expense_id=${id} AND id=${receiptId}`;
    if (!file) throw new NotFoundException();
    return file;
  }
  async removeFile(
    identity: Identity,
    id: string,
    receiptId: string,
    value: unknown,
  ) {
    requireAdministrator(identity);
    uuid(id);
    uuid(receiptId);
    const b = objectInput(value, ['expectedVersion']),
      v = version(b.expectedVersion);
    return this.db.client.begin(async (tx) => {
      await actor(tx, identity);
      await mutableExpense(tx, id, v);
      const [file] =
        await tx`DELETE FROM studio_os.expense_receipts WHERE expense_id=${id} AND id=${receiptId} RETURNING id,name,mime,octet_length(content) AS size`;
      if (!file) throw new NotFoundException();
      const [updated] =
        await tx`UPDATE studio_os.expense_records SET version=version+1,updated_at=now() WHERE id=${id} RETURNING version`;
      await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('receipt',${receiptId},${identity.id},'deleted',${JSON.stringify({ expenseId: id, ...file })}::jsonb)`;
      return { ok: true, version: updated.version };
    });
  }
  async audit(identity: Identity, id: string) {
    requireAdministrator(identity);
    uuid(id);
    return this.db
      .client`SELECT e.id,e.entity_type AS "entityType",e.action,e.detail,e.created_at AS "createdAt",coalesce(m.display_name,a.username,'已停用账号') AS actor FROM studio_os.expense_events e LEFT JOIN studio_os.accounts a ON a.id=e.actor_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE e.entity_id=${id} OR e.detail->>'expenseId'=${id} OR e.detail->>'settlementId'=${id} ORDER BY e.created_at DESC,e.id`;
  }
  async csv(identity: Identity, value: unknown) {
    requireAdministrator(identity);
    const q = objectInput(value, [
        'month',
        'payerId',
        'storeId',
        'categoryId',
        'paymentMode',
        'search',
      ]),
      month =
        q.month === undefined || q.month === '' ? null : shortText(q.month, 7);
    if (month) {
      if (!/^\d{4}-\d\d$/.test(month)) throw new BadRequestException();
      day(month + '-01');
    }
    const search =
      q.search === undefined || q.search === ''
        ? ''
        : shortText(q.search, 200).toLowerCase();
    const payer = optionalId(q.payerId),
      store = q.storeId === 'public' ? null : optionalId(q.storeId),
      category = optionalId(q.categoryId),
      mode =
        q.paymentMode === undefined || q.paymentMode === ''
          ? null
          : q.paymentMode;
    if (mode !== null && mode !== 'company' && mode !== 'advance')
      throw new BadRequestException();
    const rows = (await this.list(identity)).records.filter(
      (r) =>
        (!month || String(r.expenseDate).startsWith(month)) &&
        (!payer || r.payerId === payer) &&
        (q.storeId === 'public'
          ? r.storeId === null
          : !store || r.storeId === store) &&
        (!category || r.categoryId === category) &&
        (!mode || r.paymentMode === mode) &&
        (!search ||
          [r.description, r.note, r.payerName, r.storeName, r.categoryName]
            .join(' ')
            .toLowerCase()
            .includes(search)),
    );
    if (rows.length > 10000) throw new BadRequestException('请缩小导出范围');
    const cell = (v: unknown) => {
      let t = String(v ?? '');
      if (/^\s*[=+\-@]/.test(t)) t = "'" + t;
      return '"' + t.replaceAll('"', '""') + '"';
    };
    const yuan = (n: number) =>
      Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
    return (
      '\ufeff' +
      [
        [
          '费用日期',
          '费用说明',
          '金额（元）',
          '支付方式',
          '垫付人员',
          '店铺',
          '分类',
          '结算状态',
          '备注',
        ],
        ...rows.map((r) => [
          r.expenseDate,
          r.description,
          yuan(r.amountCents),
          r.paymentMode === 'advance' ? '员工垫付' : '公司支付',
          r.payerName || '',
          r.storeName || '公共',
          r.categoryName || '未分类',
          r.settlementId
            ? '已结算'
            : r.paymentMode === 'company'
              ? '公司支付'
              : '未结算',
          r.note,
        ]),
      ]
        .map((row) => row.map(cell).join(','))
        .join('\r\n')
    );
  }
}
