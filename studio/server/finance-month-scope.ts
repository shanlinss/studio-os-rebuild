import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,longText} from './validation';
import {attendanceMonth} from './attendance-monthly';
export async function monthScope(tx:TransactionSql,month:string){
 const [record]=await tx`SELECT v.id,v.month,v.version,v.reason,v.actor_name AS actor,v.created_at AS "createdAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.store_id,'name',s.store_name) ORDER BY s.store_id) FROM studio_os.finance_month_scope_stores s WHERE s.version_id=v.id),'[]'::jsonb) AS stores FROM studio_os.finance_month_scope_versions v WHERE month=${month} ORDER BY version DESC LIMIT 1`;return record??null;
}
export class FinanceMonthScope{
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','offset']),month=attendanceMonth(q.month),offset=Number(q.offset??0);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const stores=await tx`SELECT id,name,active,(created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS "registeredDate" FROM studio_os.stores ORDER BY name,id`,record=await monthScope(tx,month),history=await tx`SELECT v.id,v.version,v.reason,v.actor_name AS actor,v.created_at AS "createdAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.store_id,'name',s.store_name) ORDER BY s.store_id) FROM studio_os.finance_month_scope_stores s WHERE s.version_id=v.id),'[]'::jsonb) AS stores FROM studio_os.finance_month_scope_versions v WHERE v.month=${month} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`,[count]=await tx`SELECT count(*)::int AS total FROM studio_os.finance_month_scope_versions WHERE month=${month}`;return {month,record,stores,history:{rows:history,total:count.total,offset,limit:50}};});
 }
 async save(who:Identity,value:unknown){
  const b=objectInput(value,['requestKey','month','expectedVersion','storeIds','reason']),key=uuid(b.requestKey),month=attendanceMonth(b.month),reason=longText(b.reason,2000).trim();if(!reason||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>=2147483647||!Array.isArray(b.storeIds)||b.storeIds.length>1000)throw new BadRequestException();
  const ids=b.storeIds.map(uuid).sort();if(new Set(ids).size!==ids.length)throw new BadRequestException();const hash=createHash('sha256').update(JSON.stringify({month,reason,expectedVersion:b.expectedVersion,storeIds:ids})).digest('hex');
  return this.db.client.begin(async tx=>{const actor=await livePermission(tx,who.id,'finance');await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'finance-scope-request:'+who.id+':'+key},0))`;const [old]=await tx`SELECT month,request_hash,result FROM studio_os.finance_month_scope_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(old){if(old.month!==month||old.request_hash!==hash)throw new ConflictException();return old.result;}
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'finance-month-scope:'+month},0))`;const previous=await monthScope(tx,month);if((previous?.version??0)!==b.expectedVersion)throw new ConflictException('本月经营店铺范围已有新版本');const stores=await tx`SELECT id,name FROM studio_os.stores WHERE id=ANY(${tx.array(ids)}::uuid[]) ORDER BY id FOR SHARE`;if(stores.length!==ids.length)throw new BadRequestException('店铺不存在');
   const [r]=await tx`INSERT INTO studio_os.finance_month_scope_versions(month,version,reason,actor_id,actor_name) VALUES(${month},${Number(b.expectedVersion)+1},${reason},${who.id},${actor.username}) RETURNING id,version`;for(const s of stores)await tx`INSERT INTO studio_os.finance_month_scope_stores(version_id,store_id,store_name) VALUES(${r.id},${s.id},${s.name})`;const result={month,recordId:r.id,version:r.version};await tx`INSERT INTO studio_os.finance_month_scope_receipts(actor_id,request_key,month,request_hash,result) VALUES(${who.id},${key},${month},${hash},${JSON.stringify(result)}::jsonb)`;return result;});
 }
 async receipt(who:Identity,key:string,month:string){await currentPermission(this.db,who,'finance');key=uuid(key);month=attendanceMonth(month);const [r]=await this.db.client`SELECT result FROM studio_os.finance_month_scope_receipts WHERE actor_id=${who.id} AND request_key=${key} AND month=${month}`;if(!r)throw new NotFoundException();return r.result;}
}
