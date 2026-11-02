import test from 'node:test';
import assert from 'node:assert/strict';
import {financeRecord,outstandingAdvance,money,visibleExecutionSummary} from '../dist/management-model.mjs';
import {ContractError} from '../dist/cloud-contract.mjs';
const data={categories:[],stores:[],members:[],records:[{id:'sep',expenseDate:'2026-09-15',paymentMode:'advance',amountCents:30000,settlementId:'s'},{id:'oct',expenseDate:'2026-10-15',paymentMode:'advance',amountCents:20000,settlementId:'s'},{id:'unassigned',expenseDate:'2026-10-20',paymentMode:'advance',amountCents:7000,settlementId:null},{id:'company',paymentMode:'company',amountCents:9000}],settlements:[{id:'s',totalCents:'50000',paidCents:'40000',items:[]}],payments:[{id:'p',amountCents:40000}]};
test('cross-month outstanding includes only unassigned advances and unpaid settlement balance',()=>{
 const value=outstandingAdvance(data);assert.deepEqual(value,{unassigned:'7000',inStatements:'10000',total:'17000'});assert.equal(money(value.total),'¥170.00');assert.equal(data.settlements[0].remainingCents,undefined);
});
test('large aggregated monetary values keep exact cents rather than losing precision',()=>{
 assert.equal(money('9007199254740993123'),'¥90071992547409931.23');assert.equal(money(1),'¥0.01');assert.equal(money(0),'¥0.00');
});
test('overpaid or negative records are not silently clamped to zero',()=>{
 assert.throws(()=>financeRecord({...data,settlements:[{totalCents:'100',paidCents:'101'}]}),ContractError);assert.throws(()=>money(-1),ContractError);assert.throws(()=>money(0.1),ContractError);
});
test('operating summary excludes shooting and actions; missing counters remain unknown',()=>{
 const s=visibleExecutionSummary([{kind:'publication',publishedCount:0,filledCount:0,targetCount:2},{kind:'shooting',publishedCount:100,filledCount:100,targetCount:100}]);assert.deepEqual(s,{taskCount:1,published:'0',filled:'0',target:'2'});assert.equal(visibleExecutionSummary([{kind:'publication'}]).published,null);
});
