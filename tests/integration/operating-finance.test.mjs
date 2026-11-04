import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {OperatingFinance} from '../../.build/server/operating-finance.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth;const people=[],sessions=[],clients=[],stores=[];
const path='/finance/operating-records';
const req=(i,p,method='GET',body,csrf=true)=>fetch(base+'/api'+p,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const value=(extra={})=>({requestKey:randomUUID(),kind:'sale',storeId:stores[0],parentId:null,expenseId:null,sourceReference:randomUUID(),businessDate:'2026-01-01',amount:'10.00',description:'日常销售记录',note:'',reason:'按原单据核对',parentVersion:null,expenseVersion:null,...extra});
const revise=(r,extra={})=>({requestKey:randomUUID(),expectedVersion:r.version,businessDate:r.businessDate,amount:(r.amountCents/100).toFixed(2),description:r.description,note:r.note,reason:'核对原单据后修正',parentVersion:r.parentSnapshot?.version??null,expenseVersion:r.expenseSnapshot?.version??null,...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);auth=new Authentication(db);
 for(const [role,superadmin,permissions] of [['admin',true,[]],['admin',false,['finance']],['admin',false,['resources']],['employee',false,[]],['admin',false,['finance']]]){
  const username='operating_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [person]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;
  people.push({...person,username,password});sessions.push(await auth.login(username,password,'operating-local'));
 }
 for(const name of ['日常收支甲店','日常收支乙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((p,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('finance-only daily sales are positive original facts with durable replay and no expense or cash side effects',async()=>{
 const api=clients[1],before=await api.finance(),body=value({sourceReference:'DAILY-SALES-001',amount:'12.34'}),saved=await api.saveOperatingRecord(null,body);
 assert.deepEqual(await api.saveOperatingRecord(null,body),saved);assert.deepEqual(await api.operatingReceipt(body.requestKey,'create'),saved);
 const state=await api.operatingRecord(saved.id);assert.equal(state.record.kind,'sale');assert.equal(state.record.amountCents,1234);assert.equal(state.record.note,'');assert.equal(state.parent,null);assert.equal(state.history.total,1);
 const rows=await api.operatingRecords({storeId:stores[0],month:'2026-01'});assert.equal(rows.summary.saleCents,'1234');assert.equal(rows.summary.refundCents,'0');assert.equal(rows.summary.feeCents,'0');
 assert.equal((await req(1,path,'POST',{...body,requestKey:randomUUID(),sourceReference:'daily-sales-001'})).status,409);
 assert.equal((await req(1,path,'POST',{...body,amount:'12.35'})).status,409);
 assert.deepEqual(await api.finance(),before);
 for(const i of [2,3]){assert.equal((await req(i,path)).status,403);assert.equal((await req(i,path+'/'+saved.id)).status,403);assert.equal((await req(i,path,'POST',value())).status,403);}
 assert.equal((await req(1,path,'POST',value(),false)).status,403);
 for(const invalid of [{amount:'0'},{amount:'-1'},{amount:null},{kind:['sale']},{businessDate:'2026-02-30'},{parentVersion:1},{expenseId:randomUUID(),expenseVersion:1},{untrustedStatus:'active'}])assert.equal((await req(1,path,'POST',value(invalid))).status,400);
});
test('cross-month customer refunds serialize against original sales, enforce dates and retain parent revision snapshots',async()=>{
 const api=clients[1],sale=await api.saveOperatingRecord(null,value({sourceReference:'REFUND-PARENT'}));
 const refund=value({kind:'refund',parentId:sale.id,parentVersion:1,sourceReference:'CUSTOMER-REFUND-1',businessDate:'2026-02-01',amount:'6.00',description:'客户实际退款'});
 assert.equal((await req(1,path,'POST',{...refund,storeId:stores[1]})).status,409);
 assert.equal((await req(1,path,'POST',{...refund,businessDate:'2025-12-31'})).status,400);
 const replies=await Promise.all(['A','B'].map(n=>req(1,path,'POST',{...refund,requestKey:randomUUID(),sourceReference:'CUSTOMER-REFUND-'+n})));assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 const accepted=await replies.find(r=>r.status===201).json(),frozen=(await api.operatingRecord(accepted.id)).history.rows[0];
 assert.equal((await api.operatingRecord(sale.id)).refundedCents,'600');assert.equal((await api.operatingRecords({month:'2026-02',kind:'refund'})).summary.refundCents,'600');
 let original=(await api.operatingRecord(sale.id)).record;
 assert.equal((await req(1,path+'/'+sale.id,'POST',revise(original,{amount:'5.00'}))).status,409);
 assert.equal((await req(1,path+'/'+sale.id,'POST',revise(original,{businessDate:'2026-02-02'}))).status,409);
 await api.saveOperatingRecord(sale.id,revise(original,{description:'原销售说明已复核'}));assert.equal((await api.operatingRecord(accepted.id)).parentChanged,true);
 assert.equal((await req(1,path,'POST',{...refund,requestKey:randomUUID(),sourceReference:'STALE-PARENT',amount:'4.00'})).status,409);
 await api.saveOperatingRecord(null,{...refund,requestKey:randomUUID(),sourceReference:'REMAINDER-REFUND',parentVersion:2,amount:'4.00'});
 assert.equal((await api.operatingRecord(sale.id)).refundedCents,'1000');
 assert.equal((await req(1,path,'POST',{...refund,requestKey:randomUUID(),sourceReference:'OVER-REFUND',parentVersion:2,amount:'0.01'})).status,409);
 const current=(await api.operatingRecord(accepted.id)).record;await api.saveOperatingRecord(accepted.id,revise(current,{amount:'5.00',parentVersion:2}));
 assert.equal((await api.operatingRecord(sale.id)).refundedCents,'900');assert.deepEqual((await api.operatingRecord(accepted.id)).history.rows.find(r=>r.version===1),frozen);
 const [closed]=await db.client`INSERT INTO studio_os.stores(name) VALUES('已停用的历史退款店铺') RETURNING id`;
 const past=await api.saveOperatingRecord(null,value({storeId:closed.id,sourceReference:'CLOSED-STORE-SALE'}));await db.client`UPDATE studio_os.stores SET active=false WHERE id=${closed.id}`;
 assert.equal((await req(1,path,'POST',value({storeId:closed.id,sourceReference:'NEW-CLOSED-SALE'}))).status,409);
 const historical=await api.saveOperatingRecord(null,value({kind:'refund',storeId:closed.id,parentId:past.id,parentVersion:1,sourceReference:'CLOSED-STORE-REFUND',amount:'1.00',businessDate:'2026-02-01'}));
 assert.equal((await api.operatingRecord(historical.id)).record.storeId,closed.id);
});
test('platform fees can reference one original expense without duplicate costs and detect changed source versions',async()=>{
 const api=clients[1],category=await api.createExpenseCategory('平台手续费来源'),expenseBody={expenseDate:'2026-03-01',description:'原平台手续费支出',amount:'1.25',paymentMode:'company',payerId:null,storeId:stores[0],categoryId:category.id,note:''};
 const expense=await api.saveExpense(undefined,{...expenseBody,requestKey:randomUUID()}),before=await api.finance();
 const body=value({kind:'fee',expenseId:expense.id,expenseVersion:1,sourceReference:'FEE-001',businessDate:'2026-03-01',amount:'1.25',description:'平台手续费核对'});
 assert.equal((await req(1,path,'POST',{...body,amount:'1.00'})).status,409);
 const saved=await api.saveOperatingRecord(null,body);assert.deepEqual(await api.finance(),before);assert.equal((await api.operatingRecord(saved.id)).record.expenseSnapshot.amountCents,125);
 assert.equal((await req(1,path,'POST',{...body,requestKey:randomUUID(),sourceReference:'DUPLICATE-EXPENSE'})).status,409);
 await api.saveExpense(expense.id,{...expenseBody,amount:'1.30'},1);
 let fee=(await api.operatingRecord(saved.id)).record;assert.equal(fee.sourceChanged,true);assert.equal((await api.operatingRecords({month:'2026-03'})).summary.changedSources,1);
 assert.equal((await req(1,path+'/'+saved.id,'POST',revise(fee,{amount:'1.30'}))).status,409);
 await api.saveOperatingRecord(saved.id,revise(fee,{amount:'1.30',expenseVersion:2}));fee=(await api.operatingRecord(saved.id)).record;assert.equal(fee.sourceChanged,false);assert.equal(fee.expenseSnapshot.version,2);
 const paid=await api.finance();await api.voidOperatingRecord(saved.id,{requestKey:randomUUID(),expectedVersion:fee.version,reason:'这条手续费核对记录作废'});
 assert.deepEqual(await api.finance(),paid);assert.equal((await api.operatingRecords({month:'2026-03'})).summary.feeCents,'0');assert.equal((await api.operatingRecords({month:'2026-03',status:'void'})).total,1);
});
test('voids preserve original records, cannot strand valid refunds, and serialize with new refund registration',async()=>{
 const api=clients[1],sale=await api.saveOperatingRecord(null,value({sourceReference:'VOID-SALE'}));
 const child=await api.saveOperatingRecord(null,value({kind:'refund',parentId:sale.id,parentVersion:1,amount:'1.00',sourceReference:'VOID-REFUND',businessDate:'2026-01-02'}));
 assert.equal((await req(1,path+'/'+sale.id+'/void','POST',{requestKey:randomUUID(),expectedVersion:1,reason:'尝试作废有退款的销售'})).status,409);
 const key=randomUUID(),body={requestKey:key,expectedVersion:1,reason:'确认退款登记重复，保留原依据'};
 await api.voidOperatingRecord(child.id,body);assert.deepEqual(await api.operatingReceipt(key,'void',child.id),{id:child.id,version:2});assert.equal((await api.operatingRecord(sale.id)).refundedCents,'0');
 await api.voidOperatingRecord(sale.id,{...body,requestKey:randomUUID()});assert.equal((await api.operatingRecord(sale.id)).record.status,'void');
 assert.equal((await req(1,path+'/'+sale.id,'POST',revise((await api.operatingRecord(sale.id)).record))).status,409);
 assert.equal((await req(1,path,'POST',value({sourceReference:'VOID-SALE'}))).status,409);
 const race=await api.saveOperatingRecord(null,value({sourceReference:'VOID-RACE'}));
 const [voided,refunded]=await Promise.all([req(1,path+'/'+race.id+'/void','POST',{requestKey:randomUUID(),expectedVersion:1,reason:'与退款同时核对'}),req(1,path,'POST',value({kind:'refund',parentId:race.id,parentVersion:1,sourceReference:'VOID-RACE-REFUND',amount:'1.00'}))]);assert.deepEqual([voided.status,refunded.status].sort(),[201,409]);
});
test('late persistence failures roll back all versions and private receipts, and history cannot be rewritten',async()=>{
 const api=clients[1],body=value({sourceReference:'ROLLBACK-SALE'}),before=(await api.operatingRecords({status:'all'})).total;
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_operating_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test operating rollback'; END; $$;
 CREATE TRIGGER fail_operating_receipt BEFORE INSERT ON studio_os.operating_finance_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_operating_receipt();`);
 try{assert.equal((await req(1,path,'POST',body)).status,500);assert.equal((await api.operatingRecords({status:'all'})).total,before);}
 finally{await db.client.unsafe('DROP TRIGGER fail_operating_receipt ON studio_os.operating_finance_receipts; DROP FUNCTION studio_os.fail_operating_receipt()');}
 const saved=await api.saveOperatingRecord(null,body),original=(await api.operatingRecord(saved.id)).record;
 const revisions=await Promise.all([req(1,path+'/'+saved.id,'POST',revise(original,{amount:'9.99'})),req(1,path+'/'+saved.id,'POST',revise(original,{amount:'9.98'}))]);assert.deepEqual(revisions.map(r=>r.status).sort(),[201,409]);
 for(const table of ['operating_finance_records','operating_finance_versions','operating_finance_receipts']){
  await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
 }
 assert.equal(await api.operatingReceipt(randomUUID(),'create'),null);
 assert.equal((await req(0,path+'/receipts/'+body.requestKey+'?operation=create')).status,404);
 assert.equal((await req(1,path+'/receipts/'+body.requestKey+'?operation=void&target='+saved.id)).status,404);
});
test('full-filter exact-cent summaries and version histories stay complete beyond fifty records',async()=>{
 const api=clients[1];let first;
 for(let n=0;n<55;n++){const created=await api.saveOperatingRecord(null,value({sourceReference:'PAGED-SALE-'+n,businessDate:'2026-04-01',amount:'0.01',description:'批量日常销售核对'}));first??=created;}
 const query={month:'2026-04',kind:'sale',q:'批量日常销售核对'},page=await api.operatingRecords(query);assert.equal(page.total,55);assert.equal(page.rows.length,50);assert.equal(page.summary.saleCents,'55');
 const next=await api.operatingRecords({...query,offset:50});assert.equal(next.rows.length,5);assert.equal(next.summary.saleCents,'55');
 const frozen=(await api.operatingRecord(first.id)).history.rows[0];
 for(let n=1;n<52;n++)await api.saveOperatingRecord(first.id,revise((await api.operatingRecord(first.id)).record,{description:'批量日常销售核对',reason:'逐版核对 '+n}));
 const history=await api.operatingRecord(first.id,50);assert.equal(history.history.total,52);assert.equal(history.history.rows.length,2);assert.deepEqual(history.history.rows.at(-1),frozen);
 for(const suffix of ['?month=2026-13','?status=unknown','?offset=-1','?kind=income','?unexpected=1'])assert.equal((await req(1,path+suffix)).status,400);
});
test('revoked finance authorization defeats stale service identities and their saved request receipts',async()=>{
 const api=clients[4],body=value({sourceReference:'REVOKED-FINANCE'}),saved=await api.saveOperatingRecord(null,body),service=new OperatingFinance(db),stale=sessions[4].user;
 await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[4].id}`;
 await assert.rejects(service.list(stale,{}),e=>e.status===403);await assert.rejects(service.detail(stale,saved.id,{}),e=>e.status===403);await assert.rejects(service.save(stale,null,body),e=>e.status===403);await assert.rejects(service.receipt(stale,body.requestKey,'create',null),e=>e.status===403);
});
