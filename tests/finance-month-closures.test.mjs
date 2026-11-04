import test from 'node:test';
import assert from 'node:assert/strict';
import {closingState,closingRecord,closingPayload} from '../dist/finance-month-closures-contract.mjs';
import {createFinanceClosingEditors} from '../dist/finance-month-closures-editors.mjs';
import {createFinanceClosingViews} from '../dist/finance-month-closures-view.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
import {createMutationGateway} from '../dist/mutation-gateway.mjs';
const id='11111111-1111-4111-8111-111111111111',month='2026-01',date='2026-02-01T00:00:00Z',digest='a'.repeat(64);
const overview={month,mode:'recorded-sources',rows:[],stores:[],publicCents:'0',inventoryCents:'0',prepaidCents:'0',publicPending:[],publicPendingCount:0,summary:{storeCount:0,incomeCents:null,directCostCents:null,storeProfitCents:null,studioProfitCents:null}};
const snapshot={schemaVersion:1,month,overview,scope:{stores:[]},issues:[],counts:{blocker:0,review:0},inventory:[],sampleSources:[],expenseIds:[],cash:[],reimbursements:[],sources:{expenses:[]},checkedAt:date};
const candidate={snapshot,sourceHash:digest,ready:true},record={id,month,version:1,action:'lock',previousId:null,sourceHash:digest,snapshot,coverageConfirmed:true,reviewConfirmed:true,reason:'按月确认完整来源',actor:'原财务',createdAt:date};
const state={month,record:null,candidate,history:{rows:[],total:0,offset:0,limit:50}},body={requestKey:id,month,expectedVersion:0,action:'lock',sourceHash:digest,coverageConfirmed:true,reviewConfirmed:true,reason:'核对月度来源'};
test('closing contracts distinguish locked snapshot and open candidate while requiring explicit coverage and review acknowledgements',()=>{
 assert.equal(closingState(state,month),state);assert.equal(closingRecord(record),record);assert.equal(closingState({...state,record,candidate:null},month).candidate,null);assert.equal(closingPayload(body).sourceHash,digest);
 for(const bad of [{...body,coverageConfirmed:false},{...body,reviewConfirmed:false},{...body,amount:'0.00'},{...body,sourceHash:'a'},{...body,expectedVersion:2147483647}])assert.throws(()=>closingPayload(bad));
 assert.throws(()=>closingState({...state,record},month));assert.throws(()=>closingRecord({...record,snapshot:{...snapshot,counts:{blocker:1,review:0}}}));assert.throws(()=>closingState({...state,candidate:{...candidate,ready:false}},month));assert.throws(()=>closingRecord({...record,previousId:'bad'}));
});
test('closing editor rereads the source hash, sends manual confirmations and recovers a private receipt',async()=>{
 let submit,after,recover,html,sent;const api={financeClosing:async()=>state,saveFinanceClosing:async v=>{sent=v;return v;},financeClosingReceipt:async(key,m)=>({key,month:m})};const editors=createFinanceClosingEditors({api,h:String,mount:(_title,body,s,a,r)=>{html=body;submit=s;after=a;recover=r;},area:()=>''});await editors.financeClosing(month);assert.match(html,/没有遗漏应录来源/);assert.match(html,/不代表银行余额/);await submit({get:key=>key==='reason'?'实际已核对':'on'});assert.equal(sent.sourceHash,digest);assert.equal(sent.coverageConfirmed,true);assert.equal(after.kind,'finance-closing');assert.equal((await recover()).month,month);
 api.financeClosing=async()=>({...state,record,candidate:null});await editors.financeClosing(month);assert.match(html,/原锁定快照及开放原因保留/);await submit({get:()=> '重新核对'});assert.equal(sent.action,'reopen');assert.equal(sent.expectedVersion,1);assert.equal(sent.coverageConfirmed,false);
 api.financeClosing=async()=>({...state,candidate:{...candidate,ready:false}});await assert.rejects(editors.financeClosing(month));
});
test('closing views retain exact historic results and separate permissions, reopen history and original cash warnings',async()=>{
 const original=globalThis.document;globalThis.document={addEventListener(){}};let html='';try{for(const writable of [true,false]){const view=createFinanceClosingViews({api:{financeClosing:async()=>({...state,record,candidate:null,history:{...state.history,rows:[record],total:1}}),financeClosingRecord:async()=>record},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),writable,notify(){},localTime:String});await view.state(month);assert.match(html,/本月已锁定/);assert.match(html,/不是所选|不作为银行余额或所选月末/);assert.equal(html.includes('data-finance-closing-edit'),writable);await view.detail(id);assert.match(html,/重新开放不改写原快照/);assert.match(html,/尚无完整利润依据/);}}finally{globalThis.document=original;}
});
test('closing API routes validate historic identity and protect read-only previews from writes',async()=>{
 const seen=[],api=createCloudApi(async path=>{seen.push(path);return new Response(JSON.stringify(path.includes('/'+id)?record:state),{headers:{'Content-Type':'application/json'}});});await api.financeClosing(month);await api.financeClosingRecord(id);assert.match(seen[0],/^\/api\/finance\/month-closures\?month=2026-01/);assert.equal(seen[1],'/api/finance/month-closures/'+id);const count=seen.length;await assert.rejects(api.saveFinanceClosing(body),e=>e.status===405);assert.equal(seen.length,count);
 const bad=createCloudApi(async()=>new Response(JSON.stringify({...record,id:'22222222-2222-4222-8222-222222222222'}),{headers:{'Content-Type':'application/json'}}));await assert.rejects(bad.financeClosingRecord(id));
});
test('locked source conflicts give an actionable reopen message without exposing database exceptions',async()=>{
 const gate=createMutationGateway(async()=>new Response(JSON.stringify({reason:'finance_month_locked',message:'private SQL text'}),{status:409,headers:{'Content-Type':'application/json'}}),{enabled:true});gate.acceptSession({csrfToken:'a'.repeat(64)});await assert.rejects(gate.send('/api/finance/expenses','POST',{}),e=>e.status===409&&e.message.includes('重新开放相关月份')&&!e.message.includes('SQL'));
});
