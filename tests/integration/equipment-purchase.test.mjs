import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {EquipmentPurchase} from '../../.build/server/equipment-purchase.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,auth,app,base,equipment,second,source,category,firstSave;const people=[],sessions=[],clients=[];
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function login(i){sessions[i]=await auth.login(people[i].username,people[i].password,'purchase-'+randomUUID());const s=sessions[i],api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients[i]=api;}
const body=(expectedVersion=0,extra={})=>({requestKey:randomUUID(),expectedVersion,purchaseDate:null,amount:null,supplier:'',expenseId:null,expenseVersion:null,reason:'核对设备采购原始资料',...extra});
const route=id=>'/equipment/catalog/'+id+'/purchase';
const state=()=>clients[0].equipmentPurchase(equipment.id);
const assetBody=(tag)=>({requestKey:randomUUID(),assetTag:tag,name:'拍摄设备',model:'原型号',keeperMemberId:null,location:'工作室',notes:'原设备维护说明'});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['resources']],['admin',false,['finance']],['admin',false,['resources','finance']],['admin',false,[]],['employee',false,[]],['admin',false,['resources','finance']]]){
  const username='purchase_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [r]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;people.push({...r,username,password});await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${username},${r.id})`;
 }
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(let i=0;i<people.length;i++)await login(i);
 equipment=await clients[0].equipmentWrite('register',undefined,assetBody('purchase-a'));second=await clients[0].equipmentWrite('register',undefined,assetBody('purchase-b'));
 category=await clients[0].createExpenseCategory('已有设备支出');source=await clients[0].saveExpense(undefined,{requestKey:randomUUID(),expenseDate:'2020-01-02',storeId:null,categoryId:category.id,description:'原设备合并支出',amount:'300.00',paymentMode:'company',payerId:null,note:'原凭据'});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('procurement reads require independent finance authority; writes require finance and resource maintenance together',async()=>{
 assert.equal((await state()).record,null);for(const i of [0,2,3,6])assert.equal((await req(i,route(equipment.id))).status,200);for(const i of [1,4,5])for(const path of [route(equipment.id),route(equipment.id)+'/history',route(equipment.id)+'/receipts/'+randomUUID()])assert.equal((await req(i,path)).status,403);
 for(const i of [1,2,4,5]){assert.equal((await req(i,route(equipment.id),'POST',body())).status,403);await assert.rejects(new EquipmentPurchase(db).save({...sessions[i].user,role:'admin',superadmin:true},equipment.id,body()),e=>e.status===403);}assert.equal((await state()).record,null);await checkReadiness(db);
});
test('explicit unknown and confirmed zero remain different, preserve original asset IDs and do not invent old purchase amounts',async()=>{
 firstSave=await clients[3].saveEquipmentPurchase(equipment.id,body());assert.equal(firstSave.id,equipment.id);let s=await state();assert.equal(s.record.amountCents,null);assert.equal(s.record.purchaseDate,null);assert.equal(s.record.version,1);
 await clients[3].saveEquipmentPurchase(equipment.id,body(1,{amount:'0',purchaseDate:'2020-02-29'}));s=await state();assert.equal(s.record.amountCents,0);assert.equal(s.record.purchaseDate,'2020-02-29');const history=await clients[2].equipmentPurchaseHistory(equipment.id);assert.equal(history.rows[1].amountCents,null);assert.equal(history.rows[0].amountCents,0);assert.equal((await clients[0].equipmentDetail(equipment.id)).version,1);
});
test('linking an existing expense freezes its source version without posting, splitting or changing the ledger',async()=>{
 const before=await clients[0].finance(),sourceRow=before.records.find(r=>r.id===source.id),v=body(2,{amount:'125.90',supplier:'采购专属供应商标记',purchaseDate:'2020-01-02',expenseId:source.id,expenseVersion:sourceRow.version});await clients[3].saveEquipmentPurchase(equipment.id,v);const s=await state();assert.equal(s.record.amountCents,12590);assert.equal(s.record.expenseId,source.id);assert.equal(s.record.expenseSnapshot.amountCents,30000);assert.equal(s.sourceChanged,false);assert.deepEqual((await clients[0].finance()).records,before.records);
 await clients[3].saveEquipmentPurchase(second.id,body(0,{expenseId:source.id,expenseVersion:sourceRow.version,amount:'40'}));assert.equal((await clients[0].finance()).records.length,before.records.length);assert.equal((await clients[0].equipmentPurchase(second.id)).record.expenseId,source.id);
});
test('procurement fields never enter shared catalogs, details, borrowing snapshots or generic history and cannot be overwritten by base edits',async()=>{
 const s=await state();for(const i of [1,4,5]){const values=[await clients[i].equipmentCatalog(),await clients[i].equipmentDetail(equipment.id)];for(const v of values){const json=JSON.stringify(v);for(const field of ['amountCents','purchaseDate','expenseSnapshot','expenseId','采购专属供应商标记'])assert.ok(!json.includes(field));}}
 const borrowed=await clients[5].equipmentWrite('borrow',equipment.id,{requestKey:randomUUID(),location:'拍摄台',shootingRequestId:null,note:'本人正常借用'},1);assert.ok(!JSON.stringify(await clients[5].equipmentLoan(borrowed.id)).includes('amountCents'));
 await clients[5].equipmentWrite('return',borrowed.id,{requestKey:randomUUID(),condition:'ok',note:'正常归还'},1);
 const ordinary=await clients[1].equipmentDetail(equipment.id);await clients[1].equipmentWrite('edit',equipment.id,{...assetBody('purchase-a'),name:'新设备名称',model:'新型号'},ordinary.version);assert.equal((await state()).record.version,s.record.version);assert.equal((await state()).record.amountCents,12590);
 const snapshots=await db.client`SELECT before_value,after_value,note FROM studio_os.equipment_events WHERE equipment_id=${equipment.id}`;for(const v of [snapshots,await clients[1].equipmentHistory(equipment.id)])for(const text of ['amount_cents','expense_snapshot','采购专属供应商标记'])assert.ok(!JSON.stringify(v).includes(text));
 assert.equal((await req(1,'/equipment/catalog/'+equipment.id,'PATCH',{...assetBody('purchase-a'),expectedVersion:ordinary.version+1,purchaseAmount:'0'})).status,400);assert.equal((await state()).record.equipmentSnapshot.name,'拍摄设备');
});
test('edited expense sources are marked changed; stale references conflict and old procurement snapshots remain intact',async()=>{
 const old=await state();await clients[0].saveExpense(source.id,{expenseDate:'2020-01-03',storeId:null,categoryId:category.id,description:'原支出已复核修改',amount:'400.00',paymentMode:'company',payerId:null,note:'追加原账本修改'},1);
 const changed=await state();assert.equal(changed.sourceChanged,true);assert.equal(changed.linkedExpense.amountCents,40000);assert.deepEqual(changed.record,old.record);
 await assert.rejects(clients[3].saveEquipmentPurchase(equipment.id,body(3,{expenseId:source.id,expenseVersion:1})),e=>e.status===409);
 await clients[3].saveEquipmentPurchase(equipment.id,body(3,{expenseId:source.id,expenseVersion:2,amount:'126.00',reason:'重新核对原支出，确认此设备实际采购价'}));assert.equal((await state()).sourceChanged,false);assert.equal((await clients[2].equipmentPurchaseHistory(equipment.id)).rows.find(r=>r.version===3).expenseSnapshot.amountCents,30000);
});
test('same request replays one immutable version while competing editors cannot silently overwrite one another',async()=>{
 const r=(await state()).record,v=body(r.version,{amount:'12.34'});const a=await Promise.all([req(3,route(equipment.id),'POST',v),req(3,route(equipment.id),'POST',v)]);assert.ok(a.every(r=>r.status===201));assert.deepEqual(await a[0].json(),await a[1].json());assert.equal((await state()).record.version,r.version+1);
 const next=(await state()).record;const results=await Promise.allSettled([clients[3].saveEquipmentPurchase(equipment.id,body(next.version,{amount:'1'})),clients[6].saveEquipmentPurchase(equipment.id,body(next.version,{amount:'2'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal((await state()).record.version,next.version+1);
});
test('private receipts are actor and asset scoped and a reused key cannot change the asset or amounts',async()=>{
 const r=(await state()).record,v=body(r.version,{amount:'10'}),saved=await clients[3].saveEquipmentPurchase(equipment.id,v);assert.deepEqual(await clients[3].equipmentPurchaseReceipt(equipment.id,v.requestKey),saved);assert.equal(await clients[6].equipmentPurchaseReceipt(equipment.id,v.requestKey),null);assert.equal(await clients[3].equipmentPurchaseReceipt(second.id,v.requestKey),null);
 await assert.rejects(clients[3].saveEquipmentPurchase(equipment.id,{...v,amount:'11'}),e=>e.status===409);await assert.rejects(clients[3].saveEquipmentPurchase(second.id,v),e=>e.status===409);
});
test('invalid money, dates, source versions, extra privileges and missing CSRF fail without a procurement or ledger change',async()=>{
 const r=await state(),v=body(r.record.version),path=route(equipment.id);
 for(const patch of [{amount:-1},{amount:'-1'},{amount:'1.001'},{amount:'21474836.48'},{amount:'NaN'},{purchaseDate:'2020-02-30'},{purchaseDate:'0000-01-01'},{expenseId:source.id,expenseVersion:null},{expenseId:null,expenseVersion:2},{reason:''},{expectedVersion:-1},{permissions:['finance']},{supplier:null}])assert.equal((await req(3,path,'POST',{...v,...patch})).status,400);
 assert.equal((await req(3,path,'POST',v,false)).status,403);await assert.rejects(clients[3].saveEquipmentPurchase(equipment.id,{...v,expenseId:randomUUID(),expenseVersion:1}),e=>e.status===404);assert.deepEqual(await state(),r);
});
test('version or receipt persistence failure rolls back the entire acquisition update and leaves the source ledger unchanged',async()=>{
 for(const table of ['equipment_purchase_versions','equipment_purchase_receipts']){const r=await state(),ledger=await clients[0].finance();await db.client.unsafe(`CREATE FUNCTION studio_os.reject_equipment_purchase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected purchase persistence failure'; END $$; CREATE TRIGGER reject_equipment_purchase BEFORE INSERT ON studio_os.${table} FOR EACH ROW EXECUTE FUNCTION studio_os.reject_equipment_purchase()`);
  try{const v=body(r.record.version,{amount:'30'});await assert.rejects(clients[3].saveEquipmentPurchase(equipment.id,v),e=>e.status===500);assert.equal(await clients[3].equipmentPurchaseReceipt(equipment.id,v.requestKey),null);assert.deepEqual(await state(),r);assert.deepEqual((await clients[0].finance()).records,ledger.records);}finally{await db.client.unsafe(`DROP TRIGGER reject_equipment_purchase ON studio_os.${table}; DROP FUNCTION studio_os.reject_equipment_purchase()`);}
 }
});
test('history paginates beyond fifty versions and immutable procurement facts and receipts cannot be rewritten',async()=>{
 let version=(await state()).record.version;for(let n=0;n<51;n++){const saved=await clients[3].saveEquipmentPurchase(equipment.id,body(version,{amount:String(n)}));version=saved.version;}
 const first=await clients[2].equipmentPurchaseHistory(equipment.id),secondPage=await clients[2].equipmentPurchaseHistory(equipment.id,50);assert.equal(first.rows.length,50);assert.ok(secondPage.rows.length>0);assert.equal(first.total,secondPage.total);assert.equal(new Set([...first.rows,...secondPage.rows].map(r=>r.id)).size,first.total);
 for(const table of ['equipment_purchase_versions','equipment_purchase_receipts'])for(const verb of ['UPDATE','DELETE'])await assert.rejects(db.client.unsafe(verb==='UPDATE'?`UPDATE studio_os.${table} SET created_at=created_at`:`DELETE FROM studio_os.${table}`),e=>e.code==='23514');await checkReadiness(db);
});
test('live authorization defeats stale service identities after resource or finance revocation',async()=>{
 const service=new EquipmentPurchase(db),old=sessions[6].user;let row=(await clients[0].loginAccounts()).find(a=>a.id===people[6].id);await clients[0].updateAccountPermissions(row.id,{superadmin:false,permissions:['finance'],reason:'撤销设备维护能力'},row.version);await login(6);
 await assert.rejects(service.save(old,equipment.id,body((await state()).record.version)),e=>e.status===403);assert.equal((await req(6,route(equipment.id))).status,200);
 row=(await clients[0].loginAccounts()).find(a=>a.id===people[6].id);await clients[0].updateAccountPermissions(row.id,{superadmin:false,permissions:['resources'],reason:'撤销采购金额访问'},row.version);await login(6);
 for(const read of [()=>service.state(old,equipment.id),()=>service.history(old,equipment.id,{}),()=>service.receipt(old,equipment.id,randomUUID())])await assert.rejects(read(),e=>e.status===403);assert.equal((await req(6,route(equipment.id))).status,403);assert.equal((await clients[6].equipmentDetail(equipment.id)).name,'新设备名称');
});
