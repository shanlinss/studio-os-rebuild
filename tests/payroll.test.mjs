import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hasSensitive,permissionPayload} from '../dist/admin-permissions.mjs';
import {payrollCents,payrollPayload,draftRecord} from '../dist/payroll-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),value={requestKey:key,memberId:id,month:'2020-01',expectedLatestId:null,salaryId:randomUUID(),closureId:randomUUID(),baseCents:500000,bonusCents:12345,allowanceCents:10000,adjustmentCents:-100,note:'人工确认本月金额',confirmReviewed:true};
test('payroll is an independent explicit permission with no legacy administrator fallback',()=>{
 assert.equal(hasSensitive({role:'admin'},'payroll'),false);assert.equal(hasSensitive({role:'admin',permissions:['finance']},'payroll'),false);assert.equal(hasSensitive({role:'admin',permissions:['payroll']},'payroll'),true);assert.equal(hasSensitive({role:'employee',permissions:['payroll']},'payroll'),false);assert.deepEqual(permissionPayload({permissions:['payroll'],superadmin:false,reason:'岗位分工'},1).permissions,['payroll']);
});
test('manual money inputs preserve exact cents and reject implicit rounding, exponential forms and negative unsigned amounts',()=>{
 assert.equal(payrollCents('123.45'),12345);assert.equal(payrollCents('-1.01',true),-101);assert.equal(payrollCents('0'),0);for(const v of ['','1.001','1e3','1,000','-1','Infinity','10000000000.01'])assert.throws(()=>payrollCents(v),ContractError);assert.equal(payrollPayload(value).adjustmentCents,-100);for(const patch of [{confirmReviewed:false},{baseCents:0.5},{bonusCents:-1},{adjustmentCents:-1e12},{taxRate:0.1},{note:' '}])assert.throws(()=>payrollPayload({...value,...patch}),ContractError);
});
test('draft contracts verify addition without calculating deductions from attendance counts',()=>{
 const r={id,member_id:id,month:'2020-01',revision:1,salary_id:value.salaryId,closure_id:value.closureId,base_cents:500000,bonus_cents:12345,allowance_cents:10000,adjustment_cents:-100,total_cents:522245,note:'逐项确认',created_at:'2020-02-01T00:00:00Z'};assert.equal(draftRecord(r).total_cents,522245);assert.throws(()=>draftRecord({...r,total_cents:500000}),ContractError);assert.throws(()=>draftRecord({...r,bonus_cents:'12345'}),ContractError);
});
test('uncertain salary drafts use own receipts and readonly clients cannot submit either money operation',async()=>{
 let writes=0;const result={id,revision:1},api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'payroll',role:'admin',permissions:['payroll']},csrfToken:'a'.repeat(64)});if(path==='/api/payroll/receipts/'+key)return Response.json(result);writes++;throw Error('lost response');},{allowWrites:true});assert.deepEqual((await api.session()).permissions,['payroll']);await assert.rejects(api.payrollSave(value),e=>e.uncertain);await assert.rejects(api.payrollSave(value),e=>e.status===409);assert.deepEqual(await api.payrollReceipt(key),result);assert.equal(writes,1);const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.payrollSave(value),e=>e.status===405);await assert.rejects(readonly.payrollSave({requestKey:key,memberId:id,effectiveMonth:'2020-01',expectedLatestId:null,amountCents:0,note:'明确为零'},true),e=>e.status===405);
});
