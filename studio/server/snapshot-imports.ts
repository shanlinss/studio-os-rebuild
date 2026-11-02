import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { StudioDatabase } from './database';
import type { Identity } from './auth';
import { objectInput, uuid } from './validation';
import { timestamp } from './workflow';
const metricKeys = [
  'views',
  'likes',
  'favorites',
  'comments',
  'productClicks',
  'addToCart',
  'conversions',
] as const;
type Metric = (typeof metricKeys)[number];
type Row = { noteId: string } & Record<Metric, number | null>;
type Candidate = { id: string; taskId: string; url: string; already: boolean };
function noteId(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)xiaohongshu\.com$/i.test(u.hostname))
      return '';
    return (
      u.pathname
        .match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})(?:\/|$)/i)?.[1]
        .toLowerCase() || ''
    );
  } catch {
    return '';
  }
}
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function input(value: unknown, commit: boolean) {
  const b = objectInput(
    value,
    commit
      ? ['observedAt', 'rows', 'requestKey', 'previewToken']
      : ['observedAt', 'rows'],
  );
  const observedAt = timestamp(b.observedAt);
  if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 200)
    throw new BadRequestException();
  const rows: Row[] = b.rows.map((value) => {
    const r = objectInput(value, ['noteId', ...metricKeys]);
    if (typeof r.noteId !== 'string' || r.noteId.length > 100)
      throw new BadRequestException();
    const row = { noteId: r.noteId.trim().toLowerCase() } as Row;
    for (const key of metricKeys) {
      const n = r[key];
      if (
        n !== null &&
        n !== undefined &&
        (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 2147483647)
      )
        throw new BadRequestException();
      row[key] = n === undefined || n === null ? null : Number(n);
    }
    return row;
  });
  return {
    observedAt,
    rows,
    requestKey: commit ? uuid(b.requestKey) : '',
    previewToken: commit ? String(b.previewToken) : '',
  };
}
function preview(rows: Row[], candidates: Candidate[]) {
  const entries = rows.map((row, i) => {
    const matches = candidates.filter((c) => noteId(c.url) === row.noteId);
    const status =
      !/^[a-f0-9]{24}$/.test(row.noteId) ||
      metricKeys.every((k) => row[k] === null)
        ? 'invalid'
        : rows.filter((r) => r.noteId === row.noteId).length > 1
          ? 'duplicate'
          : matches.length > 1
            ? 'ambiguous'
            : !matches.length
              ? 'unmatched'
              : matches[0].already
                ? 'existing'
                : 'matched';
    return {
      row: i + 2,
      noteId: row.noteId,
      status,
      publicationId: status === 'matched' ? matches[0].id : null,
      metrics: Object.fromEntries(metricKeys.map((k) => [k, row[k]])),
    };
  });
  return {
    total: entries.length,
    matched: entries.filter((r) => r.status === 'matched').length,
    entries,
  };
}
export class SnapshotImports {
  constructor(private readonly db: StudioDatabase) {}
  private async scope(
    tx: TransactionSql,
    identity: Identity,
    experimentId: string,
    planId: string,
    observedAt: string,
  ) {
    const [plan] =
      await tx`SELECT p.id,e.status FROM studio_os.plans p JOIN studio_os.lab_experiments e ON e.id=p.experiment_id WHERE p.id=${planId} AND e.id=${experimentId} AND (${identity.role === 'admin'} OR EXISTS(SELECT 1 FROM studio_os.tasks t JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.plan_id=p.id AND m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) FOR SHARE OF p,e`;
    if (!plan) throw new NotFoundException();
    // Locks preserve the exact current membership and owner while a batch commits.
    const tasks =
      await tx`SELECT t.id FROM studio_os.tasks t JOIN studio_os.members m ON m.id=t.member_id JOIN studio_os.business_accounts a ON a.id=t.account_id WHERE t.plan_id=${planId} AND (${identity.role === 'admin'} OR(m.login_account_id=${identity.id} AND m.active AND a.active AND a.responsible_member_id=m.id)) ORDER BY t.id FOR SHARE OF t,m,a`;
    const ids = tasks.map((t) => t.id);
    const candidates = ids.length
      ? await tx<
          Candidate[]
        >`SELECT n.id,n.task_id AS "taskId",n.url,EXISTS(SELECT 1 FROM studio_os.data_snapshots s WHERE s.publication_id=n.id AND s.observed_at=${observedAt}) AS already FROM studio_os.publications n WHERE n.task_id IN ${tx(ids)} ORDER BY n.id FOR SHARE OF n`
      : [];
    return { plan, candidates };
  }
  async preview(
    identity: Identity,
    experimentId: string,
    planId: string,
    value: unknown,
  ) {
    uuid(experimentId);
    uuid(planId);
    const b = input(value, false);
    return this.db.client.begin(async (tx) => {
      const { plan, candidates } = await this.scope(
        tx,
        identity,
        experimentId,
        planId,
        b.observedAt,
      );
      if (plan.status === 'concluded') throw new ConflictException();
      const result = preview(b.rows, candidates);
      return {
        ...result,
        previewToken: digest([identity.id, planId, b.observedAt, result]),
      };
    });
  }
  async commit(
    identity: Identity,
    experimentId: string,
    planId: string,
    value: unknown,
  ) {
    uuid(experimentId);
    uuid(planId);
    const b = input(value, true);
    if (!/^[a-f0-9]{64}$/.test(b.previewToken)) throw new BadRequestException();
    const hash = digest([planId, b.observedAt, b.rows, b.previewToken]);
    try {
      return await this.db.client.begin(async (tx) => {
        const { plan, candidates } = await this.scope(
          tx,
          identity,
          experimentId,
          planId,
          b.observedAt,
        );
        await tx`INSERT INTO studio_os.snapshot_imports(plan_id,actor_id,request_key,request_hash,result) VALUES(${planId},${identity.id},${b.requestKey},${hash},'{}') ON CONFLICT(actor_id,request_key) DO NOTHING`;
        const [previous] =
          await tx`SELECT id,request_hash,result FROM studio_os.snapshot_imports WHERE actor_id=${identity.id} AND request_key=${b.requestKey} FOR UPDATE`;
        if (previous.request_hash !== hash) throw new ConflictException();
        if (previous.result.imported !== undefined) {
          if (
            previous.result.entries.some(
              (entry: { publicationId: string | null }) =>
                entry.publicationId &&
                !candidates.some(
                  (candidate) => candidate.id === entry.publicationId,
                ),
            )
          )
            throw new NotFoundException();
          return previous.result;
        }
        if (plan.status === 'concluded') throw new ConflictException();
        const result = preview(b.rows, candidates);
        if (
          !result.matched ||
          digest([identity.id, planId, b.observedAt, result]) !== b.previewToken
        )
          throw new ConflictException();
        const snapshotIds = [];
        for (const entry of result.entries.filter(
          (e) => e.status === 'matched',
        )) {
          const r = b.rows[entry.row - 2];
          const [s] =
            await tx`INSERT INTO studio_os.data_snapshots(publication_id,observed_at,views,likes,favorites,comments,product_clicks,add_to_cart,conversions,created_by) VALUES(${entry.publicationId},${b.observedAt},${r.views},${r.likes},${r.favorites},${r.comments},${r.productClicks},${r.addToCart},${r.conversions},${identity.id}) RETURNING id`;
          await tx`INSERT INTO studio_os.workflow_events(plan_id,actor_id,action,reference_id) VALUES(${planId},${identity.id},'snapshot',${s.id})`;
          snapshotIds.push(s.id);
        }
        const complete = {
          ...result,
          imported: snapshotIds.length,
          snapshotIds,
        };
        await tx`UPDATE studio_os.snapshot_imports SET result=${JSON.stringify(complete)}::jsonb WHERE id=${previous.id}`;
        return complete;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
}
