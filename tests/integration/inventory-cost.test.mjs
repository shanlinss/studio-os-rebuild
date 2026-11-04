import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {InventoryCostEvidence} from '../../.build/server/inventory-cost-evidence.js';
import {createCloudApi,chinaDate} from '../../dist/cloud-api.mjs';
let local,db,app,base;const sessions=[],clients=[],people=[],stores=[],month=chinaDate().slice(0,7);
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const move=(type,quantity,extra={})=>({requestKey:randomUUID(),type,quantity,reason:'实际 '+type,sourceReference:'',correctsMovementId:null,...extra});
const evidence=(state,extra={})=>({requestKey:randomUUID(),expectedVersion:state.record?.version??0,amount:state.source.mode==='basis'?'10.00':null,scope:state.source.mode==='basis'?null:'public',storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:state.source.mode==='basis'?state.source.purchaseSourceVersion:null,sourceReference:'库存成本原始核对表',reason:'按原数量与实际来源核对',...extra});
async function pack(code,opening=0){const api=clients[0],item=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:code,kind:'packaging',productId:null,name:code,specification:'标准',unit:'个',location:'工作室',notes:''});const original=await api.warehouseWrite('move',item.id,move('opening',opening),1);await api.warehouseWrite('allocate-packaging',item.id,{requestKey:randomUUID(),reason:'原数量分账',allocations:[{storeId:null,quantity:opening},...stores.map(storeId=>({storeId,quantity:0}))]},2);return {...item,openingId:original.movementId};}
async function consume(itemId,storeId,quantity){const row=await clients[0].warehouseItem(itemId),balance=row.balances.find(b=>b.storeId===null),doc=await clients[0].saveConsumption({requestKey:randomUUID(),reason:'实际打包领用',lines:[{balanceId:balance.id,expectedVersion:balance.version,quantity,usedStoreId:storeId}]});const [movement]=await db.client`SELECT id FROM studio_os.warehouse_movements WHERE packaging_consumption_id=${doc.id}`;return movement.id;}
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);const auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['finance']],['admin',false,['resources']],['employee',false,[]],['admin',false,['finance','resources']]]){const username='inv_cost_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push(p);sessions.push(await auth.login(username,password,'inventory-cost-local'));}
 for(const name of ['实际领用甲店','实际领用乙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((p,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('actual packaging purchases feed destination use costs, while internal transfers and inventory purchases are not expenses',async()=>{
 const api=clients[0],item=await pack('PACK-ACTUAL'),row=await api.warehouseItem(item.id),shared=row.balances.find(b=>b.storeId===null);
 await api.savePackagingPurchase(item.id,{requestKey:randomUUID(),purchaseDate:chinaDate(),supplier:'原包材供应商',unitPrice:'2.00',expenseId:null,expenseVersion:null,reason:'实际采购十个',allocations:[{balanceId:shared.id,quantity:10}]},row.version);
 let balances=(await api.warehouseItem(item.id)).balances,source=balances.find(b=>b.storeId===null),target=balances.find(b=>b.storeId===stores[0]);await api.savePackagingTransfer(item.id,{requestKey:randomUUID(),sourceBalanceId:source.id,targetBalanceId:target.id,sourceVersion:source.version,targetVersion:target.version,quantity:3,reason:'内部调拨'});
 balances=(await api.warehouseItem(item.id)).balances;source=balances.find(b=>b.storeId===null);target=balances.find(b=>b.storeId===stores[0]);
 const doc=await api.saveConsumption({requestKey:randomUUID(),reason:'按实际业务店铺领用',lines:[{balanceId:source.id,expectedVersion:source.version,quantity:2,usedStoreId:stores[1]},{balanceId:target.id,expectedVersion:target.version,quantity:1,usedStoreId:null}]});
 for(const store of stores)await api.saveMonthIncome(store,{requestKey:randomUUID(),expectedVersion:0,month,amount:'100.00',sourceReference:'月度收入表',reason:'确认本月收入',status:'confirmed'});
 const result=await api.financeOverview(month);assert.equal(result.rows.find(r=>r.storeId===stores[0]).packagingCents,'200');assert.equal(result.rows.find(r=>r.storeId===stores[1]).packagingCents,'400');assert.equal(result.publicCents,'0');assert.equal(result.summary.studioProfitCents,'19400');assert.equal((await api.warehouseItem(item.id)).quantity,7);
 const list=await api.inventoryCosts({month,q:'PACK-ACTUAL'});assert.equal(list.rows.some(r=>r.mode==='excluded'),false);assert.equal(list.rows.filter(r=>r.mode==='automatic').length,2);
 const consumed=list.rows.find(r=>r.mode==='automatic');assert.equal((await req(0,'/finance/inventory-costs/'+consumed.id,'POST',evidence(await api.inventoryCost(consumed.id),{scope:'public'}))).status,409);
});
test('original opening evidence repairs unknown costs once, preserves split quantities and appends corrected cost history',async()=>{
 const api=clients[0],item=await pack('PACK-OPENING',10),used=await consume(item.id,stores[0],2);
 assert.equal((await api.inventoryCost(used)).source.costCents,null);
 const before=await api.warehouseItem(item.id),history=await api.warehouseHistory(item.id),finance=await api.finance(),state=await api.inventoryCost(item.openingId),body=evidence(state,{amount:'20.00'});
 const saved=await api.saveInventoryCost(item.openingId,body);assert.deepEqual(await api.saveInventoryCost(item.openingId,body),saved);assert.deepEqual(await api.inventoryCostReceipt(item.openingId,body.requestKey),saved);assert.equal((await api.inventoryCost(used)).source.costCents,'400');
 const frozen=(await api.inventoryCost(item.openingId)).record;await api.saveInventoryCost(item.openingId,{...body,requestKey:randomUUID(),expectedVersion:1,amount:'30.00',reason:'复核期初实际总额'});assert.equal((await api.inventoryCost(used)).source.costCents,'600');assert.deepEqual((await api.inventoryCost(item.openingId)).history.rows.find(r=>r.version===1),frozen);
 assert.deepEqual(await api.warehouseItem(item.id),before);assert.deepEqual(await api.warehouseHistory(item.id),history);assert.deepEqual(await api.finance(),finance);
 const copies=history.rows.filter(r=>r.type==='opening'&&r.id!==item.openingId);assert.ok(copies.length>0);assert.equal((await req(0,'/finance/inventory-costs/'+copies[0].id,'POST',{...body,requestKey:randomUUID(),expectedVersion:0})).status,409);
 assert.doesNotMatch(JSON.stringify(history),/amountCents|costCents|库存成本原始核对表/);
});
test('positive stocktake evidence values only the added quantity instead of revaluing all stock',async()=>{
 const api=clients[0],item=await pack('PACK-ADJUSTMENT',5);await api.saveInventoryCost(item.openingId,evidence(await api.inventoryCost(item.openingId),{amount:'10.00'}));
 const row=await api.warehouseItem(item.id),balance=row.balances.find(b=>b.storeId===null),adjustment=await api.warehouseWrite('move',item.id,move('stocktake',7,{packagingBalanceId:balance.id}),row.version);
 const state=await api.inventoryCost(adjustment.movementId);assert.equal(state.source.delta,2);assert.equal(state.source.quantity,7);await api.saveInventoryCost(adjustment.movementId,evidence(state,{amount:'6.00'}));
 const used=await consume(item.id,stores[1],1);assert.equal((await api.inventoryCost(used)).source.costCents,'229');
});
test('ordinary product outflows take explicit expense attribution while transfers to shooting samples remain assets',async()=>{
 const api=clients[0],product=await api.createProduct({name:'库存转样品成本商品',storeId:null,notes:'',stages:['测试']}),item=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'OTHER-OUTFLOW',kind:'product',productId:product.id,name:'其他出库商品',specification:'标准',unit:'件',location:'工作室',notes:''});
 await api.warehouseWrite('move',item.id,move('opening',0),1);const inbound=await api.warehouseWrite('move',item.id,move('inbound',5),2);await api.saveInventoryCost(inbound.movementId,evidence(await api.inventoryCost(inbound.movementId),{amount:'10.00'}));
 let row=await api.warehouseItem(item.id);const outbound=await api.warehouseWrite('move',item.id,move('outbound',1),row.version),state=await api.inventoryCost(outbound.movementId);assert.equal(state.source.costCents,'200');assert.equal(state.source.mode,'outflow');
 const before=await api.warehouseItem(item.id),ledger=await api.finance();await clients[1].saveInventoryCost(outbound.movementId,evidence(state));assert.deepEqual(await api.warehouseItem(item.id),before);assert.deepEqual(await api.finance(),ledger);
 const publicBefore=(await api.financeOverview(month)).publicCents;
 row=await api.warehouseItem(item.id);const sample=await api.warehouseToSamples(item.id,{requestKey:randomUUID(),quantity:2,reason:'转拍摄样品资产',sourceReference:'样品转入',confirmed:true,target:{mode:'new',name:'原拍摄样品',warehouseLocation:'样品架',keeperMemberId:null,notes:''}},row.version);
 const sampleState=await api.inventoryCost(sample.movementId);assert.equal(sampleState.source.mode,'asset');assert.equal(sampleState.source.costCents,'400');const report=await api.financeOverview(month);assert.equal(report.publicCents,publicBefore);assert.equal(report.sampleAssetTransferCents,'400');
 assert.equal((await req(0,'/finance/inventory-costs/'+sample.movementId,'POST',evidence(sampleState,{amount:null,scope:'public'}))).status,409);
});
test('linked outflow expenses count once and conflicting source use stays pending',async()=>{
 const api=clients[0],item=await pack('PACK-LINKED-LOSS',5);await api.saveInventoryCost(item.openingId,evidence(await api.inventoryCost(item.openingId),{amount:'20.00'}));
 let row=await api.warehouseItem(item.id),balance=row.balances.find(b=>b.storeId===null);const loss=await api.warehouseWrite('move',item.id,move('stocktake',4,{packagingBalanceId:balance.id}),row.version),state=await api.inventoryCost(loss.movementId);assert.equal(state.source.costCents,'400');
 const expenseBody={requestKey:randomUUID(),expenseDate:state.source.day,description:'已记的实际包材损耗',amount:'4.00',paymentMode:'company',payerId:null,storeId:stores[0],categoryId:null,note:'',expenseScope:'store',expenseUse:'operating'},expense=await api.saveExpense(undefined,expenseBody),before=await api.finance();
 await api.saveInventoryCost(loss.movementId,evidence(state,{scope:'store',storeId:stores[0],expenseId:expense.id,expenseVersion:1}));assert.deepEqual(await api.finance(),before);
 let report=await api.financeOverview(month),shop=report.rows.find(r=>r.storeId===stores[0]);assert.equal(shop.otherInventoryCents,'0');assert.equal(shop.operatingCents,'400');
 const fee=await api.saveOperatingRecord(null,{requestKey:randomUUID(),kind:'fee',storeId:stores[0],parentId:null,expenseId:expense.id,sourceReference:'同一支出误挂为手续费',businessDate:state.source.day,amount:'4.00',description:'待核对的重复来源',note:'',reason:'测试来源冲突',parentVersion:null,expenseVersion:1});
 report=await api.financeOverview(month);assert.equal(report.rows.find(r=>r.storeId===stores[0]).profitCents,null);
 await api.voidOperatingRecord(fee.id,{requestKey:randomUUID(),expectedVersion:1,reason:'解除重复费用来源'});assert.notEqual((await api.financeOverview(month)).rows.find(r=>r.storeId===stores[0]).profitCents,null);
 row=await api.warehouseItem(item.id);balance=row.balances.find(b=>b.storeId===null);const second=await api.warehouseWrite('move',item.id,move('outbound',1,{packagingBalanceId:balance.id}),row.version),next=await api.inventoryCost(second.movementId);
 assert.equal((await req(0,'/finance/inventory-costs/'+second.movementId,'POST',evidence(next,{scope:'store',storeId:stores[0],expenseId:expense.id,expenseVersion:1}))).status,409);
 await api.saveInventoryCost(second.movementId,evidence(next,{scope:'public'}));
});
test('evidence writes preserve quantity, roll back on late failure, serialize versions and enforce financial/resource boundaries',async()=>{
 const api=clients[0],item=await pack('PACK-SECURE-BASIS',3),state=await api.inventoryCost(item.openingId),body=evidence(state,{amount:'3.00'}),path='/finance/inventory-costs/'+item.openingId;
 assert.equal((await req(1,path,'POST',body)).status,403);for(const i of [2,3])assert.equal((await req(i,path)).status,403);
 assert.equal((await req(0,path,'POST',body,false)).status,403);assert.equal((await req(0,path,'POST',{...body,quantity:99})).status,400);
 const saved=await clients[4].saveInventoryCost(item.openingId,body),frozen=(await api.inventoryCost(item.openingId)).record,before=await api.warehouseItem(item.id),history=await api.warehouseHistory(item.id);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_inventory_evidence_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test evidence rollback'; END; $$;
 CREATE TRIGGER fail_inventory_evidence_receipt BEFORE INSERT ON studio_os.inventory_cost_evidence_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_inventory_evidence_receipt();`);
 try{assert.equal((await req(0,path,'POST',{...body,requestKey:randomUUID(),expectedVersion:1,amount:'3.30'})).status,500);assert.deepEqual((await api.inventoryCost(item.openingId)).record,frozen);assert.deepEqual(await api.warehouseItem(item.id),before);}
 finally{await db.client.unsafe('DROP TRIGGER fail_inventory_evidence_receipt ON studio_os.inventory_cost_evidence_receipts; DROP FUNCTION studio_os.fail_inventory_evidence_receipt()');}
 const revisions=await Promise.all(['3.30','3.90'].map(amount=>req(0,path,'POST',{...body,requestKey:randomUUID(),expectedVersion:1,amount})));assert.deepEqual(revisions.map(r=>r.status).sort(),[201,409]);
 for(let version=2;version<52;version++)await api.saveInventoryCost(item.openingId,{...body,requestKey:randomUUID(),expectedVersion:version,amount:'3.00'});
 const page=await api.inventoryCost(item.openingId,50);assert.equal(page.history.total,52);assert.equal(page.history.rows.length,2);assert.deepEqual(page.history.rows.at(-1),frozen);assert.deepEqual(await api.warehouseHistory(item.id),history);
 assert.equal((await req(0,path+'/receipts/'+body.requestKey)).status,404);
 await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY['finance'] WHERE id=${people[4].id}`;
 const service=new InventoryCostEvidence(db);await assert.rejects(service.save(sessions[4].user,item.openingId,body),e=>e.status===403);await assert.rejects(service.receipt(sessions[4].user,item.openingId,body.requestKey),e=>e.status===403);
 for(const table of ['inventory_cost_evidence_versions','inventory_cost_evidence_receipts','inventory_cost_expense_links'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
});
test('purchase-source changes can be reconfirmed without rewriting original packaging receipts or prices',async()=>{
 const api=clients[0],item=await pack('PACK-PURCHASE-RECHECK'),row=await api.warehouseItem(item.id),balance=row.balances.find(b=>b.storeId===null),expenseBody={expenseDate:chinaDate(),description:'原包材采购付款',amount:'10.00',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'',expenseScope:'public',expenseUse:'inventory'};
 const expense=await api.saveExpense(undefined,{...expenseBody,requestKey:randomUUID()}),purchase=await api.savePackagingPurchase(item.id,{requestKey:randomUUID(),purchaseDate:chinaDate(),supplier:'原采购供应商',unitPrice:'2.00',expenseId:expense.id,expenseVersion:1,reason:'原始收货',allocations:[{balanceId:balance.id,quantity:5}]},row.version);
 const [inbound]=await db.client`SELECT movement_id AS id FROM studio_os.packaging_purchase_allocations WHERE purchase_id=${purchase.purchaseId}`;
 const used=await consume(item.id,stores[1],1);assert.equal((await api.inventoryCost(used)).source.costCents,'200');
 await api.saveExpense(expense.id,{...expenseBody,description:'采购付款描述已核对'},1);
 let state=await api.inventoryCost(inbound.id);assert.equal(state.source.sourceChanged,true);assert.equal(state.source.purchaseSourceVersion,2);
 const before=await api.warehouseItem(item.id),history=await api.warehouseHistory(item.id),finance=await api.finance();
 await api.saveInventoryCost(inbound.id,evidence(state,{amount:'10.00'}));state=await api.inventoryCost(inbound.id);assert.equal(state.source.sourceChanged,false);
 await api.saveInventoryCost(inbound.id,evidence(state,{amount:'15.00',reason:'补齐实际到货附加成本'}));assert.equal((await api.inventoryCost(used)).source.costCents,'300');
 assert.equal((await api.packagingPurchaseHistory(item.id)).rows[0].unitCents,200);assert.deepEqual(await api.warehouseItem(item.id),before);assert.deepEqual(await api.warehouseHistory(item.id),history);assert.deepEqual(await api.finance(),finance);
});
