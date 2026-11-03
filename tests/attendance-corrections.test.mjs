import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {attendancePayload,correctionTimestamp,beijingCorrectionInput,attendanceDetail} from '../dist/attendance-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID();
test('Beijing correction input preserves seconds and milliseconds, rejecting invalid dates and times',()=>{
 const stamp='2020-01-02T01:02:03.456Z';assert.equal(beijingCorrectionInput(stamp),'2020-01-02T09:02:03.456');assert.equal(correctionTimestamp(beijingCorrectionInput(stamp)),stamp);assert.equal(correctionTimestamp('2020-01-02T09:02'),'2020-01-02T01:02:00.000Z');
 for(const bad of ['2020-02-31T09:00','2020-01-02T25:00','2020-01-02T09:61','2020-01-02T09:00Z'])assert.throws(()=>correctionTimestamp(bad),ContractError);
});
test('request payload separates missing starts, linked corrections, edits and explicit review reasons',()=>{
 const value={requestKey:key,periodId:null,direction:'in',proposedAt:'2020-01-02T01:00:00Z',reason:'补卡'};assert.equal(attendancePayload('create',value).periodId,null);
 for(const changes of [{direction:'out'},{ownerId:id},{reason:' '},{proposedAt:'2020-01-02T09:00'}])assert.throws(()=>attendancePayload('create',{...value,...changes}),ContractError);
 assert.equal(attendancePayload('edit',{requestKey:key,proposedAt:value.proposedAt,reason:value.reason},2).expectedVersion,2);
 assert.throws(()=>attendancePayload('decision',{requestKey:key,decision:'rejected',note:''},1),ContractError);
});
test('approved missing-start detail retains a null prior source version rather than inventing one',()=>{
 const period={id,kind:'studio',work_date:'2020-01-02',version:1,original_in:null,original_out:null,adjusted_in:'2020-01-02T01:00:00Z',adjusted_out:null},record={id:randomUUID(),status:'approved',direction:'in',version:2,proposed_at:period.adjusted_in,reason:'漏登记',review_note:'已核实',period_id:id,period_version:null};assert.equal(attendanceDetail({record,period,serverNow:'2026-11-03T01:00:00Z'},true).record.period_version,null);
 assert.throws(()=>attendanceDetail({record:{...record,status:'pending'},period,serverNow:'2026-11-03T01:00:00Z'},true),ContractError);
});
test('uncertain requests recover from the same actor receipt and readonly previews never submit reviews',async()=>{
 let writes=0;const api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'employee',role:'employee'},csrfToken:'a'.repeat(64)});if(path==='/api/attendance/receipts/'+key)return Response.json({id});writes++;throw Error('response lost');},{allowWrites:true});await api.session();const v={requestKey:key,periodId:null,direction:'in',proposedAt:'2020-01-02T01:00:00Z',reason:'补卡'};await assert.rejects(api.attendanceWrite('create',undefined,v),e=>e.uncertain);await assert.rejects(api.attendanceWrite('create',undefined,v),e=>e.status===409);assert.deepEqual(await api.attendanceReceipt(key,'create'),{id});assert.equal(writes,1);
 const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.attendanceWrite('decision',id,{requestKey:key,decision:'approved',note:'核实'},1),e=>e.status===405);
});
