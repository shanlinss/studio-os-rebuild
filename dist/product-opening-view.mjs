import {hasSensitive} from './admin-permissions.mjs';
import {money} from './management-model.mjs';
export function createProductOpeningViews({api,h,showPanel,getUser,writable,localTime,notify}){
 async function detail(id,offset=0){
  await showPanel('期初成本依据',async signal=>{
   const [state,history]=await Promise.all([api.productOpening(id,signal),api.productOpeningHistory(id,offset,signal)]);
   return `<div class="dialog-header"><h2>期初成本依据</h2><button class="icon-button" data-opening-close aria-label="关闭期初成本">×</button></div>
    <p>${h(state.sku.code)} · ${h(state.sku.name)}</p><button class="text-button" data-cost-sku="${h(id)}">返回已售成本核对</button>
    <p class="muted">这里引用原始期初数量。补录与修正会按最新依据重算动态成本，原库存数量与原记录保持不变。</p>
    ${state.lines.map(line=>`<p>${h(line.day)} · ${h(line.snapshot.storeName||'原总库存')} · ${line.quantity} ${h(state.sku.unit)}</p>`).join('')||'<p class="muted">该 SKU 没有原始非零期初；零期初和分账复制记录无需重复补成本。</p>'}
    ${state.record?`<p>当前第 ${state.record.version} 版 · 合计 ${h(money(state.record.totalCents))}</p>`:state.lines.length?'<p class="save-error">原始期初成本尚待补齐。</p>':''}
    ${writable&&state.lines.length&&hasSensitive(getUser(),'resources')?`<button class="secondary" data-product-opening-edit="${h(id)}">${state.record?'修正期初成本依据':'补录期初成本依据'}</button>`:''}
    <h3>依据历史</h3>${history.rows.map(row=>`<article class="observation"><b>第 ${row.version} 版 · ${h(money(row.totalCents))}</b><p>${h(row.sourceReference)}</p>${row.lines.map(line=>`<p>${h(line.snapshot.name)} · ${h(line.snapshot.storeName||'原总库存')} · ${line.quantity} ${h(state.sku.unit)} · ${h(money(line.totalCents))}</p>`).join('')}<p class="preserve-text">${h(row.reason)}</p><p>${h(row.actor)} · ${h(localTime(row.createdAt))}</p></article>`).join('')||'<p class="muted">暂无成本依据版本。</p>'}
    <div class="pager"><button class="secondary" data-product-opening="${h(id)}" data-opening-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${history.total} 条依据版本</span><button class="secondary" data-product-opening="${h(id)}" data-opening-offset="${offset+50}" ${offset+50>=history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-opening-close]'))document.querySelector('#cloud-detail').close();
  const button=e.target.closest('[data-product-opening]');if(button)detail(button.dataset.productOpening,Number(button.dataset.openingOffset||0)).catch(e=>notify(e.message));
 });
 return {detail};
}
