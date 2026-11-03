import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {equipmentPurchasePayload,equipmentPurchaseState,equipmentPurchaseHistory,equipmentPurchaseResult} from '../dist/equipment-purchase-contract.mjs';
import {ContractError,createCloudApi} from '../dist/cloud-api.mjs';
const owner=randomUUID(),source=randomUUID(),key=randomUUID(),equipment={id:owner,assetTag:'A',name:'设备',status:'available'};
const payload=()=>({requestKey:key,expectedVersion:0,purchaseDate:null,amount:null,supplier:'',expenseId:null,expenseVersion:null,reason:'核对采购资料'});
test('acquisition contracts preserve unknown and zero, exact decimal cents and explicit versions without broader fields',()=>{
 assert.equal(equipmentPurchasePayload(payload()).amount,null);assert.equal(equipmentPurchasePayload({...payload(),amount:'0.00'}).amount,'0.00');assert.equal(equipmentPurchasePayload({...payload(),amount:'21474836.47'}).amount,'21474836.47');
 for(const patch of [{amount:0},{amount:'-1'},{amount:'1.001'},{amount:'21474836.48'},{purchaseDate:'2020-02-30'},{purchaseDate:'0000-01-01'},{expenseId:source,expenseVersion:null},{expenseId:null,expenseVersion:1},{expectedVersion:-1},{reason:''},{finance:true}])assert.throws(()=>equipmentPurchasePayload({...payload(),...patch}),ContractError);
});
test('protected acquisition reads reject wrong owners, incomplete money fields and inconsistent source drift claims',()=>{
 const state={equipment,record:null,linkedExpense:null,sourceChanged:false};assert.deepEqual(equipmentPurchaseState(state,owner),state);assert.throws(()=>equipmentPurchaseState(state,randomUUID()),ContractError);assert.throws(()=>equipmentPurchaseState({...state,sourceChanged:true},owner),ContractError);
 const record={id:randomUUID(),equipmentId:owner,version:1,purchaseDate:null,amountCents:0,supplier:'',expenseId:null,expenseSnapshot:null,equipmentSnapshot:equipment,reason:'核实免费',actor:'admin',createdAt:new Date().toISOString()};assert.equal(equipmentPurchaseHistory({rows:[record],total:1,offset:0,limit:50},owner).rows[0].amountCents,0);assert.throws(()=>equipmentPurchaseState({...state,record:{...record,amountCents:undefined}},owner),ContractError);assert.throws(()=>equipmentPurchaseResult({id:randomUUID(),recordId:randomUUID(),version:1},owner),ContractError);
});
test('readonly clients send no acquisition write, and uncertain saves reconcile only against the private matching receipt',async()=>{
 const calls=[],result={id:owner,recordId:randomUUID(),version:1};let drop=true;
 const fetcher=async(path,options)=>{calls.push({path,options});if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'root',role:'admin',superadmin:true,permissions:[]},csrfToken:'a'.repeat(64)});if(path.endsWith('/receipts/'+key))return Response.json(result);if(drop){drop=false;throw Error('response lost');}return Response.json(result);};
 const readonly=createCloudApi(fetcher);await assert.rejects(readonly.saveEquipmentPurchase(owner,payload()),e=>e.status===405);assert.equal(calls.length,0);
 const api=createCloudApi(fetcher,{allowWrites:true});await api.session();await assert.rejects(api.saveEquipmentPurchase(owner,payload()),e=>e.uncertain);await assert.rejects(api.saveEquipmentPurchase(owner,payload()),e=>e.status===409);assert.deepEqual(await api.equipmentPurchaseReceipt(owner,key),result);await api.saveEquipmentPurchase(owner,payload());assert.equal(calls.filter(c=>c.options?.method==='POST').length,2);
});
