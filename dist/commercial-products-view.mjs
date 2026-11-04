import {hasSensitive} from './admin-permissions.mjs';
export function createCommercialProductViews({api,h,showPanel,source,localTime,writable,getUser,notify}){
 async function detail(id,offset=0){
  await showPanel('正式商品与 SKU',async signal=>{
   const [state,history]=await Promise.all([api.commercialProduct(id,signal),api.commercialProductHistory(id,offset,signal)]);
   const {product,formal}=state,edit=writable&&product.active&&hasSensitive(getUser(),'resources');
   const button=(action,label,extra='')=>edit?`<button class="secondary" data-commercial-edit="${action}" data-product-id="${h(id)}" ${extra}>${h(label)}</button>`:'';
   return `<div class="dialog-header"><h2>${h(product.name)} · 正式商品与 SKU</h2><button class="icon-button" data-commercial-close aria-label="关闭商品档案">×</button></div>
    <button class="text-button" data-product-detail="${h(id)}">查看原产品资料</button>
    ${formal?`<p>正式商品编号 ${h(formal.code)} · 资料版本 ${formal.version}</p>${button('sku','＋ 新增 SKU')}
     ${formal.skus.map(sku=>`<article class="observation"><b>${h(sku.code)} · ${h(sku.specification||'默认规格')} · ${h(sku.unit)}</b><p>${sku.active?'启用':'停用'} · ${sku.warehouseItemId?'关联原库存 '+h(state.stock.find(w=>w.id===sku.warehouseItemId)?.itemCode||''):'尚未关联原库存'}</p>
      <div class="action-row">${button('sku','编辑 SKU',`data-sku-id="${h(sku.id)}"`)}${sku.active?button('mapping','关联店铺商品',`data-sku-id="${h(sku.id)}"`):''}</div>
      ${formal.mappings.filter(m=>m.skuId===sku.id).map(m=>`<p>${h(m.storeName)} · ${h(m.platformProductId)} / ${h(m.platformSkuId)} · ${m.active&&m.storeActive&&sku.active?'映射生效':'已停用'}
       ${m.listingUrl?source(m.listingUrl,'打开店铺商品'):''} ${button('mapping','编辑映射',`data-sku-id="${h(sku.id)}" data-store-id="${h(m.storeId)}"`)}</p>`).join('')}
     </article>`).join('')||'<p class="muted">暂无 SKU。</p>'}`:`<p class="muted">尚未登记正式商品编号。</p>${button('formal','登记为正式商品')}`}
    <h3>资料变更</h3>${history.rows.map(e=>`<article class="observation"><b>第 ${e.afterValue.version} 版</b><p class="preserve-text">${h(e.reason)}</p><p>${h(e.actor)} · ${h(localTime(e.createdAt))}</p>
     <p>${e.afterValue.skus.length} 个 SKU · ${e.afterValue.mappings.length} 个店铺映射</p></article>`).join('')||'<p class="muted">暂无变更记录。</p>'}
    <div class="pager"><button class="secondary" data-commercial-product="${h(id)}" data-commercial-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${history.total} 条记录</span><button class="secondary" data-commercial-product="${h(id)}" data-commercial-offset="${offset+50}" ${offset+50>=history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-commercial-close]'))document.querySelector('#cloud-detail').close();
  const button=e.target.closest('[data-commercial-product]');
  if(button)detail(button.dataset.commercialProduct,Number(button.dataset.commercialOffset||0)).catch(e=>notify(e.message));
 });
 return {detail};
}
