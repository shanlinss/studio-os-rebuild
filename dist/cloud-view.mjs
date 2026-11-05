import {studioBuddy,navigationIcon} from './studio-visuals.mjs';
import {createBusinessReminders} from './business-reminders.mjs';
import {createLibraryViews} from './library-maintenance.mjs';
import {createOperationalViews} from './operational-changes.mjs';
import {accessStamp,clearAccessSurfaces} from './access-session.mjs';
import {createResourceProfileViews} from './resource-profiles.mjs';
import {createFinanceClosingViews} from './finance-month-closures-view.mjs';
import {createFinanceMonthViews} from './finance-month-review-view.mjs';
import {createStockCorrectionViews} from './product-stock-corrections-view.mjs';
import {createCashViews} from './cash-correspondence-view.mjs';
import {createSampleCostViews} from './sample-cost-view.mjs';
import {createInventoryCostViews} from './inventory-cost-view.mjs';
import {createOperatingOverviewViews} from './operating-overview-view.mjs';
import {createOperatingFinanceViews} from './operating-finance-view.mjs';
import {createCostSourcesViews} from './cost-sources-view.mjs';
import {createProductOpeningViews} from './product-opening-view.mjs';
import {createProductCostViews} from './product-cost-view.mjs';
import {createProductPurchaseViews} from './product-purchase-view.mjs';
import {createCommercialProductViews} from './commercial-products-view.mjs';
import {createPhoneCardFinanceWorkspace} from './phone-card-finance-workspace.mjs';
import {createPhoneCardWorkspace} from './phone-cards-workspace.mjs';
import {createDailyAttendanceCard} from './daily-attendance.mjs';
import {createWarehouseViews} from './warehouse-view.mjs';
import {createEquipmentWorkspace} from './equipment-workspace.mjs';
import {createSampleWorkspace} from './sample-workspace.mjs';
import {attachmentList,createAttachmentViews} from './attachments.mjs';
import {navigationForRole} from './page-access.mjs';
import {todosForDate,completedTodos,todoEditable,businessForDate} from './workbench-model.mjs';
import {createRecordEditors} from './record-editors.mjs';
import {groups,specs} from './navigation.mjs';
import {dailyLayout} from './daily-layout.mjs';
import {businessPages,createBusinessViews} from './business-view.mjs';
import {resourcePages,createResourceViews} from './resource-view.mjs';
import {managementPages,createManagementViews} from './management-view.mjs';
import {planningPages,createPlanningViews} from './planning-view.mjs';
import {createCloudApi,chinaDate,validDate,taskProgress,metricValue,ApiError} from './cloud-api.mjs';
const $=s=>document.querySelector(s),h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const writable=document.querySelector('meta[name="studio-data-mode"]')?.content==='cloud-connected';
const api=createCloudApi(globalThis.fetch,{allowWrites:writable,onAccessDenied:accessDenied}),names=Object.fromEntries(groups.flatMap(g=>g[1]));
let user=null,profile=null,nav=[],page='daily',controller,detailController,selectedDate=chinaDate(),lastAccessStamp=null,reconciling=null;
const sourceOrigin=writable?location.origin+'/':'http://[::1]:13102/';
const state={materials:[],experiments:[],tasks:[],todos:[]};
const centerIds=['workspace','business','resources','knowledge','people','finance','settings'];
const sharedGroupIds=new Set(['daily','history','materials','tests','conclusions',...businessPages,...resourcePages,...managementPages,...planningPages]);
const lookupIds=new Set();
$('.sidebar').classList.add('sitemap-sidebar');
$('.nav-label').textContent='STUDIO OS';
$('.prototype').innerHTML=writable?'<i></i> 已连接 · 可保存资料':'<i></i> 云端数据 · 只读预览';
$('.profile').outerHTML='<a class="profile" href="#profile"><span class="avatar">我</span><span id="cloud-identity">核对登录中…</span></a>';
$('#main').innerHTML='<p class="muted">正在核对云端登录状态…</p>';
for(const dialog of document.querySelectorAll('dialog'))dialog.remove();
document.body.insertAdjacentHTML('beforeend','<dialog id="cloud-detail" class="drawer wide-drawer" aria-label="云端记录详情"><div id="cloud-detail-content"></div></dialog>');
const status = (title,desc,action='重试') => `<section class="work-panel planning-panel"><h2>${h(title)}</h2><p>${h(desc)}</p><div class="action-row"><button class="primary" id="cloud-retry">${h(action)}</button><a class="secondary" href="${sourceOrigin}#workspace" target="_blank" rel="noopener noreferrer">${writable?'返回工作台':'打开原工作台'} ↗</a></div></section>`;
function errorView(error){for(const key of Object.keys(state))state[key]=[];if(error.status===401){user=null;$('#cloud-identity').textContent='登录待恢复';$('nav[aria-label="主要模块"]').innerHTML='';}if(error.status===401&&writable){loginView();return;}$('#main').innerHTML=status(error.status===401?'请恢复云端登录':'资料暂时无法读取',error.message);$('#cloud-retry').onclick=()=>init();}
function loginView(){
 $('#main').innerHTML='<section class="work-panel planning-panel login-panel"><span class="login-brand-logo"><img src="brand-logo.png" alt="幸运发财树" width="76" height="76"></span><div class="eyebrow">STUDIO OS</div><h1>欢迎来到幸运发财树</h1><p class="muted">使用已有登录账号，进入自己的工作清单。</p><form id="workspace-login"><label>登录账号<input name="username" autocomplete="username" required maxlength="64"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><p class="save-error" role="alert"></p><button class="primary" type="submit">登录</button></form></section>';
 const form=$('#workspace-login');form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('button');if(submit.disabled)return;submit.disabled=true;const values=new FormData(form);try{await api.login(values.get('username'),values.get('password'));form.reset();await init();}catch(err){form.querySelector('[role=alert]').textContent=err.message;form.elements.password.value='';}finally{submit.disabled=false;}};
}
function heading(title,desc){return `<div class="eyebrow">STUDIO OS <span>${writable?'已连接工作空间':'云端只读预览'}</span></div><div class="heading module-heading"><div><h1>${h(title)}</h1><p>${h(desc)}</p></div><button class="secondary" id="cloud-refresh">刷新数据</button></div>`;}
const localTime=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(d)+'（北京时间）':'时间未提供';};
const empty=(text,desc)=>`<div class="empty"><h3>${h(text)}</h3><p>${h(desc)}</p></div>`;
const text=(value,fallback='未填写')=>h(typeof value==='string'&&value?value:fallback);
function safeSource(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';return u.href;}catch{return '';}}
function source(value,label='查看来源 ↗'){const url=safeSource(value);return url?`<a class="secondary source-link" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(label)}</a>`:'<span class="muted">未填写有效来源链接</span>';}
function navigation(){
  lookupIds.clear();
  $('nav[aria-label="主要模块"]').innerHTML=navigationForRole(user.role,user).map((g,i)=>{
    for(const [id]of g[1])lookupIds.add(id);
    return `<details class="nav-group" ${i<2?'open':''}><summary>${navigationIcon(groups.findIndex(x=>x[0]===g[0]))}${h(g[0])}</summary>${g[1].map(([id,label])=>`<a href="#${id}" class="nav-item" data-cloud-page="${id}">${h(label)}${sharedGroupIds.has(id)?'':'<small>规划</small>'}</a>`).join('')}</details>`;
  }).join('');
}

function forgetAccess(login){
 controller?.abort();detailController?.abort();api.invalidateAccess();
 clearAccessSurfaces(document,()=>window.dispatchEvent(new Event('studio-access-cleared')));
 for(const key of Object.keys(state))state[key]=[];user=null;profile=null;nav=[];lastAccessStamp=null;lookupIds.clear();
 $('nav[aria-label="主要模块"]').innerHTML='';$('#cloud-identity').textContent='登录待恢复';
 if(login)errorView(new ApiError(401,'登录或授权已变化，请重新登录核对当前范围。'));
}
function accessDenied(event){if(!user)return;if(event.status===401){forgetAccess(true);return;}return reconcileAccess();}
async function reconcileAccess(){
 if(!user||reconciling)return reconciling;
 reconciling=(async()=>{try{const current=await api.session();if(!user)return;const inventory=await api.myInventoryAccess().catch(e=>{if([403,404].includes(e.status))return null;throw e;});if(!user)return;if(accessStamp(current,inventory)!==lastAccessStamp){forgetAccess(false);await init();notify('授权范围已更新，已重新读取当前可见资料。');}}catch(e){if(e.status===401&&user)forgetAccess(true);}finally{reconciling=null;}})();return reconciling;
}
window.addEventListener('focus',()=>reconcileAccess());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reconcileAccess();});
async function init(){
  controller?.abort();const run=new AbortController();controller=run;user=null;$('#main').innerHTML='<p class="muted">正在核对云端登录状态…</p>';
  try{
    const activeUser=await api.session(run.signal);
    const [activeNav,activeProfile,inventory]=await Promise.all([
      api.navigation(run.signal),api.profile(run.signal),
      api.myInventoryAccess(run.signal).catch(e=>{if([403,404].includes(e.status))return null;throw e;})
    ]);
    if(run.signal.aborted)return;
    user={...activeUser,productStockAvailable:inventory?.productOperationsAvailable===true,scopedPackaging:inventory?.quantityOperationsAvailable===true&&inventory.grants.length>0,canConsumePackaging:inventory?.quantityOperationsAvailable===true&&inventory.grants.some(g=>g.canMove)};nav=activeNav;profile=activeProfile;lastAccessStamp=accessStamp(activeUser,inventory);
    $('#cloud-identity').innerHTML=`${h(user.username)}<small>${user.superadmin?'超级管理员':user.role==='admin'?'管理员':'员工'} · 工作空间</small>`;
    navigation();lookupIds.add('profile');await route();
  }catch(e){if(e.name!=='AbortError'&&!run.signal.aborted)errorView(e);}
}
async function route(){
  controller?.abort();controller=new AbortController();const signal=controller.signal;
  detailController?.abort();if($('#cloud-detail').open)$('#cloud-detail').close();
  const requested=location.hash.slice(1)||'daily';page=lookupIds.has(requested)?requested:'daily';
  document.querySelectorAll('[data-cloud-page]').forEach(a=>{const active=a.dataset.cloudPage===page;a.classList.toggle('active',active);if(active){a.setAttribute('aria-current','page');a.closest('details').open=true;}else a.removeAttribute('aria-current');});
  $('.topbar strong').textContent=names[page];document.title=names[page]+' · 幸运发财树';
  $('#main').innerHTML=heading(names[page],'正在读取云端资料…');
  try{
    if(planningPages.has(page)){await planning.render(page,signal,user);}
    else if(managementPages.has(page)){await management.render(page,signal,user);}
    else if(resourcePages.has(page)){await resources.render(page,signal,user,profile);}
    else if(businessPages.has(page)){await business.render(page,signal,user);}
    else if(page==='materials'){state.materials=await api.materials(signal);if(signal.aborted)return;materialsPage();}
    else if(page==='tests'||page==='conclusions'){state.experiments=await api.experiments(signal);if(signal.aborted)return;page==='tests'?experimentsPage():conclusionsPage();}
    else if(page==='daily'){
      [state.tasks,state.todos]=await Promise.all([api.tasks(profile,user,signal),api.todos(signal)]);if(signal.aborted)return;dailyPage();await createDailyAttendanceCard({api,h,localTime,notify,writable,onSignedOut:()=>init(),onAuthRequired:async()=>{await init();notify('请重新登录核对今日考勤，重登不会覆盖原上班或下班记录。');}}).render($('.right-column'),signal,user);if(signal.aborted)return;await businessReminders.render($('#business-reminders'),signal);
    }else if(page==='history'){
      const [rows,todos]=await Promise.all([api.completed(selectedDate,user,profile,signal),api.todos(signal)]);if(signal.aborted)return;state.todos=todos;historyPage([...rows,...completedTodos(todos,selectedDate).map(t=>({taskId:t.id,title:t.title,occurredAt:t.completedAt,kind:'个人事项',feedback:t.notes,recordKind:'todo'}))].sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)));
    }else{
      $('#main').innerHTML=heading(names[page],'已保留整体规划，本轮尚未接入这一页。')+`<section class="work-panel planning-panel"><span class="stage-label">规划范围</span><h2>${h(names[page])}</h2><p>${h(specs[page]?.[0]||'后续按确认的业务规则接入已有功能。')}</p><p class="muted">${h(specs[page]?.[1]||'当前预览只开放读取，原工作台保持运行。')}</p></section>`;
    }
    if(writable&&page==='profile'){$('#main').insertAdjacentHTML('beforeend','<button class="secondary" id="workspace-logout">退出登录</button>');$('#workspace-logout').onclick=async e=>{e.target.disabled=true;try{await api.logout();controller?.abort();detailController?.abort();await init();}catch(error){notify(error.message);e.target.disabled=false;}};}
    if(writable&&user.role==='admin'&&page==='tests'){$('.module-toolbar').insertAdjacentHTML('beforeend','<button class="primary" data-create-experiment>＋ 创建实验</button>');$('.module-foot').textContent='先保存实验想法和参考资料，再安排本轮执行。';}
    if(writable&&page==='materials'){$('.module-toolbar').insertAdjacentHTML('beforeend','<button class="primary" data-edit-material="">＋ 收集素材</button>');$('.module-foot').textContent='名称、来源和观察直接保存到原素材档案。';}
    if($('#cloud-refresh'))$('#cloud-refresh').onclick=()=>init();
  }catch(e){if(e.name!=='AbortError')errorView(e);}
}
function materialsPage(){
  $('#main').innerHTML=heading('素材收集箱','读取已有素材、标签和附件信息，保留原始记录。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">搜索素材<input id="cloud-material-search" type="search" placeholder="名称、标签或观察说明"></label><label>素材类型<select id="cloud-material-kind"><option value="all">全部类型</option>${['参考笔记','图片','视频','标题','未分类'].map(k=>`<option>${h(k)}</option>`).join('')}</select></label><label>素材范围<select id="cloud-material-archive"><option value="active">在用素材</option><option value="archived">已归档</option><option value="all">全部素材</option></select></label><span id="cloud-material-count" class="muted"></span></div><div class="material-grid" id="cloud-material-grid"></div><div class="module-foot">归档保留原引用、附件和测试状态；已安排事项可继续执行。</div></section>`;
  const filter=()=>{
    const q=$('#cloud-material-search').value.trim().toLowerCase(),kind=$('#cloud-material-kind').value;
    const scope=$('#cloud-material-archive').value;const list=state.materials.filter(m=>(scope==='all'||m.archived===(scope==='archived'))&&(kind==='all'||m.kind===kind)&&[m.title,m.note,...m.tags].join(' ').toLowerCase().includes(q));
    $('#cloud-material-count').textContent=list.length+' 条素材';
    $('#cloud-material-grid').innerHTML=list.map(m=>`<article class="material-card"><div class="material-card-top"><span class="type-tag">${h(m.kind)}</span><span class="muted">${m.archived?'已归档':'在用素材'}</span></div><button class="material-title" data-live-material="${h(m.id)}">${h(m.title)}</button><p class="material-excerpt">${text(m.note,'暂无观察说明')}</p><div class="tag-list">${m.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><div class="material-card-foot"><span>${m.assetCount===null?'附件数未提供':m.assetCount+' 个附件'}</span><button data-live-material="${h(m.id)}">查看详情 →</button></div></article>`).join('')||empty('没有符合条件的素材','可以调整搜索条件后再查看。');
  };$('#cloud-material-search').oninput=filter;$('#cloud-material-kind').onchange=filter;$('#cloud-material-archive').onchange=filter;filter();
}
function experimentsPage(){
  $('#main').innerHTML=heading('素材实验室','读取现有实验和轮次，沿用原有素材、任务与发布关系。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">搜索实验<input id="cloud-test-search" type="search" placeholder="实验名称、假设或方向"></label><label>实验状态<select id="cloud-test-state"><option value="all">全部状态</option><option value="pending">待安排</option><option value="testing">测试中</option><option value="concluded">已结束</option></select></label><span id="cloud-test-count" class="muted"></span></div><div class="table-scroll"><table class="record-table"><thead><tr><th>实验与假设</th><th>引用素材</th><th>实验轮次</th><th>状态</th><th>执行事项</th></tr></thead><tbody id="cloud-test-rows"></tbody></table></div><div id="cloud-test-empty"></div><div class="module-foot">保留云端原有实验状态和轮次，不将它们转换为示例数据的状态。</div></section>`;
  const filter=()=>{const q=$('#cloud-test-search').value.trim().toLowerCase(),status=$('#cloud-test-state').value;const rows=state.experiments.filter(t=>(status==='all'||status==='pending'&&t.phase==='待安排'||status==='testing'&&t.status==='testing'&&t.phase!=='待安排'||status==='concluded'&&t.status==='concluded')&&[t.title,t.hypothesis,t.direction].join(' ').toLowerCase().includes(q));$('#cloud-test-count').textContent=rows.length+' 个实验';$('#cloud-test-rows').innerHTML=rows.map(t=>`<tr><td><button class="table-title" data-live-test="${h(t.id)}">${h(t.title)}</button><p>${text(t.hypothesis,'未填写假设')}</p></td><td>${t.materials.length} 条</td><td>${t.rounds.length} 轮</td><td><span class="type-tag">${h(t.phase)}</span></td><td>${t.rounds.reduce((n,r)=>n+r.tasks.length,0)} 件</td></tr>`).join('');$('#cloud-test-empty').innerHTML=rows.length?'':empty('没有符合条件的实验','请调整筛选条件。');};$('#cloud-test-search').oninput=filter;$('#cloud-test-state').onchange=filter;filter();
}
function profileNote(){return profile?'':`<div class="planning-rule">当前登录账号尚未关联成员档案，因此“我的工作”不展示团队其他成员的任务。个人待办仍可单独查看。</div>`;}
function dailyPage(){
  $('#main').innerHTML=dailyLayout;
  // Read-only availability differs; the approved page composition is shared.
  $('#add-task').disabled=!writable;$('#add-task').title=writable?'添加自己的工作事项':'云端只读预览，新增功能接入后开放';if(writable)$('#add-task').onclick=()=>editors.todo(undefined,{plannedOn:selectedDate}).catch(e=>notify(e.message));

  $('.preview-note').textContent=writable?'安排自己的事项，完成后留下结果。业务任务保留原执行关系。':'当前显示云端已有记录，只读预览。新增与完成操作接入后开放。';
  $('.date-hint').textContent='只展示我的事项';
  let selectedStatus='all';
  const taskRows=()=>businessForDate(state.tasks,selectedDate).map(t=>{
    const ongoing=t.kind==='shooting'?['拍摄中','待确认','需补拍'].includes(t.shootingStatus):Number(t.publishedCount)>0||Number(t.filledCount)>0;
    return {key:'task:'+t.id,id:t.id,title:t.title,type:t.kind==='shooting'?'素材拍摄':t.sourceType==='material'?'素材测试':t.sourceType==='product'?'测品任务':'内容制作',status:t.completedAt?'done':ongoing?'doing':'todo',dateLabel:t.plannedPublishOn||'未排期',context:t.productName||t.accountName||'业务事项',kind:'task'};
  });
  const todoRows=()=>todosForDate(state.todos,selectedDate).map(t=>({key:'todo:'+t.id,id:t.id,title:t.title,type:t.taskType||'其他事项',status:t.status==='已完成'?'done':t.status==='进行中'?'doing':'todo',dateLabel:t.plannedOn||'持续待办',context:t.dueAt?'截止 '+localTime(t.dueAt):'个人事项',kind:'todo'}));
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
    $('#task-list').innerHTML=visible.map(r=>`<article class="task ${r.status}"><button class="check" ${writable&&r.kind==='todo'?`data-toggle-todo="${h(r.id)}" data-next-status="${r.status==='done'?'待开始':'已完成'}"`:'disabled'} aria-label="${h(r.title)}：${writable&&r.kind==='todo'?(r.status==='done'?'重新开始':'标记完成'):labels[r.status]}" title="${writable?'个人事项可标记完成；业务任务从详情记录交付':'当前只读'}">${r.status==='done'?'✓':''}</button><button class="task-body" ${r.kind==='task'?'data-live-task':'data-live-todo'}="${h(r.id)}" aria-label="查看事项：${h(r.title)}"><span class="task-title">${h(r.title)}</span><span class="task-meta"><span class="type-tag" data-type="${h(r.type)}">${h(r.type)}</span><span>${h(r.dateLabel)}</span><i class="meta-dot"></i><span>${h(r.context)}</span></span></button><span class="state-tag ${r.status}">${labels[r.status]}</span><span class="task-arrow" aria-hidden="true">›</span></article>`).join('')||`<div class="empty daily-empty">${studioBuddy(rows.length?'quiet':'ready',92)}<h3>${rows.length?'暂时没有匹配的事项':'今天，从一件小事开始'}</h3><p>${rows.length?'换个关键词，或清除筛选再看看。':'添加自己的事项，或切换日期查看已有安排。'}</p>${rows.length?'<button data-clear-daily-filters>清除筛选</button>':writable?'<button class="primary" data-add-daily-empty>＋ 添加事项</button>':''}</div>`;
    $('.list-foot').innerHTML='<span class="tiny-dot"></span> 未排期事项与持续待办一并列出 <span>每一步，都是积累。</span>';
  };
  const updateTypes=()=>{const previous=$('#type-filter').value;const values=[...new Set(allRows().map(r=>r.type))];$('#type-filter').innerHTML='<option value="all">所有类型</option>'+values.map(v=>`<option>${h(v)}</option>`).join('');$('#type-filter').value=values.includes(previous)?previous:'all';};
  const moveDate=delta=>{const d=new Date(selectedDate+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);selectedDate=d.toISOString().slice(0,10);updateTypes();renderList();};
  $('#task-list').onclick=e=>{if(e.target.closest('[data-add-daily-empty]'))$('#add-task').click();if(e.target.closest('[data-clear-daily-filters]')){selectedStatus='all';$('#search').value='';$('#type-filter').value='all';renderList();}};
  $('#prev-date').onclick=()=>moveDate(-1);$('#next-date').onclick=()=>moveDate(1);
  $('#work-date').onchange=e=>{if(validDate(e.target.value)){selectedDate=e.target.value;updateTypes();renderList();}};
  $('#today').onclick=()=>{selectedDate=chinaDate();updateTypes();renderList();};
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{selectedStatus=button.dataset.filter;renderList();});
  $('#search').oninput=renderList;$('#type-filter').onchange=renderList;
  $('#about').onclick=()=>{const dialog=$('#cloud-detail');$('#cloud-detail-content').innerHTML=detailHeader('本轮体验范围')+`<p class="preserve-text">${writable?'个人事项可新增、编辑和完成；素材实验可先记录想法，再安排执行与复盘。其他入口按各自接入范围使用。':'保持已确认的首页设计，使用云端已有数据。目前可查看、筛选和打开详情；新增、完成、修改和安排复盘尚未接入。'}</p>`+profileNote();$('#cloud-close-detail').onclick=()=>dialog.close();dialog.showModal();};
  if(!profile)$('.preview-note').textContent='当前账号尚未关联成员档案，暂不展示本人业务事项。个人待办仍会列出。'+(writable?'个人事项可以正常安排与保存。':'当前为云端只读预览。');
  updateTypes();renderList();
}

function historyPage(rows){
  $('#main').innerHTML=heading('我的执行记录','按实际完成或发布时间回看本人产出。')+profileNote()+`<section class="work-panel module-panel"><div class="module-toolbar"><label>完成日期<input type="date" id="cloud-history-date" value="${h(selectedDate)}"></label><span class="muted">${rows.length} 条产出</span></div>${rows.map(r=>`<button class="history-record" ${r.recordKind==='todo'?'data-live-todo':'data-live-task'}="${h(r.taskId)}"><span><b>${h(r.title)}</b><small>${text(r.feedback,'暂无反馈')}</small></span><span>${h(r.occurredAt?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(r.occurredAt)):'时间未提供')}<br>${h(r.kind)}</span></button>`).join('')||empty('这一天暂无本人执行记录','资料来自云端完成事实，不使用示例任务代替。')}</section>`;
  $('#cloud-history-date').onchange=e=>{if(validDate(e.target.value)){selectedDate=e.target.value;route();}};
}
function conclusionsPage(){const rows=state.experiments.filter(t=>typeof t.finding==='string'&&t.finding.trim());$('#main').innerHTML=heading('测试结论','直接引用云端实验结论，保留所属轮次与观察条件。')+`<section class="work-panel module-panel">${rows.map(t=>`<article class="conclusion-card"><div><button class="table-title" data-live-test="${h(t.id)}">${h(t.title)}</button><span class="type-tag">${h(t.phase)}</span></div><p class="preserve-text">${h(t.finding)}</p><p class="muted">${text(t.recommendation,'未填写下一步建议')}</p></article>`).join('')||empty('暂无可见的实验结论','这里只展示当前身份可读取的结论。')}</section>`;}
function detailHeader(title){return `<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" id="cloud-close-detail" aria-label="关闭云端详情">×</button></div>`;}
async function showPanel(title,loader){
  detailController?.abort();detailController=new AbortController();const signal=detailController.signal;
  const dialog=$('#cloud-detail'),body=$('#cloud-detail-content');body.innerHTML=detailHeader(title)+'<p class="muted">正在读取资料…</p>';if(!dialog.open)dialog.showModal();
  $('#cloud-close-detail').onclick=()=>{detailController.abort();dialog.close();};
  try{const html=await loader(signal);if(!signal.aborted)body.innerHTML=html;}
  catch(e){if(e.name==='AbortError')return;body.innerHTML=detailHeader('详情读取失败')+`<p class="preserve-text">${h(e.message)}</p>`;$('#cloud-close-detail').onclick=()=>dialog.close();if(e.status===401){dialog.close();errorView(e);}}
}
let notificationTimer;
function notify(message){
 const el=$('#toast');el.textContent=message;el.classList.add('visible');
 const active=[...document.querySelectorAll('dialog[open]')].at(-1);let feedback;
 if(active){feedback=active.querySelector('[data-dialog-status]');if(!feedback){feedback=document.createElement('p');feedback.className='dialog-feedback';feedback.dataset.dialogStatus='';feedback.setAttribute('role','status');active.querySelector('.dialog-header')?.after(feedback);}feedback.textContent=message;feedback.scrollIntoView({block:'nearest'});}
 clearTimeout(notificationTimer);notificationTimer=setTimeout(()=>{el.classList.remove('visible');if(feedback?.isConnected&&feedback.textContent===message)feedback.textContent='';},5000);
}
createSampleWorkspace({api,h,writable,getUser:()=>user,notify,localTime});
const phoneCardFinanceWorkspace=createPhoneCardFinanceWorkspace({api,h,writable,getUser:()=>user,notify,localTime});
const phoneCardWorkspace=createPhoneCardWorkspace({api,h,writable,getUser:()=>user,notify,localTime});
const equipmentWorkspace=createEquipmentWorkspace({api,h,writable,getUser:()=>user,notify,localTime});
createProductCostViews({api,h,showPanel,getUser:()=>user,notify});
const stockCorrectionViews=createStockCorrectionViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const cashViews=createCashViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const sampleCostViews=createSampleCostViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const inventoryCostViews=createInventoryCostViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const businessReminders=createBusinessReminders({api,h,getUser:()=>user});
const libraryViews=createLibraryViews({api,h,showPanel,localTime,notify,source});
const operationalViews=createOperationalViews({api,h,showPanel,localTime,notify});
const resourceProfileViews=createResourceProfileViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const financeClosingViews=createFinanceClosingViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const financeMonthViews=createFinanceMonthViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const operatingOverviewViews=createOperatingOverviewViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const operatingFinanceViews=createOperatingFinanceViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const costSourcesViews=createCostSourcesViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const productOpeningViews=createProductOpeningViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const productPurchaseViews=createProductPurchaseViews({api,h,showPanel,localTime,getUser:()=>user,writable,notify});
const commercialViews=createCommercialProductViews({api,h,showPanel,source,localTime,writable,getUser:()=>user,notify});
const warehouseViews=createWarehouseViews({api,h,heading,showPanel,localTime,writable,getUser:()=>user});
const planning=createPlanningViews({api,h,heading,notify,warehouse:warehouseViews});
const management=createManagementViews({api,h,heading,showPanel,source,localTime,writable,onPayrollEdit:(month,id,kind)=>(kind==='admin-review'?editors?.adminPayrollReview(month,id):kind==='export'?editors?.payrollExport(month):['confirm','reopen'].includes(kind)?editors?.payrollConfirm(month,id,kind):editors?.payrollEdit(month,id,kind))?.catch(e=>notify(e.message)),onClosureAction:(month,memberId,action)=>editors?.closureAction(month,memberId,action).catch(e=>notify(e.message)),onCalendarEdit:date=>editors?.calendarEdit(date).catch(e=>notify(e.message)),onExceptionReview:(id,kind,reopen)=>editors?.exceptionReview(id,kind,reopen).catch(e=>notify(e.message)),onLeaveEdit:id=>editors?.leaveRequest(id).catch(e=>notify(e.message)),onLeaveAction:(id,action,decision)=>editors?.leaveAction(id,action,decision).catch(e=>notify(e.message)),onAttendanceEdit:args=>editors?.attendanceCorrection(args).catch(e=>notify(e.message)),onAttendanceDecision:(id,decision)=>editors?.attendanceDecision(id,decision).catch(e=>notify(e.message))});
const resources=createResourceViews({api,h,onSignedOut:async status=>{forgetAccess(false);loginView();notify(status==='uncertain'?'改密结果未确认，请先用新密码登录；如未成功，再核对原密码。':status==='expired'?'登录已失效，请重新登录后核对密码设置。':'密码已修改，所有旧登录已退出，请用新密码登录。');},heading,showPanel,source,localTime,notify,writable});
const business=createBusinessViews({api,h,heading,showPanel,source,localTime,writable,getRole:()=>user?.role});
const editors=writable?createRecordEditors({api,h,notify,onSaved:async result=>{if(result?.kind==='library-maintenance'){await resources.render(page,controller.signal,user,profile);await libraryViews.history(result.libraryKind,result.id);return;}if(result?.kind==='operational-change'){await route();await openDetail(result.operationKind==='material-archive'?'material':'task',result.id);return;}if(result?.kind==='resource-profile'){await equipmentWorkspace.refresh();await resourceProfileViews.detail(result.profileKind,result.id);return;}if(result?.kind==='finance-closing'){await financeClosingViews.state(result.month);return;}if(result?.kind==='finance-month-scope'){await financeMonthViews.detail(result.month);return;}if(result?.kind==='stock-correction'){await warehouseViews.refresh();await warehouseViews.refreshScoped();await stockCorrectionViews.detail(result.id);return;}if(result?.kind==='cash-movement'){await cashViews.detail(result.id);return;}if(result?.kind==='sample-cost'){await sampleCostViews.detail(result.id);return;}if(result?.kind==='inventory-cost'){await inventoryCostViews.detail(result.id);return;}if(result?.kind==='month-income'){await operatingOverviewViews.detail(result.month);return;}if(result?.kind==='expense-attribution'){await management.render(page,controller.signal,user);await management.expenseDetail(result.id);return;}if(result?.kind==='operating-finance'){await operatingFinanceViews.detail(result.id);return;}if(result?.kind==='reference-cost'){await costSourcesViews.reference(result.id,result.month);return;}if(result?.kind==='dropship-cost'){await costSourcesViews.detail(result.id);return;}if(result?.kind==='product-opening'){await productOpeningViews.detail(result.id);return;}if(result?.kind==='product-purchase'){await productPurchaseViews.detail(result.id);return;}if(result?.kind==='product-stock-document'){await warehouseViews.refresh();await warehouseViews.refreshScoped();await warehouseViews.productStockDocument(result.id);return;}if(result?.kind==='commercial-product'){await commercialViews.detail(result.id);return;}if(page==='daily'&&['warehouse','reorder-threshold','packaging-purchase','packaging-consumption'].includes(result?.kind))await businessReminders.render($('#business-reminders'),controller.signal);if(result?.kind==='reorder-threshold'){await warehouseViews.refresh();await warehouseViews.detail(result.id,{events:true});return;}if(result?.kind==='packaging-consumption'){await warehouseViews.refresh();await warehouseViews.refreshScoped();await warehouseViews.consumptionDetail(result.id);return;}if(result?.kind==='packaging-purchase'){await warehouseViews.refresh();await warehouseViews.purchaseHistory(result.id);return;}if(result?.kind==='scoped-warehouse'){await warehouseViews.refreshScoped();await warehouseViews.scopedDetail(result.id);return;}if(result?.kind==='warehouse'){await warehouseViews.refresh();if(result.id)await warehouseViews.detail(result.id);return;}if(result?.kind==='card-operation'){await phoneCardFinanceWorkspace.refresh(result.cardId,result.operation);await phoneCardWorkspace.refresh(result.cardId);if(page==='daily')await businessReminders.render($('#business-reminders'),controller.signal);return;}if(result?.kind==='phone-card'){await phoneCardWorkspace.refresh(result.id);if(page==='daily')await businessReminders.render($('#business-reminders'),controller.signal);return;}if(result?.kind==='equipment'){await equipmentWorkspace.refresh();if(page==='daily')await businessReminders.render($('#business-reminders'),controller.signal);return;}if(['directory','finance'].includes(result?.kind))$('#cloud-detail').close();await route();if(result?.expenseId)await management.expenseDetail(result.expenseId);else if(result?.id&&result.kind==='shooting')await business.shootingDetail(result.id);else if(result?.id&&['material','task','test'].includes(result.kind))await openDetail(result.kind,result.id);}}):null;
document.addEventListener('click',async e=>{
 const consume=e.target.closest('button[data-consume-packaging]');
 if(consume&&editors){consume.disabled=true;try{await editors.consumePackaging();}catch(err){notify(err.message);}finally{if(consume.isConnected)consume.disabled=false;}return;}
 const commercial=e.target.closest('button[data-commercial-edit]');
 if(commercial&&editors){commercial.disabled=true;try{await editors.commercialProduct(commercial.dataset.commercialEdit,commercial.dataset.productId,commercial.dataset.skuId||null,commercial.dataset.storeId||null);}catch(err){notify(err.message);}finally{if(commercial.isConnected)commercial.disabled=false;}return;}
 const stockCorrect=e.target.closest('[data-stock-correction-edit]'),stockVoid=e.target.closest('[data-stock-correction-void]');if((stockCorrect||stockVoid)&&editors){const b=stockCorrect||stockVoid;b.disabled=true;try{await editors.stockCorrection(stockCorrect?.dataset.stockCorrectionEdit||stockVoid.dataset.stockCorrectionVoid,!!stockVoid);}catch(err){notify(err.message);}finally{if(b.isConnected)b.disabled=false;}return;}
 const cashEdit=e.target.closest('[data-cash-edit]'),cashVoid=e.target.closest('[data-cash-void]');if((cashEdit||cashVoid)&&editors){const b=cashEdit||cashVoid;b.disabled=true;try{if(cashVoid)await editors.cashVoid(cashVoid.dataset.cashVoid);else await editors.cashMovement(cashEdit.dataset.direction||'in',cashEdit.dataset.cashEdit||null);}catch(err){notify(err.message);}finally{if(b.isConnected)b.disabled=false;}return;}
 const sampleCost=e.target.closest('[data-sample-cost-edit]');if(sampleCost&&editors){sampleCost.disabled=true;try{await editors.sampleCost(sampleCost.dataset.sampleCostEdit);}catch(err){notify(err.message);}finally{if(sampleCost.isConnected)sampleCost.disabled=false;}return;}
 const inventoryCost=e.target.closest('[data-inventory-cost-edit]');if(inventoryCost&&editors){inventoryCost.disabled=true;try{await editors.inventoryCost(inventoryCost.dataset.inventoryCostEdit);}catch(err){notify(err.message);}finally{if(inventoryCost.isConnected)inventoryCost.disabled=false;}return;}
 const overviewExpense=e.target.closest('[data-overview-expense]');if(overviewExpense){management.expenseDetail(overviewExpense.dataset.overviewExpense).catch(e=>notify(e.message));return;}
 const libraryEdit=e.target.closest('[data-library-edit]');if(libraryEdit&&editors){libraryEdit.disabled=true;try{await editors.libraryEdit(libraryEdit.dataset.libraryEdit,libraryEdit.dataset.id||null,libraryEdit.dataset.action||'create',libraryEdit.dataset.entryId||null);}catch(err){notify(err.message);}finally{if(libraryEdit.isConnected)libraryEdit.disabled=false;}return;}
 const operationalEdit=e.target.closest('[data-operational-edit]');if(operationalEdit&&editors){operationalEdit.disabled=true;try{await editors.operationalChange(operationalEdit.dataset.operationalEdit,operationalEdit.dataset.id);}catch(err){notify(err.message);}finally{if(operationalEdit.isConnected)operationalEdit.disabled=false;}return;}
 const profileEdit=e.target.closest('[data-resource-profile-edit]');if(profileEdit&&editors){profileEdit.disabled=true;try{await editors.resourceProfile(profileEdit.dataset.resourceProfileEdit,profileEdit.dataset.id);}catch(err){notify(err.message);}finally{if(profileEdit.isConnected)profileEdit.disabled=false;}return;}
 const closingEdit=e.target.closest('[data-finance-closing-edit]');if(closingEdit&&editors){closingEdit.disabled=true;try{await editors.financeClosing(closingEdit.dataset.financeClosingEdit);}catch(err){notify(err.message);}finally{if(closingEdit.isConnected)closingEdit.disabled=false;}return;}
 const scopeEdit=e.target.closest('[data-finance-scope-edit]');if(scopeEdit&&editors){scopeEdit.disabled=true;try{await editors.financeMonthScope(scopeEdit.dataset.financeScopeEdit);}catch(err){notify(err.message);}finally{if(scopeEdit.isConnected)scopeEdit.disabled=false;}return;}
 const income=e.target.closest('[data-studio-income]');if(income&&editors){const id=income.dataset.studioIncome||document.querySelector('#overview-income-store')?.value;if(!id){notify('请先选择店铺。');return;}income.disabled=true;try{await editors.monthIncome(id,income.dataset.month,income.hasAttribute('data-withdraw-income'));}catch(err){notify(err.message);}finally{if(income.isConnected)income.disabled=false;}return;}
 const attribution=e.target.closest('[data-expense-attribution]');if(attribution&&editors){attribution.disabled=true;try{await editors.expenseAttribution(attribution.dataset.expenseAttribution);}catch(err){notify(err.message);}finally{if(attribution.isConnected)attribution.disabled=false;}return;}
 const operatingExpense=e.target.closest('[data-operating-expense]');if(operatingExpense){management.expenseDetail(operatingExpense.dataset.operatingExpense).catch(e=>notify(e.message));return;}
 const financeAction=e.target.closest('button[data-operating-create],button[data-operating-edit],button[data-operating-refund],button[data-operating-void]');
 if(financeAction&&editors){financeAction.disabled=true;try{if(financeAction.hasAttribute('data-operating-void'))await editors.operatingFinanceVoid(financeAction.dataset.operatingVoid);else if(financeAction.hasAttribute('data-operating-edit'))await editors.operatingFinance('sale',financeAction.dataset.operatingEdit);else if(financeAction.hasAttribute('data-operating-refund'))await editors.operatingFinance('refund',null,financeAction.dataset.operatingRefund);else await editors.operatingFinance(financeAction.dataset.operatingCreate);}catch(err){notify(err.message);}finally{if(financeAction.isConnected)financeAction.disabled=false;}return;}
 const dropFacts=e.target.closest('[data-dropship-facts]');if(dropFacts&&editors){dropFacts.disabled=true;try{await editors.dropshipFacts(dropFacts.dataset.dropshipFacts);}catch(err){notify(err.message);}finally{if(dropFacts.isConnected)dropFacts.disabled=false;}return;}
 const dropVoid=e.target.closest('[data-dropship-void]'),dropRebuild=e.target.closest('[data-dropship-rebuild]'),refundRebuild=e.target.closest('[data-dropship-refund-rebuild]');if((dropVoid||dropRebuild||refundRebuild)&&editors){const b=dropVoid||dropRebuild||refundRebuild;b.disabled=true;try{if(dropVoid)await editors.dropshipVoid(dropVoid.dataset.dropshipVoid,dropVoid.dataset.refundId||null);else if(dropRebuild)await editors.dropship(null,dropRebuild.dataset.dropshipRebuild);else await editors.dropshipRefund(refundRebuild.dataset.dropshipRefundRebuild,null,refundRebuild.dataset.refundId);}catch(err){notify(err.message);}finally{if(b.isConnected)b.disabled=false;}return;}
 const sourceEditor=e.target.closest('button[data-reference-edit],button[data-dropship-edit],button[data-dropship-refund]');
 if(sourceEditor&&editors){sourceEditor.disabled=true;try{if(sourceEditor.hasAttribute('data-reference-edit'))await editors.referenceCost(sourceEditor.dataset.referenceEdit,sourceEditor.dataset.month);else if(sourceEditor.hasAttribute('data-dropship-refund'))await editors.dropshipRefund(sourceEditor.dataset.dropshipRefund,sourceEditor.dataset.refundId||null);else await editors.dropship(sourceEditor.dataset.dropshipEdit||null);}catch(err){notify(err.message);}finally{if(sourceEditor.isConnected)sourceEditor.disabled=false;}return;}
 const productOpening=e.target.closest('button[data-product-opening-edit]');
 if(productOpening&&editors){productOpening.disabled=true;try{await editors.productOpening(productOpening.dataset.productOpeningEdit);}catch(err){notify(err.message);}finally{if(productOpening.isConnected)productOpening.disabled=false;}return;}
 const productPurchase=e.target.closest('button[data-product-purchase-edit]');
 if(productPurchase&&editors){productPurchase.disabled=true;try{await editors.productPurchase(productPurchase.dataset.productPurchaseEdit);}catch(err){notify(err.message);}finally{if(productPurchase.isConnected)productPurchase.disabled=false;}return;}
 const productReturn=e.target.closest('button[data-product-stock-return]');
 if(productReturn&&editors){productReturn.disabled=true;try{await editors.productStockReturn(productReturn.dataset.productStockReturn);}catch(err){notify(err.message);}finally{if(productReturn.isConnected)productReturn.disabled=false;}return;}
 const productStock=e.target.closest('button[data-product-stock-action]');
 if(productStock&&editors){productStock.disabled=true;try{await editors.productStock(productStock.dataset.productStockAction,productStock.dataset.balanceId||null);}catch(err){notify(err.message);}finally{if(productStock.isConnected)productStock.disabled=false;}return;}
 const scoped=e.target.closest('button[data-scoped-warehouse-move]');
 if(scoped&&editors){scoped.disabled=true;try{await editors.scopedWarehouse(scoped.dataset.scopedWarehouseMove,scoped.dataset.balanceId);}catch(err){notify(err.message);}finally{if(scoped.isConnected)scoped.disabled=false;}return;}
 const button=e.target.closest('button[data-warehouse-action],button[data-warehouse-correct]');if(!button||!editors||user?.role!=='admin')return;button.disabled=true;
 try{if(button.dataset.warehouseAction==='transfer-product')await editors.transferPackaging(button.dataset.warehouseId,'product');else if(button.dataset.warehouseAction==='reorder-threshold')await editors.reorderThreshold(button.dataset.warehouseId,button.dataset.balanceId);else if(button.dataset.warehouseAction==='transfer-packaging')await editors.transferPackaging(button.dataset.warehouseId);else if(button.dataset.warehouseAction==='purchase-packaging')await editors.packagingPurchase(button.dataset.warehouseId);else if(button.dataset.warehouseAction==='transfer')await editors.warehouseToSamples(button.dataset.warehouseId);else await editors.warehouse(button.hasAttribute('data-warehouse-correct')?'stocktake':button.dataset.warehouseAction,button.dataset.warehouseId||undefined,button.dataset.warehouseCorrect||null);}catch(err){notify(err.message);}finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener('click',async e=>{const button=e.target.closest('[data-card-finance-action],[data-card-reminder-edit]');if(!button||!editors)return;button.disabled=true;try{const id=button.dataset.cardId||button.dataset.cardReminderEdit,action=button.dataset.cardFinanceAction;if(button.hasAttribute('data-card-reminder-edit'))await editors.cardReminder(id);else if(action==='balance')await editors.cardBalance(id);else if(action==='void')await editors.cardVoid(id,button.dataset.rechargeId);else await editors.cardRecharge(id,action==='correct'?button.dataset.rechargeId:undefined);}catch(e){notify(e.message);}finally{if(button.isConnected)button.disabled=false;}});
document.addEventListener('click',async e=>{const button=e.target.closest('[data-phone-card-edit],[data-phone-card-identity-edit]');if(!button||!editors)return;button.disabled=true;try{if(button.hasAttribute('data-phone-card-identity-edit'))await editors.phoneCardIdentity(button.dataset.phoneCardIdentityEdit);else await editors.phoneCard(button.dataset.phoneCardEdit||undefined);}catch(e){notify(e.message);}finally{if(button.isConnected)button.disabled=false;}});
document.addEventListener('click',async e=>{
 const button=e.target.closest('button[data-equipment-action]');if(!button||!editors)return;const action=button.dataset.equipmentAction;if(!['borrow','return','relocate'].includes(action)&&user?.role!=='admin')return;
 button.disabled=true;try{if(action==='handover')await editors.equipmentHandover(button.dataset.equipmentId);else if(action==='photo')await editors.equipmentPhoto(button.dataset.equipmentId);else if(action==='purchase')await editors.equipmentPurchase(button.dataset.equipmentId);else await editors.equipment(action,button.dataset.equipmentId||undefined,equipmentWorkspace.context());}catch(err){notify(err.message);}finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener('click',async e=>{
 if(!editors||user?.role!=='admin')return;const button=e.target.closest('button[data-next-round],button[data-experiment-product],button[data-experiment-priority],button[data-directory-kind],button[data-edit-expense],button[data-expense-category],button[data-create-settlement],button[data-record-payment],button[data-remove-expense-receipt],button[data-member-login],button[data-account-access],button[data-account-lifecycle],button[data-account-permissions],button[data-inventory-access],button[data-employment-dates]');if(!button)return;
 try{if(button.hasAttribute('data-inventory-access'))await editors.inventoryAccess(button.dataset.inventoryAccess);else if(button.hasAttribute('data-employment-dates'))await editors.employmentDates(button.dataset.employmentDates);else if(button.hasAttribute('data-account-permissions'))await editors.accountPermissions(button.dataset.accountPermissions);else if(button.hasAttribute('data-account-lifecycle'))await editors.accountLifecycle(button.dataset.accountLifecycle||undefined);else if(button.hasAttribute('data-member-login'))await editors.memberLogin(button.dataset.memberLogin);else if(button.hasAttribute('data-account-access'))await editors.accountAccess(button.dataset.accountAccess);else if(button.hasAttribute('data-remove-expense-receipt'))await editors.removeExpenseReceipt(button.dataset.expenseId,button.dataset.removeExpenseReceipt);else if(button.hasAttribute('data-next-round'))await editors.nextRound(button.dataset.nextRound);else if(button.hasAttribute('data-experiment-product'))await editors.experimentProduct(button.dataset.experimentProduct);else if(button.hasAttribute('data-experiment-priority')){button.disabled=true;const row=await api.experiment(button.dataset.experimentPriority);await api.experimentPriority(row.id,button.dataset.priorityNext==='true',row.version);await route();await openDetail('test',row.id);notify('实验优先级已更新');}else if(button.hasAttribute('data-directory-kind'))await editors.directory(button.dataset.directoryKind,button.dataset.directoryId||undefined);else if(button.hasAttribute('data-edit-expense'))await editors.expense(button.dataset.editExpense||undefined);else if(button.hasAttribute('data-expense-category'))await editors.category(button.dataset.expenseCategory||undefined);else if(button.hasAttribute('data-create-settlement'))await editors.settlement();else await editors.payment(button.dataset.recordPayment);}catch(err){notify(err.message);}finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener('click',async e=>{if(!editors)return;const button=e.target.closest('[data-edit-material],[data-edit-product],[data-register-publication],[data-register-snapshot],[data-edit-todo],[data-toggle-todo],[data-create-experiment],[data-dispatch-round],[data-review-round],[data-conclude-experiment]');if(!button)return;try{if(button.hasAttribute('data-create-experiment'))await editors.experiment();else if(button.hasAttribute('data-dispatch-round'))await editors.dispatch(button.dataset.experimentId,button.dataset.dispatchRound);else if(button.hasAttribute('data-review-round'))await editors.review(button.dataset.experimentId,button.dataset.reviewRound);else if(button.hasAttribute('data-conclude-experiment'))await editors.conclusion(button.dataset.concludeExperiment);else if(button.hasAttribute('data-toggle-todo')){const row=state.todos.find(t=>t.id===button.dataset.toggleTodo);if(!row)throw new ContractError('请刷新事项后重试。');button.disabled=true;try{await api.updateTodo(row.id,{...todoEditable(row),status:button.dataset.nextStatus},row.version);notify(button.dataset.nextStatus==='已完成'?'事项已完成':'事项已重新开始');await route();}finally{button.disabled=false;}}else if(button.hasAttribute('data-edit-todo'))await editors.todo(button.dataset.editTodo);else if(button.hasAttribute('data-edit-material'))await editors.material(button.dataset.editMaterial||undefined);else if(button.hasAttribute('data-edit-product'))await editors.product(button.dataset.editProduct||undefined);else if(button.hasAttribute('data-register-snapshot'))await editors.snapshot(button.dataset.taskId,button.dataset.registerSnapshot);else await editors.publication(button.dataset.registerPublication);}catch(error){notify(error.message);}});
createAttachmentViews({api,h,writable,notify,onSaved:async({kind,owner,taskId})=>{await route();if(kind==='expense')await management.expenseDetail(owner);else if(kind==='shooting')await business.shootingDetail(owner);else await openDetail(kind==='publication'?'task':'material',kind==='publication'?taskId:owner);}});
document.addEventListener('click',async e=>{
 if(!writable)return;const button=e.target.closest('button[data-edit-shooting],button[data-shoot-action],button[data-shoot-item],button[data-archive-shooting]');if(!button)return;
 try{
  if(button.hasAttribute('data-edit-shooting'))await editors.shooting(button.dataset.editShooting||undefined);
  else if(button.hasAttribute('data-shoot-action'))await editors.transition(button.dataset.shootId,button.dataset.shootAction,user.role);
  else {button.disabled=true;const id=button.dataset.shootId||button.dataset.archiveShooting;
   if(button.hasAttribute('data-shoot-item'))await api.shootingItem(id,button.dataset.shootItem,button.dataset.itemCompleted==='true',Number(button.dataset.shootVersion),crypto.randomUUID());
   else {const row=await api.shootingDetail(id);await api.archiveShooting(id,button.dataset.shootArchived==='true',row.version,crypto.randomUUID());}
   await route();await business.shootingDetail(id);notify('拍摄记录已保存');
  }
 }catch(error){notify(error.message);}finally{button.disabled=false;}
});
function renderTaskDetail(t){
 const publications=t.kind==='publication'?`<h3>发布与观察记录</h3>${writable&&t.experimentStatus!=='concluded'?`<button class="primary" data-register-publication="${h(t.id)}">＋ 登记发布</button>`:''}${(t.publications||[]).map(p=>`<article class="observation"><b>${text(p.title,'未填写发布标题')}</b><p class="preserve-text">${text(p.note,'')}</p>${source(p.url)}<p>${h(localTime(p.publishedAt))}</p>${attachmentList(h,'publication',p.id,p.assets||[],{taskId:t.id})}${writable&&t.experimentStatus!=='concluded'?`<div class="action-row"><button class="secondary" data-media-upload="publication" data-media-owner="${h(p.id)}" data-media-task="${h(t.id)}">添加发布附件</button><button class="secondary" data-task-id="${h(t.id)}" data-register-snapshot="${h(p.id)}">回填观察数据</button></div>`:''}${(p.snapshots||[]).map(s=>`<p class="muted">采集：${h(localTime(s.observedAt))}</p><div class="metric-list">${['views','likes','favorites','comments','productClicks','addToCart','conversions'].filter(k=>Object.hasOwn(s,k)).map(k=>`<span>${h(({views:'阅读',likes:'点赞',favorites:'收藏',comments:'评论',productClicks:'商品点击',addToCart:'加购',conversions:'成交'})[k])} <b>${h(metricValue(s[k]))}</b></span>`).join('')}</div>`).join('')}</article>`).join('')||'<p class="muted">暂无可见发布记录。</p>'}`:t.kind==='shooting'&&t.shootingRequestId?`<h3>拍摄交付</h3><button class="linked-record" data-shoot-detail="${h(t.shootingRequestId)}"><b>打开原拍摄需求与交付清单</b><span>查看 →</span></button>`:'';
 return detailHeader(t.title)+`<div class="detail-meta"><span>${h(taskProgress(t))}</span><span>${text(t.assignee,'未提供负责人')}</span></div><div class="detail-content">${t.experimentStatus==='concluded'?'<p class="planning-rule">所属安排已结束，原执行记录保留供回看。</p>':''}<div class="action-row">${t.kind==='publication'&&Number.isSafeInteger(t.scheduleVersion)?`<span>执行日期：${h(t.plannedPublishOn||'未排期')}</span>${writable&&user.role==='admin'&&t.experimentStatus!=='concluded'&&(t.remainingCount!==null&&t.remainingCount!==undefined?t.remainingCount>0:t.publishedCount<t.targetCount)?`<button class="secondary" data-operational-edit="task-schedule" data-id="${h(t.id)}">调整日期</button>`:''}<button class="text-button" data-operational-history="task-schedule" data-id="${h(t.id)}">改期历史</button>`:''}</div><h3>工作要求</h3><p class="preserve-text">${text(t.requirements||t.instructions,'未填写')}</p>${t.materials.length?`<h3>参考素材</h3>${t.materials.map(m=>`<button class="linked-record" data-live-material="${h(m.id)}"><b>${h(m.title)}</b><span>查看 →</span></button>`).join('')}`:''}<h3>完成情况</h3>${t.completion?`<p class="preserve-text">${text(t.completion.feedback,'未填写反馈')}</p>${source(t.completion.evidenceUrl)}`:t.completedAt?`<p class="muted">已于 ${h(localTime(t.completedAt))} 确认完成。</p>`:'<p class="muted">暂无单独完成记录。</p>'}${publications}</div>`;
}
async function openDetail(kind,id){
  detailController?.abort();detailController=new AbortController();const signal=detailController.signal;
  const dialog=$('#cloud-detail'),body=$('#cloud-detail-content');body.innerHTML=detailHeader('读取详情中…');if(!dialog.open)dialog.showModal();
  const close=()=>{detailController?.abort();dialog.close();};$('#cloud-close-detail').onclick=close;
  try{
    let html='';
    if(kind==='todo'){const row=(await api.todos(signal)).find(t=>t.id===id);if(!row)throw new ContractError('这项个人事项暂不可见。');html=detailHeader(row.title)+`<div class="detail-meta"><span class="type-tag">${h(row.taskType)}</span><span>${h(row.status)}</span><span>${h(row.priority)}优先级</span></div>${writable?`<div class="action-row"><button class="secondary" data-edit-todo="${h(row.id)}">编辑事项</button></div>`:''}<div class="detail-content"><h3>安排</h3><p>计划日期：${h(row.plannedOn||'未排期')}</p><p>截止时间：${h(row.dueAt?localTime(row.dueAt):'未设置')}</p><p>完成时间：${h(row.completedAt?localTime(row.completedAt):row.status==='已完成'?'历史记录未提供实际完成时间':'尚未完成')}</p><h3>工作说明</h3><p class="preserve-text">${text(row.notes,'暂无说明')}</p></div>`;}
    if(kind==='material'){const m=await api.material(id,signal);html=detailHeader(m.title)+`<div class="detail-meta"><span class="type-tag">${h(m.kind)}</span><span>版本 ${h(m.version)}</span><span>${h(m.assetCount)} 个附件</span><span>${m.archived?'已归档':'在用素材'}</span></div><div class="action-row">${writable&&!m.archived?`<button class="secondary" data-edit-material="${h(id)}">编辑素材</button>`:''}${writable&&user.role==='admin'&&m.archiveSupported?`<button class="secondary" data-operational-edit="material-archive" data-id="${h(id)}">${m.archived?'恢复素材':'归档素材'}</button>`:''}${m.archiveSupported?`<button class="text-button" data-operational-history="material-archive" data-id="${h(id)}">归档历史</button>`:''}</div><div class="tag-list">${m.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><div class="detail-content"><h3>来源</h3>${source(m.sourceUrl)}<h3>观察与用法</h3><p class="preserve-text">${text(m.note,'暂无说明')}</p><h3>原始分类</h3><p class="muted">内容形式：${text(m.sourceMetadata.mediaType)} · 分类：${text(m.sourceMetadata.category)} · 状态：${text(m.sourceMetadata.status)}</p><h3>附件信息</h3>${attachmentList(h,'material',m.id,m.assets||[])}${writable&&!m.archived?`<button class="secondary" data-media-upload="material" data-media-owner="${h(m.id)}">＋ 添加附件</button>`:''}</div>`;}
    if(kind==='test'){const t=await api.experiment(id,signal);html=detailHeader(t.title)+`<div class="detail-meta"><span class="type-tag">${h(t.phase)}</span><span>${t.rounds.length} 轮 · 版本 ${h(t.version)}</span></div><div class="detail-content">${writable&&user.role==='admin'?`<div class="action-row">${t.status==='testing'?`<button class="primary" data-next-round="${h(t.id)}">继续下一轮</button><button class="secondary" data-experiment-product="${h(t.id)}">关联产品</button>`:''}<button class="secondary" data-experiment-priority="${h(t.id)}" data-priority-next="${t.priority?'false':'true'}">${t.priority?'取消优先':'设为优先'}</button><button class="secondary" data-conclude-experiment="${h(t.id)}">${t.status==='concluded'?'更新结论':'形成实验结论'}</button></div>`:''}<p class="muted">关联产品：${h(t.linkedProductName||'未关联')} · ${t.priority?'优先实验':'常规实验'}</p><h3>测试假设</h3><p class="preserve-text">${text(t.hypothesis)}</p><h3>实验方向</h3><p class="preserve-text">${text(t.direction)}</p><h3>引用素材</h3>${t.materials.map(m=>`<button class="linked-record" data-live-material="${h(m.id)}"><b>${h(m.title)}</b><span>查看 →</span></button>`).join('')||'<p class="muted">没有引用素材</p>'}${t.rounds.map(r=>`<h3>第 ${h(r.roundNo)} 轮 · ${h(r.title)}</h3>${writable&&user.role==='admin'&&t.status==='testing'?`<div class="action-row"><button class="secondary" data-experiment-id="${h(t.id)}" data-dispatch-round="${h(r.id)}">安排本轮执行</button><button class="secondary" data-experiment-id="${h(t.id)}" data-review-round="${h(r.id)}">记录本轮复盘</button></div>`:''}<p class="preserve-text">本轮变量：${text(r.testVariable,'未填写')}</p>${r.executionConditions?`<p class="preserve-text">保持条件：${h(r.executionConditions)}</p>`:''}${r.tasks.map(a=>`<button class="linked-record" data-live-task="${h(a.id)}"><span><b>${h(a.title)}</b><small class="linked-context">${h(a.assignee||'负责人未提供')} · ${h(a.accountName||'账号未提供')}</small></span><span>${h(taskProgress(a))} →</span></button>`).join('')||'<p class="muted">尚无执行事项</p>'}`).join('')}<h3>实验各轮复盘记录</h3>${(t.reviews||[]).map(r=>`<article class="observation"><b>第 ${h(t.rounds.find(round=>round.id===r.planId)?.roundNo??'未知')} 轮 · ${h(r.decision)}</b><p class="preserve-text">${h(r.note)}</p></article>`).join('')||'<p class="muted">暂无可见复盘记录。</p>'}<h3>结论与下一步</h3><p class="preserve-text">${text(t.finding,'尚未填写结论')}</p><p class="muted">${text(t.recommendation,'尚未填写建议')}</p></div>`;}
    if(kind==='task'){const t=await api.task(id,signal);html=renderTaskDetail(t);}
    if(signal.aborted)return;body.innerHTML=html;$('#cloud-close-detail').onclick=close;
  }catch(e){if(e.name==='AbortError')return;body.innerHTML=detailHeader('详情读取失败')+`<p class="preserve-text">${h(e.message)}</p>`;$('#cloud-close-detail').onclick=close;if(e instanceof ApiError&&e.status===401){state.materials=[];state.experiments=[];state.tasks=[];state.todos=[];$('#main').innerHTML=status('云端登录已失效','请回到原工作台登录，再刷新预览。');$('#cloud-retry').onclick=init;}}
}
document.addEventListener('click',e=>{const m=e.target.closest('[data-live-material]'),t=e.target.closest('[data-live-test]'),task=e.target.closest('[data-live-task]'),todo=e.target.closest('[data-live-todo]');if(m)openDetail('material',m.dataset.liveMaterial);if(t)openDetail('test',t.dataset.liveTest);if(task)openDetail('task',task.dataset.liveTask);if(todo)openDetail('todo',todo.dataset.liveTodo);});
$('#cloud-detail').addEventListener('cancel',()=>detailController?.abort());
window.addEventListener('hashchange',()=>user&&route());
await init();
