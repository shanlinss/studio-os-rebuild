// Disposable in-memory UI integration fixture. No cloud target, database, or persisted credentials.
import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {materialPayload,productPayload,publicationPayload,snapshotPayload} from '../dist/write-contract.mjs';
const root=new URL('../dist/',import.meta.url),files=new Set((await readdir(root)).filter(n=>/\.(mjs|js|css|html|svg)$/.test(n)));
const token='a'.repeat(64),uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',store='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',taskId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const materials=[],products=[],publications=[],snapshots=[];
const task={id:taskId,title:'隔离验证：发布与观察',kind:'publication',sourceType:'material',version:1,publishedCount:0,filledCount:0,targetCount:2,plannedPublishOn:null,assignee:'验证成员'};
const sectionIds=['workspace','business','resources','knowledge','people','finance','settings'];
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!=='127.0.0.1:4177')return json(res,403,{});
  const url=new URL(req.url,'http://127.0.0.1:4177'),path=url.pathname;
  if(!path.startsWith('/api/')){
   if(req.method!=='GET')return json(res,405,{});
   const file=path==='/'?'index.html':path.slice(1);if(!files.has(file))return json(res,404,{});
   let content=await readFile(new URL(file,root));if(file==='index.html')content=Buffer.from(content.toString().replace('name="studio-data-mode" content="prototype"','name="studio-data-mode" content="cloud-connected"'));
   res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html','Cache-Control':'no-store'});return res.end(content);
  }
  if(req.method==='GET'){
   const values={
    '/api/session':{user:{id:uid,username:'isolated_fixture',role:'admin'},csrfToken:token},
    '/api/navigation':sectionIds.map(id=>({id,title:id})),
    '/api/workbench/profile':{profile:null},'/api/workbench/todos':[],
    '/api/materials':materials,'/api/products':products,'/api/tasks':[{...task,publishedCount:publications.length,filledCount:new Set(snapshots.map(s=>s.publicationId)).size}],
    '/api/admin/stores':[{id:store,name:'隔离店铺'}],'/api/templates':[],
   };
   let value=values[path];
   if(path.startsWith('/api/materials/'))value=materials.find(m=>m.id===path.split('/')[3]);
   if(path.startsWith('/api/products/')){const p=products.find(p=>p.id===path.split('/')[3]);if(p)value={...p,plans:[],tasks:[],reviews:[]};}
   if(path==='/api/tasks/'+taskId)value={task:{...task,publishedCount:publications.length,filledCount:new Set(snapshots.map(s=>s.publicationId)).size},materials:[],publications,snapshots};
   return json(res,value===undefined?404:200,value??{});
  }
  if(!['POST','PATCH'].includes(req.method))return json(res,405,{});
  if(req.headers.origin!=='http://127.0.0.1:4177'||req.headers['x-csrf-token']!==token)return json(res,403,{});
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>50000)return json(res,413,{});}const body=JSON.parse(raw);
  for(const [base,rows,validate] of [['materials',materials,materialPayload],['products',products,productPayload]]){
   if(path==='/api/'+base&&req.method==='POST'){
    const payload=validate(body),id=randomUUID();
    const saved=base==='materials'?{...payload,id,version:1,assets:[]}:{...payload,id,version:1,active:true,storeName:payload.storeId?'隔离店铺':null,stages:payload.stages.map((name,i)=>({id:randomUUID(),name,position:i+1}))};
    rows.unshift(saved);return json(res,201,saved);
   }
   if(path.startsWith('/api/'+base+'/')&&req.method==='PATCH'){
    const row=rows.find(r=>r.id===path.split('/')[3]);if(!row)return json(res,404,{});if(body.expectedVersion!==row.version)return json(res,409,{});
    const {expectedVersion,...rest}=body,payload=validate(rest,expectedVersion);delete payload.expectedVersion;
    Object.assign(row,payload,{version:row.version+1});return json(res,200,row);
   }
  }
  if(path==='/api/tasks/'+taskId+'/publications'&&req.method==='POST'){const p={...publicationPayload(body),id:randomUUID()};publications.push(p);return json(res,201,p);}
  const match=path.match(/^\/api\/tasks\/([^/]+)\/publications\/([^/]+)\/snapshots$/);
  if(match&&match[1]===taskId&&publications.some(p=>p.id===match[2])&&req.method==='POST'){const s={...snapshotPayload(body),id:randomUUID(),publicationId:match[2]};snapshots.push(s);return json(res,201,s);}
  return json(res,404,{});
 }catch(error){json(res,400,{message:error.message});}
});
server.listen(4177,'127.0.0.1',()=>console.log('Isolated write fixture: http://127.0.0.1:4177/#materials'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close();});
