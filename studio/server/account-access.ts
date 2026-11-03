import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {requireAdministrator} from './access';
import {objectInput,uuid,version} from './validation';

export class AccountAccess {
 constructor(private readonly db: StudioDatabase) {}
 list(identity: Identity){
  requireAdministrator(identity);
  return this.db.client`SELECT id,username,role,active,version FROM studio_os.accounts ORDER BY username,id`;
 }
 async update(identity: Identity,id: string,value: unknown){
  requireAdministrator(identity);uuid(id);
  const b=objectInput(value,['role','active','expectedVersion']),expected=version(b.expectedVersion);
  if(!['admin','employee'].includes(String(b.role))||typeof b.active!=='boolean')throw new BadRequestException();
  const role=b.role as 'admin'|'employee',active=b.active;
  return this.db.client.begin(async tx=>{
   // Serialize administrator changes, including changes made by different admins.
   await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
   const [actor]=await tx`SELECT id,role,active FROM studio_os.accounts WHERE id=${identity.id} FOR UPDATE`;
   if(!actor?.active)throw new UnauthorizedException();
   if(actor.role!=='admin')throw new ForbiddenException();
   const [before]=await tx`SELECT id,username,role,active,version FROM studio_os.accounts WHERE id=${id} FOR UPDATE`;
   if(!before)throw new NotFoundException();
   if(before.version!==expected)throw new ConflictException();
   if(before.role===role&&before.active===active)return before;
   if(id===identity.id)throw new ConflictException('不能在当前登录中停用自己或更改自己的角色');
   if(before.active&&before.role==='admin'&&(!active||role!=='admin')){
    const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.accounts WHERE active AND role='admin'`;
    if(count.n<=1)throw new ConflictException('至少保留一个有效管理员');
   }
   const [after]=await tx`UPDATE studio_os.accounts SET role=${role},active=${active},version=version+1 WHERE id=${id} RETURNING id,username,role,active,version`;
   await tx`DELETE FROM studio_os.sessions WHERE account_id=${id}`;
   await tx`INSERT INTO studio_os.account_access_events(account_id,actor_id,before_value,after_value) VALUES(${id},${identity.id},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`;
   return after;
  });
 }
 history(identity: Identity,id: string){
  requireAdministrator(identity);uuid(id);
  return this.db.client`SELECT e.id,e.before_value AS "beforeValue",e.after_value AS "afterValue",e.created_at AS "createdAt",a.username AS actor FROM studio_os.account_access_events e JOIN studio_os.accounts a ON a.id=e.actor_id WHERE e.account_id=${id} ORDER BY e.created_at DESC,e.id LIMIT 50`;
 }
}
