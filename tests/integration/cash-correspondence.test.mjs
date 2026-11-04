import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {CashCorrespondence} from '../../.build/server/cash-correspondence.js';
import {Finance} from '../../.build/server/finance.js';
import {createCloudApi,chinaDate} from '../../dist/cloud-api.mjs';
let local,db,app,base;const sessions=[],clients=[],people=[],stores=[],month=chinaDate().slice(0,7),prior='2026-10',date=chinaDate();
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const cash=(extra={})=>({requestKey:randomUUID(),direction:'in',accountLabel:'公司收款渠道',sourceReference:randomUUID(),paidDate:date,amount:'100.00',description:'实际资金核对',lines:[],reason:'按实际银行流水核对',...extra});
const income=(storeId,businessMonth,amount='100.00',sourceVersion=1)=>({kind:'income',storeId,month:businessMonth,expenseId:null,amount,sourceVersion});
const expense=(expenseId,amount='10.00',sourceVersion=1)=>({kind:'expense',storeId:null,month:null,expenseId,amount,sourceVersion});
const expenseBody=(amount='10.00',extra={})=>({requestKey:randomUUID(),expenseDate:date,description:'原公司运营支出',amount,paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'',expenseScope:'public',expenseUse:'operating',...extra});
const revision=(r,extra={})=>({requestKey:randomUUID(),expectedVersion:r.version,paidDate:r.paidDate,amount:(r.amountCents/100).toFixed(2),description:r.description,lines:r.lines.map(l=>({kind:l.kind,storeId:l.storeId,month:l.month,expenseId:l.expenseId,amount:(l.amountCents/100).toFixed(2),sourceVersion:l.snapshot.version})),reason:'按新依据复核修正',...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);const auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['finance']],['admin',false,['resources']],['employee',false,[]],['admin',false,['finance']]]){const username='cash_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push(p);sessions.push(await auth.login(username,password,'cash-local'));}
 for(const name of ['到账甲店','到账乙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((p,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
 for(const store of stores)for(const m of [month,prior])await clients[0].saveMonthIncome(store,{requestKey:randomUUID(),expectedVersion:0,month:m,amount:'1000.00',sourceReference:'月度经营收入原确认',reason:'已扣客户退款，未扣经营成本',status:'confirmed'});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('one receipt can match multiple income periods; cross-month and partial receipts never add income or profit',async()=>{
 const api=clients[0],before=await api.financeOverview(month),old=await api.financeOverview(prior),body=cash({amount:'150.00',lines:[income(stores[0],prior,'80.00'),income(stores[1],month,'50.00')]}),saved=await api.saveCashMovement(null,body);
 assert.deepEqual(await api.saveCashMovement(null,body),saved);assert.deepEqual(await api.cashReceipt(body.requestKey,'create'),saved);
 const d=await api.cashMovement(saved.id);assert.equal(d.unmatchedCents,'2000');assert.equal(d.record.lines.length,2);assert.ok(d.matches.every(m=>!m.sourceChanged));assert.deepEqual(await api.financeOverview(month),before);assert.deepEqual(await api.financeOverview(prior),old);
 let src=await api.cashSources({kind:'income',month:prior});assert.equal(src.rows.find(r=>r.storeId===stores[0]).cashCents,'8000');assert.equal(src.rows.find(r=>r.storeId===stores[0]).differenceCents,'92000');
 await api.saveCashMovement(null,cash({amount:'50.00',lines:[income(stores[0],prior,'50.00')]}));src=await api.cashSources({kind:'income',month:prior});assert.equal(src.rows.find(r=>r.storeId===stores[0]).cashCents,'13000');
 // Above/below income is a reconciliation difference, never an invented fee or automatic income correction.
 await api.saveCashMovement(null,cash({amount:'2000.00',lines:[income(stores[0],prior,'2000.00')]}));src=await api.cashSources({kind:'income',month:prior});assert.equal(src.rows.find(r=>r.storeId===stores[0]).differenceCents,'-113000');assert.deepEqual(await api.financeOverview(month),before);
});
test('company payments split across expenses and serialize cumulative caps without editing original ledger facts',async()=>{
 const api=clients[0],e1=await api.saveExpense(null,expenseBody('10.00')),e2=await api.saveExpense(null,expenseBody('20.00')),ledger=await api.finance(),profit=await api.financeOverview(month);
 const first=await api.saveCashMovement(null,cash({direction:'out',amount:'15.00',lines:[expense(e1.id,'5.00'),expense(e2.id,'10.00')]}));assert.deepEqual(await api.finance(),ledger);assert.deepEqual(await api.financeOverview(month),profit);
 const rs=await Promise.all([0,1].map(i=>req(i,'/finance/cash-movements','POST',cash({direction:'out',amount:'4.00',lines:[expense(e1.id,'4.00')]}))));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
 const sources=await api.cashSources({kind:'expense',month,q:'原公司运营支出'}),r=sources.rows.find(r=>r.expenseId===e1.id);assert.equal(r.cashCents,'900');assert.equal(r.differenceCents,'100');
 const d=await api.cashMovement(first.id);await api.saveCashMovement(first.id,revision(d.record,{amount:'5.00',lines:[expense(e1.id,'5.00')]}));assert.equal((await api.cashSources({kind:'expense',month})).rows.find(r=>r.expenseId===e2.id).cashCents,'0');
});
test('original reimbursement payments are listed once and personal advances cannot be matched as company payments',async()=>{
 const api=clients[0],[m]=await db.client`INSERT INTO studio_os.members(display_name) VALUES('原垫付同事') RETURNING id`,body=expenseBody('30.00',{paymentMode:'advance',payerId:m.id}),e=await api.saveExpense(null,body),finance=new Finance(db);
 const before=await api.financeOverview(month),statement=await finance.settle(sessions[0].user,{requestKey:randomUUID(),payerId:m.id,startDate:date,endDate:date,note:'原垫付结算',items:[{expenseId:e.id,expectedVersion:1}]});
 const payment=await finance.pay(sessions[0].user,{requestKey:randomUUID(),settlementId:statement.id,expectedVersion:1,amount:'12.00',paidDate:date,note:'实际分次报销'});
 const d=await api.cashMovements({month,direction:'out'});assert.equal(d.rows.filter(r=>r.id===payment.id&&r.origin==='reimbursement').length,1);assert.equal(d.summary.reimbursementCents,'1200');assert.equal(d.rows.find(r=>r.id===payment.id).unmatchedCents,'0');
 assert.equal((await req(0,'/finance/cash-movements','POST',cash({direction:'out',amount:'30.00',lines:[expense(e.id,'30.00')]}))).status,409);assert.ok(!(await api.cashSources({kind:'expense',month})).rows.some(r=>r.expenseId===e.id));assert.deepEqual(await api.financeOverview(month),before);
 const ledger=await api.finance();assert.equal(ledger.settlements.find(r=>r.id===statement.id).paidCents,'1200');
});
test('original source revisions and withdrawals are detected without rewriting snapshots or actual money',async()=>{
 const api=clients[0],s=await api.saveCashMovement(null,cash({lines:[income(stores[1],prior)]})),frozen=(await api.cashMovement(s.id)).record;
 await api.saveMonthIncome(stores[1],{requestKey:randomUUID(),expectedVersion:1,month:prior,amount:'900.00',sourceReference:'收入新版本',reason:'核对业务原收入',status:'confirmed'});
 let d=await api.cashMovement(s.id);assert.equal(d.matches[0].sourceChanged,true);assert.equal(d.matches[0].line.snapshot.version,1);await api.saveCashMovement(s.id,revision(d.record,{lines:[income(stores[1],prior,'100.00',2)]}));d=await api.cashMovement(s.id);assert.equal(d.matches[0].sourceChanged,false);assert.deepEqual(d.history.rows.at(-1).lines,frozen.lines);
 await api.saveMonthIncome(stores[1],{requestKey:randomUUID(),expectedVersion:2,month:prior,amount:'900.00',sourceReference:'撤回收入确认',reason:'待重新核对',status:'withdrawn'});assert.equal((await api.cashMovement(s.id)).matches[0].sourceChanged,true);assert.equal((await req(0,'/finance/cash-movements/'+s.id,'POST',revision(d.record,{lines:[income(stores[1],prior,'100.00',3)]}))).status,409);await api.saveCashMovement(s.id,revision(d.record,{lines:[]}));assert.equal((await api.cashMovement(s.id)).unmatchedCents,'10000');
 const eBody=expenseBody('15.00'),e=await api.saveExpense(null,eBody),p=await api.saveCashMovement(null,cash({direction:'out',amount:'15.00',lines:[expense(e.id,'15.00')]}));await api.saveExpense(e.id,{...Object.fromEntries(Object.entries(eBody).filter(([k])=>k!=='requestKey')),amount:'10.00'},1);
 d=await api.cashMovement(p.id);assert.equal(d.matches[0].overmatched,true);assert.equal(d.matches[0].sourceChanged,true);assert.equal((await req(0,'/finance/expenses/'+e.id,'DELETE',{expectedVersion:2})).status,409);
 await api.saveCashMovement(p.id,revision(d.record,{lines:[expense(e.id,'10.00',2)]}));assert.equal((await api.cashMovement(p.id)).unmatchedCents,'500');
});
test('corrections, voids and duplicate source identifiers keep append-only history and free only active allocations',async()=>{
 const api=clients[0],e=await api.saveExpense(null,expenseBody('5.00')),b=cash({direction:'out',accountLabel:'  测试账户  ',sourceReference:' BANK-REF-ONE ',amount:'5.00',lines:[expense(e.id,'5.00')]}),saved=await api.saveCashMovement(null,b),d=await api.cashMovement(saved.id),voidBody={requestKey:randomUUID(),expectedVersion:1,reason:'原日期及金额需重新核对'};
 await api.voidCashMovement(saved.id,voidBody);assert.equal((await api.cashMovement(saved.id)).record.status,'void');assert.equal((await api.cashSources({kind:'expense',month})).rows.find(r=>r.expenseId===e.id).cashCents,'0');assert.equal((await req(0,'/finance/cash-movements','POST',{...b,requestKey:randomUUID(),accountLabel:'测试账户',sourceReference:'bank-ref-one'})).status,409);
 assert.equal((await req(0,'/finance/cash-movements/'+saved.id,'POST',revision(d.record))).status,409);const again=await api.saveCashMovement(null,cash({direction:'out',amount:'5.00',lines:[expense(e.id,'5.00')]}));assert.equal((await api.cashMovement(again.id)).matches[0].cashCents,'500');
 assert.ok((await api.cashMovements({month,status:'void'})).rows.some(r=>r.id===saved.id));
});
test('late receipt failures roll back all cash evidence and concurrent corrections require current versions',async()=>{
 const api=clients[0],b=cash({description:'失败回滚资金记录'});await db.client.unsafe(`CREATE FUNCTION studio_os.fail_cash_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cash rollback'; END; $$; CREATE TRIGGER fail_cash_receipt BEFORE INSERT ON studio_os.cash_movement_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_cash_receipt();`);
 try{assert.equal((await req(0,'/finance/cash-movements','POST',b)).status,500);assert.equal((await db.client`SELECT id FROM studio_os.cash_movement_records WHERE source_reference=${b.sourceReference}`).length,0);}finally{await db.client.unsafe('DROP TRIGGER fail_cash_receipt ON studio_os.cash_movement_receipts; DROP FUNCTION studio_os.fail_cash_receipt()');}
 const saved=await api.saveCashMovement(null,b),d=await api.cashMovement(saved.id),edit=revision(d.record),rs=await Promise.all([0,1].map(i=>req(i,'/finance/cash-movements/'+saved.id,'POST',{...edit,requestKey:randomUUID(),description:'并发修改'+i})));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
});
test('permissions, CSRF, direction validation, split limits, private receipts and revocation are enforced',async()=>{
 const api=clients[0],b=cash(),saved=await clients[4].saveCashMovement(null,b),path='/finance/cash-movements/'+saved.id;
 for(const i of [2,3]){assert.equal((await req(i,path)).status,403);assert.equal((await req(i,'/finance/cash-sources?month='+month)).status,403);}assert.equal((await req(0,'/finance/cash-movements','POST',cash(),false)).status,403);
 for(const change of [{amount:'0.00'},{lines:[income(stores[0],month,'101.00')]},{direction:'out',lines:[income(stores[0],month)]},{lines:[income(stores[0],month,'30.00'),income(stores[0],month,'30.00')]},{lines:[{...income(stores[0],month),quantity:99}]}])assert.equal((await req(0,'/finance/cash-movements','POST',cash(change))).status,400);
 assert.equal((await req(0,'/finance/cash-movements/receipts/'+b.requestKey+'?operation=create')).status,404);await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[4].id}`;const service=new CashCorrespondence(db);await assert.rejects(service.save(sessions[4].user,null,b),e=>e.status===403);await assert.rejects(service.receipt(sessions[4].user,b.requestKey,'create',null),e=>e.status===403);
 for(const table of ['cash_movement_records','cash_movement_versions','cash_source_references','cash_movement_receipts'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
});
test('all-filter summaries and source/history pages cover more than fifty facts and keep exact large totals',async()=>{
 const api=clients[0],saved=await api.saveCashMovement(null,cash({description:'翻页历史原记录'}));let d=await api.cashMovement(saved.id);for(let i=1;i<52;i++){await api.saveCashMovement(saved.id,revision(d.record));d=await api.cashMovement(saved.id);}const history=await api.cashMovement(saved.id,50);assert.equal(history.history.total,52);assert.equal(history.history.rows.length,2);
 for(let i=0;i<52;i++)await api.saveCashMovement(null,cash({accountLabel:'分页资金账户',amount:'21474836.47',description:'分页资金查询'}));const page=await api.cashMovements({month,q:'分页资金查询',offset:50});assert.equal(page.total,52);assert.equal(page.rows.length,2);assert.equal(page.summary.inCents,(52n*2147483647n).toString());
 for(let i=0;i<52;i++)await api.saveExpense(null,expenseBody('1.00',{description:'分页原公司支出'+i}));const sources=await api.cashSources({month,kind:'expense',q:'分页原公司支出',offset:50});assert.equal(sources.total,52);assert.equal(sources.rows.length,2);
});
