import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccessObserver,accessStamp,clearAccessSurfaces} from '../dist/access-session.mjs';
import {createCloudApi} from '../dist/cloud-api.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
const id='11111111-1111-4111-8111-111111111111',user={id,username:'operator',role:'admin',superadmin:false,permissions:['finance']};
test('a denied JSON, binary or mutation response reports access status without replacing ordinary forbidden errors',async()=>{
 const seen=[],observer=createAccessObserver(async p=>new Response('',{status:p==='/api/a'?403:401}),{onAccessDenied:e=>seen.push(e)});assert.equal((await observer.fetch('/api/a')).status,403);assert.equal((await observer.fetch('/api/b')).status,401);assert.deepEqual(seen.map(e=>e.status),[403,401]);
 const login=createAccessObserver(async()=>new Response('',{status:401}),{onAccessDenied:()=>{throw Error('login callback should not run');}});assert.equal((await login.fetch('/api/login')).status,401);
});
test('an old pending response cannot return or invalidate a newly restored access context',async()=>{
 const old=deferred(),seen=[],observer=createAccessObserver(p=>p==='/old'?old.promise:Promise.resolve(Response.json({fresh:true})),{onAccessDenied:e=>seen.push(e)}),pending=observer.fetch('/old');observer.invalidate();assert.equal((await observer.fetch('/new')).status,200);old.resolve(new Response('',{status:401}));await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(seen.length,0);
});
test('JSON bodies that finish after access changed cannot repaint cached sensitive data',async()=>{
 let finish;const slow=new Response(new ReadableStream({start(c){finish=()=>{c.enqueue(new TextEncoder().encode('{"private":"expense"}'));c.close();};}}),{headers:{'Content-Type':'application/json'}}),observer=createAccessObserver(async()=>slow),response=await observer.fetch('/finance'),body=response.json();observer.invalidate();finish();await assert.rejects(body,e=>e.name==='AbortError');
 let finishSession;const slowSession=new Response(new ReadableStream({start(c){finishSession=()=>{c.enqueue(new TextEncoder().encode(JSON.stringify({user,csrfToken:'a'.repeat(64)})));c.close();};}}),{headers:{'Content-Type':'application/json'}}),api=createCloudApi(async()=>slowSession,{allowWrites:true}),pending=api.session();await new Promise(r=>setImmediate(r));api.invalidateAccess();finishSession();await assert.rejects(pending,e=>e.name==='AbortError');
});
test('bounded attachment streams reject remaining bytes after access invalidation',async()=>{
 let streamController;const r=new Response(new ReadableStream({start(c){streamController=c;}})),observer=createAccessObserver(async()=>r),response=await observer.fetch('/receipt'),reader=response.body.getReader();streamController.enqueue(new Uint8Array([1]));assert.equal((await reader.read()).value[0],1);observer.invalidate();await assert.rejects(reader.read(),e=>e.name==='AbortError');reader.releaseLock();
});
test('access stamps include exact store grants and ignore only array ordering',()=>{
 const a={canManageAll:false,quantityOperationsAvailable:true,productOperationsAvailable:true,grants:[{storeId:id,canMove:true,storeActive:true},{storeId:null,canMove:false}]};assert.equal(accessStamp({...user,permissions:['resources','finance']},a),accessStamp({...user,permissions:['finance','resources']},{...a,grants:[...a.grants].reverse()}));assert.notEqual(accessStamp(user,a),accessStamp(user,{...a,grants:a.grants.slice(1)}));assert.notEqual(accessStamp(user,a),accessStamp({...user,permissions:[]},a));
});
test('clearing access closes all dialogs and keeps an empty reusable detail container',()=>{
 let dispatched=false;const dialog={open:true,id:'cloud-detail',close(){this.open=false;},replaceChildren(...v){this.children=v;}},editor={...dialog,id:'editor'};const doc={querySelectorAll:()=>[dialog,editor],createElement:()=>({})};clearAccessSurfaces(doc,()=>{dispatched=true;});assert.equal(dispatched,true);assert.equal(dialog.open,false);assert.equal(editor.open,false);assert.equal(dialog.children[0].id,'cloud-detail-content');assert.equal(editor.children.length,0);
});
test('API observers cover private exports and media as well as JSON, and invalidation clears write authorization',async()=>{
 const seen=[],api=createCloudApi(async path=>path==='/api/session'?Response.json({user,csrfToken:'a'.repeat(64)}):new Response('',{status:401}),{allowWrites:true,onAccessDenied:e=>seen.push(e)});await api.session();await assert.rejects(api.payrollExportFile(id));assert.equal(seen[0].status,401);await assert.rejects(api.saveFinanceMonthScope({requestKey:id,month:'2026-01',expectedVersion:0,storeIds:[],reason:'范围'}),e=>e.status===401);assert.equal(seen.length,1);
 const media=createCloudApi(async()=>new Response('',{status:403}),{onAccessDenied:e=>seen.push(e)});await assert.rejects(media.asset('expense',id,id),e=>e.status===403);assert.equal(seen.at(-1).status,403);
});
test('successful login cancels older read results before accepting the new identity',async()=>{
 const old=deferred(),api=createCloudApi(p=>p==='/api/login'?Promise.resolve(Response.json({user,csrfToken:'a'.repeat(64)})):old.promise,{allowWrites:true}),pending=api.navigation();await api.login('operator','password');old.resolve(Response.json([]));await assert.rejects(pending,e=>e.name==='AbortError');
});
