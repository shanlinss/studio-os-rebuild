import test from 'node:test';
import assert from 'node:assert/strict';
import {materialModel,experimentModel,ownTasks,metricValue,taskModel,createCloudApi,ContractError,ApiError,validDate,taskProgress} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';

test('material metadata and version survive read adaptation; archive is not mapped to delete',()=>{
 const data={id,title:'Reference',version:7,metadata:{mediaType:'图文',category:'图片',tags:['封面'],notes:'Observation',status:'未测试',product:'Product'},assets:[{id:other}]};
 const mapped=materialModel(data);assert.equal(mapped.kind,'图片');assert.equal(mapped.version,7);assert.equal(mapped.archiveSupported,false);assert.deepEqual(mapped.sourceMetadata,data.metadata);assert.equal(mapped.assetCount,1);assert.equal(mapped.sourceMetadata.product,'Product');
 assert.throws(()=>materialModel({...data,metadata:{...data.metadata,tags:null}}),ContractError);
});
test('shared material references across rounds are not double counted or converted to new records',()=>{
 const m={id:other,title:'Shared material'};
 const mapped=experimentModel({id,title:'Experiment',version:2,status:'testing',finding:null,rounds:[{id,materials:[m],tasks:[]},{id:other,materials:[m],tasks:[]}]});
 assert.equal(mapped.materials.length,1);assert.equal(mapped.rounds.length,2);assert.equal(mapped.finding,null);assert.equal(mapped.phase,'测试中');
});
test('admin personal work never displays team tasks when member mapping is absent',()=>{
 const rows=[{id,title:'Own',memberId:id},{id:other,title:'Other',memberId:other}];
 assert.deepEqual(ownTasks(rows,null,'admin'),[]);assert.deepEqual(ownTasks(rows,{id},'admin').map(t=>t.title),['Own']);
});
test('employee task ownership stays server scoped when member ID is redacted',()=>{
 const rows=[{id,title:'Assigned task',memberId:null}];assert.equal(ownTasks(rows,{id},'employee').length,1);assert.throws(()=>ownTasks(rows,{id},'unknown'),ContractError);
});
test('task detail joins snapshot history by publication ID, preserving unknown and zero values',()=>{
 const result=taskModel({task:{id,title:'Task'},publications:[{id:'p1'},{id:'p2'}],snapshots:[{publicationId:'p1',views:0,likes:null},{publicationId:'p1',views:3,likes:1},{publicationId:'p2',views:null}]});
 assert.equal(result.publications[0].snapshots.length,2);assert.equal(result.publications[1].snapshots.length,1);assert.equal(metricValue(result.publications[0].snapshots[0].views),'0');assert.equal(metricValue(result.publications[0].snapshots[0].likes),'未记录');assert.throws(()=>metricValue(-1),ContractError);
});
test('401, denied reads and malformed results are errors, not empty sample fallback',async()=>{
 for(const status of [401,403,502]){const api=createCloudApi(async()=>new Response('{}',{status}));await assert.rejects(api.materials(),e=>e instanceof ApiError&&e.status===status);}
 const api=createCloudApi(async()=>new Response(JSON.stringify({wrong:'shape'})));await assert.rejects(api.materials(),ContractError);
});
test('read client sends only GET with same-origin session and does not expose mutation token',async()=>{
 const calls=[];const api=createCloudApi(async(path,opts)=>{calls.push({path,opts});return new Response(JSON.stringify({user:{id,username:'operator',role:'admin'},csrfToken:'not-for-this-client'}));});
 const session=await api.session();assert.deepEqual(Object.keys(session).sort(),['id','role','username']);assert.equal(calls[0].opts.method,'GET');assert.equal(calls[0].opts.credentials,'same-origin');assert.equal(calls[0].opts.cache,'no-store');
});
test('completion dates and administrator member scope are explicit',async()=>{
 const calls=[];const api=createCloudApi(async(path)=>{calls.push(path);return new Response(JSON.stringify({date:'2026-11-02',rows:[]}));});
 assert.deepEqual(await api.completed('2026-11-02',{role:'admin'},null),[]);assert.equal(calls.length,0);
 await api.completed('2026-11-02',{role:'admin'},{id});assert.match(calls[0],/date=2026-11-02/);assert.match(calls[0],new RegExp('member='+id));
 await api.completed('2026-11-02',{role:'employee'},{id});assert.doesNotMatch(calls[1],/member=/);assert.equal(validDate('2026-02-30'),false);
});

test('historical empty material metadata remains readable without inventing tags or type',()=>{const m=materialModel({id,title:'Historical',version:1,metadata:{}});assert.deepEqual(m.tags,[]);assert.equal(m.kind,'未分类');assert.deepEqual(m.sourceMetadata,{});});

test('task completion is not inferred from publication quantity and action work is not publishing work',()=>{assert.equal(taskProgress({kind:'action'}),'待完成');assert.equal(taskProgress({kind:'shooting',shootingStatus:'待补拍'}),'待补拍');assert.notEqual(taskProgress({kind:'publication',publishedCount:3,targetCount:3,filledCount:0}),'已完成');assert.equal(taskProgress({completedAt:'2026-11-02T02:00:00Z'}),'已完成');});
