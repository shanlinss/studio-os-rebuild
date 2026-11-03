import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {warehouseItem,warehouseCatalog,warehouseMovement,warehousePayload} from '../dist/warehouse-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const item={id:randomUUID(),itemCode:'BOX-01',kind:'packaging',productId:null,productName:null,name:'包装盒',specification:'大号',unit:'个',location:'仓库 A',notes:'保留说明',openingConfirmed:false,quantity:null,active:true,version:1};
test('warehouse contracts distinguish unknown opening stock from a recorded zero and reject incomplete edits',()=>{
 assert.equal(warehouseItem(item).quantity,null);assert.equal(warehouseItem({...item,openingConfirmed:true,quantity:0}).quantity,0);
 assert.throws(()=>warehouseItem({...item,quantity:0}),ContractError);assert.throws(()=>warehouseItem({...item,openingConfirmed:true}),ContractError);
 assert.throws(()=>warehousePayload('edit',{requestKey:randomUUID(),name:'只改名'},1),ContractError);
 assert.throws(()=>warehousePayload('register',{requestKey:randomUUID(),itemCode:'P',kind:'product',productId:null,name:'产品',specification:'',unit:'件',location:'A',notes:''}),ContractError);
});
test('warehouse summaries cover all filtered pages and keep units and pending counts separate',()=>{
 const v={rows:[{...item,openingConfirmed:true,quantity:2}],offset:50,limit:50,total:51,summary:[{kind:'packaging',unit:'个',quantity:'100',initializedCount:50,pendingCount:1}]};assert.equal(warehouseCatalog(v).summary[0].quantity,'100');
 assert.throws(()=>warehouseCatalog({...v,summary:[{...v.summary[0],pendingCount:0}]}),ContractError);
 assert.throws(()=>warehouseCatalog({...v,summary:[{...v.summary[0],initializedCount:0,pendingCount:51}]}),ContractError);
 assert.throws(()=>warehouseCatalog({...v,rows:[null]}),ContractError);
});
test('warehouse movement facts retain arithmetic, immutable source snapshots and valid integer counts',()=>{
 const movement={id:randomUUID(),itemId:item.id,type:'stocktake',quantity:3,delta:-2,beforeQuantity:5,afterQuantity:3,reason:'实盘差异',sourceReference:'',correctsMovementId:randomUUID(),itemSnapshot:{name:item.name,itemCode:item.itemCode,unit:item.unit},actor:'管理员',createdAt:'2026-11-03T02:00:00Z'};
 assert.equal(warehouseMovement(movement).delta,-2);assert.throws(()=>warehouseMovement({...movement,delta:2}),ContractError);
 const value={requestKey:randomUUID(),type:'opening',quantity:0,reason:'实际为零',sourceReference:'',correctsMovementId:null};assert.equal(warehousePayload('move',value,1).quantity,0);
 for(const quantity of [-1,1.5,'2',2147483648])assert.throws(()=>warehousePayload('move',{...value,quantity},1),ContractError);
 assert.throws(()=>warehousePayload('move',{...value,type:'outbound',quantity:1,correctsMovementId:randomUUID()},1),ContractError);
});
test('warehouse uncertain writes require the original actor receipt; read-only preview never sends stock changes',async()=>{
 const key=randomUUID(),movementId=randomUUID();let writes=0;const api=createCloudApi(async(path,options)=>{if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'local',role:'admin'},csrfToken:'a'.repeat(64)});if(path==='/api/warehouse/receipts/'+key)return Response.json({id:item.id,movementId});writes++;throw Error('lost response');},{allowWrites:true});await api.session();
 const value={requestKey:key,type:'opening',quantity:0,reason:'盘点',sourceReference:'',correctsMovementId:null};await assert.rejects(api.warehouseWrite('move',item.id,value,1),e=>e.uncertain);await assert.rejects(api.warehouseWrite('move',item.id,value,1),e=>e.status===409);assert.equal(writes,1);assert.deepEqual(await api.warehouseReceipt(key,'move',item.id),{id:item.id,movementId});assert.equal(writes,1);
 let sent=0;const readonly=createCloudApi(async()=>{sent++;throw Error('must not reach HTTP');});await assert.rejects(readonly.warehouseWrite('move',item.id,value,1),e=>e.status===405);assert.equal(sent,0);
});
