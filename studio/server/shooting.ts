// Selective ShootingPanel@d9a63d2 restoration. Team scope was explicitly confirmed
// by the user; personal workbench assignment is not a shared-request read boundary.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { requireAdministrator } from './access';
import { uuid, objectInput, shortText, longText, version } from './validation';
import { timestamp } from './workflow';
import { Products } from './products';
import { mediaFile } from './media';
type Row = {
  id: string;
  version: number;
  title: string;
  product_id: string | null;
  product_description: string;
  assignee_id: string | null;
  created_by: string | null;
  due_on: string;
  status: string;
  summary: string;
  feedback: string;
  nas_path: string;
  archived: boolean;
};
type Item = {
  id: string | null;
  title: string;
  kind: string;
  priority: string;
  materialId: string | null;
  references: string[];
  requirements: string[];
};
const optional = (v: unknown, max = 2000) =>
  v === undefined || v === null || v === '' ? '' : longText(v, max);
function lines(v: unknown) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20) throw new BadRequestException();
  return v.map((x) => shortText(x, 200));
}
const rootMeta = (r: Row) => ({
  title: r.title,
  productId: r.product_id,
  productDescription: r.product_description,
  assigneeId: r.assignee_id,
  dueOn: r.due_on,
  status: r.status,
  summary: r.summary,
  feedback: r.feedback,
  nasPath: r.nas_path,
  archived: r.archived,
  version: r.version,
});
export class Shooting {
  constructor(private readonly db: StudioDatabase) {}
  async authorize(
    identity: Identity,
    sql: StudioDatabase['client'] | TransactionSql = this.db.client,
    lock = false,
  ) {
    if (!identity) throw new UnauthorizedException();
    if (!['admin', 'employee'].includes(identity.role))
      throw new ForbiddenException();
    const [account] = lock
      ? await sql`SELECT role,active FROM studio_os.accounts WHERE id=${identity.id} FOR SHARE`
      : await sql`SELECT role,active FROM studio_os.accounts WHERE id=${identity.id}`;
    if (!account?.active) throw new UnauthorizedException();
    if (account.role !== identity.role) throw new ForbiddenException();
    const [member] =
      lock && identity.role === 'employee'
        ? await sql`SELECT id,display_name,active FROM studio_os.members WHERE login_account_id=${identity.id} FOR SHARE`
        : await sql`SELECT id,display_name,active FROM studio_os.members WHERE login_account_id=${identity.id}`;
    if (identity.role === 'employee' && !member?.active)
      throw new ForbiddenException();
    return (
      member?.display_name ||
      (identity.role === 'admin' ? '管理员' : '团队成员')
    );
  }
  async assignees(identity: Identity) {
    await this.authorize(identity);
    return this.db
      .client`SELECT m.id,m.display_name AS "displayName" FROM studio_os.members m JOIN studio_os.accounts a ON a.id=m.login_account_id WHERE m.active AND a.active ORDER BY m.display_name,m.id`;
  }
  async read(identity: Identity, id?: string) {
    if (id) uuid(id);
    return this.db.client.begin(
      'isolation level repeatable read, read only',
      async (tx) => {
        await this.authorize(identity, tx);
        const roots =
          await tx`SELECT r.id,r.title,r.product_id AS "productId",r.product_description AS "productDescription",p.name AS "productName",r.assignee_id AS "assigneeId",coalesce(m.login_account_id=${identity.id},false) AS "assignedToMe",m.display_name AS "assigneeName",coalesce(m.active AND a.active,false) AS "assigneeActive",coalesce(c.display_name,CASE WHEN creator.role='admin' THEN '管理员' WHEN creator.id IS NULL THEN '历史成员' ELSE '团队成员' END) AS "creatorName",r.due_on::text AS "dueOn",r.status,r.summary,r.feedback,r.nas_path AS "nasPath",r.archived,r.version,r.created_at AS "createdAt",r.last_completed_at AS "lastCompletedAt",q.id AS "planId",t.id AS "taskId"
        FROM studio_os.shooting_requests r LEFT JOIN studio_os.products p ON p.id=r.product_id LEFT JOIN studio_os.members m ON m.id=r.assignee_id LEFT JOIN studio_os.accounts a ON a.id=m.login_account_id LEFT JOIN studio_os.members c ON c.login_account_id=r.created_by LEFT JOIN studio_os.accounts creator ON creator.id=r.created_by LEFT JOIN studio_os.plans q ON q.shooting_request_id=r.id LEFT JOIN studio_os.tasks t ON t.plan_id=q.id AND t.kind='shooting' WHERE ${id === undefined} OR r.id=${id ?? null} ORDER BY r.created_at DESC,r.id`;
        if (id && !roots.length) throw new NotFoundException();
        const ids = roots.map((r) => r.id);
        const items =
          await tx`SELECT i.id,i.request_id AS "requestId",i.position,i.title,i.kind,i.priority,i.material_id AS "materialId",m.title AS "materialTitle",m.source_url AS "materialUrl",(SELECT a.id FROM studio_os.material_assets a WHERE a.material_id=m.id AND a.mime LIKE 'image/%' ORDER BY a.created_at,a.id LIMIT 1) AS "materialCoverId",i.references_text AS references,i.requirements,i.completed,i.archived FROM studio_os.shooting_items i LEFT JOIN studio_os.materials m ON m.id=i.material_id WHERE i.request_id=ANY(${tx.array(ids, 2950)}) ORDER BY i.position,i.id`;
        const assets =
          await tx`SELECT id,request_id AS "requestId",item_id AS "itemId",kind,name,mime,note,removed,octet_length(content) AS size FROM studio_os.shooting_assets WHERE request_id=ANY(${tx.array(ids, 2950)}) ORDER BY created_at,id`;
        return roots.map((r) => ({
          ...r,
          items: items.filter((i) => i.requestId === r.id),
          assets: assets.filter((a) => a.requestId === r.id),
        }));
      },
    );
  }
  async detail(identity: Identity, id: string) {
    return (await this.read(identity, id))[0];
  }
  async history(identity: Identity, id: string, before?: unknown) {
    uuid(id);
    await this.authorize(identity);
    if (
      !(
        await this.db
          .client`SELECT id FROM studio_os.shooting_requests WHERE id=${id}`
      ).length
    )
      throw new NotFoundException();
    const cursor =
      before === undefined
        ? 2147483647
        : typeof before === 'string' && /^[1-9]\d{0,9}$/.test(before)
          ? Number(before)
          : NaN;
    if (!Number.isInteger(cursor) || cursor > 2147483647)
      throw new BadRequestException();
    const rows = await this.db
      .client`SELECT id,revision,actor_name AS "actorName",action,detail-'itemsBefore'-'itemsAfter' AS detail,created_at AS "createdAt" FROM studio_os.shooting_events WHERE request_id=${id} AND revision<${cursor} ORDER BY revision DESC LIMIT 51`;
    const items = rows.slice(0, 50);
    return {
      items,
      next: rows.length > 50 ? String(items.at(-1)!.revision) : null,
    };
  }
  async event(identity: Identity, id: string, eventId: string) {
    uuid(id);
    uuid(eventId);
    await this.authorize(identity);
    const [event] = await this.db
      .client`SELECT e.id,e.revision,e.action,e.actor_name AS "actorName",e.detail,e.created_at AS "createdAt" FROM studio_os.shooting_events e JOIN studio_os.shooting_requests r ON r.id=e.request_id WHERE e.request_id=${id} AND e.id=${eventId}`;
    if (!event) throw new NotFoundException();
    return event;
  }
  private async mutate(
    identity: Identity,
    id: string | undefined,
    key: unknown,
    hashBody: unknown,
    expected: unknown,
    action: string,
    apply: (
      tx: TransactionSql,
      row: Row | undefined,
    ) => Promise<{
      id: string;
      extra?: Record<string, unknown>;
      deleted?: boolean;
    }>,
  ) {
    const requestKey = uuid(key);
    if (id) uuid(id);
    const hash = createHash('sha256')
      .update(JSON.stringify([id ?? null, action, hashBody]))
      .digest('hex');
    return this.db.client.begin(async (tx) => {
      const actorName = await this.authorize(identity, tx, true);
      await tx`INSERT INTO studio_os.shooting_mutations(actor_id,request_key,request_id,request_hash) VALUES(${identity.id},${requestKey},${id ?? null},${hash}) ON CONFLICT(actor_id,request_key) DO NOTHING`;
      const [prior] =
        await tx`SELECT request_hash,result FROM studio_os.shooting_mutations WHERE actor_id=${identity.id} AND request_key=${requestKey} FOR UPDATE`;
      if (prior.request_hash !== hash) throw new ConflictException();
      if (prior.result) return prior.result;
      const [row] = id
        ? await tx<
            Row[]
          >`SELECT *,due_on::text AS due_on FROM studio_os.shooting_requests WHERE id=${id} FOR UPDATE`
        : [];
      if (id && !row) throw new NotFoundException();
      if (row && row.version !== version(expected))
        throw new ConflictException();
      const change = await apply(tx, row);
      const [after] = change.deleted
        ? []
        : id
          ? await tx<
              Row[]
            >`UPDATE studio_os.shooting_requests SET version=version+1,updated_at=now() WHERE id=${id} RETURNING *,due_on::text AS due_on`
          : await tx<
              Row[]
            >`SELECT *,due_on::text AS due_on FROM studio_os.shooting_requests WHERE id=${change.id}`;
      const assignedNames =
        await tx`SELECT id,display_name FROM studio_os.members WHERE id=ANY(${tx.array(
          [row?.assignee_id, after?.assignee_id].filter(
            (v): v is string => !!v,
          ),
          2950,
        )})`;
      const beforeAssignee =
        assignedNames.find((m) => m.id === row?.assignee_id)?.display_name ||
        '未派发';
      const afterAssignee =
        assignedNames.find((m) => m.id === after?.assignee_id)?.display_name ||
        '未派发';
      const revision = after?.version ?? row!.version + 1;
      await tx`INSERT INTO studio_os.shooting_events(request_id,actor_id,actor_name,action,revision,detail) VALUES(${change.id},${identity.id},${actorName},${action},${revision},${JSON.stringify(
        {
          before: row ? rootMeta(row) : null,
          after: after ? rootMeta(after) : null,
          beforeAssignee,
          afterAssignee,
          ...change.extra,
        },
      )}::jsonb)`;
      const result = {
        id: change.id,
        version: revision,
        ...(change.extra?.assetId ? { assetId: change.extra.assetId } : {}),
        ...(change.extra?.itemIds ? { itemIds: change.extra.itemIds } : {}),
      };
      await tx`UPDATE studio_os.shooting_mutations SET request_id=${change.id},result=${JSON.stringify(result)}::jsonb WHERE actor_id=${identity.id} AND request_key=${requestKey}`;
      return result;
    });
  }
  private writable(row: Row) {
    if (row.archived || row.status === '已完成') throw new ConflictException();
  }
  private async sync(tx: TransactionSql, id: string) {
    const [r] = await tx<
      Row[]
    >`SELECT *,due_on::text AS due_on FROM studio_os.shooting_requests WHERE id=${id}`;
    let [plan] =
      await tx`SELECT id FROM studio_os.plans WHERE shooting_request_id=${id}`;
    if (!plan)
      [plan] =
        await tx`INSERT INTO studio_os.plans(title,request_key,request_hash,source_type,shooting_request_id,requirements,planned_publish_on,created_by) VALUES(${r.title},${randomUUID()},${createHash('sha256').update(id).digest('hex')},'shooting',${id},${r.summary},${r.due_on},${r.created_by}) RETURNING id`;
    else
      await tx`UPDATE studio_os.plans SET title=${r.title},requirements=${r.summary},planned_publish_on=${r.due_on},version=version+1 WHERE id=${plan.id}`;
    if (r.assignee_id) {
      const [n] =
        await tx`SELECT count(*)::int AS n FROM studio_os.shooting_items WHERE request_id=${id} AND NOT archived`;
      await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count,kind) VALUES(${plan.id},${r.assignee_id},NULL,${n.n},'shooting') ON CONFLICT(plan_id) WHERE kind='shooting' DO UPDATE SET member_id=excluded.member_id,target_count=excluded.target_count`;
    }
  }
  async save(identity: Identity, value: unknown, id?: string) {
    const b = objectInput(value, [
      'requestKey',
      'title',
      'productId',
      'productDescription',
      'assigneeId',
      'dueOn',
      'summary',
      'items',
      ...(id ? ['expectedVersion'] : []),
    ]);
    const title = shortText(b.title, 200),
      productId = b.productId ? uuid(b.productId) : null,
      assigneeId = b.assigneeId ? uuid(b.assigneeId) : null,
      description = optional(b.productDescription, 200),
      summary = optional(b.summary);
    const due =
      typeof b.dueOn === 'string' && /^\d{4}-\d\d-\d\d$/.test(b.dueOn)
        ? b.dueOn
        : '';
    if (!due) throw new BadRequestException();
    timestamp(due + 'T00:00:00+08:00');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50)
      throw new BadRequestException();
    const items: Item[] = b.items.map((v) => {
      const i = objectInput(v, [
        'id',
        'title',
        'kind',
        'priority',
        'materialId',
        'references',
        'requirements',
      ]);
      if (
        !['图片', '视频'].includes(String(i.kind)) ||
        !['S', 'A', 'B', 'C'].includes(String(i.priority))
      )
        throw new BadRequestException();
      return {
        id: i.id ? uuid(i.id) : null,
        title: shortText(i.title, 200),
        kind: String(i.kind),
        priority: String(i.priority),
        materialId: i.materialId ? uuid(i.materialId) : null,
        references: lines(i.references),
        requirements: lines(i.requirements),
      };
    });
    const existing = items.flatMap((i) => (i.id ? [i.id] : []));
    if (new Set(existing).size !== existing.length || (!id && existing.length))
      throw new BadRequestException();
    const normalized = {
      title,
      productId,
      description,
      assigneeId,
      due,
      summary,
      items,
      expectedVersion: b.expectedVersion ?? null,
    };
    return this.mutate(
      identity,
      id,
      b.requestKey,
      normalized,
      b.expectedVersion,
      id ? 'updated' : 'created',
      async (tx, row) => {
        if (row) this.writable(row);
        if (
          productId &&
          productId !== row?.product_id &&
          !(await new Products(this.db).list(identity)).some(
            (p) => p.id === productId,
          )
        )
          throw new NotFoundException();
        if (assigneeId) {
          const [m] =
            await tx`SELECT m.active,a.active AS login_active FROM studio_os.members m JOIN studio_os.accounts a ON a.id=m.login_account_id WHERE m.id=${assigneeId} FOR SHARE OF m,a`;
          if (
            !m ||
            (!(m.active && m.login_active) && assigneeId !== row?.assignee_id)
          )
            throw new BadRequestException();
        }
        const [root] = row
          ? await tx`UPDATE studio_os.shooting_requests SET title=${title},product_id=${productId},product_description=${description},assignee_id=${assigneeId},due_on=${due},summary=${summary} WHERE id=${id!} RETURNING id`
          : await tx`INSERT INTO studio_os.shooting_requests(title,product_id,product_description,created_by,assignee_id,due_on,summary) VALUES(${title},${productId},${description},${identity.id},${assigneeId},${due},${summary}) RETURNING id`;
        const previous =
          await tx`SELECT * FROM studio_os.shooting_items WHERE request_id=${root.id} ORDER BY position,id`;
        if (existing.some((item) => !previous.some((old) => old.id === item)))
          throw new NotFoundException();
        for (const item of items)
          if (
            item.materialId &&
            !(
              await tx`SELECT id FROM studio_os.materials WHERE id=${item.materialId} FOR SHARE`
            ).length
          )
            throw new NotFoundException();
        await tx`UPDATE studio_os.shooting_items SET position=position+1000 WHERE request_id=${root.id} AND NOT archived`;
        for (const old of previous)
          if (!existing.includes(old.id))
            await tx`UPDATE studio_os.shooting_items SET archived=true,position=${old.position} WHERE id=${old.id}`;
        for (const [position, item] of items.entries()) {
          if (item.id)
            await tx`UPDATE studio_os.shooting_items SET title=${item.title},kind=${item.kind},priority=${item.priority},material_id=${item.materialId},references_text=${JSON.stringify(item.references)}::jsonb,requirements=${JSON.stringify(item.requirements)}::jsonb,position=${position},archived=false WHERE id=${item.id}`;
          else
            await tx`INSERT INTO studio_os.shooting_items(request_id,position,title,kind,priority,material_id,references_text,requirements) VALUES(${root.id},${position},${item.title},${item.kind},${item.priority},${item.materialId},${JSON.stringify(item.references)}::jsonb,${JSON.stringify(item.requirements)}::jsonb)`;
        }
        await this.sync(tx, root.id);
        return {
          id: root.id,
          extra: {
            itemsBefore: previous.filter((i) => !i.archived),
            itemsAfter: items,
            itemCount: items.length,
            itemIds: (
              await tx`SELECT id FROM studio_os.shooting_items WHERE request_id=${root.id} AND NOT archived ORDER BY position,id`
            ).map((i) => i.id),
          },
        };
      },
    );
  }
  async transition(identity: Identity, id: string, value: unknown) {
    const b = objectInput(value, [
      'requestKey',
      'expectedVersion',
      'action',
      'feedback',
      'nasPath',
    ]);
    if (
      !['start', 'deliver', 'reshoot', 'approve', 'reopen'].includes(
        String(b.action),
      )
    )
      throw new BadRequestException();
    if (b.action === 'reopen') requireAdministrator(identity);
    const feedback =
        b.feedback === undefined ? undefined : optional(b.feedback),
      nas = b.nasPath === undefined ? undefined : optional(b.nasPath),
      action = String(b.action);
    return this.mutate(
      identity,
      id,
      b.requestKey,
      {
        action,
        feedback: feedback ?? null,
        nasPath: nas ?? null,
        expectedVersion: version(b.expectedVersion),
      },
      b.expectedVersion,
      action,
      async (tx, row) => {
        const r = row!;
        if (r.archived) throw new ConflictException();
        const next =
          action === 'start' && ['待拍摄', '需补拍'].includes(r.status)
            ? '拍摄中'
            : action === 'deliver' && r.status === '拍摄中'
              ? '待确认'
              : action === 'reshoot' && r.status === '待确认'
                ? '需补拍'
                : action === 'approve' && r.status === '待确认'
                  ? '已完成'
                  : action === 'reopen' && r.status === '已完成'
                    ? '待拍摄'
                    : null;
        if (!next) throw new ConflictException();
        await tx`UPDATE studio_os.shooting_requests SET status=${next},feedback=${action === 'reshoot' && feedback !== undefined ? feedback : r.feedback},nas_path=${action === 'deliver' && nas !== undefined ? nas : r.nas_path},last_completed_at=CASE WHEN ${action === 'approve'} THEN now() ELSE last_completed_at END WHERE id=${id}`;
        return { id };
      },
    );
  }
  async item(identity: Identity, id: string, itemId: string, value: unknown) {
    uuid(itemId);
    const b = objectInput(value, [
      'requestKey',
      'expectedVersion',
      'completed',
    ]);
    if (typeof b.completed !== 'boolean') throw new BadRequestException();
    const completed = b.completed;
    return this.mutate(
      identity,
      id,
      b.requestKey,
      { itemId, completed, expectedVersion: version(b.expectedVersion) },
      b.expectedVersion,
      'item_progress',
      async (tx, row) => {
        this.writable(row!);
        const [before] =
          await tx`UPDATE studio_os.shooting_items SET completed=${completed} WHERE request_id=${id} AND id=${itemId} AND NOT archived RETURNING title,completed`;
        if (!before) throw new NotFoundException();
        return { id, extra: { itemId, ...before } };
      },
    );
  }
  async upload(
    identity: Identity,
    id: string,
    itemId: string | undefined,
    bytes: unknown,
    name: unknown,
    mime: unknown,
    expected: unknown,
    key: unknown,
    noteHeader: unknown,
  ) {
    if (itemId) uuid(itemId);
    const expectedVersion =
      typeof expected === 'string' && /^[1-9]\d{0,9}$/.test(expected)
        ? version(Number(expected))
        : version(expected);
    const file = mediaFile(bytes, name, mime);
    if (itemId && file.mime === 'video/mp4') throw new BadRequestException();
    let note = '';
    if (noteHeader !== undefined) {
      try {
        note = optional(decodeURIComponent(String(noteHeader)), 1000);
      } catch {
        throw new BadRequestException();
      }
    }
    const hash = createHash('sha256').update(file.content).digest('hex');
    return this.mutate(
      identity,
      id,
      key,
      {
        itemId: itemId ?? null,
        name: file.name,
        mime: file.mime,
        hash,
        note,
        expectedVersion,
      },
      expectedVersion,
      'file_added',
      async (tx, row) => {
        this.writable(row!);
        if (
          itemId &&
          !(
            await tx`SELECT id FROM studio_os.shooting_items WHERE id=${itemId} AND request_id=${id} AND NOT archived`
          ).length
        )
          throw new NotFoundException();
        const [usage] =
          await tx`SELECT count(*)::int AS n,coalesce(sum(octet_length(content)),0)::bigint AS bytes FROM studio_os.shooting_assets WHERE request_id=${id}`;
        if (
          usage.n >= 64 ||
          Number(usage.bytes) + file.content.length > 67108864
        )
          throw new PayloadTooLargeException();
        const [asset] =
          await tx`INSERT INTO studio_os.shooting_assets(request_id,item_id,kind,name,mime,content,note) VALUES(${id},${itemId ?? null},${itemId ? 'reference' : 'delivery'},${file.name},${file.mime},${file.content},${note}) RETURNING id`;
        return {
          id,
          extra: {
            assetId: asset.id,
            itemId: itemId ?? null,
            name: file.name,
            note,
          },
        };
      },
    );
  }
  async file(identity: Identity, id: string, assetId: string) {
    uuid(id);
    uuid(assetId);
    await this.authorize(identity);
    const [f] = await this.db
      .client`SELECT f.name,f.mime,f.content FROM studio_os.shooting_assets f JOIN studio_os.shooting_requests r ON r.id=f.request_id WHERE f.request_id=${id} AND f.id=${assetId}`;
    if (!f) throw new NotFoundException();
    return f;
  }
  async fileChange(
    identity: Identity,
    id: string,
    assetId: string,
    value: unknown,
    remove = false,
  ) {
    uuid(assetId);
    const b = objectInput(value, [
        'requestKey',
        'expectedVersion',
        ...(remove ? [] : ['note']),
      ]),
      note = remove ? '' : optional(b.note, 1000);
    return this.mutate(
      identity,
      id,
      b.requestKey,
      { assetId, note, expectedVersion: version(b.expectedVersion) },
      b.expectedVersion,
      remove ? 'file_removed' : 'file_note',
      async (tx, row) => {
        this.writable(row!);
        const [old] =
          await tx`SELECT name,note,removed FROM studio_os.shooting_assets WHERE id=${assetId} AND request_id=${id} FOR UPDATE`;
        if (!old) throw new NotFoundException();
        if (old.removed) throw new ConflictException();
        await tx`UPDATE studio_os.shooting_assets SET removed=${remove},note=${remove ? old.note : note} WHERE id=${assetId}`;
        return {
          id,
          extra: {
            assetId,
            name: old.name,
            beforeNote: old.note,
            note: remove ? old.note : note,
          },
        };
      },
    );
  }
  async archive(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, ['requestKey', 'expectedVersion', 'archived']);
    if (typeof b.archived !== 'boolean') throw new BadRequestException();
    const archived = b.archived;
    return this.mutate(
      identity,
      id,
      b.requestKey,
      { archived, expectedVersion: version(b.expectedVersion) },
      b.expectedVersion,
      archived ? 'archived' : 'restored',
      async (tx) => {
        await tx`UPDATE studio_os.shooting_requests SET archived=${archived} WHERE id=${id}`;
        return { id };
      },
    );
  }
  async remove(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity);
    const b = objectInput(value, ['requestKey', 'expectedVersion']);
    return this.mutate(
      identity,
      id,
      b.requestKey,
      { expectedVersion: version(b.expectedVersion) },
      b.expectedVersion,
      'deleted',
      async (tx, row) => {
        const [executed] =
          await tx`SELECT EXISTS(SELECT 1 FROM studio_os.shooting_events WHERE request_id=${id} AND action IN('start','deliver','reshoot','approve','reopen','item_progress')) OR EXISTS(SELECT 1 FROM studio_os.shooting_assets WHERE request_id=${id} AND kind='delivery') AS yes`;
        if (executed.yes || row!.status !== '待拍摄')
          throw new ConflictException();
        await tx`DELETE FROM studio_os.shooting_requests WHERE id=${id}`;
        return { id, deleted: true };
      },
    );
  }
}
