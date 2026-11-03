import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission,requirePermission} from './permissions';
import {objectInput,uuid,shortText,optionalLongText,longText,version} from './validation';

const statuses=['active','spare','suspended','retired'];
const projection=`c.id,c.card_code AS "cardCode",c.phone_number AS "phoneNumber",c.carrier,c.status,c.user_member_id AS "userMemberId",m.display_name AS "userName",c.device_id AS "deviceId",e.name AS "deviceName",e.asset_tag AS "deviceTag",c.store_id AS "storeId",s.name AS "storeName",c.plan_description AS "planDescription",c.plan_expires_on::text AS "planExpiresOn",c.notes,c.version,c.created_at AS "createdAt",c.updated_at AS "updatedAt",(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'active',a.active) ORDER BY a.name,a.id),'[]'::jsonb) FROM studio_os.phone_card_accounts l JOIN studio_os.business_accounts a ON a.id=l.account_id WHERE l.card_id=c.id) AS accounts`;
const joins=`FROM studio_os.phone_cards c LEFT JOIN studio_os.members m ON m.id=c.user_member_id LEFT JOIN studio_os.equipment_assets e ON e.id=c.device_id LEFT JOIN studio_os.stores s ON s.id=c.store_id`;
const identityProjection=`id,card_id AS "cardId",version,registered_entity AS "registeredEntity",card_snapshot AS "cardSnapshot",reason,actor_name AS actor,created_at AS "createdAt"`;
const optionalId=(v:unknown)=>v===null?null:uuid(v);
function date(v:unknown){if(v===null)return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))throw new BadRequestException();const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw new BadRequestException();return v;}
function offset(value:unknown){const b=objectInput(value,['offset']),n=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw new BadRequestException();return n;}
async function snapshot(tx:TransactionSql,id:string){const [r]=await tx`SELECT ${tx.unsafe(projection)} ${tx.unsafe(joins)} WHERE c.id=${id}`;if(!r)throw new NotFoundException();return r;}
async function locked(tx:TransactionSql,id:string){const [r]=await tx`SELECT id,version,card_code,phone_number FROM studio_os.phone_cards WHERE id=${id} FOR UPDATE`;if(!r)throw new NotFoundException();return r;}

export class PhoneCards {
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,action:string,key:string,body:unknown,fn:(tx:TransactionSql,actor:Identity)=>Promise<{id:string,version:number}>){
  const hash=createHash('sha256').update(JSON.stringify({action,body})).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'resources');if(action.startsWith('identity:'))await livePermission(tx,who.id,'resource_identity');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'phone-card:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.phone_card_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return old.result;}
   const result=await fn(tx,actor);await tx`INSERT INTO studio_os.phone_card_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('手机卡编号或在用号码重复');throw e;}
 }
 async receipt(who:Identity,key:string){
  const actor=await currentPermission(this.db,who,'resources');key=uuid(key);const [r]=await this.db.client`SELECT action,result FROM studio_os.phone_card_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r)throw new NotFoundException();if(r.action.startsWith('identity:'))requirePermission(actor,'resource_identity');return {...r.result,action:r.action};
 }
 async catalog(who:Identity,value:unknown){
  await currentPermission(this.db,who,'resources');const b=objectInput(value,['q','status','deviceId','accountId','storeId','offset']),n=offset({offset:b.offset}),q=b.q?shortText(b.q,100):'',status=b.status===undefined?'current':String(b.status),device=b.deviceId===undefined?null:uuid(b.deviceId),account=b.accountId===undefined?null:uuid(b.accountId),store=b.storeId===undefined?null:uuid(b.storeId);
  if(!['current','all',...statuses].includes(status))throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const where=tx`(${status}='all' OR (${status}='current' AND c.status<>'retired') OR c.status=${status}) AND (${device}::uuid IS NULL OR c.device_id=${device}) AND (${store}::uuid IS NULL OR c.store_id=${store}) AND (${account}::uuid IS NULL OR EXISTS(SELECT 1 FROM studio_os.phone_card_accounts l WHERE l.card_id=c.id AND l.account_id=${account})) AND strpos(lower(concat_ws(' ',c.card_code,c.phone_number,c.carrier,c.plan_description,m.display_name,e.name,e.asset_tag,s.name,(SELECT string_agg(a.name,' ') FROM studio_os.phone_card_accounts l JOIN studio_os.business_accounts a ON a.id=l.account_id WHERE l.card_id=c.id))),lower(${q}))>0`;
   const rows=await tx`SELECT ${tx.unsafe(projection)} ${tx.unsafe(joins)} WHERE ${where} ORDER BY c.updated_at DESC,c.id LIMIT 50 OFFSET ${n}`;
   const [count]=await tx`SELECT count(*)::int AS n ${tx.unsafe(joins)} WHERE ${where}`;return {rows,total:count.n,offset:n,limit:50};
  });
 }
 async detail(who:Identity,id:string){await currentPermission(this.db,who,'resources');id=uuid(id);return this.db.client.begin(tx=>snapshot(tx,id));}
 async options(who:Identity){
  await currentPermission(this.db,who,'resources');return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   return {members:await tx`SELECT id,display_name AS name,active FROM studio_os.members ORDER BY display_name,id`,devices:await tx`SELECT id,name,asset_tag AS "assetTag",status FROM studio_os.equipment_assets ORDER BY asset_tag,id`,accounts:await tx`SELECT id,name,active FROM studio_os.business_accounts ORDER BY name,id`,stores:await tx`SELECT id,name,active FROM studio_os.stores ORDER BY name,id`};
  });
 }
 async save(who:Identity,value:unknown,id?:string){
  if(id)id=uuid(id);const keys=['requestKey','cardCode','phoneNumber','carrier','status','userMemberId','deviceId','storeId','accountIds','planDescription','planExpiresOn','notes','reason',...(id?['expectedVersion']:[])],b=objectInput(value,keys);
  if(keys.some(k=>!Object.hasOwn(b,k))||!Array.isArray(b.accountIds)||b.accountIds.length>100||typeof b.status!=='string'||!statuses.includes(b.status))throw new BadRequestException('手机卡资料不完整');
  const key=uuid(b.requestKey),expected=id?version(b.expectedVersion):0,code=shortText(b.cardCode,64),phone=shortText(b.phoneNumber,40),carrier=optionalLongText(b.carrier,100),user=optionalId(b.userMemberId),device=optionalId(b.deviceId),store=optionalId(b.storeId),accounts=(b.accountIds as unknown[]).map(uuid).sort(),plan=optionalLongText(b.planDescription,1000),expires=date(b.planExpiresOn),notes=optionalLongText(b.notes,2000),reason=longText(b.reason,2000),status=b.status;
  if(!/^\+?[0-9][0-9 ()-]{2,39}$/.test(phone)||phone.replace(/\D/g,'').length<3||new Set(accounts).size!==accounts.length)throw new BadRequestException('请核对号码和账号关联');
  const body={id:id??null,expected,code,phone,carrier,status,user,device,store,accounts,plan,expires,notes,reason};
  return this.write(who,'save:'+(id??'new'),key,body,async(tx,actor)=>{
   if(id)await locked(tx,id);const before=id?await snapshot(tx,id):null;if(before&&(before.version!==expected||before.cardCode!==code))throw new ConflictException('卡编号登记后保持不变，请核对版本');
   // Match existing resource writers: device/account locks precede member locks.
   if(device){const [r]=await tx`SELECT status FROM studio_os.equipment_assets WHERE id=${device} FOR SHARE`;if(!r||(r.status==='retired'&&before?.deviceId!==device))throw new ConflictException('关联设备不可用');}
   const found=await tx`SELECT id,active FROM studio_os.business_accounts WHERE id=ANY(${tx.array(accounts)}::uuid[]) ORDER BY id FOR SHARE`,oldAccounts=new Set<string>((before?.accounts??[]).map((r:any)=>r.id));
   if(found.length!==accounts.length||found.some(r=>!r.active&&!oldAccounts.has(r.id)))throw new ConflictException('关联运营账号不可用');
   if(user){const [r]=await tx`SELECT active FROM studio_os.members WHERE id=${user} FOR SHARE`;if(!r||(!r.active&&before?.userMemberId!==user))throw new ConflictException('使用人不可用');}
   if(store){const [r]=await tx`SELECT active FROM studio_os.stores WHERE id=${store} FOR SHARE`;if(!r||(!r.active&&before?.storeId!==store))throw new ConflictException('关联店铺不可用');}
   const [r]=id?await tx`UPDATE studio_os.phone_cards SET phone_number=${phone},carrier=${carrier},status=${status},user_member_id=${user},device_id=${device},store_id=${store},plan_description=${plan},plan_expires_on=${expires},notes=${notes},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`:await tx`INSERT INTO studio_os.phone_cards(card_code,phone_number,carrier,status,user_member_id,device_id,store_id,plan_description,plan_expires_on,notes,created_by) VALUES(${code},${phone},${carrier},${status},${user},${device},${store},${plan},${expires},${notes},${who.id}) RETURNING id,version`;
   await tx`DELETE FROM studio_os.phone_card_accounts WHERE card_id=${r.id}`;for(const account of accounts)await tx`INSERT INTO studio_os.phone_card_accounts(card_id,account_id) VALUES(${r.id},${account})`;
   const after=await snapshot(tx,r.id);await tx`INSERT INTO studio_os.phone_card_events(card_id,actor_id,actor_name,reason,before_value,after_value) VALUES(${r.id},${who.id},${actor.username},${reason},${before?JSON.stringify(before):null}::jsonb,${JSON.stringify(after)}::jsonb)`;return {id:String(r.id),version:Number(r.version)};
  });
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'resources');id=uuid(id);const n=offset(value);
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;if(!(await tx`SELECT id FROM studio_os.phone_cards WHERE id=${id}`).length)throw new NotFoundException();const rows=await tx`SELECT id,actor_name AS actor,reason,before_value AS "beforeValue",after_value AS "afterValue",created_at AS "createdAt" FROM studio_os.phone_card_events WHERE card_id=${id} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ${n}`;const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.phone_card_events WHERE card_id=${id}`;return {rows,total:count.n,offset:n,limit:50};});
 }
 async identity(who:Identity,id:string,value:unknown){
  const actor=await currentPermission(this.db,who,'resources');requirePermission(actor,'resource_identity');id=uuid(id);const n=offset(value);
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;if(!(await tx`SELECT id FROM studio_os.phone_cards WHERE id=${id}`).length)throw new NotFoundException();const rows=await tx`SELECT ${tx.unsafe(identityProjection)} FROM studio_os.phone_card_identities WHERE card_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${n}`;const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.phone_card_identities WHERE card_id=${id}`;return {rows,total:count.n,offset:n,limit:50};});
 }
 async saveIdentity(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','expectedCardVersion','registeredEntity','reason']);if(!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>2147483646||!Object.hasOwn(b,'registeredEntity'))throw new BadRequestException();
  const key=uuid(b.requestKey),expected=Number(b.expectedVersion),expectedCard=version(b.expectedCardVersion),entity=b.registeredEntity===null?null:shortText(b.registeredEntity,200),reason=longText(b.reason,2000);
  return this.write(who,'identity:'+id,key,{id,expected,expectedCard,entity,reason},async(tx,actor)=>{const card=await locked(tx,id);if(card.version!==expectedCard)throw new ConflictException('手机卡资料已变化，请重新核对实名号码');const [last]=await tx`SELECT version FROM studio_os.phone_card_identities WHERE card_id=${id} ORDER BY version DESC LIMIT 1`;if((last?.version??0)!==expected)throw new ConflictException('实名资料已变化');const [r]=await tx`INSERT INTO studio_os.phone_card_identities(card_id,version,registered_entity,card_snapshot,reason,actor_id,actor_name) VALUES(${id},${expected+1},${entity},${JSON.stringify({id,cardCode:card.card_code,phoneNumber:card.phone_number,version:card.version})}::jsonb,${reason},${who.id},${actor.username}) RETURNING version`;return {id,version:Number(r.version)};});
 }
}
