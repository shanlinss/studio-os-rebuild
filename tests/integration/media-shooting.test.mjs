import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {createCloudApi,ContractError} from '../../dist/cloud-api.mjs';
let local,db,app,base,sessions=[],members=[],clients=[],material,asset,shoot,shootTask;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=','base64');
const file=()=>new File([png],'隔离封面.png',{type:'image/png'});
const request=(s,route,method='GET',body,headers={})=>fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,'x-csrf-token':s.csrf}:{}),...headers},...(body===undefined?{}:{body:headers['Content-Type']?.startsWith('image/')||headers['Content-Type']==='video/mp4'?body:JSON.stringify(body)})});
const json=async(s,route,method='GET',body)=>{const r=await request(s,route,method,body);assert.equal(r.status,method==='POST'?201:200,await r.clone().text());return r.json();};
const apiFor=s=>createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);const auth=new Authentication(db);
 for(const [i,role]of ['admin','employee','employee','employee'].entries()){
  const username='media_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;
  if(i<3){const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${'隔离拍摄成员 '+i},${u.id}) RETURNING id`;members.push(m.id);}
  sessions.push(await auth.login(username,password,'media-local-'+i));
 }
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=apiFor(s);await api.session();clients.push(api);}
 material=await clients[0].createMaterial({title:'隔离素材',sourceUrl:'https://example.com/reference',metadata:{notes:'原观察',tags:['保留']},storeIds:[]});
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('original binary material storage validates bytes, retains metadata/version, and previews never mark receipt',async()=>{
 const api=clients[0];asset=await api.uploadMaterial(material.id,file());
 const detail=await api.material(material.id);assert.equal(detail.version,2);assert.equal(detail.sourceMetadata.notes,'原观察');assert.deepEqual(detail.tags,['保留']);assert.equal(detail.assets[0].download,null);
 const blob=await api.asset('material',material.id,asset.id);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);
 assert.equal((await request(null,'/materials/'+material.id+'/assets/'+asset.id)).status,401);
 assert.equal((await request(sessions[0],'/materials/'+material.id+'/assets','POST',Buffer.from('not an image'),{'Content-Type':'image/png','x-file-name':'bad.png'})).status,400);
 assert.equal((await request(sessions[0],'/materials/'+material.id+'/assets','POST',png,{'Content-Type':'image/png','x-file-name':encodeURIComponent('../outside.png')})).status,400);
 assert.equal((await request(sessions[0],'/materials/'+material.id+'/assets','POST',png,{'Content-Type':'image/png','x-file-name':'no-csrf.png','x-csrf-token':''})).status,403);
 const [counts]=await db.client`SELECT (SELECT count(*)::int FROM studio_os.material_assets WHERE material_id=${material.id}) AS files,(SELECT count(*)::int FROM studio_os.material_asset_downloads WHERE asset_id=${asset.id}) AS receipts`;assert.deepEqual(counts,{files:1,receipts:0});
});
test('download receipts are recorded only by explicit owner confirmation and repeated confirmation is idempotent',async()=>{
 const api=clients[0],result=await api.downloadMaterial(material.id,asset.id);assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),png);assert.equal((await api.material(material.id)).assets[0].download,null);
 const path='/materials/'+material.id+'/assets/'+asset.id+'/downloads/'+result.receipt;
 assert.equal((await request(sessions[1],path,'POST',{})).status,404);
 await api.confirmMaterialDownload(material.id,asset.id,result.receipt);await api.confirmMaterialDownload(material.id,asset.id,result.receipt);
 assert.ok((await api.material(material.id)).assets[0].download);
 const [counts]=await db.client`SELECT count(*)::int AS first FROM studio_os.material_asset_downloads WHERE asset_id=${asset.id} AND first_for_asset`;assert.equal(counts.first,1);
});
test('publication attachments remain scoped to the original task and publication identity',async()=>{
 const [account]=await db.client`INSERT INTO studio_os.business_accounts(name,responsible_member_id) VALUES('隔离发布账号',${members[1]}) RETURNING id`;
 const plan=await json(sessions[0],'/admin/plans','POST',{title:'隔离发布安排',requestKey:randomUUID(),materialIds:[material.id],assignments:[{memberId:members[1],accountId:account.id,targetCount:1}]});
 const task=(await clients[0].workTasks()).find(t=>t.planId===plan.id),pub=await clients[1].publish(task.id,{url:'https://example.com/media-local',publishedAt:'2026-11-02T10:00:00+08:00',materialId:material.id,title:'隔离发布',note:''});
 const saved=await clients[1].uploadPublication(task.id,pub.id,file()),blob=await clients[1].asset('publication',pub.id,saved.id,{taskId:task.id});assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);
 assert.equal((await clients[1].task(task.id)).publications[0].assets[0].id,saved.id);
 await assert.rejects(clients[2].asset('publication',pub.id,saved.id,{taskId:task.id}),e=>e.status===404);
});
test('shooting reuses existing plan/task, validates evidence, and keeps binary upload replay keys durable',async()=>{
 const api=clients[0],value={requestKey:randomUUID(),title:'隔离拍摄需求',productId:null,productDescription:'隔离样品',assigneeId:members[1],dueOn:'2026-11-03',summary:'逐项交付',items:[{id:null,title:'封面图片',kind:'图片',priority:'A',materialId:material.id,references:['沿用参考素材'],requirements:['背景干净']},{id:null,title:'使用视频',kind:'视频',priority:'B',materialId:null,references:[],requirements:['保持光线']}]};
 shoot=await api.createShooting(value);assert.equal((await api.createShooting(value)).id,shoot.id);let row=await api.shootingDetail(shoot.id);shootTask=row.taskId;assert.ok(shootTask);assert.equal(row.visibleItems.length,2);
 assert.equal((await request(sessions[3],'/shooting/requests/'+shoot.id)).status,403);
 await api.shootingState(shoot.id,{requestKey:randomUUID(),action:'start'},row.version);row=await api.shootingDetail(shoot.id);
 await assert.rejects(api.shootingState(shoot.id,{requestKey:randomUUID(),action:'deliver',nasPath:''},row.version),e=>e.status===409);assert.equal((await api.shootingDetail(shoot.id)).status,'拍摄中');
 const reference=await api.uploadShooting(shoot.id,file(),row.version,randomUUID(),{itemId:row.visibleItems[0].id,note:'原参考'});row=await api.shootingDetail(shoot.id);assert.equal(row.visibleAssets[0].kind,'reference');assert.equal(row.taskId,shootTask);
 const other=await clients[2].asset('shooting',shoot.id,reference.assetId);assert.deepEqual(Buffer.from(await other.arrayBuffer()),png,'authorized teammates share the request, not private publication tasks');
 await assert.rejects(api.uploadShooting(shoot.id,new File(['ftyp'],'clip.mp4',{type:'video/mp4'}),row.version,randomUUID(),{itemId:row.visibleItems[0].id}),ContractError);
 const key=randomUUID(),version=row.version,delivery=await api.uploadShooting(shoot.id,file(),version,key,{note:'交付文件'}),again=await api.uploadShooting(shoot.id,file(),version,key,{note:'交付文件'});assert.equal(again.assetId,delivery.assetId);
 row=await api.shootingDetail(shoot.id);assert.equal(row.visibleAssets.length,2);assert.equal(row.taskId,shootTask);assert.equal(row.version,version+1);
 await api.shootingState(shoot.id,{requestKey:randomUUID(),action:'deliver',nasPath:''},row.version);row=await api.shootingDetail(shoot.id);assert.equal(row.status,'待确认');
 await assert.rejects(api.shootingState(shoot.id,{requestKey:randomUUID(),action:'approve'},row.version),e=>e.status===409);
 await assert.rejects(api.shootingState(shoot.id,{requestKey:randomUUID(),action:'reshoot',feedback:' '},row.version),ContractError);
 const raw=await request(sessions[0],'/shooting/requests/'+shoot.id+'/state','POST',{requestKey:randomUUID(),expectedVersion:row.version,action:'reshoot',feedback:''});assert.equal(raw.status,400);
 await api.shootingState(shoot.id,{requestKey:randomUUID(),action:'reshoot',feedback:'补拍使用镜头'},row.version);row=await api.shootingDetail(shoot.id);assert.equal(row.status,'需补拍');assert.equal(row.feedback,'补拍使用镜头');
});
test('item completion, approval, archive and reopen preserve the original task, files and actual completion fact',async()=>{
 const api=clients[0],worker=clients[1];let row=await api.shootingDetail(shoot.id);await worker.shootingState(shoot.id,{requestKey:randomUUID(),action:'start'},row.version);
 for(const item of row.visibleItems){row=await api.shootingDetail(shoot.id);await worker.shootingItem(shoot.id,item.id,true,row.version,randomUUID());}
 row=await api.shootingDetail(shoot.id);await worker.shootingState(shoot.id,{requestKey:randomUUID(),action:'deliver',nasPath:'/隔离交付/测试目录'},row.version);row=await api.shootingDetail(shoot.id);await api.shootingState(shoot.id,{requestKey:randomUUID(),action:'approve'},row.version);
 row=await api.shootingDetail(shoot.id);const completed=row.lastCompletedAt;assert.equal(row.status,'已完成');assert.ok(Math.abs(Date.parse(completed)-Date.now())<10000);assert.equal(row.taskId,shootTask);assert.equal(row.visibleAssets.length,2);
 assert.ok((await worker.task(shootTask)).completedAt);await assert.rejects(worker.shootingState(shoot.id,{requestKey:randomUUID(),action:'reopen'},row.version),e=>e.status===403);
 await assert.rejects(worker.archiveShooting(shoot.id,true,row.version,randomUUID()),e=>e.status===403);
 await api.archiveShooting(shoot.id,true,row.version,randomUUID());row=await api.shootingDetail(shoot.id);assert.equal(row.archived,true);await api.archiveShooting(shoot.id,false,row.version,randomUUID());row=await api.shootingDetail(shoot.id);assert.equal(row.lastCompletedAt,completed);
 await api.shootingState(shoot.id,{requestKey:randomUUID(),action:'reopen'},row.version);row=await api.shootingDetail(shoot.id);assert.equal(row.taskId,shootTask);assert.equal((await worker.task(shootTask)).completedAt,null);
 const items=[...row.visibleItems].reverse().map(i=>({id:i.id,title:i.title,kind:i.kind,priority:i.priority,materialId:i.materialId,references:i.references,requirements:i.requirements}));
 await api.updateShooting(shoot.id,{requestKey:randomUUID(),title:row.title,productId:row.productId,productDescription:row.productDescription,assigneeId:members[2],dueOn:row.dueOn,summary:row.summary,items},row.version);row=await api.shootingDetail(shoot.id);assert.equal(row.taskId,shootTask);assert.deepEqual(row.visibleItems.map(i=>i.id),items.map(i=>i.id));assert.ok(row.visibleItems.every(i=>i.completed));
 await assert.rejects(worker.task(shootTask),e=>e.status===404);assert.equal((await clients[2].task(shootTask)).id,shootTask);
});

test('knowledge navigation reuses original records, preserves legacy bodies, and enforces administrator and version boundaries',async()=>{
 const api=clients[0],value={title:'拍摄规范',category:'团队规范',summary:'打开飞书阅读',tags:['拍摄'],sourceUrl:'https://studio.feishu.cn/docx/local-test'};
 const created=await api.createKnowledgeNavigation(value);let row=(await api.knowledge()).find(k=>k.id===created.id);assert.equal(row.kind,'link');assert.equal(row.body,'');assert.equal(row.version,1);
 await assert.rejects(clients[1].createKnowledgeNavigation(value),e=>e.status===403);
 await assert.rejects(clients[1].updateKnowledgeNavigation(row.id,value,row.version),e=>e.status===403);
 for(const sourceUrl of ['https://feishu.cn.evil.example/docx/test','https://example.com','http://studio.feishu.cn/docx/test','https://user@studio.feishu.cn/docx/test']){
  const response=await request(sessions[0],'/knowledge/navigation','POST',{...value,sourceUrl});assert.equal(response.status,400);
 }
 const noCsrf=await fetch(base+'/api/knowledge/navigation',{method:'POST',headers:{Cookie:'studio_session='+sessions[0].token,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(noCsrf.status,403);
 const legacy=await json(sessions[0],'/knowledge','POST',{title:'旧正文',entryType:'knowledge',kind:'article',body:'旧正文必须保留',category:'旧分类',tags:['原标签']});
 await api.updateKnowledgeNavigation(legacy.id,{...value,title:'旧规范入口'},1);
 row=(await api.knowledge()).find(k=>k.id===legacy.id);assert.equal(row.body,'旧正文必须保留');assert.equal(row.kind,'article');assert.equal(row.title,'旧规范入口');assert.equal(row.sourceUrl,value.sourceUrl);assert.equal(row.version,2);
 await assert.rejects(api.updateKnowledgeNavigation(legacy.id,{...value,title:'过期覆盖'},1),e=>e.status===409);
 const learning=await json(sessions[0],'/knowledge','POST',{title:'学习记录',entryType:'learning',kind:'article',body:'学习正文',tags:[]});
 await assert.rejects(api.updateKnowledgeNavigation(learning.id,value,1),e=>e.status===404);
 const events=await db.client`SELECT action,after_value FROM studio_os.knowledge_events WHERE asset_id=${legacy.id} ORDER BY created_at`;assert.equal(events.length,2);assert.equal(events[1].action,'updated');assert.equal(events[1].after_value.title,'旧规范入口');
 assert.ok((await clients[1].knowledge()).some(k=>k.id===created.id));
});
