import {createAttendanceEditors} from './attendance-editors.mjs';
import {createAccountLifecycleEditors} from './account-lifecycle-editors.mjs';
import {createWarehouseTransferEditors} from './warehouse-transfer-editors.mjs';
import {createWarehouseEditors} from './warehouse-editors.mjs';
import {createOperationsEditors} from './operations-editors.mjs';
import {createShootingEditors} from './shooting-editors.mjs';
import {todoTypes,todoEditable} from './workbench-model.mjs';
import {ContractError} from './cloud-contract.mjs';
export const metricLabels={views:'阅读',likes:'点赞',favorites:'收藏',comments:'评论',productClicks:'商品点击',addToCart:'加购',conversions:'成交'};
export function beijingInput(value=new Date()){
 const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new ContractError('时间无效。');
 return new Date(d.getTime()+8*3600000).toISOString().slice(0,16);
}
export function beijingTimestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new ContractError('请填写有效的北京时间。');
 return value+':00+08:00';
}
// This editor is mounted only in an explicitly connected build or an isolated test fixture.
export function createRecordEditors({api,h,onSaved,notify}){
 const dialog=document.createElement('dialog');dialog.className='editor wide-editor';dialog.setAttribute('aria-label','编辑资料');document.body.append(dialog);
 let saving=false,dirty=false,allowDiscard=false,cleanup=null;
 const dispose=()=>{const release=cleanup;cleanup=null;release?.();};
 dialog.addEventListener('close',()=>{if(!dialog.open)dispose();});
 const close=()=>{if(saving)return;if(dirty&&!allowDiscard){dialog.querySelector('[data-discard]').hidden=false;return;}dispose();dialog.close();};
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 const input=(name,label,value='',opts='')=>`<label>${h(label)}<input name="${name}" value="${h(value??'')}" ${opts}></label>`;
 const area=(name,label,value='',max=2000)=>`<label>${h(label)}<textarea name="${name}" maxlength="${max}" rows="4">${h(value??'')}</textarea></label>`;
 const select=(name,label,value,values)=>`<label>${h(label)}<select name="${name}">${values.map(([v,t])=>`<option value="${h(v)}" ${v===value?'selected':''}>${h(t)}</option>`).join('')}</select></label>`;
 function mount(title,body,submit,after,recover,setup){
  if(saving)return;cleanup?.();cleanup=null;dirty=false;allowDiscard=false;
  dialog.innerHTML=`<form><div class="dialog-header"><h2>${h(title)}</h2><button type="button" class="icon-button" data-close aria-label="关闭编辑">×</button></div>${body}<p class="save-error" role="alert" aria-live="polite"></p><div data-discard hidden class="planning-rule">当前内容尚未保存。<button type="button" class="text-button" data-keep>继续编辑</button><button type="button" class="text-button" data-confirm-discard>放弃本次编辑</button></div><button type="button" class="secondary" data-reconcile hidden>核对上次保存结果</button><div class="form-actions"><button type="button" class="secondary" data-close>取消</button><button class="primary" type="submit">保存</button></div></form>`;
  const form=dialog.querySelector('form'),save=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]'),submitLabel=after?.submitLabel||'保存';save.textContent=submitLabel;
  form.addEventListener('input',()=>{dirty=true;});form.addEventListener('change',()=>{dirty=true;});
  form.querySelectorAll('[data-close]').forEach(el=>el.onclick=close);
  form.querySelector('[data-keep]').onclick=()=>{form.querySelector('[data-discard]').hidden=true;};
  form.querySelector('[data-confirm-discard]').onclick=()=>{allowDiscard=true;close();};
  const fields=()=>form.querySelectorAll('input,textarea,select');
  const finished=async result=>{dirty=false;dispose();dialog.close();notify(after?.submitLabel==='确认删除'?'凭证已删除':'已保存');try{await onSaved({...after,id:after?.id||result?.id});}catch{notify('已保存，页面刷新失败，请重新读取资料。');}};
  const reconcile=form.querySelector('[data-reconcile]');reconcile.onclick=async()=>{if(saving)return;saving=true;reconcile.disabled=true;try{const result=await recover();if(result){await finished(result);}else{error.textContent='尚未找到这次记录，可以使用同一保存标识再次提交。';delete save.dataset.blocked;save.disabled=false;reconcile.hidden=true;fields().forEach(el=>el.disabled=false);}}catch(err){error.textContent=err.message;}finally{saving=false;reconcile.disabled=false;}};
  form.onsubmit=async e=>{
   e.preventDefault();if(saving)return;saving=true;save.disabled=true;save.textContent='正在保存…';error.textContent='';const payload=new FormData(form);fields().forEach(el=>el.disabled=true);
   try{await finished(await submit(payload));}
   catch(err){error.textContent=err.message;error.scrollIntoView({block:'nearest'});if(err.uncertain||err.status===409){save.dataset.blocked='true';if(recover&&err.uncertain)reconcile.hidden=false;error.textContent+=' 编辑内容已保留，请先核对记录，再重新打开编辑。';}}
   finally{saving=false;save.disabled=save.dataset.blocked==='true';save.textContent=submitLabel;if(!save.disabled)fields().forEach(el=>el.disabled=false);}
  };
  if(setup){const release=setup(form);if(typeof release==='function')cleanup=release;}
  if(!dialog.open)dialog.showModal();form.querySelector('input,textarea,select')?.focus();
 }
 async function material(id){
  const m=id?await api.material(id):null,meta=m?.sourceMetadata||{};
  if(m&&!Array.isArray(m.storeIds))throw new ContractError('原店铺关联资料不完整，暂不能编辑。');
  mount(m?'编辑素材':'收集新素材',input('title','素材名称',m?.title,'required maxlength="200"')+input('sourceUrl','来源链接',m?.sourceUrl,'type="url" placeholder="https://…"')+`<div class="form-grid">${select('mediaType','内容形式',meta.mediaType||'图文',[['图文','图文'],['视频','视频']])}${select('category','主要参考',meta.category||'',[['','未分类'],...['标题','图片','场景','文案','内页'].map(v=>[v,v])])}</div>`+input('tags','标签（用逗号分开）',(meta.tags||[]).join('，'),'maxlength="1200"')+area('notes','观察与用法',meta.notes,4000)+`<p class="muted">${m?'保留现有店铺关联、附件、来源分类和测试信息。':'先保存名称、来源和观察，随后在详情添加附件。'}</p>`,async f=>{
   const value={title:f.get('title'),sourceUrl:f.get('sourceUrl'),storeIds:m?.storeIds||[],metadata:{...meta,mediaType:f.get('mediaType'),category:f.get('category'),tags:[...new Set(f.get('tags').split(/[,，\n]/).map(v=>v.trim()).filter(Boolean))],notes:f.get('notes')}};
   if(m)await api.updateMaterial(m.id,value,m.version);else await api.createMaterial(value);
  },{kind:'material',id});
 }
 async function product(id){
  const [p,stores]=await Promise.all([id?api.product(id):null,api.stores()]);
  if(p&&(!Object.hasOwn(p,'storeId')||!Object.hasOwn(p,'notes')))throw new ContractError('原产品资料不完整，暂不能编辑。');
  const choices=[['','未关联店铺'],...stores.map(s=>[s.id,s.name])];if(p?.storeId&&!stores.some(s=>s.id===p.storeId))choices.push([p.storeId,'原关联店铺（当前不可见）']);
  mount(p?'编辑产品':'新建产品',input('name','产品名称',p?.name,'required maxlength="200"')+select('storeId','所属店铺',p?.storeId||'',choices)+area('notes','产品说明',p?.notes)+(!p?area('stages','工作阶段（每行一个）','',2000):'<p class="muted">本次编辑保留现有工作阶段和执行记录。</p>'),async f=>{
   const value={name:f.get('name'),notes:f.get('notes'),storeId:f.get('storeId')||null};
   if(p)await api.updateProduct(p.id,value,p.version);else{value.stages=f.get('stages').split('\n').map(v=>v.trim()).filter(Boolean);await api.createProduct(value);}
  },{kind:'product',id});
 }
 async function publication(taskId){
  const task=await api.task(taskId);if(task.experimentStatus==='concluded')throw new ContractError('所属实验已结束，不能新增发布。');if(task.kind!=='publication')throw new ContractError('这项工作不需要登记发布。');
  if(task.sourceType==='product'&&!task.templateId&&!task.materials.length)throw new ContractError('尚无可用于本次发布的关联素材，请先核对执行安排。');
  mount('登记发布',`<p class="muted">${h(task.title)}</p>`+input('url','笔记链接','','required type="url" placeholder="https://…"')+input('publishedAt','实际发布时间（北京时间）',beijingInput(),'required type="datetime-local"')+(task.materials.length?select('materialId','本次使用素材',task.materials.length===1?task.materials[0].id:'',[['','请选择关联素材'],...task.materials.map(m=>[m.id,m.title])]):'')+input('title','本次发布标题','','maxlength="200"')+area('note','本次发布说明')+'<p class="muted">记录追加到原执行事项，保存后仍可继续发布或回填。</p>',async f=>{if(task.sourceType==='product'&&!task.templateId&&!f.get('materialId'))throw new ContractError('请选择本次发布使用的关联素材。');return api.publish(taskId,{url:f.get('url'),publishedAt:beijingTimestamp(f.get('publishedAt')),materialId:f.get('materialId')||null,title:f.get('title'),note:f.get('note')});},{kind:'task',id:taskId});
 }
 async function snapshot(taskId,publicationId){
  const task=await api.task(taskId);if(task.experimentStatus==='concluded')throw new ContractError('所属实验已结束，不能新增观察记录。');const p=task.publications.find(p=>p.id===publicationId);if(!p)throw new ContractError('原发布记录暂不可见。');
  mount('回填观察数据',`<p class="muted">${h(p.title||task.title)}</p>`+input('observedAt','数据采集时间（北京时间）',beijingInput(),'required type="datetime-local"')+`<div class="form-grid">${Object.entries(metricLabels).map(([k,label])=>input(k,label,'','type="number" min="0" max="2147483647" step="1" placeholder="未知请留空"')).join('')}</div>`+select('hasConversion','是否成交','',[['','尚未确认'],['true','已成交'],['false','未成交']])+'<p class="muted">本次观察单独追加；留空表示未知，填写 0 表示确认是零。</p>',async f=>{
   const value={observedAt:beijingTimestamp(f.get('observedAt')),hasConversion:f.get('hasConversion')===''?null:f.get('hasConversion')==='true'};
   for(const k of Object.keys(metricLabels))value[k]=f.get(k).trim()===''?null:Number(f.get(k));await api.recordSnapshot(taskId,publicationId,value);
  },{kind:'task',id:taskId});
 }
 async function todo(id,{plannedOn=null,review=false}={}){
  await api.capabilities();const row=id?(await api.todos()).find(t=>t.id===id):null;if(id&&!row)throw new ContractError('这项个人事项暂不可见，请刷新后核对。');
  const value=row?todoEditable(row):{title:review?'今日复盘':'',taskType:review?'测试复盘':'其他事项',priority:'中',status:'待开始',notes:'',plannedOn,dueAt:null};
  const requestKey=crypto.randomUUID(),types=todoTypes.slice(0,5);if(!types.includes(value.taskType))types.push(value.taskType);
  mount(row?'编辑个人事项':'添加个人事项',input('title','事项名称',value.title,'required maxlength="200"')+`<div class="form-grid">${select('taskType','事项类型',value.taskType,types.map(t=>[t,t]))}${select('priority','优先级',value.priority,['高','中','低'].map(t=>[t,t]))}</div>`+`<div class="form-grid">${input('plannedOn','计划日期',value.plannedOn||'','type="date"')}${input('dueAt','截止时间（北京时间，可留空）',value.dueAt?beijingInput(value.dueAt):'','type="datetime-local"')}</div>`+select('status','当前状态',value.status,['待开始','进行中','已完成','取消'].map(t=>[t,t]))+area('notes','工作说明',value.notes)+'<p class="muted">个人事项只出现在自己的清单；业务任务通过素材测试等页面安排。</p>',async f=>{
   const payload={title:f.get('title'),taskType:f.get('taskType'),priority:f.get('priority'),status:f.get('status'),notes:f.get('notes'),plannedOn:f.get('plannedOn')||null,dueAt:f.get('dueAt')?beijingTimestamp(f.get('dueAt')):null};
   return row?api.updateTodo(row.id,payload,row.version):api.createTodo({...payload,requestKey});
  },{kind:'todo',id},row?undefined:async()=>{const rows=await api.todos();return rows.find(t=>t.requestKey===requestKey)||null;});
 }

 async function experiment(){
  const [cap,materials]=await Promise.all([api.capabilities(),api.materials()]);if(cap.materialLabDrafts!==1)throw new ContractError('实验草稿接入尚未完成。');
  const requestKey=crypto.randomUUID();
  mount('创建素材实验',input('title','实验名称','','required maxlength="200"')+area('hypothesis','想验证什么')+input('direction','测试方向','','maxlength="100"')+input('testVariable','本轮改变什么','','maxlength="200"')+area('executionConditions','保持哪些执行条件')+input('plannedPublishOn','计划日期（可留空）','','type="date"')+`<fieldset class="material-picker"><legend>参考素材</legend>${materials.map(m=>`<label><input type="checkbox" name="materialIds" value="${h(m.id)}">${h(m.title)}</label>`).join('')||'<p class="muted">请先收集至少一条参考素材。</p>'}</fieldset><p class="muted">先保存想法和参考资料，再进入实验安排执行。</p>`,async f=>{const result=await api.createExperiment({title:f.get('title'),requestKey,materialIds:f.getAll('materialIds'),lab:{hypothesis:f.get('hypothesis'),direction:f.get('direction'),testVariable:f.get('testVariable'),executionConditions:f.get('executionConditions'),plannedPublishOn:f.get('plannedPublishOn')||null}});return {id:result.experimentId};},{kind:'test'},async()=>{const roots=await api.experiments();return roots.find(e=>e.rounds.some(r=>r.requestKey===requestKey))||null;});
 }
 async function dispatch(id,roundId){
  const [root,accounts]=await Promise.all([api.experiment(id),api.businessAccounts()]);const round=root.rounds.find(r=>r.id===roundId);
  if(!round||root.status!=='testing')throw new ContractError('这一轮当前不能安排执行。');
  const available=accounts.filter(a=>a.active&&a.memberActive&&a.responsibleMemberId&&!round.tasks.some(t=>t.accountId===a.id)),requestKey=crypto.randomUUID();
  mount('安排本轮执行',`<p class="muted">${h(root.title)} · 第 ${h(round.roundNo)} 轮</p><fieldset class="assignment-picker"><legend>执行账号与负责人</legend>${available.map(a=>`<div class="assignment-option"><label><input type="checkbox" name="accountIds" value="${h(a.id)}"><span><b>${h(a.name)}</b><small>${h(a.responsibleName||'原账号负责人')}</small></span></label>${input('target-'+a.id,'计划篇数',1,'type="number" min="1" max="10000" step="1"')}</div>`).join('')||'<p class="muted">没有可新安排的在用账号，请查看已有事项或维护账号负责人。</p>'}</fieldset><p class="muted">本轮已有事项保持原记录，同一账号不会重复派发。</p>`,async f=>{
   const assignments=f.getAll('accountIds').map(accountId=>{const a=available.find(a=>a.id===accountId);if(!a)throw new ContractError('账号已变化，请重新读取。');return {accountId,memberId:a.responsibleMemberId,targetCount:Number(f.get('target-'+accountId))};});return api.dispatchRound(id,roundId,{requestKey,assignments},root.version);
  },{kind:'test',id},async()=>api.dispatchReceipt(id,roundId,requestKey));
 }
 async function review(id,roundId){
  const root=await api.experiment(id);if(root.status!=='testing'||!root.rounds.some(r=>r.id===roundId))throw new ContractError('当前不能添加这一轮复盘。');
  const requestKey=crypto.randomUUID();mount('记录本轮复盘',`<p class="muted">${h(root.title)}</p>`+select('decision','当前判断','暂时无法判断',['表现好','有信号，继续验证','表现差','暂时无法判断'].map(t=>[t,t]))+area('note','观察依据与限制')+'<p class="muted">结合实际观察记录写下依据，复盘不会自动结束实验。</p>',async f=>api.reviewRound(id,roundId,{requestKey,decision:f.get('decision'),note:f.get('note')},root.version),{kind:'test',id});
 }
 async function conclusion(id){
  const root=await api.experiment(id);mount(root.status==='concluded'?'更新实验结论':'形成实验结论',`<p class="muted">${h(root.title)}</p>`+select('verdict','复用判断',root.verdict||'unclear',[['unclear','暂时无法判断'],['reusable','值得复用'],['conditional','满足条件后复用'],['rejected','暂不采用']])+area('finding','结论与适用条件',root.finding)+area('recommendation','下一步建议',root.recommendation)+input('tags','结论标签（用逗号分开）',(root.tags||[]).join('，'),'maxlength="800"')+'<p class="muted">保存后结论直接进入测试结论页；结束实验会停止新增发布，请先完成本轮记录。</p>',async f=>api.concludeExperiment(id,{verdict:f.get('verdict'),finding:f.get('finding'),recommendation:f.get('recommendation'),tags:f.get('tags').split(/[,，\n]/).map(t=>t.trim()).filter(Boolean)},root.version),{kind:'test',id});
 }
 const operations=createOperationsEditors({api,h,mount,input,area,select});
 const attendanceEditors=createAttendanceEditors({api,h,mount,input,area,select});
 const accountLifecycleEditors=createAccountLifecycleEditors({api,h,mount,input,area,select});
 const warehouseTransferEditors=createWarehouseTransferEditors({api,h,mount,input,area,select});
 const warehouseEditors=createWarehouseEditors({api,h,mount,input,area,select});
 const shootingEditors=createShootingEditors({api,h,mount,input,area,select});
 return {material,product,publication,snapshot,todo,experiment,dispatch,review,conclusion,...shootingEditors,...operations,...warehouseEditors,...warehouseTransferEditors,...accountLifecycleEditors,...attendanceEditors};

}
