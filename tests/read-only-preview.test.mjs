import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPreviewServer} from '../dev/read-only-preview.mjs';
const cookie='studio_session='+'a'.repeat(64);
const listen=s=>new Promise(r=>s.listen(0,'::1',r));
const close=s=>new Promise(r=>s.close(r));
function request(port,path='/',{method='GET',headers={}}={}){return new Promise((resolve,reject)=>{
 const req=http.request({hostname:'::1',port,path,method,headers:{Host:`[::1]:${port}`,...headers}},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text:Buffer.concat(chunks).toString(),bytes:Buffer.concat(chunks)}));});req.on('error',reject);req.end();
});}
test('local preview allows only known GETs and never forwards a write or credential to another destination',async()=>{
 const seen=[];const upstream=http.createServer((req,res)=>{seen.push({method:req.method,path:req.url,cookie:req.headers.cookie});res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'unwanted=1'});res.end(JSON.stringify(req.url==='/api/session'?{user:{id:'u',username:'operator',role:'admin',superadmin:false,permissions:['finance']},csrfToken:'hidden'}:[]));});
 await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{
  const index=await request(port);assert.equal(index.status,200);assert.match(index.text,/content="cloud-readonly"/);
  const session=await request(port,'/api/session',{headers:{Cookie:cookie}});assert.equal(session.status,200);assert.equal(JSON.parse(session.text).csrfToken,undefined);assert.deepEqual(JSON.parse(session.text).user.permissions,['finance']);assert.equal(JSON.parse(session.text).user.superadmin,false);assert.equal(session.headers['set-cookie'],undefined);assert.equal(seen[0].cookie,cookie);
  const before=seen.length;
  for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS'])assert.equal((await request(port,'/api/materials',{method,headers:{Cookie:cookie}})).status,405);
  assert.equal((await request(port,'/api/admin/credentials',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await request(port,'/api/admin/account-operations/11111111-1111-4111-8111-111111111111',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await request(port,'/api/admin/accounts/11111111-1111-4111-8111-111111111111/password-reset',{method:'POST',headers:{Cookie:cookie}})).status,405);
  assert.equal((await request(port,'/api/materials?target=http://example.invalid')).status,400);
  assert.equal((await request(port,'/api/materials',{headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal((await request(port,'/api/materials',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await request(port,'/api/materials',{headers:{Host:'attacker.invalid'}})).status,403);
  for(const path of ['/.env','/../docs/requirements.md','/%2e%2e/docs/requirements.md','/app.js'])assert.equal((await request(port,path)).status,404);
  assert.equal(seen.length,before,'blocked traffic must not reach the upstream');
  for(const module of ['/account-lifecycle-contract.mjs','/account-lifecycle-editors.mjs','/admin-permissions.mjs','/daily-attendance.mjs'])assert.equal((await request(port,module)).status,200);
  assert.equal((await request(port,'/api/attendance/end-work',{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/daily?owner=other')).status,400);assert.equal(seen.length,before);
  assert.equal((await request(port,'/api/attendance/daily')).status,200);
  const read=await request(port,'/api/materials',{headers:{Cookie:cookie,'Sec-Fetch-Site':'same-origin'}});assert.equal(read.status,200);assert.equal(read.headers['cache-control'],'no-store');assert.equal(seen.at(-1).method,'GET');
 }finally{await close(preview);await close(upstream);}
});
test('private media GET keeps original bytes without forwarding uploads, receipts, HTML or arbitrary asset paths',async()=>{
 const id='11111111-1111-4111-8111-111111111111',path='/api/materials/'+id+'/assets/'+id,png=Buffer.from([137,80,78,71,13,10,26,10]);let seen=0,html=false;
 const upstream=http.createServer((req,res)=>{seen++;res.writeHead(200,{'Content-Type':html?'text/html':'image/png','Set-Cookie':'not-forwarded=1'});res.end(html?'<script>bad</script>':png);});
 await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{
  const image=await request(port,path);assert.equal(image.status,200);assert.deepEqual(image.bytes,png);assert.equal(image.headers['content-type'],'image/png');assert.equal(image.headers['set-cookie'],undefined);assert.match(image.headers['content-security-policy'],/media-src 'self' blob:/);
  assert.equal((await request(port,path+'/downloads',{method:'POST'})).status,405);assert.equal(seen,1);
  assert.equal((await request(port,path+'?download=1')).status,400);assert.equal((await request(port,'/api/materials/'+id+'/assets/not-an-id')).status,404);assert.equal(seen,1);
  html=true;assert.equal((await request(port,path)).status,502);
 }finally{await close(preview);await close(upstream);}
});
test('read-only financial receipt routes preserve the 10 MiB image contract and refuse mutations or disguised media',async()=>{
 const id='11111111-1111-4111-8111-111111111111',path='/api/finance/expenses/'+id+'/receipts/'+id;let mime='image/png',seen=0;const bytes=Buffer.alloc(8*1024*1024+1);
 const upstream=http.createServer((req,res)=>{seen++;res.writeHead(200,{'Content-Type':mime});res.end(bytes);});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{const result=await request(port,path);assert.equal(result.status,200);assert.deepEqual(result.bytes,bytes);assert.equal((await request(port,path,{method:'DELETE'})).status,405);assert.equal((await request(port,path,{method:'POST'})).status,405);assert.equal(seen,1);mime='video/mp4';assert.equal((await request(port,path)).status,502);assert.equal((await request(port,path+'?target=other')).status,400);assert.equal((await request(port,'/api/finance/expenses/'+id+'/receipts/not-a-uuid')).status,404);}finally{await close(preview);await close(upstream);}
});
test('equipment reads and modules are available without forwarding mutations, receipts or arbitrary queries',async()=>{
 const id='11111111-1111-4111-8111-111111111111',seen=[];const upstream=http.createServer((req,res)=>{seen.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/equipment/catalog?q=camera&offset=0&all=false','/api/equipment/loans?view=own&status=open&offset=0','/api/equipment/loans/'+id,'/api/equipment/catalog/'+id+'/history?offset=50'])assert.equal((await request(port,path)).status,200);const count=seen.length;
 for(const method of ['POST','PATCH','DELETE'])assert.equal((await request(port,'/api/equipment/catalog/'+id,{method})).status,405);
 assert.equal((await request(port,'/api/equipment/receipts/'+id)).status,404);assert.equal((await request(port,'/api/equipment/catalog?owner=someone')).status,400);assert.equal(seen.length,count);
 for(const path of ['/equipment-workspace.mjs','/equipment-contract.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});
test('warehouse preview forwards only scoped reads and keeps journal edits and recovery receipts inaccessible',async()=>{
 const id='11111111-1111-4111-8111-111111111111',seen=[];const upstream=http.createServer((req,res)=>{seen.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/warehouse/items?q=box&kind=packaging&active=all&offset=50','/api/warehouse/items/'+id,'/api/warehouse/items/'+id+'/movements?offset=50','/api/warehouse/items/'+id+'/movements/'+id,'/api/warehouse/items/'+id+'/events?offset=0','/api/warehouse/items/'+id+'/sample-targets?q=sample&offset=50','/api/warehouse/items/'+id+'/transfers?offset=50','/api/samples/catalog/'+id+'/transfers?offset=0'])assert.equal((await request(port,path)).status,200);const count=seen.length;
 for(const method of ['POST','PATCH','DELETE'])assert.equal((await request(port,'/api/warehouse/items/'+id+'/movements',{method})).status,405);
 assert.equal((await request(port,'/api/warehouse/receipts/'+id)).status,404);assert.equal((await request(port,'/api/warehouse/items?target=elsewhere')).status,400);assert.equal((await request(port,'/api/warehouse/items/'+id+'/movements/not-an-id')).status,404);assert.equal(seen.length,count);
 assert.equal((await request(port,'/api/warehouse/items/'+id+'/to-samples',{method:'POST'})).status,405);
 assert.equal((await request(port,'/api/warehouse/items/'+id+'/transfers?sampleId='+id)).status,400);assert.equal((await request(port,'/api/samples/catalog/'+id+'/transfers?owner=other')).status,400);assert.equal(seen.length,count);
 for(const path of ['/warehouse-view.mjs','/warehouse-editors.mjs','/warehouse-contract.mjs','/warehouse-transfer-editors.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});
test('attendance review preview exposes only scoped records and history while refusing review writes and private receipts',async()=>{
 const id='11111111-1111-4111-8111-111111111111',seen=[];const upstream=http.createServer((req,res)=>{seen.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/attendance/corrections?view=team&status=pending&offset=50','/api/attendance/corrections/'+id,'/api/attendance/periods/'+id,'/api/attendance/corrections/'+id+'/history?offset=50'])assert.equal((await request(port,path)).status,200);const count=seen.length;
 assert.equal((await request(port,'/api/attendance/corrections/'+id+'/decision',{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/corrections/'+id,{method:'PATCH'})).status,405);assert.equal((await request(port,'/api/attendance/receipts/'+id)).status,404);assert.equal((await request(port,'/api/attendance/corrections/'+id+'?owner=other')).status,400);assert.equal(seen.length,count);
 for(const module of ['/attendance-contract.mjs','/attendance-editors.mjs','/attendance-view.mjs'])assert.equal((await request(port,module)).status,200);
 }finally{await close(preview);await close(upstream);}
});
test('leave preview permits scoped reads only and never forwards submission, approval or cancellation',async()=>{
 const id='11111111-1111-4111-8111-111111111111',seen=[];const upstream=http.createServer((req,res)=>{seen.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/attendance/leaves?view=team&status=pending&from=2027-01-01&offset=50','/api/attendance/leaves/'+id,'/api/attendance/leaves/'+id+'/history?offset=50'])assert.equal((await request(port,path)).status,200);const count=seen.length;
 for(const action of ['decision','withdraw','revoke'])assert.equal((await request(port,'/api/attendance/leaves/'+id+'/'+action,{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/leaves',{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/leaves/'+id,{method:'PATCH'})).status,405);assert.equal((await request(port,'/api/attendance/leave-receipts/'+id)).status,404);assert.equal((await request(port,'/api/attendance/leaves/'+id+'?owner=other')).status,400);assert.equal(seen.length,count);
 for(const module of ['/leave-contract.mjs','/leave-editors.mjs','/leave-view.mjs'])assert.equal((await request(port,module)).status,200);
 }finally{await close(preview);await close(upstream);}
});
test('exception preview forwards scoped queue and history only, blocking review writes and private receipts',async()=>{
 const id='11111111-1111-4111-8111-111111111111',seen=[];const upstream=http.createServer((req,res)=>{seen.push(req.url);res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/attendance/exceptions?view=team&kind=late&status=pending&offset=50','/api/attendance/periods/'+id+'/exceptions','/api/attendance/periods/'+id+'/exceptions/history?offset=50'])assert.equal((await request(port,path)).status,200);const count=seen.length;
 assert.equal((await request(port,'/api/attendance/periods/'+id+'/exceptions',{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/exception-receipts/'+id)).status,404);assert.equal((await request(port,'/api/attendance/periods/'+id+'/exceptions?owner=other')).status,400);assert.equal(seen.length,count);
 for(const module of ['/exception-contract.mjs','/exception-editors.mjs','/exception-view.mjs'])assert.equal((await request(port,module)).status,200);
 }finally{await close(preview);await close(upstream);}
});

test('monthly preview allows calendar and own or team month reads but never schedule mutations or private receipts',async()=>{
 const seen=[],upstream=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/attendance/monthly?month=2020-01&memberId=11111111-1111-4111-8111-111111111111','/api/attendance/calendar?month=2020-01','/api/attendance/calendar/2020-01-01/history?offset=50'])assert.equal((await request(port,path)).status,200);const count=seen.length;assert.equal((await request(port,'/api/attendance/calendar/2020-01-01',{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/calendar-receipts/11111111-1111-4111-8111-111111111111')).status,404);assert.equal((await request(port,'/api/attendance/monthly?month=2020-01&salary=1')).status,400);assert.equal(seen.length,count);for(const path of ['/monthly-contract.mjs','/monthly-editors.mjs','/monthly-view.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});

test('month confirmation preview permits scoped version reads but blocks locks and private operation receipts',async()=>{
 const seen=[],upstream=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port,id='11111111-1111-4111-8111-111111111111';
 try{for(const path of ['/api/attendance/month-closures?month=2020-01&memberId='+id,'/api/attendance/month-closures/history?month=2020-01&memberId='+id+'&offset=50','/api/attendance/month-closures/'+id])assert.equal((await request(port,path)).status,200);const count=seen.length;assert.equal((await request(port,'/api/attendance/month-closures',{method:'POST'})).status,405);assert.equal((await request(port,'/api/attendance/month-closure-receipts/'+id)).status,404);assert.equal((await request(port,'/api/attendance/month-closures/'+id+'?owner=other')).status,400);assert.equal(seen.length,count);for(const path of ['/closure-contract.mjs','/closure-editors.mjs','/closure-view.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});

test('payroll preview forwards only permitted read queries and payroll session claims, never money mutations or private receipts',async()=>{
 const seen=[],id='11111111-1111-4111-8111-111111111111',upstream=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/session'?{user:{id,role:'admin',username:'salary',superadmin:false,permissions:['payroll']},csrfToken:'private'}:{}));});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{for(const path of ['/api/payroll/state?month=2020-01&memberId='+id,'/api/payroll/salaries?memberId='+id+'&offset=50','/api/payroll/drafts?month=2020-01&memberId='+id+'&offset=50'])assert.equal((await request(port,path)).status,200);const session=JSON.parse((await request(port,'/api/session')).text);assert.deepEqual(session.user.permissions,['payroll']);assert.equal(session.csrfToken,undefined);const count=seen.length;for(const path of ['/api/payroll/salaries','/api/payroll/drafts'])assert.equal((await request(port,path,{method:'POST'})).status,405);assert.equal((await request(port,'/api/payroll/receipts/'+id)).status,404);assert.equal((await request(port,'/api/payroll/state?month=2020-01&amount=100')).status,400);assert.equal(seen.length,count);for(const path of ['/payroll-contract.mjs','/payroll-editors.mjs','/payroll-view.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});

test('payroll confirmation preview reads scoped status but excludes export files, export audits, private receipts and writes',async()=>{
 const seen=[],upstream=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port,id='11111111-1111-4111-8111-111111111111';
 try{for(const path of ['/api/payroll/confirmations?month=2020-01&memberId='+id+'&offset=50','/api/payroll/confirmations/'+id,'/api/payroll/exportable?month=2020-01'])assert.equal((await request(port,path)).status,200);const count=seen.length;for(const path of ['/api/payroll/confirmations','/api/payroll/exports'])assert.equal((await request(port,path,{method:'POST'})).status,405);for(const path of ['/api/payroll/exports?month=2020-01','/api/payroll/exports/'+id,'/api/payroll/export-receipts/'+id,'/api/payroll/confirmation-receipts/'+id])assert.equal((await request(port,path)).status,404);assert.equal(seen.length,count);for(const path of ['/payroll-confirmation-contract.mjs','/payroll-confirmation-editors.mjs','/payroll-confirmation-view.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});

test('personnel and administrator payroll preview reads histories but blocks date changes, applicability writes and private receipts',async()=>{
 const seen=[],upstream=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end('{}');});await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port,id='11111111-1111-4111-8111-111111111111';
 try{for(const path of ['/api/admin/members/'+id+'/history?offset=50','/api/payroll/admin-reviews?month=2020-01&memberId='+id+'&offset=50'])assert.equal((await request(port,path)).status,200);const count=seen.length;for(const path of ['/api/admin/members/'+id+'/employment','/api/payroll/admin-reviews'])assert.equal((await request(port,path,{method:'POST'})).status,405);for(const path of ['/api/admin/employment-receipts/'+id,'/api/payroll/admin-review-receipts/'+id])assert.equal((await request(port,path)).status,404);assert.equal((await request(port,'/api/admin/members/'+id+'/history?salary=1')).status,400);assert.equal(seen.length,count);for(const path of ['/personnel-contract.mjs','/personnel-editors.mjs','/personnel-view.mjs'])assert.equal((await request(port,path)).status,200);
 }finally{await close(preview);await close(upstream);}
});
