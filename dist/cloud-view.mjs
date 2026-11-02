import {groups,specs} from './navigation.mjs';
import {dailyLayout} from './daily-layout.mjs';
import {createCloudApi,chinaDate,validDate,taskProgress,metricValue,ApiError} from './cloud-api.mjs';
const $=s=>document.querySelector(s),h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=createCloudApi(),names=Object.fromEntries(groups.flatMap(g=>g[1]));
let user=null,profile=null,nav=[],page='daily',controller,detailController,selectedDate=chinaDate();
const sourceOrigin='http://[::1]:13102/';
const state={materials:[],experiments:[],tasks:[],todos:[]};
const centerIds=['workspace','business','resources','knowledge','people','finance','settings'];
const sharedGroupIds=new Set(['daily','history','materials','tests','conclusions']);
const lookupIds=new Set();
$('.sidebar').classList.add('sitemap-sidebar');
$('.nav-label').textContent='STUDIO OS';
$('.prototype').innerHTML='<i></i> 云端数据 · 只读预览';
$('.profile').innerHTML='<span class="avatar">我</span><span id="cloud-identity">核对登录中…</span>';
$('#main').innerHTML='<p class="muted">正在核对云端登录状态…</p>';
for(const dialog of document.querySelectorAll('dialog'))dialog.remove();
document.body.insertAdjacentHTML('beforeend','<dialog id="cloud-detail" class="drawer wide-drawer" aria-label="云端记录详情"><div id="cloud-detail-content"></div></dialog>');
const status = (title,desc,action='重试') => `<section class="work-panel planning-panel"><h2>${h(title)}</h2><p>${h(desc)}</p><div class="action-row"><button class="primary" id="cloud-retry">${h(action)}</button><a class="secondary" href="${sourceOrigin}#workspace" target="_blank" rel="noopener noreferrer">打开原工作台 ↗</a></div></section>`;
function errorView(error){for(const key of Object.keys(state))state[key]=[];if(error.status===401){user=null;$('#cloud-identity').textContent='登录待恢复';$('nav[aria-label="主要模块"]').innerHTML='';}$('#main').innerHTML=status(error.status===401?'请恢复云端登录':'资料暂时无法读取',error.message);$('#cloud-retry').onclick=()=>init();}
function heading(title,desc){return `<div class="eyebrow">STUDIO OS <span>云端只读预览</span></div><div class="heading module-heading"><div><h1>${h(title)}</h1><p>${h(desc)}</p></div><button class="secondary" id="cloud-refresh">刷新数据</button></div>`;}
const localTime=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(d)+'（北京时间）':'时间未提供';};
const empty=(text,desc)=>`<div class="empty"><h3>${h(text)}</h3><p>${h(desc)}</p></div>`;
const text=(value,fallback='未填写')=>h(typeof value==='string'&&value?value:fallback);
function safeSource(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';return u.href;}catch{return '';}}
function source(value){const url=safeSource(value);return url?`<a class="secondary source-link" href="${h(url)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>`:'<span class="muted">未填写有效来源链接</span>';}
function navigation(){
  const allowed=new Set(nav.map(n=>n.id));lookupIds.clear();
  $('nav[aria-label="主要模块"]').innerHTML=groups.map((g,i)=>{
    if(!allowed.has(centerIds[i]))return '';
    for(const [id]of g[1])lookupIds.add(id);
    return `<details class="nav-group" ${i<2?'open':''}><summary>${h(g[0])}</summary>${g[1].map(([id,label])=>`<a href="#${id}" class="nav-item" data-cloud-page="${id}">${h(label)}${sharedGroupIds.has(id)?'':'<small>规划</small>'}</a>`).join('')}</details>`;
  }).join('');
}
async function init(){
  controller?.abort();const run=new AbortController();controller=run;user=null;$('#main').innerHTML='<p class="muted">正在核对云端登录状态…</p>';
  try{
    const activeUser=await api.session(run.signal);
    const [activeNav,activeProfile]=await Promise.all([api.navigation(run.signal),api.profile(run.signal)]);
    if(run.signal.aborted)return;
    user=activeUser;nav=activeNav;profile=activeProfile;
    $('#cloud-identity').innerHTML=`${h(user.username)}<small>${user.role==='admin'?'管理员':'员工'} · 云端会话</small>`;
    navigation();await route();
  }catch(e){if(e.name!=='AbortError'&&!run.signal.aborted)errorView(e);}
}
async function route(){
  controller?.abort();controller=new AbortController();const signal=controller.signal;
  detailController?.abort();if($('#cloud-detail').open)$('#cloud-detail').close();
  const requested=location.hash.slice(1)||'daily';page=lookupIds.has(requested)?requested:'daily';
  document.querySelectorAll('[data-cloud-page]').forEach(a=>{const active=a.dataset.cloudPage===page;a.classList.toggle('active',active);if(active){a.setAttribute('aria-current','page');a.closest('details').open=true;}else a.removeAttribute('aria-current');});
  $('.topbar strong').textContent=names[page];document.title=names[page]+' · Studio OS 云端';
  $('#main').innerHTML=heading(names[page],'正在读取云端资料…');
  try{
    if(page==='materials'){state.materials=await api.materials(signal);if(signal.aborted)return;materialsPage();}
    else if(page==='tests'||page==='conclusions'){state.experiments=await api.experiments(signal);if(signal.aborted)return;page==='tests'?experimentsPage():conclusionsPage();}
    else if(page==='daily'){
      [state.tasks,state.todos]=await Promise.all([api.tasks(profile,user,signal),api.todos(signal)]);if(signal.aborted)return;dailyPage();
    }else if(page==='history'){
      const rows=await api.completed(selectedDate,user,profile,signal);if(signal.aborted)return;historyPage(rows);
    }else{
      $('#main').innerHTML=heading(names[page],'已保留整体规划，本轮尚未接入这一页。')+`<section class="work-panel planning-panel"><span class="stage-label">规划范围</span><h2>${h(names[page])}</h2><p>${h(specs[page]?.[0]||'后续按确认的业务规则接入已有功能。')}</p><p class="muted">${h(specs[page]?.[1]||'当前预览只开放读取，原工作台保持运行。')}</p></section>`;
    }
    if($('#cloud-refresh'))$('#cloud-refresh').onclick=()=>init();
  }catch(e){if(e.name!=='AbortError')errorView(e);}
}
function materialsPage(){
  $('#main').innerHTML=heading('素材收集箱','读取已有素材、标签和附件信息，保留原始记录。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">搜索素材<input id="cloud-material-search" type="search" placeholder="名称、标签或观察说明"></label><label>素材类型<select id="cloud-material-kind"><option value="all">全部类型</option>${['参考笔记','图片','视频','标题','未分类'].map(k=>`<option>${h(k)}</option>`).join('')}</select></label><span id="cloud-material-count" class="muted"></span></div><div class="material-grid" id="cloud-material-grid"></div><div class="module-foot">云端只读；本轮不新增、归档或删除素材。</div></section>`;
  const filter=()=>{
    const q=$('#cloud-material-search').value.trim().toLowerCase(),kind=$('#cloud-material-kind').value;
    const list=state.materials.filter(m=>(kind==='all'||m.kind===kind)&&[m.title,m.note,...m.tags].join(' ').toLowerCase().includes(q));
    $('#cloud-material-count').textContent=list.length+' 条素材';
    $('#cloud-material-grid').innerHTML=list.map(m=>`<article class="material-card"><div class="material-card-top"><span class="type-tag">${h(m.kind)}</span><span class="muted">云端记录</span></div><button class="material-title" data-live-material="${h(m.id)}">${h(m.title)}</button><p class="material-excerpt">${text(m.note,'暂无观察说明')}</p><div class="tag-list">${m.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><div class="material-card-foot"><span>${m.assetCount===null?'附件数未提供':m.assetCount+' 个附件'}</span><button data-live-material="${h(m.id)}">查看详情 →</button></div></article>`).join('')||empty('没有符合条件的素材','可以调整搜索条件后再查看。');
  };$('#cloud-material-search').oninput=filter;$('#cloud-material-kind').onchange=filter;filter();
}
function experimentsPage(){
  $('#main').innerHTML=heading('素材实验室','读取现有实验和轮次，沿用原有素材、任务与发布关系。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">搜索实验<input id="cloud-test-search" type="search" placeholder="实验名称、假设或方向"></label><label>实验状态<select id="cloud-test-state"><option value="all">全部状态</option><option value="testing">测试中</option><option value="concluded">已结束</option></select></label><span id="cloud-test-count" class="muted"></span></div><div class="table-scroll"><table class="record-table"><thead><tr><th>实验与假设</th><th>引用素材</th><th>实验轮次</th><th>状态</th><th>执行事项</th></tr></thead><tbody id="cloud-test-rows"></tbody></table></div><div id="cloud-test-empty"></div><div class="module-foot">保留云端原有实验状态和轮次，不将它们转换为示例数据的状态。</div></section>`;
  const filter=()=>{const q=$('#cloud-test-search').value.trim().toLowerCase(),status=$('#cloud-test-state').value;const rows=state.experiments.filter(t=>(status==='all'||t.status===status)&&[t.title,t.hypothesis,t.direction].join(' ').toLowerCase().includes(q));$('#cloud-test-count').textContent=rows.length+' 个实验';$('#cloud-test-rows').innerHTML=rows.map(t=>`<tr><td><button class="table-title" data-live-test="${h(t.id)}">${h(t.title)}</button><p>${text(t.hypothesis,'未填写假设')}</p></td><td>${t.materials.length} 条</td><td>${t.rounds.length} 轮</td><td><span class="type-tag">${h(t.phase)}</span></td><td>${t.rounds.reduce((n,r)=>n+r.tasks.length,0)} 件</td></tr>`).join('');$('#cloud-test-empty').innerHTML=rows.length?'':empty('没有符合条件的实验','请调整筛选条件。');};$('#cloud-test-search').oninput=filter;$('#cloud-test-state').onchange=filter;filter();
}
function profileNote(){return profile?'':`<div class="planning-rule">当前登录账号尚未关联成员档案，因此“我的工作”不展示团队其他成员的任务。个人待办仍可单独查看。</div>`;}
function dailyPage(){
  $('#main').innerHTML=dailyLayout;
  // Read-only availability differs; the approved page composition is shared.
  $('#add-task').disabled=true;$('#add-task').title='云端只读预览，新增功能接入后开放';
  $('#add-review').disabled=true;$('#add-review').title='云端只读预览，复盘安排接入后开放';
  $('.preview-note').textContent='当前显示云端已有记录，只读预览。新增与完成操作接入后开放。';
  $('.date-hint').textContent='只展示我的事项';
  let selectedStatus='all';
  const taskRows=()=>state.tasks.filter(t=>!t.plannedPublishOn||t.plannedPublishOn===selectedDate).map(t=>{
    const ongoing=t.kind==='shooting'?['拍摄中','待验收','待补拍'].includes(t.shootingStatus):Number(t.publishedCount)>0||Number(t.filledCount)>0;
    return {key:'task:'+t.id,id:t.id,title:t.title,type:t.kind==='shooting'?'素材拍摄':t.sourceType==='material'?'素材测试':t.sourceType==='product'?'测品任务':'内容制作',status:t.completedAt?'done':ongoing?'doing':'todo',dateLabel:t.plannedPublishOn||'未排期',context:t.productName||t.accountName||'业务事项',kind:'task'};
  });
  const todoRows=()=>state.todos.filter(t=>t.status!=='取消').map(t=>({key:'todo:'+t.id,id:t.id,title:t.title,type:t.taskType||'其他事项',status:t.status==='已完成'?'done':t.status==='进行中'?'doing':'todo',dateLabel:'持续待办',context:'个人事项',kind:'todo'}));
  const allRows=()=>[...taskRows(),...todoRows()];
  const renderList=()=>{
    const rows=allRows(),done=rows.filter(r=>r.status==='done').length;
    const percentage=rows.length?Math.round(done/rows.length*100):0;
    $('#work-date').value=selectedDate;
    $('#date-display').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date(selectedDate+'T12:00:00+08:00'));
    $('#total-count').textContent=rows.length+' 件';
    $('#progress-caption').textContent=rows.length?`已完成 ${done} 件，还有 ${rows.length-done} 件待推进`:'今天的清单还是空的，先看看接下来的安排';
    $('#progress-ring').style.setProperty('--progress',percentage+'%');$('#progress-number').textContent=percentage+'%';
    document.querySelectorAll('[data-filter]').forEach(button=>{const active=button.dataset.filter===selectedStatus;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));button.querySelector('span').textContent=button.dataset.filter==='all'?rows.length:rows.filter(r=>r.status===button.dataset.filter).length;});
    const query=$('#search').value.trim().toLowerCase(),type=$('#type-filter').value;
    const visible=rows.filter(r=>(selectedStatus==='all'||r.status===selectedStatus)&&(type==='all'||r.type===type)&&r.title.toLowerCase().includes(query)).sort((a,b)=>(a.status==='done')-(b.status==='done'));
    const labels={todo:'待处理',doing:'进行中',done:'已完成'};
    $('#task-list').innerHTML=visible.map(r=>`<article class="task ${r.status}"><button class="check" disabled aria-label="${h(r.title)}：${labels[r.status]}（只读）" title="当前仅查看，不能修改云端状态">${r.status==='done'?'✓':''}</button><button class="task-body" ${r.kind==='task'?'data-live-task':'data-live-todo'}="${h(r.id)}" aria-label="查看事项：${h(r.title)}"><span class="task-title">${h(r.title)}</span><span class="task-meta"><span class="type-tag" data-type="${h(r.type)}">${h(r.type)}</span><span>${h(r.dateLabel)}</span><i class="meta-dot"></i><span>${h(r.context)}</span></span></button><span class="state-tag ${r.status}">${labels[r.status]}</span><span class="task-arrow" aria-hidden="true">›</span></article>`).join('')||empty('这一天暂无符合条件的事项','可以切换日期或调整筛选条件。');
    $('.list-foot').innerHTML='<span class="tiny-dot"></span> 未排期事项与持续待办一并列出 <span>每一步，都是积累。</span>';
  };
  const updateTypes=()=>{const previous=$('#type-filter').value;const values=[...new Set(allRows().map(r=>r.type))];$('#type-filter').innerHTML='<option value="all">所有类型</option>'+values.map(v=>`<option>${h(v)}</option>`).join('');$('#type-filter').value=values.includes(previous)?previous:'all';};
  const moveDate=delta=>{const d=new Date(selectedDate+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);selectedDate=d.toISOString().slice(0,10);updateTypes();renderList();};
  $('#prev-date').onclick=()=>moveDate(-1);$('#next-date').onclick=()=>moveDate(1);
  $('#work-date').onchange=e=>{if(validDate(e.target.value)){selectedDate=e.target.value;updateTypes();renderList();}};
  $('#today').onclick=()=>{selectedDate=chinaDate();updateTypes();renderList();};
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{selectedStatus=button.dataset.filter;renderList();});
  $('#search').oninput=renderList;$('#type-filter').onchange=renderList;
  $('#about').onclick=()=>{const dialog=$('#cloud-detail');$('#cloud-detail-content').innerHTML=detailHeader('本轮体验范围')+'<p class="preserve-text">保持已确认的首页设计，使用云端已有数据。目前可查看、筛选和打开详情；新增、完成、修改和安排复盘尚未接入。</p>'+profileNote();$('#cloud-close-detail').onclick=()=>dialog.close();dialog.showModal();};
  if(!profile)$('.preview-note').textContent='当前账号尚未关联成员档案，暂不展示本人业务事项。个人待办仍会列出。当前为云端只读预览。';
  updateTypes();renderList();
}

function historyPage(rows){
  $('#main').innerHTML=heading('我的执行记录','按实际完成或发布时间回看本人产出。')+profileNote()+`<section class="work-panel module-panel"><div class="module-toolbar"><label>完成日期<input type="date" id="cloud-history-date" value="${h(selectedDate)}"></label><span class="muted">${rows.length} 条产出</span></div>${rows.map(r=>`<button class="history-record" data-live-task="${h(r.taskId)}"><span><b>${h(r.title)}</b><small>${text(r.feedback,'暂无反馈')}</small></span><span>${h(r.occurredAt?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(r.occurredAt)):'时间未提供')}<br>${h(r.kind)}</span></button>`).join('')||empty('这一天暂无本人执行记录','资料来自云端完成事实，不使用示例任务代替。')}</section>`;
  $('#cloud-history-date').onchange=e=>{if(validDate(e.target.value)){selectedDate=e.target.value;route();}};
}
function conclusionsPage(){const rows=state.experiments.filter(t=>typeof t.finding==='string'&&t.finding.trim());$('#main').innerHTML=heading('测试结论','直接引用云端实验结论，保留所属轮次与观察条件。')+`<section class="work-panel module-panel">${rows.map(t=>`<article class="conclusion-card"><div><button class="table-title" data-live-test="${h(t.id)}">${h(t.title)}</button><span class="type-tag">${h(t.phase)}</span></div><p class="preserve-text">${h(t.finding)}</p><p class="muted">${text(t.recommendation,'未填写下一步建议')}</p></article>`).join('')||empty('暂无可见的实验结论','这里只展示当前身份可读取的结论。')}</section>`;}
function detailHeader(title){return `<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" id="cloud-close-detail" aria-label="关闭云端详情">×</button></div>`;}
async function openDetail(kind,id){
  detailController?.abort();detailController=new AbortController();const signal=detailController.signal;
  const dialog=$('#cloud-detail'),body=$('#cloud-detail-content');body.innerHTML=detailHeader('读取详情中…');if(!dialog.open)dialog.showModal();
  const close=()=>{detailController?.abort();dialog.close();};$('#cloud-close-detail').onclick=close;
  try{
    let html='';
    if(kind==='material'){const m=await api.material(id,signal);html=detailHeader(m.title)+`<div class="detail-meta"><span class="type-tag">${h(m.kind)}</span><span>版本 ${h(m.version)}</span><span>${h(m.assetCount)} 个附件</span></div><div class="tag-list">${m.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><div class="detail-content"><h3>来源</h3>${source(m.sourceUrl)}<h3>观察与用法</h3><p class="preserve-text">${text(m.note,'暂无说明')}</p><h3>原始分类</h3><p class="muted">内容形式：${text(m.sourceMetadata.mediaType)} · 分类：${text(m.sourceMetadata.category)} · 状态：${text(m.sourceMetadata.status)}</p><h3>附件信息</h3>${(m.assets||[]).map(a=>`<p class="muted">${h(a.name)} · ${h(a.mime)} · ${h(a.size)} 字节</p>`).join('')||'<p class="muted">暂无附件</p>'}</div>`;}
    if(kind==='test'){const t=await api.experiment(id,signal);html=detailHeader(t.title)+`<div class="detail-meta"><span class="type-tag">${h(t.phase)}</span><span>${t.rounds.length} 轮 · 版本 ${h(t.version)}</span></div><div class="detail-content"><h3>测试假设</h3><p class="preserve-text">${text(t.hypothesis)}</p><h3>实验方向</h3><p class="preserve-text">${text(t.direction)}</p><h3>引用素材</h3>${t.materials.map(m=>`<button class="linked-record" data-live-material="${h(m.id)}"><b>${h(m.title)}</b><span>查看 →</span></button>`).join('')||'<p class="muted">没有引用素材</p>'}${t.rounds.map(r=>`<h3>第 ${h(r.roundNo)} 轮 · ${h(r.title)}</h3><p class="preserve-text">${text(r.testVariable,'未填写测试变量')}</p>${r.tasks.map(a=>`<button class="linked-record" data-live-task="${h(a.id)}"><b>${h(a.title)}</b><span>${h(taskProgress(a))} →</span></button>`).join('')||'<p class="muted">尚无执行事项</p>'}`).join('')}<h3>结论与下一步</h3><p class="preserve-text">${text(t.finding,'尚未填写结论')}</p><p class="muted">${text(t.recommendation,'尚未填写建议')}</p></div>`;}
    if(kind==='task'){const t=await api.task(id,signal);html=detailHeader(t.title)+`<div class="detail-meta"><span>${h(taskProgress(t))}</span><span>${text(t.assignee,'未提供负责人')}</span></div><div class="detail-content"><h3>工作要求</h3><p class="preserve-text">${text(t.requirements||t.instructions,'未填写')}</p><h3>完成情况</h3>${t.completion?`<p class="preserve-text">${text(t.completion.feedback,'未填写反馈')}</p>${source(t.completion.evidenceUrl)}`:'<p class="muted">暂无单独完成记录。</p>'}<h3>发布与观察记录</h3>${(t.publications||[]).map(p=>`<article class="observation">${source(p.url)}<p>${h(localTime(p.publishedAt))}</p>${(p.snapshots||[]).map(s=>`<p class="muted">采集：${h(localTime(s.observedAt))}</p><div class="metric-list">${['views','likes','favorites','comments','productClicks','addToCart','conversions'].filter(k=>Object.hasOwn(s,k)).map(k=>`<span>${h(({views:'阅读',likes:'点赞',favorites:'收藏',comments:'评论',productClicks:'商品点击',addToCart:'加购',conversions:'成交'})[k])} <b>${h(metricValue(s[k]))}</b></span>`).join('')}</div>`).join('')}</article>`).join('')||'<p class="muted">暂无可见发布记录。</p>'}</div>`;}
    if(signal.aborted)return;body.innerHTML=html;$('#cloud-close-detail').onclick=close;
  }catch(e){if(e.name==='AbortError')return;body.innerHTML=detailHeader('详情读取失败')+`<p class="preserve-text">${h(e.message)}</p>`;$('#cloud-close-detail').onclick=close;if(e instanceof ApiError&&e.status===401){state.materials=[];state.experiments=[];state.tasks=[];state.todos=[];$('#main').innerHTML=status('云端登录已失效','请回到原工作台登录，再刷新预览。');$('#cloud-retry').onclick=init;}}
}
document.addEventListener('click',e=>{const m=e.target.closest('[data-live-material]'),t=e.target.closest('[data-live-test]'),task=e.target.closest('[data-live-task]'),todo=e.target.closest('[data-live-todo]');if(m)openDetail('material',m.dataset.liveMaterial);if(t)openDetail('test',t.dataset.liveTest);if(task)openDetail('task',task.dataset.liveTask);if(todo){const item=state.todos.find(t=>t.id===todo.dataset.liveTodo);if(!item)return;const dialog=$('#cloud-detail');$('#cloud-detail-content').innerHTML=detailHeader(item.title)+`<div class="detail-meta"><span>${h(item.status)}</span><span>${h(item.taskType)}</span><span>持续待办</span></div><p class="preserve-text">${text(item.notes,'暂无说明')}</p>`;$('#cloud-close-detail').onclick=()=>dialog.close();dialog.showModal();}});
$('#cloud-detail').addEventListener('cancel',()=>detailController?.abort());
window.addEventListener('hashchange',()=>user&&route());
await init();
