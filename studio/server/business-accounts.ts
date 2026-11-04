import type {Identity} from './auth';
import {livePermission,freshIdentity,hasPermission} from './permissions';
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
const profileFields = ['platform', 'platformAccountId', 'avatarUrl', 'purpose', 'storeId', 'primaryDeviceId', 'extraDeviceIds'];

export class BusinessAccounts {
  constructor(private readonly db: StudioDatabase) {}
  async list(who:Identity) {
    who=await freshIdentity(this.db,who);if(who.role!=='admin')throw new ForbiddenException();const privateFields=hasPermission(who,'resources');
    return this.db
      .client`SELECT b.id, b.name, b.profile_url AS "profileUrl", CASE WHEN ${privateFields} THEN b.bound_phone ELSE '' END AS "boundPhone", CASE WHEN ${privateFields} THEN b.actual_phone ELSE '' END AS "actualPhone", CASE WHEN ${privateFields} THEN b.remark ELSE '' END AS remark, b.responsible_member_id AS "responsibleMemberId", b.active, b.version, m.display_name AS "responsibleName", m.active AS "memberActive",
        b.platform, CASE WHEN ${privateFields} THEN b.platform_account_id END AS "platformAccountId",
        CASE WHEN ${privateFields} THEN b.avatar_url END AS "avatarUrl",
        CASE WHEN ${privateFields} THEN b.purpose END AS purpose,
        CASE WHEN ${privateFields} THEN b.store_id END AS "storeId",
        CASE WHEN ${privateFields} THEN s.name END AS "storeName",
        CASE WHEN ${privateFields} THEN b.primary_device_id END AS "primaryDeviceId",
        CASE WHEN ${privateFields} THEN d.asset_tag || ' · ' || d.name END AS "primaryDeviceName",
        CASE WHEN ${privateFields} THEN ARRAY(SELECT x.device_id FROM studio_os.business_account_extra_devices x WHERE x.account_id=b.id ORDER BY x.device_id) END AS "extraDeviceIds",
        CASE WHEN ${privateFields} THEN ARRAY(SELECT e.asset_tag || ' · ' || e.name FROM studio_os.business_account_extra_devices x JOIN studio_os.equipment_assets e ON e.id=x.device_id WHERE x.account_id=b.id ORDER BY e.asset_tag) END AS "extraDeviceNames"
        FROM studio_os.business_accounts b JOIN studio_os.members m ON m.id = b.responsible_member_id LEFT JOIN studio_os.stores s ON s.id=b.store_id LEFT JOIN studio_os.equipment_assets d ON d.id=b.primary_device_id ORDER BY b.name,b.id`;
  }
  async history(who: Identity, accountId: string) {
    const id = uuid(accountId);
    who = await freshIdentity(this.db, who);
    if (who.role !== 'admin' || !hasPermission(who, 'resources')) throw new ForbiddenException();
    return this.db.client`SELECT e.id, e.created_at AS "createdAt", a.username AS actor,
      e.before_value AS "beforeValue", e.after_value AS "afterValue"
      FROM studio_os.business_account_events e LEFT JOIN studio_os.accounts a ON a.id=e.actor_id
      WHERE e.account_id=${id} ORDER BY e.created_at DESC,e.id DESC LIMIT 50`;
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
            ...profileFields,
            'expectedVersion',
          ]
        : [
            'name',
            'profileUrl',
            'responsibleMemberId',
            'boundPhone',
            'actualPhone',
            'remark',
            ...profileFields,
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
        ...profileFields,
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
    const platform = body.platform === undefined ? undefined : shortText(body.platform, 40);
    const platformAccountId = detail('platformAccountId', 100);
    const avatarUrl = body.avatarUrl === undefined ? undefined : httpsUrl(body.avatarUrl);
    const purpose = body.purpose === undefined ? undefined : body.purpose === '' ? '' : longText(body.purpose, 1000);
    const storeId = body.storeId == null ? body.storeId as null | undefined : uuid(body.storeId);
    const primaryDeviceId = body.primaryDeviceId == null ? body.primaryDeviceId as null | undefined : uuid(body.primaryDeviceId);
    let extraDeviceIds: string[] | undefined;
    if (body.extraDeviceIds !== undefined) {
      if (!Array.isArray(body.extraDeviceIds) || body.extraDeviceIds.length > 100)
        throw new BadRequestException();
      extraDeviceIds = body.extraDeviceIds.map(uuid).sort();
      if (new Set(extraDeviceIds).size !== extraDeviceIds.length) throw new BadRequestException();
    }
    try {
      return await this.db.client.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
        await livePermission(tx,actor,'resources');
        const [operator] =
          await tx`SELECT role,active FROM studio_os.accounts WHERE id=${actor} FOR SHARE`;
        if (!operator?.active) throw new UnauthorizedException();
        if (operator.role !== 'admin') throw new ForbiddenException();
        const before = id
          ? (
              await tx`SELECT id,name,profile_url AS "profileUrl",bound_phone AS "boundPhone",actual_phone AS "actualPhone",remark,responsible_member_id AS "responsibleMemberId",active,version,platform,platform_account_id AS "platformAccountId",avatar_url AS "avatarUrl",purpose,store_id AS "storeId",primary_device_id AS "primaryDeviceId",ARRAY(SELECT device_id FROM studio_os.business_account_extra_devices WHERE account_id=business_accounts.id ORDER BY device_id) AS "extraDeviceIds" FROM studio_os.business_accounts WHERE id=${id} FOR UPDATE`
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
        const nextStore = storeId === undefined ? before?.storeId ?? null : storeId;
        const nextPrimary = primaryDeviceId === undefined ? before?.primaryDeviceId ?? null : primaryDeviceId;
        const nextExtras: string[] = extraDeviceIds ?? before?.extraDeviceIds ?? [];
        if (nextPrimary && nextExtras.includes(nextPrimary)) throw new BadRequestException();
        if (nextStore && nextStore !== before?.storeId &&
            !(await tx`SELECT id FROM studio_os.stores WHERE id=${nextStore} AND active FOR SHARE`).length)
          throw new BadRequestException();
        const previousDevices = new Set([before?.primaryDeviceId, ...(before?.extraDeviceIds ?? [])]);
        const added = [nextPrimary, ...nextExtras].filter(device => device && !previousDevices.has(device));
        if (added.length && (await tx`SELECT id FROM studio_os.equipment_assets WHERE id=ANY(${tx.array(added)}::uuid[]) AND status<>'retired' ORDER BY id FOR SHARE`).length !== added.length)
          throw new BadRequestException();
        const nextPlatform = platform ?? before?.platform ?? '小红书';
        const nextPlatformId = body.platformAccountId === undefined ? before?.platformAccountId ?? '' : platformAccountId ?? '';
        const nextAvatar = avatarUrl === undefined ? before?.avatarUrl ?? null : avatarUrl;
        const nextPurpose = purpose ?? before?.purpose ?? '';
        const [row] = id
          ? await tx`UPDATE studio_os.business_accounts SET name=${name ?? before!.name}, profile_url=${profile === undefined ? before!.profileUrl : profile}, responsible_member_id=${owner ?? before!.responsibleMemberId}, active=${body.active ?? before!.active}, bound_phone=${boundPhone === undefined ? before!.boundPhone : boundPhone},actual_phone=${actualPhone === undefined ? before!.actualPhone : actualPhone},remark=${remark === undefined ? before!.remark : (remark ?? '')}, platform=${nextPlatform},platform_account_id=${nextPlatformId},avatar_url=${nextAvatar},purpose=${nextPurpose},store_id=${nextStore},primary_device_id=${nextPrimary}, version=version+1,updated_at=now() WHERE id=${id} RETURNING id,name,profile_url AS "profileUrl",bound_phone AS "boundPhone",actual_phone AS "actualPhone",remark,responsible_member_id AS "responsibleMemberId",active,version,platform,platform_account_id AS "platformAccountId",avatar_url AS "avatarUrl",purpose,store_id AS "storeId",primary_device_id AS "primaryDeviceId"`
          : await tx`INSERT INTO studio_os.business_accounts (name,profile_url,responsible_member_id,bound_phone,actual_phone,remark,platform,platform_account_id,avatar_url,purpose,store_id,primary_device_id) VALUES (${name!},${profile!},${owner!},${boundPhone ?? null},${actualPhone ?? null},${remark ?? ''},${nextPlatform},${nextPlatformId},${nextAvatar},${nextPurpose},${nextStore},${nextPrimary}) RETURNING id,name,profile_url AS "profileUrl",bound_phone AS "boundPhone",actual_phone AS "actualPhone",remark,responsible_member_id AS "responsibleMemberId",active,version,platform,platform_account_id AS "platformAccountId",avatar_url AS "avatarUrl",purpose,store_id AS "storeId",primary_device_id AS "primaryDeviceId"`;
        if (extraDeviceIds !== undefined) {
          await tx`DELETE FROM studio_os.business_account_extra_devices WHERE account_id=${row.id}`;
          if (nextExtras.length) {
            await tx`INSERT INTO studio_os.business_account_extra_devices(account_id,device_id)
              SELECT ${row.id}::uuid,device_id FROM unnest(${tx.array(nextExtras)}::uuid[]) AS devices(device_id)`;
          }
        }
        const after = {...row, extraDeviceIds: nextExtras};
        await tx`INSERT INTO studio_os.business_account_events(account_id,actor_id,before_value,after_value) VALUES (${row.id},${actor},${before ? JSON.stringify(before) : null},${JSON.stringify(after)})`;
        return after;
      });
    } catch (error) {
      if ((error as {constraint_name?: string}).constraint_name === 'business_accounts_primary_device_id_key')
        throw new ConflictException('该设备已有主账号，请刷新后重新选择。');
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
}
