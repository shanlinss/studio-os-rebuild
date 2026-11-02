// Disposable read-only HTTP fixtures for UI checks. Never points to the cloud or a database.
import http from 'node:http';
import {createPreviewServer} from '../dev/read-only-preview.mjs';
const sectionIds=['workspace','business','resources','knowledge','people','finance','settings'];
const titles=['我的工作台','业务中心','资源中心','知识中心','人员中心','财务中心','系统设置'];
const fixtureId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const routes={
 '/api/session':{user:{id:fixtureId,username:'fixture_admin',role:'admin'}},
 '/api/navigation':sectionIds.map((id,i)=>({id,title:titles[i]})),
 '/api/workbench/profile':{profile:null},
 '/api/materials':[], '/api/templates':[], '/api/tasks':[], '/api/workbench/todos':[],
};
const upstream=http.createServer((req,res)=>{
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 const value=routes[req.url];res.writeHead(value===undefined?404:200,{'Content-Type':'application/json'});res.end(JSON.stringify(value??{statusCode:404,message:'Fixture unavailable'}));
});
await new Promise(resolve=>upstream.listen(0,'::1',resolve));
// IPv4 origin separates browser storage from the real cloud preview; no real session is forwarded.
const preview=createPreviewServer({upstreamPort:upstream.address().port,forwardSession:false});
preview.listen(4176,'127.0.0.1',()=>console.log('Disposable fixture preview: http://127.0.0.1:4176/#creation'));
const stop=()=>{preview.closeAllConnections();preview.close(()=>upstream.close());};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
