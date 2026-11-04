import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {PhoneCards} from '../../.build/server/phone-cards.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,auth,app,base,card,device,account,store,identityKey,seq=0;const people=[],sessions=[],clients=[];
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:'studio_session='+sessions[i].token,'Content-Type':'application/json',...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function login(i){sessions[i]=await auth.login(people[i].username,people[i].password,'phone-card-'+randomUUID());const s=sessions[i],api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients[i]=api;}
const body=(extra={})=>({requestKey:randomUUID(),cardCode:'CARD-'+(++seq),phoneNumber:'139'+String(seq).padStart(8,'0'),carrier:'测试运营商',status:'spare',userMemberId:null,deviceId:null,storeId:null,accountIds:[],planDescription:'流量与通话说明',planExpiresOn:null,notes:'资源维护说明',reason:'核对实卡后登记',...extra});
const dto=r=>({requestKey:randomUUID(),cardCode:r.cardCode,phoneNumber:r.phoneNumber,carrier:r.carrier,status:r.status,userMemberId:r.userMemberId,deviceId:r.deviceId,storeId:r.storeId,accountIds:r.accounts.map(a=>a.id),planDescription:r.planDescription,planExpiresOn:r.planExpiresOn,notes:r.notes,reason:'核对本次变更'});
const state=()=>clients[0].phoneCard(card.id);
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);
 for(const [role,superadmin,permissions]of [['admin',true,[]],['admin',false,['resources']],['admin',false,['resources','resource_identity']],['admin',false,['finance']],['admin',false,['resource_identity']],['employee',false,[]],['admin',false,['resources']]]){
  const username='card_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [a]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin,admin_permissions) VALUES(${username},${await hashPassword(password)},${role},${superadmin},${db.client.array(permissions)}::text[]) RETURNING id`;const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${username},${a.id}) RETURNING id`;people.push({...a,username,password,memberId:m.id});
 }
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(let i=0;i<people.length;i++)await login(i);
 device=await clients[0].equipmentWrite('register',undefined,{requestKey:randomUUID(),assetTag:'CARD-DEVICE',name:'原工作手机',model:'M',keeperMemberId:null,location:'工作室',notes:''});store=await clients[0].saveDirectory('store',undefined,{name:'原店铺'});account=await clients[0].saveDirectory('account',undefined,{name:'原运营账号',profileUrl:'https://example.com/account',responsibleMemberId:people[1].memberId,boundPhone:'13811111111',actualPhone:'13822222222',remark:'旧字段保持'});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('resources manage original referenced phone cards; finance, identity-only and employees have no implicit directory access',async()=>{
 for(const i of [3,4,5]){assert.equal((await req(i,'/phone-cards')).status,403);assert.equal((await req(i,'/phone-cards/options')).status,403);assert.equal((await req(i,'/phone-cards','POST',body())).status,403);}assert.deepEqual((await clients[1].session()).permissions,['resources']);assert.equal((await clients[1].phoneCards()).total,0);
 const value=body({userMemberId:people[5].memberId,deviceId:device.id,storeId:store.id,accountIds:[account.id],planExpiresOn:'2027-01-01'});card=await clients[1].savePhoneCard(undefined,value);assert.deepEqual(await clients[1].savePhoneCard(undefined,value),card);assert.deepEqual(await clients[1].phoneCardReceipt(value.requestKey),card);
 const r=await state();assert.equal(r.userMemberId,people[5].memberId);assert.equal(r.deviceId,device.id);assert.equal(r.storeId,store.id);assert.equal(r.accounts[0].id,account.id);assert.equal(r.version,1);assert.equal((await clients[0].phoneCardIdentity(card.id)).total,0);await checkReadiness(db);
});
test('link filters and candidate projections reuse existing IDs without changing account phones, owners or equipment use',async()=>{
 for(const filter of [{deviceId:device.id},{accountId:account.id},{storeId:store.id}])assert.equal((await clients[1].phoneCards(filter)).rows[0].id,card.id);assert.equal((await clients[1].phoneCards({q:'原工作手机'})).total,1);assert.equal((await clients[1].phoneCards({q:'原运营账号'})).total,1);
 const a=(await clients[0].businessAccounts()).find(a=>a.id===account.id);assert.equal(a.boundPhone,'13811111111');assert.equal(a.actualPhone,'13822222222');assert.equal(a.responsibleMemberId,people[1].memberId);assert.equal((await clients[0].equipmentDetail(device.id)).version,1);assert.equal((await clients[0].equipmentHandoverState(device.id)).currentLoan,null);
 const options=await clients[1].phoneCardOptions();assert.ok(options.members.every(m=>Object.keys(m).sort().join(',')==='active,id,name'));assert.ok(options.devices.some(d=>d.id===device.id));assert.ok(!JSON.stringify(options).includes('password'));assert.equal((await clients[1].phoneCardHistory(card.id)).rows[0].afterValue.accounts[0].id,account.id);
});
test('real-name entities may be external and require both explicit identity and resource authority',async()=>{
 for(const i of [1,3,4,5,6]){assert.equal((await req(i,'/phone-cards/'+card.id+'/identity')).status,403);assert.equal((await req(i,'/phone-cards/'+card.id+'/identity','POST',{requestKey:randomUUID(),expectedVersion:0,expectedCardVersion:1,registeredEntity:'外部主体',reason:'核对登记主体'})).status,403);}
 const master=await state();identityKey=randomUUID();const value={requestKey:identityKey,expectedVersion:0,expectedCardVersion:master.version,registeredEntity:'EXTERNAL-PRIVATE-REALNAME-外部公司',reason:'独立核对实名主体，与使用人不同'};const result=await clients[2].savePhoneCardIdentity(card.id,value);assert.equal(result.version,1);assert.deepEqual(await clients[2].phoneCardReceipt(identityKey,card.id,'identity'),result);assert.deepEqual(await clients[2].savePhoneCardIdentity(card.id,value),result);assert.deepEqual(await state(),master);assert.equal((await clients[2].phoneCardIdentity(card.id)).rows[0].registeredEntity,value.registeredEntity);
});
test('normal card reads, options, queries, master audit and unrelated receipts never project identity versions or real names',async()=>{
 for(const read of [()=>clients[1].phoneCards(),()=>clients[1].phoneCard(card.id),()=>clients[1].phoneCardHistory(card.id),()=>clients[1].phoneCardOptions()]){const json=JSON.stringify(await read());for(const needle of ['EXTERNAL-PRIVATE-REALNAME','registeredEntity','registered_entity','password_hash'])assert.ok(!json.includes(needle));}
 assert.equal((await clients[1].phoneCards({q:'EXTERNAL-PRIVATE-REALNAME'})).total,0);assert.equal(await clients[1].phoneCardReceipt(identityKey,card.id,'identity'),null);
 const raw=await db.client`SELECT before_value,after_value FROM studio_os.phone_card_events WHERE card_id=${card.id}`;assert.ok(!JSON.stringify(raw).includes('EXTERNAL-PRIVATE-REALNAME'));
});
test('code and active normalized numbers are unique while retired numbers may be reused without deleting the old card',async()=>{
 const r=await state();await assert.rejects(clients[1].savePhoneCard(undefined,body({cardCode:r.cardCode.toLowerCase()})),e=>e.status===409);await assert.rejects(clients[1].savePhoneCard(undefined,body({phoneNumber:r.phoneNumber.slice(0,3)+' '+r.phoneNumber.slice(3)})),e=>e.status===409);
 await assert.rejects(clients[1].savePhoneCard(card.id,{...dto(r),cardCode:'NEW-CODE'},r.version),e=>e.status===409);await assert.rejects(db.client`UPDATE studio_os.phone_cards SET card_code='NEW-CODE' WHERE id=${card.id}`,e=>e.code==='23514');
 await clients[1].savePhoneCard(card.id,{...dto(r),status:'retired'},r.version);const replacement=await clients[1].savePhoneCard(undefined,body({phoneNumber:r.phoneNumber}));let old=await state();await assert.rejects(clients[1].savePhoneCard(card.id,{...dto(old),status:'spare'},old.version),e=>e.status===409);const newer=await clients[1].phoneCard(replacement.id);await clients[1].savePhoneCard(replacement.id,{...dto(newer),status:'retired'},newer.version);old=await state();await clients[1].savePhoneCard(card.id,{...dto(old),status:'active'},old.version);
});
test('changing references records original before and after names and never silently reassigns the platform account owner',async()=>{
 const r=await state();await clients[1].savePhoneCard(card.id,{...dto(r),userMemberId:people[6].memberId,notes:'换使用人，实名保持原值'},r.version);const h=await clients[1].phoneCardHistory(card.id);assert.equal(h.rows[0].beforeValue.userName,people[5].username);assert.equal(h.rows[0].afterValue.userName,people[6].username);const frozen=h.rows[0];await db.client`UPDATE studio_os.members SET display_name='新显示姓名' WHERE id=${people[6].memberId}`;assert.deepEqual((await clients[1].phoneCardHistory(card.id)).rows[0],frozen);assert.equal((await clients[0].businessAccounts()).find(a=>a.id===account.id).responsibleMemberId,people[1].memberId);assert.equal((await clients[2].phoneCardIdentity(card.id)).rows[0].version,1);
});
test('account profiles reuse equipment and store records with exclusive primary assignments and protected history',async()=>{
 const path='/admin/business-accounts', profile={platform:'小红书',platformAccountId:'studio-01',avatarUrl:'https://example.com/avatar',purpose:'内容测试',storeId:store.id,primaryDeviceId:device.id,extraDeviceIds:[]};
 const current=(await clients[1].businessAccounts()).find(a=>a.id===account.id);
 const saved=await req(1,path+'/'+account.id,'PATCH',{...profile,expectedVersion:current.version});
 assert.equal(saved.status,200);
 const other={name:'另一账号',responsibleMemberId:people[1].memberId};
 assert.equal((await req(1,path,'POST',{...other,...profile})).status,409);
 assert.equal((await req(1,path,'POST',{...other,primaryDeviceId:device.id,extraDeviceIds:[device.id]})).status,400);
 assert.equal((await req(1,path,'POST',{...other,extraDeviceIds:[device.id]})).status,201);
 assert.equal((await req(1,path+'/'+account.id,'PATCH',{remark:'兼容旧表单',expectedVersion:current.version+1})).status,200);
 const updated=(await clients[1].businessAccounts()).find(a=>a.id===account.id);
 assert.equal(updated.primaryDeviceId,device.id);
 assert.equal(updated.storeName,'原店铺');
 assert.equal(updated.platformAccountId,'studio-01');
 const limited=(await clients[3].businessAccounts()).find(a=>a.id===account.id);
 assert.equal(limited.primaryDeviceId,null);
 assert.equal(limited.platformAccountId,null);
 assert.equal((await req(3,path+'/'+account.id+'/history')).status,403);
 const history=await clients[1].businessAccountHistory(account.id);
 assert.equal(history[0].afterValue.primaryDeviceId,device.id);
 assert.equal(history[1].beforeValue.primaryDeviceId,null);
});

test('inactive original references are retained when unchanged, removable and never newly linked after removal',async()=>{
 await db.client`UPDATE studio_os.equipment_assets SET status='retired' WHERE id=${device.id}`;await db.client`UPDATE studio_os.business_accounts SET active=false WHERE id=${account.id}`;await db.client`UPDATE studio_os.stores SET active=false WHERE id=${store.id}`;await db.client`UPDATE studio_os.members SET active=false WHERE id=${people[6].memberId}`;
 let r=await state();await clients[1].savePhoneCard(card.id,{...dto(r),notes:'保留历史关联'},r.version);r=await state();await clients[1].savePhoneCard(card.id,{...dto(r),userMemberId:null,deviceId:null,storeId:null,accountIds:[]},r.version);r=await state();
 for(const patch of [{deviceId:device.id},{accountIds:[account.id]},{storeId:store.id},{userMemberId:people[6].memberId}])await assert.rejects(clients[1].savePhoneCard(card.id,{...dto(r),...patch},r.version),e=>e.status===409);const options=await clients[1].phoneCardOptions();assert.ok(options.accounts.some(a=>a.id===account.id&&!a.active));
});
test('concurrent metadata and independent identity version edits cannot overwrite another editor',async()=>{
 let r=await state();const race=await Promise.allSettled([clients[1].savePhoneCard(card.id,{...dto(r),carrier:'运营商A'},r.version),clients[0].savePhoneCard(card.id,{...dto(r),carrier:'运营商B'},r.version)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
 r=await state();const pi=await Promise.allSettled([clients[2].savePhoneCardIdentity(card.id,{requestKey:randomUUID(),expectedVersion:1,expectedCardVersion:r.version,registeredEntity:'新外部实名A',reason:'核对更新'}),clients[0].savePhoneCardIdentity(card.id,{requestKey:randomUUID(),expectedVersion:1,expectedCardVersion:r.version,registeredEntity:'新外部实名B',reason:'核对更新'})]);assert.equal(pi.filter(r=>r.status==='fulfilled').length,1);assert.equal(pi.find(r=>r.status==='rejected').reason.status,409);assert.equal((await state()).version,r.version);await clients[1].savePhoneCard(card.id,{...dto(r),notes:'档案变更后实名需重新核对'},r.version);await assert.rejects(clients[2].savePhoneCardIdentity(card.id,{requestKey:randomUUID(),expectedVersion:2,expectedCardVersion:r.version,registeredEntity:'不能基于旧卡片保存',reason:'旧号码上下文'}),e=>e.status===409);assert.equal((await clients[2].phoneCardIdentity(card.id)).rows[0].version,2);
});
test('invalid metadata, duplicate references, identity injection, dates and absent CSRF fail without changing facts',async()=>{
 const r=await state(),v={...dto(r),expectedVersion:r.version},path='/phone-cards/'+card.id;
 for(const patch of [{phoneNumber:'abc'},{status:'unknown'},{accountIds:[account.id,account.id]},{planExpiresOn:'2026-02-30'},{registeredEntity:'不能放普通字段'},{reason:''},{expectedVersion:0},{userMemberId:'*'}])assert.equal((await req(1,path,'PATCH',{...v,...patch})).status,400);
 assert.equal((await req(1,path,'PATCH',v,false)).status,403);assert.equal((await req(2,path+'/identity','POST',{requestKey:randomUUID(),expectedVersion:2,expectedCardVersion:r.version,registeredEntity:'资料',reason:'核对'},false)).status,403);await assert.rejects(clients[1].savePhoneCard(card.id,{...dto(r),deviceId:randomUUID()},r.version),e=>e.status===409);assert.deepEqual(await state(),r);
});
test('audit and receipt persistence failures roll back metadata, links, identity versions and private recovery receipts',async()=>{
 for(const table of ['phone_card_events','phone_card_receipts','phone_card_identities']){
  const r=await state(),identity=await clients[2].phoneCardIdentity(card.id),privateWrite=table==='phone_card_identities',key=randomUUID();
  await db.client.unsafe(`CREATE FUNCTION studio_os.reject_phone_card() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected card write failure'; END $$; CREATE TRIGGER reject_phone_card BEFORE INSERT ON studio_os.${table} FOR EACH ROW EXECUTE FUNCTION studio_os.reject_phone_card()`);
  try{await assert.rejects(privateWrite?clients[2].savePhoneCardIdentity(card.id,{requestKey:key,expectedVersion:identity.rows[0].version,expectedCardVersion:r.version,registeredEntity:null,reason:'核对清空'}):clients[1].savePhoneCard(card.id,{...dto(r),requestKey:key,carrier:'失败不会覆盖'},r.version),e=>e.status===500);assert.equal(await clients[privateWrite?2:1].phoneCardReceipt(key,card.id,privateWrite?'identity':'profile'),null);assert.deepEqual(await state(),r);assert.deepEqual(await clients[2].phoneCardIdentity(card.id),identity);}finally{await db.client.unsafe(`DROP TRIGGER reject_phone_card ON studio_os.${table}; DROP FUNCTION studio_os.reject_phone_card()`);}
 }
});
test('card catalog and both immutable histories paginate beyond fifty records with no projected real-name data',async()=>{
 for(let n=0;n<55;n++)await clients[1].savePhoneCard(undefined,body({cardCode:'PAGE-'+n}));const a=await clients[1].phoneCards({q:'PAGE-'}),b=await clients[1].phoneCards({q:'PAGE-',offset:50});assert.equal(a.total,55);assert.equal(a.rows.length,50);assert.equal(b.rows.length,5);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,55);
 let r=await state(),p=(await clients[2].phoneCardIdentity(card.id)).rows[0].version;for(let n=0;n<51;n++){await clients[1].savePhoneCard(card.id,{...dto(r),notes:'变更记录 '+n},r.version);r=await state();await clients[2].savePhoneCardIdentity(card.id,{requestKey:randomUUID(),expectedVersion:p++,expectedCardVersion:r.version,registeredEntity:n%2?'外部主体历史':null,reason:'明确核对实名版本'});}
 for(const reader of [offset=>clients[1].phoneCardHistory(card.id,offset),offset=>clients[2].phoneCardIdentity(card.id,offset)]){const a=await reader(0),b=await reader(50);assert.equal(a.rows.length,50);assert.ok(b.rows.length>0);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,a.total);}
 for(const table of ['phone_card_events','phone_card_identities','phone_card_receipts'])for(const action of ['UPDATE','DELETE'])await assert.rejects(db.client.unsafe(action==='UPDATE'?`UPDATE studio_os.${table} SET created_at=created_at`:`DELETE FROM studio_os.${table}`),e=>e.code==='23514');await checkReadiness(db);
});
test('identity grants are explicit and revoked service identities cannot read private history or receipts while ordinary resource work remains',async()=>{
 const old=sessions[2].user,row=(await clients[0].loginAccounts()).find(a=>a.id===people[2].id);await clients[0].updateAccountPermissions(row.id,{superadmin:false,permissions:['resources'],reason:'撤销实名资料授权'},row.version);assert.equal((await req(2,'/phone-cards')).status,401);await login(2);assert.equal((await clients[2].phoneCard(card.id)).id,card.id);const service=new PhoneCards(db);
 for(const read of [()=>service.identity(old,card.id,{}),()=>service.receipt(old,identityKey),()=>service.saveIdentity(old,card.id,{requestKey:randomUUID(),expectedVersion:0,expectedCardVersion:1,registeredEntity:null,reason:'旧授权不可用'})])await assert.rejects(read(),e=>e.status===403);
 const fake={...sessions[3].user,role:'admin',superadmin:true,permissions:['resources','resource_identity']};await assert.rejects(service.save(fake,body()),e=>e.status===403);assert.equal((await req(2,'/phone-cards/'+card.id+'/identity')).status,403);assert.equal((await req(2,'/finance')).status,403);
});
