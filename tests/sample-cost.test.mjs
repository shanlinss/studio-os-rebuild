import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleCostPayload} from '../dist/sample-cost-contract.mjs';
import {samplePayload,sampleOperationPath} from '../dist/sample-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',body={requestKey:id,expectedVersion:0,amount:'0.00',scope:null,storeId:null,expenseId:null,expenseVersion:null,costToken:'a'.repeat(64),lossKind:null,sourceReference:'原样品成本表',reason:'核对实际成本'};
test('sample evidence allows explicit zero but rejects quantity changes, free-form loss cost and incomplete attribution',()=>{
 assert.equal(sampleCostPayload(body).amount,'0.00');assert.equal(sampleCostPayload({...body,amount:null,scope:'public',lossKind:'scrap'}).lossKind,'scrap');
 for(const extra of [{quantity:2},{amount:''},{amount:'-1'},{amount:null,scope:'public'},{amount:null,scope:'store',lossKind:'loss'},{amount:null,scope:'unclassified',storeId:id,lossKind:'loss'},{lossKind:'scrap'},{costToken:'stale'},{reason:''}])assert.throws(()=>sampleCostPayload({...body,...extra}));
});
test('sample stocktake reuses the original quantity endpoint, permits complete write-off and requires a real reason',()=>{
 const b={requestKey:id,quantity:0,note:'实物报废，已核对借出部分不在此扣减'};assert.equal(samplePayload('count',b,2).quantity,0);assert.equal(sampleOperationPath('count',id),'/api/samples/catalog/'+id+'/stocktake');
 for(const extra of [{quantity:-1},{quantity:1.5},{note:''}])assert.throws(()=>samplePayload('count',{...b,...extra},2));
});
test('read-only clients refuse sample cost evidence and stocktake without sending writes',async()=>{let sent=0;const api=createCloudApi(async()=>{sent++;throw Error('unexpected');});await assert.rejects(api.saveSampleCost(id,body),e=>e.status===405);await assert.rejects(api.sampleWrite('count',id,{requestKey:id,quantity:0,note:'实物损耗'},1),e=>e.status===405);assert.equal(sent,0);});
test('uncertain sample cost writes require the original private receipt before a retry',async()=>{
 let sent=0,exists=false;const api=createCloudApi(async(path,options)=>{if(path==='/api/session')return Response.json({user:{id,username:'local',role:'admin'},csrfToken:'a'.repeat(64)});if(path.endsWith('/receipts/'+id))return exists?Response.json({id,recordId:id,version:1}):new Response('{}',{status:404});sent++;throw Error('response lost');},{allowWrites:true});await api.session();await assert.rejects(api.saveSampleCost(id,body),e=>e.uncertain);await assert.rejects(api.saveSampleCost(id,body),e=>e.status===409);assert.equal(sent,1);exists=true;assert.equal((await api.sampleCostReceipt(id,id)).version,1);
});
test('sample editors keep changed linked expenses visible and send cost token instead of an editable loss amount',async()=>{
 const {createSampleCostEditors}=await import('../dist/sample-cost-editors.mjs');let payload,options,html;const editor=createSampleCostEditors({api:{sampleCost:async()=>({stores:[],source:{mode:'outflow',day:'2026-11-04',delta:-1,snapshot:{name:'原样品',unit:'件'},costCents:'200',costToken:'a'.repeat(64)},record:{version:1,scope:'public',storeId:null,expenseId:id,expenseSnapshot:{version:1},sourceReference:'原依据',lossKind:'scrap'}}),finance:async()=>({records:[{id,version:2,expenseDate:'2026-10-01',expenseUse:'inventory',expenseScope:'public',storeId:null,description:'已改用途的原支出',amountCents:200}]}),saveSampleCost:async(_id,p)=>{payload=p;}},h:String,input:()=>'',area:()=>'',select:(name,label,value,values)=>{if(name==='expenseId')options={value,values};return '';},mount:(_title,body,submit)=>{html=body;submit(new Map([['scope','public'],['storeId',''],['lossKind','scrap'],['expenseId',id],['sourceReference','原依据'],['reason','核对新版本']]))}});await editor.sampleCost(id);assert.equal(options.value,id);assert.ok(options.values.some(([v])=>v===id));assert.match(html,/原关联支出已有新版本/);assert.equal(payload.amount,null);assert.equal(payload.costToken,'a'.repeat(64));assert.equal(payload.expenseVersion,2);
});
test('sample source view keeps product transfers read-only and limits basis edits to financial resource maintainers',async()=>{
 const {createSampleCostViews}=await import('../dist/sample-cost-view.mjs');const old=globalThis.document;globalThis.document={addEventListener(){}};let html,mode='transfer';
 try{const views=createSampleCostViews({api:{sampleCost:async()=>({source:{id,sampleId:id,mode,day:'2026-11-04',delta:mode==='outflow'?-1:2,note:'原数量记录',snapshot:{name:'样品'},costCents:'200',movementId:id,sourceChanged:false,attributionChanged:false},record:null,balance:{quantity:2,costCents:'200'},stores:[],history:{rows:[],total:0,offset:0,limit:50}})},h:String,showPanel:async(_t,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),writable:true,notify(){},localTime:String});await views.detail(id);assert.match(html,/data-inventory-cost=/);assert.doesNotMatch(html,/data-sample-cost-edit=/);mode='basis';await views.detail(id);assert.doesNotMatch(html,/data-sample-cost-edit=/);mode='outflow';await views.detail(id);assert.match(html,/data-sample-cost-edit=/);}
 finally{globalThis.document=old;}
});
