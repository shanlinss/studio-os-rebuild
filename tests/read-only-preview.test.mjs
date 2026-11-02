import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPreviewServer} from '../dev/read-only-preview.mjs';
const cookie='studio_session='+'a'.repeat(64);
const listen=s=>new Promise(r=>s.listen(0,'::1',r));
const close=s=>new Promise(r=>s.close(r));
function request(port,path='/',{method='GET',headers={}}={}){return new Promise((resolve,reject)=>{
 const req=http.request({hostname:'::1',port,path,method,headers:{Host:`[::1]:${port}`,...headers}},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end();
});}
test('local preview allows only known GETs and never forwards a write or credential to another destination',async()=>{
 const seen=[];const upstream=http.createServer((req,res)=>{seen.push({method:req.method,path:req.url,cookie:req.headers.cookie});res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'unwanted=1'});res.end(JSON.stringify(req.url==='/api/session'?{user:{id:'u',username:'operator',role:'admin'},csrfToken:'hidden'}:[]));});
 await listen(upstream);const preview=createPreviewServer({upstreamPort:upstream.address().port});await listen(preview);const port=preview.address().port;
 try{
  const index=await request(port);assert.equal(index.status,200);assert.match(index.text,/content="cloud-readonly"/);
  const session=await request(port,'/api/session',{headers:{Cookie:cookie}});assert.equal(session.status,200);assert.equal(JSON.parse(session.text).csrfToken,undefined);assert.equal(session.headers['set-cookie'],undefined);assert.equal(seen[0].cookie,cookie);
  const before=seen.length;
  for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS'])assert.equal((await request(port,'/api/materials',{method,headers:{Cookie:cookie}})).status,405);
  assert.equal((await request(port,'/api/admin/accounts',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await request(port,'/api/materials?target=http://example.invalid')).status,400);
  assert.equal((await request(port,'/api/materials',{headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal((await request(port,'/api/materials',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await request(port,'/api/materials',{headers:{Host:'attacker.invalid'}})).status,403);
  for(const path of ['/.env','/../docs/requirements.md','/%2e%2e/docs/requirements.md','/app.js'])assert.equal((await request(port,path)).status,404);
  assert.equal(seen.length,before,'blocked traffic must not reach the upstream');
  const read=await request(port,'/api/materials',{headers:{Cookie:cookie,'Sec-Fetch-Site':'same-origin'}});assert.equal(read.status,200);assert.equal(read.headers['cache-control'],'no-store');assert.equal(seen.at(-1).method,'GET');
 }finally{await close(preview);await close(upstream);}
});
