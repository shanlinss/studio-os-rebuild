import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {livePermission,currentPermission} from './permissions';
import {objectInput,uuid,version,longText,optionalLongText} from './validation';
import {optionalMoney} from './money';

const projection=`id,equipment_id AS "equipmentId",version,purchase_date::text AS "purchaseDate",amount_cents AS "amountCents",supplier,expense_id AS "expenseId",expense_snapshot AS "expenseSnapshot",equipment_snapshot AS "equipmentSnapshot",reason,actor_name AS actor,created_at AS "createdAt"`;
function day(value:unknown){
 if(value===null)return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))throw new BadRequestException('采购日期无效');
 const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new BadRequestException('采购日期无效');return value;
}
async function expense(tx:TransactionSql,id:string,lock=false){const [r]=await tx`SELECT id,version,expense_date::text AS "expenseDate",description,amount_cents AS "amountCents" FROM studio_os.expense_records WHERE id=${id} ${lock?tx`FOR SHARE`:tx``}`;if(!r)throw new NotFoundException('原支出暂不可见');return r;}
export class EquipmentPurchase {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [equipment]=await tx`SELECT id,asset_tag AS "assetTag",name,status FROM studio_os.equipment_assets WHERE id=${id}`;if(!equipment)throw new NotFoundException();
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.equipment_purchase_versions WHERE equipment_id=${id} ORDER BY version DESC LIMIT 1`;
   const linkedExpense=record?.expenseId?await expense(tx,record.expenseId):null;
   return {equipment,record:record??null,linkedExpense,sourceChanged:!!linkedExpense&&linkedExpense.version!==record.expenseSnapshot.version};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const keys=['requestKey','expectedVersion','purchaseDate','amount','supplier','expenseId','expenseVersion','reason'],b=objectInput(value,keys);
  if(keys.some(k=>!Object.hasOwn(b,k))||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>2147483647)throw new BadRequestException();
  const key=uuid(b.requestKey),expected=Number(b.expectedVersion),date=day(b.purchaseDate),amount=optionalMoney(b.amount),supplier=optionalLongText(b.supplier,150),source=b.expenseId===null?null:uuid(b.expenseId),sourceVersion=source?version(b.expenseVersion):null,reason=longText(b.reason,2000);
  if((b.amount!==null&&typeof b.amount!=='string')||typeof b.supplier!=='string'||(!source&&b.expenseVersion!==null))throw new BadRequestException();
  const hash=createHash('sha256').update(JSON.stringify({id,expected,date,amount,supplier,source,sourceVersion,reason})).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'equipment-purchase:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT equipment_id,request_hash,result FROM studio_os.equipment_purchase_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.equipment_id!==id||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return old.result;}
   const [equipment]=await tx`SELECT id,asset_tag AS "assetTag",name,status FROM studio_os.equipment_assets WHERE id=${id} FOR UPDATE`;if(!equipment)throw new NotFoundException();
   const [latest]=await tx`SELECT version FROM studio_os.equipment_purchase_versions WHERE equipment_id=${id} ORDER BY version DESC LIMIT 1`;
   if((latest?.version??0)!==expected)throw new ConflictException('采购资料已变化，请重新读取');
   const snapshot=source?await expense(tx,source,true):null;if(snapshot&&snapshot.version!==sourceVersion)throw new ConflictException('关联支出已变化，请重新核对');
   const [record]=await tx`INSERT INTO studio_os.equipment_purchase_versions(equipment_id,version,purchase_date,amount_cents,supplier,expense_id,expense_snapshot,equipment_snapshot,reason,actor_id,actor_name) VALUES(${id},${expected+1},${date},${amount},${supplier},${source},${snapshot?JSON.stringify(snapshot):null}::jsonb,${JSON.stringify(equipment)}::jsonb,${reason},${who.id},${actor.username}) RETURNING id,version`;
   const result={id,recordId:record.id,version:record.version};
   await tx`INSERT INTO studio_os.equipment_purchase_receipts(actor_id,request_key,equipment_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const b=objectInput(value,['offset']),offset=b.offset===undefined?0:Number(b.offset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   if(!(await tx`SELECT id FROM studio_os.equipment_assets WHERE id=${id}`).length)throw new NotFoundException();
   const rows=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.equipment_purchase_versions WHERE equipment_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;
   const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.equipment_purchase_versions WHERE equipment_id=${id}`;return {rows,total:n.n,offset,limit:50};
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);key=uuid(key);
  const [r]=await this.db.client`SELECT result FROM studio_os.equipment_purchase_receipts WHERE actor_id=${who.id} AND equipment_id=${id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;
 }
}
