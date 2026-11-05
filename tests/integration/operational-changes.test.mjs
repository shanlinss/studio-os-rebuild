import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {Workflow} from '../../.build/server/workflow.js';
import {BusinessAccounts} from '../../.build/server/business-accounts.js';
import {OperationalChanges} from '../../.build/server/operational-changes.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,plan;const people=[],sessions=[],clients=[],materials=[],accounts=[],tasks=[];
const req=(i,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'studio_session='+sessions[i].token,...(csrf?{'x-csrf-token':sessions[i].csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const archive=(r,extra={})=>({requestKey:randomUUID(),expectedVersion:r.version,archived:!r.archived,reason:'整理日常素材，保留原引用与附件',...extra});
const schedule=(r,extra={})=>({requestKey:randomUUID(),expectedVersion:r.scheduleVersion,plannedPublishOn:'2026-11-08',reason:'按实际内容工作安排改期',...extra});
const planBody=ids=>({requestKey:randomUUID(),title:'原内容执行安排',materialIds:ids,assignments:[{memberId:people[1].memberId,accountId:accounts[0].id,targetCount:2},{memberId:people[2].memberId,accountId:accounts[1].id,targetCount:1}],lab:{hypothesis:'原假设',direction:'内容验证',testVariable:'原变量',executionConditions:'原执行条件',plannedPublishOn:'2026-11-06'}});
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);await checkReadiness(db);const auth=new Authentication(db);
 for(const [role,superadmin]of [['admin',true],['employee',false],['employee',false],['admin',false]]){const username='ops_'+randomBytes(5).toString('hex'),password=randomBytes(24).toString('hex');const [p]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role,superadmin) VALUES(${username},${await hashPassword(password)},${role},${superadmin}) RETURNING id`;const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${username},${p.id}) RETURNING id`;people.push({...p,memberId:m.id});sessions.push(await auth.login(username,password,'ops-local'));}
 await db.client`UPDATE studio_os.members SET display_name='归档管理员' WHERE id=${people[0].memberId}`;
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();for(const s of sessions){const api=createCloudApi((p,o)=>{const headers=new Headers(o?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+p,{...o,headers});},{allowWrites:true});await api.session();clients.push(api);}
 for(const title of ['保留原引用的素材','独立素材'])materials.push(await clients[0].createMaterial({title,sourceUrl:'https://example.com/reference',metadata:{status:'有效',notes:'原观察说明'},storeIds:[]}));
 const registry=new BusinessAccounts(db);for(let i=1;i<=2;i++)accounts.push(await registry.save({name:'内容执行账号'+i,profileUrl:null,responsibleMemberId:people[i].memberId,boundPhone:null,actualPhone:null,remark:''},people[0].id));
 plan=await new Workflow(db).createPlan(sessions[0].user,planBody([materials[0].id]));const found=await clients[0].workTasks();for(let i=1;i<=2;i++)tasks.push(found.find(r=>r.memberId===people[i].memberId&&r.planId===plan.id));
 await clients[0].uploadMaterial(materials[0].id,new File([png],'原素材附件.png',{type:'image/png'}));
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('archive hides only new selection, retains metadata, originals, task references and byte access, and restores without duplication',async()=>{
 const api=clients[0],id=materials[0].id,before=await api.material(id),body=archive(before),saved=await api.saveOperationalChange('material-archive',id,body);assert.deepEqual(await api.saveOperationalChange('material-archive',id,body),saved);assert.deepEqual(await api.operationalReceipt('material-archive',id,body.requestKey),saved);
 let m=await api.material(id);assert.equal(m.archived,true);assert.equal(m.version,before.version+1);assert.deepEqual(m.sourceMetadata,before.sourceMetadata);assert.deepEqual(m.assets,before.assets);assert.deepEqual(m.storeIds,before.storeIds);assert.ok((await api.materials()).some(r=>r.id===id));assert.ok(!(await api.activeMaterials()).some(r=>r.id===id));assert.ok((await api.task(tasks[0].id)).materials.some(r=>r.id===id));assert.deepEqual(Buffer.from(await (await api.asset('material',id,m.assets[0].id)).arrayBuffer()),png);
 const result=await api.downloadMaterial(id,m.assets[0].id);await api.confirmMaterialDownload(id,m.assets[0].id,result.receipt);assert.equal(result.blob.size,png.length);
 await assert.rejects(api.updateMaterial(id,{title:'不能直接改',sourceUrl:m.sourceUrl,metadata:m.sourceMetadata,storeIds:m.storeIds},m.version),e=>e.status===409);await assert.rejects(api.uploadMaterial(id,new File([png],'归档后不可添加.png',{type:'image/png'})),e=>e.status===409);
 await api.saveOperationalChange('material-archive',id,archive(m));m=await api.material(id);assert.equal(m.archived,false);assert.ok((await api.activeMaterials()).some(r=>r.id===id));const history=await clients[1].operationalState('material-archive',id);assert.equal(history.history.total,2);assert.equal(history.history.rows[0].actor,'归档管理员');assert.doesNotMatch(JSON.stringify(history),new RegExp(sessions[0].user.username));
});
test('new plan and element/template references cannot bypass archive while previously arranged tasks can publish',async()=>{
 const api=clients[0],id=materials[0].id;await api.saveOperationalChange('material-archive',id,archive(await api.material(id)));const before=(await api.experiments()).length;
 const input=planBody([id]);assert.equal((await req(0,'/admin/plans','POST',input)).status,409);assert.equal((await api.experiments()).length,before);
 const [dimension]=await db.client`SELECT id FROM studio_os.reference_dimensions LIMIT 1`;await assert.rejects(db.client`INSERT INTO studio_os.material_elements(material_id,dimension_id,content,created_by) VALUES(${id},${dimension.id},'不能增加新拆解',${people[0].id})`,e=>e.code==='OPS01');
 await api.publish(tasks[0].id,{url:'https://example.com/original-publish',publishedAt:'2026-11-05T10:00:00+08:00',materialId:id,title:'原任务继续执行',note:''});assert.equal((await api.task(tasks[0].id)).publications.length,1);
 await api.saveOperationalChange('material-archive',id,archive(await api.material(id)));
});
test('reschedule moves only one task and preserves original round date, publications, assignments and original records',async()=>{
 const api=clients[0],id=tasks[0].id,before=await api.task(id),state=await api.operationalState('task-schedule',id),body=schedule(state.target),saved=await api.saveOperationalChange('task-schedule',id,body);assert.deepEqual(await api.saveOperationalChange('task-schedule',id,body),saved);
 const after=await api.task(id);assert.equal(after.plannedPublishOn,'2026-11-08');assert.equal(after.scheduleVersion,1);assert.deepEqual(after.publications,before.publications);assert.deepEqual(after.materials,before.materials);assert.equal(after.memberId,before.memberId);assert.equal(after.accountId,before.accountId);assert.equal((await api.task(tasks[1].id)).plannedPublishOn,'2026-11-06');assert.equal((await db.client`SELECT planned_publish_on::text AS day FROM studio_os.plans WHERE id=${plan.id}`)[0].day,'2026-11-06');
 const h=await api.operationalState('task-schedule',id);assert.equal(h.history.rows[0].previousOn,'2026-11-06');assert.equal(h.history.rows[0].plannedPublishOn,'2026-11-08');assert.equal(h.history.rows[0].snapshot.publishedCount,1);
 await api.saveOperationalChange('task-schedule',id,schedule(h.target,{plannedPublishOn:null}));assert.equal((await api.task(id)).plannedPublishOn,null);assert.equal((await api.task(tasks[1].id)).plannedPublishOn,'2026-11-06');
});
test('schedule read history follows current task ownership, and employee writes or forged scope are rejected',async()=>{
 const id=tasks[0].id;assert.equal((await req(1,'/operational-changes/task-schedule/'+id)).status,200);assert.equal((await req(2,'/operational-changes/task-schedule/'+id)).status,404);const s=await clients[0].operationalState('task-schedule',id);assert.equal((await req(1,'/operational-changes/task-schedule/'+id,'POST',schedule(s.target))).status,403);
 await db.client`UPDATE studio_os.business_accounts SET responsible_member_id=${people[2].memberId} WHERE id=${accounts[0].id}`;assert.equal((await req(1,'/operational-changes/task-schedule/'+id)).status,404);await db.client`UPDATE studio_os.business_accounts SET responsible_member_id=${people[1].memberId} WHERE id=${accounts[0].id}`;
 assert.equal((await req(0,'/operational-changes/task-schedule/'+id+'?memberId='+people[2].memberId)).status,400);
});
test('concurrent schedule versions and late receipt failures cannot partially change dates or archive flags',async()=>{
 const api=clients[0],id=tasks[1].id,s=await api.operationalState('task-schedule',id),rs=await Promise.all([0,3].map(i=>req(i,'/operational-changes/task-schedule/'+id,'POST',schedule(s.target))));assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);
 await db.client.unsafe(`CREATE FUNCTION studio_os.fail_ops_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ops rollback'; END; $$; CREATE TRIGGER fail_ops_receipt BEFORE INSERT ON studio_os.operational_change_receipts FOR EACH ROW EXECUTE FUNCTION studio_os.fail_ops_receipt();`);
 try{const target=(await api.operationalState('task-schedule',id)).target;assert.equal((await req(0,'/operational-changes/task-schedule/'+id,'POST',schedule(target,{plannedPublishOn:'2026-11-09'}))).status,500);assert.equal((await api.operationalState('task-schedule',id)).target.plannedPublishOn,target.plannedPublishOn);const m=await api.material(materials[1].id);assert.equal((await req(0,'/operational-changes/material-archive/'+m.id,'POST',archive(m))).status,500);assert.equal((await api.material(m.id)).archived,false);}finally{await db.client.unsafe('DROP TRIGGER fail_ops_receipt ON studio_os.operational_change_receipts; DROP FUNCTION studio_os.fail_ops_receipt()');}
});
test('archive and schedule histories remain complete beyond fifty versions and private receipts remain private',async()=>{
 const api=clients[0],id=materials[1].id;while((await api.operationalState('material-archive',id)).history.total<52)await api.saveOperationalChange('material-archive',id,archive(await api.material(id)));const h=await api.operationalState('material-archive',id,50);assert.equal(h.history.total,52);assert.equal(h.history.rows.length,2);
 const task=tasks[1].id;while((await api.operationalState('task-schedule',task)).history.total<52){const state=await api.operationalState('task-schedule',task);await api.saveOperationalChange('task-schedule',task,schedule(state.target,{plannedPublishOn:state.target.plannedPublishOn==='2026-11-08'?'2026-11-09':'2026-11-08'}));}assert.equal((await api.operationalState('task-schedule',task,50)).history.rows.length,2);
 const s=await api.operationalState('task-schedule',task),body=schedule(s.target,{plannedPublishOn:'2026-11-10'});await api.saveOperationalChange('task-schedule',task,body);assert.equal(await clients[3].operationalReceipt('task-schedule',task,body.requestKey),null);
 for(const table of ['material_archive_versions','task_schedule_versions','operational_change_receipts'])await assert.rejects(db.client.unsafe('DELETE FROM studio_os.'+table),e=>e.code==='23514');
});
test('completed or concluded content cannot be moved and malformed dates, missing reasons and CSRF are rejected',async()=>{
 const api=clients[0],id=tasks[0].id;await api.publish(id,{url:'https://example.com/completed-publish',publishedAt:'2026-11-05T11:00:00+08:00',materialId:materials[0].id,title:'第二篇完成原目标',note:''});let s=await api.operationalState('task-schedule',id);assert.equal((await req(0,'/operational-changes/task-schedule/'+id,'POST',schedule(s.target))).status,409);
 const other=tasks[1].id;s=await api.operationalState('task-schedule',other);for(const patch of [{plannedPublishOn:'2026-02-30'},{reason:''},{expectedVersion:-1},{memberId:people[1].memberId}])assert.equal((await req(0,'/operational-changes/task-schedule/'+other,'POST',schedule(s.target,patch))).status,400);assert.equal((await req(0,'/operational-changes/task-schedule/'+other,'POST',schedule(s.target),false)).status,403);
 const [root]=await db.client`SELECT id FROM studio_os.lab_experiments WHERE id=${plan.experimentId}`;await db.client`UPDATE studio_os.lab_experiments SET status='concluded' WHERE id=${root.id}`;assert.equal((await req(0,'/operational-changes/task-schedule/'+other,'POST',schedule(s.target))).status,409);
});
test('administrator downgrade is rechecked by new changes and archive is never a deletion shortcut',async()=>{
 const api=clients[0],id=materials[1].id,m=await api.material(id),old=sessions[3].user;await db.client`UPDATE studio_os.accounts SET role='employee',admin_permissions=ARRAY[]::text[] WHERE id=${people[3].id}`;await assert.rejects(new OperationalChanges(db).save(old,'material-archive',id,archive(m)),e=>e.status===403);assert.equal((await req(1,'/operational-changes/material-archive/'+id,'POST',archive(m))).status,403);
 assert.equal((await req(0,'/materials/'+id,'DELETE',{expectedVersion:m.version})).status,409);assert.equal((await api.material(id)).id,id);
});
