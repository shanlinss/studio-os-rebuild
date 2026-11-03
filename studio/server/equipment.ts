import {livePermission,currentPermission,freshIdentity,hasPermission} from './permissions';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {requireAdministrator,requireContributor} from './access';
import {objectInput,shortText,longText,optionalLongText,uuid,version} from './validation';

const optionalId=(v:unknown)=>v===null||v===undefined||v===''?null:uuid(v);
const project=`e.id,e.asset_tag AS "assetTag",e.name,e.model,e.keeper_member_id AS "keeperMemberId",m.display_name AS "keeperName",e.location,e.status,e.version,e.created_at AS "createdAt",e.updated_at AS "updatedAt"`;
const loanProject=`l.id,l.equipment_id AS "equipmentId",l.owner_id AS "ownerId",l.member_id AS "memberId",e.asset_tag AS "assetTag",e.name,CASE WHEN l.returned_at IS NULL THEN e.location ELSE l.return_location END AS "returnLocation",l.location,l.shooting_request_id AS "shootingRequestId",l.shooting_title AS "shootingTitle",m.display_name AS "borrowerName",l.note,l.return_condition AS "returnCondition",l.return_note AS "returnNote",l.version,l.borrowed_at AS "borrowedAt",l.returned_at AS "returnedAt"`;
async function asset(tx:TransactionSql,id:string){const [row]=await tx`SELECT * FROM studio_os.equipment_assets WHERE id=${id} FOR UPDATE`;if(!row)throw new NotFoundException();return row;}
async function borrower(tx:TransactionSql,id:string){const [m]=await tx`SELECT id,active FROM studio_os.members WHERE login_account_id=${id} FOR SHARE`;if(!m)throw new ConflictException('请先关联成员档案');if(!m.active)throw new ForbiddenException();return m;}
async function event(tx:TransactionSql,who:Identity,id:string,loan:string|null,action:string,before:unknown,after:unknown,note=''){
 await tx`INSERT INTO studio_os.equipment_events(equipment_id,loan_id,actor_id,action,before_value,after_value,note) VALUES(${id},${loan},${who.id},${action},${before?JSON.stringify(before):null}::jsonb,${JSON.stringify(after)}::jsonb,${note})`;
}
export class Equipment {
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,action:string,b:Record<string,unknown>,fn:(tx:TransactionSql)=>Promise<{id:string}>){
  requireContributor(who);const key=uuid(b.requestKey),body=Object.fromEntries(Object.keys(b).sort().map(k=>[k,b[k]])),hash=createHash('sha256').update(JSON.stringify({action,body})).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const [actor]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(action.startsWith('admin:'))await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'equipment:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.equipment_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException('请求标识已经用于其他内容');return old.result;}
   const result=await fn(tx);await tx`INSERT INTO studio_os.equipment_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('设备编号重复或设备已被借用');throw e;}
 }
 receipt(who:Identity,key:string){requireContributor(who);uuid(key);return this.db.client.begin(async tx=>{const [r]=await tx`SELECT action,result FROM studio_os.equipment_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r||(r.action.startsWith('admin:')&&!hasPermission(await freshIdentity(this.db,who),'resources')))throw new NotFoundException();return r.result;});}
 private query(who:Identity,value:unknown,loans=false){
  requireContributor(who);const b=objectInput(value,loans?['view','status','offset']:['q','all','offset']);const offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  if(loans&&b.view!==undefined&&!['own','team'].includes(String(b.view)))throw new BadRequestException();if(!loans&&b.all!==undefined&&!['true','false'].includes(String(b.all)))throw new BadRequestException();
  const team=b.view==='team',all=b.all==='true';if(team||all){if(!hasPermission(who,'resources'))throw new ForbiddenException();}const status=b.status===undefined?'open':String(b.status);if(!['open','returned','all'].includes(status))throw new BadRequestException();
  return {offset,team,all,status,q:b.q?shortText(b.q,100):''};
 }
 async catalog(who:Identity,value:unknown){
  who=await freshIdentity(this.db,who);
  const q=this.query(who,value);const where=this.db.client`(${q.all} OR e.status<>'retired') AND strpos(lower(concat_ws(' ',e.asset_tag,e.name,e.model,e.location,m.display_name)),lower(${q.q}))>0`;
  const rows=await this.db.client`SELECT ${this.db.client.unsafe(project)} FROM studio_os.equipment_assets e LEFT JOIN studio_os.members m ON m.id=e.keeper_member_id WHERE ${where} ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET ${q.offset}`;
  const [n]=await this.db.client`SELECT count(*)::int AS n FROM studio_os.equipment_assets e LEFT JOIN studio_os.members m ON m.id=e.keeper_member_id WHERE ${where}`;return {rows,total:n.n,offset:q.offset,limit:50};
 }
 async detail(who:Identity,id:string){
  who=await freshIdentity(this.db,who);
  requireContributor(who);uuid(id);const [row]=await this.db.client`SELECT ${this.db.client.unsafe(project)},CASE WHEN ${hasPermission(who,'resources')} THEN e.notes ELSE '' END AS notes FROM studio_os.equipment_assets e LEFT JOIN studio_os.members m ON m.id=e.keeper_member_id WHERE e.id=${id}`;if(!row)throw new NotFoundException();return row;
 }
 async loans(who:Identity,value:unknown){
  who=await freshIdentity(this.db,who);
  const q=this.query(who,value,true),where=this.db.client`(${q.team} OR l.owner_id=${who.id}) AND (${q.status}='all' OR (${q.status}='open' AND l.returned_at IS NULL) OR (${q.status}='returned' AND l.returned_at IS NOT NULL))`;
  const rows=await this.db.client`SELECT ${this.db.client.unsafe(loanProject)} FROM studio_os.equipment_loans l JOIN studio_os.equipment_assets e ON e.id=l.equipment_id JOIN studio_os.members m ON m.id=l.member_id WHERE ${where} ORDER BY l.borrowed_at DESC,l.id LIMIT 50 OFFSET ${q.offset}`;
  const [n]=await this.db.client`SELECT count(*)::int AS n FROM studio_os.equipment_loans l WHERE ${where}`;return {rows,total:n.n,offset:q.offset,limit:50};
 }
 async loan(who:Identity,id:string){
  who=await freshIdentity(this.db,who);
  requireContributor(who);uuid(id);const [row]=await this.db.client`SELECT ${this.db.client.unsafe(loanProject)} FROM studio_os.equipment_loans l JOIN studio_os.equipment_assets e ON e.id=l.equipment_id JOIN studio_os.members m ON m.id=l.member_id WHERE l.id=${id} AND (${hasPermission(who,'resources')} OR l.owner_id=${who.id})`;if(!row)throw new NotFoundException();return row;
 }
 async save(who:Identity,value:unknown,id?:string){
  requireAdministrator(who);if(id)uuid(id);const b=objectInput(value,['requestKey','assetTag','name','model','keeperMemberId','location','notes',...(id?['expectedVersion']:[])]);
  const tag=shortText(b.assetTag,64),name=shortText(b.name,120),model=optionalLongText(b.model,200),keeper=optionalId(b.keeperMemberId),location=shortText(b.location,150),notes=optionalLongText(b.notes,2000),expected=id?version(b.expectedVersion):0;
  return this.write(who,'admin:save:'+(id||'new'),b,async tx=>{
   const old=id?await asset(tx,id):null;if(old&&old.version!==expected)throw new ConflictException();if(keeper&&!(await tx`SELECT id FROM studio_os.members WHERE id=${keeper} FOR SHARE`).length)throw new BadRequestException();
   const [row]=id?await tx`UPDATE studio_os.equipment_assets SET asset_tag=${tag},name=${name},model=${model},keeper_member_id=${keeper},location=${location},notes=${notes},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:await tx`INSERT INTO studio_os.equipment_assets(asset_tag,name,model,keeper_member_id,location,notes,created_by) VALUES(${tag},${name},${model},${keeper},${location},${notes},${who.id}) RETURNING *`;
   await event(tx,who,row.id,null,id?'edited':'registered',old,row);return {id:row.id};
  });
 }
 async borrow(who:Identity,id:string,value:unknown){
  uuid(id);const b=objectInput(value,['requestKey','expectedVersion','location','shootingRequestId','note']),expected=version(b.expectedVersion),location=shortText(b.location,150),shooting=optionalId(b.shootingRequestId),note=optionalLongText(b.note,2000);
  return this.write(who,'borrow:'+id,b,async tx=>{
   const m=await borrower(tx,who.id),old=await asset(tx,id);if(old.version!==expected||old.status!=='available')throw new ConflictException('设备已变化或暂不可借');let title:string|null=null;
   if(shooting){const [r]=await tx`SELECT title FROM studio_os.shooting_requests WHERE id=${shooting} FOR SHARE`;if(!r)throw new NotFoundException();title=r.title;}
   const [loan]=await tx`INSERT INTO studio_os.equipment_loans(equipment_id,owner_id,member_id,location,shooting_request_id,shooting_title,note) VALUES(${id},${who.id},${m.id},${location},${shooting},${title},${note}) RETURNING *`;
   const [row]=await tx`UPDATE studio_os.equipment_assets SET status='on_loan',version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;await event(tx,who,id,loan.id,'borrowed',old,{asset:row,loan},note);return {id:loan.id};
  });
 }
 async ownLoan(who:Identity,id:string,value:unknown,relocate=false){
  uuid(id);const b=objectInput(value,relocate?['requestKey','expectedVersion','location','note']:['requestKey','expectedVersion','condition','note']),expected=version(b.expectedVersion),note=optionalLongText(b.note,2000),location=relocate?shortText(b.location,150):'';
  if(!relocate&&(!['ok','issue'].includes(String(b.condition))||(b.condition==='issue'&&!note.trim())))throw new BadRequestException('异常归还需要填写说明');
  return this.write(who,(relocate?'relocate:':'return:')+id,b,async tx=>{
   await borrower(tx,who.id);const [lookup]=await tx`SELECT equipment_id FROM studio_os.equipment_loans WHERE id=${id} AND owner_id=${who.id}`;if(!lookup)throw new NotFoundException();
   const old=await asset(tx,lookup.equipment_id),[loan]=await tx`SELECT * FROM studio_os.equipment_loans WHERE id=${id} AND owner_id=${who.id} FOR UPDATE`;
   if(loan.version!==expected||loan.returned_at||old.status!=='on_loan')throw new ConflictException('设备借用记录已变化');
   const [afterLoan]=relocate?await tx`UPDATE studio_os.equipment_loans SET location=${location},version=version+1 WHERE id=${id} RETURNING *`:await tx`UPDATE studio_os.equipment_loans SET returned_at=now(),return_location=${old.location},return_condition=${String(b.condition)},return_note=${note},version=version+1 WHERE id=${id} RETURNING *`;
   const [row]=relocate?[old]:await tx`UPDATE studio_os.equipment_assets SET status=${b.condition==='issue'?'maintenance':'available'},version=version+1,updated_at=now() WHERE id=${old.id} RETURNING *`;
   await event(tx,who,old.id,id,relocate?'relocated':'returned',{asset:old,loan},{asset:row,loan:afterLoan},note);return {id};
  });
 }
 async state(who:Identity,id:string,value:unknown){
  requireAdministrator(who);uuid(id);const b=objectInput(value,['requestKey','expectedVersion','action','note']),expected=version(b.expectedVersion),note=longText(b.note,2000);
  if(!['maintenance','ready','retired'].includes(String(b.action))||!note.trim())throw new BadRequestException();
  return this.write(who,'admin:state:'+id,b,async tx=>{
   const old=await asset(tx,id);if(old.version!==expected||old.status==='on_loan')throw new ConflictException('设备在借或状态已变化');
   const allowed=b.action==='maintenance'?old.status==='available':b.action==='ready'?['maintenance','retired'].includes(old.status):['available','maintenance'].includes(old.status);if(!allowed)throw new ConflictException();
   const status=b.action==='ready'?'available':String(b.action),[row]=await tx`UPDATE studio_os.equipment_assets SET status=${status},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
   await event(tx,who,id,null,String(b.action),old,row,note);return {id};
  });
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'resources');
  requireAdministrator(who);uuid(id);const b=objectInput(value,['offset']),offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  if(!(await this.db.client`SELECT id FROM studio_os.equipment_assets WHERE id=${id}`).length)throw new NotFoundException();
  const rows=await this.db.client`SELECT e.id,e.action,e.note,e.created_at AS "createdAt",coalesce(m.display_name,a.username) AS actor FROM studio_os.equipment_events e JOIN studio_os.accounts a ON a.id=e.actor_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE e.equipment_id=${id} ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET ${offset}`;
  const [n]=await this.db.client`SELECT count(*)::int AS n FROM studio_os.equipment_events WHERE equipment_id=${id}`;return {rows,total:n.n,offset,limit:50};
 }
}
