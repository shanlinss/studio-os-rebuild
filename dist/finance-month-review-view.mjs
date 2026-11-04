import {chinaDate} from './cloud-contract.mjs';
import {reviewSections} from './finance-month-review-contract.mjs';
import {signedCostMoney} from './cost-sources-contract.mjs';
import {hasSensitive} from './admin-permissions.mjs';
export function reviewSourceLink(r,month,h,resources=true){
 const attrs={expense:'data-overview-expense',operating:'data-operating-record',stock:'data-cost-sku',dropship:'data-dropship',inventory:'data-inventory-cost','sample-cost':'data-sample-cost','product-purchase':'data-product-purchase','product-opening':'data-product-opening',cash:'data-cash-detail'};
 if(attrs[r.kind])return `<button class="text-button" ${attrs[r.kind]}="${h(r.id)}" data-cost-period="${h(month)}">核对原来源</button>`;
 if(r.kind==='packaging'&&resources)return `<button class="text-button" data-consumption-detail="${h(r.id)}">核对原领用</button>`;
 if(r.kind==='sample')return '<button class="text-button" data-sample-cost-list>查看样品成本</button>';
 if(r.kind==='income')return `<button class="text-button" data-income-history="${h(r.id)}" data-month="${h(month)}">查看收入确认</button>`;
 if(r.kind==='scope')return `<button class="text-button" data-finance-scope-view="${h(month)}">核对经营店铺范围</button>`;
 if(r.kind==='income-cash')return `<button class="text-button" data-cash-sources="income" data-month="${h(month)}">核对收入对应到账</button>`;
 if(r.kind==='advances')return '<a class="text-button" href="#settlements" data-review-dismiss>查看原结算与报销</a>';
 return '';
}
export function createFinanceMonthViews({api,h,showPanel,getUser,writable,notify,localTime}){
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" data-finance-review-close aria-label="关闭月度检查">×</button></div>`;
 const maintain=()=>writable&&hasSensitive(getUser(),'finance');
 async function detail(month=chinaDate().slice(0,7),section='all',severity='all',offset=0){
  await showPanel('月度来源检查',async signal=>{
   const d=await api.financeMonthReview({month,section,severity,offset},signal),button=(label,next)=>`<button class="secondary" data-finance-review="${h(month)}" data-section="${h(section)}" data-severity="${h(severity)}" data-offset="${next}" ${next<0||next>=d.total?'disabled':''}>${label}</button>`;
   return head('月度来源检查')+`<div class="action-row"><label>经营月份<input type="month" min="1900-01" max="2199-12" value="${h(month)}" data-finance-review-month></label><button class="text-button" data-studio-overview="${h(month)}">查看经营总览</button><button class="text-button" data-finance-scope-view="${h(month)}">经营店铺范围与历史</button></div><p class="planning-rule">检查已录入的原始来源，不生成新账目或月结锁定。平台月度可提现收入已扣佣金和客户退款，商品／代发及工作室成本另算；公共费用只在工作室扣一次。</p>
    <section class="summary-strip"><div><b>${d.counts.blocker}</b><span>经营依据待补</span></div><div><b>${d.counts.review}</b><span>资金与报销待核对</span></div><div><b>${d.scope?d.scope.stores.length:'待确认'}</b><span>本月确认经营店铺</span></div></section><p>${d.recordedSourcesReady?'已录来源暂未发现经营依据缺口，仍需人工确认未录事项。':'经营依据尚未齐全，请按原来源补录或重核。'} · 检查于 ${h(localTime(d.checkedAt))}</p>
    <p>本月店铺范围：${d.scope?(d.scope.stores.map(s=>h(s.name)).join('、')||'已明确确认无经营店铺'):'尚未确认'}。${maintain()?`<button class="text-button" data-finance-scope-edit="${h(month)}">${d.scope?'修正':'确认'}范围</button>`:''}</p>
    <div class="action-row"><label>检查类别<select data-finance-review-section>${[['all','全部类别'],...Object.entries(reviewSections)].map(([key,label])=>`<option value="${key}" ${key===section?'selected':''}>${h(label)}${key==='all'?'':' · '+d.counts.sections[key]}</option>`).join('')}</select></label><label>处理类型<select data-finance-review-severity>${[['all','全部'],['blocker','经营依据待补'],['review','资金与报销待核对']].map(([key,label])=>`<option value="${key}" ${key===severity?'selected':''}>${label}</option>`).join('')}</select></label></div>
    ${d.rows.map(r=>`<article class="observation"><b>${h(reviewSections[r.section])} · ${r.severity==='blocker'?'依据待补':'待核对'}</b><p>${h(r.label)}${r.amountCents!==undefined?' · '+h(signedCostMoney(r.amountCents)):''}</p>${reviewSourceLink(r,month,h,hasSensitive(getUser(),'resources'))}</article>`).join('')||'<p class="muted">此筛选暂无待处理来源。</p>'}
    <div class="pager">${button('上一页',offset-50)}<span>本筛选 ${d.total} 项</span>${button('下一页',offset+50)}</div><p class="muted">资金差额仅核对已录资金与收入，不代表欠款或额外费用。报销显示当前累计余额，跨月保留，不是所选月末余额。工资、水电等尚未录入的事项无法自动发现，请核对齐全；本页通过也不代表已完成银行对账或月结。</p>`;
  });
 }
 async function scope(month,offset=0){await showPanel('经营店铺范围',async signal=>{const d=await api.financeMonthScope(month,offset,signal);return head(month+' · 经营店铺范围')+`<button class="text-button" data-finance-review="${h(month)}">返回月度检查</button>${maintain()?`<button class="secondary" data-finance-scope-edit="${h(month)}">确认或修正范围</button>`:''}<p>以当月实际经营情况手工确认，保留每次范围变更，不按当前启用状态改写历史。</p><p>当前范围：${d.record?(d.record.stores.map(s=>h(s.name)).join('、')||'已确认无经营店铺'):'尚未确认'}</p>${d.history.rows.map(r=>`<article class="observation"><b>第 ${r.version} 版 · ${r.stores.length} 家</b><p>${r.stores.map(s=>h(s.name)).join('、')||'无经营店铺'}</p><p class="preserve-text">${h(r.reason)}</p><small>${h(r.actor)} · ${h(localTime(r.createdAt))}</small></article>`).join('')}<div class="pager"><button class="secondary" data-finance-scope-view="${h(month)}" data-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${d.history.total} 条版本</span><button class="secondary" data-finance-scope-view="${h(month)}" data-offset="${offset+50}" ${offset+50>=d.history.total?'disabled':''}>下一页</button></div>`;});}
 document.addEventListener('click',e=>{if(e.target.closest('[data-finance-review-close],[data-review-dismiss]'))document.querySelector('#cloud-detail').close();const b=e.target.closest('[data-finance-review]'),s=e.target.closest('[data-finance-scope-view]');if(b)detail(b.dataset.financeReview||document.querySelector('#finance-month')?.value||chinaDate().slice(0,7),b.dataset.section||'all',b.dataset.severity||'all',Number(b.dataset.offset||0)).catch(e=>notify(e.message));if(s)scope(s.dataset.financeScopeView,Number(s.dataset.offset||0)).catch(e=>notify(e.message));});
 document.addEventListener('change',e=>{if(e.target.matches('[data-finance-review-month],[data-finance-review-section],[data-finance-review-severity]'))detail(document.querySelector('[data-finance-review-month]').value,document.querySelector('[data-finance-review-section]').value,document.querySelector('[data-finance-review-severity]').value).catch(e=>notify(e.message));});
 return {detail,scope};
}
