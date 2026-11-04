import test from 'node:test';
import assert from 'node:assert/strict';
import {referencePayload,dropshipPayload,dropshipRefundPayload} from '../dist/cost-sources-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
const reference={requestKey:id,expectedVersion:0,effectiveMonth:'2026-11',unitPrice:'1.25',fulfillmentMode:'stocked',sourceReference:'供应商报价',reason:'核对参考价'};
const batch={requestKey:id,code:'BATCH',businessDate:'2026-11-01',supplier:'供应商',sourceReference:'代发清单',reason:'核对',lines:[{skuCode:'SKU',storeId:id,quantity:3,basis:'actual',amount:'4.00'}]};
test('reference prices distinguish disabled estimation from explicit zero and reject invalid period or modes',()=>{
 assert.equal(referencePayload({...reference,unitPrice:null}).unitPrice,null);assert.equal(referencePayload({...reference,unitPrice:'0'}).unitPrice,'0');
 for(const v of [{effectiveMonth:'2026-13'},{fulfillmentMode:['stocked']},{unitPrice:'1.001'},{sourceReference:''},{expectedVersion:-1}])assert.throws(()=>referencePayload({...reference,...v}));
});
test('batch payload distinguishes actual totals from reference estimation, protects original quantities on correction and requires real refunds',()=>{
 assert.equal(dropshipPayload(batch).lines[0].amount,'4.00');assert.equal(dropshipPayload({...batch,lines:[{...batch.lines[0],basis:'reference',amount:null}]}).lines[0].basis,'reference');
 for(const line of [{...batch.lines[0],quantity:0},{...batch.lines[0],basis:['actual']},{...batch.lines[0],basis:'reference',amount:'4'},{...batch.lines[0],amount:null}])assert.throws(()=>dropshipPayload({...batch,lines:[line]}));
 assert.throws(()=>dropshipPayload({requestKey:id,expectedVersion:1,reason:'修正',lines:[{lineId:id,basis:'actual',amount:'1',quantity:1}]},true));
 const r={requestKey:id,refundId:null,expectedVersion:0,lineId:id,quantity:1,businessDate:'2026-11-02',sourceReference:'供应商退款记录',amount:'0',reason:'确认不退货款'};
 assert.equal(dropshipRefundPayload(r).amount,'0');assert.throws(()=>dropshipRefundPayload({...r,amount:null}));assert.throws(()=>dropshipRefundPayload({...r,expectedVersion:1}));
});
test('read-only clients never submit reference, dropship or refund writes',async()=>{
 let calls=0;const api=createCloudApi(async()=>{calls++;throw Error('unexpected');});await assert.rejects(api.saveReferenceCost(id,reference),e=>e.status===405);await assert.rejects(api.saveDropship(null,batch),e=>e.status===405);assert.equal(calls,0);
});
test('negative cross-month net refunds render without weakening positive-only financial amounts',async()=>{
 const {signedCostMoney}=await import('../dist/cost-sources-contract.mjs');
 assert.equal(signedCostMoney('-123'),'-¥1.23');assert.equal(signedCostMoney('-1'),'-¥0.01');assert.equal(signedCostMoney('0'),'¥0.00');assert.throws(()=>signedCostMoney('NaN'));
 const {createProductCostViews}=await import('../dist/product-cost-view.mjs'),original=globalThis.document;let html='';
 globalThis.document={addEventListener(){}};
 try{
  const view=createProductCostViews({api:{productCostReview:async()=>({sku:{id,itemId:null,name:'代发商品',code:'SKU',unit:'件'},shipmentQuantity:0,returnQuantity:0,netAmount:'0.00',shipmentAmount:'0.00',returnAmount:'0.00',estimatedRows:0,quantity:0,balanceAmount:'0.00',averageAmount:null,issues:[],rows:[],dropship:{netCents:'-123',refundCents:'123',estimatedRows:0,rows:[],refunds:[]}})},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),notify(){}});
  await view.review(id,'2026-11');assert.match(html,/-¥1\.23/);assert.doesNotMatch(html,/期初成本依据/);
 }finally{globalThis.document=original;}
});
test('dropship void and reconstruction payloads preserve links without editing original quantities',async()=>{
 const {dropshipVoidPayload}=await import('../dist/cost-sources-contract.mjs');assert.equal(dropshipVoidPayload({requestKey:id,expectedVersion:1,reason:'原清单录入错误'}).expectedVersion,1);assert.throws(()=>dropshipVoidPayload({requestKey:id,expectedVersion:1,reason:'纠错',quantity:99}));assert.equal(dropshipPayload({...batch,replacesId:id}).replacesId,id);
 const r={requestKey:id,refundId:null,expectedVersion:0,lineId:id,quantity:1,businessDate:'2026-11-02',sourceReference:'原退款单',amount:'0',reason:'核对重建',replacesRefundId:id};assert.equal(dropshipRefundPayload(r).replacesRefundId,id);
 let calls=0;const api=createCloudApi(async()=>{calls++;throw Error('unexpected');});await assert.rejects(api.voidDropship(id,{requestKey:id,expectedVersion:1,reason:'纠错'}),e=>e.status===405);assert.equal(calls,0);
});
test('a lost refund void response must recover the matching private receipt before retrying',async()=>{
 let calls=0,exists=false;const api=createCloudApi(async(path)=>{if(path==='/api/session')return Response.json({user:{id,username:'local',role:'admin'},csrfToken:'a'.repeat(64)});if(path.startsWith('/api/dropship-costs/receipts/'))return exists?Response.json({id,refundId:id,recordId:id,version:2}):new Response('{}',{status:404});calls++;throw Error('response lost');},{allowWrites:true});await api.session();const b={requestKey:id,expectedVersion:1,reason:'核对错误退款'};await assert.rejects(api.voidDropship(id,b,id),e=>e.uncertain);await assert.rejects(api.voidDropship(id,b,id),e=>e.status===409);assert.equal(calls,1);exists=true;assert.equal((await api.dropshipReceipt(id,'refund-void',id,id)).refundId,id);
});
test('voided batch view removes monetary edits and offers only linked reconstruction with retained history',async()=>{
 const {createCostSourcesViews}=await import('../dist/cost-sources-view.mjs');const old=globalThis.document;let html;globalThis.document={addEventListener(){}};
 try{const views=createCostSourcesViews({api:{dropshipDetail:async()=>({document:{id,code:'原错单',businessDate:'2026-01-01',supplier:'供应商',sourceReference:'原清单',replacementId:null,replacesId:null},lines:[{id,skuId:id,quantity:3,snapshot:{skuCode:'SKU',name:'原商品',storeName:'甲店',unit:'件'}}],record:{version:2,status:'void',lines:[{lineId:id,basis:'actual',amountCents:600}]},refunds:[],history:{rows:[],total:2}})},h:String,showPanel:async(_t,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance','resources']}),writable:true,notify(){},localTime:String});await views.detail(id);assert.match(html,/data-dropship-rebuild=/);assert.doesNotMatch(html,/data-dropship-edit=/);assert.doesNotMatch(html,/data-dropship-refund=/);assert.match(html,/不计入有效成本或退款/);}
 finally{globalThis.document=old;}
});
test('batch reconstruction prefills original facts but sends corrected quantity, date, store and explicit original link',async()=>{
 const {createCostSourcesEditors}=await import('../dist/cost-sources-editors.mjs');let value,inputs={};const state={document:{id,code:'原错单',businessDate:'2026-01-01',supplier:'供应商',sourceReference:'原清单',replacementId:null},record:{status:'void',lines:[{lineId:id,basis:'actual',amountCents:600}]},lines:[{id,storeId:id,quantity:3,snapshot:{skuCode:'SKU'}}]};
 const editor=createCostSourcesEditors({api:{dropshipDetail:async()=>state,dropshipOptions:async()=>({rows:[],stores:[{id,name:'店铺'}]}),saveDropship:async(_id,v)=>{assert.equal(_id,null);value=v;}},h:String,input:(n,_l,v)=>{inputs[n]=v;return '';},area:()=>'',select:()=>'',mount:(_t,_b,submit)=>submit(new Map([['code','CORRECTED'],['businessDate','2026-02-01'],['supplier','供应商'],['sourceReference','原清单'],['reason','按实际清单核对'],['sku0','CORRECT-SKU'],['store0',id],['quantity0','5'],['basis0','actual'],['amount0','12.00']]))});await editor.dropship(null,id);assert.equal(inputs.quantity0,3);assert.equal(value.lines[0].quantity,5);assert.equal(value.businessDate,'2026-02-01');assert.equal(value.replacesId,id);assert.equal(value.lines[0].amount,'12.00');
});
test('business fact correction uses a separate payload and endpoint, not ordinary cost or inventory edits',async()=>{
 const {dropshipFactsPayload}=await import('../dist/cost-sources-contract.mjs'),b={requestKey:id,expectedVersion:1,businessDate:'2026-02-01',supplier:'供应商',sourceReference:'原清单',reason:'核对原事实',lines:[{lineId:id,skuCode:'SKU',storeId:id,quantity:5,basis:'actual',amount:'12.00'}]};assert.equal(dropshipFactsPayload(b).lines[0].quantity,5);assert.throws(()=>dropshipFactsPayload({...b,lines:[b.lines[0],b.lines[0]]}));assert.throws(()=>dropshipFactsPayload({...b,lines:[{...b.lines[0],returnedQuantity:2}]}));let sent=0;const api=createCloudApi(async()=>{sent++;throw Error('unexpected');});await assert.rejects(api.correctDropshipFacts(id,b),e=>e.status===405);assert.equal(sent,0);
});
