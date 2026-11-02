'use strict';
(() => {
  const h = escapeHTML;
  const storageKey = 'studio-os-operations-v1';
  const testStates = ['待执行', '进行中', '待复盘', '已结束'];
  const materialTypes = ['参考笔记', '图片', '视频', '标题', '其他'];
  const groups = [
    ['我的工作台', [['daily', '今日工作'], ['history', '我的执行记录']]],
    ['业务中心', [['materials','素材收集箱'], ['tests','素材实验室'], ['shooting','素材拍摄'], ['competitors','竞品观测'], ['products','产品管理'], ['calendar','内容编排'], ['product-tests','测品中心'], ['publishing','发布管理与数据回填'], ['dashboard','数据驾驶舱']]],
    ['资源中心', [['templates','模板库'], ['titles','标题库'], ['tools','工具箱'], ['creation','内容创作']]],
    ['知识中心', [['knowledge','知识库'], ['conclusions','测试结论'], ['learning','学习与复盘']]],
    ['人员中心', [['members','团队成员'], ['accounts','账号管理'], ['attendance','考勤记录']]],
    ['财务中心', [['ledger','记账本'], ['settlements','结算与报销'], ['warehouse','仓库管理'], ['assets','工作室财产管理']]],
    ['系统设置', [['roles','用户与角色权限'], ['shops','店铺资料'], ['account-info','账户资料'], ['profile','个人资料']]],
  ];
  const specs = {
    shooting: ['安排产品拍摄、要求、负责人和交付时间，保存成片。', '样品领取归还引用财产管理中的同一样品；确认人及异常处理待定。'],
    competitors: ['保存竞品笔记或账号快照，按条件检索历史表现。', '采集方式、更新频率及指标待确认。'],
    products: ['维护统一产品基础档案，由拍摄、测品和内容执行关联使用。', '产品信息只维护一次，测品中心负责测试执行。'],
    calendar: ['以周、日和账号视图安排负责人、内容和发布时间。', '文档建议项；与发布回填合并还是独立入口待确认。'],
    'product-tests': ['选品池、上链接、账号、对标模板及笔记测试进度。', '文档建议项；引用产品档案，测试起止条件和评价口径待确认。'],
    publishing: ['记录实际发布链接、发布时间和观察数据，提示待回填事项。', '文档建议项；与今日工作引用同一执行事项，指标及提醒规则待确认。'],
    dashboard: ['汇总账号、产品和模板表现，支持运营判断。', '文档建议项；账号分析、模板效果和爆款洞察放在页面内，数据口径未定。'],
    templates: ['积累可复用的笔记结构、形式和案例，引用测试结果。', '“模板库”为规划展示名，是否正式替代“笔记模板”待确认。'],
    titles: ['保存标题、适用产品或场景及使用反馈。', '按创作需要检索和复用。'],
    tools: ['保存团队常用工具入口和用途说明。', '不在工具说明中存储密码或密钥。'],
    creation: ['围绕对标笔记、标题正文、封面和模板组织内容创作。', '保留规划入口；批量能力、AI 能力和具体页面待确认。'],
    knowledge: ['集中检索 SOP、方法、常见问题和长期经验。', '沿用飞书知识中心方向；正文同步及权限后续接入。'],
    learning: ['记录学习、案例拆解和阶段复盘，并整理下一步行动。', '成熟内容整理到知识库。'],
    members: ['查看成员信息、分工和关联工作；工作量为页面内视图。', '统计口径、成员之间的数据可见范围待确认。'],
    accounts: ['维护小红书等运营账号的负责人、归属及使用状态。', '这是业务账号，区别于系统登录用户和“账户资料”。'],
    attendance: ['记录和核对出勤、请假等情况。', '补录规则、审批方式与可见范围待确认。'],
    ledger: ['管理员记录收入支出、用途、经办人及凭证。', '员工不可访问实际财务数据；分类和统计口径后续确认。'],
    settlements: ['管理员汇总结算与报销，记录核对及实际支付。', '垫付跨月累计，不因月末清零；分工、部分付款待确认。'],
    warehouse: ['管理产品库存、包材库存及出入库记录。', '单位、盘点、订单关联和样品转出规则待确认。'],
    assets: ['维护拍摄样品和工作室设备的保管、借用、维修情况。', '样品与素材拍摄共用档案；与产品库存的划分待确认。'],
    roles: ['维护登录用户及角色对各中心的权限。', '正式权限必须由服务端校验，当前原型不提供身份与权限保障。'],
    shops: ['维护店铺基础信息及经营资料。', '与账户资料是否重叠待确认。'],
    'account-info': ['集中维护需统一管理的账户资料及关联信息。', '“账户”的具体含义待确认，可能与店铺资料合并。'],
    profile: ['维护本人基础信息及个人设置。', '可修改字段及与成员档案的同步关系待确认。'],
  };
  const seedOps = () => ({version: 1, materials: [
    { id:'mat-demo-1', title:'抽屉收纳前后对比：封面结构参考', kind:'参考笔记', tags:['收纳','前后对比'], url:'', note:'示例：记录画面分区、对比关系以及标题如何突出问题。不代表已采集真实笔记。', archived:false, createdAt: new Date().toISOString(), example:true },
    { id:'mat-demo-2', title:'小空间收纳：使用场景参考', kind:'图片', tags:['收纳','场景'], url:'', note:'示例：观察产品在具体空间中的使用方式。当前未上传实际图片。', archived:false, createdAt: new Date().toISOString(), example:true },
  ], tests: [
    { id:'test-demo-1', title:'收纳盒封面对比测试', materialIds:['mat-demo-1','mat-demo-2'], hypothesis:'对比“使用场景”与“收纳前后对比”两种封面表达。', variants:'A：使用场景；B：前后对比。其他条件尽量一致。', date:today, state:'待执行', conclusion:'', observations:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), example:true },
  ] });
  let db;
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    db = raw === null ? seedOps() : validate(raw) ? raw : null;
  } catch { db = null; }
  const badStorage = db === null;
  if (!db) db = {version:1,materials:[],tests:[]};
  let page = 'daily', materialQuery='', materialKind='all', materialScope='active', testQuery='', testState='all', historyDate='', activeMaterial=null, currentTest=null;
  function validate(d) {
    return d && d.version===1 && Array.isArray(d.materials) && Array.isArray(d.tests) && d.materials.every(m => m && typeof m.id==='string' && typeof m.title==='string' && typeof m.note==='string' && typeof m.url==='string' && Array.isArray(m.tags) && m.tags.every(x=>typeof x==='string') && materialTypes.includes(m.kind) && typeof m.archived==='boolean') && d.tests.every(t=> t && typeof t.id==='string' && ['title','hypothesis','variants','date','conclusion'].every(k=>typeof t[k]==='string') && testStates.includes(t.state) && Array.isArray(t.materialIds) && t.materialIds.every(x=>typeof x==='string') && Array.isArray(t.observations) && t.observations.every(o=> o && ['id','variant','observedAt','window','url','note'].every(k=>typeof o[k]==='string') && Array.isArray(o.metrics) && o.metrics.every(m=>typeof m.name==='string' && Number.isFinite(m.value) && m.value>=0)));
  }
  function commit(change) {
    if (badStorage) { toast('原型资料读取异常，已保留原记录，请先导出备份'); return false; }
    const next = structuredClone(db); change(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); db=next; return true; }
    catch { toast('浏览器空间不足或禁止保存，本次修改未保存'); return false; }
  }
  function safeURL(value) {
    if (!value.trim()) return '';
    try { const url = new URL(value.trim()); if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return null; return url.href; } catch { return null; }
  }
  const names = Object.fromEntries(groups.flatMap(g=>g[1]));
  const material = id => db.materials.find(m=>m.id===id);
  const experiment = id => db.tests.find(t=>t.id===id);
  const executionDate = t => t.completedAt ? new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.completedAt)) : t.date;
  const testCounts = id => db.tests.filter(t=>t.materialIds.includes(id)).length;
  const niceDate = value => value ? value.slice(0,10) : '未安排';
  const formHeader = (title,id) => `<div class="dialog-header"><h2>${h(title)}</h2><button type="button" class="icon-button" data-close="${id}" aria-label="关闭${h(title)}">×</button></div>`;
  const options = (values,selected) => values.map(v=>`<option${v===selected?' selected':''}>${h(v)}</option>`).join('');
  const empty = (title,desc) => `<div class="empty"><h3>${h(title)}</h3><p>${h(desc)}</p></div>`;
  const heading = (name,desc,action='') => `<div class="eyebrow">STUDIO OS <span>${h(groups.find(g=>g[1].some(p=>p[1]===name))?.[0]||'工作空间')}</span></div><div class="heading module-heading"><div><h1>${h(name)}</h1><p>${h(desc)}</p></div>${action}</div>`;
  const sourceLink = url => safeURL(url) ? `<a href="${h(safeURL(url))}" target="_blank" rel="noopener noreferrer" class="secondary source-link">打开来源 ↗</a>` : '<span class="muted">未填写来源链接</span>';
  const notice = () => badStorage ? '<div class="storage-error">原型资料格式异常，当前只读，原记录未被覆盖。请先导出备份，再联系开发处理。</div>' : '';
  // Build seven-center navigation from the accepted sitemap. Unbuilt pages explicitly show planning state.
  $('nav[aria-label="主要模块"]').innerHTML = groups.map((g,i)=>`<details class="nav-group" ${i===0||i===1?'open':''}><summary>${h(g[0])}${i===5?'<small>管理员</small>':''}</summary>${g[1].map(([id,name])=>`<a href="#${id}" data-page="${id}" class="nav-item" ${id==='daily'?'aria-current="page"':''}>${h(name)}${specs[id]?'<small>规划</small>':''}</a>`).join('')}</details>`).join('');
  $('.nav-label').textContent='STUDIO OS';
  $('.sidebar-note').remove();
  $('.sidebar').classList.add('sitemap-sidebar');
  $('#main').insertAdjacentHTML('beforeend','<section id="page-history" hidden></section><section id="page-conclusions" hidden></section><section id="page-planned" hidden></section>');
  document.body.insertAdjacentHTML('beforeend', '<dialog id="material-editor" class="editor" aria-label="素材编辑"></dialog><dialog id="material-detail" class="drawer" aria-label="素材详情"></dialog><dialog id="test-editor" class="editor wide-editor" aria-label="实验编辑"></dialog><dialog id="test-detail" class="drawer wide-drawer" aria-label="实验详情"></dialog><dialog id="observation-editor" class="editor wide-editor" aria-label="添加观察记录"></dialog><dialog id="schedule-editor" class="editor" aria-label="安排执行事项"></dialog>');
  $('#scope').insertAdjacentHTML('beforeend','<button class="secondary" id="export-prototype">导出本浏览器体验数据</button>');
  function route() {
    const requested = location.hash.slice(1) || 'daily'; page = names[requested] ? requested : 'daily';
    for (const el of $('#main').children) el.hidden=true;
    const target = specs[page] ? 'planned' : page;
    $('#page-'+target).hidden=false;
    document.querySelectorAll('[data-page]').forEach(a=> { const selected=a.dataset.page===page; a.classList.toggle('active',selected); if(selected){a.setAttribute('aria-current','page');a.closest('details').open=true;}else a.removeAttribute('aria-current'); });
    $('.topbar strong').textContent=names[page]; document.title=names[page]+' · Studio OS';
    if (page==='materials') renderMaterials();
    if (page==='tests') renderTests();
    if (page==='history') renderHistory();
    if (page==='conclusions') renderConclusions();
    if (specs[page]) $('#page-planned').innerHTML=heading(names[page],'整体规划已保留，功能尚未开发。')+`<section class="work-panel planning-panel"><span class="stage-label">规划范围 · 非可用功能</span><h2>${h(names[page])}</h2><p>${h(specs[page][0])}</p><div class="planning-rule">${h(specs[page][1])}</div><p class="muted">本页用于核对网站地图，不包含真实业务数据。后续按对应业务规则开发。</p></section>`;
  }
  function renderMaterials() {
    const list=db.materials.filter(m=>(materialScope==='archived'?m.archived:!m.archived) && (materialKind==='all'||m.kind===materialKind) && [m.title,m.note,...m.tags].join(' ').toLowerCase().includes(materialQuery.toLowerCase()));
    $('#page-materials').innerHTML=heading('素材收集箱','留下参考，也留下值得借鉴的原因。','<button class="primary" data-action="new-material">＋ 收集素材</button>')+notice()+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">搜索素材<input id="material-search" type="search" value="${h(materialQuery)}" placeholder="标题、标签或观察说明"></label><label>素材类型<select id="material-kind"><option value="all">全部类型</option>${options(materialTypes,materialKind)}</select></label><label>查看范围<select id="material-scope"><option value="active" ${materialScope==='active'?'selected':''}>在用素材</option><option value="archived" ${materialScope==='archived'?'selected':''}>已归档</option></select></label><span class="muted">${list.length} 条素材</span></div><div class="material-grid">${list.map(m=>`<article class="material-card"><div class="material-card-top"><span class="type-tag">${h(m.kind)}</span><span class="muted">${m.example?'示例素材':'我的收集'}</span></div><button class="material-title" data-material="${h(m.id)}">${h(m.title)}</button><p class="material-excerpt">${h(m.note||'尚未填写观察说明')}</p><div class="tag-list">${m.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><div class="material-card-foot"><span>${testCounts(m.id)} 次实验引用</span><button data-material="${h(m.id)}">查看详情 →</button></div></article>`).join('')}</div>${list.length?'':empty('没有符合条件的素材','调整筛选，或收集一条新的参考。')}<div class="module-foot">当前支持链接和文字资料；图片、视频附件存储将在正式数据层接入。</div></section>`;
    $('#material-search').addEventListener('input',e=>{materialQuery=e.target.value;renderPreserveInput('material-search',renderMaterials);});
    $('#material-kind').value=materialKind; $('#material-kind').onchange=e=>{materialKind=e.target.value;renderMaterials();}; $('#material-scope').onchange=e=>{materialScope=e.target.value;renderMaterials();};
  }
  function renderPreserveInput(id,renderFn){ const el=$('#'+id),start=el.selectionStart,end=el.selectionEnd;renderFn();$('#'+id).focus();$('#'+id).setSelectionRange(start,end); }
  function editMaterial(id=null) {
    const m=id?material(id):null; activeMaterial=id;
    $('#material-editor').innerHTML=`<form id="material-form">${formHeader(m?'编辑素材':'收集素材','material-editor')}<label>素材名称 *<input name="title" required maxlength="120" value="${h(m?.title||'')}" placeholder="用一句话描述这条参考"></label><div class="form-grid"><label>素材类型<select name="kind">${options(materialTypes,m?.kind||'参考笔记')}</select></label><label>标签<input name="tags" maxlength="200" value="${h(m?.tags.join('，')||'')}" placeholder="用逗号分隔，如：收纳，封面"></label></div><label>来源链接<input name="url" type="url" value="${h(m?.url||'')}" maxlength="2000" placeholder="https://…"></label><label>值得借鉴的地方<textarea name="note" rows="5" maxlength="5000" placeholder="观察到什么？准备怎么用？">${h(m?.note||'')}</textarea></label><div class="dialog-actions"><button type="button" class="secondary" data-close="material-editor">取消</button><button type="submit" class="primary">保存素材</button></div></form>`;
    $('#material-editor').showModal(); $('#material-form').onsubmit=e=>{
      e.preventDefault();const f=e.currentTarget, title=f.elements.title.value.trim(),url=safeURL(f.elements.url.value);
      if (!title){toast('请填写素材名称');return;} if(url===null){toast('请填写 http 或 https 来源链接');return;}
      const values={title,kind:f.elements.kind.value,tags:[...new Set(f.elements.tags.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))],url,note:f.elements.note.value.trim()};
      if(!commit(d=>{if(id) Object.assign(d.materials.find(m=>m.id===id),values);else d.materials.unshift({id:crypto.randomUUID(),...values,archived:false,createdAt:new Date().toISOString(),example:false});}))return;
      $('#material-editor').close();renderMaterials(); if($('#material-detail').open) materialDetail(id);toast('素材已保存');
    };
  }
  function materialDetail(id) {
    const m=material(id);if(!m){toast('未找到这条素材');return;}activeMaterial=id;
    const linked=db.tests.filter(t=>t.materialIds.includes(id));
    $('#material-detail').innerHTML=formHeader('素材详情','material-detail')+`<h2>${h(m.title)}</h2><div class="detail-meta"><span class="type-tag">${h(m.kind)}</span><span>${m.archived?'已归档':'在用素材'}</span>${m.example?'<span>示例</span>':''}</div><div class="tag-list">${m.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><div class="detail-content"><h3>来源</h3>${sourceLink(m.url)}<h3>观察与用法</h3><p class="preserve-text">${h(m.note||'暂无说明')}</p><div class="action-row"><button class="secondary" data-action="edit-material">编辑素材</button><button class="secondary" data-action="archive-material">${m.archived?'恢复使用':'归档素材'}</button></div><h3>关联实验 · ${linked.length}</h3>${linked.map(t=>`<button class="linked-record" data-test="${h(t.id)}"><b>${h(t.title)}</b><span>${h(t.state)} →</span></button>`).join('')||'<p class="muted">暂未引用到实验。</p>'}${m.archived?'<p class="muted">归档素材保留历史引用，恢复后可创建新实验。</p>':'<button class="primary" data-action="material-to-test">用这条素材创建实验</button>'}</div>`;
    if(!$('#material-detail').open)$('#material-detail').showModal();
  }
  function renderTests() {
    const list=db.tests.filter(t=>(testState==='all'||t.state===testState)&&[t.title,t.hypothesis,t.variants].join(' ').toLowerCase().includes(testQuery.toLowerCase()));
    $('#page-tests').innerHTML=heading('素材实验室','把参考变成假设，留下执行过程、观察记录与结论。','<button class="primary" data-action="new-test">＋ 创建实验</button>')+notice()+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">搜索实验<input id="test-search" type="search" value="${h(testQuery)}" placeholder="实验名称、假设或版本说明"></label><label>实验状态<select id="test-state"><option value="all">全部状态</option>${options(testStates,testState)}</select></label><span class="muted">${list.length} 个实验</span></div><div class="table-scroll"><table class="record-table"><thead><tr><th>实验与假设</th><th>引用素材</th><th>计划日期</th><th>进度</th><th>观察记录</th><th>执行事项</th></tr></thead><tbody>${list.map(t=>`<tr><td><button class="table-title" data-test="${h(t.id)}">${h(t.title)}</button><p>${h(t.hypothesis)}</p></td><td>${t.materialIds.length} 条</td><td>${h(niceDate(t.date))}</td><td><span class="type-tag">${h(t.state)}</span></td><td>${t.observations.length} 次</td><td>${tasks.some(a=>a.reference?.entityId===t.id)?'已安排':'未安排'}</td></tr>`).join('')}</tbody></table></div>${list.length?'':empty('暂时没有符合条件的实验','从素材详情创建，或直接写下一个待验证的想法。')}<div class="module-foot">实验状态与执行事项的完成状态分开记录；完成事项不自动得出测试结论。</div></section>`;
    $('#test-search').oninput=e=>{testQuery=e.target.value;renderPreserveInput('test-search',renderTests);}; $('#test-state').value=testState;$('#test-state').onchange=e=>{testState=e.target.value;renderTests();};
  }
  function editTest(id=null,source=null) {
    const t=id?experiment(id):null;
    $('#test-editor').innerHTML=`<form id="test-form">${formHeader(t?'编辑实验':'创建实验','test-editor')}<label>实验名称 *<input name="title" required maxlength="120" value="${h(t?.title||'')}" placeholder="这一次想验证什么"></label><label>测试想法 / 假设 *<textarea name="hypothesis" rows="3" maxlength="3000" required placeholder="我们认为改变……可能带来……">${h(t?.hypothesis||'')}</textarea></label><label>内容版本与测试条件 *<textarea name="variants" rows="3" maxlength="3000" required placeholder="写清 A/B 或其他版本的差异，以及观察时要保持一致的条件。">${h(t?.variants||'')}</textarea></label><div class="form-grid"><label>计划日期<input name="date" type="date" value="${h(t?.date||selectedDate)}" required></label><label>实验状态<select name="state">${options(testStates,t?.state||'待执行')}</select></label></div><fieldset class="material-picker"><legend>引用素材（可多选）</legend>${db.materials.filter(m=>!m.archived||t?.materialIds.includes(m.id)).map(m=>`<label><input type="checkbox" name="material" value="${h(m.id)}" ${(t?.materialIds.includes(m.id)||source===m.id)?'checked':''}>${h(m.title)}${m.archived?'（已归档）':''}</label>`).join('')||'<p class="muted">还没有素材，也可以先记录实验想法。</p>'}</fieldset><label>结论与下一步<textarea name="conclusion" rows="3" maxlength="5000" placeholder="结束实验前，写清结论、适用条件与下一步。">${h(t?.conclusion||'')}</textarea></label><div class="dialog-actions"><button type="button" class="secondary" data-close="test-editor">取消</button><button type="submit" class="primary">保存实验</button></div></form>`;
    $('#test-editor').showModal();$('#test-form').onsubmit=e=>{
      e.preventDefault();const f=e.currentTarget, v={title:f.elements.title.value.trim(),hypothesis:f.elements.hypothesis.value.trim(),variants:f.elements.variants.value.trim(),date:f.elements.date.value,state:f.elements.state.value,conclusion:f.elements.conclusion.value.trim(),materialIds:[...f.querySelectorAll('input[name="material"]:checked')].map(el=>el.value),updatedAt:new Date().toISOString()};
      if(!v.title||!v.hypothesis||!v.variants){toast('请填写名称、假设与版本条件');return;}if(v.state==='已结束'&&!v.conclusion){toast('结束实验前，请先留下结论');return;}
      const newId=id||crypto.randomUUID();if(!commit(d=>{if(id)Object.assign(d.tests.find(t=>t.id===id),v);else d.tests.unshift({id:newId,...v,observations:[],createdAt:new Date().toISOString(),example:false});}))return;
      $('#test-editor').close(); if($('#material-detail').open)$('#material-detail').close(); location.hash='tests';renderTests();testDetail(newId);render();toast('实验已保存');
    };
  }
  function testDetail(id) {
    const t=experiment(id);if(!t){toast('未找到这条实验');return;}currentTest=id;
    const task=tasks.find(a=>a.reference?.entityId===id);
    $('#test-detail').innerHTML=formHeader('实验详情','test-detail')+`<h2>${h(t.title)}</h2><div class="detail-meta"><span class="type-tag">${h(t.state)}</span><span>计划 ${h(t.date)}</span>${t.example?'<span>示例实验</span>':''}</div><div class="detail-content"><h3>测试想法 / 假设</h3><p class="preserve-text">${h(t.hypothesis)}</p><h3>版本与测试条件</h3><p class="preserve-text">${h(t.variants)}</p><h3>引用素材 · ${t.materialIds.length}</h3>${t.materialIds.map(mid=>{const m=material(mid);return m?`<button class="linked-record" data-material="${h(mid)}"><b>${h(m.title)}</b><span>${m.archived?'已归档 · ':''}${h(m.kind)} →</span></button>`:'<p class="muted">关联素材未找到</p>';}).join('')||'<p class="muted">暂未引用素材。</p>'}<div class="action-row"><button class="secondary" data-action="edit-test">编辑实验与结论</button><button class="primary" data-action="schedule-test">${task?'查看执行事项':'安排执行事项'}</button></div>${task?`<p class="muted">关联事项：${h(task.title)} · ${h(task.date)} · ${statusNames[task.status]}</p>`:''}<h3>观察记录 · ${t.observations.length}</h3><p class="muted">每次观察单独保留版本、采集时间和窗口，不覆盖历史数据。指标按实际口径填写。</p>${t.observations.map(o=>`<article class="observation"><div><b>${h(o.variant)}</b><span>${h(o.observedAt.replace('T',' '))}（北京时间）</span></div><p>观察窗口：${h(o.window)}</p><div class="metric-list">${o.metrics.map(m=>`<span>${h(m.name)} <b>${h(m.value)}</b></span>`).join('')}</div>${o.url?sourceLink(o.url):''}${o.note?`<p class="preserve-text">${h(o.note)}</p>`:''}</article>`).join('')}<button class="secondary" data-action="new-observation">＋ 添加观察记录</button><h3>结论与下一步</h3><p class="preserve-text">${h(t.conclusion||'还没有结论。记录结果后，再判断这次测试说明了什么。')}</p><p class="muted">有结论的实验会直接出现在知识中心的“测试结论”，保持同一份内容。</p></div>`;
    if(!$('#test-detail').open)$('#test-detail').showModal();
  }
  function scheduleTest(id) {
    const existing=tasks.find(t=>t.reference?.entityId===id);
    if(existing){$('#test-detail').close();selectedDate=existing.date;filter='all';$('#search').value='';$('#type-filter').value='all';location.hash='daily';render();openDetail(existing.id);return;}
    const t=experiment(id);if(!t)return;
    $('#schedule-editor').innerHTML=`<form id="schedule-form">${formHeader('安排执行事项','schedule-editor')}<p class="muted">执行事项与实验关联。重复安排会打开同一事项。</p><label>事项名称 *<input name="title" required maxlength="100" value="${h('执行：'+t.title)}"></label><label>执行日期 *<input name="date" type="date" required value="${h(t.date)}"></label><label>工作说明<textarea name="note" maxlength="3000" rows="4">${h(t.hypothesis+'\n'+t.variants)}</textarea></label><div class="dialog-actions"><button type="button" class="secondary" data-close="schedule-editor">取消</button><button type="submit" class="primary">加入我的工作台</button></div></form>`;
    $('#schedule-editor').showModal();$('#schedule-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,title=f.elements.title.value.trim();if(!title){toast('请填写事项名称');return;}
      if(tasks.some(t=>t.reference?.entityId===id)){toast('这项实验已经安排');return;}
      const item={id:crypto.randomUUID(),title,type:'内容制作',date:f.elements.date.value,time:'',status:'todo',note:f.elements.note.value.trim(),reference:{entityId:id,title:t.title,type:'关联实验',detail:t.hypothesis}};
      tasks.push(item);if(!save()){tasks.pop();return;}$('#schedule-editor').close();$('#test-detail').close();selectedDate=item.date;filter='all';$('#search').value='';$('#type-filter').value='all';location.hash='daily';render();toast('已加入工作台，保留实验关联');
    };
  }
  function addObservation(id) {
    const metricRow=()=>'<div class="metric-row"><label>指标名称<input name="metricName" required maxlength="40" placeholder="按实际指标填写"></label><label>数值<input name="metricValue" type="number" min="0" max="9007199254740991" step="any" required></label><button type="button" data-remove-metric class="icon-button" aria-label="移除这行指标">×</button></div>';
    $('#observation-editor').innerHTML=`<form id="observation-form">${formHeader('添加观察记录','observation-editor')}<div class="form-grid"><label>内容版本 *<input name="variant" required maxlength="100" placeholder="如：封面 A"></label><label>采集时间（北京时间）*<input name="observedAt" type="datetime-local" required value="${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(' ','T')}"></label></div><label>观察窗口 *<input name="window" required maxlength="120" placeholder="如：发布后 24 小时；或注明本次统计起止时间"></label><label>发布链接<input name="url" type="url" maxlength="2000" placeholder="https://…"></label><div id="metric-rows">${metricRow()}</div><button type="button" class="text-button" id="add-metric">＋ 再加一项指标</button><label style="margin-top:18px">观察备注<textarea name="note" rows="3" maxlength="3000" placeholder="记录采集条件、异常或说明"></textarea></label><p class="form-tip">不同版本和观察窗口分别记录；这里不自动判断好坏，也不合并不同口径。</p><div class="dialog-actions"><button type="button" class="secondary" data-close="observation-editor">取消</button><button type="submit" class="primary">保存本次观察</button></div></form>`;
    $('#observation-editor').showModal();$('#add-metric').onclick=()=>$('#metric-rows').insertAdjacentHTML('beforeend',metricRow());
    $('#metric-rows').onclick=e=>{const b=e.target.closest('[data-remove-metric]');if(b&&$('#metric-rows').children.length>1)b.closest('.metric-row').remove();};
    $('#observation-form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,url=safeURL(f.elements.url.value);if(url===null){toast('链接只支持 http 或 https');return;}
      const metrics=[...f.querySelectorAll('.metric-row')].map(row=>({name:row.querySelector('[name="metricName"]').value.trim(),value:Number(row.querySelector('[name="metricValue"]').value)}));
      if(metrics.some(m=>!m.name||!Number.isFinite(m.value)||m.value<0)||new Set(metrics.map(m=>m.name)).size!==metrics.length){toast('请填写非负数值，且同次记录的指标名称不能重复');return;}
      const o={id:crypto.randomUUID(),variant:f.elements.variant.value.trim(),observedAt:f.elements.observedAt.value,window:f.elements.window.value.trim(),url,note:f.elements.note.value.trim(),metrics};if(!o.variant||!o.window){toast('请填写版本和观察窗口');return;}
      if(!commit(d=>{const t=d.tests.find(t=>t.id===id);t.observations.unshift(o);t.updatedAt=new Date().toISOString();}))return;
      $('#observation-editor').close();testDetail(id);renderTests();toast('本次观察已保存，历史记录保留');
    };
  }
  function renderHistory() {
    const done=tasks.filter(t=>t.status==='done'&&(!historyDate||executionDate(t)===historyDate)).sort((a,b)=>executionDate(b).localeCompare(executionDate(a)));
    $('#page-history').innerHTML=heading('我的执行记录','按完成日期回看已完成事项，查看说明与关联产出。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label>完成日期<input type="date" id="history-date" value="${h(historyDate)}"></label><button class="secondary" id="history-clear">全部日期</button><span class="muted">${done.length} 件已完成</span></div>${done.map(t=>`<button class="history-record" data-history-task="${h(t.id)}"><span><b>${h(t.title)}</b><small>${h(t.note||'未填写完成说明')}</small></span><span>${h(executionDate(t))}<br>${t.completedAt?'已记录完成时间':'早期记录 · 计划日期'}<br>${h(t.type)}</span></button>`).join('')||empty('还没有已完成事项','在今日工作中完成的事项会出现在这里。')}<div class="module-foot">新完成的事项记录实际完成日期；早期原型未记完成时间的事项暂按计划日期展示并标记。发布产出字段后续完善。</div></section>`;
    $('#history-date').onchange=e=>{historyDate=e.target.value;renderHistory();};$('#history-clear').onclick=()=>{historyDate='';renderHistory();};
  }
  function renderConclusions() {
    const list=db.tests.filter(t=>t.conclusion.trim());
    $('#page-conclusions').innerHTML=heading('测试结论','直接引用实验室结论，保留原实验条件与观察记录。')+`<section class="work-panel module-panel">${list.map(t=>`<article class="conclusion-card"><div><button class="table-title" data-test="${h(t.id)}">${h(t.title)}</button><span class="type-tag">${h(t.state)}</span></div><p class="preserve-text">${h(t.conclusion)}</p><small class="muted">${t.observations.length} 次观察 · ${t.materialIds.length} 条素材 · 更新于 ${h(niceDate(t.updatedAt))}</small></article>`).join('')||empty('暂时没有测试结论','在素材实验室保存结论后，这里会直接引用同一份记录。')}</section>`;
  }
  document.addEventListener('click',e=>{
    const m=e.target.closest('[data-material]'),t=e.target.closest('[data-test]'),a=e.target.closest('[data-action]'),ht=e.target.closest('[data-history-task]');
    if(m){if($('#test-detail').open)$('#test-detail').close();materialDetail(m.dataset.material);}
    if(t){if($('#material-detail').open)$('#material-detail').close();testDetail(t.dataset.test);}
    if(ht)openDetail(ht.dataset.historyTask);
    if(!a)return;
    const actions={ 'new-material':()=>editMaterial(), 'edit-material':()=>editMaterial(activeMaterial), 'archive-material':()=>{if(commit(d=>{const item=d.materials.find(m=>m.id===activeMaterial);item.archived=!item.archived;})){materialDetail(activeMaterial);renderMaterials();toast('素材状态已更新，历史引用保留');}}, 'material-to-test':()=>editTest(null,activeMaterial), 'new-test':()=>editTest(), 'edit-test':()=>editTest(currentTest), 'schedule-test':()=>scheduleTest(currentTest), 'new-observation':()=>addObservation(currentTest) };
    actions[a.dataset.action]?.();
  });
  $('#export-prototype').onclick=()=>{
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),operations:db,rawOperations:badStorage?localStorage.getItem(storageKey):undefined,daily:{version:1,tasks}},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='studio-os-prototype-'+localToday()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  window.Ops={
    referenceTitle:r=>experiment(r.entityId)?.title||r.title,
    taskReference:r=>{const t=experiment(r.entityId);return `<h3>关联实验</h3>${t?`<button class="linked-record" data-task-test="${h(t.id)}"><b>${h(t.title)}</b><span>${h(t.state)} →</span></button>`:'<p class="muted">关联实验暂不可用，原事项仍保留。</p>'}`;},
    openTest:id=>testDetail(id),
  };
  window.addEventListener('hashchange',route);route();render();
})();
