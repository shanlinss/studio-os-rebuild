import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handoverPayload,handoverState,handoverPage} from '../dist/equipment-assets-contract.mjs';
import {equipmentPayload,equipmentPage} from '../dist/equipment-contract.mjs';
import {assetPath} from '../dist/media-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const owner=randomUUID(),key=randomUUID(),target=randomUUID(),payload=()=>({requestKey:key,expectedVersion:2,previousLoanId:null,previousLoanVersion:null,toMemberId:target,occurredAt:'2026-11-03T11:12:13.123+08:00',condition:'完好',location:'工位',note:'管理员实际交接'});
test('handover contracts require a real recipient, explicit previous loan and version, exact time and conditions',()=>{
 assert.equal(handoverPayload(payload()).occurredAt,'2026-11-03T11:12:13.123+08:00');for(const patch of [{condition:''},{note:''},{location:''},{previousLoanVersion:1},{previousLoanId:randomUUID(),previousLoanVersion:null},{occurredAt:'2026-02-30T00:00:00Z'},{occurredAt:'2026-01-01T24:00:00Z'},{toMemberId:'*'},{amount:100}])assert.throws(()=>handoverPayload({...payload(),...patch}),ContractError);
 const state={equipment:{id:owner,name:'设备',assetTag:'CAM',status:'available',version:1},currentLoan:null,recipients:[{id:target,displayName:'接收人'}]};assert.equal(handoverState(state,owner).currentLoan,null);assert.throws(()=>handoverState(state,randomUUID()),ContractError);assert.throws(()=>handoverState({...state,equipment:{...state.equipment,status:'on_loan'}},owner),ContractError);
});
test('optional new profile fields preserve legacy payloads, and transferred loans never appear as an ordinary good-condition return',async()=>{
 const base={requestKey:key,assetTag:'CAM',name:'设备',model:'M',keeperMemberId:null,location:'柜子',notes:''};assert.ok(!Object.hasOwn(equipmentPayload('edit',base,1),'serialNumber'));assert.equal(equipmentPayload('edit',{...base,deviceType:'相机',brand:'品牌',serialNumber:'原厂编号'},2).brand,'品牌');assert.throws(()=>equipmentPayload('edit',{...base,brand:null},2),ContractError);
 const loan={id:randomUUID(),equipmentId:owner,ownerId:target,name:'设备',assetTag:'CAM',location:'工位',returnLocation:'柜子',version:2,borrowedAt:'2026-11-03T01:00:00Z',returnedAt:'2026-11-03T02:00:00Z',returnCondition:'handover'};assert.equal(equipmentPage({rows:[loan],total:1,offset:0,limit:50},true).rows[0].returnCondition,'handover');assert.equal(assetPath('equipment',owner,key),'/api/equipment/catalog/'+owner+'/images/'+key);
 const legacy=createCloudApi(async(path)=>{const url=new URL(path,'http://local');return url.searchParams.has('assetStatus')?Response.json({message:'unsupported query'},{status:400}):Response.json({rows:[],total:0,offset:0,limit:50});});assert.equal((await legacy.equipmentCatalog({assetStatus:'all'})).total,0);await assert.rejects(legacy.equipmentCatalog({assetStatus:'available'}),e=>e.status===400);

});
test('transfer and image requests use original CSRF and durable equipment receipts, without permitting readonly mutations',async()=>{
 let attempts=0;const api=createCloudApi(async(path,options)=>{if(path==='/api/session')return Response.json({user:{id:randomUUID(),username:'admin',role:'admin',permissions:['resources']},csrfToken:'a'.repeat(64)});if(path==='/api/equipment/receipts/'+key)return Response.json({id:owner});attempts++;assert.equal(options.headers['x-csrf-token'],'a'.repeat(64));throw Error('response lost');},{allowWrites:true});await api.session();await assert.rejects(api.equipmentHandover(owner,payload()),e=>e.uncertain);await assert.rejects(api.equipmentHandover(owner,payload()),e=>e.status===409);assert.deepEqual(await api.equipmentReceipt(key,'handover',owner),{id:owner});assert.equal(attempts,1);
 const readonly=createCloudApi(async()=>{throw Error('must not send');});await assert.rejects(readonly.uploadEquipmentImage(owner,new File([new Uint8Array([1])],'a.png',{type:'image/png'}),1,key),e=>e.status===405);await assert.rejects(readonly.removeEquipmentImage(owner,{requestKey:key,expectedVersion:1}),e=>e.status===405);
});
