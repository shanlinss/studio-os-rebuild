import {createMutationGateway} from './mutation-gateway.mjs';
import {materialPayload,productPayload,publicationPayload,snapshotPayload} from './write-contract.mjs';
import {financeRecord,pagedRows} from './management-model.mjs';
import {namedList,templateRecord,titleCatalog,titleBatch,knowledgeList} from './resource-model.mjs';
import {ApiError,ContractError,chinaDate,validDate} from './cloud-contract.mjs';
export {ApiError,ContractError,chinaDate,validDate} from './cloud-contract.mjs';
import {productRecord,shootingRecord,executionRows} from './business-model.mjs';
// View adapter for existing HTTP APIs. Writes require an explicit connected build and authenticated token.
const record = v => v!==null&&typeof v==='object'&&!Array.isArray(v);
const string = v => typeof v==='string';
const number = v => typeof v==='number'&&Number.isFinite(v);
function list(value){if(!Array.isArray(value))throw new ContractError();return value;}
function identity(v){if(!record(v)||!string(v.id)||!string(v.username)||!['admin','employee'].includes(v.role))throw new ContractError();return {id:v.id,username:v.username,role:v.role};}
function base(v){if(!record(v)||!string(v.id)||!string(v.title))throw new ContractError();return v;}
function endpointId(id){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new ContractError('记录标识格式无效。');return id;}
export function materialModel(raw){
  base(raw);if(!record(raw.metadata)||!number(raw.version)||(raw.metadata.tags!==undefined&&(!Array.isArray(raw.metadata.tags)||!raw.metadata.tags.every(string))))throw new ContractError();
  const meta=raw.metadata;
  return {...raw,tags:[...(meta.tags??[])],note:string(meta.notes)?meta.notes:'',kind:meta.mediaType==='视频'?'视频':meta.category==='标题'?'标题':meta.category==='图片'?'图片':meta.mediaType?'参考笔记':'未分类',
    // Preserve original independent dimensions; never write a guessed inverse mapping.
    sourceMetadata:{...meta},archiveSupported:false,assetCount:Array.isArray(raw.assets)?raw.assets.length:null};
}
export function experimentModel(raw){
  base(raw);if(!string(raw.status)||!number(raw.version)||!Array.isArray(raw.rounds))throw new ContractError();
  const refs=new Map();
  for(const round of raw.rounds){if(!record(round)||!string(round.id)||!Array.isArray(round.materials)||!Array.isArray(round.tasks))throw new ContractError();for(const m of round.materials){base(m);refs.set(m.id,{...m});}}
  return {...raw,materials:[...refs.values()],phase:raw.status==='testing'?'测试中':raw.status==='concluded'?'已结束':'未知状态',finding:raw.finding??null,recommendation:raw.recommendation??null};
}
export function ownTasks(rows,profile,role){
  list(rows);if(!profile)return [];
  rows.forEach(base);
  if(role==='employee')return rows; // The server intentionally redacts memberId for employees.
  if(role!=='admin')throw new ContractError();
  return rows.filter(t=>t.memberId===profile.id);
}
export function taskModel(raw){
  if(!record(raw)||!record(raw.task))throw new ContractError();base(raw.task);
  const publications=list(raw.publications),snapshots=list(raw.snapshots);
  if(raw.materials!==undefined&&(!Array.isArray(raw.materials)||raw.materials.some(m=>!record(m)||!string(m.id)||!string(m.title))))throw new ContractError();
  return {...raw.task,materials:raw.materials?.map(m=>({...m}))??[],completion:raw.completion??null,publications:publications.map(p=>{if(!record(p)||!string(p.id))throw new ContractError();return {...p,snapshots:snapshots.filter(s=>{if(!record(s)||!string(s.publicationId))throw new ContractError();return s.publicationId===p.id;})};})};
}
export function metricValue(value){if(value===null||value===undefined)return '未记录';if(!number(value)||value<0)throw new ContractError();return String(value);}
export function taskProgress(t){
  if(t.completedAt)return '已完成';
  if(t.kind==='shooting')return t.shootingStatus||'待处理';
  if(t.kind==='action')return '待完成';
  const n=number(t.publishedCount)?t.publishedCount:null,filled=number(t.filledCount)?t.filledCount:null;
  return n===null?'执行进度未提供':`已发布 ${n}${number(t.targetCount)?' / '+t.targetCount:''} 篇${filled===null?'':' · '+filled+' 篇已回填'}`;
}
export function createCloudApi(fetcher=globalThis.fetch,{allowWrites=false}={}){
  const mutations=createMutationGateway(fetcher,{enabled:allowWrites});
  async function get(path,signal){
    let r;try{r=await fetcher(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json'}});}catch(e){if(e.name==='AbortError')throw e;throw new ApiError(0,'云端连接中断，请检查 SSH 窗口是否仍然开启。');}
    if(r.status===401)mutations.clear();
    if(!r.ok)throw new ApiError(r.status,r.status===401?'登录已失效，请回原工作台登录后重试。':r.status===403?'当前账号没有读取这项资料的权限。':'云端读取失败，请重试。');
    try{return await r.json();}catch{throw new ContractError();}
  }
  async function read(path,signal,adapt){const value=adapt(await get(path,signal));mutations.confirmRead(path);return value;}
  return {
    async login(username,password){const d=await mutations.send('/api/login','POST',{username,password},{login:true});return identity(d.user);},
    async createMaterial(value){return mutations.send('/api/materials','POST',materialPayload(value));},
    async updateMaterial(id,value,version){return mutations.send('/api/materials/'+endpointId(id),'PATCH',materialPayload(value,version));},
    async createProduct(value){return mutations.send('/api/products','POST',productPayload(value));},
    async updateProduct(id,value,version){return mutations.send('/api/products/'+endpointId(id),'PATCH',productPayload(value,version));},
    async publish(id,value){return mutations.send('/api/tasks/'+endpointId(id)+'/publications','POST',publicationPayload(value));},
    async recordSnapshot(id,publicationId,value){return mutations.send('/api/tasks/'+endpointId(id)+'/publications/'+endpointId(publicationId)+'/snapshots','POST',snapshotPayload(value));},
    async session(signal){const d=await get('/api/session',signal);const user=identity(d.user);mutations.acceptSession(d);return user;},
    async navigation(signal){const d=list(await get('/api/navigation',signal));if(!d.every(v=>record(v)&&string(v.id)&&string(v.title)))throw new ContractError();return d;},
    async profile(signal){const d=await get('/api/workbench/profile',signal);if(d.profile===null)return null;if(!record(d.profile)||!string(d.profile.id))throw new ContractError();return d.profile;},
    async materials(signal){return read('/api/materials',signal,v=>list(v).map(materialModel));},
    async material(id,signal){return read('/api/materials/'+endpointId(id),signal,materialModel);},
    async experiments(signal){return list(await get('/api/lab/experiments',signal)).map(experimentModel);},
    async experiment(id,signal){return experimentModel(await get('/api/lab/experiments/'+endpointId(id),signal));},
    async tasks(profile,user,signal){if(!profile)return [];return ownTasks(await get('/api/tasks',signal),profile,user.role);},
    async task(id,signal){return read('/api/tasks/'+endpointId(id),signal,taskModel);},
    async todos(signal){return list(await get('/api/workbench/todos',signal)).map(t=>{base(t);if(!string(t.status))throw new ContractError();return t;});},
    async finance(signal){return financeRecord(await get('/api/finance',signal));},
    async competitors(signal){return namedList(await get('/api/competitors',signal));},
    async samples(params={},signal){const q=new URLSearchParams({offset:String(params.offset??0),q:params.q??'',active:'all'});return pagedRows(await get('/api/samples/catalog?'+q,signal));},
    async attendance(params={},signal){const q=new URLSearchParams({view:params.view??'own',offset:String(params.offset??0)});for(const key of ['from','to']){if(params[key]){if(!validDate(params[key]))throw new ContractError('日期格式无效。');q.set(key,params[key]);}}if(params.from&&params.to&&params.from>params.to)throw new ContractError('开始日期不能晚于结束日期。');return pagedRows(await get('/api/attendance/periods?'+q,signal));},
    async loginAccounts(signal){const rows=list(await get('/api/admin/accounts',signal));if(rows.some(r=>!record(r)||!string(r.id)||!string(r.username)||!['admin','employee'].includes(r.role)||typeof r.active!=='boolean'))throw new ContractError();return rows;},
    async templates(signal){return list(await get('/api/templates',signal)).map(v=>templateRecord(v));},
    async template(id,signal){return templateRecord(await get('/api/templates/'+endpointId(id),signal),true);},
    async titleCatalog(params={},signal){const q=new URLSearchParams({page:String(params.page??1),q:params.q??''});return titleCatalog(await get('/api/titles/catalog?'+q,signal));},
    async titleBatch(id,signal){return titleBatch(await get('/api/titles/'+endpointId(id),signal));},
    async tools(signal){return namedList(await get('/api/toolbox',signal));},
    async knowledge(signal){return knowledgeList(await get('/api/knowledge',signal));},
    async members(signal){return namedList(await get('/api/admin/members',signal),'displayName');},
    async businessAccounts(signal){return namedList(await get('/api/admin/business-accounts',signal));},
    async stores(signal){return namedList(await get('/api/admin/stores',signal));},
    async workTasks(signal){return executionRows(await get('/api/tasks',signal));},
    async products(signal){return read('/api/products',signal,v=>list(v).map(p=>productRecord(p)));},
    async product(id,signal){return read('/api/products/'+endpointId(id),signal,v=>productRecord(v,true));},
    async shooting(signal){return list(await get('/api/shooting/requests',signal)).map(shootingRecord);},
    async shootingDetail(id,signal){return shootingRecord(await get('/api/shooting/requests/'+endpointId(id),signal));},
    async completed(date,user,profile,signal){
      if(!validDate(date))throw new ContractError('请填写有效日期。');
      if(!profile)return [];
      const q=new URLSearchParams({date,source:'all'});if(user.role==='admin')q.set('member',endpointId(profile.id));
      const d=await get('/api/workbench/completed?'+q,signal);if(d.date!==date)throw new ContractError();
      return list(d.rows);
    },
  };
}
