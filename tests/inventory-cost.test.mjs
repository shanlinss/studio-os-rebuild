import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryCostPayload} from '../dist/inventory-cost-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',basis={requestKey:id,expectedVersion:0,amount:'0',scope:null,storeId:null,expenseId:null,expenseVersion:null,purchaseSourceVersion:null,sourceReference:'原始成本表',reason:'核对原数量及成本'};
test('inventory evidence separates positive valuation from outflow attribution and protects original quantities',()=>{
 assert.equal(inventoryCostPayload(basis).amount,'0');assert.equal(inventoryCostPayload({...basis,amount:null,scope:'public'}).scope,'public');
 for(const change of [{amount:''},{amount:'-1'},{scope:'public'},{quantity:99},{scope:null,amount:null},{amount:null,scope:'store'},{amount:null,scope:'public',storeId:id},{reason:''}])assert.throws(()=>inventoryCostPayload({...basis,...change}));
 assert.equal(inventoryCostPayload({...basis,amount:null,scope:'store',storeId:id}).storeId,id);
});
test('read-only clients never save inventory evidence or expense attribution',async()=>{let sent=0;const api=createCloudApi(async()=>{sent++;throw Error('unexpected');});await assert.rejects(api.saveInventoryCost(id,basis),e=>e.status===405);assert.equal(sent,0);});
test('a changed linked expense stays selected and visible even when it no longer matches the normal picker filter',async()=>{
 const {createInventoryCostEditors}=await import('../dist/inventory-cost-editors.mjs'),expenseId='22222222-2222-4222-8222-222222222222';let options,body='',payload;
 const editor=createInventoryCostEditors({api:{inventoryCost:async()=>({stores:[],source:{mode:'outflow',day:'2026-11-04',delta:-1,snapshot:{name:'原出库',unit:'件'},costCents:'200',purchaseSourceVersion:null},record:{version:1,scope:'store',storeId:id,expenseId,expenseSnapshot:{version:1},sourceReference:'原依据'}}),finance:async()=>({records:[{id:expenseId,version:2,expenseDate:'2026-10-01',expenseUse:'inventory',expenseScope:'public',storeId:null,description:'已改用途的原支出',amountCents:200}]}),saveInventoryCost:async(_id,p)=>{payload=p;}},h:String,input:()=>'',area:()=>'',select:(name,label,value,values)=>{if(name==='expenseId')options={value,values};return '';},mount:(_title,html,submit)=>{body=html;const f=new Map([['scope','public'],['storeId',''],['expenseId',expenseId],['sourceReference','原依据'],['reason','核对新版本']]);return submit(f);}});
 await editor.inventoryCost(id);assert.equal(options.value,expenseId);assert.ok(options.values.some(([value])=>value===expenseId));assert.match(body,/原关联支出已有新版本/);assert.equal(payload.expenseId,expenseId);assert.equal(payload.expenseVersion,2);
});
test('shipment and return sources link to the correct SKU cost period instead of pretending to be purchase receipts',async()=>{
 const {createInventoryCostViews}=await import('../dist/inventory-cost-view.mjs'),original=globalThis.document;let html='';globalThis.document={addEventListener(){}};
 try{const view=createInventoryCostViews({api:{inventoryCost:async()=>({source:{id,itemId:id,kind:'product',mode:'external',type:'outbound',delta:-2,day:'2020-02-01',costCents:'400',actualSkuId:id,productDocumentId:id,snapshot:{name:'原发货商品',unit:'件'}},record:null,stores:[],history:{rows:[],total:0,offset:0,limit:50}})},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['finance']}),writable:true,notify(){},localTime:String});await view.detail(id);assert.match(html,/data-cost-sku=/);assert.match(html,/data-cost-period="2020-02"/);assert.doesNotMatch(html,/data-product-purchase=/);}
 finally{globalThis.document=original;}
});
