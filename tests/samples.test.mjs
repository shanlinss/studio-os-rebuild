import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {samplePayload,samplePage,sampleState,sampleOperationPath} from '../dist/sample-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
test('sample quantities, locations, versions and association fields cannot be erased or changed to fractional stock',()=>{
 const value={requestKey:randomUUID(),quantity:2,location:'拍摄台',shootingRequestId:randomUUID(),note:''};
 assert.equal(samplePayload('borrow',value).quantity,2);
 for(const quantity of [0,-1,1.5,2147483648,'2'])assert.throws(()=>samplePayload('borrow',{...value,quantity}),ContractError);
 assert.throws(()=>samplePayload('borrow',{...value,location:''}),ContractError);
 assert.throws(()=>samplePayload('borrow',{...value,ownerId:randomUUID()}),ContractError);
 assert.throws(()=>samplePayload('return',{requestKey:value.requestKey,quantity:1,note:''},0),ContractError);
 assert.equal(sampleOperationPath('return',value.shootingRequestId),'/api/samples/loans/'+value.shootingRequestId+'/return');
});
test('sample pages preserve server pagination and reject contradictory returned stock',()=>{
 const row={id:randomUUID(),sample_id:randomUUID(),owner_id:randomUUID(),sampleName:'样品',quantity:3,returned_quantity:1,version:2,location:'工作室'};
 const page={rows:[row],offset:50,total:51,limit:50};assert.equal(samplePage(page,true).offset,50);
 assert.throws(()=>samplePage({...page,rows:[{...row,returned_quantity:4}]},true),ContractError);
 assert.throws(()=>samplePage({...page,rows:[row,row]},true),ContractError);
 assert.throws(()=>sampleState({member:null,canBorrow:'yes',shooting:[]}),ContractError);
});
test('sample writes stay disabled in read-only previews, including stock and returns',async()=>{
 let writes=0;const api=createCloudApi(async()=>{writes++;throw Error('must not send');});
 await assert.rejects(api.sampleWrite('stock',randomUUID(),{requestKey:randomUUID(),quantity:1,note:''},1),e=>e.status===405);
 await assert.rejects(api.sampleWrite('borrow',randomUUID(),{requestKey:randomUUID(),quantity:1,location:'工作台',shootingRequestId:null,note:''}),e=>e.status===405);assert.equal(writes,0);
});
test('an uncertain borrow blocks repeat submission until the original durable receipt is checked',async()=>{
 const sample=randomUUID(),loan=randomUUID(),key=randomUUID();let attempts=0,receipt=false;
 const api=createCloudApi(async(path,options)=>{
  if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'local',role:'employee'},csrfToken:'a'.repeat(64)});
  if(path==='/api/samples/receipts/'+key)return receipt?Response.json({id:loan}):new Response('{}',{status:404});
  assert.equal(options.method,'POST');attempts++;throw Error('response lost after sending');
 },{allowWrites:true});
 await api.session();const value={requestKey:key,quantity:1,location:'拍摄台',shootingRequestId:null,note:''};
 await assert.rejects(api.sampleWrite('borrow',sample,value),e=>e.uncertain===true);
 await assert.rejects(api.sampleWrite('borrow',sample,value),e=>e.status===409);assert.equal(attempts,1);
 receipt=true;assert.deepEqual(await api.sampleReceipt(key,'borrow',sample),{id:loan});assert.equal(attempts,1);
});
