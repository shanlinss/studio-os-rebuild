import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {leavePayload,leaveRecord,leavePath} from '../dist/leave-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),v={requestKey:key,leaveType:'家庭照护',startsAt:'2027-01-31T23:00:00+08:00',endsAt:'2027-02-01T10:00:00+08:00',reason:'实际安排'};
test('leave requests preserve custom types and explicit intervals without accepting identity, approval or salary fields',()=>{
 const out=leavePayload('create',v);assert.equal(out.leaveType,'家庭照护');assert.equal(out.startsAt,v.startsAt);assert.equal(out.endsAt,v.endsAt);assert.equal(leavePath('revoke',id),'/api/attendance/leaves/'+id+'/revoke');
 for(const patch of [{ownerId:id},{approved:true},{salaryDeduction:100},{leaveType:' '},{endsAt:v.startsAt},{startsAt:'2027-02-31T09:00:00+08:00'},{startsAt:'2027-01-31T23:00'}])assert.throws(()=>leavePayload('create',{...v,...patch}),ContractError);
 assert.equal(leavePayload('edit',v,2).expectedVersion,2);assert.throws(()=>leavePayload('decision',{requestKey:key,decision:'approved',note:' '},1),ContractError);
});
test('record contracts distinguish withdrawal and revocation from approval and reject invalid time order',()=>{
 const r={id,version:2,status:'revoked',leave_type:v.leaveType,reason:v.reason,starts_at:v.startsAt,ends_at:v.endsAt};assert.equal(leaveRecord(r).status,'revoked');assert.equal(leaveRecord({...r,status:'withdrawn'}).status,'withdrawn');assert.throws(()=>leaveRecord({...r,status:'cancelled'}),ContractError);assert.throws(()=>leaveRecord({...r,ends_at:r.starts_at}),ContractError);
});
test('lost leave saves reconcile from the same actor receipt, while readonly clients cannot submit reviews',async()=>{
 let writes=0;const api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'employee',role:'employee'},csrfToken:'a'.repeat(64)});if(path==='/api/attendance/leave-receipts/'+key)return Response.json({id});writes++;throw Error('lost response');},{allowWrites:true});await api.session();await assert.rejects(api.leaveWrite('create',undefined,v),e=>e.uncertain);await assert.rejects(api.leaveWrite('create',undefined,v),e=>e.status===409);assert.deepEqual(await api.leaveReceipt(key,'create'),{id});assert.equal(writes,1);
 const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.leaveWrite('decision',id,{requestKey:key,decision:'approved',note:'核实'},1),e=>e.status===405);
});
