import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {Finance} from '../../.build/server/finance.js';
import {AccountAccess} from '../../.build/server/account-access.js';
import {AccountLifecycle} from '../../.build/server/account-lifecycle.js';
import {EquipmentPurchase} from '../../.build/server/equipment-purchase.js';
import {ResourceProfiles} from '../../.build/server/resource-profiles.js';
import {BusinessAccounts} from '../../.build/server/business-accounts.js';
import {InventoryAccess} from '../../.build/server/inventory-access.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth,expense,receipt,device,card,store;const people=[],sessions=[],clients=[],roles=[['admin',true,[]],['admin',false,['finance']],['admin',false,['account_security']],['admin',false,['payroll']],['admin',false,['personnel']],['admin',false,['resources']],['admin',false,['resource_identity']],['admin',false,['resources','resource_identity','finance']],['employee',false,[]]];
const req=(i,path,method='GET',body)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,'x-csrf-token':sessions[i].csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);auth=new Authentication(db);
 for(const [role,superadmin,permissions]of roles){const username='boundary_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id,job_title,start_date,employment_status) VALUES(${username},${p.id},'PERSONNEL_PRIVATE','2026-01-01','在职') RETURNING id`;people.push({...p,memberId:m.id,username,password});sessions.push(await auth.login(username,password,'access-boundaries-local'));}
 const [s]=await db.client`INSERT INTO studio_os.stores(name) VALUES('范围甲店') RETURNING id`;store=s.id;app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(const s of sessions){const api=createCloudApi((p,o)=>{const headers=new Headers(o?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...o,headers});},{allowWrites:true});await api.session();clients.push(api);}
 expense=await clients[0].saveExpense(null,{requestKey:randomUUID(),expenseDate:'2026-10-01',description:'FINANCE_PRIVATE',amount:'34.50',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'FINANCE_PRIVATE_NOTE',expenseScope:'public',expenseUse:'operating'});receipt=await new Finance(db).upload(sessions[0].user,expense.id,png,'FINANCE_PRIVATE.png','image/png','1');
 device=await clients[0].equipmentWrite('register',null,{requestKey:randomUUID(),assetTag:'BOUNDARY-DEVICE',name:'共享可借设备',model:'M',keeperMemberId:null,location:'设备柜',notes:'RESOURCE_PRIVATE_NOTE',serialNumber:'SERIAL_PRIVATE'});
 await new EquipmentPurchase(db).save(sessions[0].user,device.id,{requestKey:randomUUID(),expectedVersion:0,purchaseDate:'2026-10-01',amount:'123.45',supplier:'FINANCE_PRIVATE_SUPPLIER',expenseId:null,expenseVersion:null,reason:'采购真实依据'});
 await new BusinessAccounts(db).save({name:'共享运营账号',profileUrl:null,responsibleMemberId:people[8].memberId,boundPhone:'PHONE_PRIVATE',actualPhone:'ACTUAL_PHONE_PRIVATE',remark:'RESOURCE_PRIVATE_NOTE',storeId:store},people[0].id);
 card=await clients[0].savePhoneCard(null,{requestKey:randomUUID(),cardCode:'BOUNDARY-CARD',phoneNumber:'13800005678',carrier:'运营商',status:'spare',userMemberId:null,deviceId:device.id,storeId:store,accountIds:[],planDescription:'基础套餐',planExpiresOn:null,notes:'',reason:'原卡登记'});await clients[0].savePhoneCardIdentity(card.id,{requestKey:randomUUID(),expectedVersion:0,expectedCardVersion:1,registeredEntity:'IDENTITY_PRIVATE_ENTITY',reason:'原实名核对'});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('HTTP matrix keeps independent permissions and combined grants separate across current sensitive modules',async()=>{
 const routes=[['/finance',[0,1,7]],['/finance/overview?month=2026-10',[0,1,7]],['/finance/month-closures?month=2026-10',[0,1,7]],['/finance/events/'+expense.id,[0,1,7]],['/admin/accounts',[0,2]],['/admin/members/'+people[8].memberId+'/history',[0,4]],['/payroll/state?month=2026-10',[0,3]],['/equipment/catalog/'+device.id+'/history',[0,5,7]],['/equipment/catalog/'+device.id+'/purchase',[0,1,7]],['/resource-profiles/equipment-store/'+device.id,[0,5,7]],['/phone-cards/'+card.id+'/identity',[0,7]],['/phone-card-finance/'+card.id,[0,7]]];
 for(const [path,allowed]of routes)for(let i=0;i<people.length;i++)assert.equal((await req(i,path)).status,allowed.includes(i)?200:403,path+' role '+i);
});
test('shared member, account, device and card projections do not leak unrelated private fields',async()=>{
 const members=await clients[1].members();assert.ok(members.every(r=>r.jobTitle===null&&r.startDate===null&&r.endDate===null&&r.loginAccountId===null));assert.doesNotMatch(JSON.stringify(members),/PERSONNEL_PRIVATE/);
 const accounts=await clients[1].businessAccounts();assert.doesNotMatch(JSON.stringify(accounts),/PHONE_PRIVATE|ACTUAL_PHONE_PRIVATE|RESOURCE_PRIVATE_NOTE/);
 const shared=await clients[8].equipmentDetail(device.id);assert.equal(shared.notes,'');assert.equal(shared.serialNumber,'');assert.doesNotMatch(JSON.stringify(shared),/FINANCE_PRIVATE|12345|SERIAL_PRIVATE|RESOURCE_PRIVATE_NOTE/);
 const resource=await clients[5].equipmentDetail(device.id);assert.equal(resource.serialNumber,'SERIAL_PRIVATE');assert.doesNotMatch(JSON.stringify(resource),/FINANCE_PRIVATE_SUPPLIER|12345/);assert.doesNotMatch(JSON.stringify(await clients[5].phoneCard(card.id)),/IDENTITY_PRIVATE_ENTITY/);assert.equal((await clients[7].phoneCardIdentity(card.id)).rows[0].registeredEntity,'IDENTITY_PRIVATE_ENTITY');
});
test('private expense bytes require current finance permission rather than a known record id or resource access',async()=>{
 const path='/finance/expenses/'+expense.id+'/receipts/'+receipt.id;for(const i of [2,3,4,5,6,8])assert.equal((await req(i,path)).status,403);const r=await req(1,path);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
});
test('revoked financial objects cannot read ledger, audit, export or receipt bytes through retained service identities',async()=>{
 const finance=new Finance(db),old=sessions[1].user;assert.match(await finance.csv(old,{month:'2026-10'}),/FINANCE_PRIVATE/);await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[1].id}`;
 for(const read of [()=>finance.list(old),()=>finance.audit(old,expense.id),()=>finance.csv(old,{}),()=>finance.file(old,expense.id,receipt.id)])await assert.rejects(read(),e=>e.status===403);assert.equal((await req(1,'/finance')).status,403);
 await db.client`UPDATE studio_os.accounts SET active=false WHERE id=${people[1].id}`;await assert.rejects(finance.list(old),e=>e.status===401);
});
test('account directory, access history and private lifecycle receipts reject stale security identities and forged permission flags',async()=>{
 const lifecycle=new AccountLifecycle(db),access=new AccountAccess(db),old=sessions[2].user,key=randomUUID(),saved=await lifecycle.save(old,{requestKey:key,username:'new_'+randomBytes(5).toString('hex'),role:'employee',password:randomBytes(24).toString('hex'),memberId:null,memberVersion:null,reason:'授权核对测试新账号'});assert.equal((await lifecycle.receipt(old,key)).id,saved.id);await db.client`UPDATE studio_os.accounts SET admin_permissions=ARRAY[]::text[] WHERE id=${people[2].id}`;
 for(const read of [()=>access.list(old),()=>access.history(old,saved.id),()=>lifecycle.receipt(old,key),()=>access.list({...sessions[8].user,role:'admin',superadmin:true,permissions:['account_security']})])await assert.rejects(read(),e=>e.status===403);
});
test('normal permission updates invalidate old sessions, and reauthentication exposes only the new grant set',async()=>{
 const target=people[5],[r]=await db.client`SELECT version FROM studio_os.accounts WHERE id=${target.id}`;await clients[0].updateAccountPermissions(target.id,{permissions:[],superadmin:false,reason:'核对撤销资源授权'},r.version);assert.equal((await req(5,'/resource-profiles/equipment-store/'+device.id)).status,401);
 sessions[5]=await auth.login(target.username,target.password,'reauth-boundary');assert.equal((await req(5,'/resource-profiles/equipment-store/'+device.id)).status,403);assert.equal((await req(5,'/equipment/catalog/'+device.id)).status,200);await assert.rejects(new ResourceProfiles(db).state({...sessions[5].user,permissions:['resources']},'equipment-store',device.id,{}),e=>e.status===403);
});
test('role downgrade cannot preserve combined resource, financial or identity projections through stale handles',async()=>{
 const old=sessions[7].user;await db.client`UPDATE studio_os.accounts SET role='employee',admin_permissions=ARRAY[]::text[] WHERE id=${people[7].id}`;
 await assert.rejects(new EquipmentPurchase(db).state(old,device.id),e=>e.status===403);await assert.rejects(new ResourceProfiles(db).state(old,'card-plan',card.id,{}),e=>e.status===403);assert.equal((await req(7,'/phone-cards/'+card.id+'/identity')).status,403);assert.equal((await req(7,'/finance')).status,403);assert.equal((await req(7,'/equipment/catalog/'+device.id)).status,200);
});
test('exact store quantity grants do not authorize global catalog or financial cost endpoints and are reread after revocation',async()=>{
 const api=clients[0],item=await api.warehouseWrite('register',null,{requestKey:randomUUID(),itemCode:'BOUNDARY-PACK',kind:'packaging',productId:null,name:'范围包材',specification:'标准',unit:'个',location:'仓库',notes:'RESOURCE_PRIVATE_NOTE'});await api.warehouseWrite('move',item.id,{requestKey:randomUUID(),type:'opening',quantity:5,reason:'原期初',sourceReference:'',correctsMovementId:null},1);await api.warehouseWrite('allocate-packaging',item.id,{requestKey:randomUUID(),reason:'按原数量分账',allocations:[{storeId:null,quantity:3},{storeId:store,quantity:2}]},2);
 const inventory=new InventoryAccess(db),[a]=await db.client`SELECT version FROM studio_os.accounts WHERE id=${people[8].id}`;await inventory.save(sessions[0].user,people[8].id,{requestKey:randomUUID(),expectedVersion:a.version,grants:[{storeId:store,canMove:false}],reason:'仅查看本人店铺库存'});sessions[8]=await auth.login(people[8].username,people[8].password,'stock-boundary');const result=await req(8,'/packaging-stock');assert.equal(result.status,200);const rows=(await result.json()).rows;assert.equal(rows.length,1);assert.equal(rows[0].storeId,store);assert.equal(rows[0].quantity,2);assert.doesNotMatch(JSON.stringify(rows),/RESOURCE_PRIVATE_NOTE|amountCents|expenseSnapshot/);assert.equal((await req(8,'/warehouse/items/'+item.id)).status,403);assert.equal((await req(8,'/finance/inventory-costs?month=2026-10')).status,403);
 await db.client`DELETE FROM studio_os.inventory_access_grants WHERE account_id=${people[8].id}`;assert.equal((await inventory.mine(sessions[8].user)).grants.length,0);const empty=await req(8,'/packaging-stock');assert.equal(empty.status,200);assert.equal((await empty.json()).rows.length,0);assert.equal((await req(8,'/packaging-stock/'+rows[0].id)).status,404);
});
