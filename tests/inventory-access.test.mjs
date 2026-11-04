import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inventoryAccessPayload,inventoryAccessState,inventoryAccessMine,inventoryAccessHistory,inventoryAccessResult} from '../dist/inventory-access-contract.mjs';
import {ContractError,createCloudApi} from '../dist/cloud-api.mjs';
const owner=randomUUID(),store=randomUUID(),key=randomUUID(),grant={storeId:store,canMove:true,storeName:'甲店',storeActive:true};
const state={id:owner,username:'employee',active:true,version:2,grants:[grant],quantityOperationsAvailable:false};
test('scope payload is explicit and rejects wildcard, duplicate, malformed or broad privilege fields',()=>{
 const value={requestKey:key,grants:[{storeId:null,canMove:false},{storeId:store,canMove:true}],reason:'明确范围'};assert.equal(inventoryAccessPayload(value,2).expectedVersion,2);
 for(const patch of [{grants:[{storeId:'*',canMove:true}]},{grants:[{storeId:null,canMove:false},{storeId:null,canMove:true}]},{grants:[{storeId:null,canMove:'true'}]},{grants:[{storeId:null,canMove:true,resources:true}]},{reason:''},{superadmin:true}])assert.throws(()=>inventoryAccessPayload({...value,...patch},2),ContractError);assert.throws(()=>inventoryAccessPayload(value,0),ContractError);
});
test('scope state, personal access, history and receipts fail closed on owner mismatches and malformed capabilities',()=>{
 assert.deepEqual(inventoryAccessState(state,owner),state);assert.throws(()=>inventoryAccessState(state,randomUUID()),ContractError);assert.equal(inventoryAccessState({...state,quantityOperationsAvailable:true},owner).quantityOperationsAvailable,true);assert.throws(()=>inventoryAccessMine({canManageAll:'true',grants:[],quantityOperationsAvailable:false}),ContractError);assert.throws(()=>inventoryAccessResult({id:randomUUID(),version:3,eventId:randomUUID()},owner),ContractError);assert.throws(()=>inventoryAccessHistory({rows:[{id:randomUUID(),reason:'原因',actor:'admin',createdAt:new Date().toISOString(),beforeValue:state,afterValue:{...state,id:randomUUID()}}],total:1,offset:0,limit:50},owner),ContractError);
});
test('readonly API never sends a grant; uncertain saves recover using only the matching private receipt',async()=>{
 const value={requestKey:key,grants:[],reason:'清理范围'},user={id:randomUUID(),username:'root',role:'admin',superadmin:true,permissions:[]},result={id:owner,version:3,eventId:randomUUID()},calls=[];let dropped=true;
 const fetcher=async(path,options)=>{calls.push({path,options});if(path==='/api/session')return Response.json({user,csrfToken:'a'.repeat(64)});if(path.endsWith('/receipts/'+key))return Response.json(result);if(options?.method==='POST'){if(dropped){dropped=false;throw Error('response lost');}return Response.json(result);}return Response.json(state);};
 const readonly=createCloudApi(fetcher);await assert.rejects(readonly.saveInventoryAccess(owner,value,2),e=>e.status===405);assert.equal(calls.length,0);
 const api=createCloudApi(fetcher,{allowWrites:true});await api.session();await assert.rejects(api.saveInventoryAccess(owner,value,2),e=>e.uncertain);await assert.rejects(api.saveInventoryAccess(owner,value,2),e=>e.status===409);assert.deepEqual(await api.inventoryAccessReceipt(owner,key),result);await api.saveInventoryAccess(owner,value,2);assert.equal(calls.filter(c=>c.options?.method==='POST').length,2);assert.equal(calls.find(c=>c.options?.method==='POST').options.headers['x-csrf-token'],'a'.repeat(64));
});
