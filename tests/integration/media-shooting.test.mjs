import {checkReadiness} from '../../.build/server/readiness.js';
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
let sampleId,loanId;
test('original sample registration and stock remain admin-only; borrowing keeps shooting link and durable replay',async()=>{
 const admin=clients[0],worker=clients[1],registration={requestKey:randomUUID(),name:'隔离样品',warehouseLocation:'仓库 A-01',productId:null,keeperMemberId:members[0],notes:'原样品档案'};
 await assert.rejects(worker.sampleWrite('register',undefined,registration),e=>e.status===403);
 const created=await admin.sampleWrite('register',undefined,registration);sampleId=created.id;
 let row=(await admin.sampleCatalog()).rows.find(s=>s.id===sampleId);assert.equal(row.available_quantity,0);
 await assert.rejects(worker.sampleWrite('stock',sampleId,{requestKey:randomUUID(),quantity:3,note:''},row.version),e=>e.status===403);
 await admin.sampleWrite('stock',sampleId,{requestKey:randomUUID(),quantity:3,note:'实际入库'},row.version);
 const value={requestKey:randomUUID(),quantity:2,location:'拍摄台',shootingRequestId:shoot.id,note:'本次拍摄借用'};
 const [a,b]=await Promise.all([json(sessions[1],'/samples/catalog/'+sampleId+'/borrow','POST',value),json(sessions[1],'/samples/catalog/'+sampleId+'/borrow','POST',value)]);assert.equal(a.id,b.id);loanId=a.id;
 assert.equal((await admin.sampleCatalog()).rows.find(s=>s.id===sampleId).available_quantity,1);
 const loan=(await worker.sampleLoans()).rows.find(l=>l.id===loanId);assert.equal(loan.shooting_request_id,shoot.id);assert.ok(loan.shooting_title);assert.equal(loan.owner_id,sessions[1].user.id);assert.equal(loan.quantity,2);
 assert.deepEqual(await worker.sampleReceipt(value.requestKey,'borrow',sampleId),a);
 await assert.rejects(worker.sampleWrite('borrow',sampleId,{...value,quantity:1}),e=>e.status===409);
 await assert.rejects(clients[3].sampleWrite('borrow',sampleId,{...value,requestKey:randomUUID(),quantity:1}),e=>e.status===409);
 await assert.rejects(worker.sampleLoans({team:true}),e=>e.status===403);
});
test('partial returns and location changes preserve loan identity; other members and admin cannot return on behalf',async()=>{
 const worker=clients[1];let loan=(await worker.sampleLoans()).rows.find(l=>l.id===loanId);
 for(const other of [clients[0],clients[2]])await assert.rejects(other.sampleWrite('return',loanId,{requestKey:randomUUID(),quantity:1,note:''},loan.version),e=>e.status===404);
 await worker.sampleWrite('return',loanId,{requestKey:randomUUID(),quantity:1,note:'已交回一件'},loan.version);
 loan=(await worker.sampleLoans()).rows.find(l=>l.id===loanId);assert.equal(loan.returned_quantity,1);assert.equal(loan.version,2);
 await assert.rejects(worker.sampleWrite('relocate',loanId,{requestKey:randomUUID(),location:'整理台',note:''},1),e=>e.status===409);
 await worker.sampleWrite('relocate',loanId,{requestKey:randomUUID(),location:'整理台',note:'剩余一件'},loan.version);
 loan=(await worker.sampleLoans()).rows.find(l=>l.id===loanId);assert.equal(loan.location,'整理台');assert.equal(loan.id,loanId);
 await assert.rejects(worker.sampleWrite('return',loanId,{requestKey:randomUUID(),quantity:2,note:''},loan.version),e=>e.status===409);
 assert.equal((await clients[0].sampleCatalog()).rows.find(s=>s.id===sampleId).available_quantity,2);
 const value={requestKey:randomUUID(),quantity:1,note:'全部交回'};await worker.sampleWrite('return',loanId,value,loan.version);await worker.sampleWrite('return',loanId,value,loan.version);
 assert.equal((await clients[0].sampleCatalog()).rows.find(s=>s.id===sampleId).available_quantity,3);
 assert.ok(!(await worker.sampleLoans()).rows.some(l=>l.id===loanId));assert.ok((await worker.sampleLoans({status:'returned'})).rows.some(l=>l.id===loanId));
});
test('concurrent borrow cannot overdraw stock, while paged own loans remain scoped and complete across pages',async()=>{
 const admin=clients[0];let row=(await admin.sampleCatalog()).rows.find(s=>s.id===sampleId);
 const value=()=>({requestKey:randomUUID(),quantity:2,location:'拍摄区',shootingRequestId:null,note:''});
 const responses=await Promise.all([request(sessions[1],'/samples/catalog/'+sampleId+'/borrow','POST',value()),request(sessions[2],'/samples/catalog/'+sampleId+'/borrow','POST',value())]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 assert.equal((await admin.sampleCatalog()).rows.find(s=>s.id===sampleId).available_quantity,1);
 row=(await admin.sampleCatalog()).rows.find(s=>s.id===sampleId);await admin.sampleWrite('stock',sampleId,{requestKey:randomUUID(),quantity:55,note:''},row.version);
 for(let i=0;i<51;i++)await clients[1].sampleWrite('borrow',sampleId,{requestKey:randomUUID(),quantity:1,location:'分页验证',shootingRequestId:null,note:''});
 const first=await clients[1].sampleLoans({status:'all'}),second=await clients[1].sampleLoans({status:'all',offset:50});assert.equal(first.rows.length,50);assert.ok(second.rows.length>0);assert.equal(new Set([...first.rows,...second.rows].map(l=>l.id)).size,first.total);assert.ok([...first.rows,...second.rows].every(l=>l.owner_id===sessions[1].user.id));
});
test('follow-up experimental rounds stay under one experiment and can be dispatched later without copying history',async()=>{
 const api=clients[0],draft=await api.createExperiment({title:'连续轮次验证',requestKey:randomUUID(),materialIds:[material.id],lab:{hypothesis:'一次只改一个变量',direction:'封面',testVariable:'首轮变量',executionConditions:'同一产品',plannedPublishOn:null}});
 let root=await api.experiment(draft.experimentId);const first=root.rounds[0].id,key=randomUUID(),value={requestKey:key,title:'第二轮',materialIds:[material.id],lab:{adjustment:'根据首轮结果调整标题',testVariable:'只改标题',executionConditions:'保持同一产品',plannedPublishOn:'2026-11-04'}};
 const round=await api.nextRound(root.id,value,root.version);await api.nextRound(root.id,value,root.version);
 root=await api.experiment(root.id);assert.equal(root.rounds.length,2);assert.equal(root.rounds[0].id,first);assert.equal(root.rounds[1].id,round.id);assert.equal(root.rounds[1].tasks.length,0);assert.equal(root.rounds[1].requestKey,key);assert.equal(root.rounds[1].adjustment,value.lab.adjustment);
 await assert.rejects(clients[1].nextRound(root.id,{...value,requestKey:randomUUID()},root.version),e=>e.status===403);
 const product=await api.createProduct({name:'关联实验产品',storeId:null,notes:'产品资料',stages:['内容测试']});await api.experimentProduct(root.id,product.id,root.version);root=await api.experiment(root.id);assert.equal(root.linkedProductId,product.id);
 await api.experimentPriority(root.id,true,root.version);root=await api.experiment(root.id);assert.equal(root.priority,true);
 const account=(await api.businessAccounts()).find(a=>a.responsibleMemberId===members[1]);await api.dispatchRound(root.id,round.id,{requestKey:randomUUID(),assignments:[{accountId:account.id,memberId:members[1],targetCount:1}]},root.version);
 root=await api.experiment(root.id);assert.equal(root.rounds[0].tasks.length,0);assert.equal(root.rounds[1].tasks.length,1);assert.equal(root.materials.length,1);
});
test('team and basic directory edits preserve login identity and versioned facts while employee writes stay forbidden',async()=>{
 const api=clients[0];const member=await api.saveDirectory('member',undefined,{displayName:'新成员档案',jobTitle:'运营',startDate:'2026-11-02',employmentStatus:'在职'});assert.ok(member.id);
 let row=(await api.members()).find(m=>m.id===members[2]);const linked=row.loginAccountId;
 const update={displayName:row.displayName,jobTitle:'内容运营',startDate:'2026-11-01',employmentStatus:'在职',active:true};await api.saveDirectory('member',row.id,update,row.version);row=(await api.members()).find(m=>m.id===row.id);assert.equal(row.loginAccountId,linked);assert.equal(row.jobTitle,'内容运营');
 await assert.rejects(api.saveDirectory('member',row.id,update,1),e=>e.status===409);await assert.rejects(clients[1].saveDirectory('member',undefined,{displayName:'越权',jobTitle:'',startDate:null,employmentStatus:''}),e=>e.status===403);
 const store=await api.saveDirectory('store',undefined,{name:'基础店铺'});await api.saveDirectory('store',store.id,{name:'基础店铺更新',active:false},1);assert.equal((await api.stores()).find(s=>s.id===store.id).active,false);
 const account=await api.saveDirectory('account',undefined,{name:'基础运营账号',profileUrl:'https://example.com/local-account',responsibleMemberId:members[2],boundPhone:'测试绑定号',actualPhone:'测试实际号',remark:'保留备注'});
 await api.saveDirectory('account',account.id,{name:'基础运营账号更新',profileUrl:'https://example.com/local-account',responsibleMemberId:members[2],boundPhone:'测试绑定号',actualPhone:'测试实际号',remark:'保留备注',active:true},1);
 const saved=(await api.businessAccounts()).find(a=>a.id===account.id);assert.equal(saved.remark,'保留备注');assert.equal(saved.actualPhone,'测试实际号');
});
test('expense, settlement and recorded reimbursement stay one exact-cent ledger with version and replay protection',async()=>{
 const api=clients[0],category=await api.createExpenseCategory('隔离支出分类'),key=randomUUID();
 const value={expenseDate:'2026-11-02',description:'隔离拍摄支出',amount:'12.34',paymentMode:'advance',payerId:members[1],storeId:null,categoryId:category.id,note:'实际垫付',requestKey:key};
 const expense=await api.saveExpense(undefined,value);await api.saveExpense(undefined,value);
 let data=await api.finance(),record=data.records.find(r=>r.id===expense.id);assert.equal(String(record.amountCents),'1234');assert.equal(record.requestKey,key);assert.equal(data.records.filter(r=>r.requestKey===key).length,1);
 await assert.rejects(clients[1].saveExpense(undefined,{...value,requestKey:randomUUID()}),e=>e.status===403);
 const statementKey=randomUUID(),items=[{expenseId:record.id,expectedVersion:record.version}],statementValue={payerId:members[1],startDate:'2026-11-01',endDate:'2026-11-30',items,note:'确认选中支出',requestKey:statementKey};
 const settlement=await api.createSettlement(statementValue);await api.createSettlement(statementValue);data=await api.finance();let statement=data.settlements.find(s=>s.id===settlement.id);assert.equal(statement.totalCents,'1234');assert.equal(statement.remainingCents,'1234');assert.equal(statement.requestKey,statementKey);assert.equal(data.records.find(r=>r.id===expense.id).settlementId,settlement.id);
 const {requestKey,...editValue}=value;await assert.rejects(api.saveExpense(expense.id,editValue,data.records.find(r=>r.id===expense.id).version),e=>e.status===409);
 const paymentKey=randomUUID(),payment={settlementId:settlement.id,amount:'2.34',paidDate:'2026-11-02',note:'已发生部分报销',requestKey:paymentKey};await api.recordPayment(payment,statement.version);await api.recordPayment(payment,statement.version);
 data=await api.finance();statement=data.settlements.find(s=>s.id===settlement.id);assert.equal(statement.paidCents,'234');assert.equal(statement.remainingCents,'1000');assert.equal(data.payments.filter(p=>p.requestKey===paymentKey).length,1);
 await assert.rejects(api.recordPayment({...payment,amount:'10.01',requestKey:randomUUID()},statement.version),e=>e.status===409);
 await api.recordPayment({...payment,amount:'10.00',requestKey:randomUUID()},statement.version);data=await api.finance();assert.equal(data.settlements.find(s=>s.id===settlement.id).remainingCents,'0');
});
let receiptExpense,expenseReceipt;
test('original financial receipts retain private bytes up to 10 MiB with version and administrator boundaries',async()=>{
 const api=clients[0];receiptExpense=await api.saveExpense(undefined,{expenseDate:'2026-11-02',description:'凭证核对',amount:'5.00',paymentMode:'advance',payerId:members[1],storeId:null,categoryId:null,note:'原备注保留',requestKey:randomUUID()});
 const bytes=Buffer.alloc(8*1024*1024+1);png.copy(bytes);const file=new File([bytes],'大凭证.png',{type:'image/png'});expenseReceipt=await api.uploadExpenseReceipt(receiptExpense.id,file,1);
 let row=(await api.finance()).records.find(r=>r.id===receiptExpense.id);assert.equal(row.version,2);assert.equal(row.note,'原备注保留');assert.equal(row.receipts.length,1);assert.equal(row.receipts[0].size,bytes.length);
 assert.deepEqual(Buffer.from(await (await api.asset('expense',receiptExpense.id,expenseReceipt.id)).arrayBuffer()),bytes);
 await assert.rejects(clients[1].asset('expense',receiptExpense.id,expenseReceipt.id),e=>e.status===403);await assert.rejects(clients[1].uploadExpenseReceipt(receiptExpense.id,file,2),e=>e.status===403);
 await assert.rejects(api.uploadExpenseReceipt(receiptExpense.id,file,1),e=>e.status===409);
 const headers={'Content-Type':'image/png','x-file-name':encodeURIComponent('错误.png'),'x-expected-version':'2'};assert.equal((await request(sessions[0],'/finance/expenses/'+receiptExpense.id+'/receipts','POST',Buffer.from('<html>not image</html>'),headers)).status,400);
 const noCsrf=await fetch(base+'/api/finance/expenses/'+receiptExpense.id+'/receipts',{method:'POST',headers:{Cookie:'studio_session='+sessions[0].token,Origin:base,...headers},body:png});assert.equal(noCsrf.status,403);
 const tooLarge=await request(sessions[0],'/finance/expenses/'+receiptExpense.id+'/receipts','POST',Buffer.alloc(10485761),headers);assert.equal(tooLarge.status,413);
 row=(await api.finance()).records.find(r=>r.id===receiptExpense.id);assert.equal(row.version,2);assert.equal(row.receipts.length,1);
});
test('receipt scope, concurrent versions and explicit deletion preserve audit history without duplicate writes',async()=>{
 const api=clients[0],id=receiptExpense.id,headers={'Content-Type':'image/png','x-file-name':encodeURIComponent('凭证二.png'),'x-expected-version':'2'};
 const replies=await Promise.all([request(sessions[0],'/finance/expenses/'+id+'/receipts','POST',png,headers),request(sessions[0],'/finance/expenses/'+id+'/receipts','POST',png,headers)]);assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 let row=(await api.finance()).records.find(r=>r.id===id);assert.equal(row.version,3);assert.equal(row.receipts.length,2);
 const other=await api.saveExpense(undefined,{expenseDate:'2026-11-02',description:'另一支出',amount:'1.00',paymentMode:'company',payerId:null,storeId:null,categoryId:null,note:'',requestKey:randomUUID()});await assert.rejects(api.asset('expense',other.id,expenseReceipt.id),e=>e.status===404);
 await assert.rejects(clients[1].removeExpenseReceipt(id,expenseReceipt.id,row.version),e=>e.status===403);await assert.rejects(api.removeExpenseReceipt(id,expenseReceipt.id,2),e=>e.status===409);
 await api.removeExpenseReceipt(id,expenseReceipt.id,row.version);await assert.rejects(api.asset('expense',id,expenseReceipt.id),e=>e.status===404);
 row=(await api.finance()).records.find(r=>r.id===id);assert.equal(row.version,4);assert.equal(row.receipts.length,1);
 const history=await api.financeEvents(id);assert.equal(history.filter(e=>e.action==='uploaded').length,2);assert.equal(history.filter(e=>e.action==='deleted').length,1);assert.equal(history.find(e=>e.action==='deleted').detail.name,'大凭证.png');
});
test('settled expenses keep receipt reads available while blocking both uploads and deletion',async()=>{
 const api=clients[0],row=(await api.finance()).records.find(r=>r.id===receiptExpense.id),file=row.receipts[0];
 await api.createSettlement({payerId:members[1],startDate:'2026-11-01',endDate:'2026-11-30',items:[{expenseId:row.id,expectedVersion:row.version}],note:'锁定凭证',requestKey:randomUUID()});
 const fresh=(await api.finance()).records.find(r=>r.id===row.id);assert.ok(fresh.settlementId);assert.ok((await api.asset('expense',row.id,file.id)).size>0);
 await assert.rejects(api.uploadExpenseReceipt(row.id,new File([png],'结算后.png',{type:'image/png'}),fresh.version),e=>e.status===409);await assert.rejects(api.removeExpenseReceipt(row.id,file.id,fresh.version),e=>e.status===409);
 assert.equal((await api.finance()).records.find(r=>r.id===row.id).receipts.length,1);
});
test('expense category editing and deactivation preserve old associations and reject stale changes',async()=>{
 const api=clients[0],category=await api.createExpenseCategory('待维护分类');await api.updateExpenseCategory(category.id,'已维护分类',false,1);
 let saved=(await api.finance()).categories.find(c=>c.id===category.id);assert.equal(saved.active,false);assert.equal(saved.name,'已维护分类');assert.equal(saved.version,2);
 await assert.rejects(api.updateExpenseCategory(category.id,'过期覆盖',true,1),e=>e.status===409);await assert.rejects(clients[1].updateExpenseCategory(category.id,'越权',true,2),e=>e.status===403);
});
let accessTarget,accessPassword,accessAdmin;
test('account permissions reuse original identities, revoke sessions, and expose no hashes or credentials',async()=>{
 const api=clients[0];accessPassword=randomBytes(24).toString('hex');const username='access_'+randomBytes(6).toString('hex');
 [accessTarget]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(accessPassword)},'employee') RETURNING id,username`;
 const auth=new Authentication(db),logged=await auth.login(username,accessPassword,'access-target');
 const before=(await api.loginAccounts()).find(a=>a.id===accessTarget.id);assert.equal(before.version,1);assert.deepEqual(Object.keys(before).sort(),['active','id','role','username','version']);
 await assert.rejects(clients[1].updateAccountAccess(before.id,{role:'admin',active:true},before.version),e=>e.status===403);
 await api.updateAccountAccess(before.id,{role:'admin',active:true},before.version);
 assert.equal((await request(logged,'/session')).status,401);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.sessions WHERE account_id=${before.id}`)[0].n,0);
 const promoted=await auth.login(username,accessPassword,'access-promoted');assert.equal(promoted.user.role,'admin');accessAdmin=apiFor(promoted);await accessAdmin.session();
 const history=await api.accountAccessHistory(before.id);assert.equal(history.length,1);assert.equal(history[0].beforeValue.role,'employee');assert.equal(history[0].afterValue.role,'admin');assert.ok(!JSON.stringify(history).includes('password_hash'));assert.equal((await accessAdmin.loginAccounts()).find(a=>a.id===before.id).version,2);
});
test('role updates reject stale values, unsupported fields and self-lockout; deactivation prevents login',async()=>{
 const api=clients[0],me=await api.session();
 await assert.rejects(api.updateAccountAccess(me.id,{role:'employee',active:true},1),e=>e.status===409);await assert.rejects(api.updateAccountAccess(me.id,{role:'admin',active:false},1),e=>e.status===409);
 await assert.rejects(api.updateAccountAccess(accessTarget.id,{role:'employee',active:true},1),e=>e.status===409);
 assert.equal((await request(sessions[0],'/admin/accounts/'+accessTarget.id,'PATCH',{role:'admin',active:true,expectedVersion:2,password:'must reject'})).status,400);
 const noCsrf=await fetch(base+'/api/admin/accounts/'+accessTarget.id,{method:'PATCH',headers:{Cookie:'studio_session='+sessions[0].token,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({role:'employee',active:true,expectedVersion:2})});assert.equal(noCsrf.status,403);
 await api.updateAccountAccess(accessTarget.id,{role:'admin',active:false},2);await assert.rejects(accessAdmin.loginAccounts(),e=>e.status===401);
 await assert.rejects(new Authentication(db).login(accessTarget.username,accessPassword,'access-disabled'));
 const row=(await api.loginAccounts()).find(a=>a.id===accessTarget.id);assert.equal(row.active,false);assert.equal(row.version,3);
});
test('concurrent administrator changes cannot let two admins revoke one another simultaneously',async()=>{
 const auth=new Authentication(db),people=[];
 for(let i=0;i<2;i++){const username='mutual_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [user]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},'admin') RETURNING id`;people.push({user,session:await auth.login(username,password,'mutual-'+i)});}
 const replies=await Promise.all(people.map((p,i)=>request(p.session,'/admin/accounts/'+people[1-i].user.id,'PATCH',{role:'employee',active:true,expectedVersion:1})));
 assert.equal(replies.filter(r=>r.status===200).length,1);assert.ok(replies.some(r=>[401,403].includes(r.status)));
 const survivors=await db.client`SELECT id FROM studio_os.accounts WHERE id IN (${people[0].user.id},${people[1].user.id}) AND role='admin' AND active`;assert.equal(survivors.length,1);
});
test('member login association stays unique and preserves identity while making the existing own profile readable',async()=>{
 const api=clients[0],auth=new Authentication(db),password=randomBytes(24).toString('hex'),username='link_'+randomBytes(6).toString('hex');
 const [user]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},'employee') RETURNING id`;
 const session=await auth.login(username,password,'link-local');assert.equal((await json(session,'/workbench/profile')).profile,null);
 const member=await api.saveDirectory('member',undefined,{displayName:'待关联成员',jobTitle:'运营',startDate:null,employmentStatus:'在职'});await api.linkMemberLogin(member.id,user.id,1);
 const profile=(await json(session,'/workbench/profile')).profile;assert.equal(profile.id,member.id);assert.equal(profile.displayName,'待关联成员');
 const another=await api.saveDirectory('member',undefined,{displayName:'另一成员',jobTitle:'',startDate:null,employmentStatus:''});await assert.rejects(api.linkMemberLogin(another.id,user.id,1),e=>e.status===409);
 await assert.rejects(api.linkMemberLogin(member.id,accessTarget.id,1),e=>e.status===409);await assert.rejects(clients[1].linkMemberLogin(another.id,user.id,1),e=>e.status===403);
 assert.equal((await api.members()).find(m=>m.id===member.id).loginAccountId,user.id);
});

test('readiness rejects an incomplete account-access schema even when migration history claims it is current',async()=>{
 await checkReadiness(db);await db.client`ALTER TABLE studio_os.accounts RENAME COLUMN version TO temporarily_missing_version`;
 try{await assert.rejects(checkReadiness(db));}finally{await db.client`ALTER TABLE studio_os.accounts RENAME COLUMN temporarily_missing_version TO version`;}
 await checkReadiness(db);
});
