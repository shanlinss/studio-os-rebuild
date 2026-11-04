import {ConflictException} from '@nestjs/common';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission} from './permissions';
import {objectInput,uuid,version,longText} from './validation';
import {cardSnapshot,CardRow,day,today,expected,pageOffset,getCard,writeCardOperation} from './phone-card-operations';
export const reminderProjection=`id,card_id AS "cardId",version,next_recharge_on::text AS "nextRechargeOn",card_snapshot AS "cardSnapshot",note,actor_name AS actor,created_at AS "createdAt"`;
export async function reminderLatest(tx:TransactionSql,id:string){const [r]=await tx`SELECT ${tx.unsafe(reminderProjection)} FROM studio_os.phone_card_reminder_versions WHERE card_id=${id} ORDER BY version DESC LIMIT 1`;return r??null;}
export async function appendReminder(tx:TransactionSql,actor:Identity,card:CardRow,v:number,next:string|null,note:string){
 const last=await reminderLatest(tx,card.id);if((last?.version??0)!==v)throw new ConflictException('充值提醒已变化');
 const [r]=await tx`INSERT INTO studio_os.phone_card_reminder_versions(card_id,version,next_recharge_on,card_snapshot,note,actor_id,actor_name) VALUES(${card.id},${v+1},${next},${JSON.stringify(cardSnapshot(card))}::jsonb,${note},${actor.id},${actor.username}) RETURNING id,version`;return {cardId:String(card.id),id:String(r.id),version:Number(r.version)};
}
export class PhoneCardReminders {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){await currentPermission(this.db,who,'resources');id=uuid(id);return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const c=await getCard(tx,id);return {card:{...cardSnapshot(c),status:c.status},latest:await reminderLatest(tx,id)};});}
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedCardVersion','expectedVersion','nextRechargeOn','note']),key=uuid(b.requestKey),cv=version(b.expectedCardVersion),v=expected(b.expectedVersion),next=b.nextRechargeOn===null?null:day(b.nextRechargeOn),note=longText(b.note,2000);
  return writeCardOperation(this.db,who,id,cv,key,'reminder:set:'+id,{id,cv,v,next,note},(tx,c,a)=>appendReminder(tx,a,c,v,next,note));
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'resources');id=uuid(id);const b=objectInput(value,['offset']),offset=pageOffset(b.offset);
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;await getCard(tx,id);const rows=await tx`SELECT ${tx.unsafe(reminderProjection)} FROM studio_os.phone_card_reminder_versions WHERE card_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.phone_card_reminder_versions WHERE card_id=${id}`;return {rows,total:count.n,offset,limit:50};});
 }
 async catalog(who:Identity,value:unknown){
  await currentPermission(this.db,who,'resources');const b=objectInput(value,['until','offset']),until=b.until===undefined?today():day(b.until),offset=pageOffset(b.offset),asOf=today();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const cte=tx`WITH facts AS(SELECT c.id AS "cardId",c.card_code AS "cardCode",c.phone_number AS "phoneNumber",c.status,c.plan_expires_on::text AS "planExpiresOn",r.next_recharge_on::text AS "nextRechargeOn",m.display_name AS "userName",e.name AS "deviceName",s.name AS "storeName",array_remove(ARRAY[
    CASE WHEN c.plan_expires_on<=${until}::date THEN 'plan-expiry' END,
    CASE WHEN r.next_recharge_on<=${until}::date THEN 'recharge-date' END,
    CASE WHEN c.status='active' AND c.user_member_id IS NULL THEN 'missing-user' END,
    CASE WHEN c.status='active' AND c.user_member_id IS NOT NULL AND NOT m.active THEN 'inactive-user' END,
    CASE WHEN c.status='active' AND c.device_id IS NULL THEN 'missing-device' END,
    CASE WHEN c.status='active' AND e.status='retired' THEN 'retired-device' END,
    CASE WHEN c.status='active' AND NOT EXISTS(SELECT 1 FROM studio_os.phone_card_accounts l WHERE l.card_id=c.id) THEN 'missing-account' END,
    CASE WHEN c.status='active' AND EXISTS(SELECT 1 FROM studio_os.phone_card_accounts l WHERE l.card_id=c.id) AND NOT EXISTS(SELECT 1 FROM studio_os.phone_card_accounts l JOIN studio_os.business_accounts a ON a.id=l.account_id JOIN studio_os.members n ON n.id=a.responsible_member_id WHERE l.card_id=c.id AND a.active AND n.active) THEN 'inactive-accounts' END
   ],NULL) AS issues FROM studio_os.phone_cards c LEFT JOIN LATERAL(SELECT next_recharge_on FROM studio_os.phone_card_reminder_versions WHERE card_id=c.id ORDER BY version DESC LIMIT 1)r ON true LEFT JOIN studio_os.members m ON m.id=c.user_member_id LEFT JOIN studio_os.equipment_assets e ON e.id=c.device_id LEFT JOIN studio_os.stores s ON s.id=c.store_id WHERE c.status<>'retired'),pending AS(SELECT * FROM facts WHERE cardinality(issues)>0)`;
   const rows=await tx`${cte} SELECT * FROM pending ORDER BY least("planExpiresOn","nextRechargeOn") NULLS LAST,"cardCode","cardId" LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`${cte} SELECT count(*)::int AS n FROM pending`;return {rows,total:count.n,offset,limit:50,until,asOf};
  });
 }
}
