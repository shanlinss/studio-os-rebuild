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
 let saving=false,dirty=false,allowDiscard=false;
 const close=()=>{if(saving)return;if(dirty&&!allowDiscard){dialog.querySelector('[data-discard]').hidden=false;return;}dialog.close();};
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 const input=(name,label,value='',opts='')=>`<label>${h(label)}<input name="${name}" value="${h(value??'')}" ${opts}></label>`;
 const area=(name,label,value='',max=2000)=>`<label>${h(label)}<textarea name="${name}" maxlength="${max}" rows="4">${h(value??'')}</textarea></label>`;
 const select=(name,label,value,values)=>`<label>${h(label)}<select name="${name}">${values.map(([v,t])=>`<option value="${h(v)}" ${v===value?'selected':''}>${h(t)}</option>`).join('')}</select></label>`;
 function mount(title,body,submit,after){
  if(saving)return;dirty=false;allowDiscard=false;
  dialog.innerHTML=`<form><div class="dialog-header"><h2>${h(title)}</h2><button type="button" class="icon-button" data-close aria-label="关闭编辑">×</button></div>${body}<p class="save-error" role="alert" aria-live="polite"></p><div data-discard hidden class="planning-rule">当前内容尚未保存。<button type="button" class="text-button" data-keep>继续编辑</button><button type="button" class="text-button" data-confirm-discard>放弃本次编辑</button></div><div class="form-actions"><button type="button" class="secondary" data-close>取消</button><button class="primary" type="submit">保存</button></div></form>`;
  const form=dialog.querySelector('form'),save=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]');
  form.addEventListener('input',()=>{dirty=true;});form.addEventListener('change',()=>{dirty=true;});
  form.querySelectorAll('[data-close]').forEach(el=>el.onclick=close);
  form.querySelector('[data-keep]').onclick=()=>{form.querySelector('[data-discard]').hidden=true;};
  form.querySelector('[data-confirm-discard]').onclick=()=>{allowDiscard=true;close();};
  form.onsubmit=async e=>{
   e.preventDefault();if(saving)return;saving=true;save.disabled=true;save.textContent='正在保存…';error.textContent='';
   try{await submit(new FormData(form));dirty=false;dialog.close();notify('已保存');try{await onSaved(after);}catch{notify('已保存，页面刷新失败，请重新读取资料。');}}
   catch(err){error.textContent=err.message;error.scrollIntoView({block:'nearest'});if(err.uncertain||err.status===409){save.dataset.blocked='true';error.textContent+=' 编辑内容已保留，请先核对记录，再重新打开编辑。';}}
   finally{saving=false;save.disabled=save.dataset.blocked==='true';save.textContent='保存';}
  };
  if(!dialog.open)dialog.showModal();form.querySelector('input,textarea,select')?.focus();
 }
 async function material(id){
  const m=id?await api.material(id):null,meta=m?.sourceMetadata||{};
  if(m&&!Array.isArray(m.storeIds))throw new ContractError('原店铺关联资料不完整，暂不能编辑。');
  mount(m?'编辑素材':'收集新素材',input('title','素材名称',m?.title,'required maxlength="200"')+input('sourceUrl','来源链接',m?.sourceUrl,'type="url" placeholder="https://…"')+`<div class="form-grid">${select('mediaType','内容形式',meta.mediaType||'图文',[['图文','图文'],['视频','视频']])}${select('category','主要参考',meta.category||'',[['','未分类'],...['标题','图片','场景','文案','内页'].map(v=>[v,v])])}</div>`+input('tags','标签（用逗号分开）',(meta.tags||[]).join('，'),'maxlength="1200"')+area('notes','观察与用法',meta.notes,4000)+`<p class="muted">${m?'保留现有店铺关联、附件、来源分类和测试信息。':'先记录名称、来源和观察，附件上传后续接入。'}</p>`,async f=>{
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
  const task=await api.task(taskId);if(task.kind!=='publication')throw new ContractError('这项工作不需要登记发布。');
  if(task.sourceType==='product'&&!task.templateId&&!task.materials.length)throw new ContractError('尚无可用于本次发布的关联素材，请先核对执行安排。');
  mount('登记发布',`<p class="muted">${h(task.title)}</p>`+input('url','笔记链接','','required type="url" placeholder="https://…"')+input('publishedAt','实际发布时间（北京时间）',beijingInput(),'required type="datetime-local"')+(task.materials.length?select('materialId','本次使用素材','',[['','请选择关联素材'],...task.materials.map(m=>[m.id,m.title])]):'')+input('title','本次发布标题','','maxlength="200"')+area('note','本次发布说明')+'<p class="muted">记录追加到原执行事项，保存后仍可继续发布或回填。</p>',async f=>{if(task.sourceType==='product'&&!task.templateId&&!f.get('materialId'))throw new ContractError('请选择本次发布使用的关联素材。');return api.publish(taskId,{url:f.get('url'),publishedAt:beijingTimestamp(f.get('publishedAt')),materialId:f.get('materialId')||null,title:f.get('title'),note:f.get('note')});},{kind:'task',id:taskId});
 }
 async function snapshot(taskId,publicationId){
  const task=await api.task(taskId),p=task.publications.find(p=>p.id===publicationId);if(!p)throw new ContractError('原发布记录暂不可见。');
  mount('回填观察数据',`<p class="muted">${h(p.title||task.title)}</p>`+input('observedAt','数据采集时间（北京时间）',beijingInput(),'required type="datetime-local"')+`<div class="form-grid">${Object.entries(metricLabels).map(([k,label])=>input(k,label,'','type="number" min="0" max="2147483647" step="1" placeholder="未知请留空"')).join('')}</div>`+select('hasConversion','是否成交','',[['','尚未确认'],['true','已成交'],['false','未成交']])+'<p class="muted">本次观察单独追加；留空表示未知，填写 0 表示确认是零。</p>',async f=>{
   const value={observedAt:beijingTimestamp(f.get('observedAt')),hasConversion:f.get('hasConversion')===''?null:f.get('hasConversion')==='true'};
   for(const k of Object.keys(metricLabels))value[k]=f.get(k).trim()===''?null:Number(f.get(k));await api.recordSnapshot(taskId,publicationId,value);
  },{kind:'task',id:taskId});
 }
 return {material,product,publication,snapshot};
}
