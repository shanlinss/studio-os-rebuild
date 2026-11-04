import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {FinanceMonthClosures} from '../../.build/server/finance-month-closures.js';
import {createCloudApi,chinaDate} from '../../dist/cloud-api.mjs';
let local,db,app,base;const sessions=[],clients=[],people=[];let store;
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const state=async(month,offset=0)=>{const r=await req(0,'/finance/month-closures?month='+month+'&offset='+offset);assert.equal(r.status,200,await r.clone().text());return r.json();};
const scope=async(month,ids=[store])=>clients[0].saveFinanceMonthScope({requestKey:randomUUID(),month,expectedVersion:0,storeIds:ids,reason:'核对实际经营店铺'});
const income=(month,amount='100.00',expectedVersion=0)=>({requestKey:randomUUID(),month,amount,expectedVersion,status:'confirmed',sourceReference:'平台月度可提现金额',reason:'已扣平台项目，商品代发成本另算'});
const exp=(month,extra={})=>({requestKey:randomUUID(),expenseDate:month+'-01',description:'原公共运营费用',amount:'10.00',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'',expenseScope:'public',expenseUse:'operating',...extra});
const action=(s,extra={})=>({requestKey:randomUUID(),month:s.month,expectedVersion:s.record?.version??0,action:s.record?.action==='lock'?'reopen':'lock',sourceHash:s.candidate?.sourceHash??s.record?.sourceHash,coverageConfirmed:true,reviewConfirmed:true,reason:'已核对收入、各项成本及待核对说明',...extra});
async function save(body,i=0){const r=await req(i,'/finance/month-closures','POST',body);assert.equal(r.status,201,await r.clone().text());return r.json();}
async function ready(month){await scope(month);await clients[0].saveMonthIncome(store,income(month));return state(month);}
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);const auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['finance']],['admin',false,['resources']],['employee',false,[]],['admin',false,['finance']]]){const username='closing_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push(p);sessions.push(await auth.login(username,password,'closing-local'));}
 const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES('原月结经营店铺') RETURNING id`;store=s.id;
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(const s of sessions){const api=createCloudApi((p,o)=>{const headers=new Headers(o?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...o,headers});},{allowWrites:true});await api.session();clients.push(api);}
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('locking freezes exact original results and source evidence; reopening and relocking retain both versions',async()=>{
 const m='2026-01',api=clients[0];let s=await ready(m);await api.saveExpense(null,exp(m));s=await state(m);assert.equal(s.candidate.snapshot.overview.summary.studioProfitCents,'9000');const b=action(s),saved=await save(b);assert.deepEqual(await save(b),saved);
 s=await state(m);assert.equal(s.candidate,null);assert.equal(s.record.action,'lock');const frozen=s.record.snapshot;assert.equal((await api.financeOverview(m)).closure.id,saved.id);
 await db.client`UPDATE studio_os.stores SET name='后续店铺新名',active=false WHERE id=${store}`;assert.deepEqual((await state(m)).record.snapshot,frozen);assert.equal((await api.financeOverview(m)).rows[0].name,'原月结经营店铺');
 assert.equal((await req(0,'/finance/month-income/'+store,'POST',income(m,'200.00',1))).status,409);assert.equal((await req(0,'/finance/month-scope','POST',{requestKey:randomUUID(),month:m,storeIds:[],expectedVersion:1,reason:'改范围'})).status,409);
 await save(action(s,{reason:'重新核对历史收入'}));await api.saveMonthIncome(store,income(m,'200.00',1));await save(action(await state(m)));s=await state(m);assert.equal(s.record.snapshot.overview.summary.studioProfitCents,'19000');assert.equal(s.history.total,3);const old=await req(0,'/finance/month-closures/'+saved.id);assert.deepEqual((await old.json()).snapshot,frozen);await save(action(s));await db.client`UPDATE studio_os.stores SET active=true WHERE id=${store}`;
});
test('missing sources, an open month, stale source hashes and absent manual confirmations cannot close',async()=>{
 const m='2026-02';let s=await state(m);assert.equal(s.candidate.ready,false);assert.equal((await req(0,'/finance/month-closures','POST',action(s))).status,409);
 s=await ready(m);assert.equal((await req(0,'/finance/month-closures','POST',action(s,{coverageConfirmed:false}))).status,400);assert.equal((await req(0,'/finance/month-closures','POST',action(s,{reviewConfirmed:false}))).status,400);
 await clients[0].saveExpense(null,exp(m));assert.equal((await req(0,'/finance/month-closures','POST',action(s))).status,409);await save(action(await state(m)));await save(action(await state(m)));
 const current=chinaDate().slice(0,7);await scope(current,[]);s=await state(current);assert.equal(s.candidate.ready,false);assert.equal((await req(0,'/finance/month-closures','POST',action(s))).status,409);
});
test('locked old and new expense dates reject moves and new backdated facts while following months remain writable',async()=>{
 const m='2026-03',api=clients[0],eBody=exp(m),e=await api.saveExpense(null,eBody);await ready(m);await save(action(await state(m)));
 let r=await req(0,'/finance/expenses','POST',exp(m));assert.equal(r.status,409);assert.equal((await r.json()).reason,'finance_month_locked');
 const edit={...Object.fromEntries(Object.entries(eBody).filter(([k])=>k!=='requestKey')),expenseDate:'2026-04-01',expectedVersion:1};assert.equal((await req(0,'/finance/expenses/'+e.id,'PATCH',edit)).status,409);
 assert.equal((await req(0,'/finance/expenses/'+e.id,'DELETE',{expectedVersion:1})).status,409);
 const next=await api.saveExpense(null,exp('2026-04'));assert.ok(next.id);await save(action(await state(m)));await api.saveExpense(e.id,{...Object.fromEntries(Object.entries(eBody).filter(([k])=>k!=='requestKey')),expenseDate:'2026-04-01'},1);
});
test('later cash and original reimbursement payments remain separate from locked operating profit',async()=>{
 const m='2026-05',api=clients[0];await ready(m);const [member]=await db.client`INSERT INTO studio_os.members(display_name) VALUES('月结垫付人') RETURNING id`,e=await api.saveExpense(null,exp(m,{paymentMode:'advance',payerId:member.id}));
 const {Finance}=await import('../../.build/server/finance.js'),f=new Finance(db),statement=await f.settle(sessions[0].user,{requestKey:randomUUID(),payerId:member.id,startDate:m+'-01',endDate:m+'-01',note:'原结算记录',items:[{expenseId:e.id,expectedVersion:1}]});const lateAdvance=await api.saveExpense(null,exp(m,{paymentMode:'advance',payerId:member.id,amount:'5.00'}));await save(action(await state(m)));const original=await state(m);
 await api.saveCashMovement(null,{requestKey:randomUUID(),direction:'in',accountLabel:'真实收款',sourceReference:randomUUID(),paidDate:chinaDate(),amount:'100.00',description:'后续到账',reason:'实际资金',lines:[{kind:'income',storeId:store,month:m,expenseId:null,amount:'100.00',sourceVersion:1}]});await f.pay(sessions[0].user,{requestKey:randomUUID(),settlementId:statement.id,expectedVersion:1,amount:'10.00',paidDate:chinaDate(),note:'实际报销'});
 assert.deepEqual((await state(m)).record,original.record);assert.equal((await api.financeOverview(m)).summary.studioProfitCents,'8500');const late=await f.settle(sessions[0].user,{requestKey:randomUUID(),payerId:member.id,startDate:m+'-01',endDate:m+'-01',note:'锁后沿用原垫付结算',items:[{expenseId:lateAdvance.id,expectedVersion:1}]});await f.pay(sessions[0].user,{requestKey:randomUUID(),settlementId:late.id,expectedVersion:1,amount:'5.00',paidDate:chinaDate(),note:'原垫付报销'});assert.deepEqual((await state(m)).record,original.record);await save(action(await state(m)));
});
test('snapshot history and private receipts paginate and never expose another operator recovery',async()=>{
 const m='2026-06';await ready(m);let s=await state(m),b=action(s),saved=await save(b,1);assert.equal((await req(0,'/finance/month-closures/receipts/'+b.requestKey+'?month='+m)).status,404);assert.deepEqual(await (await req(1,'/finance/month-closures/receipts/'+b.requestKey+'?month='+m)).json(),saved);
 for(let i=1;i<52;i++)await save(action(await state(m)));s=await state(m,50);assert.equal(s.history.total,52);assert.equal(s.history.rows.length,2);assert.equal(s.record.action,'reopen');
 for(const table of ['finance_month_closures','finance_month_closure_receipts'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
});
test('closure versions serialize concurrent locks and roll back snapshots on a late private receipt failure',async()=>{
 const m='2026-07';await ready(m);const s=await state(m),rs=await Promise.all([0,1].map(i=>req(i,'/finance/month-closures','POST',action(s))));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);await save(action(await state(m)));
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_closing_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rollback closing'; END; $$; CREATE TRIGGER fail_closing_receipt BEFORE INSERT ON studio_os.finance_month_closure_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_closing_receipt();`);
 try{const current=await state(m);assert.equal((await req(0,'/finance/month-closures','POST',action(current))).status,500);assert.equal((await state(m)).record.action,'reopen');}finally{await db.client.unsafe('DROP TRIGGER fail_closing_receipt ON studio_os.finance_month_closure_receipts; DROP FUNCTION studio_os.fail_closing_receipt()');}
});
test('finance grants, csrf, strict payload and live revocation protect closures and immutable snapshots',async()=>{
 const m='2026-08';await ready(m);const s=await state(m),saved=await save(action(s));for(const i of [2,3])for(const path of ['/finance/month-closures?month='+m,'/finance/month-closures/'+saved.id])assert.equal((await req(i,path)).status,403);
 assert.equal((await req(0,'/finance/month-closures','POST',action(await state(m)),false)).status,403);
 for(const extra of [{action:'destroy'},{reason:' '},{expectedVersion:-1},{sourceHash:'x'},{extra:'not allowed'}])assert.equal((await req(0,'/finance/month-closures','POST',action(await state(m),extra))).status,400);
 await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[4].id}`;await assert.rejects(new FinanceMonthClosures(db).state(sessions[4].user,{month:m}),e=>e.status===403);await save(action(await state(m)));
});
test('historical stock and sample evidence require reopening all affected later closed valuations; new-month quantities remain available',async()=>{
 const api=clients[0],m='2026-09';await ready(m);
 const p=await api.warehouseWrite('register',null,{requestKey:randomUUID(),itemCode:'CLOSING-OLD',kind:'packaging',productId:null,name:'月结库存',specification:'标准',unit:'个',location:'工作室',notes:''});const body=(type,quantity)=>({requestKey:randomUUID(),type,quantity,reason:'原数量事实',sourceReference:'',correctsMovementId:null});const opening=await api.warehouseWrite('move',p.id,body('opening',2),1);
 // Insert a separate historical source fixture; the original journals stay immutable.
 const [item]=await db.client`SELECT * FROM studio_os.warehouse_movements WHERE id=${opening.movementId}`;
 const [old]=await db.client`INSERT INTO studio_os.warehouse_movements(item_id,type,quantity,delta,before_quantity,after_quantity,reason,source_reference,item_snapshot,actor_id,created_at) VALUES(${p.id},'inbound',1,1,0,1,'历史成本试件','',${JSON.stringify(item.item_snapshot)}::jsonb,${people[0].id},'2026-09-01T00:00:00Z') RETURNING id`;
 const cost=await api.inventoryCost(old.id),evidence={requestKey:randomUUID(),expectedVersion:0,amount:'2.00',scope:null,storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:null,sourceReference:'历史实际成本',reason:'核对真实成本'};await api.saveInventoryCost(old.id,evidence);await save(action(await state(m)));
 assert.equal((await req(0,'/finance/inventory-costs/'+old.id,'POST',{...evidence,requestKey:randomUUID(),expectedVersion:1,amount:'3.00'})).status,409);
 const next=await api.warehouseWrite('move',p.id,body('inbound',1),2);assert.ok(next.movementId);await save(action(await state(m)));await api.saveInventoryCost(old.id,{...evidence,requestKey:randomUUID(),expectedVersion:1,amount:'3.00'});
});
test('reopening an earlier month does not bypass later locked inventory valuations or sample asset evidence',async()=>{
 const api=clients[0],m='2026-09',later='2026-10';const [old]=await db.client`SELECT m.id FROM studio_os.warehouse_movements m JOIN studio_os.warehouse_items w ON w.id=m.item_id WHERE w.item_code='CLOSING-OLD' AND m.created_at<'2026-10-01'`;
 const sample=await api.sampleWrite('register',null,{requestKey:randomUUID(),name:'历史锁定样品',warehouseLocation:'样品架',productId:null,keeperMemberId:null,notes:''});const [event]=await db.client`INSERT INTO studio_os.shooting_sample_events(sample_id,actor_id,actor_name,action,quantity_delta,after_value,note,created_at) VALUES(${sample.id},${people[0].id},'原财务','stock-in',1,'{"name":"历史锁定样品"}'::jsonb,'历史原样品','2026-09-01T00:00:00Z') RETURNING id`;
 const sampleState=await api.sampleCost(event.id),sampleBody={requestKey:randomUUID(),expectedVersion:0,amount:'1.00',scope:null,storeId:null,lossKind:null,expenseId:null,expenseVersion:null,costToken:sampleState.source.costToken,sourceReference:'原样品成本',reason:'历史成本核对'};await api.saveSampleCost(event.id,sampleBody);
 await save(action(await state(m)));await ready(later);await save(action(await state(later)));await save(action(await state(m)));
 const oldState=await api.inventoryCost(old.id),costBody={requestKey:randomUUID(),expectedVersion:oldState.record.version,amount:'4.00',scope:null,storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:null,sourceReference:'原成本更正',reason:'历史成本修正'};
 assert.equal((await req(0,'/finance/inventory-costs/'+old.id,'POST',costBody)).status,409);const latestSample=await api.sampleCost(event.id);assert.equal((await req(0,'/finance/sample-costs/'+event.id,'POST',{...sampleBody,costToken:latestSample.source.costToken,requestKey:randomUUID(),expectedVersion:1,amount:'2.00'})).status,409);
 await save(action(await state(later)));await api.saveInventoryCost(old.id,costBody);await api.saveSampleCost(event.id,{...sampleBody,costToken:(await api.sampleCost(event.id)).source.costToken,requestKey:randomUUID(),expectedVersion:1,amount:'2.00'});
});
test('closing waits for in-flight source writes and rejects the preview hash instead of locking a partial snapshot',async()=>{
 const m='2025-12';await ready(m);const s=await state(m);let release,started;const held=new Promise(r=>{release=r;}),entered=new Promise(r=>{started=r;});
 const write=db.client.begin(async tx=>{await tx`INSERT INTO studio_os.store_month_income_versions(store_id,month,version,amount_cents,source_reference,status,reason,actor_id,actor_name) VALUES(${store},${m},2,20000,'并发收入新依据','confirmed','并发原收入更正',${people[0].id},'原财务')`;started();await held;});
 await entered;let completed=false;const closing=req(0,'/finance/month-closures','POST',action(s)).then(r=>{completed=true;return r;});await new Promise(r=>setTimeout(r,40));assert.equal(completed,false);release();await write;assert.equal((await closing).status,409);assert.equal((await state(m)).record,null);await save(action(await state(m)));await save(action(await state(m)));
});
