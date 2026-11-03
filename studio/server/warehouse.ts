import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {requireAdministrator} from './access';
import {objectInput,shortText,longText,optionalLongText,uuid,version} from './validation';
const MAX=2147483647,units=['件','个','套','包','卷','箱'];
const projection=`w.id,w.item_code AS "itemCode",w.kind,w.product_id AS "productId",p.name AS "productName",w.name,w.specification,w.unit,w.location,w.notes,w.opening_confirmed AS "openingConfirmed",w.quantity,w.active,w.version,w.created_at AS "createdAt",w.updated_at AS "updatedAt"`;
const movementProjection=`m.id,m.item_id AS "itemId",m.type,m.quantity,m.delta,m.before_quantity AS "beforeQuantity",m.after_quantity AS "afterQuantity",m.reason,m.source_reference AS "sourceReference",m.corrects_movement_id AS "correctsMovementId",m.item_snapshot AS "itemSnapshot",m.created_at AS "createdAt",coalesce(n.display_name,a.username) AS actor`;
function quantity(v:unknown,zero=false){if(!Number.isSafeInteger(v)||Number(v)<(zero?0:1)||Number(v)>MAX)throw new BadRequestException('数量须为有效整数');return Number(v);}
async function item(tx:TransactionSql,id:string){const [r]=await tx`SELECT * FROM studio_os.warehouse_items WHERE id=${id} FOR UPDATE`;if(!r)throw new NotFoundException();return r;}
export class Warehouse {
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,action:string,b:Record<string,unknown>,fn:(tx:TransactionSql)=>Promise<{id:string,movementId?:string}>){
  requireAdministrator(who);const key=uuid(b.requestKey),canonical=Object.fromEntries(Object.keys(b).sort().map(k=>[k,b[k]])),hash=createHash('sha256').update(JSON.stringify({action,body:canonical})).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const [actor]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(actor.role!=='admin')throw new ForbiddenException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'warehouse:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return old.result;}
   const result=await fn(tx);await tx`INSERT INTO studio_os.warehouse_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('库存编码重复');throw e;}
 }
 async receipt(who:Identity,key:string){requireAdministrator(who);uuid(key);const [r]=await this.db.client`SELECT result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;}
 private query(who:Identity,value:unknown,history=false){
  requireAdministrator(who);const b=objectInput(value,history?['offset']:['q','kind','active','offset']),offset=b.offset===undefined?0:Number(b.offset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();const kind=b.kind===undefined?'all':String(b.kind),active=b.active===undefined?'active':String(b.active);
  if(!['all','product','packaging'].includes(kind)||!['active','inactive','all'].includes(active))throw new BadRequestException();return {offset,kind,active,q:b.q?shortText(b.q,100):''};
 }
 async catalog(who:Identity,value:unknown){
  const q=this.query(who,value);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const where=tx`(${q.kind}='all' OR w.kind=${q.kind}) AND (${q.active}='all' OR w.active=${q.active==='active'}) AND strpos(lower(concat_ws(' ',w.item_code,w.name,w.specification,w.location,p.name)),lower(${q.q}))>0`;
   const rows=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.warehouse_items w LEFT JOIN studio_os.products p ON p.id=w.product_id WHERE ${where} ORDER BY w.created_at DESC,w.id LIMIT 50 OFFSET ${q.offset}`;
   const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.warehouse_items w LEFT JOIN studio_os.products p ON p.id=w.product_id WHERE ${where}`;
   const summary=await tx`SELECT w.kind,w.unit,coalesce(sum(w.quantity),0)::text AS quantity,count(*) FILTER(WHERE w.opening_confirmed)::int AS "initializedCount",count(*) FILTER(WHERE NOT w.opening_confirmed)::int AS "pendingCount" FROM studio_os.warehouse_items w LEFT JOIN studio_os.products p ON p.id=w.product_id WHERE ${where} GROUP BY w.kind,w.unit ORDER BY w.kind,w.unit`;
   return {rows,total:count.n,offset:q.offset,limit:50,summary};
  });
 }
 async detail(who:Identity,id:string){requireAdministrator(who);uuid(id);const [r]=await this.db.client`SELECT ${this.db.client.unsafe(projection)} FROM studio_os.warehouse_items w LEFT JOIN studio_os.products p ON p.id=w.product_id WHERE w.id=${id}`;if(!r)throw new NotFoundException();return r;}
 async save(who:Identity,value:unknown,id?:string){
  requireAdministrator(who);if(id)uuid(id);const b=objectInput(value,['requestKey','itemCode','kind','productId','name','specification','unit','location','notes',...(id?['active','expectedVersion']:[])]);
  if(['requestKey','itemCode','kind','productId','name','specification','unit','location','notes',...(id?['active','expectedVersion']:[])].some(k=>!Object.hasOwn(b,k))||typeof b.kind!=='string'||typeof b.unit!=='string')throw new BadRequestException('库存资料不完整');
  const code=shortText(b.itemCode,64),kind=String(b.kind),product=b.productId===null?null:uuid(b.productId),name=shortText(b.name,120),specification=optionalLongText(b.specification,200).trim(),unit=String(b.unit),location=shortText(b.location,150),notes=optionalLongText(b.notes,2000),expected=id?version(b.expectedVersion):0;
  if(!['product','packaging'].includes(kind)||!units.includes(unit)||(kind==='product'&&!product)||(kind==='packaging'&&product)||(id&&typeof b.active!=='boolean'))throw new BadRequestException();
  return this.write(who,'save:'+(id||'new'),b,async tx=>{
   const old=id?await item(tx,id):null;if(old&&old.version!==expected)throw new ConflictException();
   if(old?.opening_confirmed&&(old.kind!==kind||old.product_id!==product||old.unit!==unit||old.specification!==specification))throw new ConflictException('登记期初后，类型、产品、规格和单位不能改写');
   if(product){const [p]=await tx`SELECT id,active FROM studio_os.products WHERE id=${product} FOR SHARE`;if(!p||(!p.active&&old?.product_id!==product))throw new BadRequestException('关联产品不可用');}
   const [r]=id?await tx`UPDATE studio_os.warehouse_items SET item_code=${code},kind=${kind},product_id=${product},name=${name},specification=${specification},unit=${unit},location=${location},notes=${notes},active=${b.active as boolean},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:await tx`INSERT INTO studio_os.warehouse_items(item_code,kind,product_id,name,specification,unit,location,notes,created_by) VALUES(${code},${kind},${product},${name},${specification},${unit},${location},${notes},${who.id}) RETURNING *`;
   await tx`INSERT INTO studio_os.warehouse_item_events(item_id,actor_id,action,before_value,after_value) VALUES(${r.id},${who.id},${id?'edited':'registered'},${old?JSON.stringify(old):null}::jsonb,${JSON.stringify(r)}::jsonb)`;return {id:r.id};
  });
 }
 async move(who:Identity,id:string,value:unknown){
  requireAdministrator(who);uuid(id);const b=objectInput(value,['requestKey','expectedVersion','type','quantity','reason','sourceReference','correctsMovementId']),expected=version(b.expectedVersion),type=String(b.type),qty=quantity(b.quantity,['opening','stocktake'].includes(type)),reason=longText(b.reason,2000),reference=optionalLongText(b.sourceReference,200),corrects=b.correctsMovementId===null?null:uuid(b.correctsMovementId);
  if(typeof b.type!=='string'||!['opening','inbound','outbound','stocktake'].includes(type)||!reason.trim()||(corrects&&type!=='stocktake'))throw new BadRequestException();
  return this.write(who,'move:'+id,b,async tx=>{
   const old=await item(tx,id);if(old.version!==expected||!old.active)throw new ConflictException('库存资料已变化或已停用');
   if(type==='opening'?old.opening_confirmed:!old.opening_confirmed)throw new ConflictException('请先登记期初数量，且只能登记一次');
   if(corrects&&!(await tx`SELECT id FROM studio_os.warehouse_movements WHERE id=${corrects} AND item_id=${id} FOR SHARE`).length)throw new BadRequestException('纠错流水不属于此库存项目');
   const before=old.quantity as number|null,after=type==='opening'||type==='stocktake'?qty:type==='inbound'?before!+qty:before!-qty;
   if(after<0||after>MAX)throw new ConflictException('不能超额出库或超过整数容量');const delta=after-(before??0);
   const [p]=old.product_id?await tx`SELECT name FROM studio_os.products WHERE id=${old.product_id} FOR SHARE`:[];
   const snapshot={itemCode:old.item_code,kind:old.kind,productId:old.product_id,productName:p?.name||null,name:old.name,specification:old.specification,unit:old.unit,location:old.location};
   const [movement]=await tx`INSERT INTO studio_os.warehouse_movements(item_id,type,quantity,delta,before_quantity,after_quantity,reason,source_reference,corrects_movement_id,item_snapshot,actor_id) VALUES(${id},${type},${qty},${delta},${before},${after},${reason},${reference},${corrects},${JSON.stringify(snapshot)}::jsonb,${who.id}) RETURNING id`;
   await tx`UPDATE studio_os.warehouse_items SET opening_confirmed=true,quantity=${after},version=version+1,updated_at=now() WHERE id=${id}`;return {id,movementId:movement.id};
  });
 }
 async movements(who:Identity,id:string,value:unknown){
  const q=this.query(who,value,true);uuid(id);if(!(await this.db.client`SELECT id FROM studio_os.warehouse_items WHERE id=${id}`).length)throw new NotFoundException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT ${tx.unsafe(movementProjection)} FROM studio_os.warehouse_movements m JOIN studio_os.accounts a ON a.id=m.actor_id LEFT JOIN studio_os.members n ON n.login_account_id=a.id WHERE m.item_id=${id} ORDER BY m.created_at DESC,m.id LIMIT 50 OFFSET ${q.offset}`;
   const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.warehouse_movements WHERE item_id=${id}`;return {rows,total:n.n,offset:q.offset,limit:50};
  });
 }
 async movement(who:Identity,id:string,movement:string){requireAdministrator(who);uuid(id);uuid(movement);const [r]=await this.db.client`SELECT ${this.db.client.unsafe(movementProjection)} FROM studio_os.warehouse_movements m JOIN studio_os.accounts a ON a.id=m.actor_id LEFT JOIN studio_os.members n ON n.login_account_id=a.id WHERE m.item_id=${id} AND m.id=${movement}`;if(!r)throw new NotFoundException();return r;}
 async events(who:Identity,id:string,value:unknown){
  const q=this.query(who,value,true);uuid(id);if(!(await this.db.client`SELECT id FROM studio_os.warehouse_items WHERE id=${id}`).length)throw new NotFoundException();
  const rows=await this.db.client`SELECT e.id,e.action,e.before_value AS "beforeValue",e.after_value AS "afterValue",e.created_at AS "createdAt",coalesce(m.display_name,a.username) AS actor FROM studio_os.warehouse_item_events e JOIN studio_os.accounts a ON a.id=e.actor_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE e.item_id=${id} ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET ${q.offset}`;
  const [n]=await this.db.client`SELECT count(*)::int AS n FROM studio_os.warehouse_item_events WHERE item_id=${id}`;return {rows,total:n.n,offset:q.offset,limit:50};
 }
}
