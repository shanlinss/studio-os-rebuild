import test from 'node:test';
import assert from 'node:assert/strict';
import {operationalState,operationalPayload,createOperationalEditors,createOperationalViews} from '../dist/operational-changes.mjs';
import {createCloudApi,materialModel} from '../dist/cloud-api.mjs';
import {businessForDate} from '../dist/workbench-model.mjs';
const id='11111111-1111-4111-8111-111111111111',date='2026-11-05T00:00:00Z';
const state=(kind)=>({kind,target:kind==='material-archive'?{id,title:'原素材',version:2,archived:false}:{id,title:'原执行事项',kind:'publication',scheduleVersion:0,canReschedule:true,plannedPublishOn:'2026-11-06',roundPlannedOn:'2026-11-06',experimentStatus:'testing'},history:{rows:[],total:0,offset:0,limit:50}});
test('material archive flags remain independent from testing metadata and preserve legacy read compatibility',()=>{
 const raw={id,title:'素材',version:1,metadata:{status:'有效',tags:['参考'],notes:'原观察'}};assert.equal(materialModel(raw).archiveSupported,false);const archived=materialModel({...raw,archived:true,archiveSupported:true});assert.equal(archived.archived,true);assert.equal(archived.sourceMetadata.status,'有效');assert.equal(archived.note,'原观察');assert.throws(()=>materialModel({...raw,archived:'yes'}));
});
test('operational contracts require versioned explicit state and preserve a cleared task date',()=>{
 assert.equal(operationalState(state('material-archive'),'material-archive',id).target.version,2);assert.equal(operationalState(state('task-schedule'),'task-schedule',id).target.scheduleVersion,0);const body={requestKey:id,expectedVersion:0,plannedPublishOn:null,reason:'取消本次日期，后续再安排'};assert.equal(operationalPayload('task-schedule',body).plannedPublishOn,null);
 for(const patch of [{plannedPublishOn:'2026-02-30'},{reason:''},{expectedVersion:-1},{memberId:id}])assert.throws(()=>operationalPayload('task-schedule',{...body,...patch}));assert.throws(()=>operationalPayload('material-archive',{requestKey:id,expectedVersion:1,archived:'true',reason:'原因'}));
});
test('archive editor saves a recoverable flag change while retaining original record identity and version',async()=>{
 let submit,html,sent,after,recover;const api={operationalState:async()=>state('material-archive'),saveOperationalChange:async(kind,owner,v)=>{sent={kind,owner,...v};},operationalReceipt:async()=>({id})};const editors=createOperationalEditors({api,h:String,mount:(_t,b,s,a,r)=>{html=b;submit=s;after=a;recover=r;},input:()=>'',area:()=>''});await editors.operationalChange('material-archive',id);assert.match(html,/已安排的执行、原引用、附件及测试状态保留/);await submit({get:()=> '整理归档'});assert.equal(sent.archived,true);assert.equal(sent.expectedVersion,2);assert.equal(sent.owner,id);assert.equal(after.operationKind,'material-archive');assert.equal((await recover()).id,id);
});
test('schedule editor changes one execution date only and refuses completed work before opening',async()=>{
 let submit,sent,html;const api={operationalState:async()=>state('task-schedule'),saveOperationalChange:async(_kind,_id,v)=>{sent=v;},operationalReceipt:async()=>null};const editor=createOperationalEditors({api,h:String,mount:(_t,b,s)=>{html=b;submit=s;},input:()=>'',area:()=>''});await editor.operationalChange('task-schedule',id);assert.match(html,/保留原轮次日期、同轮其他事项、已发布和已回填记录/);await submit({get:k=>k==='plannedPublishOn'?'':'实际改期'});assert.equal(sent.plannedPublishOn,null);assert.equal(sent.expectedVersion,0);assert.equal('planId' in sent,false);api.operationalState=async()=>({...state('task-schedule'),target:{...state('task-schedule').target,canReschedule:false}});await assert.rejects(editor.operationalChange('task-schedule',id));
});
test('history rendering keeps original before and after dates without adding maintenance controls',async()=>{
 const original=globalThis.document;globalThis.document={addEventListener(){}};let html='';try{const view=createOperationalViews({api:{operationalState:async()=>({...state('task-schedule'),history:{rows:[{id,version:1,previousOn:'2026-11-06',plannedPublishOn:null,reason:'重新安排',actor:'管理员',createdAt:date}],total:1,offset:0,limit:50}})},h:String,showPanel:async(_t,render)=>{html=await render();},localTime:String,notify(){}});await view.history('task-schedule',id);assert.match(html,/2026-11-06 → 未排期/);assert.doesNotMatch(html,/data-operational-edit/);}finally{globalThis.document=original;}
});
test('active material selection and workbench dates use source flags while read-only clients never send changes',async()=>{
 let calls=0;const api=createCloudApi(async()=>{calls++;return Response.json([{id,title:'归档素材',version:1,metadata:{},archived:true,archiveSupported:true},{id:'22222222-2222-4222-8222-222222222222',title:'在用素材',version:1,metadata:{},archived:false,archiveSupported:true}]);});assert.equal((await api.materials()).length,2);assert.equal((await api.activeMaterials()).length,1);const n=calls;await assert.rejects(api.saveOperationalChange('material-archive',id,{requestKey:id,expectedVersion:1,archived:true,reason:'整理'}),e=>e.status===405);assert.equal(calls,n);
 const rows=[{id,kind:'publication',plannedPublishOn:'2026-11-08',experimentStatus:'testing'}];assert.equal(businessForDate(rows,'2026-11-06').length,0);assert.equal(businessForDate(rows,'2026-11-08').length,1);
});
