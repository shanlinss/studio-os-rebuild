import {mediaFile} from './media';
import {livePermission,currentPermission,freshIdentity,hasPermission} from './permissions';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {requireAdministrator,requireContributor} from './access';
import {objectInput,shortText,longText,optionalLongText,uuid,version} from './validation';

const optionalId=(v:unknown)=>v===null||v===undefined||v===''?null:uuid(v);
const project=`e.id,e.asset_tag AS "assetTag",e.name,e.model,e.device_type AS "deviceType",e.brand,e.image_id AS "imageId",(SELECT m.display_name FROM studio_os.equipment_loans l JOIN studio_os.members m ON m.id=l.member_id WHERE l.equipment_id=e.id AND l.returned_at IS NULL) AS "currentUserName",e.keeper_member_id AS "keeperMemberId",m.display_name AS "keeperName",e.location,e.status,e.version,e.created_at AS "createdAt",e.updated_at AS "updatedAt"`;
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
   if(action.startsWith('admin:handover:'))await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
   const [actor]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(action.startsWith('admin:'))await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'equipment:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.equipment_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException('请求标识已经用于其他内容');return old.result;}
   const result=await fn(tx);await tx`INSERT INTO studio_os.equipment_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('设备编号重复或设备已被借用');throw e;}
 }
 async receipt(who:Identity,key:string){who=await freshIdentity(this.db,who);requireContributor(who);uuid(key);const [r]=await this.db.client`SELECT action,result FROM studio_os.equipment_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r||(r.action.startsWith('admin:')&&!hasPermission(who,'resources')))throw new NotFoundException();return r.result;}
 private query(who:Identity,value:unknown,loans=false){
  requireContributor(who);const b=objectInput(value,loans?['view','status','offset']:['q','all','offset','assetStatus']);const offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  if(loans&&b.view!==undefined&&!['own','team'].includes(String(b.view)))throw new BadRequestException();if(!loans&&b.all!==undefined&&!['true','false'].includes(String(b.all)))throw new BadRequestException();
  const team=b.view==='team',all=b.all==='true';if(team||all){if(!hasPermission(who,'resources'))throw new ForbiddenException();}const status=b.status===undefined?'open':String(b.status);if(!['open','returned','all'].includes(status))throw new BadRequestException();
  const assetStatus=loans?'all':b.assetStatus===undefined?'all':String(b.assetStatus);if(!['all','available','on_loan','maintenance','retired'].includes(assetStatus))throw new BadRequestException();
  return {offset,team,all,status,assetStatus,q:b.q?shortText(b.q,100):''};
 }
 async catalog(who:Identity,value:unknown){
  who=await freshIdentity(this.db,who);const q=this.query(who,value);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const where=tx`(${q.all} OR e.status<>'retired') AND (${q.assetStatus}='all' OR e.status=${q.assetStatus}) AND strpos(lower(concat_ws(' ',e.asset_tag,e.name,e.model,e.device_type,e.brand,e.location,m.display_name,(SELECT n.display_name FROM studio_os.equipment_loans l JOIN studio_os.members n ON n.id=l.member_id WHERE l.equipment_id=e.id AND l.returned_at IS NULL))),lower(${q.q}))>0`;
   const rows=await tx`SELECT ${tx.unsafe(project)} FROM studio_os.equipment_assets e LEFT JOIN studio_os.members m ON m.id=e.keeper_member_id WHERE ${where} ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET ${q.offset}`;
   const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.equipment_assets e LEFT JOIN studio_os.members m ON m.id=e.keeper_member_id WHERE ${where}`;return {rows,total:n.n,offset:q.offset,limit:50};
  });
 }
 async detail(who:Identity,id:string){
  who=await freshIdentity(this.db,who);
  requireContributor(who);uuid(id);const [row]=await this.db.client`SELECT ${this.db.client.unsafe(project)},CASE WHEN ${hasPermission(who,'resources')} THEN e.notes ELSE '' END AS notes,CASE WHEN ${hasPermission(who,'resources')} THEN e.serial_number ELSE '' END AS "serialNumber",(SELECT jsonb_build_object('id',i.id,'name',i.name,'mime',i.mime,'size',octet_length(i.content)) FROM studio_os.equipment_images i WHERE i.id=e.image_id AND i.equipment_id=e.id) AS image FROM studio_os.equipment_assets e LEFT JOIN studio_os.members m ON m.id=e.keeper_member_id WHERE e.id=${id}`;if(!row)throw new NotFoundException();return row;
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
  requireAdministrator(who);if(id)uuid(id);const b=objectInput(value,['requestKey','assetTag','name','model','keeperMemberId','location','notes','deviceType','brand','serialNumber',...(id?['expectedVersion']:[])]);
  const extra=Object.fromEntries(['deviceType','brand','serialNumber'].filter(k=>Object.hasOwn(b,k)).map(k=>[k,optionalLongText(b[k],k==='deviceType'?80:k==='brand'?100:150)]));
  const tag=shortText(b.assetTag,64),name=shortText(b.name,120),model=optionalLongText(b.model,200),keeper=optionalId(b.keeperMemberId),location=shortText(b.location,150),notes=optionalLongText(b.notes,2000),expected=id?version(b.expectedVersion):0;
  return this.write(who,'admin:save:'+(id||'new'),b,async tx=>{
   const old=id?await asset(tx,id):null;if(old&&old.version!==expected)throw new ConflictException();if(old&&old.asset_tag!==tag)throw new ConflictException('设备编号登记后保持不变');if(keeper&&!(await tx`SELECT id FROM studio_os.members WHERE id=${keeper} FOR SHARE`).length)throw new BadRequestException();
   const [row]=id?await tx`UPDATE studio_os.equipment_assets SET device_type=${extra.deviceType??old!.device_type},brand=${extra.brand??old!.brand},serial_number=${extra.serialNumber??old!.serial_number},name=${name},model=${model},keeper_member_id=${keeper},location=${location},notes=${notes},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:await tx`INSERT INTO studio_os.equipment_assets(asset_tag,name,model,keeper_member_id,location,notes,created_by,device_type,brand,serial_number) VALUES(${tag},${name},${model},${keeper},${location},${notes},${who.id},${extra.deviceType??''},${extra.brand??''},${extra.serialNumber??''}) RETURNING *`;
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
 async image(who:Identity,id:string,imageId:string){
  requireContributor(await freshIdentity(this.db,who));uuid(id);uuid(imageId);
  const [r]=await this.db.client`SELECT i.name,i.mime,i.content FROM studio_os.equipment_images i JOIN studio_os.equipment_assets e ON e.id=i.equipment_id AND e.image_id=i.id WHERE e.id=${id} AND i.id=${imageId}`;if(!r)throw new NotFoundException();return r;
 }
 async uploadImage(who:Identity,id:string,bytes:unknown,name:unknown,mime:unknown,expected:unknown,key:unknown){
  uuid(id);const file=mediaFile(bytes,name,mime);if(!file.mime.startsWith('image/'))throw new BadRequestException('仅支持设备照片');
  const v=version(Number(expected)),b={requestKey:uuid(key),expectedVersion:v,name:file.name,mime:file.mime,digest:createHash('sha256').update(file.content).digest('hex')};
  return this.write(who,'admin:image:'+id,b,async tx=>{
   const old=await asset(tx,id);if(old.version!==v)throw new ConflictException('设备资料已变化');
   const [image]=await tx`INSERT INTO studio_os.equipment_images(equipment_id,name,mime,content,digest,actor_id) VALUES(${id},${file.name},${file.mime},${file.content},${b.digest},${who.id}) RETURNING id`;
   const [row]=await tx`UPDATE studio_os.equipment_assets SET image_id=${image.id},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
   await event(tx,who,id,null,'image-added',old,row);return {id};
  });
 }
 async removeImage(who:Identity,id:string,value:unknown){
  uuid(id);const b=objectInput(value,['requestKey','expectedVersion']),v=version(b.expectedVersion);
  return this.write(who,'admin:image-remove:'+id,b,async tx=>{
   const old=await asset(tx,id);if(old.version!==v||!old.image_id)throw new ConflictException('照片或设备版本已变化');
   const [row]=await tx`UPDATE studio_os.equipment_assets SET image_id=NULL,version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
   await event(tx,who,id,null,'image-removed',old,row);return {id};
  });
 }
 async handoverState(who:Identity,id:string){
  await currentPermission(this.db,who,'resources');uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [equipment]=await tx`SELECT id,name,asset_tag AS "assetTag",status,version FROM studio_os.equipment_assets WHERE id=${id}`;if(!equipment)throw new NotFoundException();
   const [current]=await tx`SELECT l.id,l.version,l.member_id AS "memberId",m.display_name AS "borrowerName",l.borrowed_at AS "borrowedAt" FROM studio_os.equipment_loans l JOIN studio_os.members m ON m.id=l.member_id WHERE l.equipment_id=${id} AND l.returned_at IS NULL`;
   const recipients=await tx`SELECT m.id,m.display_name AS "displayName" FROM studio_os.members m JOIN studio_os.accounts a ON a.id=m.login_account_id WHERE m.active AND a.active AND a.role IN('admin','employee') ORDER BY m.display_name,m.id`;
   return {equipment,currentLoan:current??null,recipients};
  });
 }
 async handover(who:Identity,id:string,value:unknown){
  uuid(id);const keys=['requestKey','expectedVersion','previousLoanId','previousLoanVersion','toMemberId','occurredAt','condition','location','note'],b=objectInput(value,keys);
  if(keys.some(k=>!Object.hasOwn(b,k)))throw new BadRequestException();
  const expected=version(b.expectedVersion),previous=b.previousLoanId===null?null:uuid(b.previousLoanId),previousVersion=previous?version(b.previousLoanVersion):null,to=uuid(b.toMemberId),condition=longText(b.condition,500),location=shortText(b.location,150),note=longText(b.note,2000);
  if(!previous&&b.previousLoanVersion!==null)throw new BadRequestException();
  if(typeof b.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|\+08:00)$/.test(b.occurredAt))throw new BadRequestException('请填写准确交接时间');
  const prefix=b.occurredAt.slice(0,10),date=new Date(prefix+'T00:00:00Z'),when=new Date(b.occurredAt);
  if(prefix.startsWith('0000')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==prefix||!Number.isFinite(when.getTime()))throw new BadRequestException('交接时间无效');
  return this.write(who,'admin:handover:'+id,b,async tx=>{
   const old=await asset(tx,id);if(old.version!==expected||!['available','on_loan'].includes(old.status))throw new ConflictException('设备版本或状态不支持交接');
   const [loan]=await tx`SELECT l.*,m.display_name FROM studio_os.equipment_loans l JOIN studio_os.members m ON m.id=l.member_id WHERE l.equipment_id=${id} AND l.returned_at IS NULL FOR UPDATE OF l`;
   if((loan?.id??null)!==previous||(loan?.version??null)!==previousVersion||(old.status==='on_loan')!==!!loan)throw new ConflictException('当前使用人已变化');
   if(loan?.member_id===to)throw new ConflictException('接收人已经是当前使用人');
   const [target]=await tx`SELECT m.id,m.login_account_id,m.display_name FROM studio_os.members m JOIN studio_os.accounts a ON a.id=m.login_account_id WHERE m.id=${to} AND m.active AND a.active AND a.role IN('admin','employee') FOR SHARE OF m,a`;if(!target)throw new ConflictException('接收人需要关联有效团队登录账号');
   const [boundary]=await tx`SELECT max(greatest(borrowed_at,coalesce(returned_at,borrowed_at))) AS latest,clock_timestamp() AS present FROM studio_os.equipment_loans WHERE equipment_id=${id}`;
   if(when.getTime()>new Date(boundary.present).getTime()||(boundary.latest&&when.getTime()<new Date(boundary.latest).getTime()))throw new ConflictException('交接时间不能晚于当前时间，也不能早于已有使用记录');
   if(loan)await tx`UPDATE studio_os.equipment_loans SET returned_at=${when.toISOString()},return_location=${old.location},return_condition='handover',return_note='管理员交接，原借用结束。',version=version+1 WHERE id=${loan.id}`;
   const [next]=await tx`INSERT INTO studio_os.equipment_loans(equipment_id,owner_id,member_id,location,note,borrowed_at) VALUES(${id},${target.login_account_id},${target.id},${location},'管理员交接登记的使用记录',${when.toISOString()}) RETURNING *`;
   const [actor]=await tx`SELECT username FROM studio_os.accounts WHERE id=${who.id}`;
   const [handover]=await tx`INSERT INTO studio_os.equipment_handovers(equipment_id,previous_loan_id,new_loan_id,from_member_id,to_member_id,from_name,to_name,occurred_at,condition,note,actor_id,actor_name) VALUES(${id},${loan?.id??null},${next.id},${loan?.member_id??null},${target.id},${loan?.display_name??null},${target.display_name},${when.toISOString()},${condition},${note},${who.id},${actor.username}) RETURNING id`;
   const [row]=await tx`UPDATE studio_os.equipment_assets SET status='on_loan',version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
   await event(tx,who,id,next.id,'handover',{asset:old,previousLoanId:loan?.id??null},{asset:row,newLoanId:next.id,handoverId:handover.id},'管理员交接，详见交接记录');return {id};
  });
 }
 async handovers(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'resources');uuid(id);const b=objectInput(value,['offset']),offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;if(!(await tx`SELECT id FROM studio_os.equipment_assets WHERE id=${id}`).length)throw new NotFoundException();
   const rows=await tx`SELECT id,previous_loan_id AS "previousLoanId",new_loan_id AS "newLoanId",from_name AS "fromName",to_name AS "toName",occurred_at AS "occurredAt",condition,note,actor_name AS actor,created_at AS "createdAt" FROM studio_os.equipment_handovers WHERE equipment_id=${id} ORDER BY occurred_at DESC,id DESC LIMIT 50 OFFSET ${offset}`;
   const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.equipment_handovers WHERE equipment_id=${id}`;return {rows,total:n.n,offset,limit:50};
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
