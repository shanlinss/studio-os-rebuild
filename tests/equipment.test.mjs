import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {equipmentPayload,equipmentPage,equipmentPath} from '../dist/equipment-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
test('equipment edits preserve complete identity fields and reject invalid return/state data',()=>{
 const value={requestKey:randomUUID(),assetTag:'CAM-01',name:'相机',model:'原型号',keeperMemberId:null,location:'设备柜',notes:'原说明'};
 assert.equal(equipmentPayload('edit',value,2).expectedVersion,2);assert.throws(()=>equipmentPayload('edit',{requestKey:value.requestKey,name:'只改名'},2),ContractError);
 assert.throws(()=>equipmentPayload('return',{requestKey:value.requestKey,condition:'issue',note:''},2),ContractError);assert.throws(()=>equipmentPayload('state',{requestKey:value.requestKey,action:'available',note:'绕过状态'},2),ContractError);
 assert.throws(()=>equipmentPath('borrow','../outside'),ContractError);
});
test('equipment loan pages retain owner and pagination without contradictory completion facts',()=>{
 const row={id:randomUUID(),equipmentId:randomUUID(),ownerId:randomUUID(),assetTag:'CAM-01',name:'相机',location:'拍摄台',returnLocation:'设备柜',version:1,borrowedAt:'2026-11-03T02:00:00Z',returnedAt:null,returnCondition:null};
 assert.equal(equipmentPage({rows:[row],total:51,offset:50,limit:50},true).offset,50);
 assert.throws(()=>equipmentPage({rows:[{...row,returnCondition:'ok'}],total:1,offset:0,limit:50},true),ContractError);
});
test('equipment uncertainty is resolved by durable actor receipts; read-only mode never sends mutations',async()=>{
 const owner=randomUUID(),key=randomUUID(),loan=randomUUID();let writes=0;
 const api=createCloudApi(async(path,options)=>{if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'local',role:'employee'},csrfToken:'a'.repeat(64)});if(path==='/api/equipment/receipts/'+key)return Response.json({id:loan});writes++;throw Error('lost response');},{allowWrites:true});await api.session();
 const value={requestKey:key,location:'拍摄台',shootingRequestId:null,note:''};await assert.rejects(api.equipmentWrite('borrow',owner,value,1),e=>e.uncertain);await assert.rejects(api.equipmentWrite('borrow',owner,value,1),e=>e.status===409);assert.equal(writes,1);assert.deepEqual(await api.equipmentReceipt(key,'borrow',owner),{id:loan});assert.equal(writes,1);
 const readonly=createCloudApi(async()=>{throw Error('must not send');});await assert.rejects(readonly.equipmentWrite('borrow',owner,value,1),e=>e.status===405);
});
