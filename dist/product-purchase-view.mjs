import {hasSensitive} from './admin-permissions.mjs';
import {money} from './management-model.mjs';
export function createProductPurchaseViews({api,h,showPanel,localTime,getUser,writable,notify}){
 async function detail(id,offset=0){
  await showPanel('商品采购批次与成本',async signal=>{
   const [state,history]=await Promise.all([api.productPurchase(id,signal),api.productPurchaseHistory(id,offset,signal)]);
   const {document,batch,record}=state;
   return `<div class="dialog-header"><h2>商品采购批次与成本</h2><button class="icon-button" data-product-purchase-close aria-label="关闭采购成本">×</button></div>
    <p>原入库日期 ${h(document.businessDate)} · ${h(document.sourceReference||'未填写入库来源参考')}</p>
    ${hasSensitive(getUser(),'resources')?`<button class="text-button" data-product-stock-document="${h(id)}">查看原入库单</button>`:''}
    ${batch?`<p>采购批次 ${h(batch.code)} · 第 ${record.version} 版 · 总成本 ${h(money(record.totalCents))}</p>`:'<p class="muted">尚未登记采购批次和成本。</p>'}
    ${state.sourceChanged?'<p class="save-error">关联支出已变更，请核对来源。已保存的采购成本保留当时版本。</p>':''}
    ${writable&&hasSensitive(getUser(),'resources')?`<button class="secondary" data-product-purchase-edit="${h(id)}">${batch?'修正采购资料':'登记采购批次与成本'}</button>`:''}
    <div class="action-row">${document.lines.map(line=>`<button class="text-button" data-cost-sku="${h(line.snapshot.skuId)}">核对 ${h(line.snapshot.skuCode)} 已售成本</button>`).join('')}</div><h3>采购成本历史</h3>${history.rows.map(row=>`<article class="observation"><b>第 ${row.version} 版 · ${h(row.purchaseDate)} · ${h(row.supplier)} · ${h(money(row.totalCents))}</b>
     <p>货款 ${h(money(row.goodsCents))} · 附加费用 ${h(money(row.additionalCents))}</p>
     ${row.lines.map(line=>`<p>${h(line.snapshot.skuCode)} · ${h(line.snapshot.name)} · ${h(line.snapshot.storeName||'公共库存')} · ${line.quantity} ${h(line.snapshot.unit)}<br>单价 ${h(money(line.unitCents))} · 货款 ${h(money(line.goodsCents))} · 附加 ${h(money(line.additionalCents))} · 本行成本 ${h(money(line.totalCents))}</p>`).join('')}
     <p>${row.expenseSnapshot?'引用原支出 '+h(row.expenseSnapshot.description)+' · 当时金额 '+h(money(row.expenseSnapshot.amountCents)):'尚未关联财务支出'}</p>
     <p class="preserve-text">${h(row.reason)}</p><p>${h(row.actor)} · ${h(localTime(row.createdAt))}</p></article>`).join('')||'<p class="muted">暂无采购成本记录。</p>'}
    <div class="pager"><button class="secondary" data-product-purchase="${h(id)}" data-purchase-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${history.total} 条成本版本</span><button class="secondary" data-product-purchase="${h(id)}" data-purchase-offset="${offset+50}" ${offset+50>=history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-product-purchase-close]'))document.querySelector('#cloud-detail').close();
  const button=e.target.closest('[data-product-purchase]');
  if(button)detail(button.dataset.productPurchase,Number(button.dataset.purchaseOffset||0)).catch(e=>notify(e.message));
 });
 return {detail};
}
