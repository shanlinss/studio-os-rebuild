import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,copyFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
let local,db,app,base,sessions=[],accounts=[],upgrade,legacyId;
const legacy={requestKey:randomUUID(),title:'旧版已完成事项',taskType:'素材收集',priority:'中',status:'已完成',notes:'迁移前已有记录'};
const request=(s,route,method='GET',body,headers={})=>fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,'x-csrf-token':s.csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async(s,route,method='GET',body)=>{const r=await request(s,route,method,body);assert.equal(r.status,method==='POST'?201:200,await r.clone().text());return r.json();};
const body=(extra={})=>({requestKey:randomUUID(),title:'隔离排期事项',taskType:'测试复盘',priority:'高',status:'待开始',notes:'保留原事项',plannedOn:'2099-01-02',dueAt:'2099-01-02T18:00:00+08:00',...extra});
before(async()=>{
 local=await startLocalDatabase();db=local.db;
 const old=await mkdtemp(path.join(tmpdir(),'studio-legacy-sql-'));
 try{
  for(const f of (await readdir('studio/migrations')).filter(f=>/^0(?:0[1-9]|[12]\d|3[0-3])_/.test(f)))await copyFile('studio/migrations/'+f,path.join(old,f));
  assert.equal((await migrate(db,old)).total,33);
 }finally{await rm(old,{recursive:true,force:true});}
 const auth=new Authentication(db);
 for(const [i,role]of ['admin','employee','employee'].entries()){
  const username='isolated_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
  const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;
  accounts.push(u.id);const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');await db.client`INSERT INTO studio_os.sessions(token_hash,account_id,csrf_token,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${u.id},${csrf},now()+interval '8 hours')`;sessions.push({token,csrf,user:{id:u.id,username,role}});
 }
 const {requestKey,...row}=legacy,hash=createHash('sha256').update(JSON.stringify(row)).digest('hex');
 [legacyId]=await db.client`INSERT INTO studio_os.personal_todos(owner_id,request_key,request_hash,title,task_type,priority,status,notes) VALUES(${accounts[1]},${requestKey},${hash},${row.title},${row.taskType},${row.priority},${row.status},${row.notes}) RETURNING id`;
 upgrade=await migrate(db);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.accounts WHERE superadmin`)[0].n,0);assert.deepEqual((await db.client`SELECT admin_permissions FROM studio_os.accounts WHERE id=${accounts[0]}`)[0].admin_permissions,['finance','account_security','personnel','resources']);app=await createStudioApp(db,path.resolve('dist'),{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('append-only migration preserves 33 existing checksums, old request replays and unknown historical dates',async()=>{
 assert.deepEqual(upgrade,{applied:22,total:55});assert.deepEqual(await migrate(db),{applied:0,total:55});
 const a=sessions[1],list=await json(a,'/workbench/todos'),row=list.find(r=>r.id===legacyId.id);
 assert.equal(row.plannedOn,null);assert.equal(row.dueAt,null);assert.equal(row.completedAt,null);assert.equal(row.version,1);
 assert.equal((await json(a,'/workbench/todos','POST',legacy)).id,legacyId.id);
 assert.equal((await json(a,'/workbench/capabilities')).personalTodoSchedule,1);
});
test('real HTTP authentication, CSRF and owner scope remain enforced for dated todos',async()=>{
 const [admin,a,b]=sessions;
 assert.equal((await request(null,'/workbench/todos')).status,401);
 assert.equal((await request(a,'/workbench/todos','POST',body(),{'x-csrf-token':''})).status,403);
 assert.equal((await request(a,'/workbench/todos','POST',body({ownerId:accounts[2]}))).status,400);
 const value=body(),created=await json(a,'/workbench/todos','POST',value),{requestKey,...edit}=value;
 for(const stranger of [admin,b]){
  assert.ok(!(await json(stranger,'/workbench/todos')).some(r=>r.id===created.id));
  assert.equal((await request(stranger,'/workbench/todos/'+created.id,'PATCH',{...edit,expectedVersion:1})).status,404);
 }
 const row=(await json(a,'/workbench/todos')).find(r=>r.id===created.id);assert.equal(row.plannedOn,value.plannedOn);assert.equal(row.dueAt,'2099-01-02T10:00:00.000Z');assert.equal(row.completedAt,null);
 assert.equal((await request(a,'/attendance/periods?view=own&offset=0')).status,200);assert.equal((await request(a,'/finance')).status,403);
});
test('concurrent create replays yield one durable row and changed replays conflict',async()=>{
 const a=sessions[1],value=body(),rows=await Promise.all([json(a,'/workbench/todos','POST',value),json(a,'/workbench/todos','POST',value)]);
 assert.equal(rows[0].id,rows[1].id);assert.equal((await json(a,'/workbench/todos')).filter(r=>r.requestKey===value.requestKey).length,1);
 assert.equal((await request(a,'/workbench/todos','POST',{...value,plannedOn:'2099-01-01'})).status,409);
});
test('versions prevent lost updates, old clients keep dates and completion uses actual transition time',async()=>{
 const a=sessions[1],value=body(),created=await json(a,'/workbench/todos','POST',value),{requestKey,...edit}=value;
 const outcomes=await Promise.all([request(a,'/workbench/todos/'+created.id,'PATCH',{...edit,notes:'编辑 A',expectedVersion:1}),request(a,'/workbench/todos/'+created.id,'PATCH',{...edit,notes:'编辑 B',expectedVersion:1})]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 const oldClient={title:value.title,taskType:'素材收集',priority:'中',status:'已完成',notes:'旧客户端更新',expectedVersion:2};
 await json(a,'/workbench/todos/'+created.id,'PATCH',oldClient);let row=(await json(a,'/workbench/todos')).find(r=>r.id===created.id);
 assert.equal(row.plannedOn,value.plannedOn);assert.equal(row.dueAt,'2099-01-02T10:00:00.000Z');assert.ok(Math.abs(Date.parse(row.completedAt)-Date.now())<10000);const actual=row.completedAt;
 await json(a,'/workbench/todos/'+created.id,'PATCH',{...oldClient,notes:'仅修改说明',expectedVersion:3});row=(await json(a,'/workbench/todos')).find(r=>r.id===created.id);assert.equal(row.completedAt,actual);
 await json(a,'/workbench/todos/'+created.id,'PATCH',{...edit,status:'进行中',expectedVersion:4});row=(await json(a,'/workbench/todos')).find(r=>r.id===created.id);assert.equal(row.completedAt,null);
 await json(a,'/workbench/todos/'+created.id,'PATCH',{...edit,plannedOn:null,dueAt:null,expectedVersion:5});row=(await json(a,'/workbench/todos')).find(r=>r.id===created.id);assert.equal(row.plannedOn,null);assert.equal(row.dueAt,null);
});
test('invalid schedule changes roll back and do not create audit events',async()=>{
 const a=sessions[1],value=body(),created=await json(a,'/workbench/todos','POST',value),{requestKey,...edit}=value;
 for(const changes of [{plannedOn:'0000-01-01'},{plannedOn:'2099-02-30'},{dueAt:'2099-01-01T12:00:00+08:00'},{dueAt:'2099-01-02T18:00'}])assert.equal((await request(a,'/workbench/todos/'+created.id,'PATCH',{...edit,...changes,expectedVersion:1})).status,400);
 const [row]=await db.client`SELECT version,(SELECT count(*)::int FROM studio_os.personal_todo_events WHERE todo_id=${created.id}) AS events FROM studio_os.personal_todos WHERE id=${created.id}`;
 assert.equal(row.version,1);assert.equal(row.events,1);
});

let labFixture;
async function prepareLab(){
 const admin=sessions[0],memberIds=[],accountIds=[];
 for(const i of [1,2]){
  const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${'隔离成员 '+i},${accounts[i]}) RETURNING id`;memberIds.push(m.id);
  const [a]=await db.client`INSERT INTO studio_os.business_accounts(name,responsible_member_id) VALUES(${'隔离运营账号 '+i},${m.id}) RETURNING id`;accountIds.push(a.id);
 }
 const material=await json(admin,'/materials','POST',{title:'隔离参考素材',sourceUrl:'https://example.com/reference',metadata:{},storeIds:[]});
 const draft={title:'先记录想法再安排执行',requestKey:randomUUID(),materialIds:[material.id],lab:{hypothesis:'封面是否影响点击',direction:'封面',testVariable:'只改变封面',executionConditions:'保持其他条件一致',plannedPublishOn:'2026-11-02'}};
 return {admin,memberIds,accountIds,material,draft};
}
test('a real experiment can be created without dispatch, preserving material references and durable create replays',async()=>{
 const f=await prepareLab();labFixture=f;
 assert.equal((await request(sessions[1],'/lab/experiments','POST',f.draft)).status,403);
 assert.equal((await request(f.admin,'/lab/experiments','POST',f.draft,{'x-csrf-token':''})).status,403);
 assert.equal((await request(f.admin,'/admin/plans','POST',{...f.draft,assignments:[]})).status,400,'legacy dispatch contract stays unchanged');
 const roots=await Promise.all([json(f.admin,'/lab/experiments','POST',f.draft),json(f.admin,'/lab/experiments','POST',f.draft)]);
 assert.equal(roots[0].experimentId,roots[1].experimentId);f.root=roots[0].experimentId;f.plan=roots[0].id;
 const detail=await json(f.admin,'/lab/experiments/'+f.root);assert.equal(detail.rounds.length,1);assert.equal(detail.rounds[0].tasks.length,0);assert.equal(detail.rounds[0].executionConditions,'保持其他条件一致');assert.equal(detail.rounds[0].materials[0].id,f.material.id);assert.equal(detail.rounds[0].requestKey,f.draft.requestKey);
 assert.equal((await json(sessions[1],'/lab/experiments')).length,0);
 const [counts]=await db.client`SELECT (SELECT count(*)::int FROM studio_os.tasks WHERE plan_id=${f.plan}) AS tasks,(SELECT count(*)::int FROM studio_os.workflow_events WHERE plan_id=${f.plan}) AS dispatches`;assert.deepEqual(counts,{tasks:0,dispatches:0});
});
test('dispatch validates current account ownership, serializes replays and never duplicates original tasks',async()=>{
 const f=labFixture,path='/lab/experiments/'+f.root+'/rounds/'+f.plan+'/assignments';
 const value={expectedVersion:1,requestKey:randomUUID(),assignments:[{memberId:f.memberIds[0],accountId:f.accountIds[0],targetCount:1}]};f.dispatch=value;
 assert.equal((await request(sessions[1],path,'POST',value)).status,403);
 assert.equal((await request(f.admin,path,'POST',{...value,assignments:[{memberId:f.memberIds[0],accountId:f.accountIds[1],targetCount:1}]})).status,400);
 assert.equal((await json(f.admin,'/lab/experiments/'+f.root)).version,1);
 const failedKey=randomUUID();assert.equal((await request(f.admin,path,'POST',{expectedVersion:1,requestKey:failedKey,assignments:[{memberId:f.memberIds[1],accountId:f.accountIds[1],targetCount:1},{memberId:f.memberIds[0],accountId:'ffffffff-ffff-ffff-ffff-ffffffffffff',targetCount:1}]})).status,400);
 const [rolledBack]=await db.client`SELECT (SELECT count(*)::int FROM studio_os.tasks WHERE plan_id=${f.plan}) AS tasks,(SELECT count(*)::int FROM studio_os.lab_dispatch_requests WHERE request_key=${failedKey}) AS receipts`;assert.deepEqual(rolledBack,{tasks:0,receipts:0});
 const results=await Promise.all([json(f.admin,path,'POST',value),json(f.admin,path,'POST',value)]);assert.deepEqual(results[0].taskIds,results[1].taskIds);assert.equal(results[0].taskIds.length,1);f.task=results[0].taskIds[0];
 assert.equal((await json(f.admin,path+'/'+value.requestKey)).taskIds[0],f.task);
 assert.equal((await request(sessions[1],path+'/'+value.requestKey)).status,403);
 assert.equal((await request(f.admin,path,'POST',{...value,requestKey:randomUUID(),expectedVersion:2})).status,409);
 assert.equal((await request(f.admin,path,'POST',{...value,requestKey:randomUUID(),assignments:[{memberId:f.memberIds[1],accountId:f.accountIds[1],targetCount:1}]})).status,409);
 const own=await json(sessions[1],'/tasks'),other=await json(sessions[2],'/tasks');assert.equal(own.length,1);assert.equal(own[0].id,f.task);assert.equal(other.length,0);
 assert.equal((await json(f.admin,'/lab/experiments/'+f.root)).rounds[0].tasks[0].id,f.task);
});
test('original task publication, observations, review and conclusion remain one linked flow with server permissions',async()=>{
 const f=labFixture,a=sessions[1],task='/tasks/'+f.task;
 assert.equal((await request(sessions[2],task)).status,404);
 const publication=await json(a,task+'/publications','POST',{url:'https://example.com/isolated-publication',publishedAt:'2026-11-02T10:00:00+08:00',materialId:f.material.id,title:'隔离发布',note:''});
 await json(a,task+'/publications/'+publication.id+'/snapshots','POST',{observedAt:'2026-11-02T11:00:00+08:00',views:0,likes:3});
 await json(a,task+'/publications/'+publication.id+'/snapshots','POST',{observedAt:'2026-11-02T12:00:00+08:00',views:10,likes:4});
 const detail=await json(a,task);assert.equal(detail.publications.length,1);assert.equal(detail.snapshots.length,2);assert.equal(detail.snapshots[0].publicationId,publication.id);assert.equal(detail.snapshots[0].views,0);assert.equal(detail.snapshots[0].conversions,null);
 await json(f.admin,'/lab/experiments/'+f.root+'/rounds/'+f.plan+'/reviews','POST',{expectedVersion:2,requestKey:randomUUID(),decision:'有信号，继续验证',note:'保留观察条件，样本尚少'});
 assert.equal((await request(a,'/lab/experiments/'+f.root+'/conclusion','POST',{expectedVersion:3,verdict:'conditional',finding:'条件不足',recommendation:'',tags:[]})).status,403);
 await json(f.admin,'/lab/experiments/'+f.root+'/conclusion','POST',{expectedVersion:3,verdict:'conditional',finding:'保留条件后继续验证',recommendation:'下一轮只调整封面',tags:['封面']});
 const root=await json(f.admin,'/lab/experiments/'+f.root);assert.equal(root.status,'concluded');assert.equal(root.finding,'保留条件后继续验证');assert.equal(root.rounds[0].tasks[0].id,f.task);
 assert.equal((await request(a,task+'/publications','POST',{url:'https://example.com/another',publishedAt:'2026-11-02T13:00:00+08:00',materialId:f.material.id})).status,409);
 const replay=await json(f.admin,'/lab/experiments/'+f.root+'/rounds/'+f.plan+'/assignments','POST',f.dispatch);assert.deepEqual(replay.taskIds,[f.task],'an acknowledged dispatch replay stays read-only even after conclusion');
});
