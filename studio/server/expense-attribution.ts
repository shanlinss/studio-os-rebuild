import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import type {TransactionSql} from 'postgres';
import {livePermission,currentPermission} from './permissions';
import {objectInput,uuid,version,longText} from './validation';
export function expenseClassification(scope:unknown,use:unknown,store:string|null){
 if(typeof scope!=='string'||!['public','store','unclassified'].includes(scope)||typeof use!=='string'||!['operating','inventory','prepaid','unclassified'].includes(use)||scope==='public'&&store!==null||scope==='store'&&store===null)throw new BadRequestException('请核对费用归属、用途和店铺');
 return {scope,use};
}
export async function attributionStore(tx:TransactionSql,store:string|null,old:string|null){if(store){const [r]=await tx`SELECT active FROM studio_os.stores WHERE id=${store} FOR SHARE`;if(!r||!r.active&&store!==old)throw new ConflictException('请选择启用店铺；可保留原历史店铺');}}
export class ExpenseAttribution{
 constructor(private readonly db:StudioDatabase){}
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','expenseScope','expenseUse','storeId','reason']),key=uuid(b.requestKey),expected=version(b.expectedVersion),store=b.storeId===null?null:uuid(b.storeId),reason=longText(b.reason,2000);
  if(expected>=2147483647)throw new BadRequestException();
  const {scope,use}=expenseClassification(b.expenseScope,b.expenseUse,store),hash=createHash('sha256').update(JSON.stringify({id,expected,scope,use,store,reason})).digest('hex');
  return this.db.client.begin(async tx=>{
   await livePermission(tx,who.id,'finance');await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'expense-attribution:'+who.id+':'+key},0))`;
   const [receipt]=await tx`SELECT expense_id,request_hash,result FROM studio_os.expense_attribution_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(receipt){if(receipt.expense_id!==id||receipt.request_hash!==hash)throw new ConflictException('请求标识已用于其他费用归属');return receipt.result;}
   const [before]=await tx`SELECT * FROM studio_os.expense_records WHERE id=${id} FOR UPDATE`;
   if(!before)throw new NotFoundException();if(before.version!==expected)throw new ConflictException('支出或归属已变化，请重新核对');
   await attributionStore(tx,store,before.store_id);
   const [row]=await tx`UPDATE studio_os.expense_records SET expense_scope=${scope},expense_use=${use},store_id=${store},version=version+1,updated_at=now() WHERE id=${id} RETURNING id,version`;
   await tx`INSERT INTO studio_os.expense_events(entity_type,entity_id,actor_id,action,detail) VALUES('expense',${id},${who.id},'attributed',${JSON.stringify({before,after:{expenseScope:scope,expenseUse:use,storeId:store},reason})}::jsonb)`;
   await tx`INSERT INTO studio_os.expense_attribution_receipts(actor_id,request_key,expense_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(row)}::jsonb)`;
   return row;
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);key=uuid(key);
  const [r]=await this.db.client`SELECT result FROM studio_os.expense_attribution_receipts WHERE actor_id=${who.id} AND expense_id=${id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;
 }
}
