import {chinaDate} from './cloud-contract.mjs';
import {hasSensitive} from './admin-permissions.mjs';
export function createProductCostViews({api,h,showPanel,getUser,notify}){
 const amount=v=>v===null?'待补齐成本依据':'¥'+h(v);
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" data-cost-close aria-label="关闭成本核对">×</button></div>`;
 async function catalog(offset=0){
  await showPanel('已售成本核对',async signal=>{
   const data=await api.productCostCatalog(offset,signal);
   return head('已售成本核对')+`<p>按 SKU 采用移动加权平均，选择商品核对采购、发货和退货成本。</p>${data.rows.map(r=>`<button class="account-row" data-cost-sku="${h(r.id)}"><span><b>${h(r.code)} · ${h(r.name)}</b><small>${h(r.specification)} · 当前库存 ${r.quantity??'未登记'} ${h(r.unit)}</small></span><span class="task-arrow">›</span></button>`).join('')||'<p class="muted">暂无已关联原库存的正式 SKU，请先维护商品资料。</p>'}
    <div class="pager"><button class="secondary" data-cost-catalog="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${data.total} 个 SKU</span><button class="secondary" data-cost-catalog="${offset+50}" ${offset+50>=data.total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function review(id,month=chinaDate().slice(0,7)){
  await showPanel('商品成本核对',async signal=>{
   const data=await api.productCostReview(id,month,signal),canSource=hasSensitive(getUser(),'resources');
   const kinds={opening:'期初',inbound:'入库',outbound:'其他出库',stocktake:'盘点',shipment:'发货',return:'退货'};
   return head(data.sku.code+' · '+data.sku.name)+`<div class="action-row"><button class="text-button" data-cost-catalog="0">返回商品列表</button><label>核对月份<input type="month" min="1900-01" max="2199-12" value="${h(month)}" data-cost-month="${h(id)}"></label></div>
    <p class="muted">同一 SKU 各店铺与公共库存共用成本池。按业务日期、同日登记时间重算，内部调拨不改变成本。采购采用最新保存版本，金额展示四舍五入到分，计算保留精度。</p>
    <section class="summary-strip"><div><b>${data.shipmentQuantity} ${h(data.sku.unit)}</b><span>当月发货 · ${amount(data.shipmentAmount)}</span></div><div><b>${data.returnQuantity} ${h(data.sku.unit)}</b><span>当月退货回冲 · ${amount(data.returnAmount)}</span></div><div><b>${amount(data.netAmount)}</b><span>当月发货成本减退货回冲</span></div></section>
    <p>截至所选月末的已登记库存 ${data.quantity} ${h(data.sku.unit)} · 库存成本 ${amount(data.balanceAmount)} · 平均单价 ${amount(data.averageAmount)}</p>
    <p class="muted">退货使用原发货成本，跨月回冲计入退货月份；其他出库、转样品和盘亏按当时平均成本扣减库存，单独列示。这里提供动态核对，尚未生成财务结账或利润。</p>
    ${data.issues.length?`<details open class="finance-categories"><summary>来源待核对</summary>${data.issues.map(note=>`<p class="save-error">${h(note)}</p>`).join('')}</details>`:''}
    ${data.rows.map(r=>`<article class="observation"><b>${h(r.day)} · ${h(kinds[r.kind])} · ${r.delta>0?'+':''}${r.delta} ${h(data.sku.unit)}</b>
     <p>${h(r.snapshot.businessStoreName||r.snapshot.storeName||'公共库存')} · 本次成本 ${amount(r.costAmount)}${r.purchaseVersion?' · 采购第 '+r.purchaseVersion+' 版':''}</p>
     <p>变动后 ${r.balanceQuantity} ${h(data.sku.unit)} · 库存成本 ${amount(r.balanceAmount)} · 平均单价 ${amount(r.averageAmount)}</p>
     ${r.notes.map(note=>`<p class="save-error">${h(note)}</p>`).join('')}
     ${r.documentId&&(r.kind==='inbound'||canSource)?`<button class="text-button" ${r.kind==='inbound'?'data-product-purchase':'data-product-stock-document'}="${h(r.documentId)}">核对原${r.kind==='inbound'?'入库采购资料':'库存单据'}</button>`:''}</article>`).join('')||'<p class="muted">所选月份暂无成本流水。</p>'}`;
  });
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-cost-close]'))document.querySelector('#cloud-detail').close();
  const list=e.target.closest('[data-cost-catalog]'),sku=e.target.closest('[data-cost-sku]');
  if(list)catalog(Number(list.dataset.costCatalog||0)).catch(e=>notify(e.message));
  if(sku)review(sku.dataset.costSku).catch(e=>notify(e.message));
 });
 document.addEventListener('change',e=>{if(e.target.matches('[data-cost-month]'))review(e.target.dataset.costMonth,e.target.value).catch(e=>notify(e.message));});
 return {catalog,review};
}
