import {ForbiddenException,UnauthorizedException,BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import type {TransactionSql} from 'postgres';
import {objectInput,uuid,version,longText} from './validation';
export const permissionNames=['finance','account_security','payroll','personnel','resources'] as const;
export type AdminPermission=typeof permissionNames[number];
export function hasPermission(who:Identity|undefined,p:AdminPermission){return who?.role==='admin'&&(who.superadmin===true||who.permissions?.includes(p)===true);}
export function requirePermission(who:Identity|undefined,p:AdminPermission){if(!who)throw new UnauthorizedException();if(!hasPermission(who,p))throw new ForbiddenException();}
export function databaseIdentity(row:any):Identity{return {id:row.id,username:row.username,role:row.role,superadmin:row.superadmin===true,permissions:row.role==='admin'?(row.admin_permissions||[]):[]};}
export async function livePermission(tx:TransactionSql,actor:string,p:AdminPermission){const [row]=await tx`SELECT id,username,role,active,superadmin,admin_permissions FROM studio_os.accounts WHERE id=${actor} FOR SHARE`;if(!row?.active)throw new UnauthorizedException();const who=databaseIdentity(row);requirePermission(who,p);return who;}
export async function freshIdentity(db:StudioDatabase,who:Identity):Promise<Identity>{if(!who)throw new UnauthorizedException();const [row]=await db.client`SELECT id,username,role,active,superadmin,admin_permissions FROM studio_os.accounts WHERE id=${who.id}`;if(!row?.active)throw new UnauthorizedException();return databaseIdentity(row);}
export async function currentPermission(db:StudioDatabase,who:Identity,p:AdminPermission){const current=await freshIdentity(db,who);requirePermission(current,p);return current;}
export async function bootstrapSuperadmin(db:StudioDatabase,username:string,reason:string){
 if(!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)||!reason.trim()||reason.length>1900)throw new BadRequestException();
 return db.client.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
  if((await tx`SELECT id FROM studio_os.accounts WHERE active AND superadmin`).length)throw new ConflictException('已有有效超级管理员');
  const [before]=await tx`SELECT id,username,role,active,version,superadmin,admin_permissions AS permissions FROM studio_os.accounts WHERE username=${username} FOR UPDATE`;
  if(!before?.active||before.role!=='admin')throw new ConflictException('需要明确指定已有有效管理员');
  const [after]=await tx`UPDATE studio_os.accounts SET superadmin=true,version=version+1 WHERE id=${before.id} RETURNING id,username,role,active,version,superadmin,admin_permissions AS permissions`;
  await tx`DELETE FROM studio_os.sessions WHERE account_id=${before.id}`;
  await tx`INSERT INTO studio_os.account_permission_events(account_id,actor_id,reason,before_value,after_value) VALUES(${before.id},${before.id},${'Operator bootstrap: '+reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`;
  return after;
 });
}
export class AccountPermissions {
 constructor(private readonly db:StudioDatabase){}
 async update(who:Identity,id:string,value:unknown){
  if(!who)throw new UnauthorizedException();if(who.role!=='admin'||!who.superadmin)throw new ForbiddenException();uuid(id);
  const b=objectInput(value,['expectedVersion','permissions','superadmin','reason']),expected=version(b.expectedVersion),reason=longText(b.reason,2000).trim();
  if(!reason||typeof b.superadmin!=='boolean'||!Array.isArray(b.permissions)||b.permissions.some(p=>!permissionNames.includes(p))||new Set(b.permissions).size!==b.permissions.length)throw new BadRequestException();
  const permissions=[...b.permissions].sort();
  return this.db.client.begin(async tx=>{
   await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
   const [actor]=await tx`SELECT role,active,superadmin FROM studio_os.accounts WHERE id=${who.id} FOR UPDATE`;
   if(!actor?.active)throw new UnauthorizedException();if(actor.role!=='admin'||!actor.superadmin)throw new ForbiddenException();
   const [before]=await tx`SELECT id,username,role,active,superadmin,admin_permissions AS permissions,version FROM studio_os.accounts WHERE id=${id} FOR UPDATE`;
   if(!before)throw new NotFoundException();if(before.version!==expected)throw new ConflictException();if(before.role!=='admin'||!before.active)throw new ConflictException('只为有效管理员设置敏感授权');
   if(who.id===id)throw new ConflictException('不能在当前登录中调整自己的超级管理员或敏感授权');
   const [after]=await tx`UPDATE studio_os.accounts SET superadmin=${b.superadmin as boolean},admin_permissions=${tx.array(permissions)}::text[],version=version+1 WHERE id=${id} RETURNING id,username,role,active,superadmin,admin_permissions AS permissions,version`;
   await tx`DELETE FROM studio_os.sessions WHERE account_id=${id}`;
   await tx`INSERT INTO studio_os.account_permission_events(account_id,actor_id,reason,before_value,after_value) VALUES(${id},${who.id},${reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`;
   return after;
  });
 }
}
