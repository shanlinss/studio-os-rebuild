import test from 'node:test';
import assert from 'node:assert/strict';
import {monthReview,scopeState,scopePayload,scopeResult} from '../dist/finance-month-review-contract.mjs';
import {createFinanceMonthViews,reviewSourceLink} from '../dist/finance-month-review-view.mjs';
import {createFinanceMonthEditors} from '../dist/finance-month-review-editors.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',month='2026-01',date='2026-02-01T00:00:00Z';
const scope={month,record:null,stores:[{id,name:'原店铺',active:false,registeredDate:'2026-01-01'}],history:{rows:[],total:0,offset:0,limit:50}};
const report={month,mode:'recorded-sources-review',checkedAt:date,scope:null,rows:[],total:0,offset:0,limit:50,section:'all',severity:'all',counts:{blocker:0,review:0,sections:{period:0,scope:0,income:0,costs:0,assets:0,cash:0,advances:0}},recordedSourcesReady:true};
const body={requestKey:id,month,expectedVersion:0,storeIds:[id],reason:'本月实际经营范围'};
test('monthly review contracts preserve signed exact cash differences and do not turn readiness into closing',()=>{
 const r={...report,rows:[{section:'cash',kind:'income-cash',id,label:'已录资金对应差额',severity:'review',amountCents:'-9007199254740993'}],total:1,counts:{...report.counts,review:1,sections:{...report.counts.sections,cash:1}}};assert.equal(monthReview(r,month),r);
 for(const bad of [{...r,month:'2026-02'},{...r,counts:{...r.counts,blocker:1}},{...r,rows:[{...r.rows[0],amountCents:100}]},{...r,rows:[{...r.rows[0],kind:'script'}]},{...r,section:'assets'}])assert.throws(()=>monthReview(bad,month));
 assert.throws(()=>monthReview({...report,recordedSourcesReady:false},month));assert.equal('canClose' in report,false);
});
test('scope contracts accept explicit empty scope and require strict versioned data and unique stores',()=>{
 assert.equal(scopeState(scope,month),scope);assert.deepEqual(scopePayload({...body,storeIds:[]}).storeIds,[]);assert.equal(scopeResult({month,recordId:id,version:1},month).version,1);
 for(const bad of [{...body,storeIds:[id,id]},{...body,expectedVersion:2147483647},{...body,reason:' '},{...body,month:'2026-13'},{...body,amount:'0'}])assert.throws(()=>scopePayload(bad));
 assert.throws(()=>scopeState({...scope,stores:[...scope.stores,...scope.stores]},month));assert.throws(()=>scopeState({...scope,record:{id,version:0}},month));assert.throws(()=>scopeResult({month,recordId:id,version:0},month));
});
test('review renders source routes, separates actual cash and cumulative reimbursements, and keeps permissions on edits',async()=>{
 const original=globalThis.document;globalThis.document={addEventListener(){}};let html='';
 try{for(const writable of [true,false]){const views=createFinanceMonthViews({api:{financeMonthReview:async()=>({...report,counts:{...report.counts,blocker:1,sections:{...report.counts.sections,scope:1,period:0,income:0,costs:0,assets:0,cash:0,advances:0}},recordedSourcesReady:false})},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),writable,notify(){},localTime:String});await views.detail(month);assert.match(html,/经营依据尚未齐全/);assert.match(html,/不是所选月末余额/);assert.match(html,/不代表已完成银行对账或月结/);assert.equal(html.includes('data-finance-scope-edit'),writable);}}
 finally{globalThis.document=original;}
 for(const [kind,attr]of Object.entries({inventory:'data-inventory-cost',stock:'data-cost-sku','product-opening':'data-product-opening','product-purchase':'data-product-purchase','sample-cost':'data-sample-cost',cash:'data-cash-detail',scope:'data-finance-scope-view',income:'data-income-history'}))assert.match(reviewSourceLink({kind,id:kind==='scope'?month:id},month,String),new RegExp(attr));
 assert.equal(reviewSourceLink({kind:'packaging',id},month,String,false),'');assert.match(reviewSourceLink({kind:'advances',id},month,String),/#settlements/);
});
test('scope editor preserves explicit selections, permits zero shops, and sends current version with private recovery',async()=>{
 let send,after,recover,sent,html;const api={financeMonthScope:async()=>({...scope,record:{version:3,stores:[{id}]}}),saveFinanceMonthScope:async v=>{sent=v;return v;},financeScopeReceipt:async(key,m)=>({key,m})};const editors=createFinanceMonthEditors({api,h:String,area:()=>'',mount:(_title,body,s,a,r)=>{html=body;send=s;after=a;recover=r;}});await editors.financeMonthScope(month);assert.match(html,/checked/);assert.match(html,/当前已停用/);assert.match(html,/不会自动新增店铺或分摊公共费用/);await send({getAll:()=>[],get:()=>body.reason});assert.equal(sent.expectedVersion,3);assert.deepEqual(sent.storeIds,[]);assert.deepEqual(after,{kind:'finance-month-scope',month});assert.equal((await recover()).m,month);
});
test('monthly reads use declared routes, reject malformed response and keep read-only mutations blocked',async()=>{
 const seen=[],api=createCloudApi(async(path)=>{seen.push(path);return new Response(JSON.stringify(path.includes('month-review')?report:scope),{status:200,headers:{'Content-Type':'application/json'}});});assert.equal((await api.financeMonthReview({month})).month,month);assert.equal((await api.financeMonthScope(month)).month,month);assert.match(seen[0],/^\/api\/finance\/month-review\?/);assert.match(seen[1],/^\/api\/finance\/month-scope\?/);const count=seen.length;await assert.rejects(api.saveFinanceMonthScope(body),e=>e.status===405);assert.equal(seen.length,count);
 const bad=createCloudApi(async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));await assert.rejects(bad.financeMonthReview({month}));
});
