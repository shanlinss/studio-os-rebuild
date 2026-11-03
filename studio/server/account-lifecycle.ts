import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {hashPassword} from './password';
import {requireAdministrator} from './access';
import {objectInput,uuid,version,longText} from './validation';
const fields='id,username,role,active,version';
export class AccountLifecycle {
 constructor(private readonly db:StudioDatabase){}
 async receipt(who:Identity,key:string){requireAdministrator(who);uuid(key);const [r]=await this.db.client`SELECT result FROM studio_os.account_lifecycle_events WHERE actor_id=${who.id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;}
 async save(who:Identity,value:unknown,id?:string){
  requireAdministrator(who);if(id)uuid(id);
  const keys=id?['requestKey','expectedVersion','password','reason']:['requestKey','username','role','password','memberId','memberVersion','reason'];
  const b=objectInput(value,keys);if(keys.some(k=>!Object.hasOwn(b,k)))throw new BadRequestException('请保留完整账号信息');
  const key=uuid(b.requestKey),reason=longText(b.reason,2000).trim();
  if(!reason||typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new BadRequestException('请填写原因，密码须为12至128个字符');
  const expected=id?version(b.expectedVersion):null;
  if(!id&&(typeof b.username!=='string'||!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(b.username)||typeof b.role!=='string'||!['admin','employee'].includes(b.role)))throw new BadRequestException('请核对用户名和角色');
  const memberId=!id&&b.memberId!==null?uuid(b.memberId):null,memberVersion=memberId?version(b.memberVersion):null;
  if(!id&&!memberId&&b.memberVersion!==null)throw new BadRequestException();
  const action=id?'password-reset':'created';
  // A request key identifies one credential operation. Secret fields are deliberately
  // excluded from audit/fingerprints. Reusing a completed key never applies a new password.
  const metadata=id?{action,id,expected,reason}:{action,username:b.username,role:b.role,memberId,memberVersion,reason};
  const hash=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  const encoded=await hashPassword(b.password);
  try{return await this.db.client.begin(async tx=>{
   await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
   const [actor]=await tx`SELECT role,active FROM studio_os.accounts WHERE id=${who.id} FOR UPDATE`;
   if(!actor?.active)throw new UnauthorizedException();if(actor.role!=='admin')throw new ForbiddenException();
   const [old]=await tx`SELECT metadata_hash,result FROM studio_os.account_lifecycle_events WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.metadata_hash!==hash)throw new ConflictException('此保存标识已用于其他操作');return old.result;}
   let before:Record<string,unknown>={},after;
   if(id){
    if(id===who.id)throw new ConflictException('此入口用于重置其他成员的密码');
    const [target]=await tx`SELECT ${tx.unsafe(fields)} FROM studio_os.accounts WHERE id=${id} FOR UPDATE`;
    if(!target)throw new NotFoundException();if(target.version!==expected)throw new ConflictException('账号已变化，请重新读取');before=target;
    [after]=await tx`UPDATE studio_os.accounts SET password_hash=${encoded},version=version+1 WHERE id=${id} RETURNING ${tx.unsafe(fields)}`;
    await tx`DELETE FROM studio_os.sessions WHERE account_id=${id}`;
   }else{
    let member;
    if(memberId){[member]=await tx`SELECT * FROM studio_os.members WHERE id=${memberId} FOR UPDATE`;if(!member)throw new NotFoundException();if(!member.active||member.login_account_id||member.version!==memberVersion)throw new ConflictException('成员已变化、已停用或已有登录关联');}
    [after]=await tx`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${String(b.username)},${encoded},${String(b.role)}) RETURNING ${tx.unsafe(fields)}`;
    if(member){const [updated]=await tx`UPDATE studio_os.members SET login_account_id=${after.id},version=version+1,updated_at=now() WHERE id=${memberId} RETURNING *`;await tx`INSERT INTO studio_os.identity_events(entity_type,entity_id,actor_id,action,before_value,after_value) VALUES('member',${memberId},${who.id},'updated',${JSON.stringify(member)}::jsonb,${JSON.stringify(updated)}::jsonb)`;}
   }
   const result={id:String(after.id),username:String(after.username),version:Number(after.version),action,memberId};
   await tx`INSERT INTO studio_os.account_lifecycle_events(actor_id,account_id,request_key,action,metadata_hash,reason,before_value,after_value,result) VALUES(${who.id},${after.id},${key},${action},${hash},${reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb,${JSON.stringify(result)}::jsonb)`;
   return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('用户名已存在或成员已关联，请重新核对');throw e;}
 }
}
