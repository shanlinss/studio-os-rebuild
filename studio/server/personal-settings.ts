import {BadRequestException,ConflictException,HttpException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {StudioDatabase} from './database';
import type {AuthRequest,Identity} from './auth';
import {Members} from './registry';
import {freshIdentity,hasPermission} from './permissions';
import {hashPassword,verifyPassword} from './password';
import {objectInput,uuid,version} from './validation';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
export class PersonalSettings{
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,query:unknown){objectInput(query,[]);who=await freshIdentity(this.db,who);const [account]=await this.db.client`SELECT id,username,role,version FROM studio_os.accounts WHERE id=${who.id} AND active`;if(!account)throw new UnauthorizedException();const {profile}=await new Members(this.db).ownProfile(who.id,{});return {account,profile,passwordChangeSupported:true,canMaintainMember:hasPermission(who,'personnel')};}
 async change(req:AuthRequest,value:unknown){
  const b=objectInput(value,['requestKey','expectedVersion','currentPassword','newPassword']);const key=uuid(b.requestKey),expected=version(b.expectedVersion);
  if(typeof b.currentPassword!=='string'||!b.currentPassword.length||b.currentPassword.length>128||typeof b.newPassword!=='string'||b.newPassword.length<12||b.newPassword.length>128||!b.newPassword.trim()||b.currentPassword===b.newPassword)throw new BadRequestException();
  if(!req.identity?.id||!req.tokenHash||!/^[a-f0-9]{64}$/.test(req.tokenHash))throw new UnauthorizedException();const actor=req.identity.id;
  const [before]=await this.db.client`SELECT a.id,a.password_hash FROM studio_os.accounts a JOIN studio_os.sessions s ON s.account_id=a.id WHERE a.id=${actor} AND a.active AND s.token_hash=${req.tokenHash} AND s.expires_at>now()`;if(!before)throw new UnauthorizedException();
  // Charge failed guesses independently of the password transaction; reuse the original expiring rate-limit store.
  const [limit]=await this.db.client`INSERT INTO studio_os.login_limits(key,attempts,reset_at) VALUES(${digest('personal-password:'+actor)},1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.reset_at<=now() THEN 1 ELSE LEAST(login_limits.attempts,20)+1 END,reset_at=CASE WHEN login_limits.reset_at<=now() THEN now()+interval '15 minutes' ELSE login_limits.reset_at END RETURNING attempts`;
  if(limit.attempts>20)throw new HttpException('Try again later',429);
  if(!(await verifyPassword(b.currentPassword,before.password_hash)).valid)throw new BadRequestException();
  const encoded=await hashPassword(b.newPassword);
  return this.db.client.begin(async tx=>{
   // Same fence and lock order as administrator credential/permission operations and original login.
   await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
   const [a]=await tx`SELECT id,username,role,active,version,password_hash FROM studio_os.accounts WHERE id=${actor} FOR UPDATE`;
   if(!a?.active||a.password_hash!==before.password_hash)throw new UnauthorizedException();
   const [session]=await tx`SELECT token_hash FROM studio_os.sessions WHERE token_hash=${req.tokenHash!} AND account_id=${actor} AND expires_at>now() FOR UPDATE`;if(!session)throw new UnauthorizedException();
   if(a.version!==expected)throw new ConflictException();
   if((await tx`SELECT id FROM studio_os.account_lifecycle_events WHERE actor_id=${actor} AND request_key=${key}`).length)throw new ConflictException();
   const [after]=await tx`UPDATE studio_os.accounts SET password_hash=${encoded},version=version+1 WHERE id=${actor} RETURNING id,username,role,active,version`;
   await tx`DELETE FROM studio_os.sessions WHERE account_id=${actor}`;
   const safeBefore={id:a.id,username:a.username,role:a.role,active:a.active,version:a.version},result={id:after.id,username:after.username,version:after.version,action:'password-change',memberId:null};
   const metadata=digest(JSON.stringify({action:'password-change',id:actor,expected}));
   await tx`INSERT INTO studio_os.account_lifecycle_events(actor_id,account_id,request_key,action,metadata_hash,reason,before_value,after_value,result) VALUES(${actor},${actor},${key},'password-change',${metadata},'本人修改登录密码',${JSON.stringify(safeBefore)}::jsonb,${JSON.stringify(after)}::jsonb,${JSON.stringify(result)}::jsonb)`;
   return {ok:true,signedOut:true};
  });
 }
}
