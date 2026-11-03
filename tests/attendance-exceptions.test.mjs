import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {exceptionPayload,exceptionDetail,exceptionPage} from '../dist/exception-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),value={requestKey:key,expectedPeriodVersion:1,expectedReviewId:null,kind:'late',outcome:'special',note:'已核实特殊安排，保留原始时间'};
test('review payload requires a source version, latest review identity and explicit note without payroll or clock edits',()=>{
 assert.equal(exceptionPayload(value).outcome,'special');for(const patch of [{expectedPeriodVersion:0},{expectedReviewId:'bad'},{note:' '},{kind:'absent'},{outcome:'waive-pay'},{salaryDeduction:100},{original_in:'2020-01-01T01:00:00Z'}])assert.throws(()=>exceptionPayload({...value,...patch}),ContractError);
});
test('special interpretation remains separate from both original abnormal flags',()=>{
 const p={id,kind:'studio',work_date:'2020-01-01',version:1,original_in:'2020-01-01T02:31:00Z',original_out:'2020-01-01T10:00:00Z',adjusted_in:null,adjusted_out:null};const latest={id:randomUUID(),kind:'late',outcome:'special',note:'特殊情况',actor_name:'管理员',created_at:'2020-01-02T01:00:00Z',period_version:1,revision:1,source_snapshot:p};const d={period:p,eligible:true,issue:null,metrics:{late:true,insufficient:true,durationMinutes:449},rows:[{kind:'late',flag:true,reviewStatus:'special',latest},{kind:'insufficient',flag:true,reviewStatus:'pending',latest:null}]};assert.equal(exceptionDetail(d).rows[0].flag,true);assert.equal(exceptionDetail({...d,eligible:false,issue:'incomplete',metrics:null}).eligible,false);
 assert.throws(()=>exceptionDetail({...d,rows:[d.rows[0],d.rows[0]]}),ContractError);assert.throws(()=>exceptionDetail({...d,metrics:null}),ContractError);
});
test('queue keeps two independent kinds for one source and preserves the source version',()=>{
 const row={id:id+':late',periodId:id,periodVersion:2,workDate:'2020-01-01',kind:'late',reviewStatus:'stale',effectiveIn:'2020-01-01T02:31:00Z',effectiveOut:'2020-01-01T10:00:00Z',durationMinutes:449,reviewId:randomUUID()};const v={rows:[row,{...row,id:id+':insufficient',kind:'insufficient'}],total:2,offset:0,limit:50};assert.equal(exceptionPage(v).total,2);assert.throws(()=>exceptionPage({...v,rows:[row,row]}),ContractError);
});
test('uncertain review writes recover by actor receipt and readonly clients never send an interpretation',async()=>{
 let writes=0;const result={id,reviewId:randomUUID()},api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'admin',role:'admin'},csrfToken:'a'.repeat(64)});if(path==='/api/attendance/exception-receipts/'+key)return Response.json(result);writes++;throw Error('lost');},{allowWrites:true});await api.session();await assert.rejects(api.exceptionReview(id,value),e=>e.uncertain);await assert.rejects(api.exceptionReview(id,value),e=>e.status===409);assert.deepEqual(await api.exceptionReceipt(key,id),result);assert.equal(writes,1);
 const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.exceptionReview(id,value),e=>e.status===405);
});
