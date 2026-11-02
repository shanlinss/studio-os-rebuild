// Uses the existing template-task model; product ownership remains on the plan.
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import type { Identity } from './auth';
import { objectInput, uuid, version, optionalLongText } from './validation';
export type ProductTemplateAssignment = {
  templateId: string;
  accountId: string;
  expectedVersion: number;
  targetCount: number;
  requirements?: string;
};
export function productTemplateInput(
  value: unknown,
): ProductTemplateAssignment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new BadRequestException();
  const rows = value
    .map((value) => {
      const r = objectInput(value, [
        'templateId',
        'accountId',
        'expectedVersion',
        'targetCount',
        'requirements',
      ]);
      if (
        !Number.isInteger(r.targetCount) ||
        Number(r.targetCount) < 1 ||
        Number(r.targetCount) > 2147483647
      )
        throw new BadRequestException();
      return {
        templateId: uuid(r.templateId),
        accountId: uuid(r.accountId),
        expectedVersion: version(r.expectedVersion),
        targetCount: Number(r.targetCount),
        ...(r.requirements !== undefined
          ? { requirements: optionalLongText(r.requirements, 2000) }
          : {}),
      };
    })
    .sort((a, b) =>
      (a.templateId + a.accountId).localeCompare(b.templateId + b.accountId),
    );
  if (new Set(rows.map((r) => r.templateId + r.accountId)).size !== rows.length)
    throw new BadRequestException();
  return rows;
}
export type ExistingTemplateTask = {
  id: string;
  template_id: string | null;
  account_id: string;
  member_id: string;
  template_material_id: string | null;
  template_version: number | null;
  target_count: number;
  instructions?: string;
  published: number;
};
export async function productTemplateSources(
  tx: TransactionSql,
  rows: ProductTemplateAssignment[],
  existing: ExistingTemplateTask[] = [],
) {
  const result = new Map<
    string,
    { member: string; source: string | null; version: number }
  >();
  for (const row of rows) {
    const old = existing.find(
      (t) => t.template_id === row.templateId && t.account_id === row.accountId,
    );
    const [template] =
      await tx`SELECT version,archived,source_material_id FROM studio_os.note_templates WHERE id=${row.templateId} FOR SHARE`;
    if (
      !template ||
      template.version !== row.expectedVersion ||
      (template.archived && !old)
    )
      throw new ConflictException();
    const [owner] =
      await tx`SELECT m.id FROM studio_os.business_accounts a JOIN studio_os.members m ON m.id=a.responsible_member_id JOIN studio_os.accounts l ON l.id=m.login_account_id WHERE a.id=${row.accountId} AND a.active AND m.active AND l.active FOR SHARE OF a,m,l`;
    if (!owner) throw new BadRequestException();
    if (
      template.archived &&
      old &&
      (row.targetCount > old.target_count || old.member_id !== owner.id)
    )
      throw new ConflictException();
    if (
      old?.published &&
      (old.member_id !== owner.id || row.targetCount < old.published)
    )
      throw new ConflictException();
    result.set(row.templateId + row.accountId, {
      member: owner.id,
      source: old ? old.template_material_id : template.source_material_id,
      version: old ? Number(old.template_version) : template.version,
    });
  }
  for (const old of existing.filter((t) => t.template_id))
    if (
      old.published &&
      !rows.some(
        (r) =>
          r.templateId === old.template_id && r.accountId === old.account_id,
      )
    )
      throw new ConflictException();
  return result;
}
export async function syncProductTemplateTasks(
  tx: TransactionSql,
  identity: Identity,
  planId: string,
  rows: ProductTemplateAssignment[],
  sources: Awaited<ReturnType<typeof productTemplateSources>>,
  existing: ExistingTemplateTask[] = [],
) {
  for (const old of existing.filter((t) => t.template_id))
    if (
      !rows.some(
        (r) =>
          r.templateId === old.template_id && r.accountId === old.account_id,
      )
    ) {
      await tx`DELETE FROM studio_os.tasks WHERE id=${old.id}`;
      await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${old.template_id!},${identity.id},'assignment_cancelled',${JSON.stringify({ planId, taskId: old.id, source: 'product' })}::jsonb)`;
    }
  const materials = new Set<string>();
  for (const row of rows) {
    const source = sources.get(row.templateId + row.accountId)!,
      old = existing.find(
        (t) =>
          t.template_id === row.templateId && t.account_id === row.accountId,
      );
    let id = old?.id;
    if (old)
      await tx`UPDATE studio_os.tasks SET member_id=${source.member},target_count=${row.targetCount},instructions=${row.requirements ?? old.instructions ?? ''} WHERE id=${old.id}`;
    else {
      const [task] =
        await tx`INSERT INTO studio_os.tasks(plan_id,member_id,account_id,target_count,template_id,template_material_id,template_version,instructions) VALUES(${planId},${source.member},${row.accountId},${row.targetCount},${row.templateId},${source.source},${source.version},${row.requirements ?? ''}) RETURNING id`;
      id = task.id;
    }
    if (source.source) materials.add(source.source);
    await tx`INSERT INTO studio_os.template_events(template_id,actor_id,action,detail) VALUES(${row.templateId},${identity.id},${old ? 'plan_updated' : 'assigned'},${JSON.stringify({ planId, taskId: id, targetCount: row.targetCount, requirements: row.requirements ?? old?.instructions ?? '', source: 'product' })}::jsonb)`;
  }
  return materials;
}
