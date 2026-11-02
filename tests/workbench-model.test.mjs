import test from 'node:test';
import assert from 'node:assert/strict';
import {todosForDate,completedTodos,todoEditable,businessForDate} from '../dist/workbench-model.mjs';
import {todoPayload,experimentDraftPayload,dispatchPayload,conclusionPayload} from '../dist/write-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
const todo={id,title:'准备复盘',version:1,status:'待开始',taskType:'测试复盘',priority:'中',notes:'',plannedOn:'2026-11-03',dueAt:'2026-11-03T10:00:00.000Z',completedAt:null};
test('scheduled personal work stays on its own day; legacy undated work stays explicitly ongoing',()=>{
 const legacy={...todo,id:'legacy',plannedOn:undefined,dueAt:undefined};assert.deepEqual(todosForDate([todo,legacy],'2026-11-02').map(t=>t.id),['legacy']);assert.equal(todosForDate([todo,legacy],'2026-11-03').length,2);assert.throws(()=>todoEditable(legacy),ContractError);
});
test('personal history uses actual Beijing completion day, never planned day or edited time',()=>{
 const done={...todo,status:'已完成',completedAt:'2026-11-02T16:30:00Z'};
 assert.equal(completedTodos([done],'2026-11-03').length,1);assert.equal(completedTodos([done],'2026-11-02').length,0);
 assert.equal(completedTodos([{...done,completedAt:null}],'2026-11-03').length,0);assert.equal(completedTodos([{...done,status:'进行中'}],'2026-11-03').length,0);
});
test('todo payload preserves explicit schedule and rejects erasure, ownership fields and invalid deadlines',()=>{
 const value=todoEditable(todo);assert.equal(todoPayload({...value,requestKey:id}).requestKey,id);assert.equal(todoPayload(value,3).expectedVersion,3);
 for(const changes of [{plannedOn:'2026-02-30'},{dueAt:'2026-11-02T18:00:00+08:00'},{ownerId:id}])assert.throws(()=>todoPayload({...value,...changes},3),ContractError);
 const {dueAt,...incomplete}=value;assert.throws(()=>todoPayload(incomplete,3),ContractError);
});
test('experiment draft and dispatch have separate contracts; duplicate assignments cannot become duplicate tasks',()=>{
 const draft={title:'封面对比',requestKey:id,materialIds:[id],lab:{hypothesis:'保持单变量',plannedPublishOn:null}};
 assert.equal(experimentDraftPayload(draft).materialIds[0],id);assert.throws(()=>experimentDraftPayload({...draft,assignments:[]}),ContractError);assert.throws(()=>experimentDraftPayload({...draft,materialIds:[]}),ContractError);
 const assignment={memberId:id,accountId:id,targetCount:1};assert.throws(()=>dispatchPayload({requestKey:id,assignments:[assignment,assignment]},1),ContractError);
 assert.throws(()=>conclusionPayload({verdict:'reusable',finding:'',recommendation:'',tags:[]},1),ContractError);
});
test('read-only mode and an old backend cannot receive new schedule or experiment writes',async()=>{
 let calls=0;const readonly=createCloudApi(async()=>{calls++;throw Error('must not reach HTTP');});
 await assert.rejects(readonly.createTodo({...todoEditable(todo),requestKey:id}),e=>e.status===405);await assert.rejects(readonly.createExperiment({title:'Draft',requestKey:id,materialIds:[id],lab:{}}),e=>e.status===405);assert.equal(calls,0);
 const sent=[];const old=createCloudApi(async(path,options)=>{sent.push(options.method);return new Response(JSON.stringify({personalTodoSchedule:0}),{status:200});},{allowWrites:true});
 await assert.rejects(old.createTodo({...todoEditable(todo),requestKey:id}),ContractError);assert.deepEqual(sent,['GET']);
});

test('closed experiments leave active daily work without inventing task completion facts',()=>{
 const rows=[{id:'closed',experimentStatus:'concluded',completedAt:null},{id:'live',experimentStatus:'testing',plannedPublishOn:'2026-11-02'},{id:'completed',experimentStatus:'concluded',completedAt:'2026-11-02T01:00:00Z'}];
 assert.deepEqual(businessForDate(rows,'2026-11-02').map(r=>r.id),['live','completed']);assert.equal(rows[0].completedAt,null);
});
