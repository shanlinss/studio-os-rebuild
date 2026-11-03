import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountLifecyclePayload,accountLifecycleResult} from '../dist/account-lifecycle-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),value={requestKey:key,username:'employee_01',role:'employee',password:'test-only-password-123',memberId:null,memberVersion:null,reason:'开通账号'};
test('account creation accepts explicit member versions, preserves password spaces and rejects secret injection or invalid identities',()=>{
 assert.equal(accountLifecyclePayload({...value,password:'  long password  '}).password,'  long password  ');
 assert.equal(accountLifecyclePayload({...value,memberId:id,memberVersion:2}).memberVersion,2);
 for(const changes of [{password:'short'},{username:'Employee'},{username:'中文'},{role:'superadmin'},{memberId:id,memberVersion:null},{memberId:null,memberVersion:1},{password_hash:'secret'},{reason:' '}])assert.throws(()=>accountLifecyclePayload({...value,...changes}),ContractError);
 const reset={requestKey:key,password:value.password,reason:'重置'};assert.equal(accountLifecyclePayload(reset,4).expectedVersion,4);assert.throws(()=>accountLifecyclePayload({...reset,role:'admin'},4),ContractError);
});
test('credential receipts validate operation and target and cannot return password fields',()=>{
 const row={id,username:'employee_01',version:2,action:'password-reset',memberId:null};assert.deepEqual(accountLifecycleResult(row,'password-reset',id),row);
 for(const changes of [{action:'created'},{id:randomUUID()},{password:'bad'},{password_hash:'bad'}])assert.throws(()=>accountLifecycleResult({...row,...changes},'password-reset',id),ContractError);
});
test('uncertain credential saves require durable owner receipt and readonly clients send no credential mutations',async()=>{
 let writes=0;const result={id,username:'employee_01',version:1,action:'created',memberId:null};
 const api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'admin',role:'admin'},csrfToken:'a'.repeat(64)});if(path==='/api/admin/account-operations/'+key)return Response.json(result);writes++;throw Error('lost response');},{allowWrites:true});await api.session();
 await assert.rejects(api.accountLifecycle(undefined,value),e=>e.uncertain);await assert.rejects(api.accountLifecycle(undefined,value),e=>e.status===409);assert.equal(writes,1);assert.deepEqual(await api.accountOperation(key,'created'),result);assert.equal(writes,1);
 let sent=0;const readonly=createCloudApi(async()=>{sent++;throw Error('unreachable');});await assert.rejects(readonly.accountLifecycle(undefined,value),e=>e.status===405);assert.equal(sent,0);
});
