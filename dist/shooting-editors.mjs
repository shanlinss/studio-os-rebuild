import {ContractError} from './cloud-contract.mjs';
import {shootingActions} from './shooting-contract.mjs';
export const shootingLabels={start:'开始拍摄',deliver:'提交交付',reshoot:'要求补拍',approve:'确认完成',reopen:'重新打开'};
export function createShootingEditors({api,h,mount,input,area,select}){
 async function shooting(id){
  const [row,assignees,products,materials]=await Promise.all([id?api.shootingDetail(id):null,api.shootingAssignees(),api.products(),api.materials()]);
  if(row&&(row.archived||row.status==='已完成'))throw new ContractError('请先恢复或重新打开需求，再编辑。');
  const people=[['','暂不派发'],...assignees.map(a=>[a.id,a.displayName])],productOptions=[['','使用文字说明'],...products.map(p=>[p.id,p.name])];
  if(row?.assigneeId&&!assignees.some(a=>a.id===row.assigneeId))people.push([row.assigneeId,row.assigneeName||'原负责人（当前不可用）']);
  if(row?.productId&&!products.some(p=>p.id===row.productId))productOptions.push([row.productId,row.productName||'原关联产品']);
  const requestKey=crypto.randomUUID(),split=value=>String(value||'').split('\n').map(v=>v.trim()).filter(Boolean);
  const itemHtml=item=>{
   if(item&&(!Array.isArray(item.references)||!Array.isArray(item.requirements)))throw new ContractError('原拍摄项资料不完整，请刷新核对。');
   const key=crypto.randomUUID(),refs=[['','不关联素材'],...materials.map(m=>[m.id,m.title])];if(item?.materialId&&!materials.some(m=>m.id===item.materialId))refs.push([item.materialId,'原关联素材（当前不可见）']);
   return `<fieldset class="shoot-editor-item" data-shoot-editor-item><legend>拍摄项</legend><input type="hidden" name="itemOrder" value="${key}"><input type="hidden" name="id_${key}" value="${h(item?.id||'')}">${input('title_'+key,'要拍什么',item?.title,'required maxlength="200"')}<div class="form-grid">${select('kind_'+key,'类型',item?.kind||'图片',[['图片','图片'],['视频','视频']])}${select('priority_'+key,'优先级',item?.priority||'A',['S','A','B','C'].map(v=>[v,v]))}</div>${select('material_'+key,'关联素材',item?.materialId||'',refs)}${area('references_'+key,'参考说明（每行一项）',item?.references.join('\n')||'',4000)}${area('requirements_'+key,'具体要求（每行一项）',item?.requirements.join('\n')||'',4000)}<div class="action-row"><button type="button" class="text-button" data-move-item="up">上移</button><button type="button" class="text-button" data-move-item="down">下移</button><button type="button" class="text-button" data-remove-item>移出当前清单</button></div></fieldset>`;
  };
  const items=row?row.visibleItems:[null];
  mount(row?'编辑拍摄需求':'新建拍摄需求',input('title','需求名称',row?.title,'required maxlength="200"')+select('productId','关联产品',row?.productId||'',productOptions)+input('productDescription','产品补充说明',row?.productDescription,'maxlength="200"')+`<div class="form-grid">${select('assigneeId','负责人',row?.assigneeId||'',people)}${input('dueOn','交付日期',row?.dueOn,'required type="date"')}</div>`+area('summary','整体拍摄要求',row?.summary)+`<div data-shoot-editor-items>${items.map(itemHtml).join('')}</div><button type="button" class="secondary" data-add-shoot-item>＋ 添加拍摄项</button><p class="muted">清单顺序会保留。移出的旧拍摄项保留历史；保存不会重置已完成勾选或复制执行事项。</p>`,async f=>{
   const value={requestKey,title:f.get('title'),productId:f.get('productId')||null,productDescription:f.get('productDescription'),assigneeId:f.get('assigneeId')||null,dueOn:f.get('dueOn'),summary:f.get('summary'),items:f.getAll('itemOrder').map(key=>({id:f.get('id_'+key)||null,title:f.get('title_'+key),kind:f.get('kind_'+key),priority:f.get('priority_'+key),materialId:f.get('material_'+key)||null,references:split(f.get('references_'+key)),requirements:split(f.get('requirements_'+key))}))};
   return row?api.updateShooting(row.id,value,row.version):api.createShooting(value);
  },{kind:'shooting',id},undefined,form=>{
   const container=form.querySelector('[data-shoot-editor-items]');let removed=0;
   const changed=()=>form.dispatchEvent(new Event('input',{bubbles:true}));
   form.querySelector('[data-add-shoot-item]').onclick=()=>{if(container.querySelectorAll('[data-shoot-editor-item]').length>=50)return;container.insertAdjacentHTML('beforeend',itemHtml(null));changed();container.lastElementChild.querySelector('input:not([type=hidden])')?.focus();};
   form.addEventListener('click',e=>{
    const remove=e.target.closest('[data-remove-item]'),move=e.target.closest('[data-move-item]'),undo=e.target.closest('[data-undo-item]');
    if(remove){const item=remove.closest('[data-shoot-editor-item]'),placeholder=document.createElement('div');placeholder.className='planning-rule';placeholder.innerHTML=`拍摄项已移出当前清单，保存后保留历史。<button type="button" class="text-button" data-undo-item="${++removed}">撤销移出</button>`;placeholder.savedItem=item;item.replaceWith(placeholder);changed();}
    if(undo){const placeholder=undo.parentElement;placeholder.replaceWith(placeholder.savedItem);changed();}
    if(move){const item=move.closest('[data-shoot-editor-item]');if(move.dataset.moveItem==='up'&&item.previousElementSibling)container.insertBefore(item,item.previousElementSibling);if(move.dataset.moveItem==='down'&&item.nextElementSibling)container.insertBefore(item.nextElementSibling,item);changed();}
   });
  });
 }
 async function transition(id,action,role){
  const row=await api.shootingDetail(id);if(!shootingActions(row,role).includes(action))throw new ContractError('状态已变化，请重新读取需求。');
  const delivery=row.visibleAssets.some(a=>a.kind==='delivery');
  if(action==='approve'&&row.visibleItems.some(i=>!i.completed))throw new ContractError('仍有未完成的拍摄项，请先核对清单，或填写原因要求补拍。');
  mount(shootingLabels[action],`<p class="muted">${h(row.title)} · 已完成 ${row.visibleItems.filter(i=>i.completed).length} / ${row.visibleItems.length} 项</p>`+(action==='deliver'?input('nasPath','交付位置 / NAS 路径',row.nasPath,'maxlength="2000"')+`<p class="muted">${delivery?'已有交付附件，路径可留空。':'请填写实际交付位置；也可以先返回详情上传交付文件。'}</p>`:action==='reshoot'?area('feedback','补拍原因与具体要求',''):`<p class="preserve-text">${h(action==='approve'?'确认后记录实际完成时间，保留交付与反馈历史。':action==='reopen'?'重新打开后继续在原需求与原事项中处理，历史交付仍保留。':'开始处理本次拍摄需求。')}</p>`),async f=>{
   if(action==='deliver'&&!delivery&&!f.get('nasPath').trim())throw new ContractError('请填写交付路径，或先上传交付文件。');
   return api.shootingState(id,{requestKey:crypto.randomUUID(),action,...(action==='deliver'?{nasPath:f.get('nasPath')}:{}) ,...(action==='reshoot'?{feedback:f.get('feedback')}:{})},row.version);
  },{kind:'shooting',id});
 }
 return {shooting,transition};
}
