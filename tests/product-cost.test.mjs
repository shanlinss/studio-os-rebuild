import test from 'node:test';
import assert from 'node:assert/strict';
import {costMonth,costCatalog,costReview} from '../dist/product-cost-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('cost review refuses malformed months and response amounts while preserving unknown and negative net amounts',()=>{
 for(const value of ['2026-00','2026-13','2026-1','0000-01','2200-01',null])assert.throws(()=>costMonth(value));
 const v={estimatedRows:0,indicativeShipmentAmount:'0.00',indicativeReturnAmount:'2.50',indicativeNetAmount:'-2.50',dropship:{rows:[],refunds:[],estimatedRows:0,actualCents:'0',indicativeCents:'0',refundCents:'0',netCents:'0',indicativeNetCents:'0'},sku:{id,code:'sku',name:'商品'},method:'moving-average',month:'2026-01',quantity:0,rows:[],issues:[],shipmentQuantity:0,returnQuantity:2,balanceAmount:null,averageAmount:null,shipmentAmount:'0.00',returnAmount:'2.50',netAmount:'-2.50'};
 assert.equal(costReview(v,id,v.month),v);
 for(const changed of [{netAmount:0},{balanceAmount:'NaN'},{month:'2026-02'},{sku:{id:'other'}},{issues:[{}]}])assert.throws(()=>costReview({...v,...changed},id,v.month));
 assert.throws(()=>costCatalog({rows:[],offset:-1,total:0,limit:50}));
});
test('cost API validates query values locally and encodes only the allowed cost reads',async()=>{
 const seen=[],api=createCloudApi(async(path)=>{seen.push(path);return {ok:true,json:async()=>({rows:[],total:0,offset:50,limit:50})};});
 await assert.rejects(api.productCostReview(id,'2026-13'));
 await assert.rejects(api.productCostCatalog(-1));assert.equal(seen.length,0);
 await api.productCostCatalog(50);assert.deepEqual(seen,['/api/product-costs?offset=50']);
});
