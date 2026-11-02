import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudApi,ApiError,ContractError} from '../dist/cloud-api.mjs';
import {snapshotPayload,productPayload,materialPayload,publicationPayload} from '../dist/write-contract.mjs';
const id='11111111-1111-4111-8111-111111111111',token='b'.repeat(64);
const session={user:{id,username:'fixture',role:'admin'},csrfToken:token};
const material={title:'Reference',sourceUrl:'https://example.com/reference',metadata:{tags:['封面'],notes:'Observation',scene:'Small space',expectedTestCount:3},storeIds:[]};
const response=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
test('read-only clients never send writes even after loading a valid session',async()=>{
 const calls=[];const api=createCloudApi(async(path)=>{calls.push(path);return response(session);});await api.session();await assert.rejects(api.createMaterial(material),e=>e instanceof ApiError&&e.status===405);assert.deepEqual(calls,['/api/session']);
});
test('connected writes require session CSRF, preserve metadata and send expectedVersion on updates',async()=>{
 const calls=[];const api=createCloudApi(async(path,options)=>{calls.push({path,options});return response(path==='/api/session'?session:{id,version:8});},{allowWrites:true});
 await assert.rejects(api.updateMaterial(id,material,7),e=>e.status===401);assert.equal(calls.length,0);
 const user=await api.session();assert.equal(user.csrfToken,undefined);await api.updateMaterial(id,material,7);
 const call=calls[1],payload=JSON.parse(call.options.body);assert.equal(call.options.method,'PATCH');assert.equal(call.options.headers['x-csrf-token'],token);assert.equal(call.options.redirect,'error');assert.equal(payload.expectedVersion,7);assert.equal(payload.metadata.scene,'Small space');assert.equal(payload.metadata.expectedTestCount,3);
});
test('a lost write response is not retried until the caller explicitly reads the records',async()=>{
 let writes=0;const api=createCloudApi(async(path,options)=>{if(path==='/api/session')return response(session);if(options.method==='GET')return response([]);writes++;throw new TypeError('fixture lost response');},{allowWrites:true});
 await api.session();await assert.rejects(api.createMaterial(material),e=>e.uncertain===true);await assert.rejects(api.createMaterial(material),e=>e.status===409);assert.equal(writes,1);await api.materials();await assert.rejects(api.createMaterial(material),e=>e.uncertain===true);assert.equal(writes,2);
});
test('server failures and version conflicts preserve the uncertainty/conflict distinction',async()=>{
 for(const status of [409,503]){let count=0;const api=createCloudApi(async(path)=>{if(path==='/api/session')return response(session);count++;return response({},status);},{allowWrites:true});await api.session();await assert.rejects(api.updateMaterial(id,material,7),e=>e.status===status&&(status===409||e.uncertain===true));assert.equal(count,1);}
});
test('duplicate concurrent submissions to the same record are blocked',async()=>{
 let release;const blocked=new Promise(resolve=>{release=resolve;});let writes=0;
 const api=createCloudApi(async(path)=>{if(path==='/api/session')return response(session);writes++;await blocked;return response({id},201);},{allowWrites:true});await api.session();const first=api.createMaterial(material);await assert.rejects(api.createMaterial(material),e=>e.status===409);release();await first;assert.equal(writes,1);
});
test('unknown metrics remain null, zero is retained, and contradictory conversion facts are rejected',()=>{
 const p=snapshotPayload({observedAt:'2026-11-02T10:00:00+08:00',views:0,conversions:0,hasConversion:false});assert.equal(p.views,0);assert.equal(p.likes,null);assert.equal(p.observedAt,'2026-11-02T02:00:00.000Z');
 assert.throws(()=>snapshotPayload({observedAt:'2026-11-02T10:00:00+08:00',conversions:0,hasConversion:true}),ContractError);assert.throws(()=>snapshotPayload({observedAt:'2026-11-02T10:00:00+08:00'}),ContractError);
});
test('unsupported fields, duplicate stages and invalid publication times fail before HTTP',()=>{
 assert.throws(()=>materialPayload({...material,archive:true}),ContractError);assert.throws(()=>productPayload({name:'Product',stages:['Prepare','Prepare']}),ContractError);assert.throws(()=>publicationPayload({url:'https://example.com/note',publishedAt:'2026-02-30T10:00:00+08:00'}),ContractError);assert.throws(()=>publicationPayload({url:'http://example.com/note',publishedAt:'2026-11-02T10:00:00'}),ContractError);
});

test('editing cannot silently erase metadata, notes or store links with a partial payload',()=>{assert.throws(()=>materialPayload({title:'Rename only'},2),ContractError);assert.throws(()=>productPayload({name:'Rename only'},2),ContractError);});

test('malformed refresh cannot clear an uncertain write and failed sessions revoke the token',async()=>{
 let mode='lost',writes=0;const api=createCloudApi(async(path,options)=>{
  if(path==='/api/session')return mode==='expired'?response({},401):response(session);
  if(options.method==='GET')return response({unexpected:[]});writes++;throw new TypeError('lost');
 },{allowWrites:true});await api.session();await assert.rejects(api.createMaterial(material),e=>e.uncertain);
 await assert.rejects(api.materials(),ContractError);await assert.rejects(api.createMaterial(material),e=>e.status===409);assert.equal(writes,1);
 mode='expired';await assert.rejects(api.session(),e=>e.status===401);await assert.rejects(api.updateMaterial(id,material,1),e=>e.status===401);assert.equal(writes,1);
});
test('metadata enums and timestamp shape match backend requirements before HTTP',()=>{
 for(const metadata of [{mediaType:'photo'},{rating:0},{expectedTestCount:21},{scene:4}])assert.throws(()=>materialPayload({...material,metadata}),ContractError);
 for(const publishedAt of ['2026-11-02Z','2026-11-02T24:00:00Z','2026-11-02T12:61:00Z'])assert.throws(()=>publicationPayload({url:'https://example.com/note',publishedAt}),ContractError);
});
