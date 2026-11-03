import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validMonth,calendarPayload,calendarMonth,monthlyResult} from '../dist/monthly-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),value={requestKey:key,expectedVersion:0,mode:'rest',note:'统一安排休息'};
test('calendar accepts explicit default, work and rest with versions and a reason, never payroll configuration',()=>{
 assert.equal(calendarPayload(value).expectedVersion,0);assert.equal(calendarPayload({...value,mode:'default'}).mode,'default');for(const patch of [{mode:'holiday-auto'},{expectedVersion:-1},{expectedVersion:undefined},{note:' '},{deduction:100}])assert.throws(()=>calendarPayload({...value,...patch}),ContractError);for(const m of ['2020-13','2020-2','0000-01','2200-01','2020-02-01'])assert.throws(()=>validMonth(m),ContractError);assert.equal(validMonth('2020-02'),'2020-02');
});
test('calendar contract requires actual dates and unique days rather than partial or duplicate month data',()=>{
 const days=Array.from({length:29},(_,i)=>({date:'2020-02-'+String(i+1).padStart(2,'0'),workday:true,mode:'default',note:'',version:0}));assert.equal(calendarMonth({month:'2020-02',days}).days.length,29);assert.throws(()=>calendarMonth({month:'2020-02',days:[...days.slice(1),days[1]]}),ContractError);assert.throws(()=>calendarMonth({month:'2020-02',days:[...days.slice(1),{...days[0],date:'2020-02-30'}]}),ContractError);assert.throws(()=>monthlyResult({month:'2020-02',today:'2020-02-01',serverNow:'2020-02-01T00:00:00Z',roster:[],member:null,days:[],summary:{}}),ContractError);
});
test('calendar uncertain writes recover from own durable receipts and remain disabled in readonly previews',async()=>{
 let writes=0;const result={date:'2020-01-01',version:1},api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'admin',role:'admin'},csrfToken:'a'.repeat(64)});if(path==='/api/attendance/calendar-receipts/'+key)return Response.json(result);writes++;throw Error('lost response');},{allowWrites:true});await api.session();await assert.rejects(api.calendarSave(result.date,value),e=>e.uncertain);await assert.rejects(api.calendarSave(result.date,value),e=>e.status===409);assert.deepEqual(await api.calendarReceipt(key,result.date),result);assert.equal(writes,1);const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.calendarSave(result.date,value),e=>e.status===405);
});
test('monthly API sends only explicit month and selected member without scope or payroll guesses',async()=>{
 const seen=[],api=createCloudApi(async path=>{seen.push(path);return Response.json({month:'2020-02',today:'2020-02-01',serverNow:'2020-02-01T00:00:00Z',roster:[],member:null,days:[],summary:null});});await api.monthlyAttendance('2020-02',id);assert.equal(seen[0],'/api/attendance/monthly?month=2020-02&memberId='+id);await assert.rejects(api.monthlyAttendance('2020-99'),ContractError);assert.equal(seen.length,1);
});
