import {attendanceMetrics} from '../../.build/server/daily-attendance.js';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {Attendance} from '../../.build/server/attendance.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth,admin;
const request=(s,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,...(csrf?{'x-csrf-token':s.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function person(role='employee',linked=true,active=true){const username='attendance_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;let member;if(linked)[member]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id,active) VALUES('隔离考勤成员',${u.id},${active}) RETURNING id`;return {...u,username,password,memberId:member?.id};}
const login=p=>auth.login(p.username,p.password,'attendance-'+randomUUID());
async function apiFor(s){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();return api;}
const periods=p=>db.client`SELECT *,work_date::text AS work_date FROM studio_os.attendance_periods WHERE owner_id=${p.id} ORDER BY created_at,id`;
const ending=(state,extra={})=>({requestKey:randomUUID(),periodId:state.period.id,expectedVersion:state.period.version,...extra});
async function oldPeriod(p,{yesterday=false,ended=false}={}){const [r]=await db.client`WITH c AS (SELECT (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date-${yesterday?1:0}::integer AS d) INSERT INTO studio_os.attendance_periods(owner_id,member_id,kind,work_date,approval_status,original_in,original_out,version) SELECT ${p.id},${p.memberId},'studio',d,'not-required',d::timestamp AT TIME ZONE 'Asia/Shanghai',CASE WHEN ${ended} THEN d::timestamp AT TIME ZONE 'Asia/Shanghai' ELSE NULL END,4 FROM c RETURNING *`;return r;}
before(async()=>{local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);app=await createStudioApp(db,undefined,{diagnosticSink:()=>{}});await app.listen(0,'127.0.0.1');base=await app.getUrl();admin=await person('admin');await checkReadiness(db);});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('successful employee login records the first server time once; multiple devices and repeated login preserve it',async()=>{
 const p=await person(),a=await login(p),original=(await periods(p))[0];assert.equal((await periods(p)).length,1);assert.ok(original.original_in);assert.equal(original.original_out,null);
 const replies=await Promise.all([login(p),login(p)]);assert.equal(replies.length,2);const rows=await periods(p);assert.equal(rows.length,1);assert.equal(String(rows[0].original_in),String(original.original_in));assert.equal(rows[0].version,1);
 const [links]=await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_daily_links WHERE owner_id=${p.id}`;assert.equal(links.n,1);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_events WHERE owner_id=${p.id} AND action='login-started'`)[0].n,1);
 const state=await (await apiFor(a)).dailyAttendance();assert.equal(state.status,'working');assert.equal(state.period.id,original.id);assert.equal(state.insufficient,null);
 const httpPerson=await person(),response=await request(null,'/login','POST',{username:httpPerson.username,password:httpPerson.password});assert.equal(response.status,201);assert.match(response.headers.get('set-cookie'),/studio_session=/);assert.equal((await periods(httpPerson)).length,1);
});
test('ordinary logout never ends attendance and reopening the same day never overwrites the start',async()=>{
 const p=await person(),s=await login(p),before=(await periods(p))[0],api=await apiFor(s);await api.logout();assert.equal((await request(s,'/session')).status,401);assert.equal((await periods(p))[0].original_out,null);
 const next=await apiFor(await login(p)),state=await next.dailyAttendance();assert.equal(state.status,'working');assert.equal(state.period.id,before.id);assert.equal(String((await periods(p))[0].original_in),String(before.original_in));
});
test('end work records one original checkout, receipt and audit while revoking all existing device sessions',async()=>{
 const p=await person(),a=await login(p),b=await login(p),api=await apiFor(a),state=await api.dailyAttendance(),payload=ending(state);
 const response=await request(a,'/attendance/end-work','POST',payload);assert.equal(response.status,201);const saved=await response.json();assert.match(response.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);assert.equal(saved.id,state.period.id);
 for(const s of [a,b])assert.equal((await request(s,'/session')).status,401);const [after]=await periods(p);assert.equal(after.version,state.period.version+1);assert.ok(after.original_out);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.sessions WHERE account_id=${p.id}`)[0].n,0);
 const fresh=await login(p),freshApi=await apiFor(fresh),closed=await freshApi.dailyAttendance();assert.equal(closed.status,'finished');assert.equal(closed.period.id,after.id);assert.equal((await periods(p)).length,1);assert.equal(String((await periods(p))[0].original_out),String(after.original_out));
 const receipt=await request(fresh,'/attendance/receipts/'+payload.requestKey);assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),saved);
 const replay=await request(fresh,'/attendance/end-work','POST',payload);assert.equal(replay.status,201);assert.deepEqual(await replay.json(),saved);assert.equal((await periods(p))[0].version,after.version);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_events WHERE period_id=${after.id} AND action='day-ended'`)[0].n,1);
});
test('simultaneous end requests cannot duplicate checkout or advance the record twice',async()=>{
 const p=await person(),a=await login(p),b=await login(p),api=await apiFor(a),state=await api.dailyAttendance();const values=[ending(state),ending(state)];
 const responses=await Promise.all([request(a,'/attendance/end-work','POST',values[0]),request(b,'/attendance/end-work','POST',values[1])]);assert.equal(responses.filter(r=>r.status===201).length,1);assert.ok(responses.some(r=>[401,409].includes(r.status)));assert.equal((await periods(p))[0].version,2);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_receipts WHERE actor_id=${p.id} AND action='day-end'`)[0].n,1);
});
test('administrators, unavailable members and failed authentication do not create employee attendance',async()=>{
 const s=await login(admin),api=await apiFor(s);assert.equal((await api.dailyAttendance()).status,'not-applicable');assert.equal((await periods(admin)).length,0);
 for(const [path,body]of [['/attendance/studio/in',{requestKey:randomUUID()}],['/attendance/end-work',{requestKey:randomUUID(),periodId:randomUUID(),expectedVersion:1}],['/attendance/corrections',{requestKey:randomUUID(),periodId:null,direction:'in',proposedAt:'2020-01-01T00:00:00Z',reason:'不能管理员补本人卡'}]])assert.equal((await request(s,path,'POST',body)).status,403);
 for(const p of [await person('employee',false),await person('employee',true,false)]){const session=await login(p),state=await (await apiFor(session)).dailyAttendance();assert.equal(state.status,'unavailable');assert.equal((await periods(p)).length,0);}
 const p=await person();await assert.rejects(auth.login(p.username,'wrong-password','invalid-'+randomUUID()),e=>e.status===401);assert.equal((await periods(p)).length,0);
});
test('daily reads never create records for a surviving pre-existing session',async()=>{
 const p=await person(),token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');await db.client`INSERT INTO studio_os.sessions(token_hash,account_id,csrf_token,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${p.id},${csrf},now()+interval '8 hours')`;
 const api=await apiFor({token,csrf});assert.equal((await api.dailyAttendance()).status,'not-started');assert.equal((await api.dailyAttendance()).status,'not-started');assert.equal((await request({token,csrf},'/attendance/studio/in','POST',{requestKey:randomUUID()})).status,409);assert.equal((await periods(p)).length,0);
});
test('a single original period is adopted without rewriting history, and an ended day is never reopened',async()=>{
 for(const ended of [false,true]){const p=await person(),before=await oldPeriod(p,{ended}),session=await login(p),state=await (await apiFor(session)).dailyAttendance();assert.equal(state.status,ended?'finished':'working');const [after]=await periods(p);assert.equal(after.id,before.id);assert.equal(after.version,4);assert.equal(String(after.original_in),String(before.original_in));assert.equal(String(after.original_out),String(before.original_out));assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_events WHERE owner_id=${p.id}`)[0].n,0);assert.equal((await db.client`SELECT origin FROM studio_os.attendance_daily_links WHERE owner_id=${p.id}`)[0].origin,'legacy-adopted');}
});
test('previous-day missing checkout and duplicate legacy records remain pending rather than guessed or merged',async()=>{
 const old=await person(),before=await oldPeriod(old,{yesterday:true}),a=await login(old),aApi=await apiFor(a),state=await aApi.dailyAttendance();assert.equal(state.status,'needs-review');assert.equal(state.issue,'previous-open');assert.equal((await periods(old)).length,1);assert.equal((await periods(old))[0].original_out,null);
 assert.equal((await request(a,'/attendance/end-work','POST',{requestKey:randomUUID(),periodId:before.id,expectedVersion:4})).status,409);assert.equal((await request(a,'/session')).status,200);
 const p=await person();await oldPeriod(p);await oldPeriod(p);const duplicate=await (await apiFor(await login(p))).dailyAttendance();assert.equal(duplicate.issue,'multiple-periods');assert.equal((await periods(p)).length,2);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_daily_links WHERE owner_id=${p.id}`)[0].n,0);
});
test('late event failure rolls back checkout, version, receipt and session revocation',async()=>{
 const p=await person(),s=await login(p),api=await apiFor(s),state=await api.dailyAttendance(),v=ending(state),before=(await periods(p))[0];
 await db.client.unsafe("CREATE FUNCTION studio_os.reject_day_end() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='day-ended' THEN RAISE EXCEPTION 'injected checkout failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_day_end BEFORE INSERT ON studio_os.attendance_events FOR EACH ROW EXECUTE FUNCTION studio_os.reject_day_end()");
 try{assert.equal((await request(s,'/attendance/end-work','POST',v)).status,500);assert.deepEqual((await periods(p))[0],before);assert.equal((await request(s,'/session')).status,200);assert.equal((await request(s,'/attendance/receipts/'+v.requestKey)).status,404);}finally{await db.client.unsafe('DROP TRIGGER reject_day_end ON studio_os.attendance_events; DROP FUNCTION studio_os.reject_day_end()');}
});
test('failure during automatic login attendance rolls back the period, link, event and new session together',async()=>{
 const p=await person();await db.client.unsafe("CREATE FUNCTION studio_os.reject_login_attendance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='login-started' THEN RAISE EXCEPTION 'injected login event failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_login_attendance BEFORE INSERT ON studio_os.attendance_events FOR EACH ROW EXECUTE FUNCTION studio_os.reject_login_attendance()");
 try{await assert.rejects(login(p));assert.equal((await periods(p)).length,0);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.attendance_daily_links WHERE owner_id=${p.id}`)[0].n,0);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.sessions WHERE account_id=${p.id}`)[0].n,0);}finally{await db.client.unsafe('DROP TRIGGER reject_login_attendance ON studio_os.attendance_events; DROP FUNCTION studio_os.reject_login_attendance()');}
});
test('employee checkout enforces owner scope, CSRF and version; old manual routes cannot bypass daily semantics',async()=>{
 const p=await person(),other=await person(),s=await login(p),o=await login(other),api=await apiFor(s),state=await api.dailyAttendance(),v=ending(state);
 assert.equal((await request(s,'/attendance/end-work','POST',v,false)).status,403);assert.equal((await request(o,'/attendance/end-work','POST',v)).status,404);assert.equal((await request(s,'/attendance/end-work','POST',{...v,expectedVersion:99})).status,409);
 assert.equal((await request(s,'/attendance/end-work','POST',{...v,outAt:'2099-01-01T00:00:00Z'})).status,400);
 assert.equal((await request(s,'/attendance/studio/in','POST',{requestKey:randomUUID()})).status,409);assert.equal((await request(s,'/attendance/periods/'+state.period.id+'/out','POST',{requestKey:randomUUID()})).status,409);assert.equal((await periods(p))[0].original_out,null);
 await db.client`UPDATE studio_os.accounts SET role='admin' WHERE id=${p.id}`;await assert.rejects(new Attendance(db).studioIn(s.user,{requestKey:randomUUID()}),e=>e.status===403);await checkReadiness(db);
});

test('10:30 lateness and eight-hour duration are independent and lunch is not subtracted',()=>{
 const date='2026-11-03',stamp='2026-11-03T22:00:00+08:00';
 assert.deepEqual(attendanceMetrics(date+'T10:30:00+08:00',date+'T18:30:00+08:00',date,stamp),{durationMinutes:480,late:false,insufficient:false});
 assert.deepEqual(attendanceMetrics(date+'T10:31:00+08:00',date+'T18:31:00+08:00',date,stamp),{durationMinutes:480,late:true,insufficient:false});
 assert.deepEqual(attendanceMetrics(date+'T10:30:00+08:00',date+'T18:29:59+08:00',date,stamp),{durationMinutes:479,late:false,insufficient:true});
 assert.equal(attendanceMetrics(date+'T10:30:00.001+08:00',date+'T18:30:00.000+08:00',date,stamp).insufficient,true);
 assert.equal(attendanceMetrics(date+'T10:31:00+08:00',null,date,stamp).insufficient,null);
 assert.equal(attendanceMetrics(date+'T10:30:00+08:00','2026-11-04T01:00:00+08:00',date,'2026-11-04T02:00:00+08:00'),null);
});
