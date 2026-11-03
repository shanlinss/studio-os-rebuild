import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startLocalDatabase} from '../../dev/local-database.mjs';
import {migrate} from '../../.build/server/migrations.js';
import {checkReadiness} from '../../.build/server/readiness.js';
import {createStudioApp} from '../../.build/server/app.js';
import {Authentication,hashPassword} from '../../.build/server/auth.js';
import {AccountLifecycle} from '../../.build/server/account-lifecycle.js';
import {createCloudApi} from '../../dist/cloud-api.mjs';
let local,db,app,base,auth,created,linked,firstPassword,createValue;const sessions=[],clients=[],diagnostics=[];
const secret=()=>randomBytes(24).toString('hex');
const request=(s,path,method='GET',body,csrf=true)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(s?{Cookie:'studio_session='+s.token,...(csrf?{'x-csrf-token':s.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const create=(extra={})=>({requestKey:randomUUID(),username:'new_'+randomBytes(6).toString('hex'),role:'employee',password:secret(),memberId:null,memberVersion:null,reason:'开通团队账号',...extra});
const reset=(extra={})=>({requestKey:randomUUID(),password:secret(),reason:'成员忘记密码，管理员重置',...extra});
const readAccount=async id=>(await clients[0].loginAccounts()).find(r=>r.id===id);
before(async()=>{
 local=await startLocalDatabase();db=local.db;await migrate(db);auth=new Authentication(db);
 for(const role of ['admin','employee','admin']){const username='life_'+randomBytes(6).toString('hex'),password=secret();const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(password)},${role}) RETURNING id`;sessions.push(await auth.login(username,password,'life-fixture'));}
 app=await createStudioApp(db,undefined,{diagnosticSink:e=>diagnostics.push(e)});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const s of sessions){const api=createCloudApi((path,options)=>{const headers=new Headers(options?.headers);headers.set('Cookie','studio_session='+s.token);headers.set('Origin',base);return fetch(base+path,{...options,headers});},{allowWrites:true});await api.session();clients.push(api);}
 await checkReadiness(db);
});
after(async()=>{if(app)await app.close();if(local)await local.stop();});
test('admin account creation binds the original member atomically without exposing credential data',async()=>{
 [linked]=await db.client`INSERT INTO studio_os.members(display_name) VALUES('待绑定成员') RETURNING id,version`;
 createValue=create({memberId:linked.id,memberVersion:linked.version});firstPassword=createValue.password;created=await clients[0].accountLifecycle(undefined,createValue);
 const user=await readAccount(created.id);assert.equal(user.username,createValue.username);assert.equal(user.version,1);assert.equal(user.role,'employee');assert.equal((await auth.login(user.username,firstPassword,'new-user')).user.id,created.id);
 const [m]=await db.client`SELECT * FROM studio_os.members WHERE id=${linked.id}`;assert.equal(m.login_account_id,created.id);assert.equal(m.version,2);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.identity_events WHERE entity_id=${m.id}`)[0].n,1);
 const [record]=await db.client`SELECT password_hash FROM studio_os.accounts WHERE id=${created.id}`;assert.match(record.password_hash,/^scrypt-v1:/);assert.notEqual(record.password_hash,firstPassword);
 const history=await clients[0].accountAccessHistory(created.id);assert.equal(history[0].action,'created');assert.equal(history[0].afterValue.id,created.id);assert.equal(history[0].reason,createValue.reason);
 const audit=await db.client`SELECT * FROM studio_os.account_lifecycle_events`;const publicData=JSON.stringify([audit,history,await clients[0].loginAccounts(),created,diagnostics]);assert.ok(!publicData.includes(firstPassword));assert.ok(!publicData.includes('password_hash'));assert.ok(!publicData.includes(record.password_hash));
});
test('completed operation keys replay once, are actor scoped and cannot be repurposed to new account metadata',async()=>{
 const api=clients[0];assert.deepEqual(await api.accountLifecycle(undefined,createValue),created);assert.deepEqual(await api.accountOperation(createValue.requestKey,'created'),created);
 assert.equal(await clients[2].accountOperation(createValue.requestKey,'created'),null);
 await assert.rejects(api.accountLifecycle(undefined,{...createValue,username:'changed_'+randomBytes(6).toString('hex')}),e=>e.status===409);
 const v=create(),responses=await Promise.all([request(sessions[0],'/admin/accounts','POST',v),request(sessions[0],'/admin/accounts','POST',v)]);assert.ok(responses.every(r=>r.status===201));assert.deepEqual(await responses[0].json(),await responses[1].json());
 assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.account_lifecycle_events WHERE actor_id=${sessions[0].user.id} AND request_key=${v.requestKey}`)[0].n,1);
});
test('duplicate usernames, stale/occupied/disabled members and a late audit failure roll back account creation',async()=>{
 const api=clients[0];await assert.rejects(api.accountLifecycle(undefined,create({username:createValue.username})),e=>e.status===409);
 for(const member of [linked,...await db.client`INSERT INTO studio_os.members(display_name,active) VALUES('停用成员',false) RETURNING id,version`]){const v=create({memberId:member.id,memberVersion:member.version});await assert.rejects(api.accountLifecycle(undefined,v),e=>e.status===409);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.accounts WHERE username=${v.username}`)[0].n,0);}
 const [m]=await db.client`INSERT INTO studio_os.members(display_name,version) VALUES('版本变化成员',2) RETURNING id`;
 await assert.rejects(api.accountLifecycle(undefined,create({memberId:m.id,memberVersion:1})),e=>e.status===409);
 const v=create({memberId:m.id,memberVersion:2});await db.client.unsafe("CREATE FUNCTION studio_os.reject_account_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$; CREATE TRIGGER reject_account_audit BEFORE INSERT ON studio_os.account_lifecycle_events FOR EACH ROW EXECUTE FUNCTION studio_os.reject_account_audit()");
 try{await assert.rejects(api.accountLifecycle(undefined,v),e=>e.status===500);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.accounts WHERE username=${v.username}`)[0].n,0);assert.equal((await db.client`SELECT login_account_id FROM studio_os.members WHERE id=${m.id}`)[0].login_account_id,null);assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.identity_events WHERE entity_id=${m.id}`)[0].n,0);}finally{await db.client.unsafe('DROP TRIGGER reject_account_audit ON studio_os.account_lifecycle_events; DROP FUNCTION studio_os.reject_account_audit()');}
});
test('password reset revokes every old session and preserves role, active state and original member binding',async()=>{
 const api=clients[0],before=await readAccount(created.id),old1=await auth.login(before.username,firstPassword,'before-reset-1'),old2=await auth.login(before.username,firstPassword,'before-reset-2'),v=reset();
 const done=await api.accountLifecycle(created.id,v,before.version);assert.equal(done.version,2);for(const s of [old1,old2])assert.equal((await request(s,'/session')).status,401);
 await assert.rejects(auth.login(before.username,firstPassword,'old-password'),e=>e.status===401);const next=await auth.login(before.username,v.password,'new-password');assert.equal(next.user.id,created.id);const after=await readAccount(created.id);assert.equal(after.role,before.role);assert.equal(after.active,before.active);assert.equal((await db.client`SELECT login_account_id FROM studio_os.members WHERE id=${linked.id}`)[0].login_account_id,created.id);
 const newer=reset();await api.accountLifecycle(created.id,newer,after.version);const replay=await api.accountLifecycle(created.id,{...v,password:secret()},before.version);assert.deepEqual(replay,done);assert.equal((await auth.login(before.username,newer.password,'latest-password')).user.id,created.id);await assert.rejects(auth.login(before.username,v.password,'replay-not-reset'),e=>e.status===401);
 assert.deepEqual(await api.accountOperation(v.requestKey,'password-reset',created.id),done);const history=await api.accountAccessHistory(created.id);assert.equal(history.filter(e=>e.action==='password-reset').length,2);assert.ok(!JSON.stringify(history).includes(v.password));
});
test('concurrent resets only apply one version and inactive accounts remain unable to log in',async()=>{
 const api=clients[0],before=await readAccount(created.id),values=[reset(),reset()];const outcomes=await Promise.all(values.map((v,i)=>request(sessions[i===0?0:2],'/admin/accounts/'+created.id+'/password-reset','POST',{...v,expectedVersion:before.version})));assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,409]);assert.equal((await readAccount(created.id)).version,before.version+1);
 let row=await readAccount(created.id);await api.updateAccountAccess(row.id,{role:row.role,active:false},row.version);row=await readAccount(row.id);const v=reset();await api.accountLifecycle(row.id,v,row.version);assert.equal((await readAccount(row.id)).active,false);await assert.rejects(auth.login(row.username,v.password,'disabled-reset'),e=>e.status===401);
});
test('reset failure rolls back the new hash, version, sessions and receipt',async()=>{
 const api=clients[0],v=create(),made=await api.accountLifecycle(undefined,v),login=await auth.login(v.username,v.password,'failure-target'),before=await readAccount(made.id),change=reset();
 await db.client.unsafe("CREATE FUNCTION studio_os.reject_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='password-reset' THEN RAISE EXCEPTION 'injected reset failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_reset_audit BEFORE INSERT ON studio_os.account_lifecycle_events FOR EACH ROW EXECUTE FUNCTION studio_os.reject_reset_audit()");
 try{await assert.rejects(api.accountLifecycle(made.id,change,before.version),e=>e.status===500);assert.deepEqual(await readAccount(made.id),before);assert.equal((await request(login,'/session')).status,200);assert.equal(await api.accountOperation(change.requestKey,'password-reset',made.id),null);assert.equal((await auth.login(v.username,v.password,'old-still-valid')).user.id,made.id);}finally{await db.client.unsafe('DROP TRIGGER reject_reset_audit ON studio_os.account_lifecycle_events; DROP FUNCTION studio_os.reject_reset_audit()');}
});
test('login verified against an obsolete password cannot create a session after a concurrent credential update',async()=>{
 const v=create(),made=await clients[0].accountLifecycle(undefined,v),encoded=await hashPassword(secret());let pending;
 await db.client.begin(async tx=>{await tx`SELECT id FROM studio_os.accounts WHERE id=${made.id} FOR UPDATE`;pending=auth.login(v.username,v.password,'credential-race').then(()=>({success:true}),e=>({status:e.status}));await new Promise(r=>setTimeout(r,600));await tx`UPDATE studio_os.accounts SET password_hash=${encoded} WHERE id=${made.id}`;await tx`DELETE FROM studio_os.sessions WHERE account_id=${made.id}`;});
 assert.deepEqual(await pending,{status:401});assert.equal((await db.client`SELECT count(*)::int AS n FROM studio_os.sessions WHERE account_id=${made.id}`)[0].n,0);
});
test('credentials operations enforce authentication, admin, CSRF, exact payloads and append-only auditing',async()=>{
 const api=clients[0],v=create(),path='/admin/accounts/'+created.id+'/password-reset';
 assert.equal((await request(null,'/admin/accounts','POST',v)).status,401);assert.equal((await request(sessions[1],'/admin/accounts','POST',v)).status,403);assert.equal((await request(sessions[0],'/admin/accounts','POST',v,false)).status,403);
 assert.equal((await request(sessions[1],path,'POST',{...reset(),expectedVersion:1})).status,403);assert.equal((await request(sessions[0],path,'POST',{...reset(),expectedVersion:1},false)).status,403);
 for(const change of [{password:'short'},{role:'superadmin'},{role:['admin']},{username:'无效账号'},{password_hash:'injected'},{memberId:null,memberVersion:1}])assert.equal((await request(sessions[0],'/admin/accounts','POST',{...v,...change})).status,400);
 await assert.rejects(api.accountLifecycle(sessions[0].user.id,reset(),1),e=>e.status===409);
 assert.equal((await request(sessions[1],'/admin/account-operations/'+createValue.requestKey)).status,403);
 for(const verb of ['UPDATE','DELETE'])await assert.rejects(db.client.unsafe(verb==='UPDATE'?'UPDATE studio_os.account_lifecycle_events SET reason=reason':'DELETE FROM studio_os.account_lifecycle_events'),e=>e.code==='23514');
 await clients[0].updateAccountAccess(sessions[2].user.id,{role:'employee',active:true},1);await assert.rejects(new AccountLifecycle(db).save(sessions[2].user,create()),e=>e.status===403);await checkReadiness(db);
});
