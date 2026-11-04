import test from 'node:test';
import assert from 'node:assert/strict';
import {expenseOverview,advancesByPerson,attributionPayload,classification} from '../dist/expense-attribution-model.mjs';
import {expensePayload} from '../dist/write-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
const row=(amountCents,expenseScope,expenseUse,extra={})=>({amountCents,expenseScope,expenseUse,storeId:expenseScope==='store'?id:null,storeName:'甲店',...extra});
test('public costs are independent of shop count and inventory, prepayments and uncertain records never become operating costs',()=>{
 const rows=[row(20000,'public','operating'),row(10000,'store','operating'),row(3000,'public','inventory'),row(4000,'store','prepaid'),row(5000,'unclassified','operating'),row(6000,'public','unclassified')];
 const result=expenseOverview(rows);assert.equal(result.publicCents,'20000');assert.equal(result.directCents,'10000');assert.equal(result.inventoryCents,'3000');assert.equal(result.prepaidCents,'4000');assert.equal(result.pendingCents,'11000');assert.equal(result.pendingCount,2);assert.equal(result.stores.length,1);
 assert.equal(expenseOverview([...rows,row(1000,'store','operating',{storeId:'shop-b',storeName:'乙店'})]).publicCents,'20000');assert.equal(expenseOverview(rows.filter(r=>r.expenseScope!=='store')).publicCents,'20000');
 assert.equal(expenseOverview([{amountCents:100,storeId:null}]).pendingCents,'100');assert.equal(expenseOverview([{amountCents:100,storeId:id}]).pendingCents,'100');
});
test('person balances retain unassigned advances plus unpaid settlement amounts without counting paid reimbursements or costs twice',()=>{
 const data={categories:[],stores:[],members:[],records:[{id:'water',amountCents:30000,paymentMode:'advance',payerId:'lin',payerName:'小林',settlementId:'s'},{id:'boxes',amountCents:100000,paymentMode:'advance',payerId:'li',payerName:'小李',settlementId:null}],settlements:[{id:'s',payerId:'lin',payerName:'小林',totalCents:'30000',paidCents:'10000'}],payments:[{amountCents:10000}]};
 const people=advancesByPerson(data);assert.equal(people.find(p=>p.payerId==='lin').totalCents,'20000');assert.equal(people.find(p=>p.payerId==='li').totalCents,'100000');assert.equal(people.reduce((n,p)=>n+BigInt(p.totalCents),0n),120000n);
});
test('classification payload preserves legacy writes, validates store linkage and forbids monetary changes through attribution',()=>{
 const base={requestKey:id,expenseDate:'2026-11-01',description:'水电费',amount:'300',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:''};assert.equal(expensePayload(base).expenseScope,undefined);assert.equal(expensePayload({...base,expenseScope:'public',expenseUse:'operating'}).expenseScope,'public');
 assert.throws(()=>classification('public','operating',id));assert.throws(()=>classification('store','operating',null));
 const body={requestKey:id,expectedVersion:1,expenseScope:'public',expenseUse:'operating',storeId:null,reason:'核对水电费'};assert.equal(attributionPayload(body).expenseUse,'operating');assert.throws(()=>attributionPayload({...body,amount:'1'}));assert.throws(()=>attributionPayload({...body,reason:''}));
});
test('new ledger keeps reimbursements and everyday expense entry visible and tucks detailed costing away',async()=>{
 const {renderExpenseLedger}=await import('../dist/expense-attribution-view.mjs'),original=globalThis.document,elements=new Map();
 for(const name of ['#main','#finance-overview','#finance-body','#finance-month','#finance-mode','#finance-scope','#finance-query'])elements.set(name,{innerHTML:'',value:name==='#finance-mode'||name==='#finance-scope'?'all':''});
 globalThis.document={querySelector:s=>elements.get(s)};
 try{renderExpenseLedger({h:String,heading:(title,desc)=>title+desc,canMaintain:true,data:{categories:[],stores:[],members:[],records:[{...row(30000,'public','operating'),id,expenseDate:'2026-11-01',description:'水电费',paymentMode:'advance',payerId:'lin',payerName:'小林',settlementId:null}],settlements:[],payments:[]}});
 assert.match(elements.get('#main').innerHTML,/待报销 · 按人汇总/);assert.match(elements.get('#main').innerHTML,/小林/);assert.match(elements.get('#main').innerHTML,/<details[^>]*><summary>经营与成本明细/);assert.match(elements.get('#finance-overview').innerHTML,/公共运营费用/);assert.match(elements.get('#finance-overview').innerHTML,/¥300\.00/);
 }finally{globalThis.document=original;}
});
test('read-only clients never send expense attribution writes',async()=>{
 let sent=0;const api=createCloudApi(async()=>{sent++;throw Error('unexpected');});await assert.rejects(api.saveExpenseAttribution(id,{requestKey:id,expectedVersion:1,expenseScope:'public',expenseUse:'operating',storeId:null,reason:'核对'}),e=>e.status===405);assert.equal(sent,0);
});
