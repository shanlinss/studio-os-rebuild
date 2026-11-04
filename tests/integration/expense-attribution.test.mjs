import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {ExpenseAttribution} from '../../.build/server/expense-attribution.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
import {advancesByPerson,expenseOverview} from '../../dist/expense-attribution-model.mjs';
let local,db,app,base,auth;const people=[],sessions=[],clients=[],stores=[];
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const expense=(extra={})=>({requestKey:randomUUID(),expenseDate:'2026-11-01',description:'实际支出',amount:'300.00',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'',...extra});
const attribution=(r,extra={})=>({requestKey:randomUUID(),expectedVersion:r.version,expenseScope:'public',expenseUse:'operating',storeId:null,reason:'核对原支出用途与归属',...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);auth=new Authentication(db);
 for(const [i,role,permissions] of [[0,'admin',['finance']],[1,'admin',['resources']],[2,'employee',[]],[3,'admin',['finance']]]){
  const username='attribute_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [a]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${db.client.array(permissions)}::text[]) RETURNING id`;
  const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${i===0?'小林':i===3?'小李':username},${a.id}) RETURNING id`;people.push({...a,memberId:m.id});sessions.push(await auth.login(username,password,'attribution-local'));
 }
 for(const name of ['归属甲店','归属乙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('legacy expenses remain uncertain and explicit scope/use save atomically with original identities and request replays',async()=>{
 const api=clients[0],old=await api.saveExpense(undefined,expense({storeId:stores[0]}));let record=(await api.finance()).records.find(r=>r.id===old.id);assert.equal(record.expenseScope,'unclassified');assert.equal(record.expenseUse,'unclassified');
 const body=expense({description:'小林垫付水电费',paymentMode:'advance',payerId:people[0].memberId,expenseScope:'public',expenseUse:'operating'}),saved=await api.saveExpense(undefined,body);assert.deepEqual(await api.saveExpense(undefined,body),saved);
 record=(await api.finance()).records.find(r=>r.id===saved.id);assert.equal(record.expenseScope,'public');assert.equal(record.expenseUse,'operating');assert.equal(record.payerId,people[0].memberId);
 assert.equal((await req(0,'/finance/expenses','POST',{...body,expenseScope:'store',storeId:stores[0]})).status,409);
 assert.equal((await req(0,'/finance/expenses','POST',expense({expenseScope:'public',expenseUse:'operating',storeId:stores[0]}))).status,400);
 assert.equal((await req(0,'/finance/expenses','POST',expense({expenseScope:'store',expenseUse:'operating'}))).status,400);
 // Older editors preserve explicit classification when they omit the new fields.
 const edit=expense({description:'小林垫付水电费已核对',paymentMode:'advance',payerId:people[0].memberId});delete edit.requestKey;await api.saveExpense(saved.id,edit,record.version);
 record=(await api.finance()).records.find(r=>r.id===saved.id);assert.equal(record.expenseScope,'public');assert.equal(record.expenseUse,'operating');
});
test('paid and partly paid settlements permit attribution corrections without changing money, payer, receipts or reimbursement balances',async()=>{
 const api=clients[0],water=await api.saveExpense(undefined,expense({description:'小林结算水电费',paymentMode:'advance',payerId:people[0].memberId})),boxes=await api.saveExpense(undefined,expense({description:'小李采购纸箱',amount:'1000.00',paymentMode:'advance',payerId:people[3].memberId}));
 const statement=await api.createSettlement({payerId:people[0].memberId,startDate:'2026-11-01',endDate:'2026-11-30',items:[{expenseId:water.id,expectedVersion:1}],note:'水电费结算',requestKey:randomUUID()});
 await api.recordPayment({settlementId:statement.id,amount:'100.00',paidDate:'2026-11-02',note:'已报销一部分',requestKey:randomUUID()},1);
 const before=await api.finance(),r=before.records.find(r=>r.id===water.id),body=attribution(r),saved=await api.saveExpenseAttribution(water.id,body);
 assert.deepEqual(await api.saveExpenseAttribution(water.id,body),saved);assert.deepEqual(await api.expenseAttributionReceipt(water.id,body.requestKey),saved);
 const after=await api.finance(),fresh=after.records.find(r=>r.id===water.id);assert.equal(fresh.amountCents,r.amountCents);assert.equal(fresh.payerId,r.payerId);assert.equal(fresh.settlementId,r.settlementId);assert.deepEqual(fresh.receipts,r.receipts);assert.deepEqual(after.settlements,before.settlements);assert.deepEqual(after.payments,before.payments);assert.deepEqual(advancesByPerson(after),advancesByPerson(before));
 assert.equal((await req(0,'/finance/expenses/'+water.id+'/attribution','POST',{...attribution(fresh),amount:'1.00'})).status,400);
 const box=after.records.find(r=>r.id===boxes.id);await api.saveExpenseAttribution(box.id,attribution(box,{expenseUse:'inventory'}));
 const result=await api.finance(),overview=expenseOverview(result.records);assert.ok(BigInt(overview.publicCents)>=30000n);assert.equal(overview.inventoryCents,'100000');assert.equal(advancesByPerson(result).find(p=>p.payerId===people[3].memberId).totalCents,'100000');
 assert.equal((await api.financeEvents(water.id)).some(e=>e.action==='attributed'),true);
});
test('competing classification edits serialize and failed receipt persistence rolls back expense and original audit together',async()=>{
 const api=clients[0],saved=await api.saveExpense(undefined,expense({description:'并发核对归属'})),before=(await api.finance()).records.find(r=>r.id===saved.id),path='/finance/expenses/'+saved.id+'/attribution',body=attribution(before);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_attribution_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test attribution rollback'; END; $$;
 CREATE TRIGGER fail_attribution_receipt BEFORE INSERT ON studio_os.expense_attribution_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_attribution_receipt();`);
 const events=await api.financeEvents(saved.id);
 try{assert.equal((await req(0,path,'POST',body)).status,500);assert.deepEqual((await api.finance()).records.find(r=>r.id===saved.id),before);assert.deepEqual(await api.financeEvents(saved.id),events);assert.equal(await api.expenseAttributionReceipt(saved.id,body.requestKey),null);}
 finally{await db.client.unsafe('DROP TRIGGER fail_attribution_receipt ON studio_os.expense_attribution_receipts; DROP FUNCTION studio_os.fail_attribution_receipt()');}
 const replies=await Promise.all([req(0,path,'POST',body),req(0,path,'POST',{...body,requestKey:randomUUID(),expenseScope:'store',storeId:stores[0]})]);assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 const accepted=await replies.find(r=>r.status===201).json(),current=(await api.finance()).records.find(r=>r.id===saved.id);assert.equal(current.version,2);assert.equal(current.amountCents,before.amountCents);
 assert.equal((await req(0,path,'POST',{...body,reason:'同一标识换了内容'})).status,409);
 await assert.rejects(db.client`DELETE FROM studio_os.expense_attribution_receipts`,e=>e.code==='23514');
});
test('historical store references and fully reimbursed statements remain usable without public cost allocation',async()=>{
 const api=clients[0],saved=await api.saveExpense(undefined,expense({description:'历史店铺专属费',storeId:stores[1],expenseScope:'store',expenseUse:'operating'}));
 await db.client`UPDATE studio_os.stores SET active=false WHERE id=${stores[1]}`;
 let row=(await api.finance()).records.find(r=>r.id===saved.id);await api.saveExpenseAttribution(saved.id,attribution(row,{expenseScope:'store',expenseUse:'prepaid',storeId:stores[1]}));
 assert.equal((await req(0,'/finance/expenses','POST',expense({expenseScope:'store',expenseUse:'operating',storeId:stores[1]}))).status,400);
 const paid=await api.saveExpense(undefined,expense({description:'已报销完成的专属费用',paymentMode:'advance',payerId:people[0].memberId,expenseScope:'store',expenseUse:'operating',storeId:stores[0]}));
 const statement=await api.createSettlement({payerId:people[0].memberId,startDate:'2026-11-01',endDate:'2026-11-30',items:[{expenseId:paid.id,expectedVersion:1}],note:'已报销结算',requestKey:randomUUID()});
 await api.recordPayment({settlementId:statement.id,amount:'300.00',paidDate:'2026-11-02',note:'全额报销',requestKey:randomUUID()},1);
 const before=await api.finance();row=before.records.find(r=>r.id===paid.id);const balances=advancesByPerson(before),publicBefore=expenseOverview(before.records).publicCents;await api.saveExpenseAttribution(paid.id,attribution(row));
 const after=await api.finance();assert.deepEqual(advancesByPerson(after),balances);assert.deepEqual(after.payments,before.payments);assert.deepEqual(after.settlements,before.settlements);assert.equal(after.records.find(r=>r.id===paid.id).expenseScope,'public');
 const overview=expenseOverview(after.records);assert.equal(BigInt(overview.publicCents),BigInt(publicBefore)+30000n);assert.ok(!overview.stores.some(r=>r.storeId===stores[1]));
});
test('financial permissions, CSRF, actor-scoped receipts and stale authorization protect attribution independently of resources',async()=>{
 const api=clients[0],saved=await api.saveExpense(undefined,expense({description:'权限核对支出'})),row=(await api.finance()).records.find(r=>r.id===saved.id),body=attribution(row),path='/finance/expenses/'+saved.id+'/attribution';
 for(const i of [1,2])assert.equal((await req(i,path,'POST',body)).status,403);
 assert.equal((await req(0,path,'POST',body,false)).status,403);
 await api.saveExpenseAttribution(saved.id,body);
 assert.equal((await req(3,path+'/receipts/'+body.requestKey)).status,404);
 assert.equal((await req(0,path,'POST',{...body,requestKey:randomUUID(),amount:'1.00'})).status,400);
 const stale=sessions[3].user;await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[3].id}`;
 const service=new ExpenseAttribution(db);await assert.rejects(service.save(stale,saved.id,{...body,requestKey:randomUUID(),expectedVersion:2}),e=>e.status===403);await assert.rejects(service.receipt(stale,saved.id,body.requestKey),e=>e.status===403);
});
