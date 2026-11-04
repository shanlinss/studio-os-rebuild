import test from 'node:test';
import assert from 'node:assert/strict';
import {monthIncomePayload,overviewRecord} from '../dist/operating-overview-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',body={requestKey:id,expectedVersion:0,month:'2026-01',amount:'0.00',sourceReference:'月度收入表',reason:'已扣客户退款未扣成本',status:'confirmed'};
test('monthly income accepts explicit zero or negative net income and requires an identified period and source',()=>{
 assert.equal(monthIncomePayload(body).amount,'0.00');assert.equal(monthIncomePayload({...body,amount:'-1.23'}).amount,'-1.23');
 for(const changed of [{amount:null},{amount:'1.001'},{amount:'-21474836.48'},{sourceReference:''},{month:'2026-13'},{status:'draft'},{expectedVersion:-1}])assert.throws(()=>monthIncomePayload({...body,...changed}));
});
test('overview keeps missing values null and preserves signed aggregate cents without numeric precision loss',()=>{
 const v={month:'2026-01',mode:'recorded-sources',rows:[],stores:[],publicCents:'2000000',inventoryCents:'0',prepaidCents:'0',publicPending:[],publicPendingCount:0,summary:{storeCount:0,incomeCents:null,directCostCents:null,storeProfitCents:null,studioProfitCents:null}};assert.equal(overviewRecord(v,'2026-01'),v);assert.throws(()=>overviewRecord({...v,publicCents:2000000},'2026-01'));assert.throws(()=>overviewRecord({...v,summary:{...v.summary,storeCount:1}},'2026-01'));
});
test('read-only clients cannot confirm monthly income',async()=>{let calls=0;const api=createCloudApi(async()=>{calls++;throw Error('unexpected');});await assert.rejects(api.saveMonthIncome(id,body),e=>e.status===405);assert.equal(calls,0);});
test('overview displays public fees separately and protects unknown profits in the rendered result',async()=>{
 const {createOperatingOverviewViews}=await import('../dist/operating-overview-view.mjs'),original=globalThis.document;let html='';globalThis.document={addEventListener(){}};
 try{const view=createOperatingOverviewViews({api:{financeOverview:async()=>({rows:[],stores:[],publicCents:'2000000',inventoryCents:'0',prepaidCents:'0',publicPending:[],publicPendingCount:0,summary:{storeCount:0,incomeCents:null,storeProfitCents:null,studioProfitCents:null}})},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),writable:true,notify(){},localTime:String});await view.detail('2026-01');assert.match(html,/公共费用在工作室层面扣一次/);assert.match(html,/待核对/);assert.match(html,/尚未月结/);assert.match(html,/¥20000\.00/);}
 finally{globalThis.document=original;}
});
test('manual income editor asks for withdrawable platform net and explains separately paid product costs',async()=>{
 const {createOperatingOverviewEditors}=await import('../dist/operating-overview-editors.mjs');let html,label;const editor=createOperatingOverviewEditors({api:{monthIncome:async()=>({store:{name:'原店铺'},record:null})},h:String,input:(_name,l)=>{if(_name==='amount')label=l;return '';},area:()=>'',mount:(_t,body)=>{html=body;}});await editor.monthIncome('11111111-1111-4111-8111-111111111111','2026-11');assert.match(label,/平台可提现收入/);assert.match(html,/佣金、退款等平台已扣项目不再扣一次/);assert.match(html,/商品货款、一件代发成本及工作室其他费用另算/);assert.doesNotMatch(html,/尚未扣商品、代发、手续费/);
});
