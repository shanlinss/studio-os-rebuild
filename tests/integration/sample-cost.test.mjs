import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {SampleCostEvidence} from '../../.build/server/sample-cost-evidence.js';
import {replaySampleCosts} from '../../.build/server/sample-cost-sources.js';
import {createCloudApi,chinaDate} from '../../dist/cloud-api.mjs';
let local,db,app,base;const sessions=[],clients=[],people=[],stores=[],month=chinaDate().slice(0,7);
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const payload=(state,extra={})=>({requestKey:randomUUID(),expectedVersion:state.record?.version??0,amount:state.source.mode==='basis'?'10.00':null,scope:state.source.mode==='basis'?null:'public',storeId:null,expenseId:null,expenseVersion:null,costToken:state.source.costToken,lossKind:state.source.mode==='basis'?null:'loss',sourceReference:'原样品成本核对表',reason:'按实际盘点与原成本确认',...extra});
async function state(id){return clients[0].sampleCost(id);}
async function sample(name){return clients[0].sampleWrite('register',null,{requestKey:randomUUID(),name,warehouseLocation:'样品架',productId:null,keeperMemberId:null,notes:''});}
async function stock(id,qty,count=false){const [s]=await db.client`SELECT version FROM studio_os.shooting_samples WHERE id=${id}`;const r=await req(0,'/samples/catalog/'+id+(count?'/stocktake':'/stock-in'),'POST',{requestKey:randomUUID(),quantity:qty,expectedVersion:s.version,note:count?'实际损耗或报废盘点':'实际样品到货'});assert.equal(r.status,201,await r.text());const [e]=await db.client`SELECT id FROM studio_os.shooting_sample_events WHERE sample_id=${id} AND action=${count?'stocktake':'stock-in'} ORDER BY created_at DESC,id DESC LIMIT 1`;return e.id;}
async function basis(name,qty=5,amount='10.00'){const s=await sample(name),event=await stock(s.id,qty);await clients[0].saveSampleCost(event,payload(await state(event),{amount}));return {id:s.id,event};}
const expenseBody=(scope,storeId,amount='2.00',use='operating')=>({requestKey:randomUUID(),expenseDate:chinaDate(),description:'样品成本原支出',amount,paymentMode:'company',payerId:null,storeId,categoryId:null,note:'',expenseScope:scope,expenseUse:use});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);const auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['finance']],['admin',false,['resources']],['employee',false,[]],['admin',false,['finance','resources']]]){const username='sample_cost_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push(p);sessions.push(await auth.login(username,password,'sample-cost-local'));}
 for(const name of ['样品甲店','样品乙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 const [member]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES('借还员工',${people[3].id}) RETURNING id`;
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((p,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
 for(const store of stores)await clients[0].saveMonthIncome(store,{requestKey:randomUUID(),expectedVersion:0,month,amount:'100.00',sourceReference:'每月确认收入',reason:'确认已扣客户退款收入',status:'confirmed'});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('original product transfer carries exact asset cost and real loss becomes expense only after attribution',async()=>{
 const api=clients[0],product=await api.createProduct({name:'转入样品成本商品',storeId:null,notes:'',stages:['测试']}),item=await api.warehouseWrite('register',null,{requestKey:randomUUID(),itemCode:'SAMPLE-COST-TRANSFER',kind:'product',productId:product.id,name:'商品转样品',specification:'标准',unit:'件',location:'仓库',notes:''});
 const move=(type,quantity)=>({requestKey:randomUUID(),type,quantity,reason:'实际库存',sourceReference:'',correctsMovementId:null});await api.warehouseWrite('move',item.id,move('opening',0),1);const inbound=await api.warehouseWrite('move',item.id,move('inbound',3),2),original=await api.inventoryCost(inbound.movementId);
 await api.saveInventoryCost(inbound.movementId,{requestKey:randomUUID(),expectedVersion:0,amount:'1.00',scope:null,storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:null,sourceReference:'三件总成本一元',reason:'保留分数精度'});
 const row=await api.warehouseItem(item.id),transfer=await api.warehouseToSamples(item.id,{requestKey:randomUUID(),quantity:2,reason:'转拍摄样品资产',sourceReference:'原转入单',confirmed:true,target:{mode:'new',name:'转入的拍摄样品',warehouseLocation:'样品架',keeperMemberId:null,notes:''}},row.version);
 const [link]=await db.client`SELECT sample_event_id AS id,sample_id AS "sampleId" FROM studio_os.warehouse_sample_transfers WHERE movement_id=${transfer.movementId}`,asset=await state(link.id);assert.equal(asset.source.mode,'transfer');assert.equal(asset.source.costCents,'67');assert.equal(asset.balance.costCents,'67');assert.equal((await api.financeOverview(month)).publicCents,'0');
 assert.equal((await req(0,'/finance/sample-costs/'+link.id,'POST',payload(asset))).status,409);
 const loss=await stock(link.sampleId,1,true),s=await state(loss);assert.equal(s.source.costCents,'33');assert.equal(s.balance.costCents,'33');assert.equal((await api.financeOverview(month)).summary.studioProfitCents,null);
 const before=await db.client`SELECT * FROM studio_os.shooting_samples WHERE id=${link.sampleId}`,finance=await api.finance(),events=await db.client`SELECT * FROM studio_os.shooting_sample_events WHERE sample_id=${link.sampleId} ORDER BY created_at,id`;
 await clients[1].saveSampleCost(loss,payload(s,{lossKind:'scrap'}));let report=await api.financeOverview(month);assert.equal(report.publicCents,'33');assert.equal(report.summary.studioProfitCents,'19967');assert.equal(report.sampleAssetTransferCents,'67');
 assert.deepEqual(await db.client`SELECT * FROM studio_os.shooting_samples WHERE id=${link.sampleId}`,before);assert.deepEqual(await db.client`SELECT * FROM studio_os.shooting_sample_events WHERE sample_id=${link.sampleId} ORDER BY created_at,id`,events);assert.deepEqual(await api.finance(),finance);
 // Original product source correction reprices the bridge and requires loss reconfirmation.
 const cost=await api.inventoryCost(inbound.movementId);await api.saveInventoryCost(inbound.movementId,{requestKey:randomUUID(),expectedVersion:1,amount:'3.00',scope:null,storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:null,sourceReference:'原成本复核',reason:'修正实际成本'});
 assert.equal((await state(loss)).source.costCents,'100');assert.equal((await state(loss)).source.attributionChanged,true);assert.equal((await api.financeOverview(month)).summary.studioProfitCents,null);await api.saveSampleCost(loss,payload(await state(loss),{lossKind:'scrap'}));assert.equal((await api.financeOverview(month)).publicCents,'100');
});
test('borrow and return keep asset quantity and cost, while public and store losses remain separate',async()=>{
 const api=clients[0],s=await basis('可借出的五件样品'),before=await api.sampleCosts({month});
 const loan=await clients[3].sampleWrite('borrow',s.id,{requestKey:randomUUID(),quantity:2,location:'员工拍摄桌',shootingRequestId:null,note:'拍摄领用'});
 let d=await state(s.event);assert.equal(d.balance.quantity,5);assert.equal(d.balance.costCents,'1000');assert.equal((await api.sampleCosts({month})).assetCents,before.assetCents);
 const loss=await stock(s.id,2,true);assert.equal((await state(loss)).source.costCents,'200');await api.saveSampleCost(loss,payload(await state(loss),{scope:'store',storeId:stores[0]}));
 await clients[3].sampleWrite('return',loan.id,{requestKey:randomUUID(),quantity:2,note:'归还拍摄样品'},1);d=await state(loss);assert.equal(d.balance.quantity,4);assert.equal(d.balance.costCents,'800');const report=await api.financeOverview(month);assert.equal(report.rows.find(r=>r.storeId===stores[0]).otherInventoryCents,'200');assert.equal(report.rows.find(r=>r.storeId===stores[1]).otherInventoryCents,'0');assert.equal(report.publicCents,'100');
 const list=await api.sampleCosts({month,q:'可借出的五件样品'});assert.equal(list.total,2);assert.ok(list.rows.every(r=>['stock-in','stocktake'].includes(r.action)));
});
test('missing additions stay unknown, positive stocktake prices only added units, depletion allows a new known basis',async()=>{
 const api=clients[0],s=await sample('原样品缺成本'),inbound=await stock(s.id,2),loss=await stock(s.id,1,true);assert.equal((await state(loss)).source.costCents,null);
 await api.saveSampleCost(loss,payload(await state(loss)));assert.equal((await api.financeOverview(month)).summary.studioProfitCents,null);
 await api.saveSampleCost(inbound,payload(await state(inbound),{amount:'4.00'}));assert.equal((await state(loss)).source.costCents,'200');assert.equal((await state(loss)).source.attributionChanged,true);await api.saveSampleCost(loss,payload(await state(loss)));
 const gain=await stock(s.id,3,true);assert.equal((await state(gain)).source.delta,2);await api.saveSampleCost(gain,payload(await state(gain),{amount:'6.00'}));const all=await stock(s.id,0,true);assert.equal((await state(all)).source.costCents,'800');await api.saveSampleCost(all,payload(await state(all),{lossKind:'scrap'}));
 const newer=await stock(s.id,1);await api.saveSampleCost(newer,payload(await state(newer),{amount:'0.00'}));assert.equal((await state(newer)).balance.costCents,'0');assert.equal((await state(newer)).balance.quantity,1);
});
test('same-month original expenses count once and conflicting fee use blocks profit until corrected',async()=>{
 const api=clients[0],s=await basis('已登记样品损耗支出'),loss=await stock(s.id,4,true),e=await api.saveExpense(null,expenseBody('store',stores[1]));
 await api.saveSampleCost(loss,payload(await state(loss),{scope:'store',storeId:stores[1],expenseId:e.id,expenseVersion:1}));let report=await api.financeOverview(month),shop=report.rows.find(r=>r.storeId===stores[1]);assert.equal(shop.otherInventoryCents,'0');assert.equal(shop.operatingCents,'200');
 const fee=await api.saveOperatingRecord(null,{requestKey:randomUUID(),kind:'fee',storeId:stores[1],parentId:null,expenseId:e.id,sourceReference:'误重复引用',businessDate:chinaDate(),amount:'2.00',description:'重复来源核对',note:'',reason:'测试重复扣费保护',parentVersion:null,expenseVersion:1});assert.equal((await api.financeOverview(month)).rows.find(r=>r.storeId===stores[1]).profitCents,null);
 await api.voidOperatingRecord(fee.id,{requestKey:randomUUID(),expectedVersion:1,reason:'解除重复费用来源'});assert.notEqual((await api.financeOverview(month)).summary.studioProfitCents,null);
 const second=await stock(s.id,3,true);assert.equal((await req(0,'/finance/sample-costs/'+second,'POST',payload(await state(second),{scope:'store',storeId:stores[1],expenseId:e.id,expenseVersion:1}))).status,409);await api.saveSampleCost(second,payload(await state(second)));
});
test('cost-source tokens reject stale loss amounts and evidence versions serialize concurrent edits',async()=>{
 const api=clients[0],s=await basis('成本版本并发样品'),loss=await stock(s.id,4,true),old=payload(await state(loss));await api.saveSampleCost(s.event,payload(await state(s.event),{amount:'20.00'}));assert.equal((await req(0,'/finance/sample-costs/'+loss,'POST',old)).status,409);
 const b=payload(await state(loss)),path='/finance/sample-costs/'+loss,rs=await Promise.all(['loss','scrap'].map(lossKind=>req(0,path,'POST',{...b,requestKey:randomUUID(),lossKind})));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
 const saved=await api.saveSampleCost(loss,payload(await state(loss)));const frozen=(await state(loss)).record;
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_sample_cost_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test sample cost rollback'; END; $$; CREATE TRIGGER fail_sample_cost_receipt BEFORE INSERT ON studio_os.sample_cost_evidence_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_sample_cost_receipt();`);
 try{assert.equal((await req(0,path,'POST',payload(await state(loss)))).status,500);assert.deepEqual((await state(loss)).record,frozen);}finally{await db.client.unsafe('DROP TRIGGER fail_sample_cost_receipt ON studio_os.sample_cost_evidence_receipts; DROP FUNCTION studio_os.fail_sample_cost_receipt()');}
});
test('financial and resource grants, CSRF, private receipts, pagination, and immutable source history remain enforced',async()=>{
 const api=clients[0],s=await sample('权限与回执样品'),inbound=await stock(s.id,2),b=payload(await state(inbound)),path='/finance/sample-costs/'+inbound;
 for(const i of [2,3])assert.equal((await req(i,path)).status,403);assert.equal((await req(1,path,'POST',b)).status,403);assert.equal((await req(0,path,'POST',b,false)).status,403);assert.equal((await req(0,path,'POST',{...b,quantity:99})).status,400);
 const saved=await clients[4].saveSampleCost(inbound,b);assert.deepEqual(await clients[4].saveSampleCost(inbound,b),saved);assert.deepEqual(await clients[4].sampleCostReceipt(inbound,b.requestKey),saved);assert.equal((await req(0,path+'/receipts/'+b.requestKey)).status,404);
 const frozen=(await state(inbound)).record;for(let v=1;v<52;v++)await api.saveSampleCost(inbound,payload(await state(inbound),{amount:'10.00'}));let paged=await api.sampleCost(inbound,50);assert.equal(paged.history.total,52);assert.equal(paged.history.rows.length,2);assert.deepEqual(paged.history.rows.at(-1),frozen);
 await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY['finance'] WHERE id=${people[4].id}`;const service=new SampleCostEvidence(db);await assert.rejects(service.save(sessions[4].user,inbound,b),e=>e.status===403);await assert.rejects(service.receipt(sessions[4].user,inbound,b.requestKey),e=>e.status===403);
 const history=await req(2,'/samples/catalog/'+s.id+'/history');assert.equal(history.status,200);assert.doesNotMatch(await history.text(),/amountCents|costCents|原样品成本核对表/);
 for(const table of ['sample_cost_evidence_versions','sample_cost_evidence_receipts','sample_cost_expense_links'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
});
test('sample replay preserves fractional precision and historical months across mixed additions and losses',()=>{
 const row=(id,day,delta,amountCents,mode='basis')=>({id,sampleId:'s',day,postedAt:day+'T00:00:00.'+id,delta,amountCents,mode,version:1,basisChanged:false,snapshot:{name:'分数样品'}});
 const sources=[row('01','2026-01-01',3,100),row('02','2026-01-02',-1,null,'outflow'),row('03','2026-02-01',2,200),row('04','2026-02-02',-1,null,'outflow')],jan=replaySampleCosts(sources,'2026-01'),feb=replaySampleCosts(sources,'2026-02');
 assert.equal(jan.assetCents,'67');assert.equal(jan.balances[0].quantity,2);assert.equal(feb.rows[1].exact.n,'200');assert.equal(feb.rows[1].exact.d,'3');assert.equal(feb.assetCents,'200');assert.equal(feb.balances[0].quantity,3);
});
test('sample purchase expense changes invalidate downstream losses until the original version is reconfirmed',async()=>{
 const api=clients[0],s=await sample('原样品采购付款复核'),inbound=await stock(s.id,2),original=expenseBody('public',null,'4.00','inventory'),e=await api.saveExpense(null,original);
 await api.saveSampleCost(inbound,payload(await state(inbound),{amount:'4.00',expenseId:e.id,expenseVersion:1}));const loss=await stock(s.id,1,true);await api.saveSampleCost(loss,payload(await state(loss)));let report=await api.financeOverview(month);assert.notEqual(report.summary.studioProfitCents,null);
 await api.saveExpense(e.id,{...Object.fromEntries(Object.entries(original).filter(([k])=>k!=='requestKey')),description:'原采购依据描述复核'},1);assert.equal((await state(loss)).source.sourceChanged,true);assert.equal((await api.financeOverview(month)).summary.studioProfitCents,null);
 let d=await state(inbound);await api.saveSampleCost(inbound,payload(d,{amount:'4.00',expenseId:e.id,expenseVersion:2}));d=await state(loss);assert.equal(d.source.sourceChanged,false);assert.equal(d.source.attributionChanged,true);await api.saveSampleCost(loss,payload(d));assert.notEqual((await api.financeOverview(month)).summary.studioProfitCents,null);
});
test('one whole expense cannot be reserved concurrently by sample and warehouse cost evidence',async()=>{
 const api=clients[0],s=await sample('整额支出防重样品'),event=await stock(s.id,2),e=await api.saveExpense(null,expenseBody('public',null,'4.00','inventory'));
 const item=await api.warehouseWrite('register',null,{requestKey:randomUUID(),itemCode:'SAMPLE-EXPENSE-RESERVATION',kind:'packaging',productId:null,name:'整额防重包材',specification:'标准',unit:'个',location:'仓库',notes:''}),opening=await api.warehouseWrite('move',item.id,{requestKey:randomUUID(),type:'opening',quantity:2,reason:'期初实物',sourceReference:'',correctsMovementId:null},1);
 const samplePayload=payload(await state(event),{amount:'4.00',expenseId:e.id,expenseVersion:1}),inventoryPayload={requestKey:randomUUID(),expectedVersion:0,amount:'4.00',scope:null,storeId:null,expenseId:e.id,expenseVersion:1,purchaseSourceVersion:null,sourceReference:'整额原付款依据',reason:'核对实际成本'};
 const rs=await Promise.all([req(0,'/finance/sample-costs/'+event,'POST',samplePayload),req(0,'/finance/inventory-costs/'+opening.movementId,'POST',inventoryPayload)]);assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
 const links=await db.client`SELECT expense_id FROM studio_os.sample_cost_expense_links WHERE expense_id=${e.id} UNION ALL SELECT expense_id FROM studio_os.inventory_cost_expense_links WHERE expense_id=${e.id}`;assert.equal(links.length,1);
 // One whole expense cannot be moved to a second sample either, even after the first version unlinks it.
 const other=await sample('另一个原样品'),second=await stock(other.id,2);assert.equal((await req(0,'/finance/sample-costs/'+second,'POST',payload(await state(second),{amount:'4.00',expenseId:e.id,expenseVersion:1}))).status,409);
});
