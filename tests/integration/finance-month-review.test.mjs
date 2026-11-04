import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {FinanceMonthScope} from '../../.build/server/finance-month-scope.js';
import {reviewPage} from '../../.build/server/finance-month-review.js';
import {createCloudApi,chinaDate} from '../../dist/cloud-api.mjs';
let local,db,app,base;const clients=[],sessions=[],people=[],stores=[],month=chinaDate().slice(0,7),prior='2026-02';
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const scope=(m,ids=[],expectedVersion=0)=>({requestKey:randomUUID(),month:m,storeIds:ids,expectedVersion,reason:'按当月实际经营情况核对范围'});
const income=(m,amount='0.00',expectedVersion=0,status='confirmed')=>({requestKey:randomUUID(),expectedVersion,month:m,amount,sourceReference:'平台月度可提现汇总单',reason:'已扣平台项目，商品代发成本另算',status});
const expense=(m,extra={})=>({requestKey:randomUUID(),expenseDate:m+'-01',description:'月度原运营支出',amount:'10.00',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'',expenseScope:'public',expenseUse:'operating',...extra});
const move=(type,quantity)=>({requestKey:randomUUID(),type,quantity,reason:'按实际原库存登记',sourceReference:'',correctsMovementId:null});
async function packaging(name,quantity){const api=clients[0],r=await api.warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:name,kind:'packaging',productId:null,name,specification:'标准',unit:'个',location:'工作室',notes:''}),m=await api.warehouseWrite('move',r.id,move('opening',quantity),1);return {...r,movementId:m.movementId};}
const basis=(state,extra={})=>({requestKey:randomUUID(),expectedVersion:state.record?.version??0,amount:'10.00',scope:null,storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:state.source.purchaseSourceVersion,sourceReference:'原库存金额依据',reason:'按实际期初总成本核对',...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);const auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['finance']],['admin',false,['resources']],['employee',false,[]],['admin',false,['finance']]]){const username='review_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push(p);sessions.push(await auth.login(username,password,'review-local'));}
 for(const name of ['范围内无业务店','历史停用店','新增范围外店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 await db.client`UPDATE studio_os.stores SET active=false WHERE id=${stores[1]}`;
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((p,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('explicit historical scope finds silent shops, zero/negative confirmations count and future/current periods remain open',async()=>{
 const api=clients[0];let r=await api.financeMonthReview({month:prior});assert.equal(r.scope,null);assert.ok(r.rows.some(r=>r.section==='scope'));assert.equal(r.recordedSourcesReady,false);
 await api.saveFinanceMonthScope(scope(prior,[stores[0],stores[1]]));r=await api.financeMonthReview({month:prior});assert.equal(r.counts.sections.income,2);assert.equal(r.counts.sections.period,0);
 await api.saveMonthIncome(stores[0],income(prior));await api.saveMonthIncome(stores[1],income(prior,'-1.00'));r=await api.financeMonthReview({month:prior});assert.equal(r.counts.blocker,0);assert.equal(r.recordedSourcesReady,true);assert.equal(r.counts.sections.cash,1);
 await api.saveMonthIncome(stores[1],income(prior,'-1.00',1,'withdrawn'));assert.equal((await api.financeMonthReview({month:prior})).counts.sections.income,1);
 for(const m of [month,'2199-12']){await api.saveFinanceMonthScope(scope(m));assert.ok((await api.financeMonthReview({month:m})).rows.some(r=>r.section==='period'));}
});
test('scope history snapshots, inactive shops, unknown shops and business outside the set never silently alter scope or public allocations',async()=>{
 const api=clients[0],m='2026-03',body=scope(m,[stores[1]]),before=await api.finance();await api.saveFinanceMonthScope(body);assert.deepEqual(await api.finance(),before);
 const a=await api.financeMonthScope(m);assert.equal(a.record.stores[0].name,'历史停用店');await db.client`UPDATE studio_os.stores SET name='历史停用店新名' WHERE id=${stores[1]}`;assert.equal((await api.financeMonthScope(m)).record.stores[0].name,'历史停用店');
 await api.saveMonthIncome(stores[2],income(m,'10.00'));await api.saveExpense(null,expense(m,{amount:'2.00'}));let r=await api.financeMonthReview({month:m});assert.ok(r.rows.some(r=>r.section==='scope'&&r.storeId===stores[2]));assert.equal((await api.financeMonthScope(m)).record.stores.length,1);assert.equal((await api.financeOverview(m)).publicCents,'200');
 await api.saveFinanceMonthScope(scope(m,[stores[1],stores[2]],1));assert.equal((await api.financeMonthReview({month:m})).rows.some(r=>r.section==='scope'),false);assert.equal((await api.financeMonthScope(m)).history.total,2);
 assert.equal((await req(0,'/finance/month-scope','POST',scope(m,[randomUUID()],2))).status,400);assert.equal((await api.financeMonthScope(m)).record.version,2);
});
test('uncapped original cost issues are paged and counted across all sources, without synthetic duplicates',async()=>{
 const api=clients[0],m='2026-04';await api.saveFinanceMonthScope(scope(m));for(let i=0;i<57;i++)await api.saveExpense(null,expense(m,{description:'待归属原支出'+i,expenseScope:'unclassified',expenseUse:'unclassified'}));
 const first=await api.financeMonthReview({month:m,section:'costs'}),last=await api.financeMonthReview({month:m,section:'costs',offset:50});assert.equal(first.total,57);assert.equal(first.rows.length,50);assert.equal(last.rows.length,7);assert.equal(last.counts.blocker,57);assert.equal(new Set([...first.rows,...last.rows].map(r=>r.id)).size,57);assert.ok(first.rows.every(r=>r.kind==='expense'));
 const filtered=await api.financeMonthReview({month:m,severity:'review'});assert.equal(filtered.total,0);assert.equal(filtered.counts.blocker,57);assert.equal(filtered.recordedSourcesReady,false);
});
test('unsold stock assets with missing basis are visible without outflow and repaired without duplicating quantity or expenses',async()=>{
 const api=clients[0],item=await packaging('REVIEW-UNUSED',5),before=await api.warehouseItem(item.id),ledger=await api.finance();let r=await api.financeMonthReview({month,section:'assets'});assert.ok(r.rows.some(r=>r.kind==='inventory'&&r.id===item.movementId));
 await api.saveInventoryCost(item.movementId,basis(await api.inventoryCost(item.movementId)));r=await api.financeMonthReview({month,section:'assets'});assert.ok(!r.rows.some(r=>r.itemId===item.id));assert.deepEqual(await api.warehouseItem(item.id),before);assert.deepEqual(await api.finance(),ledger);
 const e=await api.saveExpense(null,expense(month,{expenseUse:'inventory'}));await api.saveInventoryCost(item.movementId,basis(await api.inventoryCost(item.movementId),{expenseId:e.id,expenseVersion:1}));await api.saveExpense(e.id,{...Object.fromEntries(Object.entries(expense(month,{expenseUse:'inventory'})).filter(([k])=>k!=='requestKey')),amount:'12.00'},1);
 assert.ok((await api.financeMonthReview({month,section:'assets'})).rows.some(r=>r.id===item.movementId));
 const rows=await api.financeMonthReview({month:prior,section:'assets'});assert.ok(!rows.rows.some(r=>r.itemId===item.id));
});
test('kept sample assets need original cost while fully depleted unknown stock does not leave an asset blocker',async()=>{
 const api=clients[0],s=await api.sampleWrite('register',null,{requestKey:randomUUID(),name:'月度检查样品',warehouseLocation:'样品架',productId:null,keeperMemberId:null,notes:''});
 await api.sampleWrite('stock',s.id,{requestKey:randomUUID(),quantity:2,note:'原样品入库'},1);const [event]=await db.client`SELECT id FROM studio_os.shooting_sample_events WHERE sample_id=${s.id} AND action='stock-in'`;
 assert.ok((await api.financeMonthReview({month,section:'assets'})).rows.some(r=>r.id===event.id));const state=await api.sampleCost(event.id);await api.saveSampleCost(event.id,{requestKey:randomUUID(),expectedVersion:0,amount:'0.00',scope:null,storeId:null,lossKind:null,expenseId:null,expenseVersion:null,costToken:state.source.costToken,sourceReference:'赠送样品零成本依据',reason:'核实样品来源'});assert.ok(!(await api.financeMonthReview({month,section:'assets'})).rows.some(r=>r.id===event.id));
 const item=await packaging('REVIEW-DEPLETED',2);await api.warehouseWrite('move',item.id,move('outbound',2),2);assert.ok(!(await api.financeMonthReview({month,section:'assets'})).rows.some(r=>r.itemId===item.id));
 const item2=await packaging('REVIEW-NEW-POOL',1);await api.warehouseWrite('move',item2.id,move('outbound',1),2);const next=await api.warehouseWrite('move',item2.id,move('inbound',1),3);await api.saveInventoryCost(next.movementId,basis(await api.inventoryCost(next.movementId),{amount:'3.00'}));assert.ok(!(await api.financeMonthReview({month,section:'assets'})).rows.some(r=>r.itemId===item2.id));
});
test('cross-month changed cash references and unmatched amounts stay review-only and never rewrite income',async()=>{
 const api=clients[0],m='2026-05';await api.saveFinanceMonthScope(scope(m,[stores[0]]));await api.saveMonthIncome(stores[0],income(m,'100.00'));
 const body={requestKey:randomUUID(),direction:'in',accountLabel:'实际银行',sourceReference:randomUUID(),paidDate:chinaDate(),amount:'90.00',description:'跨月到账',reason:'实际流水',lines:[{kind:'income',storeId:stores[0],month:m,expenseId:null,amount:'80.00',sourceVersion:1}]},cash=await api.saveCashMovement(null,body);
 let r=await api.financeMonthReview({month:m});assert.equal(r.counts.blocker,0);assert.ok(r.rows.some(r=>r.kind==='income-cash'&&r.amountCents==='2000'));assert.ok(!r.rows.some(r=>r.kind==='cash'&&r.id===cash.id));
 await api.saveMonthIncome(stores[0],income(m,'95.00',1));r=await api.financeMonthReview({month:m});assert.ok(r.rows.some(r=>r.kind==='cash'&&r.id===cash.id&&r.severity==='review'));assert.equal(r.counts.blocker,0);assert.equal((await api.financeOverview(m)).summary.incomeCents,'9500');assert.ok((await api.financeMonthReview({month,section:'cash'})).rows.some(r=>r.id===cash.id&&r.amountCents==='1000'));
 const eBody=expense(m),e=await api.saveExpense(null,eBody),p=await api.saveCashMovement(null,{...body,requestKey:randomUUID(),direction:'out',sourceReference:randomUUID(),amount:'10.00',lines:[{kind:'expense',storeId:null,month:null,expenseId:e.id,amount:'10.00',sourceVersion:1}]});await api.saveExpense(e.id,{...Object.fromEntries(Object.entries(eBody).filter(([k])=>k!=='requestKey')),expenseDate:'2026-06-01'},1);
 assert.ok((await api.financeMonthReview({month:m,section:'cash'})).rows.some(r=>r.id===p.id));assert.ok((await api.financeMonthReview({month:'2026-06',section:'cash'})).rows.some(r=>r.id===p.id));
});
test('original reimbursements remain current cumulative, not a selected-month expense or fictitious period balance',async()=>{
 const api=clients[0],[person]=await db.client`INSERT INTO studio_os.members(display_name) VALUES('跨月垫付同事') RETURNING id`;
 const e=await api.saveExpense(null,expense('2026-01',{paymentMode:'advance',payerId:person.id,amount:'30.00'}));const {Finance}=await import('../../.build/server/finance.js'),f=new Finance(db),statement=await f.settle(sessions[0].user,{requestKey:randomUUID(),payerId:person.id,startDate:'2026-01-01',endDate:'2026-01-01',note:'原结算',items:[{expenseId:e.id,expectedVersion:1}]});await f.pay(sessions[0].user,{requestKey:randomUUID(),settlementId:statement.id,expectedVersion:1,amount:'12.00',paidDate:chinaDate(),note:'本月实际报销'});
 const before=await api.financeOverview('2026-08'),r=await api.financeMonthReview({month:'2026-08',section:'advances'}),row=r.rows.find(r=>r.id===person.id);assert.equal(row.amountCents,'1800');assert.match(row.label,/当前累计.*非所选月末/);assert.equal(row.severity,'review');assert.deepEqual(await api.financeOverview('2026-08'),before);
});
test('scope writes are versioned, private, retry-safe, concurrent-safe and rollback atomically',async()=>{
 const api=clients[0],m='2026-07',body=scope(m,[stores[0]]),saved=await api.saveFinanceMonthScope(body);assert.deepEqual(await api.saveFinanceMonthScope(body),saved);assert.deepEqual(await api.financeScopeReceipt(body.requestKey,m),saved);assert.equal(await clients[1].financeScopeReceipt(body.requestKey,m),null);
 assert.equal((await req(0,'/finance/month-scope','POST',{...body,reason:'不同内容'})).status,409);const rs=await Promise.all([0,1].map(i=>req(i,'/finance/month-scope','POST',scope(m,[stores[i]],1))));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_scope_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rollback scope'; END; $$; CREATE TRIGGER fail_scope_receipt BEFORE INSERT ON studio_os.finance_month_scope_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_scope_receipt();`);
 try{assert.equal((await req(0,'/finance/month-scope','POST',scope('2026-09',stores))).status,500);assert.equal((await api.financeMonthScope('2026-09')).record,null);}finally{await db.client.unsafe('DROP TRIGGER fail_scope_receipt ON studio_os.finance_month_scope_receipts; DROP FUNCTION studio_os.fail_scope_receipt()');}
 for(let i=2;i<52;i++)await api.saveFinanceMonthScope(scope(m,[],i));const history=await api.financeMonthScope(m,50);assert.equal(history.history.total,52);assert.equal(history.history.rows.length,2);
 for(const table of ['finance_month_scope_versions','finance_month_scope_stores','finance_month_scope_receipts'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
});
test('finance permissions, revocation, csrf and strict inputs protect review and scope without resource grants',async()=>{
 for(const i of [2,3])for(const path of ['/finance/month-review?month='+prior,'/finance/month-scope?month='+prior])assert.equal((await req(i,path)).status,403);
 assert.equal((await req(1,'/finance/month-review?month='+prior)).status,200);assert.equal((await req(0,'/finance/month-scope','POST',scope('2026-10'),false)).status,403);
 for(const b of [{...scope('2026-10'),storeIds:[stores[0],stores[0]]},{...scope('2026-10'),reason:' '},{...scope('2026-10'),amount:'1.00'},{...scope('2026-10'),expectedVersion:2147483647}])assert.equal((await req(0,'/finance/month-scope','POST',b)).status,400);
 for(const tail of ['month=2026-13','month=2026-01&section=salary','month=2026-01&offset=-1','month=2026-01&severity=done','month=2026-01&unexpected=1'])assert.equal((await req(0,'/finance/month-review?'+tail)).status,400);
 await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[4].id}`;await assert.rejects(new FinanceMonthScope(db).save(sessions[4].user,scope('2026-10')),e=>e.status===403);
});
test('review deduplication and stable paging preserve full counts independently of active filters',()=>{
 const items=Array.from({length:63},(_,i)=>({section:'costs',severity:'blocker',kind:'expense',id:String(i).padStart(3,'0'),label:'待核对',storeId:null}));const result=reviewPage([...items,items[0]],'costs','blocker',50);assert.equal(result.total,63);assert.equal(result.rows.length,13);assert.equal(result.counts.blocker,63);assert.equal(reviewPage(items,'cash','all',0).recordedSourcesReady,false);
});
