// Read-only view adapter for the existing Studio OS HTTP API. No database or mutation client.
export class ApiError extends Error {
  constructor(status, message) { super(message); this.name='ApiError';this.status=status; }
}
export class ContractError extends Error {
  constructor(message='这条资料暂时无法完整显示，请刷新后重试。'){super(message);this.name='ContractError';}
}
const record = v => v!==null&&typeof v==='object'&&!Array.isArray(v);
const string = v => typeof v==='string';
const number = v => typeof v==='number'&&Number.isFinite(v);
function list(value){if(!Array.isArray(value))throw new ContractError();return value;}
function identity(v){if(!record(v)||!string(v.id)||!string(v.username)||!['admin','employee'].includes(v.role))throw new ContractError();return {id:v.id,username:v.username,role:v.role};}
function base(v){if(!record(v)||!string(v.id)||!string(v.title))throw new ContractError();return v;}
function endpointId(id){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new ContractError('记录标识格式无效。');return id;}
export function chinaDate(value=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
export function validDate(value){const d=new Date(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000')&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
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
  return {...raw.task,completion:raw.completion??null,publications:publications.map(p=>{if(!record(p)||!string(p.id))throw new ContractError();return {...p,snapshots:snapshots.filter(s=>{if(!record(s)||!string(s.publicationId))throw new ContractError();return s.publicationId===p.id;})};})};
}
export function metricValue(value){if(value===null||value===undefined)return '未记录';if(!number(value)||value<0)throw new ContractError();return String(value);}
export function taskProgress(t){
  if(t.completedAt)return '已完成';
  if(t.kind==='shooting')return t.shootingStatus||'待处理';
  if(t.kind==='action')return '待完成';
  const n=number(t.publishedCount)?t.publishedCount:null,filled=number(t.filledCount)?t.filledCount:null;
  return n===null?'执行进度未提供':`已发布 ${n}${number(t.targetCount)?' / '+t.targetCount:''} 篇${filled===null?'':' · '+filled+' 篇已回填'}`;
}
export function createCloudApi(fetcher=globalThis.fetch){
  async function get(path,signal){
    let r;try{r=await fetcher(path,{method:'GET',credentials:'same-origin',cache:'no-store',signal,headers:{Accept:'application/json'}});}catch(e){if(e.name==='AbortError')throw e;throw new ApiError(0,'云端连接中断，请检查 SSH 窗口是否仍然开启。');}
    if(!r.ok)throw new ApiError(r.status,r.status===401?'登录已失效，请回原工作台登录后重试。':r.status===403?'当前账号没有读取这项资料的权限。':'云端读取失败，请重试。');
    try{return await r.json();}catch{throw new ContractError();}
  }
  return {
    async session(signal){const d=await get('/api/session',signal);return identity(d.user);},
    async navigation(signal){const d=list(await get('/api/navigation',signal));if(!d.every(v=>record(v)&&string(v.id)&&string(v.title)))throw new ContractError();return d;},
    async profile(signal){const d=await get('/api/workbench/profile',signal);if(d.profile===null)return null;if(!record(d.profile)||!string(d.profile.id))throw new ContractError();return d.profile;},
    async materials(signal){return list(await get('/api/materials',signal)).map(materialModel);},
    async material(id,signal){return materialModel(await get('/api/materials/'+endpointId(id),signal));},
    async experiments(signal){return list(await get('/api/lab/experiments',signal)).map(experimentModel);},
    async experiment(id,signal){return experimentModel(await get('/api/lab/experiments/'+endpointId(id),signal));},
    async tasks(profile,user,signal){if(!profile)return [];return ownTasks(await get('/api/tasks',signal),profile,user.role);},
    async task(id,signal){return taskModel(await get('/api/tasks/'+endpointId(id),signal));},
    async todos(signal){return list(await get('/api/workbench/todos',signal)).map(t=>{base(t);if(!string(t.status))throw new ContractError();return t;});},
    async completed(date,user,profile,signal){
      if(!validDate(date))throw new ContractError('请填写有效日期。');
      if(!profile)return [];
      const q=new URLSearchParams({date,source:'all'});if(user.role==='admin')q.set('member',endpointId(profile.id));
      const d=await get('/api/workbench/completed?'+q,signal);if(d.date!==date)throw new ContractError();
      return list(d.rows);
    },
  };
}
