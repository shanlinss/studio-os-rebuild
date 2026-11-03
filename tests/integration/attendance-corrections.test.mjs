import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth,created,original;const sessions=[],clients=[],people=[];
const request=(s,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,...(csrf?{'x-csrf-token':s.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const payload=(extra={})=>({requestKey:randomUUID(),periodId:null,direction:'in',proposedAt:'2020-01-01T01:00:00.123Z',reason:'核对真实发生时间',...extra});
const decision=(value='approved')=>({requestKey:randomUUID(),decision:value,note:'已与员工核实'});
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);
 for(const role of ['admin','employee','employee','admin']){const username='correction_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES('隔离补卡成员',${u.id}) RETURNING id`;people.push({...u,memberId:m.id});sessions.push(await auth.login(username,password,'correction-'+randomUUID()));}
 app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
 const [r]=await db.client`INSERT INTO studio_os.attendance_periods(owner_id,member_id,kind,work_date,approval_status,original_in,original_out) VALUES(${people[1].id},${people[1].memberId},'studio','2020-01-02','not-required','2020-01-02T01:00:00Z','2020-01-02T09:00:00Z') RETURNING *`;original=r;
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('employee request and detail reuse the original period and preserve originals through administrator approval',async()=>{
 const api=clients[1],v=payload({periodId:original.id,direction:'out',proposedAt:'2020-01-02T10:00:00.123Z'});created=await api.attendanceWrite('create',undefined,v);assert.deepEqual(await api.attendanceWrite('create',undefined,v),created);
 let d=await api.attendanceDetail(created.id,true);assert.equal(d.record.status,'pending');assert.equal(d.period.id,original.id);assert.equal(d.record.period_version,1);assert.equal(d.record.proposed_at,'2020-01-02T10:00:00.123Z');
 assert.equal((await api.attendanceCorrections({status:'pending'})).total,1);assert.equal((await clients[0].attendanceCorrections({view:'team',status:'pending'})).total,1);
 const v2=decision();await clients[0].attendanceWrite('decision',created.id,v2,d.record.version);await clients[0].attendanceWrite('decision',created.id,v2,d.record.version);
 d=await api.attendanceDetail(created.id,true);assert.equal(d.record.status,'approved');assert.equal(d.record.review_note,'已与员工核实');assert.ok(d.record.reviewed_at);assert.equal(d.period.original_in,'2020-01-02T01:00:00.000Z');assert.equal(d.period.original_out,'2020-01-02T09:00:00.000Z');assert.equal(d.period.adjusted_out,'2020-01-02T10:00:00.123Z');assert.equal(d.period.version,2);
 const history=await api.attendanceHistory(created.id,true);assert.equal(history.rows.filter(e=>e.action==='correction-applied').length,1);assert.equal(history.rows.filter(e=>e.action==='correction-approved').length,1);assert.deepEqual(await clients[0].attendanceReceipt(v2.requestKey,'decision',created.id),created);
});
test('source changes block stale approval, while employee edits refresh the source version without losing time precision',async()=>{
 const api=clients[1],made=await api.attendanceWrite('create',undefined,payload({periodId:original.id,direction:'in',proposedAt:'2020-01-02T00:30:01.456Z'}));let d=await api.attendanceDetail(made.id,true);
 await db.client`UPDATE studio_os.attendance_periods SET version=version+1 WHERE id=${original.id}`;
 await assert.rejects(clients[0].attendanceWrite('decision',made.id,decision(),d.record.version),e=>e.status===409);
 const v={requestKey:randomUUID(),proposedAt:d.record.proposed_at,reason:'已重新核对原记录'};await api.attendanceWrite('edit',made.id,v,d.record.version);d=await api.attendanceDetail(made.id,true);assert.equal(d.record.period_version,d.period.version);assert.equal(d.record.proposed_at,'2020-01-02T00:30:01.456Z');
 await clients[0].attendanceWrite('decision',made.id,decision(),d.record.version);assert.equal((await api.attendanceDetail(made.id,true)).record.status,'approved');
 await assert.rejects(api.attendanceWrite('edit',made.id,{requestKey:randomUUID(),proposedAt:v.proposedAt,reason:'不能改已审核申请'},d.record.version+1),e=>e.status===409);
});
test('rejection preserves source times, requires a reason and permits a later new request',async()=>{
 const api=clients[1],v=payload({periodId:original.id,direction:'out',proposedAt:'2020-01-02T09:45:00Z'}),made=await api.attendanceWrite('create',undefined,v),before=await api.attendanceDetail(original.id);
 assert.equal((await request(sessions[0],'/attendance/corrections/'+made.id+'/decision','POST',{requestKey:randomUUID(),expectedVersion:1,decision:'rejected',note:' '})).status,400);
 await clients[0].attendanceWrite('decision',made.id,{...decision('rejected'),note:'时间与实际不符，请补充说明'},1);const d=await api.attendanceDetail(made.id,true);assert.equal(d.record.status,'rejected');assert.equal(d.record.review_note,'时间与实际不符，请补充说明');assert.deepEqual((await api.attendanceDetail(original.id)).record,before.record);
 assert.ok((await api.attendanceWrite('create',undefined,{...v,requestKey:randomUUID()})).id);assert.ok((await api.attendanceCorrections({status:'rejected'})).rows.some(r=>r.id===made.id));
});
test('different keys cannot create duplicate pending requests, and simultaneous reviewers only apply one decision',async()=>{
 const api=clients[2],v=payload({proposedAt:'2019-03-01T01:00:00Z'}),made=await api.attendanceWrite('create',undefined,v);
 await assert.rejects(api.attendanceWrite('create',undefined,{...v,requestKey:randomUUID()}),e=>e.status===409);
 const replies=await Promise.all([request(sessions[0],'/attendance/corrections/'+made.id+'/decision','POST',{...decision('rejected'),expectedVersion:1}),request(sessions[3],'/attendance/corrections/'+made.id+'/decision','POST',{...decision('rejected'),expectedVersion:1})]);assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);assert.equal((await api.attendanceHistory(made.id,true)).rows.filter(e=>e.action==='correction-rejected').length,1);
});
test('missing historical start can be approved then completed through a separate linked checkout request',async()=>{
 const username='missing_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},'employee') RETURNING id`;await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES('无登录历史成员',${u.id})`;
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');const {createHash}=await import('node:crypto');await db.client`INSERT INTO studio_os.sessions(token_hash,account_id,csrf_token,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${u.id},${csrf},now()+interval '8 hours')`;
 let r=await request({token,csrf},'/attendance/corrections','POST',payload({proposedAt:'2019-01-01T01:00:00Z'}));const first=await r.json();assert.equal(r.status,201);await clients[0].attendanceWrite('decision',first.id,decision(),1);
 const d=await clients[0].attendanceDetail(first.id,true);assert.equal(d.record.status,'approved');assert.equal(d.period.original_in,null);assert.equal(d.period.adjusted_in,'2019-01-01T01:00:00.000Z');
 r=await request({token,csrf},'/attendance/corrections','POST',payload({periodId:d.period.id,direction:'out',proposedAt:'2019-01-01T09:00:00Z'}));assert.equal(r.status,201);const out=await r.json();await clients[0].attendanceWrite('decision',out.id,decision(),1);assert.equal((await clients[0].attendanceDetail(d.period.id)).period.adjusted_out,'2019-01-01T09:00:00.000Z');
});
test('future times, cross-day replacements, reversed times and spoofed source identities fail without a new request',async()=>{
 const path='/attendance/corrections';for(const change of [{proposedAt:'2099-01-01T00:00:00Z'},{proposedAt:'2020-01-03T01:00:00Z'},{direction:'out',proposedAt:'2020-01-02T00:00:00Z'},{ownerId:people[2].id}])assert.equal((await request(sessions[1],path,'POST',{...payload({periodId:original.id}),...change})).status,400);
 const owned=await clients[1].attendanceDetail(original.id);await assert.rejects(clients[1].attendanceWrite('create',undefined,payload({proposedAt:'2020-01-02T01:00:00Z'})),e=>e.status===409);assert.equal(owned.period.original_out,'2020-01-02T09:00:00.000Z');
});
test('source and request detail/history enforce ownership; requests and decisions enforce role and CSRF',async()=>{
 for(const path of ['/attendance/periods/'+original.id,'/attendance/corrections/'+created.id,'/attendance/corrections/'+created.id+'/history'])assert.equal((await request(sessions[2],path)).status,404);
 assert.equal((await request(sessions[1],'/attendance/corrections?view=team')).status,403);assert.equal((await request(sessions[1],'/attendance/corrections?view=own&memberId='+people[2].memberId)).status,400);assert.equal((await request(sessions[0],'/attendance/corrections?view=team&status=bad')).status,400);
 assert.equal((await request(sessions[1],'/attendance/corrections','POST',payload(),false)).status,403);assert.equal((await request(sessions[1],'/attendance/corrections/'+created.id+'/decision','POST',{...decision(),expectedVersion:1})).status,403);assert.equal((await request(sessions[0],'/attendance/corrections','POST',payload())).status,403);
});
test('failure in review audit rolls back the source change, request status, events and receipt together',async()=>{
 const api=clients[2],made=await api.attendanceWrite('create',undefined,payload({periodId:(await api.attendance()).rows[0].id,proposedAt:(await api.attendance()).rows[0].original_in}));const before=await api.attendanceDetail(made.id,true),v=decision();
 await db.client.unsafe("CREATE FUNCTION studio_os.reject_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='correction-approved' THEN RAISE EXCEPTION 'injected review failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_correction_audit BEFORE INSERT ON studio_os.attendance_events FOR EACH ROW EXECUTE FUNCTION studio_os.reject_correction_audit()");
 try{await assert.rejects(clients[0].attendanceWrite('decision',made.id,v,before.record.version),e=>e.status===500);const after=await api.attendanceDetail(made.id,true);assert.deepEqual(after.record,before.record);assert.deepEqual(after.period,before.period);assert.equal((await api.attendanceHistory(made.id,true)).rows.some(e=>e.action==='correction-applied'),false);assert.equal(await clients[0].attendanceReceipt(v.requestKey,'decision',made.id),null);}finally{await db.client.unsafe('DROP TRIGGER reject_correction_audit ON studio_os.attendance_events; DROP FUNCTION studio_os.reject_correction_audit()');}
});

test('request and history pagination cover every filtered record without duplicating IDs',async()=>{
 const api=clients[2];let first;
 for(let i=0;i<52;i++){const stamp=new Date(Date.UTC(2010,0,1+i,1)).toISOString(),made=await api.attendanceWrite('create',undefined,payload({proposedAt:stamp}));first??=made;}
 const a=await api.attendanceCorrections({from:'2010-01-01',to:'2010-02-21',status:'pending'}),b=await api.attendanceCorrections({from:'2010-01-01',to:'2010-02-21',status:'pending',offset:50});assert.equal(a.total,52);assert.equal(a.rows.length,50);assert.equal(b.rows.length,2);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,52);
 assert.equal((await api.attendanceDetail(first.id,true)).approvalBlocker,'other-open-period');
 for(let i=0;i<51;i++){const d=await api.attendanceDetail(first.id,true);await api.attendanceWrite('edit',first.id,{requestKey:randomUUID(),proposedAt:d.record.proposed_at,reason:'补充核对 '+i},d.record.version);}
 const h=await api.attendanceHistory(first.id,true),h2=await api.attendanceHistory(first.id,true,50);assert.equal(h.total,52);assert.equal(h.rows.length,50);assert.equal(h2.rows.length,2);assert.equal(new Set([...h.rows,...h2.rows].map(r=>r.id)).size,52);
});
