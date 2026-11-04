import test from 'node:test';
import assert from 'node:assert/strict';
import {openingState,openingHistory,openingPayload} from '../dist/product-opening-contract.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',lineId='22222222-2222-4222-8222-222222222222';
const body=()=>({requestKey:id,expectedVersion:0,sourceReference:'期初盘点成本表',reason:'按单据复核',lines:[{movementId:lineId,amount:'10.01'}]});
test('opening payload requires explicit amounts and a source, and prevents rewriting original quantities',()=>{
 assert.equal(openingPayload(body()).lines[0].amount,'10.01');assert.equal(openingPayload({...body(),lines:[{movementId:lineId,amount:'0'}]}).lines[0].amount,'0');
 for(const changed of [{reason:''},{sourceReference:' '},{expectedVersion:-1},{lines:[]},{quantity:1},{lines:[{movementId:lineId,amount:''}]},{lines:[{movementId:lineId,amount:'1.001'}]},{lines:[...body().lines,...body().lines]},{lines:[{...body().lines[0],quantity:99}]}])assert.throws(()=>openingPayload({...body(),...changed}));
});
test('opening source contract matches every original quantity and exact-cent history total',()=>{
 const line={id:lineId,quantity:3,day:'2026-11-04',snapshot:{name:'原商品'}},record={id,version:1,totalCents:1001,sourceReference:'单据',reason:'复核',actor:'admin',createdAt:'2026-11-04T00:00:00Z',lines:[{movementId:lineId,quantity:3,totalCents:1001,snapshot:line.snapshot}]};
 const state={sku:{id,itemId:id,code:'sku',name:'商品'},lines:[line],record};assert.equal(openingState(state,id),state);
 assert.throws(()=>openingState({...state,lines:[{...line,quantity:4}]},id));assert.throws(()=>openingState({...state,record:{...record,totalCents:1000}},id));assert.throws(()=>openingHistory({rows:[{...record,lines:[...record.lines,...record.lines]}],total:1,offset:0,limit:50}));
});
test('opening writes remain disabled in read-only clients',async()=>{
 let sent=0;const api=createCloudApi(async()=>{sent++;throw Error('unexpected fetch');});await assert.rejects(api.saveProductOpening(id,body()),e=>e.status===405);assert.equal(sent,0);
});
