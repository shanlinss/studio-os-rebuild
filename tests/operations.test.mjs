import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nextRoundPayload,directoryPayload,expensePayload,settlementPayload,paymentPayload,decimalAmount} from '../dist/write-contract.mjs';
import {ContractError} from '../dist/cloud-contract.mjs';
test('next rounds require adjustment and keep unassigned work separate from dispatch',()=>{
 const value={requestKey:randomUUID(),title:'第二轮',materialIds:[randomUUID()],lab:{adjustment:'只改标题',testVariable:'标题',executionConditions:'保持产品',plannedPublishOn:null}};
 assert.deepEqual(nextRoundPayload(value,2).assignments,[]);assert.equal(nextRoundPayload(value,2).expectedVersion,2);assert.throws(()=>nextRoundPayload({...value,lab:{...value.lab,adjustment:''}},2),ContractError);
});
test('basic directory payload cannot overwrite login identity or silently erase existing account facts',()=>{
 const row={displayName:'成员',jobTitle:'运营',startDate:null,employmentStatus:'在职',active:true};assert.equal(directoryPayload('member',row,2).active,true);assert.throws(()=>directoryPayload('member',{...row,loginAccountId:randomUUID()},2),ContractError);assert.throws(()=>directoryPayload('account',{name:'部分资料'},2),ContractError);
});
test('financial decimal amounts stay exact and mixed or duplicate settlement inputs are rejected',()=>{
 assert.equal(decimalAmount('12.34'),'12.34');for(const v of ['0','1.001','1e2','21474836.48',12.34])assert.throws(()=>decimalAmount(v),ContractError);
 const value={expenseDate:'2026-11-02',description:'支出',amount:'12.34',paymentMode:'advance',payerId:null,storeId:null,categoryId:null,note:'',requestKey:randomUUID()};assert.throws(()=>expensePayload(value),ContractError);
 const item={expenseId:randomUUID(),expectedVersion:1};assert.throws(()=>settlementPayload({payerId:randomUUID(),startDate:'2026-11-01',endDate:'2026-11-30',items:[item,item],note:'',requestKey:randomUUID()}),ContractError);
 assert.throws(()=>paymentPayload({settlementId:randomUUID(),amount:'1.00',paidDate:'2026-02-30',note:'',requestKey:randomUUID()},1),ContractError);
});

test('account access changes only accept explicit roles, boolean state and an original version',async()=>{
 const {accountAccessPayload}=await import('../dist/write-contract.mjs');
 assert.deepEqual(accountAccessPayload({role:'employee',active:false},2),{role:'employee',active:false,expectedVersion:2});
 for(const value of [{role:'owner',active:true},{role:'admin',active:'false'},{role:'employee',active:true,password:'blocked'}])assert.throws(()=>accountAccessPayload(value,2),ContractError);
 assert.throws(()=>accountAccessPayload({role:'employee',active:true},0),ContractError);
});
