import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { StudioDatabase } from './database';
import {
  objectInput,
  shortText,
  uuid,
  version,
  httpsUrl,
  longText,
} from './validation';
export class BusinessAccounts {
  constructor(private readonly db: StudioDatabase) {}
  list() {
    return this.db
      .client`SELECT b.id, b.name, b.profile_url AS "profileUrl", b.bound_phone AS "boundPhone", b.actual_phone AS "actualPhone", b.remark, b.responsible_member_id AS "responsibleMemberId", b.active, b.version, m.display_name AS "responsibleName", m.active AS "memberActive" FROM studio_os.business_accounts b JOIN studio_os.members m ON m.id = b.responsible_member_id ORDER BY b.name,b.id`;
  }
  async save(value: unknown, actor: string, id?: string) {
    const body = objectInput(
      value,
      id
        ? [
            'name',
            'profileUrl',
            'responsibleMemberId',
            'active',
            'boundPhone',
            'actualPhone',
            'remark',
            'expectedVersion',
          ]
        : [
            'name',
            'profileUrl',
            'responsibleMemberId',
            'boundPhone',
            'actualPhone',
            'remark',
          ],
    );
    if (id) uuid(id);
    const expected = id ? version(body.expectedVersion) : undefined;
    if (body.active !== undefined && typeof body.active !== 'boolean')
      throw new BadRequestException();
    if (
      id &&
      ![
        'name',
        'profileUrl',
        'responsibleMemberId',
        'active',
        'boundPhone',
        'actualPhone',
        'remark',
      ].some((k) => body[k] !== undefined)
    )
      throw new BadRequestException();
    const name =
      !id || body.name !== undefined ? shortText(body.name) : undefined;
    const owner =
      !id || body.responsibleMemberId !== undefined
        ? uuid(body.responsibleMemberId)
        : undefined;
    const profile =
      !id || body.profileUrl !== undefined
        ? httpsUrl(body.profileUrl)
        : undefined;
    const detail = (key: string, max: number) => {
      const value = body[key];
      if (value === undefined) return id ? undefined : null;
      if (value === null || value === '') return null;
      return key === 'remark' ? longText(value, max) : shortText(value, max);
    };
    const boundPhone = detail('boundPhone', 100),
      actualPhone = detail('actualPhone', 100),
      remark = detail('remark', 2000);
    try {
      return await this.db.client.begin(async (tx) => {
        const [operator] =
          await tx`SELECT role,active FROM studio_os.accounts WHERE id=${actor} FOR SHARE`;
        if (!operator?.active) throw new UnauthorizedException();
        if (operator.role !== 'admin') throw new ForbiddenException();
        const before = id
          ? (
              await tx`SELECT id,name,profile_url AS "profileUrl",bound_phone AS "boundPhone",actual_phone AS "actualPhone",remark,responsible_member_id AS "responsibleMemberId",active,version FROM studio_os.business_accounts WHERE id=${id} FOR UPDATE`
            )[0]
          : null;
        if (id && !before) throw new NotFoundException();
        if (before && before.version !== expected)
          throw new ConflictException();
        if (
          owner &&
          owner !== before?.responsibleMemberId &&
          !(
            await tx`SELECT id FROM studio_os.members WHERE id=${owner} AND active FOR SHARE`
          ).length
        )
          throw new BadRequestException();
        const [row] = id
          ? await tx`UPDATE studio_os.business_accounts SET name=${name ?? before!.name}, profile_url=${profile === undefined ? before!.profileUrl : profile}, responsible_member_id=${owner ?? before!.responsibleMemberId}, active=${body.active ?? before!.active}, bound_phone=${boundPhone === undefined ? before!.boundPhone : boundPhone},actual_phone=${actualPhone === undefined ? before!.actualPhone : actualPhone},remark=${remark === undefined ? before!.remark : (remark ?? '')}, version=version+1,updated_at=now() WHERE id=${id} RETURNING id,name,profile_url AS "profileUrl",bound_phone AS "boundPhone",actual_phone AS "actualPhone",remark,responsible_member_id AS "responsibleMemberId",active,version`
          : await tx`INSERT INTO studio_os.business_accounts (name,profile_url,responsible_member_id,bound_phone,actual_phone,remark) VALUES (${name!},${profile!},${owner!},${boundPhone ?? null},${actualPhone ?? null},${remark ?? ''}) RETURNING id,name,profile_url AS "profileUrl",bound_phone AS "boundPhone",actual_phone AS "actualPhone",remark,responsible_member_id AS "responsibleMemberId",active,version`;
        await tx`INSERT INTO studio_os.business_account_events(account_id,actor_id,before_value,after_value) VALUES (${row.id},${actor},${before ? JSON.stringify(before) : null},${JSON.stringify(row)})`;
        return row;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
}
