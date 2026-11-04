import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {Warehouse} from '../../.build/server/warehouse.js';
import {createCloudApi,ContractError} from '../../dist/cloud-api.mjs';
let local,db,app,base,product,stock,pack,openingId,outboundId,correctionId,registrationKey;const sessions=[],clients=[];
const request=(s,path,method='GET',body)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,'x-csrf-token':s.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const metadata=r=>({itemCode:r.itemCode,kind:r.kind,productId:r.productId,name:r.name,specification:r.specification,unit:r.unit,location:r.location,notes:r.notes,active:r.active});
const move=(type,quantity,extra={})=>({requestKey:randomUUID(),type,quantity,reason:'实际登记 '+type,sourceReference:'',correctsMovementId:null,...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);const auth=new Authentication(db);
 for(const [i,role] of ['admin','employee','admin'].entries()){
  const username='warehouse_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;
  await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${'仓库隔离成员 '+i},${u.id})`;if(role==='admin')await db.client`UPDATE studio_os.accounts SET superadmin=true WHERE id=${u.id}`;sessions.push(await auth.login(username,password,'warehouse-local-'+i));
 }
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
 product=await clients[0].createProduct({name:'原经营产品',storeId:null,notes:'保留原产品资料',stages:['内容测试']});await checkReadiness(db);
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('warehouse registration reuses product identity, keeps unknown opening stock and casefold-unique codes',async()=>{
 const api=clients[0];registrationKey=randomUUID();const value={requestKey:registrationKey,itemCode:'SKU-001',kind:'product',productId:product.id,name:'经营产品黑色',specification:'黑色',unit:'件',location:'商品架 A',notes:'原库存备注'};
 stock=await api.warehouseWrite('register',undefined,value);assert.deepEqual(await api.warehouseWrite('register',undefined,value),stock);
 const row=await api.warehouseItem(stock.id);assert.equal(row.productId,product.id);assert.equal(row.openingConfirmed,false);assert.equal(row.quantity,null);assert.equal(row.version,1);
 await assert.rejects(api.warehouseWrite('register',undefined,{...value,requestKey:randomUUID(),itemCode:'sku-001'}),e=>e.status===409);
 const catalog=await api.warehouseCatalog();assert.equal(catalog.total,1);assert.equal(catalog.summary[0].pendingCount,1);assert.equal(catalog.summary[0].initializedCount,0);
 pack=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PACK-001',kind:'packaging',productId:null,name:'包装材料',specification:'原规格',unit:'包',location:'包材架',notes:''});
 assert.equal((await api.products()).length,1);assert.equal((await api.products())[0].id,product.id);
 assert.equal((await clients[2].warehouseCatalog()).total,2);assert.equal((await request(sessions[2],'/warehouse/receipts/'+registrationKey)).status,404);
});
test('zero opening balance is explicit, opening is one-time, and idempotent receipts never duplicate stock',async()=>{
 const api=clients[0];await assert.rejects(api.warehouseWrite('move',stock.id,move('inbound',5),1),e=>e.status===409);assert.equal((await api.warehouseHistory(stock.id)).total,0);
 const value=move('opening',0);const result=await api.warehouseWrite('move',stock.id,value,1);openingId=result.movementId;
 const replies=await Promise.all([request(sessions[0],'/warehouse/items/'+stock.id+'/movements','POST',{...value,expectedVersion:1}),request(sessions[0],'/warehouse/items/'+stock.id+'/movements','POST',{...value,expectedVersion:1})]);assert.ok(replies.every(r=>r.status===201));assert.deepEqual(await replies[0].json(),result);assert.deepEqual(await replies[1].json(),result);
 let row=await api.warehouseItem(stock.id);assert.equal(row.quantity,0);assert.equal(row.openingConfirmed,true);assert.equal(row.version,2);assert.equal((await api.warehouseHistory(stock.id)).total,1);
 await assert.rejects(api.warehouseWrite('move',stock.id,{...value,quantity:1},1),e=>e.status===409);await assert.rejects(api.warehouseWrite('move',stock.id,move('opening',2),row.version),e=>e.status===409);
 const inbound=move('inbound',5,{sourceReference:'送货单 TEST-01'});await api.warehouseWrite('move',stock.id,inbound,row.version);await api.warehouseWrite('move',stock.id,inbound,row.version);row=await api.warehouseItem(stock.id);assert.equal(row.quantity,5);assert.equal(row.version,3);assert.equal((await api.warehouseHistory(stock.id)).total,2);
});
test('concurrent outbound requests cannot overdraw stock or create partial receipts and journal entries',async()=>{
 const row=await clients[0].warehouseItem(stock.id),values=[move('outbound',4),move('outbound',4)];
 const replies=await Promise.all(values.map((v,i)=>request(sessions[i===0?0:2],'/warehouse/items/'+stock.id+'/movements','POST',{...v,expectedVersion:row.version})));assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 const winner=replies.find(r=>r.status===201);outboundId=(await winner.json()).movementId;const fresh=await clients[0].warehouseItem(stock.id);assert.equal(fresh.quantity,1);assert.equal(fresh.version,4);assert.equal((await clients[0].warehouseHistory(stock.id)).total,3);
 const failed=replies[0].status===409?0:1;assert.equal((await request(sessions[failed===0?0:2],'/warehouse/receipts/'+values[failed].requestKey)).status,404);
});
test('stocktake correction appends a referenced fact, locks units and retains historical metadata after editing',async()=>{
 const api=clients[0];let row=await api.warehouseItem(stock.id);const result=await api.warehouseWrite('move',stock.id,move('stocktake',3,{reason:'盘点发现补录，引用原出库',correctsMovementId:outboundId}),row.version);correctionId=result.movementId;
 const correction=await api.warehouseMovement(stock.id,correctionId);assert.equal(correction.delta,2);assert.equal(correction.beforeQuantity,1);assert.equal(correction.afterQuantity,3);assert.equal(correction.correctsMovementId,outboundId);
 row=await api.warehouseItem(stock.id);for(const changes of [{unit:'箱'},{specification:'另一规格'},{kind:'packaging',productId:null}])await assert.rejects(api.warehouseWrite('edit',stock.id,{requestKey:randomUUID(),...metadata(row),...changes},row.version),e=>e.status===409);
 await api.warehouseWrite('edit',stock.id,{requestKey:randomUUID(),...metadata(row),itemCode:'SKU-UPDATED',name:'经营产品更新名',location:'商品架 B'},row.version);
 row=await api.warehouseItem(stock.id);assert.equal(row.quantity,3);assert.equal(row.notes,'原库存备注');
 const original=await api.warehouseMovement(stock.id,outboundId);assert.equal(original.itemSnapshot.itemCode,'SKU-001');assert.equal(original.itemSnapshot.name,'经营产品黑色');assert.equal(original.itemSnapshot.location,'商品架 A');assert.equal(original.delta,-4);assert.equal((await api.warehouseHistory(stock.id,0,true)).total,2);
 const other=await api.warehouseWrite('move',pack.id,move('opening',10),1);await assert.rejects(api.warehouseWrite('move',stock.id,move('stocktake',3,{correctsMovementId:other.movementId}),row.version),e=>e.status===400);
});
test('negative stock, integer overflow, missing data and inactive writes roll back while zero-difference counts are recorded',async()=>{
 const api=clients[0];let row=await api.warehouseItem(stock.id),count=(await api.warehouseHistory(stock.id)).total;
 for(const value of [move('outbound',4),move('inbound',2147483647)])await assert.rejects(api.warehouseWrite('move',stock.id,value,row.version),e=>e.status===409);
 for(const quantity of [-1,1.5,2147483648,'2'])assert.equal((await request(sessions[0],'/warehouse/items/'+stock.id+'/movements','POST',{...move('inbound',1),quantity,expectedVersion:row.version})).status,400);
 assert.equal((await request(sessions[0],'/warehouse/items/'+stock.id,'PATCH',{requestKey:randomUUID(),expectedVersion:row.version,...metadata(row),notes:undefined})).status,400);
 assert.equal((await request(sessions[0],'/warehouse/items/'+stock.id,'PATCH',{requestKey:randomUUID(),expectedVersion:row.version,...metadata(row),quantity:999})).status,400);
 assert.equal((await api.warehouseHistory(stock.id)).total,count);assert.equal((await api.warehouseItem(stock.id)).quantity,3);
 await api.warehouseWrite('edit',stock.id,{requestKey:randomUUID(),...metadata(row),active:false},row.version);row=await api.warehouseItem(stock.id);assert.equal(row.quantity,3);assert.ok(!(await api.warehouseCatalog()).rows.some(r=>r.id===row.id));await assert.rejects(api.warehouseWrite('move',stock.id,move('outbound',1),row.version),e=>e.status===409);
 await api.warehouseWrite('edit',stock.id,{requestKey:randomUUID(),...metadata(row),active:true},row.version);row=await api.warehouseItem(stock.id);const same=await api.warehouseWrite('move',stock.id,move('stocktake',3,{reason:'实盘无差异'}),row.version);assert.equal((await api.warehouseMovement(stock.id,same.movementId)).delta,0);
 const packageRow=await api.warehouseItem(pack.id);await api.warehouseWrite('move',pack.id,move('stocktake',0),packageRow.version);assert.equal((await api.warehouseItem(pack.id)).quantity,0);
});
test('quantity journals are append-only at both API and storage boundaries',async()=>{
 const original=await clients[0].warehouseMovement(stock.id,openingId);assert.equal((await request(sessions[0],'/warehouse/items/'+stock.id+'/movements/'+openingId,'PATCH',{quantity:999})).status,404);
 await assert.rejects(db.client`UPDATE studio_os.warehouse_movements SET reason='改写旧流水' WHERE id=${openingId}`,e=>e.code==='23514');await assert.rejects(db.client`DELETE FROM studio_os.warehouse_movements WHERE id=${openingId}`,e=>e.code==='23514');
 const after=await clients[0].warehouseMovement(stock.id,openingId);assert.deepEqual(after,original);assert.equal((await clients[0].finance()).records.length,0);assert.equal((await clients[0].sampleCatalog()).total,0);
});
test('warehouse catalog and unit summaries cover all pages, including unopened items beyond the current page',async()=>{
 const api=clients[0];for(let i=0;i<55;i++){const item=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PAGE-'+i,kind:'packaging',productId:null,name:'分页包材 '+i,specification:'',unit:'卷',location:'分页架',notes:''});await api.warehouseWrite('move',item.id,move('opening',2),1);}
 await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PAGE-PENDING',kind:'packaging',productId:null,name:'分页包材待登记',specification:'',unit:'卷',location:'分页架',notes:''});
 const bag=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PAGE-BAG',kind:'packaging',productId:null,name:'分页包材另一单位',specification:'',unit:'包',location:'分页架',notes:''});await api.warehouseWrite('move',bag.id,move('opening',3),1);
 const first=await api.warehouseCatalog({q:'分页包材'}),second=await api.warehouseCatalog({q:'分页包材',offset:50});assert.equal(first.total,57);assert.equal(first.rows.length,50);assert.equal(second.rows.length,7);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,57);
 const rolls=first.summary.find(r=>r.unit==='卷'),bags=first.summary.find(r=>r.unit==='包');assert.equal(rolls.quantity,'110');assert.equal(rolls.initializedCount,55);assert.equal(rolls.pendingCount,1);assert.equal(bags.quantity,'3');assert.deepEqual(first.summary,second.summary);
});
test('older movement pages remain readable and corrective references retain their original IDs',async()=>{
 const api=clients[0];for(let i=0;i<51;i++){const row=await api.warehouseItem(stock.id);await api.warehouseWrite('move',stock.id,move('stocktake',row.quantity,{reason:'分页盘点 '+i}),row.version);}
 const first=await api.warehouseHistory(stock.id),second=await api.warehouseHistory(stock.id,50);assert.equal(first.rows.length,50);assert.ok(second.rows.length>0);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,first.total);assert.equal((await api.warehouseMovement(stock.id,openingId)).type,'opening');assert.equal((await api.warehouseMovement(stock.id,correctionId)).correctsMovementId,outboundId);
});
test('employee reads/writes, missing CSRF and stale administrator identities cannot change inventory',async()=>{
 const api=clients[0],employee=clients[1];let row=await api.warehouseItem(stock.id);for(const read of [()=>employee.warehouseCatalog(),()=>employee.warehouseItem(stock.id),()=>employee.warehouseHistory(stock.id),()=>employee.warehouseMovement(stock.id,openingId)])await assert.rejects(read(),e=>e.status===403);
 await assert.rejects(employee.warehouseWrite('move',stock.id,move('inbound',1),row.version),e=>e.status===403);
 const noCsrf=await fetch(base+'/api/warehouse/items/'+stock.id+'/movements',{method:'POST',headers:{Cookie:'studio_session='+sessions[0].token,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...move('inbound',1),expectedVersion:row.version})});assert.equal(noCsrf.status,403);
 await api.updateAccountAccess(sessions[2].user.id,{role:'employee',active:true},1);await assert.rejects(new Warehouse(db).move(sessions[2].user,stock.id,{...move('inbound',1),expectedVersion:row.version}),e=>e.status===403);
 assert.equal((await api.warehouseItem(stock.id)).quantity,row.quantity);await checkReadiness(db);
});

test('packaging allocation preserves legacy quantity and ledger while fencing scoped movements',async()=>{
 const api=clients[0],item=await api.warehouseWrite('register',undefined,{
  requestKey:randomUUID(),itemCode:'PACK-SCOPED',kind:'packaging',productId:null,name:'分账包材',
  specification:'',unit:'包',location:'包材架',notes:''
 });
 const store=await api.saveDirectory('store',undefined,{name:'库存测试店'});
 const opening=await api.warehouseWrite('move',item.id,move('opening',10),1);
 const input={requestKey:randomUUID(),reason:'按实盘核对归属',allocations:[{storeId:null,quantity:4},{storeId:store.id,quantity:6}]};
 assert.deepEqual((await api.warehouseItem(item.id)).balances,[]);
 await assert.rejects(api.warehouseWrite('allocate-packaging',item.id,{...input,allocations:[{storeId:null,quantity:9}]},2),e=>e.status===409);
 assert.equal((await request(sessions[1],'/warehouse/items/'+item.id+'/packaging-balances','POST',{...input,expectedVersion:2})).status,403);
 const result=await api.warehouseWrite('allocate-packaging',item.id,input,2);
 assert.deepEqual(await api.warehouseWrite('allocate-packaging',item.id,input,2),result);
 assert.deepEqual(await api.warehouseReceipt(input.requestKey,'allocate-packaging',item.id),result);
 const allocated=await api.warehouseItem(item.id),shared=allocated.balances.find(b=>b.storeId===null);
 assert.equal(allocated.quantity,10);
 assert.equal(allocated.balances.find(b=>b.storeId===store.id).quantity,6);
 assert.equal((await api.warehouseMovement(item.id,opening.movementId)).packagingBalanceId,null);
 await assert.rejects(api.warehouseWrite('move',item.id,move('outbound',1),allocated.version),e=>e.status===409);
 await assert.rejects(api.warehouseWrite('move',item.id,move('outbound',5,{packagingBalanceId:shared.id}),allocated.version),e=>e.status===409);
 await api.warehouseWrite('move',item.id,move('outbound',2,{packagingBalanceId:shared.id}),allocated.version);
 const updated=await api.warehouseItem(item.id);
 assert.equal(updated.quantity,8);
 assert.equal(updated.balances.find(b=>b.id===shared.id).quantity,2);
 assert.equal(updated.balances.find(b=>b.storeId===store.id).quantity,6);
 assert.equal((await api.warehouseHistory(item.id)).total,4);
});

test('one packaging purchase distributes stock atomically and references the existing expense once',async()=>{
 const api=clients[0],item=await api.warehouseWrite('register',undefined,{
  requestKey:randomUUID(),itemCode:'PACK-PURCHASE',kind:'packaging',productId:null,name:'采购包材',
  specification:'',unit:'包',location:'包材架',notes:''
 });
 const stores=[];
 for(const name of ['采购甲店','采购乙店'])stores.push(await api.saveDirectory('store',undefined,{name}));
 await api.warehouseWrite('allocate-packaging',item.id,{requestKey:randomUUID(),reason:'初次核对',
  allocations:[{storeId:null,quantity:0},...stores.map(s=>({storeId:s.id,quantity:0}))]},1);
 const category=await api.createExpenseCategory('已有包材支出'),expenseBody={
  expenseDate:'2020-01-02',storeId:null,categoryId:category.id,description:'原采购财务描述',
  amount:'9.00',paymentMode:'company',payerId:null,note:'原凭据'
 };
 const expense=await api.saveExpense(undefined,{...expenseBody,requestKey:randomUUID()});
 const row=await api.warehouseItem(item.id),path='/warehouse/items/'+item.id+'/packaging-purchases';
 const value={requestKey:randomUUID(),purchaseDate:'2020-01-03',supplier:'私有供应商',unitPrice:'1.25',
  reason:'验收采购',expenseId:expense.id,expenseVersion:1,
  allocations:row.balances.map((b,i)=>({balanceId:b.id,quantity:i+1}))};
 assert.equal((await request(sessions[1],path)).status,403);
 const actorId=sessions[2].user.id;
 await db.client`UPDATE studio_os.accounts SET superadmin=false,admin_permissions=ARRAY['resources'] WHERE id=${actorId}`;
 const service=new Warehouse(db);
 await assert.rejects(service.packagingPurchaseHistory(sessions[2].user,item.id,{}),e=>e.status===403);
 await assert.rejects(service.purchasePackaging(sessions[2].user,item.id,{...value,expectedVersion:2}),e=>e.status===403);
 assert.equal((await request(sessions[0],path,'POST',{...value,expectedVersion:2,expenseVersion:2})).status,409);
 const saved=await api.savePackagingPurchase(item.id,value,2);
 assert.deepEqual(await api.savePackagingPurchase(item.id,value,2),saved);
 assert.deepEqual(await api.packagingPurchaseReceipt(item.id,value.requestKey),saved);
 assert.equal(await api.warehouseReceipt(value.requestKey,'move',item.id),null);
 assert.equal((await request(sessions[0],path,'POST',{...value,requestKey:randomUUID(),expectedVersion:3})).status,409);
 const history=await api.packagingPurchaseHistory(item.id),[purchase]=history.rows;
 assert.equal(history.total,1);assert.equal(purchase.totalCents,750);assert.equal(purchase.expenseSnapshot.amountCents,900);
 assert.equal(purchase.allocations.length,3);
 assert.deepEqual((await api.warehouseItem(item.id)).balances.map(b=>b.quantity),[1,2,3]);
 const ledger=await api.warehouseHistory(item.id);
 assert.equal(ledger.total,6);
 assert.equal(ledger.rows.filter(r=>r.reason==='采购入库').length,3);
 assert.doesNotMatch(JSON.stringify(ledger),/私有供应商|原采购财务描述|totalCents|unitCents/);
 assert.equal((await api.finance()).records.length,1);
 await api.saveExpense(expense.id,{...expenseBody,description:'已复核原支出'},1);
 assert.equal((await api.packagingPurchaseHistory(item.id)).rows[0].sourceChanged,true);
 assert.equal((await api.packagingPurchaseHistory(item.id)).rows[0].expenseSnapshot.description,'原采购财务描述');
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_packaging_purchase_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.action LIKE 'purchase-packaging:%' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$;
  CREATE TRIGGER fail_packaging_purchase_receipt BEFORE INSERT ON studio_os.warehouse_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_packaging_purchase_receipt();`);
 try{
  assert.equal((await request(sessions[0],path,'POST',{...value,requestKey:randomUUID(),expenseId:null,expenseVersion:null,expectedVersion:3})).status,500);
  assert.equal((await api.warehouseItem(item.id)).quantity,6);
  assert.equal((await api.warehouseHistory(item.id)).total,6);
  assert.equal((await api.packagingPurchaseHistory(item.id)).total,1);
 }finally{await db.client.unsafe('DROP TRIGGER fail_packaging_purchase_receipt ON studio_os.warehouse_receipts; DROP FUNCTION studio_os.fail_packaging_purchase_receipt()');}
});
