import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {Finance} from '../../.build/server/finance.js';
import {AccountPermissions,bootstrapSuperadmin} from '../../.build/server/permissions.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth,expense,category;const people=[],sessions=[],clients=[];
const secret=()=>randomBytes(24).toString('hex');
const request=(s,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,...(csrf?{'x-csrf-token':s.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const grant=(permissions,superadmin=false)=>({permissions,superadmin,reason:'核对岗位分工后调整授权'});
const creation=(extra={})=>({requestKey:randomUUID(),username:'created_'+randomBytes(6).toString('hex'),role:'employee',password:secret(),memberId:null,memberVersion:null,reason:'团队账号开通',...extra});
const row=async id=>(await clients[0].loginAccounts()).find(a=>a.id===id);
async function login(i){sessions[i]=await auth.login(people[i].username,people[i].password,'permission-fixture-'+i);const s=sessions[i];const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients[i]=api;}
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,[]],['admin',false,['finance']],['admin',false,['account_security']],['employee',false,[]],['admin',true,[]]]){
  const username='permission_'+randomBytes(6).toString('hex'),password=secret();const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push({...u,username,password});
 }
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(let i=0;i<people.length;i++)await login(i);
 category=await clients[0].createExpenseCategory('隔离敏感财务分类');expense=await clients[0].saveExpense(undefined,{requestKey:randomUUID(),expenseDate:'2026-11-03',storeId:null,categoryId:category.id,description:'敏感支出',amount:'1.00',paymentMode:'company',payerId:null,note:''});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('ordinary admins retain daily business access but cannot read financial records, exports, private receipts or security endpoints',async()=>{
 const user=await clients[1].session();assert.equal(user.superadmin,false);assert.deepEqual(user.permissions,[]);
 for(const path of ['/finance','/finance/export?month=2026-11','/finance/events/'+expense.id,'/finance/expenses/'+expense.id+'/receipts/'+randomUUID(),'/admin/accounts','/admin/accounts/'+people[0].id+'/history','/admin/account-operations/'+randomUUID()])assert.equal((await request(sessions[1],path)).status,403,path);
 assert.equal((await request(sessions[1],'/materials')).status,200);assert.equal((await request(sessions[1],'/products')).status,200);assert.equal((await request(sessions[1],'/admin/members')).status,200);
 assert.equal((await request(sessions[1],'/finance/categories','POST',{name:'越权费用'})).status,403);
 assert.equal((await request(sessions[1],'/finance?permissions=finance')).status,403);
 const nav=await clients[1].navigation();assert.ok(!nav.some(s=>s.id==='finance'));assert.equal((await request(sessions[1],'/sections/finance')).status,403);
});
test('finance and account-security grants are independent, while super administrators retain both',async()=>{
 assert.equal((await request(sessions[2],'/finance')).status,200);assert.equal((await request(sessions[2],'/admin/accounts')).status,403);
 assert.equal((await request(sessions[3],'/admin/accounts')).status,200);assert.equal((await request(sessions[3],'/finance')).status,403);
 for(const i of [0,5]){assert.equal((await request(sessions[i],'/finance')).status,200);assert.equal((await request(sessions[i],'/admin/accounts')).status,200);}
});
test('only a current super administrator grants privileges; granting revokes sessions and preserves identity and audit facts',async()=>{
 let target=await row(people[1].id);for(const i of [1,2,3,4])assert.equal((await request(sessions[i],'/admin/accounts/'+target.id+'/permissions','PATCH',{...grant(['finance']),expectedVersion:target.version})).status,403);
 const saved=await clients[0].updateAccountPermissions(target.id,grant(['finance']),target.version);assert.equal(saved.id,target.id);assert.equal(saved.version,target.version+1);assert.equal((await request(sessions[1],'/session')).status,401);
 await login(1);assert.deepEqual((await clients[1].session()).permissions,['finance']);assert.equal((await request(sessions[1],'/finance')).status,200);assert.equal((await request(sessions[1],'/admin/accounts')).status,403);
 const history=await clients[0].accountAccessHistory(target.id);assert.equal(history[0].action,'permissions-changed');assert.deepEqual(history[0].beforeValue.permissions,[]);assert.deepEqual(history[0].afterValue.permissions,['finance']);assert.ok(!JSON.stringify(history).includes('password_hash'));
 await assert.rejects(clients[0].updateAccountPermissions(target.id,grant(['account_security']),target.version),e=>e.status===409);
});
test('security managers may manage employees but cannot create, reset, disable or promote administrators',async()=>{
 const api=clients[3],v=creation(),created=await api.accountLifecycle(undefined,v);assert.equal((await auth.login(v.username,v.password,'managed-employee')).user.role,'employee');
 await api.accountLifecycle(created.id,{requestKey:randomUUID(),password:secret(),reason:'员工忘记密码'},created.version);
 for(const target of [people[0],people[1],people[5]]){const r=await row(target.id);assert.equal((await request(sessions[3],'/admin/accounts/'+r.id+'/password-reset','POST',{requestKey:randomUUID(),password:secret(),reason:'越权',expectedVersion:r.version})).status,403);await assert.rejects(api.updateAccountAccess(r.id,{role:'employee',active:false},r.version),e=>e.status===403);}
 await assert.rejects(api.accountLifecycle(undefined,creation({role:'admin'})),e=>e.status===403);
 const employee=await row(created.id);await assert.rejects(api.updateAccountAccess(employee.id,{role:'admin',active:true},employee.version),e=>e.status===403);
 const [m]=await db.client`INSERT INTO studio_os.members(display_name) VALUES('待授权绑定') RETURNING id`;
 assert.equal((await request(sessions[2],'/admin/members/'+m.id,'PATCH',{loginAccountId:created.id,expectedVersion:1})).status,403);
});
test('new and promoted administrators start without sensitive grants and cannot grant themselves privileges',async()=>{
 const created=await clients[0].accountLifecycle(undefined,creation({role:'admin'}));const fresh=await row(created.id);assert.equal(fresh.superadmin,false);assert.deepEqual(fresh.permissions,[]);
 const employee=await clients[0].accountLifecycle(undefined,creation());await clients[0].updateAccountAccess(employee.id,{role:'admin',active:true},employee.version);assert.deepEqual((await row(employee.id)).permissions,[]);
 const me=await row(people[0].id);await assert.rejects(clients[0].updateAccountPermissions(me.id,grant([],false),me.version),e=>e.status===409);
 assert.equal((await request(sessions[1],'/admin/accounts/'+people[1].id+'/permissions','PATCH',{...grant(['finance','account_security'],true),expectedVersion:2})).status,403);
});
test('revoked grants invalidate old sessions and stale service identities cannot write sensitive data',async()=>{
 const old=sessions[1].user,target=await row(people[1].id);await clients[0].updateAccountPermissions(target.id,grant([]),target.version);assert.equal((await request(sessions[1],'/finance')).status,401);
 await assert.rejects(new Finance(db).category(old,{name:'失效授权不能写入'}),e=>e.status===403);
 await login(1);assert.equal((await request(sessions[1],'/finance')).status,403);
 const oldSuper=sessions[5].user,r=await row(people[5].id);await clients[0].updateAccountPermissions(r.id,grant([],false),r.version);await assert.rejects(new AccountPermissions(db).update(oldSuper,people[1].id,{...grant(['finance']),expectedVersion:(await row(people[1].id)).version}),e=>e.status===403);
});
test('invalid grants, missing CSRF and last-superadministrator changes fail without mutation',async()=>{
 const target=await row(people[1].id),path='/admin/accounts/'+target.id+'/permissions';
 for(const patch of [{permissions:['unknown']},{permissions:['finance','finance']},{superadmin:'true'},{reason:''},{extra:'grant'}])assert.equal((await request(sessions[0],path,'PATCH',{...grant([]),expectedVersion:target.version,...patch})).status,400);
 assert.equal((await request(sessions[0],path,'PATCH',{...grant(['finance']),expectedVersion:target.version},false)).status,403);assert.deepEqual(await row(target.id),target);
 const me=await row(people[0].id);await assert.rejects(clients[0].updateAccountAccess(me.id,{role:'employee',active:true},me.version),e=>e.status===409);await assert.rejects(clients[0].updateAccountAccess(me.id,{role:'admin',active:false},me.version),e=>e.status===409);
 await assert.rejects(db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY['unknown'] WHERE id=${target.id}`,e=>e.code==='23514');
 for(const sql of ['UPDATE studio_os.account_permission_events SET reason=reason','DELETE FROM studio_os.account_permission_events'])await assert.rejects(db.client.unsafe(sql),e=>e.code==='23514');await checkReadiness(db);
});

test('permission audit failure restores grants, version and existing sessions',async()=>{
 const target=await row(people[2].id);await db.client.unsafe("CREATE FUNCTION studio_os.reject_grant_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected grant audit failure'; END $$; CREATE TRIGGER reject_grant_audit BEFORE INSERT ON studio_os.account_permission_events FOR EACH ROW EXECUTE FUNCTION studio_os.reject_grant_audit()");
 try{await assert.rejects(clients[0].updateAccountPermissions(target.id,grant([]),target.version),e=>e.status===500);assert.deepEqual(await row(target.id),target);assert.equal((await request(sessions[2],'/finance')).status,200);}finally{await db.client.unsafe('DROP TRIGGER reject_grant_audit ON studio_os.account_permission_events; DROP FUNCTION studio_os.reject_grant_audit()');}
});
test('operator bootstrap selects no identity automatically and serializes the first explicit assignment',async()=>{
 await db.client`UPDATE studio_os.accounts SET superadmin=false`;
 await assert.rejects(bootstrapSuperadmin(db,people[4].username,'test employee rejection'),e=>e.status===409);
 const results=await Promise.allSettled([bootstrapSuperadmin(db,people[0].username,'explicit local recovery identity'),bootstrapSuperadmin(db,people[5].username,'second concurrent bootstrap')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.accounts WHERE active AND superadmin`)[0].n,1);
 const winner=results.find(r=>r.status==='fulfilled').value;assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.sessions WHERE account_id=${winner.id}`)[0].n,0);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.account_permission_events WHERE account_id=${winner.id} AND reason LIKE 'Operator bootstrap:%'`)[0].n,1);
 await assert.rejects(bootstrapSuperadmin(db,people[0].username,'cannot bootstrap twice'),e=>e.status===409);
});
