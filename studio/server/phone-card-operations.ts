import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission,requirePermission} from './permissions';
import {uuid} from './validation';
export type CardRow=Record<string,any>;
export const cardSnapshot=(c:CardRow)=>({id:c.id,cardCode:c.card_code,phoneNumber:c.phone_number,version:c.version});
export function day(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))throw new BadRequestException();const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw new BadRequestException();return v;}
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function expected(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>2147483646)throw new BadRequestException();return Number(v);}
export function pageOffset(v:unknown){const n=v===undefined?0:Number(v);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw new BadRequestException();return n;}
export async function getCard(tx:TransactionSql,id:string,lock=false){const [c]=await tx`SELECT id,card_code,phone_number,version,status,store_id FROM studio_os.phone_cards WHERE id=${id} ${lock?tx`FOR UPDATE`:tx``}`;if(!c)throw new NotFoundException();return c;}
export async function financialActor(db:StudioDatabase,who:Identity){const actor=await currentPermission(db,who,'resources');requirePermission(actor,'finance');return actor;}
export async function writeCardOperation(db:StudioDatabase,who:Identity,id:string,cardVersion:number,key:string,action:string,body:unknown,fn:(tx:TransactionSql,c:CardRow,actor:Identity)=>Promise<{cardId:string,id:string,version:number}>){
 const hash=createHash('sha256').update(JSON.stringify({action,body})).digest('hex');
 return db.client.begin(async tx=>{
  const actor=await livePermission(tx,who.id,'resources');if(action.startsWith('finance:'))requirePermission(actor,'finance');
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'phone-card-operation:'+who.id+':'+key},0))`;
  const [old]=await tx`SELECT action,request_hash,result FROM studio_os.phone_card_operation_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
  if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return old.result;}
  const card=await getCard(tx,id,true);if(card.version!==cardVersion)throw new ConflictException('手机卡资料已变化，请重新核对号码');
  const result=await fn(tx,card,actor);await tx`INSERT INTO studio_os.phone_card_operation_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
 });
}
export async function cardOperationReceipt(db:StudioDatabase,who:Identity,key:string){
 const actor=await currentPermission(db,who,'resources');key=uuid(key);const [r]=await db.client`SELECT action,result FROM studio_os.phone_card_operation_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r)throw new NotFoundException();if(r.action.startsWith('finance:'))requirePermission(actor,'finance');return {...r.result,action:r.action};
}
