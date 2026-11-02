'use strict';
const $ = (s) => document.querySelector(s);
const key = 'studio-os-daily-prototype-v1';
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const today = localToday();
const statusNames = { todo: '待处理', doing: '进行中', done: '已完成' };
const types = ['内容制作', '素材收集', '数据记录', '测试复盘', '其他事项'];
const seed = () => [
  { id: 'demo-1', title: '完成收纳盒笔记的两版封面', type: '内容制作', date: today, time: '11:00', status: 'doing', note: '用同一组产品图做两版封面。\nA 版突出使用场景，B 版突出收纳前后对比。\n完成后记录两版的主要差异，方便后续测试。', reference: { title: '收纳盒封面对比测试', type: '关联测试 · 示例', detail: '假设：前后对比图比单纯产品图更容易吸引点击。\n测试内容：同一产品、两种封面表达。\n待补充：发布时间、结果链接和同一观察窗口下的数据。' } },
  { id: 'demo-2', title: '整理 5 条值得借鉴的收纳类笔记', type: '素材收集', date: today, time: '14:00', status: 'todo', note: '收集与本周选题有关的笔记，记录来源和具体值得借鉴的地方。\n不要只存链接，留下封面、标题或表达方式的观察。', reference: { title: '本周素材收集方向', type: '关联素材 · 示例', detail: '关注：小空间收纳、抽屉分区、使用前后对比。\n每条保留：原文来源、截图和一句值得借鉴的原因。\n当前仅展示示例说明，真实素材库尚未接入。' } },
  { id: 'demo-3', title: '补充昨天发布笔记的观察数据', type: '数据记录', date: today, time: '16:00', status: 'todo', note: '对照后台，记录昨天发布内容的数据。\n标明采集时间与观察窗口，避免混用不同时点的数据。\n具体指标口径会在测试模块设计时确认。', reference: null },
  { id: 'demo-4', title: '回看封面测试，写下下一步想法', type: '测试复盘', date: today, time: '17:30', status: 'todo', note: '记录这次测试验证了什么、还有哪些不确定，以及下一次可以只改变的一个变量。', reference: { title: '收纳盒封面对比测试', type: '关联测试 · 示例', detail: '这条记录仅用于演示从工作事项查看测试背景的流程。\n未连接真实发布记录，也没有预设成功阈值。' } },
  { id: 'demo-5', title: '列出本周的 3 个内容选题方向', type: '内容制作', date: today, time: '09:30', status: 'done', note: '已整理：小空间收纳、抽屉分区、桌面快速整理。\n后续收集对应参考素材，再决定测试选题。', reference: null },
];
let tasks;
try {
  const saved = JSON.parse(localStorage.getItem(key));
  const valid = saved && saved.version === 1 && Array.isArray(saved.tasks) && saved.tasks.every(t => typeof t.id === 'string' && typeof t.title === 'string' && typeof t.note === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Object.hasOwn(statusNames, t.status) && types.includes(t.type) && typeof t.time === 'string' && (t.reference === null || (t.reference && ['title','type','detail'].every(k => typeof t.reference[k] === 'string'))));
  tasks = valid ? saved.tasks : seed();
} catch { tasks = seed(); }
let selectedDate = today, filter = 'all', activeId = null, toastTimer;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2600); }
function save() { try { localStorage.setItem(key, JSON.stringify({ version: 1, tasks })); return true; } catch { toast('浏览器无法保存，刷新后可能丢失修改'); return false; } }
function render() {
  $('#work-date').value = selectedDate;
  const date = new Date(selectedDate + 'T12:00:00+08:00');
  $('#date-display').textContent = new Intl.DateTimeFormat('zh-CN', {month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(date);
  const daily = tasks.filter(t => t.date === selectedDate), done = daily.filter(t => t.status === 'done').length;
  $('#total-count').textContent = daily.length + ' 件';
  $('#progress-caption').textContent = daily.length ? `已完成 ${done} 件，还有 ${daily.length - done} 件待推进` : '今天的清单还是空的，添加一个小目标吧';
  const percent = daily.length ? Math.round(done / daily.length * 100) : 0;
  $('#progress-ring').style.setProperty('--progress', percent + '%'); $('#progress-number').textContent = percent + '%';
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('selected', b.dataset.filter === filter); b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); b.querySelector('span').textContent = b.dataset.filter === 'all' ? daily.length : daily.filter(t => t.status === b.dataset.filter).length; });
  const query = $('#search').value.trim().toLocaleLowerCase(), kind = $('#type-filter').value;
  const visible = daily.filter(t => (filter === 'all' || t.status === filter) && (kind === 'all' || t.type === kind) && (t.title + ' ' + t.note).toLocaleLowerCase().includes(query)).sort((a,b) => (a.status === 'done') - (b.status === 'done') || (a.time || '99:99').localeCompare(b.time || '99:99'));
  $('#task-list').innerHTML = visible.length ? visible.map(t => `<article class="task ${t.status}"><button class="check" data-toggle="${escapeHTML(t.id)}" aria-label="${t.status === 'done' ? '重新打开' : '完成'}：${escapeHTML(t.title)}">${t.status === 'done' ? '✓' : ''}</button><button class="task-body" data-open="${escapeHTML(t.id)}" aria-label="查看事项：${escapeHTML(t.title)}"><span class="task-title">${escapeHTML(t.title)}</span><span class="task-meta"><span class="type-tag" data-type="${t.type}">${t.type}</span>${t.time ? `<span>${escapeHTML(t.time)} 前</span><i class="meta-dot"></i>` : ''}<span>${t.reference ? escapeHTML(t.reference.title) : '我的事项'}</span></span></button><span class="state-tag ${t.status}">${statusNames[t.status]}</span><span class="task-arrow" aria-hidden="true">›</span></article>`).join('') : `<div class="empty"><span>☘</span><h3>${daily.length ? '没有符合条件的事项' : '为这一天，安排一件事'}</h3><p>${daily.length ? '换个关键词，或清除筛选再看看。' : '从一个具体、容易开始的小目标出发。'}</p><button id="empty-action">${daily.length ? '清除筛选' : '添加事项'}</button></div>`;
}
function openEditor(type = '内容制作') { const form = $('#task-form'); form.reset(); form.elements.date.value = selectedDate; form.elements.type.value = type; $('#editor').showModal(); form.elements.title.focus(); }
function detail() {
  const task = tasks.find(t => t.id === activeId); if (!task) return;
  $('#detail-body').innerHTML = `<div class="dialog-header"><span>我的工作事项</span><button class="icon-button" data-close="detail" aria-label="关闭事项详情">×</button></div><h2 id="detail-title">${escapeHTML(task.title)}</h2><div class="detail-meta"><span class="type-tag" data-type="${task.type}">${task.type}</span><span>${escapeHTML(task.date)} ${task.time ? escapeHTML(task.time) + ' 前' : ''}</span><span>负责人：我</span></div><div class="detail-content"><h3>工作状态</h3><div class="status-group" role="group" aria-label="修改工作状态">${Object.entries(statusNames).map(([k,v])=>`<button data-status="${k}" class="${task.status === k ? 'selected' : ''}" aria-pressed="${task.status === k}">${v}</button>`).join('')}</div><label for="detail-note">工作说明与完成情况</label><textarea id="detail-note" maxlength="3000" rows="7">${escapeHTML(task.note)}</textarea><button class="primary save-note" id="save-note" style="margin-top:12px">保存说明</button>${task.reference ? `<h3>${escapeHTML(task.reference.type)}</h3><div class="reference"><span>▧</span><div>${escapeHTML(task.reference.title)}<small>示例资料，点击展开查看背景</small></div></div><details style="margin-top:12px"><summary style="font-size:12px;cursor:pointer;color:#658059">查看关联资料</summary><p style="white-space:pre-wrap;font-size:12px;line-height:2;color:#839177">${escapeHTML(task.reference.detail)}</p></details>` : '<h3>关联资料</h3><p style="font-size:12px;color:#95a18b">这条事项暂未关联素材或测试。</p>'}</div>`;
}
function openDetail(id) { activeId = id; detail(); $('#detail').showModal(); }
function changeDate(delta) { const date = new Date(selectedDate + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + delta); selectedDate = date.toISOString().slice(0,10); render(); }
$('#add-task').addEventListener('click', () => openEditor());
$('#add-review').addEventListener('click', () => openEditor('测试复盘'));
$('#today').addEventListener('click', () => { selectedDate = localToday(); render(); });
$('#prev-date').addEventListener('click', () => changeDate(-1)); $('#next-date').addEventListener('click', () => changeDate(1));
$('#work-date').addEventListener('change', e => { if (e.target.value && !e.target.validity.badInput) { selectedDate = e.target.value; render(); } });
$('#search').addEventListener('input', render); $('#type-filter').addEventListener('change', render);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
$('#task-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; const title = form.elements.title.value.trim();
  if (!title) { form.elements.title.setCustomValidity('请填写事项名称'); form.elements.title.reportValidity(); return; }
  tasks.push({ id: crypto.randomUUID(), title, type: form.elements.type.value, date: form.elements.date.value, time: form.elements.time.value, note: form.elements.note.value.trim(), status: 'todo', reference: null });
  selectedDate = form.elements.date.value; filter = 'all'; $('#search').value = ''; $('#type-filter').value = 'all';
  const saved = save(); render(); $('#editor').close(); if (saved) toast('已添加到工作清单');
});
$('#task-form').elements.title.addEventListener('input', e => e.target.setCustomValidity(''));
$('#task-list').addEventListener('click', event => {
  const toggle = event.target.closest('[data-toggle]'), open = event.target.closest('[data-open]');
  if (toggle) { const t = tasks.find(t => t.id === toggle.dataset.toggle); if (!t) return; t.status = t.status === 'done' ? 'todo' : 'done'; const saved = save(); render(); if (saved) toast(t.status === 'done' ? '已完成，今天又前进了一步' : '已重新打开事项'); }
  else if (open) openDetail(open.dataset.open);
  else if (event.target.id === 'empty-action') { if (tasks.some(t => t.date === selectedDate)) { filter = 'all'; $('#type-filter').value = 'all'; $('#search').value = ''; render(); } else openEditor(); }
});
$('#detail').addEventListener('click', event => {
  const status = event.target.closest('[data-status]');
  if (status) { const task = tasks.find(t => t.id === activeId); task.status = status.dataset.status; const saved = save(); document.querySelectorAll('[data-status]').forEach(b => { b.classList.toggle('selected', b === status); b.setAttribute('aria-pressed', String(b === status)); }); render(); if (saved) toast('工作状态已更新'); }
  if (event.target.id === 'save-note') { tasks.find(t => t.id === activeId).note = $('#detail-note').value.trim(); const saved = save(); render(); if (saved) toast('说明已保存'); }
});
document.addEventListener('click', event => { const button = event.target.closest('[data-close]'); if (button) document.getElementById(button.dataset.close).close(); });
$('#about').addEventListener('click', () => $('#scope').showModal());
render();
