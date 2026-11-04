import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {StoreMonthIncome} from '../../.build/server/store-month-income.js';
import {OperatingOverview} from '../../.build/server/operating-overview.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth;const people=[],sessions=[],clients=[],stores=[];
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const income=(month,amount,extra={})=>({requestKey:randomUUID(),expectedVersion:0,month,amount,sourceReference:'原店铺月度收入表',reason:'平台可提现金额已扣佣金退款，商品及代发成本另算',status:'confirmed',...extra});
const expense=(storeId,amount,extra={})=>({requestKey:randomUUID(),expenseDate:'2026-01-01',description:'按月核对运营支出',amount,paymentMode:'company',payerId:null,storeId,categoryId:null,note:'',expenseScope:storeId?'store':'public',expenseUse:'operating',...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);auth=new Authentication(db);
 for(const [role,permissions]of [['admin',['finance']],['admin',['resources']],['employee',[]],['admin',['finance']]]){
  const username='overview_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${db.client.array(permissions)}::text[]) RETURNING id`;people.push(p);sessions.push(await auth.login(username,password,'overview-local'));
 }
 for(const name of ['经营甲店','经营乙店','经营丙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('monthly confirmed income and original costs reproduce the ten-six-two example without daily sales duplication or public allocations',async()=>{
 const api=clients[0],before=await api.finance();
 for(const [i,amount]of ['30000.00','30000.00','40000.00'].entries())await api.saveMonthIncome(stores[i],income('2026-01',amount));
 assert.deepEqual(await api.finance(),before);
 for(const [i,amount]of ['10000.00','20000.00','30000.00'].entries())await api.saveExpense(undefined,expense(stores[i],amount));
 await api.saveExpense(undefined,expense(null,'20000.00'));
 await api.saveOperatingRecord(null,{requestKey:randomUUID(),kind:'sale',storeId:stores[0],parentId:null,expenseId:null,sourceReference:'仅供参考的日常销售',businessDate:'2026-01-01',amount:'100.00',description:'日常参考记录',note:'',reason:'核对',parentVersion:null,expenseVersion:null});
 let r=await api.financeOverview('2026-01');assert.equal(r.summary.incomeCents,'10000000');assert.equal(r.summary.directCostCents,'6000000');assert.equal(r.summary.storeProfitCents,'4000000');assert.equal(r.publicCents,'2000000');assert.equal(r.summary.studioProfitCents,'2000000');assert.equal(r.rows[0].dailySaleCents!==undefined,true);
 await db.client`INSERT INTO studio_os.stores(name) VALUES('下月新增尚无业务的店铺')`;await db.client`UPDATE studio_os.stores SET active=false WHERE id=${stores[0]}`;
 r=await api.financeOverview('2026-01');assert.equal(r.rows.length,3);assert.equal(r.summary.studioProfitCents,'2000000');assert.equal(r.rows.find(s=>s.storeId===stores[0]).active,false);
});
test('income corrections and withdrawals preserve history, explicit zero and negative amounts, replay and optimistic concurrency',async()=>{
 const api=clients[0],body=income('2026-02','0.00'),saved=await api.saveMonthIncome(stores[0],body);
 assert.deepEqual(await api.saveMonthIncome(stores[0],body),saved);assert.deepEqual(await api.monthIncomeReceipt(stores[0],body.requestKey,'2026-02'),saved);
 assert.equal((await api.financeOverview('2026-02')).summary.studioProfitCents,'0');
 const frozen=(await api.monthIncome(stores[0],'2026-02')).record;
 const revised=income('2026-02','-1.23',{expectedVersion:1}),path='/finance/month-income/'+stores[0];
 const replies=await Promise.all([req(0,path,'POST',revised),req(0,path,'POST',{...revised,requestKey:randomUUID()})]);assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);assert.equal((await api.financeOverview('2026-02')).summary.studioProfitCents,'-123');
 assert.deepEqual((await api.monthIncome(stores[0],'2026-02')).history.rows.find(r=>r.version===1),frozen);
 const withdrawn=income('2026-02','-1.23',{expectedVersion:2,status:'withdrawn',reason:'该份收入需重新复核'});await api.saveMonthIncome(stores[0],withdrawn);assert.equal((await api.financeOverview('2026-02')).summary.studioProfitCents,null);
 assert.equal((await req(0,path,'POST',{...withdrawn,requestKey:randomUUID(),expectedVersion:3})).status,409);
 assert.equal((await req(0,path,'POST',{...body,amount:'1.00'})).status,409);
 for(let version=3;version<53;version++)await api.saveMonthIncome(stores[0],income('2026-02','0.00',{expectedVersion:version}));
 const history=await api.monthIncome(stores[0],'2026-02',50);assert.equal(history.history.total,53);assert.equal(history.history.rows.length,3);assert.deepEqual(history.history.rows.at(-1),frozen);
});
test('missing attribution blocks misleading profit and platform deductions and their original expense evidence do not reduce net income again',async()=>{
 const api=clients[0];await api.saveMonthIncome(stores[1],income('2026-03','100.00'));
 const fee=await api.saveExpense(undefined,expense(stores[1],'1.25',{expenseDate:'2026-03-01',description:'原已记平台手续费'}));
 await api.saveOperatingRecord(null,{requestKey:randomUUID(),kind:'fee',storeId:stores[1],parentId:null,expenseId:fee.id,sourceReference:'手续费核对',businessDate:'2026-03-01',amount:'1.25',description:'同一手续费',note:'',reason:'复用原支出',parentVersion:null,expenseVersion:1});
 let r=await api.financeOverview('2026-03');assert.equal(r.rows[0].directCostCents,'0');assert.equal(r.rows[0].feeCents,'0');assert.equal(r.rows[0].profitCents,'10000');
 await api.saveExpense(undefined,{requestKey:randomUUID(),expenseDate:'2026-03-02',description:'尚未确认归属的支出',amount:'3.00',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:''});
 r=await api.financeOverview('2026-03');assert.equal(r.summary.studioProfitCents,null);assert.equal(r.rows[0].profitCents,null);assert.ok(r.publicPendingCount>0);
});
test('income receipt failure rolls back confirmation, and permissions and immutable history remain enforced',async()=>{
 const api=clients[0],body=income('2026-04','10.00'),path='/finance/month-income/'+stores[2];
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_month_income_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test month income rollback'; END; $$;
 CREATE TRIGGER fail_month_income_receipt BEFORE INSERT ON studio_os.store_month_income_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_month_income_receipt();`);
 try{assert.equal((await req(0,path,'POST',body)).status,500);assert.equal((await api.monthIncome(stores[2],'2026-04')).record,null);}
 finally{await db.client.unsafe('DROP TRIGGER fail_month_income_receipt ON studio_os.store_month_income_receipts; DROP FUNCTION studio_os.fail_month_income_receipt()');}
 await api.saveMonthIncome(stores[2],body);
 for(const i of [1,2]){assert.equal((await req(i,'/finance/overview?month=2026-04')).status,403);assert.equal((await req(i,path+'?month=2026-04')).status,403);assert.equal((await req(i,path,'POST',body)).status,403);}
 assert.equal((await req(0,path,'POST',income('2026-05','1.00'),false)).status,403);
 assert.equal((await req(3,path+'/receipts/'+body.requestKey+'?month=2026-04')).status,404);
 for(const table of ['store_month_income_versions','store_month_income_receipts'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
 for(const query of ['?month=2026-13','?month=2026-04&extra=1'])assert.equal((await req(0,'/finance/overview'+query)).status,400);
 const stale=sessions[3].user;await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[3].id}`;
 await assert.rejects(new StoreMonthIncome(db).state(stale,stores[2],{month:'2026-04'}),e=>e.status===403);await assert.rejects(new StoreMonthIncome(db).save(stale,stores[2],body),e=>e.status===403);await assert.rejects(new OperatingOverview(db).read(stale,{month:'2026-04'}),e=>e.status===403);
});
test('platform deductions linked to an expense in a different month are reference-only in both periods',async()=>{
 const api=clients[0];for(const month of ['2026-05','2026-06'])await api.saveMonthIncome(stores[1],income(month,'100.00'));
 const b=expense(stores[1],'2.50',{expenseDate:'2026-05-01',description:'平台已扣佣金原记账记录'}),e=await api.saveExpense(null,b),fee=await api.saveOperatingRecord(null,{requestKey:randomUUID(),kind:'fee',storeId:stores[1],parentId:null,expenseId:e.id,sourceReference:'跨月平台扣费核对',businessDate:'2026-06-01',amount:'2.50',description:'平台已扣费用',note:'',reason:'对应净额中的扣费',parentVersion:null,expenseVersion:1});
 for(const month of ['2026-05','2026-06'])assert.equal((await api.financeOverview(month)).summary.studioProfitCents,'10000');
 const {requestKey,...edit}=b;await api.saveExpense(e.id,{...edit,amount:'3.00'},1);for(const month of ['2026-05','2026-06'])assert.equal((await api.financeOverview(month)).summary.studioProfitCents,null);
 await api.saveOperatingRecord(fee.id,{requestKey:randomUUID(),expectedVersion:1,businessDate:'2026-06-01',amount:'3.00',description:'平台已扣费用复核',note:'',reason:'核对原支出新版本',parentVersion:null,expenseVersion:2});for(const month of ['2026-05','2026-06'])assert.equal((await api.financeOverview(month)).summary.studioProfitCents,'10000');
});
