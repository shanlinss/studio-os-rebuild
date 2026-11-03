import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,product,source,transferred;const sessions=[],clients=[];
const request=(s,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:'studio_session='+s.token,...(csrf?{'x-csrf-token':s.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const movement=(type,quantity)=>({requestKey:randomUUID(),type,quantity,reason:'实物核对',sourceReference:'',correctsMovementId:null});
const value=(target,quantity=1)=>({requestKey:randomUUID(),quantity,reason:'拍摄领用备样',sourceReference:'TEST-SAMPLE',confirmed:true,target});
const newTarget=(name='黑色拍摄样品')=>({mode:'new',name,warehouseLocation:'样品架 A',keeperMemberId:null,notes:'黑色规格'});
const existing=r=>({mode:'existing',sampleId:r.id,expectedVersion:r.version});
async function sample(id){const [r]=await db.client`SELECT * FROM studio_os.shooting_samples WHERE id=${id}`;return r;}
async function stock(extra={},opening=10){const r=await clients[0].warehouseWrite('register',undefined,{requestKey:randomUUID(),itemCode:randomUUID(),kind:'product',productId:product.id,name:'黑色产品',specification:'黑色',unit:'件',location:'产品架',notes:'原备注',...extra});if(opening!==null)await clients[0].warehouseWrite('move',r.id,movement('opening',opening),1);return clients[0].warehouseItem(r.id);}
async function snapshot(id,key){return {item:await clients[0].warehouseItem(id),history:await clients[0].warehouseHistory(id),links:await db.client`SELECT * FROM studio_os.warehouse_sample_links ORDER BY sample_id`,samples:await db.client`SELECT * FROM studio_os.shooting_samples ORDER BY id`,events:await db.client`SELECT * FROM studio_os.shooting_sample_events ORDER BY id`,transfers:await clients[0].warehouseTransfers(id),receipt:(await request(sessions[0],'/warehouse/receipts/'+key)).status};}
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);const auth=new Authentication(db);
 for(const role of ['admin','employee','admin']){const username='transfer_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES('转样隔离成员',${u.id})`;sessions.push(await auth.login(username,password,'transfer-local'));}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
 product=await clients[0].createProduct({name:'转样原产品',storeId:null,notes:'不可改写',stages:['内容测试']});source=await stock();
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('one transaction debits product and credits the original sample with linked immutable facts',async()=>{
 const api=clients[0],payload=value(newTarget(),3);transferred=await api.warehouseToSamples(source.id,payload,source.version);
 assert.deepEqual(await api.warehouseToSamples(source.id,payload,source.version),transferred);
 const reordered={...payload,target:Object.fromEntries(Object.entries(payload.target).reverse())};assert.deepEqual(await api.warehouseToSamples(source.id,reordered,source.version),transferred);
 assert.equal((await api.warehouseItem(source.id)).quantity,7);assert.equal((await sample(transferred.sampleId)).available_quantity,3);
 assert.equal((await api.sampleCatalog()).rows.find(r=>r.id===transferred.sampleId).product_id,product.id);
 const a=await api.warehouseTransfers(source.id),b=await api.warehouseTransfers(transferred.sampleId,0,true);assert.equal(a.total,1);assert.deepEqual(a,b);assert.equal(a.rows[0].sourceBefore,10);assert.equal(a.rows[0].targetAfter,3);
 const m=await api.warehouseMovement(source.id,transferred.movementId);assert.equal(m.transferId,transferred.transferId);assert.equal(m.targetSampleId,transferred.sampleId);
 const [event]=await db.client`SELECT * FROM studio_os.shooting_sample_events WHERE id=${transferred.sampleEventId}`;assert.equal(event.action,'stock-in');assert.equal(event.after_value.origin.warehouseTransferId,transferred.transferId);
 assert.equal((await api.products()).find(r=>r.id===product.id).notes,'不可改写');assert.equal((await api.finance()).records.length,0);
 await assert.rejects(api.warehouseToSamples(source.id,{...payload,quantity:2},source.version),e=>e.status===409);
 assert.deepEqual(await api.warehouseReceipt(payload.requestKey,'transfer',source.id),transferred);assert.equal((await request(sessions[2],'/warehouse/receipts/'+payload.requestKey)).status,404);
});
test('original borrow and partial return change only sample stock; existing target metadata is retained',async()=>{
 const api=clients[0],employee=clients[1];let s=await sample(transferred.sampleId);
 const loan=await employee.sampleWrite('borrow',s.id,{requestKey:randomUUID(),quantity:2,location:'拍摄桌',shootingRequestId:null,note:''},s.version);
 let r=await api.warehouseItem(source.id);s=await sample(s.id);
 await api.warehouseToSamples(r.id,value(existing(s),2),r.version);s=await sample(s.id);assert.equal(s.available_quantity,3);assert.equal(s.notes,'黑色规格');assert.equal(s.warehouse_location,'样品架 A');
 const loans=await employee.sampleLoans();const own=loans.rows.find(r=>r.id===loan.id);await employee.sampleWrite('return',own.id,{requestKey:randomUUID(),quantity:1,note:''},own.version);
 assert.equal((await sample(s.id)).available_quantity,4);assert.equal((await api.warehouseItem(source.id)).quantity,5);
});
test('concurrent transfer requests share source locking and durable request replay',async()=>{
 const r=await stock({},2),payload=value(newTarget('并发样品'),2),body={...payload,expectedVersion:r.version};
 const replies=await Promise.all([request(sessions[0],'/warehouse/items/'+r.id+'/to-samples','POST',body),request(sessions[0],'/warehouse/items/'+r.id+'/to-samples','POST',body)]);assert.ok(replies.every(r=>r.status===201));assert.deepEqual(await replies[0].json(),await replies[1].json());assert.equal((await clients[0].warehouseItem(r.id)).quantity,0);assert.equal((await clients[0].warehouseTransfers(r.id)).total,1);
 const other=await stock({},2),v=value(newTarget('竞争样品'),2);
 const race=await Promise.all([request(sessions[0],'/warehouse/items/'+other.id+'/to-samples','POST',{...v,expectedVersion:other.version}),request(sessions[2],'/warehouse/items/'+other.id+'/movements','POST',{...movement('outbound',2),expectedVersion:other.version})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);assert.equal((await clients[0].warehouseItem(other.id)).quantity,0);assert.equal((await clients[0].warehouseHistory(other.id)).total,2);
});
test('target version, product, source binding and source eligibility prevent mixed or stale transfers',async()=>{
 const api=clients[0],s=await sample(transferred.sampleId),r=await api.warehouseItem(source.id);
 const wrongSource=await stock();await assert.rejects(api.warehouseToSamples(wrongSource.id,value(existing(s)),wrongSource.version),e=>e.status===409);
 assert.ok(!(await api.warehouseSampleTargets(wrongSource.id)).rows.some(t=>t.id===s.id));assert.ok((await api.warehouseSampleTargets(r.id)).rows.some(t=>t.id===s.id));
 await assert.rejects(api.warehouseToSamples(r.id,value({...existing(s),expectedVersion:s.version-1}),r.version),e=>e.status===409);
 const unlinked=await api.sampleWrite('register',undefined,{requestKey:randomUUID(),name:'无关联产品',productId:null,warehouseLocation:'架',keeperMemberId:null,notes:''});await assert.rejects(api.warehouseToSamples(r.id,value(existing(await sample(unlinked.id))),r.version),e=>e.status===409);
 for(const item of [await stock({},null),await stock({unit:'箱'}),await stock({kind:'packaging',productId:null})]){const v=value(newTarget()),before=await snapshot(item.id,v.requestKey);await assert.rejects(api.warehouseToSamples(item.id,v,item.version),e=>e.status===409);assert.deepEqual(await snapshot(item.id,v.requestKey),before);}
 await assert.rejects(api.warehouseToSamples(r.id,value(newTarget(),r.quantity+1),r.version),e=>e.status===409);
});
test('late sample overflow rolls back the earlier source debit, binding, journal and receipt',async()=>{
 const api=clients[0],r=await stock(),created=await api.sampleWrite('register',undefined,{requestKey:randomUUID(),name:'容量样品',productId:product.id,warehouseLocation:'容量架',keeperMemberId:null,notes:''});let s=await sample(created.id);
 await api.sampleWrite('stock',s.id,{requestKey:randomUUID(),quantity:2147483647,note:''},s.version);s=await sample(s.id);const v=value(existing(s)),before=await snapshot(r.id,v.requestKey);
 await assert.rejects(api.warehouseToSamples(r.id,v,r.version),e=>e.status===409);assert.deepEqual(await snapshot(r.id,v.requestKey),before);
});
test('disabled sources and targets reject changes without leaving partial transfer facts',async()=>{
 const api=clients[0],r=await stock(),made=await api.sampleWrite('register',undefined,{requestKey:randomUUID(),name:'停用样品',productId:product.id,warehouseLocation:'架',keeperMemberId:null,notes:''});
 await db.client`UPDATE studio_os.shooting_samples SET active=false WHERE id=${made.id}`;const s=await sample(made.id),v=value(existing(s)),before=await snapshot(r.id,v.requestKey);
 await assert.rejects(api.warehouseToSamples(r.id,v,r.version),e=>e.status===409);assert.deepEqual(await snapshot(r.id,v.requestKey),before);assert.ok(!(await api.warehouseSampleTargets(r.id)).rows.some(t=>t.id===s.id));
 await db.client`UPDATE studio_os.warehouse_items SET active=false WHERE id=${r.id}`;const other=value(newTarget()),disabled=await snapshot(r.id,other.requestKey);await assert.rejects(api.warehouseToSamples(r.id,other,r.version),e=>e.status===409);assert.deepEqual(await snapshot(r.id,other.requestKey),disabled);
});
test('target choices and both linked histories remain complete beyond the first fifty records',async()=>{
 const api=clients[0],r=await stock({},60);
 for(let i=0;i<52;i++)await api.sampleWrite('register',undefined,{requestKey:randomUUID(),name:'分页转样 '+i,productId:product.id,warehouseLocation:'分页架',keeperMemberId:null,notes:''});
 const first=await api.warehouseSampleTargets(r.id,{q:'分页转样'}),second=await api.warehouseSampleTargets(r.id,{q:'分页转样',offset:50});assert.equal(first.total,52);assert.equal(first.rows.length,50);assert.equal(second.rows.length,2);assert.equal(new Set([...first.rows,...second.rows].map(s=>s.id)).size,52);
 const target=first.rows[0].id;
 for(let i=0;i<51;i++){const row=await api.warehouseItem(r.id),s=await sample(target);await api.warehouseToSamples(r.id,value(existing(s)),row.version);}
 const a=await api.warehouseTransfers(r.id),b=await api.warehouseTransfers(r.id,50),c=await api.warehouseTransfers(target,50,true);assert.equal(a.total,51);assert.equal(a.rows.length,50);assert.equal(b.rows.length,1);assert.deepEqual(b,c);assert.equal(new Set([...a.rows,...b.rows].map(t=>t.id)).size,51);
 const old=b.rows[0].targetSnapshot.name;await db.client`UPDATE studio_os.shooting_samples SET name='改名后的样品' WHERE id=${target}`;assert.equal((await api.warehouseTransfers(target,50,true)).rows[0].targetSnapshot.name,old);
});
test('failure after new sample registration rolls back both original stores and provenance',async()=>{
 const api=clients[0],r=await stock(),v=value(newTarget('故障注入样品')),before=await snapshot(r.id,v.requestKey);
 await db.client.unsafe("CREATE FUNCTION studio_os.test_reject_transfer_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='stock-in' THEN RAISE EXCEPTION 'injected transfer failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_transfer_event BEFORE INSERT ON studio_os.shooting_sample_events FOR EACH ROW EXECUTE FUNCTION studio_os.test_reject_transfer_event()");
 try{await assert.rejects(api.warehouseToSamples(r.id,v,r.version),e=>e.status===500);assert.deepEqual(await snapshot(r.id,v.requestKey),before);}finally{await db.client.unsafe('DROP TRIGGER test_reject_transfer_event ON studio_os.shooting_sample_events; DROP FUNCTION studio_os.test_reject_transfer_event()');}
});
test('historical names survive metadata changes and linked transfers cannot be rewritten or corrected on one side',async()=>{
 const api=clients[0],before=(await api.warehouseTransfers(source.id)).rows;let r=await api.warehouseItem(source.id);const {itemCode,kind,productId,specification,unit,location,notes,active}=r;
 await api.warehouseWrite('edit',r.id,{requestKey:randomUUID(),itemCode,kind,productId,specification,unit,location,notes,active,name:'新库存名称'},r.version);assert.deepEqual((await api.warehouseTransfers(source.id)).rows,before);
 for(const table of ['warehouse_sample_links','warehouse_sample_transfers'])for(const verb of ['UPDATE','DELETE'])await assert.rejects(db.client.unsafe(verb==='UPDATE'?`UPDATE studio_os.${table} SET item_id=item_id`:`DELETE FROM studio_os.${table}`),e=>e.code==='23514');
 r=await api.warehouseItem(source.id);await assert.rejects(api.warehouseWrite('move',r.id,{...movement('stocktake',r.quantity),correctsMovementId:transferred.movementId},r.version),e=>e.status===409);
});
test('transfer routes enforce admin, CSRF, confirmed units and exact nested payloads',async()=>{
 const r=await clients[0].warehouseItem(source.id),v={...value(newTarget()),expectedVersion:r.version},path='/warehouse/items/'+r.id;
 for(const route of [path+'/sample-targets',path+'/transfers','/samples/catalog/'+transferred.sampleId+'/transfers'])assert.equal((await request(sessions[1],route)).status,403);
 assert.equal((await request(sessions[1],path+'/to-samples','POST',v)).status,403);assert.equal((await request(sessions[0],path+'/to-samples','POST',v,false)).status,403);
 for(const changes of [{confirmed:false},{quantity:0},{quantity:1.5},{target:{...v.target,quantity:100}},{target:{mode:'existing',sampleId:transferred.sampleId}}])assert.equal((await request(sessions[0],path+'/to-samples','POST',{...v,...changes})).status,400);
 assert.equal((await clients[0].warehouseItem(r.id)).quantity,r.quantity);
});
