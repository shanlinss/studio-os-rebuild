import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleTransferPayload,sampleTransferRecord,warehouseMovement} from '../dist/warehouse-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),sampleId=randomUUID(),target={mode:'existing',sampleId,expectedVersion:2};
const value={requestKey:randomUUID(),quantity:2,reason:'拍摄备样',sourceReference:'',confirmed:true,target};
test('sample transfer requires an explicit unit confirmation, positive whole quantity and target version',()=>{
 assert.equal(sampleTransferPayload(value,3).expectedVersion,3);
 for(const changes of [{confirmed:false},{quantity:0},{quantity:-1},{quantity:1.2},{quantity:'2'},{target:{...target,availableQuantity:100}},{target:{mode:'existing',sampleId}},{target:{mode:'new',name:'样品',warehouseLocation:'',keeperMemberId:null,notes:''}}])assert.throws(()=>sampleTransferPayload({...value,...changes},3),ContractError);
 assert.throws(()=>sampleTransferPayload({...value,extra:1},3),ContractError);
});
test('transfer history requires equal debit and credit and a linked original sample snapshot',()=>{
 const row={id:randomUUID(),itemId:id,sampleId,movementId:randomUUID(),sampleEventId:randomUUID(),quantity:2,sourceBefore:5,sourceAfter:3,targetBefore:1,targetAfter:3,sourceSnapshot:{name:'产品',itemCode:'A',specification:'黑',unit:'件'},targetSnapshot:{id:sampleId,name:'样品',unit:'件'},reason:'实物转样',sourceReference:'',actor:'管理员',createdAt:'2026-11-03T00:00:00Z'};
 assert.equal(sampleTransferRecord(row).quantity,2);
 for(const changes of [{sourceAfter:4},{targetAfter:2},{targetSnapshot:{...row.targetSnapshot,id:randomUUID()}},{sourceSnapshot:{...row.sourceSnapshot,unit:'箱'}}])assert.throws(()=>sampleTransferRecord({...row,...changes}),ContractError);
 const movement={id:row.movementId,itemId:id,type:'outbound',quantity:2,delta:-2,beforeQuantity:5,afterQuantity:3,reason:'转样',sourceReference:'',correctsMovementId:null,itemSnapshot:row.sourceSnapshot,actor:row.actor,createdAt:row.createdAt};
 assert.equal(warehouseMovement(movement).type,'outbound');assert.equal(warehouseMovement({...movement,transferId:row.id,targetSampleId:sampleId,transferTargetSnapshot:row.targetSnapshot}).transferId,row.id);
 assert.throws(()=>warehouseMovement({...movement,transferId:row.id}),ContractError);
});
test('read-only clients never send a transfer mutation',async()=>{
 let reads=0;const api=createCloudApi(async()=>{reads++;return new Response('{}',{headers:{'Content-Type':'application/json'}});});
 await assert.rejects(api.warehouseToSamples(id,value,1),e=>e.status===405);assert.equal(reads,0);
});
