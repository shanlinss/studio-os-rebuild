import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {InventoryAccess} from '../../.build/server/inventory-access.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,auth,app,base,stock;const people=[],sessions=[],clients=[],stores=[];
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function login(i){sessions[i]=await auth.login(people[i].username,people[i].password,'inventory-scope-'+randomUUID());const s=sessions[i],api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients[i]=api;}
const body=(grants)=>({requestKey:randomUUID(),grants,reason:'核对职责后设置明确库存范围'});
const current=()=>clients[0].inventoryAccess(people[4].id);
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['account_security']],['admin',false,['resources']],['admin',false,[]],['employee',false,[]],['employee',false,[]],['admin',true,[]]]){
  const username='inventory_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [r]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push({...r,username,password});
 }
 for(const name of ['库存范围甲店','库存范围乙店']){const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES(${name}) RETURNING id`;stores.push(s.id);}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(let i=0;i<people.length;i++)await login(i);
 stock=await clients[0].warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:'scope-stock',kind:'packaging',productId:null,name:'旧总库存',specification:'标准',unit:'个',location:'甲店架子（位置不等于归属）',notes:'只允许原资源管理员读取'});
 await clients[0].warehouseWrite('move',stock.id,{requestKey:randomUUID(),type:'opening',quantity:30,reason:'保留原实盘数量',sourceReference:'',correctsMovementId:null},1);
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('empty scope default reuses original accounts and stores without changing quantities or expanding resource access',async()=>{
 assert.deepEqual((await current()).grants,[]);const mine=await clients[4].myInventoryAccess();assert.deepEqual(mine,{canManageAll:false,grants:[],quantityOperationsAvailable:false});assert.equal((await clients[2].myInventoryAccess()).canManageAll,true);assert.equal((await clients[0].warehouseItem(stock.id)).quantity,30);assert.equal((await req(4,'/warehouse/items')).status,403);await checkReadiness(db);
});
test('only a current superadministrator changes scopes; security may inspect and other roles see their own configuration only',async()=>{
 const r=await current(),path='/admin/accounts/'+r.id+'/inventory-access',v={...body([{storeId:null,canMove:false}]),expectedVersion:r.version};
 assert.equal((await req(1,path)).status,200);for(const i of [2,3,4,5])assert.equal((await req(i,path)).status,403);for(const i of [1,2,3,4,5])assert.equal((await req(i,path,'POST',v)).status,403);
 for(const i of [1,2,3,4,5])await assert.rejects(new InventoryAccess(db).save({...sessions[i].user,role:'admin',superadmin:true},r.id,v),e=>e.status===403);
 assert.equal((await current()).version,r.version);
});
test('public read and individual store movement settings are exact, audited and revoke the target sessions atomically',async()=>{
 const r=await current(),v=body([{storeId:null,canMove:false},{storeId:stores[0],canMove:true}]),result=await clients[0].saveInventoryAccess(r.id,v,r.version);
 assert.equal(result.id,r.id);assert.equal(result.version,r.version+1);assert.equal((await req(4,'/session')).status,401);await login(4);
 const mine=await clients[4].myInventoryAccess();assert.equal(mine.canManageAll,false);assert.equal(mine.quantityOperationsAvailable,false);assert.equal(mine.grants.length,2);assert.equal(mine.grants.find(g=>g.storeId===null).canMove,false);assert.equal(mine.grants.find(g=>g.storeId===stores[0]).canMove,true);assert.ok(!mine.grants.some(g=>g.storeId===stores[1]));
 const h=await clients[1].inventoryAccessHistory(r.id);assert.equal(h.rows[0].afterValue.version,result.version);assert.equal(h.rows[0].beforeValue.grants.length,0);assert.equal(h.rows[0].reason,v.reason);assert.ok(!JSON.stringify(h).includes('password'));
 assert.deepEqual(await clients[0].saveInventoryAccess(r.id,v,r.version),result);assert.deepEqual(await clients[0].inventoryAccessReceipt(r.id,v.requestKey),result);assert.equal((await clients[1].inventoryAccessHistory(r.id)).total,1);
 assert.equal((await req(4,'/warehouse/items')).status,403);assert.equal((await req(4,'/warehouse/items/'+stock.id+'/movements','POST',{requestKey:randomUUID(),expectedVersion:2,type:'outbound',quantity:1,reason:'不可操作旧总余额',sourceReference:'',correctsMovementId:null})).status,403);assert.equal((await clients[0].warehouseItem(stock.id)).quantity,30);
});
test('duplicate scopes, wildcards, malformed grants, missing reason, spoofed claims and absent CSRF fail without mutation',async()=>{
 const r=await current(),path='/admin/accounts/'+r.id+'/inventory-access',v={...body([]),expectedVersion:r.version};
 for(const patch of [{grants:[{storeId:null,canMove:false},{storeId:null,canMove:true}]},{grants:[{storeId:'*',canMove:true}]},{grants:[{storeId:null,canMove:'true'}]},{grants:[{storeId:null,canMove:true,canStocktake:true}]},{grants:[{canMove:true}]},{grants:null},{grants:Array.from({length:101},()=>({storeId:randomUUID(),canMove:false}))},{reason:''},{expectedVersion:0},{permissions:['resources']}])assert.equal((await req(0,path,'POST',{...v,...patch})).status,400);
 assert.equal((await req(0,path,'POST',v,false)).status,403);assert.deepEqual(await current(),r);
});
test('scope writes share original account version fences with competing scope and account-state changes',async()=>{
 const r=await current(),a=body([{storeId:null,canMove:true}]),b=body([{storeId:stores[1],canMove:false}]);const results=await Promise.allSettled([clients[0].saveInventoryAccess(r.id,a,r.version),clients[6].saveInventoryAccess(r.id,b,r.version)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const now=await current();await assert.rejects(clients[0].updateAccountAccess(r.id,{role:'employee',active:false},r.version),e=>e.status===409);assert.equal(now.version,r.version+1);
});
test('private receipts belong to actor and target; a reused key with changed meaning conflicts',async()=>{
 const r=await current(),v=body([]),saved=await clients[0].saveInventoryAccess(r.id,v,r.version);
 assert.deepEqual(await clients[0].inventoryAccessReceipt(r.id,v.requestKey),saved);assert.equal(await clients[6].inventoryAccessReceipt(r.id,v.requestKey),null);assert.equal(await clients[0].inventoryAccessReceipt(people[5].id,v.requestKey),null);assert.equal((await req(1,'/admin/accounts/'+r.id+'/inventory-access/receipts/'+v.requestKey)).status,403);
 await assert.rejects(clients[0].saveInventoryAccess(r.id,{...v,reason:'改变内容'},r.version),e=>e.status===409);await assert.rejects(clients[0].saveInventoryAccess(people[5].id,v,1),e=>e.status===409);
});
test('store deactivation hides personal effective configuration but preserves history and allows removal or reduction only',async()=>{
 let r=await current();await clients[0].saveInventoryAccess(r.id,body([{storeId:stores[0],canMove:true}]),r.version);const frozen=(await clients[0].inventoryAccessHistory(r.id)).rows[0];await login(4);
 await db.client`UPDATE studio_os.stores SET active=false,name='停用后新名称',version=version+1 WHERE id=${stores[0]}`;
 assert.deepEqual((await clients[4].myInventoryAccess()).grants,[]);r=await current();assert.equal(r.grants[0].storeActive,false);assert.equal((await clients[0].inventoryAccessHistory(r.id)).rows.find(e=>e.id===frozen.id).afterValue.grants[0].storeName,'库存范围甲店');
 await clients[0].saveInventoryAccess(r.id,body([{storeId:stores[0],canMove:false}]),r.version);r=await current();await assert.rejects(clients[0].saveInventoryAccess(r.id,body([{storeId:stores[0],canMove:true}]),r.version),e=>e.status===409);
 await clients[0].saveInventoryAccess(r.id,body([]),r.version);r=await current();await assert.rejects(clients[0].saveInventoryAccess(r.id,body([{storeId:stores[0],canMove:false}]),r.version),e=>e.status===409);await assert.rejects(clients[0].saveInventoryAccess(r.id,body([{storeId:randomUUID(),canMove:false}]),r.version),e=>e.status===409);
});
test('audit or receipt failure rolls back scope replacement, account version and target session revocation',async()=>{
 for(const table of ['inventory_access_events','inventory_access_receipts']){
  await login(4);const r=await current();await db.client.unsafe(`CREATE FUNCTION studio_os.reject_inventory_access() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected scope failure'; END $$; CREATE TRIGGER reject_inventory_access BEFORE INSERT ON studio_os.${table} FOR EACH ROW EXECUTE FUNCTION studio_os.reject_inventory_access()`);
  try{await assert.rejects(clients[0].saveInventoryAccess(r.id,body([{storeId:null,canMove:true}]),r.version),e=>e.status===500);assert.deepEqual(await current(),r);assert.equal((await req(4,'/session')).status,200);}finally{await db.client.unsafe(`DROP TRIGGER reject_inventory_access ON studio_os.${table}; DROP FUNCTION studio_os.reject_inventory_access()`);}
 }
});
test('history is immutable and paginated beyond fifty changes; inactive targets cannot receive grants',async()=>{
 let r=await current();for(let n=0;n<51;n++){await clients[0].saveInventoryAccess(r.id,body(n%2?[{storeId:null,canMove:false}]:[]),r.version);r=await current();}
 const first=await clients[1].inventoryAccessHistory(r.id),second=await clients[1].inventoryAccessHistory(r.id,50);assert.equal(first.rows.length,50);assert.ok(second.rows.length>0);assert.equal(first.total,second.total);assert.ok(second.rows.every(row=>!first.rows.some(other=>other.id===row.id)));for(const table of ['inventory_access_events','inventory_access_receipts'])for(const verb of ['UPDATE','DELETE'])await assert.rejects(db.client.unsafe(verb==='UPDATE'?`UPDATE studio_os.${table} SET created_at=created_at`:`DELETE FROM studio_os.${table}`),e=>e.code==='23514');
 await clients[0].updateAccountAccess(r.id,{role:'employee',active:false},r.version);const inactive=await current();await assert.rejects(clients[0].saveInventoryAccess(r.id,body([{storeId:null,canMove:true}]),inactive.version),e=>e.status===409);assert.equal((await clients[0].warehouseItem(stock.id)).quantity,30);await checkReadiness(db);
});
test('revoking superadministrator status defeats stale service identities and old private receipt access',async()=>{
 const old=sessions[6].user;const [target]=await db.client`SELECT version FROM studio_os.accounts WHERE id=${people[6].id}`;await clients[0].updateAccountPermissions(people[6].id,{superadmin:false,permissions:['account_security'],reason:'撤销授权管理职责'},target.version);await login(6);const r=await current();
 await assert.rejects(new InventoryAccess(db).save(old,people[5].id,{...body([]),expectedVersion:1}),e=>e.status===403);assert.equal((await req(6,'/admin/accounts/'+r.id+'/inventory-access/receipts/'+randomUUID())).status,403);assert.equal((await req(6,'/admin/accounts/'+r.id+'/inventory-access')).status,200);
});
