// User-approved desktop homepage. Shared by sample and cloud data sources.
export const dailyLayout = `
<div class="eyebrow">DAILY WORKSPACE <span>把想法变成行动</span></div>
<div class="heading"><div><h1>从今天开始，一件件做好<span>。</span></h1><p>安排手上的工作，让素材、测试和复盘都有进展。</p></div><button class="primary" id="add-task"><span>＋</span> 添加事项</button></div>
<div class="date-row"><div class="date-control"><button id="prev-date" aria-label="前一天">‹</button><label class="date-label"><input id="work-date" type="date" aria-label="工作日期"><span id="date-display"></span></label><button id="next-date" aria-label="后一天">›</button></div><button class="text-button" id="today">回到今天</button><span class="date-hint">只展示我的事项</span></div>
<div class="workspace-grid">
<section class="work-panel" aria-labelledby="list-title">
<div class="panel-head"><div><h2 id="list-title">我的工作清单 <span id="total-count"></span></h2><p id="progress-caption"></p></div><div class="progress-ring" id="progress-ring"><span id="progress-number"></span></div></div>
<div class="filters"><div role="group" aria-label="按状态筛选" class="tabs"><button data-filter="all" class="selected" aria-pressed="true">全部 <span></span></button><button data-filter="todo" aria-pressed="false">待处理 <span></span></button><button data-filter="doing" aria-pressed="false">进行中 <span></span></button><button data-filter="done" aria-pressed="false">已完成 <span></span></button></div><div class="search-row"><label class="search"><span aria-hidden="true">⌕</span><input type="search" id="search" placeholder="搜索今天的事项" aria-label="搜索事项"></label><select id="type-filter" aria-label="按事项类型筛选"><option value="all">所有类型</option><option>内容制作</option><option>素材收集</option><option>数据记录</option><option>测试复盘</option><option>其他事项</option></select></div></div>
<div id="task-list" aria-live="polite"></div>
<div class="list-foot"><span class="tiny-dot"></span> 点击事项查看详情与相关资料 <span>每一步，都是积累。</span></div>
</section>
<aside class="right-column">
<section class="focus-card business-reminders-card" id="business-reminders" aria-label="经营提醒"><span class="section-kicker">BUSINESS REMINDERS</span><h2>经营提醒</h2><p class="muted">连接工作空间后核对当前业务提醒，示例页面不展示虚构数量。</p></section>
<section class="flow-card"><h2>让工作连起来</h2><ol><li><span>01</span><div><b>看清今天的安排</b><p>先处理有明确时间的事项</p></div></li><li><span>02</span><div><b>带着资料开始做</b><p>从事项详情查看素材与测试</p></div></li><li><span>03</span><div><b>完成后留下结果</b><p>写下完成情况，方便再回看</p></div></li></ol></section>
<div class="preview-note">这是供你确认方向的交互原型。<br>修改仅保存在当前浏览器，尚未接入团队真实数据。</div>
</aside>
</div>
<footer>STUDIO OS <span>为日常运营，留出更多专注。</span><button id="about">本轮体验范围</button></footer>
`;
