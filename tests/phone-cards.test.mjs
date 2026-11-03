import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {phoneCard,phoneCardPayload,phoneCardIdentityPayload,phoneCardIdentity,phoneCardResult} from '../dist/phone-cards-contract.mjs';
import {hasSensitive,permissionPayload} from '../dist/admin-permissions.mjs';
import {navigationForRole} from '../dist/page-access.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const a=randomUUID(),b=randomUUID(),c=randomUUID(),now=new Date().toISOString();
const payload=()=>({requestKey:randomUUID(),cardCode:'CARD',phoneNumber:'13900000000',carrier:'运营商',status:'spare',userMemberId:null,deviceId:null,storeId:null,accountIds:[],planDescription:'套餐内容',planExpiresOn:null,notes:'',reason:'核对实卡'});
const record=(id=a)=>({id,version:1,cardCode:'CARD',phoneNumber:'13900000000',carrier:'运营商',status:'spare',userMemberId:null,userName:null,deviceId:null,deviceName:null,deviceTag:null,storeId:null,storeName:null,accounts:[],planDescription:'套餐内容',planExpiresOn:null,notes:'',createdAt:now,updatedAt:now});
test('card metadata and private identity have separate strict payloads and normal projections never retain a real-name field',()=>{
 assert.equal(phoneCardPayload(payload()).status,'spare');for(const patch of [{registeredEntity:'不能混入档案'},{accountIds:[a,a]},{phoneNumber:'无效号码'},{planExpiresOn:'2026-02-30'},{status:'unknown'},{userMemberId:'*'},{reason:''}])assert.throws(()=>phoneCardPayload({...payload(),...patch},1),ContractError);
 const pi={requestKey:randomUUID(),expectedVersion:0,expectedCardVersion:1,registeredEntity:null,reason:'待确认'};assert.equal(phoneCardIdentityPayload(pi).registeredEntity,null);assert.throws(()=>phoneCardIdentityPayload({...pi,registeredEntity:''}),ContractError);assert.throws(()=>phoneCardIdentityPayload({...pi,userMemberId:a}),ContractError);assert.throws(()=>phoneCardIdentityPayload({...pi,expectedCardVersion:0}),ContractError);
 assert.ok(!Object.hasOwn(phoneCard({...record(),registeredEntity:'PRIVATE'},a),'registeredEntity'));assert.throws(()=>phoneCard(record(),b),ContractError);assert.throws(()=>phoneCardIdentity({rows:[{id:randomUUID(),cardId:b,version:1,registeredEntity:'外部主体',reason:'核对',actor:'admin',createdAt:now}],total:1,offset:0,limit:50},a),ContractError);
});
test('real-name access is explicit, independent of finance and administrator labels, and does not unlock resource navigation alone',async()=>{
 const user={id:a,username:'manager',role:'admin',superadmin:false,permissions:['resource_identity']};assert.equal(hasSensitive(user,'resource_identity'),true);assert.equal(hasSensitive({role:'admin'},'resource_identity'),false);assert.equal(hasSensitive({role:'employee',superadmin:true,permissions:['resource_identity']},'resource_identity'),false);assert.ok(!navigationForRole('admin',user).flatMap(([,rows])=>rows).some(([id])=>id==='assets'));assert.equal(hasSensitive(user,'finance'),false);
 assert.deepEqual(permissionPayload({permissions:['resource_identity','resources'],superadmin:false,reason:'明确授权'},1).permissions,['resource_identity','resources']);assert.deepEqual((await createCloudApi(async()=>Response.json({user})).session()).permissions,['resource_identity']);
});
test('receipt recovery validates actor action and target, resolving only the exact uncertain operation, including collection creates',async()=>{
 const keys={a:randomUUID(),identity:randomUUID(),b:randomUUID(),create:randomUUID(),wrong:randomUUID()},attempts=new Map();
 const fetcher=async(path,options)=>{
  if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'root',role:'admin',superadmin:true,permissions:[]},csrfToken:'a'.repeat(64)});
  if(path.startsWith('/api/phone-cards/receipts/')){const key=path.split('/').pop();return Response.json(key===keys.create?{id:c,version:1,action:'save:new'}:key===keys.a?{id:a,version:2,action:'save:'+a}:{id:a,version:1,action:'identity:'+a});}
  if(options?.method==='GET')return Response.json(record());
  attempts.set(path,(attempts.get(path)||0)+1);assert.equal(options.headers['x-csrf-token'],'a'.repeat(64));if(path==='/api/phone-cards/'+a&&attempts.get(path)>1)return Response.json({id:a,version:2});throw Error('response lost');
 };
 const api=createCloudApi(fetcher,{allowWrites:true});await api.session();const va={...payload(),requestKey:keys.a},vb={...payload(),requestKey:keys.b},vc={...payload(),requestKey:keys.create},pi={requestKey:keys.identity,expectedVersion:0,expectedCardVersion:1,registeredEntity:'外部公司',reason:'核对'};
 for(const write of [()=>api.savePhoneCard(a,va,1),()=>api.savePhoneCardIdentity(a,pi),()=>api.savePhoneCard(b,vb,1),()=>api.savePhoneCard(undefined,vc)])await assert.rejects(write(),e=>e.uncertain);
 await api.phoneCard(a);await assert.rejects(api.savePhoneCard(a,va,1),e=>e.status===409);await assert.rejects(api.phoneCardReceipt(keys.wrong,a),ContractError);
 assert.deepEqual(await api.phoneCardReceipt(keys.create),{id:c,version:1});for(const write of [()=>api.savePhoneCard(a,va,1),()=>api.savePhoneCardIdentity(a,pi),()=>api.savePhoneCard(b,vb,1)])await assert.rejects(write(),e=>e.status===409);
 assert.deepEqual(await api.phoneCardReceipt(keys.a,a),{id:a,version:2});await api.savePhoneCard(a,va,1);for(const write of [()=>api.savePhoneCardIdentity(a,pi),()=>api.savePhoneCard(b,vb,1)])await assert.rejects(write(),e=>e.status===409);assert.equal(attempts.get('/api/phone-cards/'+b),1);assert.equal(attempts.get('/api/phone-cards/'+a+'/identity'),1);assert.throws(()=>phoneCardResult({id:b,version:1,action:'save:'+a},a,'save:'+a),ContractError);
});
test('readonly clients send neither metadata nor real-name mutations',async()=>{
 let calls=0;const api=createCloudApi(async()=>{calls++;throw Error('must not send');});await assert.rejects(api.savePhoneCard(undefined,payload()),e=>e.status===405);await assert.rejects(api.savePhoneCardIdentity(a,{requestKey:randomUUID(),expectedVersion:0,expectedCardVersion:1,registeredEntity:null,reason:'核对'}),e=>e.status===405);assert.equal(calls,0);
});
