import test from 'node:test';
import assert from 'node:assert/strict';
import {movingCosts} from '../../.build/server/product-cost-engine.js';
let sequence=0;
const row=(operation,quantity,totalCents=null,extra={})=>{const n=++sequence;return {id:'event-'+n,type:operation==='shipment'?'outbound':'inbound',operation,quantity,delta:operation==='shipment'?-quantity:quantity,totalCents,day:'2026-01-01',postedAt:new Date(Date.UTC(2026,0,1,0,0,n)).toISOString(),documentId:'document-'+n,sourceShipmentId:null,purchaseVersion:totalCents===null?null:1,sourceChanged:false,snapshot:{},duplicateOpening:false,internalTransfer:false,...extra};};
test('moving average retains fractional cents between purchases, shipment and partial returns',()=>{
 const first=row('inbound',3,100),sent=row('shipment',1),second=row('inbound',1,100),returned=row('return',1,null,{sourceShipmentId:sent.id}),sentAgain=row('shipment',1);
 const result=movingCosts([sentAgain,returned,second,sent,first],'2026-01');
 assert.equal(result.rows[1].costAmount,'0.33');assert.equal(result.rows[2].balanceAmount,'1.67');
 assert.equal(result.rows[3].costAmount,'0.33');assert.equal(result.rows[3].balanceAmount,'2.00');
 assert.equal(result.rows[4].costAmount,'0.50');assert.equal(result.balanceAmount,'1.50');
 assert.equal(result.shipmentAmount,'0.83');assert.equal(result.returnAmount,'0.33');assert.equal(result.netAmount,'0.50');
});
test('cross-month partial returns recover original cost instead of latest average and can exceed current-month shipments',()=>{
 const incoming=row('inbound',10,1000),sent=row('shipment',4),incoming2=row('inbound',4,800,{day:'2026-02-01'}),returned=row('return',2,null,{day:'2026-02-02',sourceShipmentId:sent.id});
 const january=movingCosts([incoming,sent,incoming2,returned],'2026-01');assert.equal(january.balanceAmount,'6.00');assert.equal(january.shipmentAmount,'4.00');
 const feb=movingCosts([incoming,sent,incoming2,returned],'2026-02');assert.equal(feb.returnAmount,'2.00');assert.equal(feb.netAmount,'-2.00');assert.equal(feb.balanceAmount,'16.00');assert.equal(feb.quantity,12);
});
test('missing opening or purchase costs stay unknown until depleted, with unresolved original shipments retained',()=>{
 const opening=row(null,2,null,{type:'opening'}),sent=row('shipment',2),known=row('inbound',2,500),returned=row('return',1,null,{sourceShipmentId:sent.id});
 const result=movingCosts([opening,sent,known,returned],'2026-01');assert.equal(result.rows[1].costAmount,null);assert.equal(result.rows[1].balanceAmount,'0.00');assert.equal(result.rows[2].balanceAmount,'5.00');assert.equal(result.balanceAmount,null);assert.equal(result.shipmentAmount,null);assert.equal(result.returnAmount,null);assert.equal(result.netAmount,null);
 const missing=movingCosts([row('inbound',1),row('shipment',1)],'2026-01');assert.equal(missing.shipmentAmount,null);
 const free=movingCosts([row('inbound',1,0),row('shipment',1)],'2026-01');assert.equal(free.shipmentAmount,'0.00');
});
test('scope allocation copies and internal transfers never add quantities or costs; other deductions are separate from sales',()=>{
 const rows=[row('inbound',10,1000),row(null,10,null,{type:'opening',duplicateOpening:true}),row(null,3,null,{type:'outbound',delta:-3,internalTransfer:true}),row(null,3,null,{internalTransfer:true}),row(null,2,null,{type:'outbound',delta:-2})];
 const result=movingCosts(rows,'2026-01');assert.equal(result.quantity,8);assert.equal(result.balanceAmount,'8.00');assert.equal(result.shipmentQuantity,0);assert.equal(result.shipmentAmount,'0.00');assert.equal(result.rows.at(-1).costAmount,'2.00');
});
test('positive stocktake, missing original returns, negative dated inventory and tied mixed operations require review',()=>{
 const added=movingCosts([row('inbound',2,200),row(null,1,null,{type:'stocktake'})],'2026-01');assert.equal(added.balanceAmount,null);
 assert.equal(movingCosts([row('return',1)],'2026-01').returnAmount,null);
 const bad=movingCosts([row('shipment',1,null,{day:'2025-12-01'}),row('inbound',2,200)],'2026-01');assert.ok(bad.issues.some(i=>i.includes('负库存')));assert.equal(bad.balanceAmount,null);
 const incoming=row('inbound',2,200),out=row('shipment',1,null,{postedAt:incoming.postedAt});assert.equal(movingCosts([incoming,out],'2026-01').shipmentAmount,null);
});
test('explicit original opening cost participates without unit-price rounding and duplicate scope openings stay excluded',()=>{
 const opening=row(null,6,1001,{type:'opening',openingVersion:2}),copy=row(null,6,null,{type:'opening',duplicateOpening:true}),sent=row('shipment',2);
 const result=movingCosts([opening,copy,sent],'2026-01');assert.equal(result.shipmentAmount,'3.34');assert.equal(result.balanceAmount,'6.67');assert.equal(result.quantity,4);assert.equal(result.rows[0].openingVersion,2);assert.deepEqual(result.issues,[]);
 const free=movingCosts([row(null,2,0,{type:'opening'}),row('shipment',1)],'2026-01');assert.equal(free.shipmentAmount,'0.00');
});
test('reference estimates never enter actual inventory and returns use the original shipment reference',()=>{
 const opening=row(null,6,null,{type:'opening'}),sent=row('shipment',2,null,{referenceUnitCents:125,referenceId:'ref-old'}),returned=row('return',1,null,{sourceShipmentId:sent.id,referenceUnitCents:999,referenceId:'ref-new',day:'2026-02-01'});
 const jan=movingCosts([opening,sent,returned],'2026-01');assert.equal(jan.shipmentAmount,null);assert.equal(jan.balanceAmount,null);assert.equal(jan.indicativeShipmentAmount,'2.50');assert.equal(jan.rows.at(-1).costBasis,'reference');assert.equal(jan.estimatedRows,1);
 const feb=movingCosts([opening,sent,returned],'2026-02');assert.equal(feb.returnAmount,null);assert.equal(feb.indicativeReturnAmount,'1.25');assert.equal(feb.rows[0].referenceId,'ref-old');
 const known=movingCosts([row('inbound',2,400),row('shipment',1,null,{referenceUnitCents:999,referenceId:'ref-new'})],'2026-01');assert.equal(known.shipmentAmount,'2.00');assert.equal(known.indicativeShipmentAmount,'2.00');assert.equal(known.estimatedRows,0);assert.equal(known.rows.at(-1).referenceId,null);
});
