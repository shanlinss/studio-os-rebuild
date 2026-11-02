import {feishuDocumentUrl} from './resource-model.mjs';

export function renderKnowledgeNavigation({rows,user,signal,api,h,heading,notify,writable}){
 const $=s=>document.querySelector(s);
 let list=rows.filter(k=>k.entryType==='knowledge'),saving=false,dirty=false;
 const admin=user.role==='admin',canEdit=admin&&writable;
 $('#main').innerHTML=heading('知识库','按分类找到团队知识，打开飞书文档阅读。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">查找文档<input id="knowledge-search" type="search" placeholder="名称、说明或标签"></label><label>分类<select id="knowledge-category"><option value="all">全部分类</option></select></label>${admin?`<button class="primary" id="knowledge-add" ${canEdit?'':'disabled title="当前为云端只读预览"'}>＋ 添加飞书文档</button>`:''}</div><p class="muted">正文在飞书维护，访问仍需对应文档权限。${admin?(writable?'在本页维护导航信息，旧正文及来源关联会保留。':'当前为云端只读预览，维护操作需在可保存的工作空间中使用。'):'分类、名称与链接由管理员维护。'}</p><form id="knowledge-navigation-form" hidden aria-label="维护文档导航"></form><div id="knowledge-list"></div></section>`;
 const form=$('#knowledge-navigation-form');
 function categories(){const select=$('#knowledge-category'),selected=select.value;select.innerHTML='<option value="all">全部分类</option>'+[...new Set(list.map(k=>k.category||'未分类'))].map(v=>`<option>${h(v)}</option>`).join('');if([...select.options].some(o=>o.value===selected))select.value=selected;}
 function render(){
  const q=$('#knowledge-search').value.trim().toLowerCase(),category=$('#knowledge-category').value;
  const result=list.filter(k=>(category==='all'||(k.category||'未分类')===category)&&[k.title,k.summary,...(k.tags||[])].join(' ').toLowerCase().includes(q));
  $('#knowledge-list').innerHTML=result.map(k=>{
   const url=feishuDocumentUrl(k.sourceUrl),content=`<span class="knowledge-symbol">↗</span><span><small>${h(k.category||'未分类')}</small><b>${h(k.title)}</b><p>${h(k.summary||'')}</p><div class="tag-list">${(k.tags||[]).map(t=>`<span>${h(t)}</span>`).join('')}</div></span><span class="knowledge-date">${url?'打开飞书 ↗':'待补充飞书链接'}</span>`;
   return `<article class="knowledge-navigation-row">${url?`<a class="knowledge-row" href="${h(url)}" target="_blank" rel="noopener noreferrer">${content}</a>`:`<div class="knowledge-row">${content}</div>`}${canEdit&&k.kind!=='conclusion'?`<button class="text-button" data-knowledge-edit="${h(k.id)}">修改导航</button>`:''}</article>`;
  }).join('')||'<div class="empty"><h3>还没有符合条件的文档</h3><p>换个关键词，或回到全部分类。</p></div>';
 }
 function open(item){
  if(saving)return;if(dirty){form.querySelector('[data-discard]').hidden=false;return;}
  dirty=false;form.hidden=false;
  form.innerHTML=`<h2>${item?'修改文档导航':'添加飞书文档'}</h2><div class="form-grid"><label>文档名称<input name="title" maxlength="200" required value="${h(item?.title||'')}"></label><label>分类<input name="category" maxlength="100" list="knowledge-categories" value="${h(item?.category||'')}"></label></div><datalist id="knowledge-categories">${[...new Set(list.map(k=>k.category).filter(Boolean))].map(v=>`<option value="${h(v)}"></option>`).join('')}</datalist><label>飞书文档链接<input name="sourceUrl" type="url" required placeholder="https://你的团队.feishu.cn/docx/…" value="${h(item?.sourceUrl||'')}"></label><label>简短说明<textarea name="summary" maxlength="2000" rows="2">${h(item?.summary||'')}</textarea></label><label>标签（用逗号分开）<input name="tags" maxlength="1230" value="${h((item?.tags||[]).join('，'))}"></label><p class="save-error" role="alert"></p><p data-discard hidden>有尚未保存的修改。<button type="button" class="text-button" data-keep>继续编辑</button><button type="button" class="text-button" data-close>放弃修改</button></p><div class="form-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit" class="primary">保存导航</button></div>`;
  form.oninput=()=>{dirty=true;};
  form.querySelector('[data-cancel]').onclick=()=>{if(saving)return;if(dirty)form.querySelector('[data-discard]').hidden=false;else form.hidden=true;};
  form.querySelector('[data-keep]').onclick=()=>{form.querySelector('[data-discard]').hidden=true;};
  form.querySelector('[data-close]').onclick=()=>{if(saving)return;dirty=false;form.hidden=true;};
  form.onsubmit=async e=>{
   e.preventDefault();if(saving)return;saving=true;
   const fields=[...form.querySelectorAll('input,textarea,button')],error=form.querySelector('[role=alert]'),data=new FormData(form);error.textContent='';fields.forEach(el=>el.disabled=true);
   let saved=false,blocked=false;
   try{
    const value={title:data.get('title'),category:data.get('category'),summary:data.get('summary'),sourceUrl:data.get('sourceUrl'),tags:data.get('tags').split(/[,，\n]/).map(t=>t.trim()).filter(Boolean)};
    if(item)await api.updateKnowledgeNavigation(item.id,value,item.version);else await api.createKnowledgeNavigation(value);
    saved=true;dirty=false;if(signal.aborted)return;form.hidden=true;notify('文档导航已保存');
    list=(await api.knowledge(signal)).filter(k=>k.entryType==='knowledge');if(!signal.aborted){categories();render();}
   }catch(err){
    if(signal.aborted)return;
    if(saved)notify('导航已保存，列表刷新失败，请重新打开知识库。');
    else{blocked=!!err.uncertain||err.status===409;error.textContent=err.message+(blocked?' 当前填写已保留，请重新读取知识库核对后再编辑，避免重复保存。':'');}
   }finally{saving=false;if(!signal.aborted){fields.forEach(el=>el.disabled=false);if(blocked)form.querySelector('[type=submit]').disabled=true;}}
  };
  form.querySelector('input').focus();form.scrollIntoView({block:'nearest'});
 }
 if(canEdit){$('#knowledge-add').onclick=()=>open(null);$('#knowledge-list').onclick=e=>{const button=e.target.closest('button[data-knowledge-edit]');if(button)open(list.find(k=>k.id===button.dataset.knowledgeEdit));};}
 $('#knowledge-search').oninput=render;$('#knowledge-category').onchange=render;categories();render();
}
