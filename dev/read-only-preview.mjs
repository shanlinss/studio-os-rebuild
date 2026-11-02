import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ...['bootstrap.mjs', 'navigation.mjs', 'cloud-view.mjs', 'cloud-api.mjs'].map(name => ['/'+name, [name, 'text/javascript; charset=utf-8']]),
]);
const fixedRoutes = new Set(['/api/live','/api/health','/api/session','/api/navigation','/api/materials','/api/lab/experiments','/api/tasks','/api/workbench/todos','/api/workbench/profile','/api/workbench/completed']);
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const detailRoute = new RegExp(`^/api/(materials|lab/experiments|tasks)/${uuid}$`);
const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));

export function createPreviewServer({ root = defaultRoot, upstreamPort = 13102 } = {}) {
  const server = http.createServer(async (req, res) => {
    const finish = (status, data, type='application/json; charset=utf-8') => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));
    };
    const address=server.address();
    if (!address || typeof address==='string' || req.headers.host !== `[::1]:${address.port}`) { finish(403,{message:'Local preview host required'});return; }
    if(req.method!=='GET'){finish(405,{message:'This preview is read-only'});req.resume();return;}
    if(!req.url?.startsWith('/')||req.url.startsWith('//')){finish(400,{message:'Invalid path'});return;}
    let url;
    try{url=new URL(req.url,'http://'+req.headers.host);}catch{finish(400,{message:'Invalid path'});return;}
    if(url.pathname.startsWith('/api/')){
      const expected='http://'+req.headers.host;
      if ((req.headers.origin && req.headers.origin!==expected) || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) {finish(403,{message:'Same-origin request required'});return;}
      if(!fixedRoutes.has(url.pathname)&&!detailRoute.test(url.pathname)){finish(404,{message:'Read route unavailable'});return;}
      const allowedQuery=url.pathname==='/api/workbench/completed'?['date','source','member']:[];
      if([...url.searchParams.keys()].some(k=>!allowedQuery.includes(k))){finish(400,{message:'Unexpected query'});return;}
      const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('studio_session='));
      const cookie=cookies.length===1&&/^studio_session=[a-f0-9]{64}$/.test(cookies[0])?cookies[0]:undefined;
      const remote=http.request({hostname:'::1',port:upstreamPort,path:url.pathname+url.search,method:'GET',headers:{Accept:'application/json',...(cookie?{Cookie:cookie}:{})}},up=>{
        const chunks=[];let size=0;
        up.on('data',chunk=>{size+=chunk.length;if(size>12*1024*1024){up.destroy();finish(502,{message:'Read response too large'});}else chunks.push(chunk);});
        up.on('end',()=>{
          if (res.writableEnded)return;
          if((up.statusCode||500)>=300&&(up.statusCode||500)<400){finish(502,{message:'Upstream redirect refused'});return;}
          if(!(up.headers['content-type']||'').includes('application/json')){finish(502,{message:'Unexpected response type'});return;}
          try{
            let data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            // Read-only client does not receive mutation tokens or Set-Cookie headers.
            if(url.pathname==='/api/session'&&up.statusCode===200){const user=data.user;data={user:user&&{id:user.id,username:user.username,role:user.role}};}
            finish(up.statusCode||502,data);
          }catch{finish(502,{message:'Invalid JSON response'});}
        });
        up.on('error',()=>finish(502,{message:'Cloud connection interrupted'}));
      });
      remote.setTimeout(10000,()=>{remote.destroy();finish(504,{message:'Cloud connection timed out'});});
      remote.on('error',()=>finish(502,{message:'Cloud tunnel unavailable'}));
      res.on('close',()=>remote.destroy());remote.end();return;
    }
    const selected=staticFiles.get(url.pathname);
    if(!selected){finish(404,{message:'Page unavailable'});return;}
    try{
      let content=await readFile(path.join(root,selected[0]));
      if(selected[0]==='index.html')content=Buffer.from(content.toString('utf8').replace('name="studio-data-mode" content="prototype"','name="studio-data-mode" content="cloud-readonly"'));
      finish(200,content,selected[1]);
    }catch{finish(500,{message:'Preview resource unavailable'});}
  });
  return server;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createPreviewServer();
  server.on('error',()=>{console.error('Read-only preview could not start; check port 4174.');process.exitCode=1;});
  server.listen(4174,'::1',()=>console.log('Cloud read-only preview: http://[::1]:4174/'));
  const stop=()=>server.close();process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
