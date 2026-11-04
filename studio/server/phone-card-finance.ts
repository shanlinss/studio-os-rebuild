import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {objectInput,uuid,version,shortText,longText,optionalLongText} from './validation';
import {optionalMoney} from './money';
import {CardRow,cardSnapshot,day,today,expected,pageOffset,getCard,financialActor,writeCardOperation} from './phone-card-operations';
import {appendReminder,reminderLatest} from './phone-card-reminders';
const balanceProjection=`id,card_id AS "cardId",version,amount_cents AS "amountCents",observed_at AS "observedAt",card_snapshot AS "cardSnapshot",note,actor_name AS actor,created_at AS "createdAt"`;
const rechargeProjection=`v.id,v.recharge_id AS "rechargeId",v.card_id AS "cardId",v.version,v.previous_id AS "previousId",v.status,v.recharge_date::text AS "rechargeDate",v.amount_cents AS "amountCents",v.recharge_type AS "rechargeType",v.handler_kind AS "handlerKind",v.handler_member_id AS "handlerMemberId",v.handler_account_id AS "handlerAccountId",v.handler_name AS "handlerName",v.payer_kind AS "payerKind",v.payer_member_id AS "payerMemberId",v.payer_name AS "payerName",v.store_id AS "storeId",v.store_name AS "storeName",v.business_purpose AS "businessPurpose",v.note,v.expense_id AS "expenseId",v.expense_snapshot AS "expenseSnapshot",v.card_snapshot AS "cardSnapshot",v.reason,v.actor_name AS actor,v.created_at AS "createdAt",CASE WHEN v.expense_id IS NULL THEN false ELSE EXISTS(SELECT 1 FROM studio_os.expense_records e WHERE e.id=v.expense_id AND e.version<>(v.expense_snapshot->>'version')::int) END AS "sourceChanged"`;
async function latest(tx:TransactionSql,id:string,root:string,lock=false){const [r]=await tx`SELECT id FROM studio_os.phone_card_recharges WHERE id=${root} AND card_id=${id} ${lock?tx`FOR UPDATE`:tx``}`;if(!r)throw new NotFoundException();const [v]=await tx`SELECT * FROM studio_os.phone_card_recharge_versions WHERE recharge_id=${root} ORDER BY version DESC LIMIT 1`;if(!v)throw new NotFoundException();return v;}
async function balanceLatest(tx:TransactionSql,id:string){const [r]=await tx`SELECT ${tx.unsafe(balanceProjection)} FROM studio_os.phone_card_balances WHERE card_id=${id} ORDER BY version DESC LIMIT 1`;return r??null;}
function amount(v:unknown,signed=false,nullable=false){if(v===null&&nullable)return null;if(typeof v!=='string'||!new RegExp(signed?'^-?\\d{1,8}(?:\\.\\d{1,2})?$':'^\\d{1,8}(?:\\.\\d{1,2})?$').test(v))throw new BadRequestException('金额最多两位小数');const negative=v.startsWith('-'),n=optionalMoney(negative?v.slice(1):v);if(n===null||(!signed&&n<=0))throw new BadRequestException();return negative?-n:n;}
function instant(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|\+08:00)$/.test(v))throw new BadRequestException();day(v.slice(0,10));const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new BadRequestException();return d;}
async function member(tx:TransactionSql,id:string){const [m]=await tx`SELECT id,display_name FROM studio_os.members WHERE id=${id} FOR SHARE`;if(!m)throw new BadRequestException('经办人或付款人不存在');return m;}
async function operatorName(tx:TransactionSql,actor:Identity){const [m]=await tx`SELECT display_name FROM studio_os.members WHERE login_account_id=${actor.id}`;return m?.display_name||actor.username;}
async function insertVersion(tx:TransactionSql,card:CardRow,actor:Identity,root:string,v:number,previous:string|null,facts:Record<string,any>,status:string,reason:string,originalCard?:unknown){
 const row={recharge_id:root,card_id:card.id,version:v,previous_id:previous,status,...facts,card_snapshot:JSON.stringify(originalCard??cardSnapshot(card)),reason,actor_id:actor.id,actor_name:actor.username};
 await tx`INSERT INTO studio_os.phone_card_recharge_versions ${tx(row)}`;return {cardId:String(card.id),id:root,version:v};
}
export class PhoneCardFinance {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){
  const actor=await financialActor(this.db,who);id=uuid(id);return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const c=await getCard(tx,id);const [clock]=await tx`SELECT clock_timestamp() AS now`;return {serverNow:clock.now,card:{...cardSnapshot(c),status:c.status,storeId:c.store_id},today:today(),operatorName:await operatorName(tx,actor),balance:await balanceLatest(tx,id),reminder:await reminderLatest(tx,id)};});
 }
 async recharge(who:Identity,id:string,value:unknown,root?:string){
  id=uuid(id);if(root)root=uuid(root);
  const keys=['requestKey','expectedCardVersion','rechargeDate','amount','rechargeType','handlerKind','handlerMemberId','payerKind','payerMemberId','storeId','businessPurpose','expenseId','expenseVersion','note','reason',...(root?['expectedVersion']:['reminderMode','expectedReminderVersion','nextRechargeOn'])],b=objectInput(value,keys);if(keys.some(k=>!Object.hasOwn(b,k)))throw new BadRequestException();
  const key=uuid(b.requestKey),cv=version(b.expectedCardVersion),v=root?version(b.expectedVersion):0,date=day(b.rechargeDate),cents=amount(b.amount)!,type=shortText(b.rechargeType,80),handler=String(b.handlerKind),handlerId=b.handlerMemberId===null?null:uuid(b.handlerMemberId),payer=String(b.payerKind),payerId=b.payerMemberId===null?null:uuid(b.payerMemberId),store=b.storeId===null?null:uuid(b.storeId),purpose=shortText(b.businessPurpose,200),source=b.expenseId===null?null:uuid(b.expenseId),sourceVersion=source?version(b.expenseVersion):null,note=optionalLongText(b.note,2000),reason=longText(b.reason,2000);
  if(date>today()||!['operator','member',...(root?['preserve']:[])].includes(handler)||(handler==='member')!==(handlerId!==null)||!['company','member'].includes(payer)||(payer==='member')!==(payerId!==null)||(!source&&b.expenseVersion!==null))throw new BadRequestException('请核对实际充值日期、经办人和付款人');
  const reminderMode=root?'keep':String(b.reminderMode);if(!['keep','set','clear'].includes(reminderMode))throw new BadRequestException();
  const reminderVersion=!root&&reminderMode!=='keep'?expected(b.expectedReminderVersion):null,next=!root&&reminderMode==='set'?day(b.nextRechargeOn):null;if(!root&&((reminderMode==='keep'&&b.expectedReminderVersion!==null)||(reminderMode!=='set'&&b.nextRechargeOn!==null)))throw new BadRequestException();
  const body={id,root:root??null,cv,v,date,cents,type,handler,handlerId,payer,payerId,store,purpose,source,sourceVersion,note,reason,reminderMode,reminderVersion,next},action=root?'finance:correct:'+root:'finance:recharge:'+id;
  return writeCardOperation(this.db,who,id,cv,key,action,body,async(tx,card,actor)=>{
   const old=root?await latest(tx,id,root,true):null;if(old&&(old.version!==v||old.status!=='recorded'))throw new ConflictException('充值记录已变化或已作废');
   let expense=null;if(source){const [e]=await tx`SELECT id,version,expense_date::text AS "expenseDate",description,amount_cents AS "amountCents",payment_mode AS "paymentMode",payer_id AS "payerId",store_id AS "storeId" FROM studio_os.expense_records WHERE id=${source} FOR SHARE`;if(!e)throw new NotFoundException('原支出不可见');if(e.version!==sourceVersion)throw new ConflictException('原支出已变化，请重新核对');expense=e;}
   const handled=handler==='preserve'?{kind:old!.handler_kind,id:old!.handler_member_id,account:old!.handler_account_id,name:old!.handler_name}:handler==='member'?{kind:'member',id:handlerId,account:null,name:(await member(tx,handlerId!)).display_name}:{kind:'operator',id:null,account:actor.id,name:await operatorName(tx,actor)};
   const paidName=payerId?(await member(tx,payerId)).display_name:'公司付款';let storeName=null;if(store){const [s]=await tx`SELECT name FROM studio_os.stores WHERE id=${store} FOR SHARE`;if(!s)throw new BadRequestException('归属店铺不存在');storeName=s.name;}
   const facts={recharge_date:date,amount_cents:cents,recharge_type:type,handler_kind:handled.kind,handler_member_id:handled.id,handler_account_id:handled.account,handler_name:handled.name,payer_kind:payer,payer_member_id:payerId,payer_name:paidName,store_id:store,store_name:storeName,business_purpose:purpose,note,expense_id:source,expense_snapshot:expense?JSON.stringify(expense):null};
   let rootId=root;if(!rootId){const [r]=await tx`INSERT INTO studio_os.phone_card_recharges(card_id,created_by) VALUES(${id},${actor.id}) RETURNING id`;rootId=String(r.id);}
   const result=await insertVersion(tx,card,actor,rootId,v+1,old?.id??null,facts,'recorded',reason,old?.card_snapshot);
   if(reminderMode!=='keep')await appendReminder(tx,actor,card,reminderVersion!,next,'充值后调整下次提醒');return result;
  });
 }
 async void(who:Identity,id:string,root:string,value:unknown){
  id=uuid(id);root=uuid(root);const b=objectInput(value,['requestKey','expectedCardVersion','expectedVersion','reason']),key=uuid(b.requestKey),cv=version(b.expectedCardVersion),v=version(b.expectedVersion),reason=longText(b.reason,2000);
  return writeCardOperation(this.db,who,id,cv,key,'finance:void:'+root,{id,root,cv,v,reason},async(tx,card,actor)=>{const old=await latest(tx,id,root,true);if(old.version!==v||old.status!=='recorded')throw new ConflictException('充值已变化或已作废');const facts=Object.fromEntries(['recharge_date','amount_cents','recharge_type','handler_kind','handler_member_id','handler_account_id','handler_name','payer_kind','payer_member_id','payer_name','store_id','store_name','business_purpose','note','expense_id'].map(k=>[k,old[k]]));facts.expense_snapshot=old.expense_snapshot?JSON.stringify(old.expense_snapshot):null;return insertVersion(tx,card,actor,root,v+1,old.id,facts,'voided',reason,old.card_snapshot);});
 }
 async recharges(who:Identity,id:string,value:unknown){
  await financialActor(this.db,who);id=uuid(id);const b=objectInput(value,['offset','from','to','q','status','storeId']),offset=pageOffset(b.offset),from=b.from===undefined?null:day(b.from),to=b.to===undefined?null:day(b.to),q=b.q?shortText(b.q,100):'',status=b.status===undefined?'all':String(b.status),store=b.storeId===undefined?null:uuid(b.storeId);if((from&&to&&from>to)||!['all','recorded','voided'].includes(status))throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;await getCard(tx,id);
   const source=tx`FROM studio_os.phone_card_recharges r JOIN LATERAL(SELECT * FROM studio_os.phone_card_recharge_versions WHERE recharge_id=r.id ORDER BY version DESC LIMIT 1)v ON true`,where=tx`r.card_id=${id} AND (${from}::date IS NULL OR v.recharge_date>=${from}) AND (${to}::date IS NULL OR v.recharge_date<=${to}) AND (${status}='all' OR v.status=${status}) AND (${store}::uuid IS NULL OR v.store_id=${store}) AND strpos(lower(concat_ws(' ',v.recharge_type,v.handler_name,v.payer_name,v.store_name,v.business_purpose,v.note)),lower(${q}))>0`;
   const rows=await tx`SELECT ${tx.unsafe(rechargeProjection)} ${source} WHERE ${where} ORDER BY v.recharge_date DESC,r.created_at DESC,r.id LIMIT 50 OFFSET ${offset}`;
   const [summary]=await tx`SELECT count(*)::int AS total,count(*) FILTER(WHERE v.status='recorded')::int AS "recordedCount",count(*) FILTER(WHERE v.status='voided')::int AS "voidedCount",coalesce(sum(v.amount_cents) FILTER(WHERE v.status='recorded'),0)::text AS "amountCents" ${source} WHERE ${where}`;return {rows,total:summary.total,offset,limit:50,summary:{recordedCount:summary.recordedCount,voidedCount:summary.voidedCount,amountCents:summary.amountCents}};
  });
 }
 async rechargeDetail(who:Identity,id:string,root:string){await financialActor(this.db,who);id=uuid(id);root=uuid(root);const [r]=await this.db.client`SELECT ${this.db.client.unsafe(rechargeProjection)} FROM studio_os.phone_card_recharge_versions v WHERE v.card_id=${id} AND v.recharge_id=${root} ORDER BY v.version DESC LIMIT 1`;if(!r)throw new NotFoundException();return r;}
 async rechargeHistory(who:Identity,id:string,root:string,value:unknown){
  await financialActor(this.db,who);id=uuid(id);root=uuid(root);const b=objectInput(value,['offset']),offset=pageOffset(b.offset);return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;await latest(tx,id,root);const rows=await tx`SELECT ${tx.unsafe(rechargeProjection)} FROM studio_os.phone_card_recharge_versions v WHERE v.recharge_id=${root} ORDER BY v.version DESC LIMIT 50 OFFSET ${offset}`;const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.phone_card_recharge_versions WHERE recharge_id=${root}`;return {rows,total:n.n,offset,limit:50};});
 }
 async balance(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedCardVersion','expectedVersion','amount','observedAt','note']),key=uuid(b.requestKey),cv=version(b.expectedCardVersion),v=expected(b.expectedVersion),cents=amount(b.amount,true,true),when=instant(b.observedAt),note=longText(b.note,2000);
  return writeCardOperation(this.db,who,id,cv,key,'finance:balance:'+id,{id,cv,v,cents,when:when.toISOString(),note},async(tx,card,actor)=>{
   const last=await balanceLatest(tx,id),[clock]=await tx`SELECT clock_timestamp() AS present`;if((last?.version??0)!==v)throw new ConflictException('余额手记已变化');if(when.getTime()>new Date(clock.present).getTime()||(last&&when.getTime()<new Date(last.observedAt).getTime()))throw new ConflictException('查询时间不能晚于现在，也不能早于最近手记；同一查询时点可追加更正');
   const [r]=await tx`INSERT INTO studio_os.phone_card_balances(card_id,version,amount_cents,observed_at,card_snapshot,note,actor_id,actor_name) VALUES(${id},${v+1},${cents},${when.toISOString()},${JSON.stringify(cardSnapshot(card))}::jsonb,${note},${actor.id},${actor.username}) RETURNING id,version`;return {cardId:id,id:String(r.id),version:Number(r.version)};
  });
 }
 async balances(who:Identity,id:string,value:unknown){
  await financialActor(this.db,who);id=uuid(id);const b=objectInput(value,['offset']),offset=pageOffset(b.offset);return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;await getCard(tx,id);const rows=await tx`SELECT ${tx.unsafe(balanceProjection)} FROM studio_os.phone_card_balances WHERE card_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.phone_card_balances WHERE card_id=${id}`;return {rows,total:n.n,offset,limit:50};});
 }
}
