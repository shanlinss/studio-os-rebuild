import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {closurePayload,closureState,closureDetail} from '../dist/closure-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),body={requestKey:key,month:'2020-01',memberId:id,action:'lock',expectedLatestId:null,expectedSourceHash:'a'.repeat(64),note:'核定整月事实',dayNotes:[{date:'2020-01-01',note:'已核对特殊安排'}]};
test('month confirmation requires explicit source, latest version and daily notes without salary inputs',()=>{
 assert.equal(closurePayload(body).action,'lock');for(const change of [{expectedSourceHash:'bad'},{expectedLatestId:'bad'},{month:'2020-13'},{note:' '},{dayNotes:[...body.dayNotes,...body.dayNotes]},{dayNotes:[{date:'2020-02-01',note:'跨月'}]},{salary:100},{action:'finalize-payroll'}])assert.throws(()=>closurePayload({...body,...change}),ContractError);assert.equal(closurePayload({...body,action:'reopen',dayNotes:[]}).action,'reopen');assert.throws(()=>closurePayload({...body,action:'reopen'}),ContractError);
});
test('confirmation state rejects contradictory lock state and unsupported blockers',()=>{
 const current={month:'2020-01',today:'2020-02-01',serverNow:'2020-02-01T00:00:00Z',roster:[],member:null,days:[],summary:null},s={current,status:'unlocked',latest:null,drift:false,blockers:['no-member'],requiredDates:[]};assert.equal(closureState(s).status,'unlocked');assert.throws(()=>closureState({...s,status:'locked'}),ContractError);assert.throws(()=>closureState({...s,drift:true}),ContractError);assert.throws(()=>closureState({...s,blockers:['auto-deduct']}),ContractError);
});
test('reopened versions preserve previous identity and cannot masquerade as a frozen snapshot',()=>{
 const row={id,member_id:id,owner_id:id,month:'2020-01',revision:2,previous_id:randomUUID(),action:'reopen',source_hash:'a'.repeat(64),snapshot:null,day_notes:[],note:'重新核对',actor_name:'管理员',created_at:'2020-02-01T00:00:00Z'};assert.equal(closureDetail(row).action,'reopen');assert.throws(()=>closureDetail({...row,snapshot:{}}),ContractError);assert.throws(()=>closureDetail({...row,action:'lock'}),ContractError);
});
test('uncertain confirmation submissions recover via private receipts and readonly previews never send locks',async()=>{
 let writes=0;const result={id,revision:1},api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'admin',role:'admin'},csrfToken:'a'.repeat(64)});if(path==='/api/attendance/month-closure-receipts/'+key)return Response.json(result);writes++;throw Error('lost response');},{allowWrites:true});await api.session();await assert.rejects(api.closureSave(body),e=>e.uncertain);await assert.rejects(api.closureSave(body),e=>e.status===409);assert.deepEqual(await api.closureReceipt(key),result);assert.equal(writes,1);const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.closureSave(body),e=>e.status===405);
});
