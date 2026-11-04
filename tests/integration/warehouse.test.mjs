import {ProductPurchases} from '../../.build/server/product-purchases.js';
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

test('batch packaging use checks every source, preserves destination provenance and commits the whole sheet once',async()=>{
 const admin=clients[0],employee=clients[1],actor=sessions[1].user.id;
 const store=await admin.saveDirectory('store',undefined,{name:'实际领用店铺'});
 const records=[];
 for(const [index,storeId] of [null,store.id].entries()){
  const item=await admin.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PACK-USE-'+index,
   kind:'packaging',productId:null,name:'批量领用包材 '+index,specification:'',unit:'包',location:'包材架',notes:''});
  await admin.warehouseWrite('allocate-packaging',item.id,{requestKey:randomUUID(),reason:'分配期初',allocations:[{storeId,quantity:5}]},1);
  const row=await admin.warehouseItem(item.id);
  records.push({id:item.id,balance:row.balances[0]});
 }
 const path='/packaging-consumptions';
 const value={requestKey:randomUUID(),reason:'打包领用',lines:records.map(({balance},i)=>({
  balanceId:balance.id,expectedVersion:balance.version,quantity:i+1,usedStoreId:balance.storeId===null?store.id:null
 }))};
 assert.deepEqual((await employee.consumptionOptions()).rows,[]);
 await db.client`INSERT INTO studio_os.inventory_access_grants(account_id,store_id,can_move) VALUES(${actor},NULL,true)`;
 assert.deepEqual((await employee.consumptionOptions()).rows.filter(b=>records.some(r=>r.balance.id===b.id)).map(b=>b.id),[records[0].balance.id]);
 assert.equal((await request(sessions[1],path,'POST',value)).status,403);
 assert.deepEqual(await Promise.all(records.map(async r=>(await admin.warehouseItem(r.id)).quantity)),[5,5]);
 await db.client`INSERT INTO studio_os.inventory_access_grants(account_id,store_id,can_move) VALUES(${actor},${store.id},true)`;
 assert.equal((await request(sessions[1],path,'POST',{...value,lines:[{...value.lines[0],usedStoreId:null},value.lines[1]]})).status,400);
 assert.equal((await request(sessions[1],path,'POST',{...value,lines:[value.lines[0],{...value.lines[1],quantity:6}]})).status,409);
 assert.deepEqual(await Promise.all(records.map(async r=>(await admin.warehouseItem(r.id)).quantity)),[5,5]);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_consumption_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.action='consume-packaging' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$;
  CREATE TRIGGER fail_consumption_receipt BEFORE INSERT ON studio_os.warehouse_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_consumption_receipt();`);
 try{
  assert.equal((await request(sessions[1],path,'POST',value)).status,500);
  assert.deepEqual(await Promise.all(records.map(async r=>(await admin.warehouseItem(r.id)).quantity)),[5,5]);
  assert.deepEqual(await Promise.all(records.map(async r=>(await admin.warehouseHistory(r.id)).total)),[1,1]);
 }finally{await db.client.unsafe('DROP TRIGGER fail_consumption_receipt ON studio_os.warehouse_receipts; DROP FUNCTION studio_os.fail_consumption_receipt()');}
 const results=await Promise.all([request(sessions[1],path,'POST',value),request(sessions[1],path,'POST',value)]);
 assert.ok(results.every(r=>r.status===201));
 const [saved,replay]=await Promise.all(results.map(r=>r.json()));
 assert.deepEqual(replay,saved);
 assert.deepEqual(await employee.consumptionReceipt(value.requestKey),saved);
 assert.equal(await admin.consumptionReceipt(value.requestKey),null);
 const sheet=await employee.consumptionDetail(saved.id);
 assert.equal(sheet.lines.length,2);
 assert.equal(sheet.lines.find(r=>r.snapshot.storeName===null).snapshot.usedStoreName,'实际领用店铺');
 assert.deepEqual(await Promise.all(records.map(async r=>(await admin.warehouseItem(r.id)).quantity)),[4,3]);
 assert.equal((await admin.warehouseHistory(records[0].id)).rows[0].packagingConsumptionId,saved.id);
 await db.client`DELETE FROM studio_os.inventory_access_grants WHERE account_id=${actor} AND store_id=${store.id}`;
 assert.equal((await request(sessions[1],path+'/'+saved.id)).status,403);
 assert.equal((await request(sessions[1],path+'/receipts/'+value.requestKey)).status,403);
 assert.equal((await admin.consumptionDetail(saved.id)).lines.length,2);
});

test('packaging transfers preserve total stock, pair both journals and reject partial or unauthorized updates',async()=>{
 const api=clients[0],item=await api.warehouseWrite('register',undefined,{
  requestKey:randomUUID(),itemCode:'PACK-TRANSFER',kind:'packaging',productId:null,name:'调拨包材',
  specification:'',unit:'包',location:'包材架',notes:''
 });
 const store=await api.saveDirectory('store',undefined,{name:'调拨目标店铺'});
 await api.warehouseWrite('allocate-packaging',item.id,{requestKey:randomUUID(),reason:'核对期初',
  allocations:[{storeId:null,quantity:10},{storeId:store.id,quantity:2}]},1);
 const row=await api.warehouseItem(item.id),source=row.balances.find(b=>b.storeId===null),target=row.balances.find(b=>b.storeId===store.id);
 const value={requestKey:randomUUID(),sourceBalanceId:source.id,targetBalanceId:target.id,
  sourceVersion:source.version,targetVersion:target.version,quantity:4,reason:'补充店铺包材'};
 const path='/warehouse/items/'+item.id+'/packaging-transfers';
 assert.equal((await request(sessions[1],path,'POST',value)).status,403);
 assert.equal((await fetch(base+'/api'+path,{method:'POST',headers:{Origin:base,Cookie:'studio_session='+sessions[0].token,'Content-Type':'application/json'},body:JSON.stringify(value)})).status,403);
 assert.equal((await request(sessions[0],path,'POST',{...value,targetBalanceId:source.id})).status,400);
 for(const change of [{targetBalanceId:randomUUID()},{quantity:11},{targetVersion:2}])
  assert.equal((await request(sessions[0],path,'POST',{...value,...change})).status,409);
 await db.client`UPDATE studio_os.stores SET active=false WHERE id=${store.id}`;
 assert.equal((await request(sessions[0],path,'POST',value)).status,409);
 await db.client`UPDATE studio_os.stores SET active=true WHERE id=${store.id}`;
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_packaging_transfer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.action LIKE 'transfer-packaging:%' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$;
  CREATE TRIGGER fail_packaging_transfer_receipt BEFORE INSERT ON studio_os.warehouse_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_packaging_transfer_receipt();`);
 try{
  assert.equal((await request(sessions[0],path,'POST',value)).status,500);
  assert.deepEqual(await api.warehouseItem(item.id),row);
  assert.equal((await api.warehouseHistory(item.id)).total,2);
 }finally{await db.client.unsafe('DROP TRIGGER fail_packaging_transfer_receipt ON studio_os.warehouse_receipts; DROP FUNCTION studio_os.fail_packaging_transfer_receipt()');}
 const saved=await api.savePackagingTransfer(item.id,value);
 assert.deepEqual(await api.savePackagingTransfer(item.id,value),saved);
 assert.deepEqual(await api.warehouseReceipt(value.requestKey,'transfer-packaging',item.id),saved);
 assert.equal((await request(sessions[0],path,'POST',{...value,requestKey:randomUUID()})).status,409);
 const after=await api.warehouseItem(item.id),doc=await api.packagingTransferDetail(item.id,saved.packagingTransferId);
 assert.equal(after.quantity,12);
 assert.deepEqual(after.balances.map(b=>b.quantity),[6,6]);
 assert.equal(doc.source.snapshot.storeName,null);
 assert.equal(doc.target.snapshot.storeName,'调拨目标店铺');
 for(const line of [doc.source,doc.target])assert.equal((await api.warehouseMovement(item.id,line.id)).packagingTransferId,doc.id);
 assert.equal((await api.warehouseHistory(item.id)).rows.filter(r=>r.packagingTransferId===doc.id).reduce((sum,r)=>sum+r.delta,0),0);
 assert.equal((await request(sessions[1],path+'/'+doc.id)).status,403);
 await assert.rejects(api.warehouseWrite('move',item.id,move('stocktake',7,{packagingBalanceId:source.id,correctsMovementId:doc.source.id}),after.version),e=>e.status===409);
 await db.client`UPDATE studio_os.stores SET name='店铺改名后' WHERE id=${store.id}`;
 assert.deepEqual(await api.packagingTransferDetail(item.id,doc.id),doc);
});

test('reorder alerts use each active balance, refresh with stock, and preserve threshold history',async()=>{
 const api=clients[0],item=await api.warehouseWrite('register',undefined,{
  requestKey:randomUUID(),itemCode:'PACK-REORDER',kind:'packaging',productId:null,name:'补货阈值包材',
  specification:'',unit:'包',location:'包材架',notes:''
 });
 const store=await api.saveDirectory('store',undefined,{name:'补货阈值店铺'});
 await api.warehouseWrite('allocate-packaging',item.id,{requestKey:randomUUID(),reason:'核对期初',
  allocations:[{storeId:null,quantity:0},{storeId:store.id,quantity:3}]},1);
 const row=await api.warehouseItem(item.id),shared=row.balances.find(b=>b.storeId===null),shop=row.balances.find(b=>b.storeId===store.id);
 const alerts=async()=>(await api.warehouseReorderAlerts()).rows.filter(r=>r.itemId===item.id);
 assert.deepEqual(await alerts(),[]);
 assert.equal(shared.reorderThreshold,null);
 const value={requestKey:randomUUID(),threshold:0,reason:'公共库存缺货才提醒'};
 const path='/warehouse/items/'+item.id+'/packaging-balances/'+shared.id+'/reorder-threshold';
 assert.equal((await request(sessions[1],'/warehouse/reorder-alerts')).status,403);
 assert.equal((await request(sessions[1],path,'POST',{...value,expectedVersion:1})).status,403);
 const saved=await api.saveWarehouseReorderThreshold(item.id,shared.id,value,1);
 assert.deepEqual(await api.saveWarehouseReorderThreshold(item.id,shared.id,value,1),saved);
 assert.deepEqual(await api.warehouseReceipt(value.requestKey,'reorder-threshold',item.id,shared.id),saved);
 assert.equal((await request(sessions[0],path,'POST',{...value,requestKey:randomUUID(),expectedVersion:1})).status,409);
 await api.saveWarehouseReorderThreshold(item.id,shop.id,{requestKey:randomUUID(),threshold:3,reason:'到线补货'},1);
 assert.deepEqual((await alerts()).map(r=>r.id),[shared.id,shop.id]);
 const catalog=await api.warehouseCatalog({reorder:true,q:'PACK-REORDER'});
 assert.equal(catalog.total,1);
 assert.equal(catalog.rows[0].reorderAlertCount,2);
 assert.equal((await api.warehouseHistory(item.id)).total,2);
 const events=await api.warehouseHistory(item.id,0,true);
 assert.equal(events.rows[0].beforeValue.reorderChange.threshold,null);
 assert.equal(events.rows[0].afterValue.reorderChange.threshold,3);
 const configured=await api.warehouseItem(item.id);
 await api.warehouseWrite('move',item.id,move('inbound',1,{packagingBalanceId:shared.id}),configured.version);
 assert.deepEqual((await alerts()).map(r=>r.id),[shop.id]);
 await db.client`UPDATE studio_os.stores SET active=false WHERE id=${store.id}`;
 assert.deepEqual(await alerts(),[]);
 assert.equal((await api.warehouseCatalog({reorder:true,q:'PACK-REORDER'})).total,0);
 await db.client`UPDATE studio_os.stores SET active=true WHERE id=${store.id}`;
 await api.saveWarehouseReorderThreshold(item.id,shop.id,{requestKey:randomUUID(),threshold:null,reason:'取消店铺提醒'},2);
 assert.deepEqual(await alerts(),[]);
});

test('formal products and SKU mappings preserve original identities, stock and scoped permissions',async()=>{
 const api=clients[0],original=await api.createProduct({name:'正式商品原产品',storeId:null,notes:'原测试说明',stages:['内容测试']});
 const stock=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'COMM-STOCK',kind:'product',productId:original.id,name:'原产品库存',specification:'黑色',unit:'件',location:'工作室',notes:''});
 const initial=await api.commercialProduct(original.id);
 assert.equal(initial.formal,null);
 assert.equal(initial.stock[0].id,stock.id);
 assert.equal((await request(sessions[1],'/commercial-products/'+original.id)).status,403);
 const formal={requestKey:randomUUID(),code:'PRODUCT-001',reason:'通过测试后登记'};
 const registered=await api.saveCommercialProduct(original.id,'formal',formal,0);
 assert.deepEqual(await api.saveCommercialProduct(original.id,'formal',formal,0),registered);
 assert.deepEqual(await api.commercialProductReceipt(original.id,formal.requestKey,'formal'),registered);
 assert.equal((await api.product(original.id)).version,1);
 assert.equal((await api.product(original.id)).stages[0].name,'内容测试');
 const sku={requestKey:randomUUID(),id:null,code:'SKU-BLACK',specification:'黑色',unit:'件',active:true,warehouseItemId:stock.id,reason:'登记规格并关联原库存'};
 await api.saveCommercialProduct(original.id,'sku',sku,1);
 const state=await api.commercialProduct(original.id),id=state.formal.skus[0].id;
 assert.equal(state.formal.skus[0].warehouseItemId,stock.id);
 assert.equal((await api.warehouseItem(stock.id)).quantity,null);
 await assert.rejects(api.saveCommercialProduct(original.id,'sku',{...sku,requestKey:randomUUID(),code:'SKU-OTHER'},2),e=>e.status===409);
 await assert.rejects(api.saveCommercialProduct(original.id,'sku',{...sku,id,requestKey:randomUUID(),code:'SKU-RENAMED'},2),e=>e.status===409);
 const inventory=await api.warehouseItem(stock.id);
 await assert.rejects(api.warehouseWrite('edit',stock.id,{requestKey:randomUUID(),...metadata(inventory),specification:'白色'},inventory.version),e=>e.status===409);
 const store=await api.saveDirectory('store',undefined,{name:'正式商品店铺'});
 const mapping={requestKey:randomUUID(),skuId:id,storeId:store.id,platformProductId:'XHS-P001',platformSkuId:'XHS-S001',listingUrl:'https://example.com/listing',active:true,reason:'核对店铺商品标识'};
 await api.saveCommercialProduct(original.id,'mapping',mapping,2);
 const linked=await api.commercialProduct(original.id);
 assert.equal(linked.formal.mappings[0].storeId,store.id);
 assert.equal(linked.formal.mappings[0].skuId,id);
 const second={...sku,requestKey:randomUUID(),code:'SKU-WHITE',specification:'白色',warehouseItemId:null};
 await api.saveCommercialProduct(original.id,'sku',second,3);
 const secondId=(await api.commercialProduct(original.id)).formal.skus.find(s=>s.code==='SKU-WHITE').id;
 await assert.rejects(api.saveCommercialProduct(original.id,'mapping',{...mapping,requestKey:randomUUID(),skuId:secondId},4),e=>e.status===409);
 const before=(await api.commercialProductHistory(original.id)).rows[1];
 await db.client`UPDATE studio_os.stores SET name='店铺新名称',active=false WHERE id=${store.id}`;
 await assert.rejects(api.saveCommercialProduct(original.id,'mapping',{...mapping,requestKey:randomUUID()},4),e=>e.status===409);
 await api.saveCommercialProduct(original.id,'mapping',{...mapping,requestKey:randomUUID(),active:false},4);
 assert.deepEqual((await api.commercialProductHistory(original.id)).rows.find(e=>e.id===before.id),before);
 assert.equal((await api.commercialProduct(original.id)).formal.mappings[0].active,false);
 assert.equal((await api.warehouseItem(stock.id)).id,stock.id);
 assert.equal((await api.product(original.id)).id,original.id);
});

test('concurrent SKU edits share one version and audit failures roll back SKU registration',async()=>{
 const api=clients[0],product=await api.createProduct({name:'SKU 并发验证',storeId:null,notes:'',stages:['测试']});
 await api.saveCommercialProduct(product.id,'formal',{requestKey:randomUUID(),code:'COMM-CONCURRENT',reason:'手动登记'},0);
 const value={id:null,specification:'标准',unit:'件',active:true,warehouseItemId:null,reason:'登记规格',expectedVersion:1};
 const replies=await Promise.all([0,0].map((actor,i)=>request(sessions[actor],'/commercial-products/'+product.id+'/sku','POST',{
  ...value,requestKey:randomUUID(),code:'CONCURRENT-SKU-'+i
 })));
 assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 assert.equal((await api.commercialProduct(product.id)).formal.skus.length,1);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_commercial_audit() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'test audit rollback'; END; $$;
  CREATE TRIGGER fail_commercial_audit BEFORE INSERT ON studio_os.commercial_product_events FOR EACH ROW EXECUTE FUNCTION studio_os.fail_commercial_audit();`);
 try{
  const response=await request(sessions[0],'/commercial-products/'+product.id+'/sku','POST',{
   ...value,expectedVersion:2,requestKey:randomUUID(),code:'SKU-ROLLBACK'
  });
  assert.equal(response.status,500);
  const state=await api.commercialProduct(product.id);
  assert.equal(state.formal.version,2);
  assert.equal(state.formal.skus.length,1);
  assert.equal((await api.commercialProductHistory(product.id)).total,2);
 }finally{await db.client.unsafe('DROP TRIGGER fail_commercial_audit ON studio_os.commercial_product_events; DROP FUNCTION studio_os.fail_commercial_audit()');}
});

test('formal SKU stock reuses original scope balances and debits the selected source when becoming samples',async()=>{
 const api=clients[0],product=await api.createProduct({name:'商品分账原产品',storeId:null,notes:'原测试记录保留',stages:['测试']});
 const item=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PRODUCT-SCOPES',kind:'product',productId:product.id,name:'正式商品蓝色',specification:'蓝色',unit:'件',location:'商品架',notes:''});
 const opening=await api.warehouseWrite('move',item.id,move('opening',10),1);
 const store=await api.saveDirectory('store',undefined,{name:'商品库存店铺'});
 const allocation={requestKey:randomUUID(),reason:'按实盘分配归属',allocations:[{storeId:null,quantity:4},{storeId:store.id,quantity:6}]};
 await assert.rejects(api.warehouseWrite('allocate-product',item.id,allocation,2),e=>e.status===409);
 await api.saveCommercialProduct(product.id,'formal',{requestKey:randomUUID(),code:'PRODUCT-SCOPES-FORMAL',reason:'测试后登记正式商品'},0);
 await api.saveCommercialProduct(product.id,'sku',{requestKey:randomUUID(),id:null,code:'PRODUCT-SCOPES-SKU',specification:'蓝色',unit:'件',active:true,warehouseItemId:item.id,reason:'关联原库存'},1);
 const wrong={...allocation,allocations:[{storeId:null,quantity:9}]};
 await assert.rejects(api.warehouseWrite('allocate-product',item.id,wrong,2),e=>e.status===409);
 await assert.rejects(api.warehouseWrite('allocate-packaging',item.id,allocation,2),e=>e.status===409);
 assert.equal((await request(sessions[1],'/warehouse/items/'+item.id+'/product-balances','POST',{...allocation,expectedVersion:2})).status,403);
 const saved=await api.warehouseWrite('allocate-product',item.id,allocation,2);
 assert.deepEqual(await api.warehouseWrite('allocate-product',item.id,allocation,2),saved);
 const scoped=await api.warehouseItem(item.id),shared=scoped.balances.find(b=>b.storeId===null),shop=scoped.balances.find(b=>b.storeId===store.id);
 assert.equal(scoped.id,item.id);assert.equal(scoped.inventoryScoped,true);assert.equal(scoped.packagingScoped,false);
 assert.equal(scoped.quantity,10);assert.equal((await api.warehouseMovement(item.id,opening.movementId)).packagingBalanceId,null);
 assert.equal((await api.commercialProduct(product.id)).formal.skus[0].warehouseItemId,item.id);
 await assert.rejects(api.warehouseWrite('move',item.id,move('outbound',1),scoped.version),e=>e.status===409);
 await assert.rejects(api.warehouseWrite('move',item.id,move('outbound',5,{packagingBalanceId:shared.id}),scoped.version),e=>e.status===409);
 const transferred=await api.savePackagingTransfer(item.id,{requestKey:randomUUID(),sourceBalanceId:shop.id,targetBalanceId:shared.id,sourceVersion:1,targetVersion:1,quantity:2,reason:'补公共备货'},'product');
 assert.equal((await api.warehouseItem(item.id)).quantity,10);
 assert.equal((await api.packagingTransferDetail(item.id,transferred.packagingTransferId,undefined,'product')).source.snapshot.productId,product.id);
 const row=await api.warehouseItem(item.id),value={requestKey:randomUUID(),quantity:2,reason:'转为拍摄样品',sourceReference:'',confirmed:true,target:{mode:'new',name:'蓝色拍摄样品',warehouseLocation:'样品架',keeperMemberId:null,notes:''}};
 await assert.rejects(api.warehouseToSamples(item.id,value,row.version),e=>e.status===409);
 const sample=await api.warehouseToSamples(item.id,{...value,sourceBalanceId:shared.id},row.version);
 const after=await api.warehouseItem(item.id);
 assert.equal(after.quantity,8);
 assert.equal(after.balances.find(b=>b.id===shared.id).quantity,4);
 assert.equal(after.balances.find(b=>b.id===shop.id).quantity,4);
 const movement=await api.warehouseMovement(item.id,sample.movementId);
 assert.equal(movement.packagingBalanceId,shared.id);assert.equal(movement.beforeQuantity,6);assert.equal(movement.afterQuantity,4);
 const history=await api.warehouseTransfers(item.id);
 assert.equal(history.rows[0].sourceSnapshot.balanceId,shared.id);
 assert.equal(history.rows[0].sourceBefore,6);assert.equal(history.rows[0].sourceAfter,4);
 assert.equal((await api.products()).find(p=>p.id===product.id).id,product.id);
 assert.equal((await api.sampleCatalog()).rows.find(s=>s.id===sample.sampleId).available_quantity,2);
});

test('authorized product batches preserve SKU, business dates and store facts without exposing other scopes',async()=>{
 const admin=clients[0],auth=new Authentication(db),username='stock_batch_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
 const [account]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},'employee') RETURNING id`;
 await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${username},${account.id})`;
 async function login(){
  const session=await auth.login(username,password,'stock-batch-'+randomUUID());
  const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+session.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});
  await api.session();return {session,api};
 }
 const stores=[];for(const name of ['发货业务甲店','其他库存乙店'])stores.push(await admin.saveDirectory('store',undefined,{name}));
 const product=await admin.createProduct({name:'批量出入库正式商品',storeId:null,notes:'原说明',stages:['测试']});
 const item=await admin.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PRODUCT-BATCH',kind:'product',productId:product.id,name:'商品批量库存',specification:'标准',unit:'件',location:'工作室',notes:'管理员库存备注'});
 await admin.saveCommercialProduct(product.id,'formal',{requestKey:randomUUID(),code:'PRODUCT-BATCH-FORMAL',reason:'登记'},0);
 await admin.saveCommercialProduct(product.id,'sku',{requestKey:randomUUID(),id:null,code:'PRODUCT-BATCH-SKU',specification:'标准',unit:'件',active:true,warehouseItemId:item.id,reason:'关联原库存'},1);
 await admin.warehouseWrite('allocate-product',item.id,{requestKey:randomUUID(),reason:'实际期初',allocations:[{storeId:null,quantity:5},...stores.map(s=>({storeId:s.id,quantity:5}))]},1);
 const row=await admin.warehouseItem(item.id),shared=row.balances.find(b=>b.storeId===null),shop=row.balances.find(b=>b.storeId===stores[0].id),hidden=row.balances.find(b=>b.storeId===stores[1].id);
 const grant=async canMove=>{const scope=await admin.inventoryAccess(account.id);await admin.saveInventoryAccess(account.id,{requestKey:randomUUID(),reason:'职责授权',grants:[{storeId:null,canMove:true},{storeId:stores[0].id,canMove}]},scope.version);};
 await grant(false);let employee=await login();
 const visible=await employee.api.scopedWarehouseCatalog({},undefined,'product');
 assert.ok(visible.rows.some(b=>b.id===shop.id&&!b.canMove));assert.ok(!visible.rows.some(b=>b.id===hidden.id));
 assert.ok(!(await employee.api.productStockOptions()).rows.some(b=>b.id===shop.id));
 const sheet={requestKey:randomUUID(),operation:'inbound',businessDate:'2020-01-02',sourceReference:'到货单 ORIGINAL-01',reason:'实际到货核对',lines:[
  {balanceId:shared.id,expectedVersion:1,quantity:3,businessStoreId:null},{balanceId:shop.id,expectedVersion:1,quantity:2,businessStoreId:null}
 ]};
 await assert.rejects(employee.api.saveProductStockDocument(sheet),e=>e.status===403);
 assert.equal((await admin.warehouseItem(item.id)).quantity,15);
 await grant(true);employee=await login();
 const inbound=await employee.api.saveProductStockDocument(sheet);
 assert.deepEqual(await employee.api.saveProductStockDocument(sheet),inbound);
 assert.deepEqual(await employee.api.productStockReceipt(sheet.requestKey),inbound);
 assert.equal(await admin.productStockReceipt(sheet.requestKey),null);
 const received=await employee.api.productStockDocument(inbound.id);
 assert.equal(received.businessDate,'2020-01-02');assert.equal(received.sourceReference,'到货单 ORIGINAL-01');
 assert.equal(received.lines.length,2);assert.ok(received.lines.every(line=>line.snapshot.skuCode==='PRODUCT-BATCH-SKU'));
 assert.doesNotMatch(JSON.stringify(received),/管理员库存备注|amountCents|totalCents|unitCents/);
 const current=await admin.warehouseItem(item.id);
 assert.equal(current.quantity,20);assert.equal(current.balances.find(b=>b.id===hidden.id).quantity,5);
 const shipment={...sheet,requestKey:randomUUID(),operation:'shipment',businessDate:'2020-01-03',sourceReference:'发货批次 ORIGINAL-02',lines:[
  {balanceId:shared.id,expectedVersion:2,quantity:2,businessStoreId:stores[0].id},{balanceId:shop.id,expectedVersion:2,quantity:1,businessStoreId:null}
 ]};
 await assert.rejects(employee.api.saveProductStockDocument({...shipment,lines:[shipment.lines[0],{...shipment.lines[1],quantity:99}]}),e=>e.status===409);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_product_stock_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.action LIKE 'product-stock:%' THEN RAISE EXCEPTION 'test batch rollback'; END IF; RETURN NEW; END; $$;
  CREATE TRIGGER fail_product_stock_receipt BEFORE INSERT ON studio_os.warehouse_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_product_stock_receipt();`);
 const post=value=>fetch(base+'/api/product-stock-documents',{method:'POST',headers:{Origin:base,Cookie:'studio_session='+employee.session.token,'x-csrf-token':employee.session.csrf,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  assert.equal((await post(shipment)).status,500);
  assert.deepEqual(await admin.warehouseItem(item.id),current);
 }finally{await db.client.unsafe('DROP TRIGGER fail_product_stock_receipt ON studio_os.warehouse_receipts; DROP FUNCTION studio_os.fail_product_stock_receipt()');}
 const replies=await Promise.all([post(shipment),post(shipment)]);assert.ok(replies.every(r=>r.status===201));
 const [saved,replay]=await Promise.all(replies.map(r=>r.json()));assert.deepEqual(saved,replay);
 const shipped=await employee.api.productStockDocument(saved.id);
 assert.ok(shipped.lines.every(line=>line.snapshot.businessStoreName==='发货业务甲店'));
 assert.equal((await admin.warehouseItem(item.id)).quantity,17);
 assert.ok((await admin.warehouseHistory(item.id)).rows.filter(m=>m.productStockDocumentId===saved.id).every(m=>m.type==='outbound'));
 assert.equal((await employee.api.scopedWarehouseDetail(shared.id,0,undefined,'product')).balance.quantity,6);
 assert.equal((await employee.api.scopedWarehouseDetail(shop.id,0,undefined,'product')).balance.quantity,6);
 const scope=await admin.inventoryAccess(account.id);
 await admin.saveInventoryAccess(account.id,{requestKey:randomUUID(),reason:'收回甲店范围',grants:[{storeId:null,canMove:true}]},scope.version);
 employee=await login();
 await assert.rejects(employee.api.productStockDocument(saved.id),e=>e.status===403);
 await assert.rejects(employee.api.productStockReceipt(shipment.requestKey),e=>e.status===403);
 assert.equal((await admin.productStockDocument(saved.id)).lines.length,2);
});

test('resellable returns retain shipment provenance and cannot exceed the shipped quantity under concurrent retries',async()=>{
 const admin=clients[0],auth=new Authentication(db),username='returns_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
 const [actor]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},'employee') RETURNING id`;
 await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${username},${actor.id})`;
 async function grant(canMove){const current=await admin.inventoryAccess(actor.id);await admin.saveInventoryAccess(actor.id,{requestKey:randomUUID(),reason:'退货职责授权',grants:[{storeId:null,canMove}]},current.version);}
 async function login(){
  const session=await auth.login(username,password,'returns-'+randomUUID());
  const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+session.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});
  await api.session();return {api,session};
 }
 await grant(true);let employee=await login();
 const product=await admin.createProduct({name:'退货原商品',storeId:null,notes:'',stages:['测试']});
 const item=await admin.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'RETURN-STOCK',kind:'product',productId:product.id,name:'可再销售商品',specification:'标准',unit:'件',location:'工作室',notes:''});
 await admin.saveCommercialProduct(product.id,'formal',{requestKey:randomUUID(),code:'RETURN-PRODUCT',reason:'登记正式商品'},0);
 await admin.saveCommercialProduct(product.id,'sku',{requestKey:randomUUID(),id:null,code:'RETURN-SKU',specification:'标准',unit:'件',active:true,warehouseItemId:item.id,reason:'绑定原库存'},1);
 await admin.warehouseWrite('allocate-product',item.id,{requestKey:randomUUID(),reason:'实盘',allocations:[{storeId:null,quantity:8}]},1);
 const balance=(await admin.warehouseItem(item.id)).balances[0],store=await admin.saveDirectory('store',undefined,{name:'原发货业务店铺'});
 const shipment=await employee.api.saveProductStockDocument({requestKey:randomUUID(),operation:'shipment',businessDate:'2020-02-01',sourceReference:'原发货批次',reason:'实际发货',lines:[{balanceId:balance.id,expectedVersion:1,quantity:5,businessStoreId:store.id}]});
 const source=(await employee.api.productStockDocument(shipment.id)).lines[0];
 const originalMovement=await admin.warehouseMovement(item.id,source.id),before=await admin.warehouseItem(item.id);
 assert.equal(source.returnedQuantity,0);assert.equal(source.canReturn,true);
 const value={requestKey:randomUUID(),businessDate:'2020-02-02',sourceReference:'退货实物来源',reason:'验收可重新销售',resellableConfirmed:true,lines:[{shipmentMovementId:source.id,expectedVersion:source.currentVersion,quantity:2}]};
 const post=(body,csrf=true)=>fetch(base+'/api/product-stock-documents/'+shipment.id+'/returns',{method:'POST',headers:{Origin:base,Cookie:'studio_session='+employee.session.token,'Content-Type':'application/json',...(csrf?{'x-csrf-token':employee.session.csrf}:{})},body:JSON.stringify(body)});
 assert.equal((await post({...value,resellableConfirmed:false})).status,400);
 assert.equal((await post({...value,businessDate:'2020-01-31'})).status,400);
 assert.equal((await post({...value,lines:[{...value.lines[0],shipmentMovementId:randomUUID()}]})).status,400);
 assert.equal((await post(value,false)).status,403);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_product_return_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.action LIKE 'product-stock:return:%' THEN RAISE EXCEPTION 'test return rollback'; END IF; RETURN NEW; END; $$;
  CREATE TRIGGER fail_product_return_receipt BEFORE INSERT ON studio_os.warehouse_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_product_return_receipt();`);
 try{
  assert.equal((await post(value)).status,500);
  assert.deepEqual(await admin.warehouseItem(item.id),before);
  assert.equal((await employee.api.productStockDocument(shipment.id)).lines[0].returnedQuantity,0);
 }finally{await db.client.unsafe('DROP TRIGGER fail_product_return_receipt ON studio_os.warehouse_receipts; DROP FUNCTION studio_os.fail_product_return_receipt()');}
 const returned=await employee.api.saveProductStockReturn(shipment.id,value);
 assert.deepEqual(await employee.api.saveProductStockReturn(shipment.id,value),returned);
 assert.deepEqual(await employee.api.productStockReceipt(value.requestKey,shipment.id),returned);
 const receipt=await employee.api.productStockDocument(returned.id);
 assert.equal(receipt.operation,'return');assert.equal(receipt.sourceShipmentId,shipment.id);assert.equal(receipt.resellableConfirmed,true);
 assert.equal(receipt.lines[0].snapshot.returnOfMovementId,source.id);assert.equal(receipt.lines[0].snapshot.businessStoreName,'原发货业务店铺');
 assert.equal((await admin.warehouseItem(item.id)).quantity,5);
 let remaining=(await employee.api.productStockDocument(shipment.id)).lines[0];
 const second={...value,lines:[{shipmentMovementId:source.id,expectedVersion:remaining.currentVersion,quantity:2}]};
 const replies=await Promise.all([post({...second,requestKey:randomUUID()}),post({...second,requestKey:randomUUID()})]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 remaining=(await employee.api.productStockDocument(shipment.id)).lines[0];
 assert.equal(remaining.returnedQuantity,4);
 assert.equal((await post({...value,requestKey:randomUUID(),lines:[{shipmentMovementId:source.id,expectedVersion:remaining.currentVersion,quantity:2}]})).status,409);
 await employee.api.saveProductStockReturn(shipment.id,{...value,requestKey:randomUUID(),lines:[{shipmentMovementId:source.id,expectedVersion:remaining.currentVersion,quantity:1}]});
 assert.equal((await admin.warehouseItem(item.id)).quantity,8);
 assert.deepEqual(await admin.warehouseMovement(item.id,source.id),originalMovement);
 await grant(false);employee=await login();
 assert.equal((await employee.api.productStockDocument(shipment.id)).lines[0].canReturn,false);
 assert.equal((await post({...value,requestKey:randomUUID()})).status,403);
 await assert.rejects(employee.api.productStockReceipt(value.requestKey,shipment.id),e=>e.status===403);
 assert.equal((await admin.productStockDocument(returned.id)).sourceShipmentId,shipment.id);
});

test('purchase cost versions use original inbound quantities and protect prices without receiving stock twice',async()=>{
 const api=clients[0],store=await api.saveDirectory('store',undefined,{name:'采购成本店铺'}),product=await api.createProduct({name:'采购成本原商品',storeId:null,notes:'',stages:['测试']});
 await api.saveCommercialProduct(product.id,'formal',{requestKey:randomUUID(),code:'PURCHASE-COST-PRODUCT',reason:'登记'},0);
 const inventory=[];
 for(const [i,specification] of ['蓝色','红色'].entries()){
  const item=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'PURCHASE-STOCK-'+i,kind:'product',productId:product.id,name:'成本商品 '+specification,specification,unit:'件',location:'工作室',notes:''});
  await api.saveCommercialProduct(product.id,'sku',{requestKey:randomUUID(),id:null,code:'PURCHASE-SKU-'+i,specification,unit:'件',active:true,warehouseItemId:item.id,reason:'关联原库存'},i+1);
  await api.warehouseWrite('allocate-product',item.id,{requestKey:randomUUID(),reason:'核对期初',allocations:[{storeId:i?store.id:null,quantity:0}]},1);
  inventory.push({id:item.id,balance:(await api.warehouseItem(item.id)).balances[0]});
 }
 const incoming=await api.saveProductStockDocument({requestKey:randomUUID(),operation:'inbound',businessDate:'2020-03-01',sourceReference:'采购到货记录',reason:'实际收货',lines:inventory.map((row,i)=>({balanceId:row.balance.id,expectedVersion:1,quantity:i?2:3,businessStoreId:i?store.id:null}))});
 const document=await api.productStockDocument(incoming.id),snapshot=await Promise.all(inventory.map(row=>api.warehouseItem(row.id)));
 const category=await api.createExpenseCategory('原商品采购款'),expenseBody={expenseDate:'2020-02-29',description:'原商品采购支付',amount:'8.00',paymentMode:'company',payerId:null,storeId:null,categoryId:category.id,note:'原支付记录'};
 const expense=await api.saveExpense(undefined,{...expenseBody,requestKey:randomUUID()}),ledgerCount=(await api.finance()).records.length;
 const body={requestKey:randomUUID(),expectedVersion:0,code:'PURCHASE-COST-BATCH',purchaseDate:'2020-02-29',supplier:'采购供应商',expenseId:expense.id,expenseVersion:1,reason:'按采购票据核对',lines:document.lines.map(line=>({movementId:line.id,unitPrice:line.quantity===3?'1.25':'2.00',additionalAmount:line.quantity===3?'0.02':'0.03'}))};
 const path='/product-purchases/'+incoming.id;
 assert.equal((await request(sessions[1],path)).status,403);
 await assert.rejects(new ProductPurchases(db).state(sessions[2].user,incoming.id),e=>e.status===403);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_product_purchase_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test purchase rollback'; END; $$;
  CREATE TRIGGER fail_product_purchase_receipt BEFORE INSERT ON studio_os.product_purchase_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_product_purchase_receipt();`);
 try{
  assert.equal((await request(sessions[0],path,'POST',body)).status,500);
  assert.equal((await api.productPurchase(incoming.id)).batch,null);
  assert.deepEqual(await Promise.all(inventory.map(row=>api.warehouseItem(row.id))),snapshot);
 }finally{await db.client.unsafe('DROP TRIGGER fail_product_purchase_receipt ON studio_os.product_purchase_receipts; DROP FUNCTION studio_os.fail_product_purchase_receipt()');}
 const saved=await api.saveProductPurchase(incoming.id,body);
 assert.deepEqual(await api.saveProductPurchase(incoming.id,body),saved);
 assert.deepEqual(await api.productPurchaseReceipt(incoming.id,body.requestKey),saved);
 const state=await api.productPurchase(incoming.id),frozen=(await api.productPurchaseHistory(incoming.id)).rows[0];
 assert.equal(state.record.goodsCents,775);assert.equal(state.record.additionalCents,5);assert.equal(state.record.totalCents,780);
 assert.equal(state.record.expenseSnapshot.amountCents,800);
 assert.deepEqual(await Promise.all(inventory.map(row=>api.warehouseItem(row.id))),snapshot);
 assert.equal((await api.finance()).records.length,ledgerCount);
 assert.doesNotMatch(JSON.stringify(await api.warehouseHistory(inventory[0].id)),/采购供应商|unitCents|additionalCents/);
 const financeUsername='purchase_finance_'+randomBytes(5).toString('hex'),financePassword=randomBytes(24).toString('hex');
 await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,admin_permissions) VALUES(${financeUsername},${await hashPassword(financePassword)},'admin',ARRAY['finance'])`;
 const financeSession=await new Authentication(db).login(financeUsername,financePassword,'purchase-finance');
 assert.equal((await request(financeSession,path)).status,200);
 assert.equal((await request(financeSession,path,'POST',{...body,requestKey:randomUUID(),expectedVersion:1})).status,403);
 const revisions=await Promise.all([request(sessions[0],path,'POST',{...body,requestKey:randomUUID(),expectedVersion:1,reason:'复核价格甲'}),request(sessions[0],path,'POST',{...body,requestKey:randomUUID(),expectedVersion:1,reason:'复核价格乙'})]);
 assert.deepEqual(revisions.map(r=>r.status).sort(),[201,409]);
 await api.saveExpense(expense.id,{...expenseBody,description:'支付来源已核对修改'},1);
 assert.equal((await api.productPurchase(incoming.id)).sourceChanged,true);
 assert.equal((await request(sessions[0],path,'POST',{...body,requestKey:randomUUID(),expectedVersion:2})).status,409);
 await api.saveProductPurchase(incoming.id,{...body,requestKey:randomUUID(),expectedVersion:2,expenseVersion:2,reason:'重新核对原支出'});
 assert.equal((await api.productPurchase(incoming.id)).sourceChanged,false);
 assert.deepEqual((await api.productPurchaseHistory(incoming.id)).rows.find(row=>row.id===frozen.id),frozen);
 const second=await api.saveProductStockDocument({requestKey:randomUUID(),operation:'inbound',businessDate:'2020-03-02',sourceReference:'第二次收货',reason:'实收',lines:[{balanceId:inventory[0].balance.id,expectedVersion:2,quantity:1,businessStoreId:null}]});
 const secondLine=(await api.productStockDocument(second.id)).lines[0];
 assert.equal((await request(sessions[0],'/product-purchases/'+second.id,'POST',{...body,requestKey:randomUUID(),code:'PURCHASE-COST-OTHER',expenseVersion:2,lines:[{movementId:secondLine.id,unitPrice:'1.00',additionalAmount:'0.00'}]})).status,409);
 assert.equal((await api.productPurchase(second.id)).batch,null);
 assert.equal((await api.warehouseItem(inventory[0].id)).quantity,4);
});
