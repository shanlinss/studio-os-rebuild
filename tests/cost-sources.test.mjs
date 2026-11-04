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
