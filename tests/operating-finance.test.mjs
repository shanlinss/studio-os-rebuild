import test from 'node:test';
import assert from 'node:assert/strict';
import {operatingPayload,operatingVoid,operatingQuery,operatingPage,operatingDetail} from '../dist/operating-finance-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
const body=()=>({requestKey:id,kind:'sale',storeId:id,parentId:null,expenseId:null,sourceReference:'原订单或日汇总',businessDate:'2026-01-01',amount:'12.34',description:'日常销售',note:'',reason:'核对原始来源',parentVersion:null,expenseVersion:null});
const record=()=>({id,kind:'sale',storeId:id,storeName:'原店铺',parentId:null,expenseId:null,sourceReference:'原销售',version:1,businessDate:'2026-01-01',amountCents:1234,description:'原销售',note:'',reason:'核对',status:'active',parentSnapshot:null,expenseSnapshot:null,actor:'finance_admin',createdAt:'2026-01-01T00:00:00Z',sourceChanged:false});
test('operating amounts remain positive with explicit type, original refund and expense versions',()=>{
 assert.equal(operatingPayload(body()).amount,'12.34');
 for(const changed of [{amount:'0'},{amount:'-1'},{amount:null},{kind:'income'},{kind:['sale']},{parentVersion:1},{kind:'refund'},{expenseId:id,expenseVersion:1},{description:''},{businessDate:'2026-02-30'},{status:'void'}])assert.throws(()=>operatingPayload({...body(),...changed}));
 assert.equal(operatingPayload({...body(),kind:'refund',parentId:id,parentVersion:1}).kind,'refund');
 assert.equal(operatingPayload({...body(),kind:'fee',expenseId:id,expenseVersion:1}).expenseId,id);
 assert.throws(()=>operatingVoid({requestKey:id,expectedVersion:1,reason:''}));assert.throws(()=>operatingVoid({requestKey:id,expectedVersion:2147483647,reason:'容量'}));
});
test('list filters and complete positive summaries refuse unsupported statuses, months and number precision loss',()=>{
 assert.equal(operatingQuery({kind:'refund',month:'2026-02'}).get('kind'),'refund');
 for(const query of [{month:'2026-13'},{offset:-1},{status:'pending'},{kind:'settlement'},{q:'a'.repeat(101)},{extra:'x'}])assert.throws(()=>operatingQuery(query));
 const page={rows:[record()],total:1,offset:0,limit:50,summary:{saleCents:'9007199254740993123',refundCents:'0',feeCents:'0',changedSources:0},stores:[{id,name:'原店铺',active:true}]};assert.equal(operatingPage(page),page);
 assert.throws(()=>operatingPage({...page,summary:{...page.summary,saleCents:1234}}));
 assert.throws(()=>operatingPage({...page,rows:[{...record(),amountCents:-1}]}));
 const detail={record:record(),history:{rows:[record()],total:1,offset:0,limit:50},refundedCents:'0',parent:null,parentChanged:false};assert.equal(operatingDetail(detail,id),detail);assert.throws(()=>operatingDetail({...detail,parent:{}},id));
});
test('read-only clients cannot create, revise or void operating financial records',async()=>{
 let calls=0;const api=createCloudApi(async()=>{calls++;throw Error('unexpected');});await assert.rejects(api.saveOperatingRecord(null,body()),e=>e.status===405);await assert.rejects(api.voidOperatingRecord(id,{requestKey:id,expectedVersion:1,reason:'记录作废'}),e=>e.status===405);assert.equal(calls,0);
});
test('operating view labels independent daily amounts and reuses original expense evidence',async()=>{
 const {createOperatingFinanceViews}=await import('../dist/operating-finance-view.mjs'),original=globalThis.document;let html='';globalThis.document={addEventListener(){}};
 const fee={...record(),kind:'fee',expenseId:id,expenseSnapshot:{description:'原手续费凭证',expenseDate:'2026-01-01',amountCents:1234,version:1}};
 try{const view=createOperatingFinanceViews({api:{operatingRecord:async()=>({record:fee,history:{rows:[fee],total:1,offset:0,limit:50},refundedCents:'0',parent:null,parentChanged:false})},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),writable:true,localTime:String,notify(){}});await view.detail(id);assert.match(html,/平台已扣佣金／手续费/);assert.match(html,/查看原支出与凭证/);assert.match(html,/作废记录/);assert.doesNotMatch(html,/登记客户退款/);}
 finally{globalThis.document=original;}
});
