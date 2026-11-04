import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceProfileState,resourceProfilePayload,createResourceProfileEditors,createResourceProfileViews} from '../dist/resource-profiles.mjs';
import {handoverPayload,handoverState} from '../dist/equipment-assets-contract.mjs';
import {createEquipmentAssetsEditors} from '../dist/equipment-assets-editors.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',date='2026-01-01T00:00:00Z',target={id,name:'原资源',code:'R001',version:1};
const state=(kind='equipment-store')=>({kind,target,record:null,current:null,stores:[],history:{rows:[],total:0,offset:0,limit:50}});
const own={requestKey:id,expectedVersion:0,targetVersion:1,scope:'public',storeId:null,reason:'实际用途核对'};
const plan={requestKey:id,expectedVersion:0,targetVersion:1,planName:'基础套餐',fixedFee:'0.00',cycle:'monthly',billingDay:31,effectiveOn:'2026-01-01',details:'',reason:'运营商已确认'};
test('resource contracts distinguish zero tariff, unknown amount and independent explicit equipment ownership',()=>{
 assert.equal(resourceProfilePayload('card-plan',plan).fixedFee,'0.00');assert.equal(resourceProfilePayload('card-plan',{...plan,fixedFee:null}).fixedFee,null);assert.equal(resourceProfilePayload('equipment-store',own).scope,'public');assert.equal(resourceProfileState(state(),'equipment-store',id).record,null);
 for(const patch of [{fixedFee:'-1.00'},{fixedFee:'1.001'},{cycle:'yearly'},{effectiveOn:'2026-02-30'},{registeredEntity:'not here'}])assert.throws(()=>resourceProfilePayload('card-plan',{...plan,...patch}));assert.throws(()=>resourceProfilePayload('equipment-store',{...own,scope:'store'}));assert.throws(()=>resourceProfileState({...state(),target:{...target,id:'bad'}},'equipment-store',id));
});
test('handover review requires unique exact-version account choices and an explicit confirmation',()=>{
 const base={requestKey:id,expectedVersion:1,previousLoanId:null,previousLoanVersion:null,toMemberId:id,occurredAt:'2026-01-01T01:00:00Z',condition:'完好',location:'工位',note:'交接'},review={id,expectedVersion:1,link:'primary',sync:false};assert.equal(handoverPayload({...base,accountReview:[review],accountsConfirmed:true}).accountReview[0].sync,false);
 for(const patch of [{accountReview:[review],accountsConfirmed:false},{accountReview:[review,review],accountsConfirmed:true},{accountReview:[{...review,link:'unknown'}],accountsConfirmed:true}])assert.throws(()=>handoverPayload({...base,...patch}));
 const s={equipment:{id,name:'设备',assetTag:'R',status:'available',version:1},recipients:[],currentLoan:null,linkedAccounts:[{id,name:'原运营账号',version:1,active:true,link:'primary',responsibleMemberId:id,responsibleName:'原负责人'}]};assert.equal(handoverState(s,id).linkedAccounts.length,1);assert.throws(()=>handoverState({...s,linkedAccounts:[...s.linkedAccounts,...s.linkedAccounts]},id));
});
test('handover editor defaults to keeping owners and sends only explicitly selected sync decisions',async()=>{
 let submit,html,sent;const api={equipmentHandoverState:async()=>({equipment:{id,name:'设备',assetTag:'R',status:'available',version:1},currentLoan:null,recipients:[{id,displayName:'接收人'}],linkedAccounts:[{id,name:'原账号',version:3,active:true,link:'primary',responsibleMemberId:id,responsibleName:'原负责人'}]}),equipmentHandover:async(_id,v)=>{sent=v;},equipmentReceipt:async()=>null};const editor=createEquipmentAssetsEditors({api,h:String,mount:(_t,b,s)=>{html=b;submit=s;},select:()=>'',input:()=>'',area:()=>''});await editor.equipmentHandover(id);assert.match(html,/默认保留原负责人/);assert.match(html,/accountsConfirmed/);assert.doesNotMatch(html,/name="syncAccountIds"[^>]*checked/);await submit({get:k=>({occurredAt:'2026-01-01T09:00',accountsConfirmed:'on',toMemberId:id,location:'工位',condition:'完好',note:'核对'}[k]),getAll:()=>[]});assert.equal(sent.accountReview[0].sync,false);assert.equal(sent.accountReview[0].expectedVersion,3);
});
test('profile editors keep empty fixed fee unknown and send independent versions with private recovery',async()=>{
 let submit,html,sent,recover;const api={resourceProfile:async()=>state('card-plan'),saveResourceProfile:async(_kind,_id,v)=>{sent=v;},resourceProfileReceipt:async()=>({id})};const editor=createResourceProfileEditors({api,h:String,mount:(_t,b,s,_a,r)=>{submit=s;html=b;recover=r;},input:()=>'',select:()=>'',area:()=>''});await editor.resourceProfile('card-plan',id);assert.match(html,/不自动生成支出、充值或月度扣费/);await submit({get:k=>({planName:'套餐',fixedFee:'',cycle:'unknown',billingDay:'',effectiveOn:'2026-01-01',details:'',reason:'原来源'}[k])});assert.equal(sent.fixedFee,null);assert.equal(sent.targetVersion,1);assert.equal((await recover()).id,id);
});
test('resource views preserve original history and never expose maintenance controls in read-only mode',async()=>{
 const original=globalThis.document;globalThis.document={addEventListener(){}};let html='';try{const record={id,version:1,scope:'public',storeId:null,storeName:null,reason:'归属核对',actor:'管理员',createdAt:date};for(const writable of [true,false]){const view=createResourceProfileViews({api:{resourceProfile:async()=>({...state(),record,current:record,history:{rows:[record],total:1,offset:0,limit:50}})},h:String,showPanel:async(_title,render)=>{html=await render();},getUser:()=>({role:'admin',permissions:['resources']}),writable,notify(){},localTime:String});await view.detail('equipment-store',id);assert.match(html,/工作室公共/);assert.equal(html.includes('data-resource-profile-edit'),writable);}}finally{globalThis.document=original;}
});
test('profile API uses declared scoped reads and blocks read-only mutations before sending requests',async()=>{
 let calls=0;const api=createCloudApi(async()=>{calls++;return Response.json(state());});await api.resourceProfile('equipment-store',id);const n=calls;await assert.rejects(api.saveResourceProfile('equipment-store',id,own),e=>e.status===405);assert.equal(calls,n);await assert.rejects(api.resourceProfile('credentials',id));
});
