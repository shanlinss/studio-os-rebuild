import {livePermission,currentPermission,databaseIdentity,hasPermission} from './permissions';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {optionalMoney} from './money';
import {purchaseDay,purchaseExpense} from './equipment-purchase';
import {registerSampleRecord,stockInSampleRecord} from './samples';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {requireAdministrator} from './access';
import {objectInput,shortText,longText,optionalLongText,uuid,version} from './validation';
const MAX=2147483647,units=['件','个','套','包','卷','箱'];
const projection=`w.id,w.item_code AS "itemCode",w.kind,w.product_id AS "productId",p.name AS "productName",w.name,w.specification,w.unit,w.location,w.notes,w.opening_confirmed AS "openingConfirmed",w.quantity,w.active,w.version,w.created_at AS "createdAt",w.updated_at AS "updatedAt",EXISTS(SELECT 1 FROM studio_os.packaging_balances b WHERE b.item_id=w.id) AS "packagingScoped"`;
const movementProjection=`m.id,m.item_id AS "itemId",m.type,m.quantity,m.delta,m.before_quantity AS "beforeQuantity",m.after_quantity AS "afterQuantity",m.reason,m.source_reference AS "sourceReference",m.corrects_movement_id AS "correctsMovementId",m.item_snapshot AS "itemSnapshot",m.packaging_balance_id AS "packagingBalanceId",m.packaging_consumption_id AS "packagingConsumptionId",
 (SELECT pt.id FROM studio_os.packaging_stock_transfers pt WHERE pt.outbound_movement_id=m.id OR pt.inbound_movement_id=m.id) AS "packagingTransferId",m.created_at AS "createdAt",coalesce(n.display_name,a.username) AS actor,t.id AS "transferId",t.sample_id AS "targetSampleId",t.target_snapshot AS "transferTargetSnapshot"`;
const scopedProjection='b.id,b.store_id AS "storeId",s.name AS "storeName",b.quantity,b.version,g.can_move AS "canMove",w.name,w.item_code AS "itemCode",w.specification,w.unit,w.location';
function scopedSource(tx:TransactionSql,accountId:string){
 return tx`FROM studio_os.packaging_balances b JOIN studio_os.warehouse_items w ON w.id=b.item_id
  JOIN studio_os.inventory_access_grants g ON g.account_id=${accountId} AND g.store_id IS NOT DISTINCT FROM b.store_id
  LEFT JOIN studio_os.stores s ON s.id=b.store_id
  WHERE w.active AND w.kind='packaging' AND (b.store_id IS NULL OR s.active)`;
}
function canonical(v:unknown):unknown {if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])]));return v;}
function quantity(v:unknown,zero=false){if(!Number.isSafeInteger(v)||Number(v)<(zero?0:1)||Number(v)>MAX)throw new BadRequestException('数量须为有效整数');return Number(v);}
async function item(tx:TransactionSql,id:string){const [r]=await tx`SELECT * FROM studio_os.warehouse_items WHERE id=${id} FOR UPDATE`;if(!r)throw new NotFoundException();return r;}
export class Warehouse {
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,action:string,b:Record<string,unknown>,fn:(tx:TransactionSql)=>Promise<{id:string,movementId?:string,purchaseId?:string,packagingTransferId?:string,transferId?:string,sampleId?:string,sampleEventId?:string}>,authorize?:(tx:TransactionSql)=>Promise<void>){
  if(!authorize)requireAdministrator(who);const key=uuid(b.requestKey),body=canonical(b),hash=createHash('sha256').update(JSON.stringify({action,body})).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const [actor]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(authorize)await authorize(tx);else await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'warehouse:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return old.result;}
   const result=await fn(tx);await tx`INSERT INTO studio_os.warehouse_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if((e as {constraint_name?:string}).constraint_name==='packaging_purchases_expense_id_key')throw new ConflictException('这笔支出已关联包材采购');
   if((e as {code?:string}).code==='23505')throw new ConflictException('库存编码重复');throw e;}
 }
 async receipt(who:Identity,key:string){await currentPermission(this.db,who,'resources');requireAdministrator(who);uuid(key);const [r]=await this.db.client`SELECT result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key} AND action NOT LIKE 'purchase-packaging:%' AND action<>'consume-packaging'`;if(!r)throw new NotFoundException();return r.result;}
 private query(who:Identity,value:unknown,history=false){
  requireAdministrator(who);const b=objectInput(value,history?['offset']:['q','kind','active','offset']),offset=b.offset===undefined?0:Number(b.offset);
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();const kind=b.kind===undefined?'all':String(b.kind),active=b.active===undefined?'active':String(b.active);
  if(!['all','product','packaging'].includes(kind)||!['active','inactive','all'].includes(active))throw new BadRequestException();return {offset,kind,active,q:b.q?shortText(b.q,100):''};
 }
 async catalog(who:Identity,value:unknown){await currentPermission(this.db,who,'resources');
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
 async detail(who:Identity,id:string){
  await currentPermission(this.db,who,'resources');
  requireAdministrator(who);
  id=uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [row]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.warehouse_items w LEFT JOIN studio_os.products p ON p.id=w.product_id WHERE w.id=${id}`;
   if(!row)throw new NotFoundException();
   if(row.kind!=='packaging')return row;
   const balances=await tx`SELECT b.id,b.store_id AS "storeId",s.name AS "storeName",s.active AS "storeActive",b.quantity,b.version
     FROM studio_os.packaging_balances b LEFT JOIN studio_os.stores s ON s.id=b.store_id WHERE b.item_id=${id} ORDER BY s.name NULLS FIRST,b.id`;
   return {...row,balances};
  });
 }
 async allocatePackaging(who:Identity,id:string,value:unknown){
  id=uuid(id);
  const b=objectInput(value,['requestKey','expectedVersion','reason','allocations']);
  const expected=version(b.expectedVersion),reason=longText(b.reason,2000);
  if(!Array.isArray(b.allocations)||!b.allocations.length||b.allocations.length>100)throw new BadRequestException('请填写 1 至 100 个库存归属');
  const allocations=b.allocations.map(value=>{
   const row=objectInput(value,['storeId','quantity']);
   return {storeId:row.storeId===null?null:uuid(row.storeId),quantity:quantity(row.quantity,true)};
  });
  if(new Set(allocations.map(row=>row.storeId)).size!==allocations.length)throw new BadRequestException('同一库存归属只能填写一次');
  const total=allocations.reduce((sum,row)=>sum+row.quantity,0);
  if(total>MAX)throw new BadRequestException('包材合计超过容量');
  return this.write(who,'allocate-packaging:'+id,b,async tx=>{
   const old=await item(tx,id);
   if(old.kind!=='packaging'||!old.active||old.version!==expected)throw new ConflictException('包材资料已变化或已停用');
   const existing=await tx`SELECT store_id FROM studio_os.packaging_balances WHERE item_id=${id}`;
   const used=new Set(existing.map(row=>row.store_id));
   if(allocations.some(row=>used.has(row.storeId)))throw new ConflictException('该包材已登记此归属');
   if(existing.length&&total!==0)throw new ConflictException('新归属从零开始，已有库存须通过调拨分配');
   if(!existing.length&&old.opening_confirmed&&old.quantity!==total)
    throw new ConflictException('分配合计须等于旧库存，请先核对并盘点旧库存');
   const stores=allocations.flatMap(row=>row.storeId?[row.storeId]:[]);
   const found=await tx`SELECT id,name FROM studio_os.stores WHERE id=ANY(${tx.array(stores)}::uuid[]) AND active ORDER BY id FOR SHARE`;
   if(found.length!==stores.length)throw new ConflictException('只能选择启用的店铺');
   const names=new Map(found.map(store=>[store.id,store.name]));
   for(const row of allocations){
    const [balance]=await tx`INSERT INTO studio_os.packaging_balances(item_id,store_id,quantity)
     VALUES(${id},${row.storeId},${row.quantity}) RETURNING id`;
    const snapshot={itemCode:old.item_code,kind:old.kind,productId:null,productName:null,name:old.name,specification:old.specification,unit:old.unit,location:old.location,storeId:row.storeId,storeName:names.get(row.storeId)??null};
    await tx`INSERT INTO studio_os.warehouse_movements(item_id,packaging_balance_id,type,quantity,delta,after_quantity,reason,item_snapshot,actor_id)
     VALUES(${id},${balance.id},'opening',${row.quantity},${row.quantity},${row.quantity},${reason},${JSON.stringify(snapshot)}::jsonb,${who.id})`;
   }
   await tx`UPDATE studio_os.warehouse_items SET opening_confirmed=true,quantity=${existing.length?old.quantity:total},version=version+1,updated_at=now() WHERE id=${id}`;
   return {id};
  });
 }
 async purchasePackaging(who:Identity,id:string,value:unknown){
  id=uuid(id);
  const b=objectInput(value,['requestKey','expectedVersion','purchaseDate','supplier','unitPrice','expenseId','expenseVersion','reason','allocations']);
  const expected=version(b.expectedVersion),date=purchaseDay(b.purchaseDate),supplier=shortText(b.supplier,150);
  const unitCents=optionalMoney(b.unitPrice),reason=longText(b.reason,2000),expenseId=b.expenseId===null?null:uuid(b.expenseId);
  const expenseVersion=expenseId?version(b.expenseVersion):null;
  if(unitCents===null||(!expenseId&&b.expenseVersion!==null)||!Array.isArray(b.allocations)||!b.allocations.length||b.allocations.length>100)
   throw new BadRequestException();
  const allocations=b.allocations.map(value=>{
   const line=objectInput(value,['balanceId','quantity']);
   return {balanceId:uuid(line.balanceId),quantity:quantity(line.quantity)};
  });
  if(new Set(allocations.map(line=>line.balanceId)).size!==allocations.length)throw new BadRequestException('库存归属重复');
  const total=allocations.reduce((sum,line)=>sum+line.quantity,0);
  if(total>MAX||BigInt(total)*BigInt(unitCents)>BigInt(MAX))throw new BadRequestException('采购数量或金额超过容量');
  return this.write(who,'purchase-packaging:'+id,b,async tx=>{
   const old=await item(tx,id);
   if(old.kind!=='packaging'||!old.active||!old.opening_confirmed||old.version!==expected||old.quantity+total>MAX)
    throw new ConflictException('请核对包材状态、数量和版本');
   const balances=await tx`SELECT id,quantity,store_id FROM studio_os.packaging_balances
    WHERE item_id=${id} AND id=ANY(${tx.array(allocations.map(line=>line.balanceId))}::uuid[])`;
   if(balances.length!==allocations.length)throw new ConflictException('分配归属不属于当前包材');
   const stores=balances.flatMap(row=>row.store_id?[row.store_id]:[]);
   const active=await tx`SELECT id,name FROM studio_os.stores WHERE id=ANY(${tx.array(stores)}::uuid[]) AND active ORDER BY id FOR SHARE`;
   if(active.length!==stores.length)throw new ConflictException('分配店铺已停用');
   const names=new Map(active.map(row=>[row.id,row.name])),byId=new Map(balances.map(row=>[row.id,row]));
   const expense=expenseId?await purchaseExpense(tx,expenseId,true):null;
   if(expense&&expense.version!==expenseVersion)throw new ConflictException('关联支出已变化，请重新核对');
   const [purchase]=await tx`INSERT INTO studio_os.packaging_purchases(item_id,purchase_date,supplier,quantity,unit_cents,total_cents,expense_id,expense_snapshot,reason,actor_id)
    VALUES(${id},${date},${supplier},${total},${unitCents},${total*unitCents},${expenseId},${expense?JSON.stringify(expense):null}::jsonb,${reason},${who.id}) RETURNING id`;
   for(const line of allocations){
    const balance=byId.get(line.balanceId)!,after=balance.quantity+line.quantity;
    const snapshot={itemCode:old.item_code,kind:old.kind,productId:null,productName:null,name:old.name,specification:old.specification,unit:old.unit,location:old.location,storeId:balance.store_id,storeName:names.get(balance.store_id)??null};
    const [movement]=await tx`INSERT INTO studio_os.warehouse_movements(item_id,packaging_balance_id,type,quantity,delta,before_quantity,after_quantity,reason,item_snapshot,actor_id)
     VALUES(${id},${balance.id},'inbound',${line.quantity},${line.quantity},${balance.quantity},${after},'采购入库',${JSON.stringify(snapshot)}::jsonb,${who.id}) RETURNING id`;
    await tx`INSERT INTO studio_os.packaging_purchase_allocations(purchase_id,balance_id,movement_id) VALUES(${purchase.id},${balance.id},${movement.id})`;
    await tx`UPDATE studio_os.packaging_balances SET quantity=${after},version=version+1 WHERE id=${balance.id}`;
   }
   await tx`UPDATE studio_os.warehouse_items SET quantity=${old.quantity+total},version=version+1,updated_at=now() WHERE id=${id}`;
   return {id,purchaseId:purchase.id};
  },async tx=>{await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');});
 }
 async packagingPurchaseHistory(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');
  id=uuid(id);const {offset}=this.query(who,value,true);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   if(!(await tx`SELECT id FROM studio_os.warehouse_items WHERE id=${id} AND kind='packaging'`).length)throw new NotFoundException();
   const rows=await tx`SELECT p.id,p.purchase_date::text AS "purchaseDate",p.supplier,p.quantity,p.unit_cents AS "unitCents",
    p.total_cents AS "totalCents",p.expense_snapshot AS "expenseSnapshot",p.reason,p.created_at AS "createdAt",a.username AS actor,
    (e.version IS DISTINCT FROM (p.expense_snapshot->>'version')::int) AS "sourceChanged",
    (SELECT jsonb_agg(jsonb_build_object('id',m.id,'quantity',m.quantity,'storeName',m.item_snapshot->>'storeName') ORDER BY m.id)
     FROM studio_os.packaging_purchase_allocations l JOIN studio_os.warehouse_movements m ON m.id=l.movement_id WHERE l.purchase_id=p.id) AS allocations
    FROM studio_os.packaging_purchases p JOIN studio_os.accounts a ON a.id=p.actor_id LEFT JOIN studio_os.expense_records e ON e.id=p.expense_id
    WHERE p.item_id=${id} ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.packaging_purchases WHERE item_id=${id}`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
 async packagingPurchaseReceipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');
  id=uuid(id);key=uuid(key);
  const [row]=await this.db.client`SELECT result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key} AND action=${'purchase-packaging:'+id}`;
  if(!row)throw new NotFoundException();
  return row.result;
 }
 async transferPackaging(who:Identity,id:string,value:unknown){
  id=uuid(id);
  const b=objectInput(value,['requestKey','sourceBalanceId','targetBalanceId','sourceVersion','targetVersion','quantity','reason']);
  const sourceId=uuid(b.sourceBalanceId),targetId=uuid(b.targetBalanceId);
  const sourceVersion=version(b.sourceVersion),targetVersion=version(b.targetVersion);
  const qty=quantity(b.quantity),reason=longText(b.reason,2000);
  if(sourceId===targetId)throw new BadRequestException('调出和调入归属须不同');
  return this.write(who,'transfer-packaging:'+id,b,async tx=>{
   const original=await item(tx,id);
   if(!original.active||original.kind!=='packaging'||!original.opening_confirmed)
    throw new ConflictException('仅可调拨已启用且已分账的包材');
   const balances=await tx`SELECT id,quantity,version,store_id FROM studio_os.packaging_balances
    WHERE item_id=${id} AND id IN (${sourceId},${targetId})`;
   const source=balances.find(row=>row.id===sourceId),target=balances.find(row=>row.id===targetId);
   if(!source||!target||source.version!==sourceVersion||target.version!==targetVersion||
      source.quantity<qty||target.quantity+qty>MAX)
    throw new ConflictException('请核对调拨归属、库存数量及版本');
   const storeIds=[source.store_id,target.store_id].filter(Boolean);
   const stores=await tx`SELECT id,name FROM studio_os.stores WHERE id=ANY(${tx.array(storeIds)}::uuid[]) AND active ORDER BY id FOR SHARE`;
   if(stores.length!==storeIds.length)throw new ConflictException('调拨店铺已停用');
   const names=new Map(stores.map(row=>[row.id,row.name]));
   const movements=[];
   for(const [balance,type,delta] of [[source,'outbound',-qty],[target,'inbound',qty]] as const){
    const after=balance.quantity+delta;
    const snapshot={itemCode:original.item_code,kind:original.kind,productId:null,productName:null,name:original.name,
     specification:original.specification,unit:original.unit,location:original.location,storeId:balance.store_id,
     storeName:names.get(balance.store_id)??null};
    const [movement]=await tx`INSERT INTO studio_os.warehouse_movements(item_id,packaging_balance_id,type,quantity,delta,
     before_quantity,after_quantity,reason,item_snapshot,actor_id)
     VALUES(${id},${balance.id},${type},${qty},${delta},${balance.quantity},${after},'包材调拨',${JSON.stringify(snapshot)}::jsonb,${who.id}) RETURNING id`;
    movements.push(movement.id);
    await tx`UPDATE studio_os.packaging_balances SET quantity=${after},version=version+1 WHERE id=${balance.id}`;
   }
   const [transfer]=await tx`INSERT INTO studio_os.packaging_stock_transfers(item_id,source_balance_id,target_balance_id,outbound_movement_id,
    inbound_movement_id,quantity,reason,actor_id)
    VALUES(${id},${sourceId},${targetId},${movements[0]},${movements[1]},${qty},${reason},${who.id}) RETURNING id`;
   await tx`UPDATE studio_os.warehouse_items SET version=version+1,updated_at=now() WHERE id=${id}`;
   return {id,packagingTransferId:transfer.id};
  });
 }
 async packagingTransferDetail(who:Identity,itemId:string,transferId:string){
  await currentPermission(this.db,who,'resources');
  const id=uuid(itemId),transfer=uuid(transferId);
  const [row]=await this.db.client`SELECT t.id,t.item_id AS "itemId",t.quantity,t.reason,t.created_at AS "createdAt",a.username AS actor,
   jsonb_build_object('id',outbound.id,'snapshot',outbound.item_snapshot,'beforeQuantity',outbound.before_quantity,'afterQuantity',outbound.after_quantity) AS source,
   jsonb_build_object('id',inbound.id,'snapshot',inbound.item_snapshot,'beforeQuantity',inbound.before_quantity,'afterQuantity',inbound.after_quantity) AS target
   FROM studio_os.packaging_stock_transfers t JOIN studio_os.accounts a ON a.id=t.actor_id
   JOIN studio_os.warehouse_movements outbound ON outbound.id=t.outbound_movement_id
   JOIN studio_os.warehouse_movements inbound ON inbound.id=t.inbound_movement_id
   WHERE t.id=${transfer} AND t.item_id=${id}`;
  if(!row)throw new NotFoundException();
  return row;
 }
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
 private async scopedBalance(tx:TransactionSql,who:Identity,id:string,write=false){
  const [actor]=write
   ?await tx`SELECT active FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`
   :await tx`SELECT active FROM studio_os.accounts WHERE id=${who.id}`;
  if(!actor?.active)throw new UnauthorizedException();
  const [row]=await tx`SELECT ${tx.unsafe(scopedProjection)},b.item_id AS "itemId" ${scopedSource(tx,who.id)} AND b.id=${id}`;
  if(!row)throw new NotFoundException();
  if(write&&!row.canMove)throw new ForbiddenException();
  if(write&&row.storeId&&!(await tx`SELECT id FROM studio_os.stores WHERE id=${row.storeId} AND active FOR SHARE`).length)
   throw new NotFoundException();
  return row;
 }
 async consumptionOptions(who:Identity,value:unknown){
  const b=objectInput(value,['offset']),offset=Number(b.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const manager=await this.consumptionManager(tx,who);
   const source=tx`FROM studio_os.packaging_balances b JOIN studio_os.warehouse_items w ON w.id=b.item_id
    LEFT JOIN studio_os.stores s ON s.id=b.store_id
    WHERE w.active AND w.kind='packaging' AND b.quantity>0 AND (b.store_id IS NULL OR s.active)
    AND (${manager} OR EXISTS(SELECT 1 FROM studio_os.inventory_access_grants g WHERE g.account_id=${who.id}
     AND g.store_id IS NOT DISTINCT FROM b.store_id AND g.can_move))`;
   const rows=await tx`SELECT b.id,b.store_id AS "storeId",s.name AS "storeName",b.quantity,b.version,
    true AS "canMove",w.name,w.item_code AS "itemCode",w.specification,w.unit,w.location
    ${source} ORDER BY w.name,s.name NULLS FIRST,b.id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total ${source}`;
   const stores=offset===0?await tx`SELECT id,name FROM studio_os.stores WHERE active AND
    (${manager} OR EXISTS(SELECT 1 FROM studio_os.inventory_access_grants WHERE account_id=${who.id} AND store_id IS NULL AND can_move)) ORDER BY name,id`:[];
   return {rows,total:count.total,offset,limit:50,stores};
  });
 }
 private async consumptionManager(tx:TransactionSql,who:Identity){
  const [actor]=await tx`SELECT id,username,role,active,superadmin,admin_permissions FROM studio_os.accounts WHERE id=${who.id}`;
  if(!actor?.active)throw new UnauthorizedException();
  return hasPermission(databaseIdentity(actor),'resources');
 }
 private async consumptionSources(tx:TransactionSql,who:Identity,ids:string[],write:boolean){
  const manager=await this.consumptionManager(tx,who);
  const rows=await tx`SELECT b.id,b.item_id,b.store_id,b.quantity,b.version
   FROM studio_os.packaging_balances b JOIN studio_os.warehouse_items w ON w.id=b.item_id
   LEFT JOIN studio_os.stores s ON s.id=b.store_id
   WHERE b.id=ANY(${tx.array(ids)}::uuid[]) AND w.active AND w.kind='packaging'
   AND (b.store_id IS NULL OR s.active)
   AND (${manager} OR EXISTS(SELECT 1 FROM studio_os.inventory_access_grants g WHERE g.account_id=${who.id}
    AND g.store_id IS NOT DISTINCT FROM b.store_id AND (${!write} OR g.can_move)))`;
  if(rows.length!==ids.length)throw new ForbiddenException();
  return rows;
 }
 async consumePackaging(who:Identity,value:unknown){
  const b=objectInput(value,['requestKey','reason','lines']),reason=longText(b.reason,2000);
  if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw new BadRequestException('请填写 1 至 100 项领用');
  const lines=b.lines.map(value=>{
   const line=objectInput(value,['balanceId','expectedVersion','quantity','usedStoreId']);
   return {balanceId:uuid(line.balanceId),expected:version(line.expectedVersion),quantity:quantity(line.quantity),usedStoreId:line.usedStoreId===null?null:uuid(line.usedStoreId)};
  });
  const ids=lines.map(line=>line.balanceId);
  if(new Set(ids).size!==ids.length)throw new BadRequestException('同一库存来源在一张单据中只能填写一次');
  return this.write(who,'consume-packaging',b,async tx=>{
   const originals=await tx`SELECT w.* FROM studio_os.warehouse_items w
    WHERE w.id IN(SELECT item_id FROM studio_os.packaging_balances WHERE id=ANY(${tx.array(ids)}::uuid[]))
    ORDER BY w.id FOR UPDATE`;
   const items=new Map(originals.map(row=>[row.id,row]));
   const sources=new Map((await this.consumptionSources(tx,who,ids,true)).map(row=>[row.id,row]));
   const prepared=lines.map(line=>{
    const balance=sources.get(line.balanceId)!,original=items.get(balance.item_id)!;
    if(balance.version!==line.expected||balance.quantity<line.quantity)throw new ConflictException('库存数量或版本已变化，请重新核对');
    const storeId=balance.store_id??line.usedStoreId;
    if(!storeId||(balance.store_id&&line.usedStoreId&&line.usedStoreId!==balance.store_id))
     throw new BadRequestException('公共来源须填写实际领用店铺，店铺库存须由所属店铺领用');
    return {line,balance,original,storeId};
   });
   const storeIds=[...new Set(prepared.map(row=>row.storeId))];
   const stores=await tx`SELECT id,name FROM studio_os.stores WHERE id=ANY(${tx.array(storeIds)}::uuid[]) AND active ORDER BY id FOR SHARE`;
   if(stores.length!==storeIds.length)throw new ConflictException('领用店铺已停用或不存在');
   const names=new Map(stores.map(row=>[row.id,row.name]));
   const [document]=await tx`INSERT INTO studio_os.packaging_consumptions(actor_id,reason) VALUES(${who.id},${reason}) RETURNING id`;
   const usedByItem=new Map<string,number>();
   for(const {line,balance,original,storeId} of prepared){
    const after=balance.quantity-line.quantity;
    const snapshot={itemCode:original.item_code,kind:original.kind,productId:null,productName:null,name:original.name,
     specification:original.specification,unit:original.unit,location:original.location,
     storeId:balance.store_id,storeName:balance.store_id?names.get(balance.store_id):null,usedStoreName:names.get(storeId)};
    await tx`INSERT INTO studio_os.warehouse_movements(item_id,packaging_balance_id,packaging_consumption_id,used_store_id,type,
     quantity,delta,before_quantity,after_quantity,reason,item_snapshot,actor_id)
     VALUES(${original.id},${balance.id},${document.id},${storeId},'outbound',${line.quantity},${-line.quantity},${balance.quantity},${after},
     '批量消耗',${JSON.stringify(snapshot)}::jsonb,${who.id})`;
    await tx`UPDATE studio_os.packaging_balances SET quantity=${after},version=version+1 WHERE id=${balance.id}`;
    usedByItem.set(original.id,(usedByItem.get(original.id)??0)+line.quantity);
   }
   for(const [id,used] of usedByItem)
    await tx`UPDATE studio_os.warehouse_items SET quantity=quantity-${used},version=version+1,updated_at=now() WHERE id=${id}`;
   return {id:document.id};
  },async tx=>{await this.consumptionSources(tx,who,ids,true);});
 }
 async consumptionDetail(who:Identity,id:string){
  id=uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const manager=await this.consumptionManager(tx,who);
   const [document]=await tx`SELECT c.id,c.reason,c.created_at AS "createdAt",a.username AS actor
    FROM studio_os.packaging_consumptions c JOIN studio_os.accounts a ON a.id=c.actor_id
    WHERE c.id=${id} AND (${manager} OR c.actor_id=${who.id})`;
   if(!document)throw new NotFoundException();
   const lines=await tx`SELECT id,quantity,packaging_balance_id AS "balanceId",item_snapshot AS snapshot,
    before_quantity AS "beforeQuantity",after_quantity AS "afterQuantity"
    FROM studio_os.warehouse_movements WHERE packaging_consumption_id=${id} ORDER BY id`;
   if(!manager)await this.consumptionSources(tx,who,lines.map(line=>line.balanceId),false);
   return {...document,lines};
  });
 }
 async consumptionReceipt(who:Identity,key:string){
  key=uuid(key);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [receipt]=await tx`SELECT result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key} AND action='consume-packaging'`;
   if(!receipt)throw new NotFoundException();
   const rows=await tx`SELECT packaging_balance_id AS id FROM studio_os.warehouse_movements WHERE packaging_consumption_id=${receipt.result.id}`;
   await this.consumptionSources(tx,who,rows.map(row=>row.id),true);
   return receipt.result;
  });
 }
 async scopedCatalog(who:Identity,value:unknown){
  const b=objectInput(value,['offset','q']),offset=Number(b.offset??0),q=b.q?shortText(b.q,100):'';
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   if(!(await tx`SELECT id FROM studio_os.accounts WHERE id=${who.id} AND active`).length)throw new UnauthorizedException();
   const source=tx`${scopedSource(tx,who.id)}
    AND strpos(lower(concat_ws(' ',w.item_code,w.name,w.specification,s.name)),lower(${q}))>0`;
   const rows=await tx`SELECT ${tx.unsafe(scopedProjection)} ${source} ORDER BY w.name,s.name NULLS FIRST,b.id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total ${source}`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
 async scopedDetail(who:Identity,id:string,value:unknown){
  id=uuid(id);
  const b=objectInput(value,['offset']),offset=Number(b.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const {itemId,...balance}=await this.scopedBalance(tx,who,id);
   const rows=await tx`SELECT id,type,delta,before_quantity AS "beforeQuantity",after_quantity AS "afterQuantity",created_at AS "createdAt",
    CASE WHEN actor_id=${who.id} THEN packaging_consumption_id END AS "packagingConsumptionId"
    FROM studio_os.warehouse_movements WHERE packaging_balance_id=${id} ORDER BY created_at DESC,id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.warehouse_movements WHERE packaging_balance_id=${id}`;
   return {balance,rows,total:count.total,offset,limit:50};
  });
 }
 async scopedMove(who:Identity,id:string,value:unknown){
  id=uuid(id);
  const b=objectInput(value,['requestKey','expectedVersion','type','quantity','reason']);
  if(b.type!=='inbound'&&b.type!=='outbound')throw new BadRequestException();
  return this.writeMovement(who,id,{...b,sourceReference:'',correctsMovementId:null,packagingBalanceId:id},true);
 }
 async scopedReceipt(who:Identity,id:string,key:string){
  id=uuid(id);key=uuid(key);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const balance=await this.scopedBalance(tx,who,id);
   if(!balance.canMove)throw new ForbiddenException();
   const [receipt]=await tx`SELECT result FROM studio_os.warehouse_receipts WHERE actor_id=${who.id} AND request_key=${key} AND action=${'scoped-move:'+id}`;
   if(!receipt)throw new NotFoundException();
   return receipt.result;
  });
 }
 async move(who:Identity,id:string,value:unknown){return this.writeMovement(who,id,value,false);}
 private async writeMovement(who:Identity,id:string,value:unknown,scoped:boolean){
  if(!scoped)requireAdministrator(who);uuid(id);const b=objectInput(value,['requestKey','expectedVersion','type','quantity','reason','sourceReference','correctsMovementId','packagingBalanceId']),expected=version(b.expectedVersion),type=String(b.type),qty=quantity(b.quantity,['opening','stocktake'].includes(type)),reason=longText(b.reason,2000),reference=optionalLongText(b.sourceReference,200),corrects=b.correctsMovementId===null?null:uuid(b.correctsMovementId);
  if(typeof b.type!=='string'||!['opening','inbound','outbound','stocktake'].includes(type)||!reason.trim()||(corrects&&type!=='stocktake'))throw new BadRequestException();
  const balanceId=b.packagingBalanceId===undefined?null:uuid(b.packagingBalanceId);
  let itemId=id;
  const authorize=scoped?async(tx:TransactionSql)=>{itemId=(await this.scopedBalance(tx,who,id,true)).itemId;}:undefined;
  return this.write(who,(scoped?'scoped-move:':'move:')+id,b,async tx=>{
   const old=await item(tx,itemId);if((!scoped&&old.version!==expected)||!old.active)throw new ConflictException('库存资料已变化或已停用');
   const balances=await tx`SELECT b.id,b.quantity,b.store_id,b.version FROM studio_os.packaging_balances b WHERE b.item_id=${itemId}`;
   const balance=balances.find(row=>row.id===balanceId);
   if((balances.length&&!balance)||(balanceId&&!balance)||(balance&&type==='opening'))
    throw new ConflictException('请选择已登记期初的包材归属');
   if(scoped&&balance?.version!==expected)throw new ConflictException('此归属库存已变化');
   let storeName=null;
   if(balance?.store_id){
    const [store]=await tx`SELECT name,active FROM studio_os.stores WHERE id=${balance.store_id} FOR SHARE`;
    if(!store?.active)throw new ConflictException('该店铺已停用');
    storeName=store.name;
   }
   if(type==='opening'?old.opening_confirmed:!old.opening_confirmed)throw new ConflictException('请先登记期初数量，且只能登记一次');
   if(corrects&&!(await tx`SELECT id FROM studio_os.warehouse_movements WHERE id=${corrects} AND item_id=${itemId} AND packaging_balance_id IS NOT DISTINCT FROM ${balanceId}::uuid FOR SHARE`).length)throw new BadRequestException('纠错流水不属于此库存项目');
   if(corrects&&(await tx`SELECT id FROM studio_os.warehouse_sample_transfers WHERE movement_id=${corrects}`).length)throw new ConflictException('转样品记录不支持单边引用撤销，请核对双方实际数量');
   if(corrects&&(await tx`SELECT id FROM studio_os.packaging_stock_transfers WHERE outbound_movement_id=${corrects} OR inbound_movement_id=${corrects}`).length)
    throw new ConflictException('调拨记录需核对双方数量，不能只引用一侧纠错');
   const before=(balance?.quantity??old.quantity) as number|null,after=type==='opening'||type==='stocktake'?qty:type==='inbound'?before!+qty:before!-qty;
   if(after<0||after>MAX)throw new ConflictException('不能超额出库或超过整数容量');const delta=after-(before??0);
   const total=balance?old.quantity+delta:after;
   if(total>MAX)throw new ConflictException('包材合计超过容量');
   const [p]=old.product_id?await tx`SELECT name FROM studio_os.products WHERE id=${old.product_id} FOR SHARE`:[];
   const snapshot={itemCode:old.item_code,kind:old.kind,productId:old.product_id,productName:p?.name||null,name:old.name,specification:old.specification,unit:old.unit,location:old.location,...(balance?{storeId:balance.store_id,storeName}:{})};
   const [movement]=await tx`INSERT INTO studio_os.warehouse_movements(item_id,packaging_balance_id,type,quantity,delta,before_quantity,after_quantity,reason,source_reference,corrects_movement_id,item_snapshot,actor_id) VALUES(${itemId},${balanceId},${type},${qty},${delta},${before},${after},${reason},${reference},${corrects},${JSON.stringify(snapshot)}::jsonb,${who.id}) RETURNING id`;
   if(balance)await tx`UPDATE studio_os.packaging_balances SET quantity=${after},version=version+1 WHERE id=${balance.id}`;
   await tx`UPDATE studio_os.warehouse_items SET opening_confirmed=true,quantity=${total},version=version+1,updated_at=now() WHERE id=${itemId}`;return {id:scoped?id:itemId,movementId:movement.id};
  },authorize);
 }
 async sampleTargets(who:Identity,id:string,value:unknown){await currentPermission(this.db,who,'resources');
  requireAdministrator(who);uuid(id);const b=objectInput(value,['q','offset']),offset=b.offset===undefined?0:Number(b.offset),q=b.q?shortText(b.q,100):'';
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [source]=await tx`SELECT product_id,kind,unit FROM studio_os.warehouse_items WHERE id=${id}`;if(!source)throw new NotFoundException();
   if(source.kind!=='product'||!['件','个'].includes(source.unit))throw new ConflictException('仅支持件或个的产品库存转样品');
   const where=tx`s.active AND s.product_id=${source.product_id} AND (l.item_id IS NULL OR l.item_id=${id}) AND strpos(lower(concat_ws(' ',s.name,s.warehouse_location)),lower(${q}))>0`;
   const rows=await tx`SELECT s.id,s.name,s.product_id AS "productId",s.warehouse_location AS "warehouseLocation",s.keeper_member_id AS "keeperMemberId",s.available_quantity AS "availableQuantity",s.active,s.version,l.item_id AS "sourceItemId" FROM studio_os.shooting_samples s LEFT JOIN studio_os.warehouse_sample_links l ON l.sample_id=s.id WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.shooting_samples s LEFT JOIN studio_os.warehouse_sample_links l ON l.sample_id=s.id WHERE ${where}`;return {rows,total:count.n,offset,limit:50};
  });
 }
 async transfer(who:Identity,id:string,value:unknown){
  requireAdministrator(who);uuid(id);const b=objectInput(value,['requestKey','expectedVersion','quantity','reason','sourceReference','confirmed','target']);
  const expected=version(b.expectedVersion),qty=quantity(b.quantity),reason=longText(b.reason,2000),reference=optionalLongText(b.sourceReference,200);
  if(b.confirmed!==true||!reason.trim())throw new BadRequestException('请核对规格及一件对一件的数量关系');
  const target=objectInput(b.target,['mode','sampleId','expectedVersion','name','warehouseLocation','keeperMemberId','notes']);
  if(typeof target.mode!=='string'||!['new','existing'].includes(target.mode))throw new BadRequestException();
  const allowed=target.mode==='new'?['mode','name','warehouseLocation','keeperMemberId','notes']:['mode','sampleId','expectedVersion'];
  if(Object.keys(target).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(target,k)))throw new BadRequestException();
  const sampleId=target.mode==='existing'?uuid(target.sampleId):null,targetVersion=sampleId?version(target.expectedVersion):null;
  const input=target.mode==='new'?{name:shortText(target.name,120),warehouseLocation:shortText(target.warehouseLocation,150),keeperMemberId:target.keeperMemberId===null?null:uuid(target.keeperMemberId),notes:optionalLongText(target.notes,2000)}:null;
  return this.write(who,'transfer:'+id,b,async tx=>{
   const source=await item(tx,id);
   if(source.version!==expected||!source.active||!source.opening_confirmed||source.kind!=='product'||!['件','个'].includes(source.unit)||source.quantity<qty)throw new ConflictException('请核对产品库存、期初、数量和件/个单位');
   let sampleRow;
   if(sampleId){const [found]=await tx`SELECT * FROM studio_os.shooting_samples WHERE id=${sampleId} FOR UPDATE`;if(!found)throw new NotFoundException();sampleRow=found;}
   else sampleRow=await registerSampleRecord(tx,who,{...input!,productId:String(source.product_id)});
   if(!sampleRow.active||sampleRow.product_id!==source.product_id||(sampleId&&sampleRow.version!==targetVersion))throw new ConflictException('目标样品的产品、状态或版本已变化');
   const [link]=await tx`SELECT item_id,product_id,specification,source_unit FROM studio_os.warehouse_sample_links WHERE sample_id=${sampleRow.id}`;
   if(link&&(link.item_id!==id||link.product_id!==source.product_id||link.specification!==source.specification||link.source_unit!==source.unit))throw new ConflictException('此样品已关联其他来源或规格');
   if(!link)await tx`INSERT INTO studio_os.warehouse_sample_links(sample_id,item_id,product_id,specification,source_unit,confirmed_by) VALUES(${sampleRow.id},${id},${source.product_id},${source.specification},${source.unit},${who.id})`;
   const [product]=await tx`SELECT name FROM studio_os.products WHERE id=${source.product_id} FOR SHARE`;
   const transferId=randomUUID(),sourceAfter=source.quantity-qty,sourceSnapshot={itemCode:source.item_code,kind:source.kind,productId:source.product_id,productName:product.name,name:source.name,specification:source.specification,unit:source.unit,location:source.location};
   const [movement]=await tx`INSERT INTO studio_os.warehouse_movements(item_id,type,quantity,delta,before_quantity,after_quantity,reason,source_reference,corrects_movement_id,item_snapshot,actor_id) VALUES(${id},'outbound',${qty},${-qty},${source.quantity},${sourceAfter},${reason},${reference},NULL,${JSON.stringify(sourceSnapshot)}::jsonb,${who.id}) RETURNING id`;
   await tx`UPDATE studio_os.warehouse_items SET quantity=${sourceAfter},version=version+1,updated_at=now() WHERE id=${id}`;
   const added=await stockInSampleRecord(tx,who,sampleRow.id,qty,sampleRow.version,reason,{warehouseTransferId:transferId,warehouseItemId:id,warehouseMovementId:movement.id});
   const targetSnapshot={id:sampleRow.id,name:sampleRow.name,productId:sampleRow.product_id,warehouseLocation:sampleRow.warehouse_location,keeperMemberId:sampleRow.keeper_member_id,unit:'件'};
   await tx`INSERT INTO studio_os.warehouse_sample_transfers(id,item_id,sample_id,movement_id,sample_event_id,quantity,source_before,source_after,target_before,target_after,source_snapshot,target_snapshot,actor_id) VALUES(${transferId},${id},${sampleRow.id},${movement.id},${added.eventId},${qty},${source.quantity},${sourceAfter},${added.before.available_quantity},${added.after.available_quantity},${JSON.stringify(sourceSnapshot)}::jsonb,${JSON.stringify(targetSnapshot)}::jsonb,${who.id})`;
   return {id,movementId:String(movement.id),transferId,sampleId:String(sampleRow.id),sampleEventId:added.eventId};
  });
 }
 async transfers(who:Identity,id:string,value:unknown,bySample=false){await currentPermission(this.db,who,'resources');
  const q=this.query(who,value,true);uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const found=bySample?await tx`SELECT id FROM studio_os.shooting_samples WHERE id=${id}`:await tx`SELECT id FROM studio_os.warehouse_items WHERE id=${id}`;if(!found.length)throw new NotFoundException();
   const where=bySample?tx`t.sample_id=${id}`:tx`t.item_id=${id}`;
   const rows=await tx`SELECT t.id,t.item_id AS "itemId",t.sample_id AS "sampleId",t.movement_id AS "movementId",t.sample_event_id AS "sampleEventId",t.quantity,t.source_before AS "sourceBefore",t.source_after AS "sourceAfter",t.target_before AS "targetBefore",t.target_after AS "targetAfter",t.source_snapshot AS "sourceSnapshot",t.target_snapshot AS "targetSnapshot",t.created_at AS "createdAt",m.reason,m.source_reference AS "sourceReference",coalesce(n.display_name,a.username) AS actor FROM studio_os.warehouse_sample_transfers t JOIN studio_os.warehouse_movements m ON m.id=t.movement_id JOIN studio_os.accounts a ON a.id=t.actor_id LEFT JOIN studio_os.members n ON n.login_account_id=a.id WHERE ${where} ORDER BY t.created_at DESC,t.id LIMIT 50 OFFSET ${q.offset}`;
   const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.warehouse_sample_transfers t WHERE ${where}`;return {rows,total:count.n,offset:q.offset,limit:50};
  });
 }
 async movements(who:Identity,id:string,value:unknown){await currentPermission(this.db,who,'resources');
  const q=this.query(who,value,true);uuid(id);if(!(await this.db.client`SELECT id FROM studio_os.warehouse_items WHERE id=${id}`).length)throw new NotFoundException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT ${tx.unsafe(movementProjection)} FROM studio_os.warehouse_movements m LEFT JOIN studio_os.warehouse_sample_transfers t ON t.movement_id=m.id JOIN studio_os.accounts a ON a.id=m.actor_id LEFT JOIN studio_os.members n ON n.login_account_id=a.id WHERE m.item_id=${id} ORDER BY m.created_at DESC,m.id LIMIT 50 OFFSET ${q.offset}`;
   const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.warehouse_movements WHERE item_id=${id}`;return {rows,total:n.n,offset:q.offset,limit:50};
  });
 }
 async movement(who:Identity,id:string,movement:string){await currentPermission(this.db,who,'resources');requireAdministrator(who);uuid(id);uuid(movement);const [r]=await this.db.client`SELECT ${this.db.client.unsafe(movementProjection)} FROM studio_os.warehouse_movements m LEFT JOIN studio_os.warehouse_sample_transfers t ON t.movement_id=m.id JOIN studio_os.accounts a ON a.id=m.actor_id LEFT JOIN studio_os.members n ON n.login_account_id=a.id WHERE m.item_id=${id} AND m.id=${movement}`;if(!r)throw new NotFoundException();return r;}
 async events(who:Identity,id:string,value:unknown){await currentPermission(this.db,who,'resources');
  const q=this.query(who,value,true);uuid(id);if(!(await this.db.client`SELECT id FROM studio_os.warehouse_items WHERE id=${id}`).length)throw new NotFoundException();
  const rows=await this.db.client`SELECT e.id,e.action,e.before_value AS "beforeValue",e.after_value AS "afterValue",e.created_at AS "createdAt",coalesce(m.display_name,a.username) AS actor FROM studio_os.warehouse_item_events e JOIN studio_os.accounts a ON a.id=e.actor_id LEFT JOIN studio_os.members m ON m.login_account_id=a.id WHERE e.item_id=${id} ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET ${q.offset}`;
  const [n]=await this.db.client`SELECT count(*)::int AS n FROM studio_os.warehouse_item_events WHERE item_id=${id}`;return {rows,total:n.n,offset:q.offset,limit:50};
 }
}
