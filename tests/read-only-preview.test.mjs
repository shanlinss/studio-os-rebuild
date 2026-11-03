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
 const seen=[];const upstream=http.createServer((req,res)=>{seen.push({method:req.method,path:req.url,cookie:req.headers.cookie});res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'unwanted=1'});res.end(JSON.stringify(req.url==='/api/session'?{user:{id:'u',username:'operator',role:'admin'},csrfToken:'hidden'}:[]));});
 await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{
  const index=await request(port);assert.equal(index.status,200);assert.match(index.text,/content="cloud-readonly"/);
  const session=await request(port,'/api/session',{headers:{Cookie:cookie}});assert.equal(session.status,200);assert.equal(JSON.parse(session.text).csrfToken,undefined);assert.equal(session.headers['set-cookie'],undefined);assert.equal(seen[0].cookie,cookie);
  const before=seen.length;
  for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS'])assert.equal((await request(port,'/api/materials',{method,headers:{Cookie:cookie}})).status,405);
  assert.equal((await request(port,'/api/admin/credentials',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await request(port,'/api/materials?target=http://example.invalid')).status,400);
  assert.equal((await request(port,'/api/materials',{headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal((await request(port,'/api/materials',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await request(port,'/api/materials',{headers:{Host:'attacker.invalid'}})).status,403);
  for(const path of ['/.env','/../docs/requirements.md','/%2e%2e/docs/requirements.md','/app.js'])assert.equal((await request(port,path)).status,404);
  assert.equal(seen.length,before,'blocked traffic must not reach the upstream');
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
