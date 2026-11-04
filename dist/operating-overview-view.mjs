import {chinaDate} from './cloud-contract.mjs';
import {signedCostMoney} from './cost-sources-contract.mjs';
import {hasSensitive} from './admin-permissions.mjs';
export function createOperatingOverviewViews({api,h,showPanel,getUser,writable,notify,localTime}){
 const amount=v=>v===null?'待核对':h(signedCostMoney(v));
 const maintain=()=>writable&&hasSensitive(getUser(),'finance');
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" data-overview-close aria-label="关闭经营总览">×</button></div>`;
 const link=p=>{const attrs={expense:'data-overview-expense',operating:'data-operating-record',stock:'data-cost-sku',dropship:'data-dropship',packaging:'data-consumption-detail'};return attrs[p.kind]&&(p.kind!=='packaging'||hasSensitive(getUser(),'resources'))?`<button class="text-button" ${attrs[p.kind]}="${h(p.id)}">核对来源</button>`:'';};
 async function detail(month=chinaDate().slice(0,7)){
  await showPanel('经营总览',async signal=>{
   const d=await api.financeOverview(month,signal),s=d.summary;
   return head('经营总览')+`<label>经营月份<input type="month" min="1900-01" max="2199-12" value="${h(month)}" data-overview-month></label><p class="planning-rule">按已录入来源测算，尚未月结。收入由每店每月手工确认，已扣客户退款、未扣经营成本。公共费用在工作室层面扣一次。</p>
    <section class="summary-strip"><div><b>${amount(s.incomeCents)}</b><span>确认收入合计</span></div><div><b>${amount(s.storeProfitCents)}</b><span>店铺利润合计（已录来源）</span></div><div><b>${amount(d.publicCents)}</b><span>已核对公共运营费用</span></div><div><b>${amount(s.studioProfitCents)}</b><span>工作室利润测算</span></div></section>
    <p>本月纳入 ${s.storeCount} 家店铺，按收入确认及本月业务来源列示。空白收入不计为零；新增或停用店铺不会改变历史公共费用。</p>
    ${maintain()?`<div class="action-row"><label>确认收入的店铺<select id="overview-income-store"><option value="">请选择</option>${d.stores.map(store=>`<option value="${h(store.id)}">${h(store.name)}${store.active?'':'（已停用）'}</option>`).join('')}</select></label><button class="secondary" data-studio-income="" data-month="${h(month)}">确认本月收入</button></div>`:''}
    <div class="table-scroll"><table class="record-table"><thead><tr><th>店铺</th><th>确认收入</th><th>专属成本合计</th><th>店铺利润测算</th><th>核对状态</th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${h(r.name)}${r.active?'':'（已停用）'}</td><td>${amount(r.income?.amountCents??null)}</td><td>${amount(r.directCostCents)}</td><td>${amount(r.profitCents)}</td><td>${!r.income?'收入待确认':r.pendingCount?r.pendingCount+' 项成本待核对':'已录来源可测算'}</td></tr>`).join('')}</tbody></table></div>
    ${!d.rows.length?'<p class="muted">该月尚无收入确认或店铺业务记录。请先确认本月收入，包括实际为零的收入。</p>':''}
    <h3>各店铺成本与收入依据</h3>${d.rows.map(r=>`<details class="finance-categories"><summary>${h(r.name)} · ${r.pendingCount?'成本待核对':'查看明细'}</summary><p>专属运营费用 ${amount(r.operatingCents)} · 商品已售成本 ${amount(r.stockCents)} · 代发净成本 ${amount(r.dropshipCents)} · 独立手续费 ${amount(r.feeCents)}</p><p class="muted">已引用支出的手续费按原支出日期计一次；采购、预付款和报销不再当作上述成本重复相加。</p>
     ${r.income?`<p>收入确认第 ${r.income.version} 版 · ${h(r.income.sourceReference)}</p>`:'<p class="save-error">本月收入尚未确认。</p>'}
     <button class="text-button" data-income-history="${h(r.storeId)}" data-month="${h(month)}">收入确认历史</button>${maintain()?`<button class="text-button" data-studio-income="${h(r.storeId)}" data-month="${h(month)}">确认或修正收入</button>${r.income?`<button class="text-button" data-studio-income="${h(r.storeId)}" data-month="${h(month)}" data-withdraw-income>撤回本月确认</button>`:''}`:''}
     <p class="muted">日常销售 ${amount(r.dailySaleCents)} · 日常客户退款 ${amount(r.dailyRefundCents)}，仅供核对，不叠加或再次扣减确认收入。</p>
     ${r.pending.map(p=>`<p class="save-error">${h(p.label)} ${link(p)}</p>`).join('')}${r.pendingCount>r.pending.length?'<p class="muted">待核对来源仅展示前 50 项。</p>':''}
     <details><summary>来源索引 · ${r.sourceCount} 条</summary>${r.sources.map(p=>link(p)).join('')}${r.sourceCount>r.sources.length?'<p class="muted">仅展示前 50 条，请从对应明细入口继续核对。</p>':''}</details></details>`).join('')}
    <h3>公共费用与待核对来源</h3><p>已核对公共运营费用 ${amount(d.publicCents)}；全工作室库存采购 ${amount(d.inventoryCents)}、预付款 ${amount(d.prepaidCents)}单独列示。</p>
    ${d.publicPending.map(p=>`<p class="save-error">${h(p.label)} ${link(p)}</p>`).join('')}${d.publicPendingCount>d.publicPending.length?'<p class="muted">公共或未归属待核对来源仅展示前 50 项。</p>':''}
    <p class="muted">商品、代发、运营费用和手续费按已录入来源测算。包材领用成本、其他出库归属等尚未核实时会阻止相应利润确认；工资等其他费用也需按实际来源核对齐全。本页不生成资金流水或月结锁定。</p>`;
  });
 }
 async function history(id,month,offset=0){
  await showPanel('月度收入确认历史',async signal=>{
   const s=await api.monthIncome(id,month,offset,signal);
   return head(s.store.name+' · '+month+' 收入确认')+`<button class="text-button" data-studio-overview="${h(month)}">返回经营总览</button>${s.history.rows.map(r=>`<article class="observation"><b>第 ${r.version} 版 · ${r.status==='confirmed'?'已确认':'已撤回'} · ${amount(String(r.amountCents))}</b><p>${h(r.sourceReference)}</p><p class="preserve-text">${h(r.reason)}</p><small>${h(r.actor)} · ${h(localTime(r.createdAt))}</small></article>`).join('')||'<p class="muted">尚无收入确认记录。</p>'}<div class="pager"><button class="secondary" data-income-history="${h(id)}" data-month="${h(month)}" data-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${s.history.total} 条版本</span><button class="secondary" data-income-history="${h(id)}" data-month="${h(month)}" data-offset="${offset+50}" ${offset+50>=s.history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 document.addEventListener('click',e=>{if(e.target.closest('[data-overview-close]'))document.querySelector('#cloud-detail').close();const b=e.target.closest('[data-studio-overview]'),r=e.target.closest('[data-income-history]');if(b)detail(b.dataset.studioOverview||chinaDate().slice(0,7)).catch(e=>notify(e.message));if(r)history(r.dataset.incomeHistory,r.dataset.month,Number(r.dataset.offset||0)).catch(e=>notify(e.message));});
 document.addEventListener('change',e=>{if(e.target.matches('[data-overview-month]'))detail(e.target.value).catch(e=>notify(e.message));});
 return {detail,history};
}
