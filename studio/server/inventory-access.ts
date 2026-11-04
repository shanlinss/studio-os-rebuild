import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,databaseIdentity,hasPermission} from './permissions';
import {objectInput,uuid,version,longText} from './validation';

type Grant={storeId:string|null,canMove:boolean};
const scopeKey=(g:Grant)=>g.storeId??'public';
async function grants(tx:TransactionSql,id:string){
 return tx`SELECT g.store_id AS "storeId",g.can_move AS "canMove",s.name AS "storeName",s.active AS "storeActive" FROM studio_os.inventory_access_grants g LEFT JOIN studio_os.stores s ON s.id=g.store_id WHERE g.account_id=${id} ORDER BY g.scope_key`;
}
function input(value:unknown){
 const b=objectInput(value,['requestKey','expectedVersion','grants','reason']),key=uuid(b.requestKey),expected=version(b.expectedVersion),reason=longText(b.reason,2000);
 if(!Array.isArray(b.grants)||b.grants.length>100)throw new BadRequestException('最多设置100个明确范围');
 const rows:Grant[]=b.grants.map(v=>{const g=objectInput(v,['storeId','canMove']);if(typeof g.canMove!=='boolean')throw new BadRequestException();return {storeId:g.storeId===null?null:uuid(g.storeId),canMove:g.canMove};}).sort((a,b)=>scopeKey(a).localeCompare(scopeKey(b),'en'));
 if(new Set(rows.map(scopeKey)).size!==rows.length)throw new BadRequestException('库存范围不能重复');
 return {key,expected,reason,rows};
}

export class InventoryAccess {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){
  await currentPermission(this.db,who,'account_security');uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [account]=await tx`SELECT id,username,active,version FROM studio_os.accounts WHERE id=${id}`;if(!account)throw new NotFoundException();
   return {...account,grants:await grants(tx,id),quantityOperationsAvailable:true};
  });
 }
 async mine(who:Identity){
  // Read identity and grants in one snapshot. Never trust a supplied role or store list.
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [account]=await tx`SELECT id,username,role,active,superadmin,admin_permissions FROM studio_os.accounts WHERE id=${who.id}`;if(!account?.active)throw new UnauthorizedException();
   const rows=await grants(tx,who.id);
   return {canManageAll:hasPermission(databaseIdentity(account),'resources'),grants:rows.filter(g=>g.storeId===null||g.storeActive),quantityOperationsAvailable:true};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  if(!who)throw new UnauthorizedException();uuid(id);const {key,expected,reason,rows}=input(value);
  const hash=createHash('sha256').update(JSON.stringify({id,expected,reason,rows})).digest('hex');
  return this.db.client.begin(async tx=>{
   // Same fence and account version as original role, lifecycle and sensitive-grant edits.
   await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-account-access',0))`;
   const [actor]=await tx`SELECT id,username,active,role,superadmin FROM studio_os.accounts WHERE id=${who.id} FOR UPDATE`;
   if(!actor?.active)throw new UnauthorizedException();if(actor.role!=='admin'||!actor.superadmin)throw new ForbiddenException();
   const [receipt]=await tx`SELECT account_id,request_hash,result FROM studio_os.inventory_access_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(receipt){if(receipt.account_id!==id||receipt.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return receipt.result;}
   const [account]=await tx`SELECT id,username,active,version FROM studio_os.accounts WHERE id=${id} FOR UPDATE`;
   if(!account)throw new NotFoundException();if(account.version!==expected||!account.active)throw new ConflictException('账号已变化或已停用，请重新读取');
   const before=await grants(tx,id),old=new Map(before.map(g=>[g.storeId,g.canMove]));
   // Lock original store rows in a stable order; disabled stores cannot acquire expanded grants.
   const stores=rows.filter(g=>g.storeId!==null).map(g=>g.storeId!);
   const found=await tx`SELECT id,active FROM studio_os.stores WHERE id=ANY(${tx.array(stores)}::uuid[]) ORDER BY id FOR SHARE`;
   const available=new Map(found.map(s=>[s.id,s.active]));
   for(const g of rows){if(g.storeId!==null&&(!available.has(g.storeId)||(!available.get(g.storeId)&&(!old.has(g.storeId)||(!old.get(g.storeId)&&g.canMove)))))throw new ConflictException('停用或不存在的店铺不能新增或扩大授权');}
   const beforeValue={...account,grants:before};
   await tx`DELETE FROM studio_os.inventory_access_grants WHERE account_id=${id}`;
   for(const g of rows)await tx`INSERT INTO studio_os.inventory_access_grants(account_id,store_id,can_move) VALUES(${id},${g.storeId},${g.canMove})`;
   const [after]=await tx`UPDATE studio_os.accounts SET version=version+1 WHERE id=${id} RETURNING id,username,active,version`;
   const [event]=await tx`INSERT INTO studio_os.inventory_access_events(account_id,actor_id,actor_name,reason,before_value,after_value) VALUES(${id},${who.id},${actor.username},${reason},${JSON.stringify(beforeValue)}::jsonb,${JSON.stringify({...after,grants:await grants(tx,id)})}::jsonb) RETURNING id`;
   await tx`DELETE FROM studio_os.sessions WHERE account_id=${id}`;
   const result={id,version:after.version,eventId:event.id};
   await tx`INSERT INTO studio_os.inventory_access_receipts(actor_id,request_key,account_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async receipt(who:Identity,id:string,key:string){
  const actor=await currentPermission(this.db,who,'account_security');if(!actor.superadmin)throw new ForbiddenException();uuid(id);uuid(key);
  const [r]=await this.db.client`SELECT result FROM studio_os.inventory_access_receipts WHERE actor_id=${who.id} AND account_id=${id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'account_security');uuid(id);const b=objectInput(value,['offset']),offset=b.offset===undefined?0:Number(b.offset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   if(!(await tx`SELECT id FROM studio_os.accounts WHERE id=${id}`).length)throw new NotFoundException();
   const rows=await tx`SELECT id,reason,actor_name AS actor,before_value AS "beforeValue",after_value AS "afterValue",created_at AS "createdAt" FROM studio_os.inventory_access_events WHERE account_id=${id} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ${offset}`;
   const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.inventory_access_events WHERE account_id=${id}`;
   return {rows,total:n.n,offset,limit:50};
  });
 }
}
