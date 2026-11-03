import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dailyAttendanceState,endWorkPayload,endWorkResult} from '../dist/daily-attendance.mjs';
import {navigationForRole} from '../dist/page-access.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),state={today:'2026-11-03',serverNow:'2026-11-03T04:00:00Z',status:'working',issue:null,period:{id,workDate:'2026-11-03',version:1,inAt:'2026-11-03T02:00:00Z',outAt:null},late:false,insufficient:null,durationMinutes:120};
test('daily attendance contracts preserve missing checkout and reject contradictory or incomplete facts',()=>{
 assert.equal(dailyAttendanceState(state).period.outAt,null);assert.equal(dailyAttendanceState({...state,status:'finished',insufficient:true,period:{...state.period,outAt:state.serverNow}}).status,'finished');
 for(const changes of [{period:null},{today:'2026-02-31'},{status:'finished'},{status:'working',insufficient:true},{durationMinutes:-1},{late:null},{period:{...state.period,workDate:'2026-11-02'}}])assert.throws(()=>dailyAttendanceState({...state,...changes}),ContractError);
 assert.equal(dailyAttendanceState({...state,status:'needs-review',issue:'previous-open',period:null,durationMinutes:null,late:null}).issue,'previous-open');
 assert.equal(endWorkPayload(key,id,1).expectedVersion,1);assert.throws(()=>endWorkPayload(key,id,0),ContractError);assert.throws(()=>endWorkResult({id:randomUUID(),workDate:state.today,outAt:state.serverNow},id),ContractError);
});
test('employee attendance and personal profile live under own workspace without entering management centers',()=>{
 const groups=navigationForRole('employee'),workspace=groups.find(([name])=>name==='我的工作台')[1];assert.ok(workspace.some(([id])=>id==='attendance'));assert.ok(workspace.some(([id])=>id==='profile'));assert.ok(!groups.some(([name])=>['人员中心','系统设置'].includes(name)));
});
test('uncertain checkout blocks duplicate writes until the original daily state is reconciled',async()=>{
 let writes=0;const api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'employee',role:'employee'},csrfToken:'a'.repeat(64)});if(path==='/api/attendance/daily')return Response.json(state);writes++;throw Error('lost checkout response');},{allowWrites:true});await api.session();await assert.rejects(api.endWork(key,id,1),e=>e.uncertain);await assert.rejects(api.endWork(key,id,1),e=>e.status===409);assert.equal(writes,1);await api.dailyAttendance();await assert.rejects(api.endWork(key,id,1),e=>e.uncertain);assert.equal(writes,2);
 let sent=0;const readonly=createCloudApi(async()=>{sent++;throw Error('unreachable');});await assert.rejects(readonly.endWork(key,id,1),e=>e.status===405);assert.equal(sent,0);
});
