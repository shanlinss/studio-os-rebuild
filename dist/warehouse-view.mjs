import {money} from './management-model.mjs';
import {hasSensitive} from './admin-permissions.mjs';
import {warehouseKinds,movementLabels} from './warehouse-contract.mjs';

export function createWarehouseViews({api,h,heading,showPanel,localTime,writable,getUser}){
 const $=s=>document.querySelector(s),canWrite=()=>writable&&hasSensitive(getUser(),'resources');
 let parent,request,offset=0,serial=0,timer;
 const quantity=r=>r.openingConfirmed?`${r.quantity} ${r.unit}`:'待登记期初';
 const consume=()=>writable&&(canWrite()||getUser()?.canConsumePackaging)?'<button class="secondary" data-consume-packaging>批量消耗</button>':'';
 const consumptionLink=id=>id?`<button class="text-button" data-consumption-detail="${h(id)}">查看批量领用单</button>`:'';
 const action=(type,label,id)=>`<button class="${type==='opening'?'primary':'secondary'}" data-warehouse-action="${type}" data-warehouse-id="${h(id)}">${h(label)}</button>`;
 async function refresh(){
  if(!parent||parent.aborted||!$('#warehouse-results'))return;request?.abort();request=new AbortController();const signal=AbortSignal.any([parent,request.signal]),current=++serial;
  $('#warehouse-results').textContent='正在读取库存…';$('#warehouse-prev').disabled=true;$('#warehouse-next').disabled=true;$('#warehouse-summary').innerHTML='';
  try{
   const data=await api.warehouseCatalog({q:$('#warehouse-search').value,kind:$('#warehouse-kind').value,active:$('#warehouse-active').value,offset},signal);if(signal.aborted||current!==serial)return;
   if(!data.rows.length&&offset>0){offset=Math.max(0,offset-50);await refresh();return;}
   $('#warehouse-summary').innerHTML=data.summary.map(r=>`<article class="warehouse-summary-card"><small>${h(warehouseKinds[r.kind])} · ${h(r.unit)}</small><b>${r.initializedCount===0?'待登记期初':h(r.quantity)+' '+h(r.unit)}</b><p>已登记 ${r.initializedCount} 项 · 待登记期初 ${r.pendingCount} 项</p></article>`).join('');
   $('#warehouse-results').innerHTML=data.rows.length?`<div class="table-scroll"><table class="record-table"><thead><tr><th>库存项目</th><th>类型 / 原产品</th><th>规格 / 单位</th><th>存放位置</th><th>当前库存</th><th>状态</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td><button class="table-title" data-warehouse-detail="${h(r.id)}">${h(r.name)}</button><p>${h(r.itemCode)}</p></td><td>${h(warehouseKinds[r.kind])}<p>${h(r.productName||'独立包材')}</p></td><td>${h(r.specification||'未填写规格')}<p>${h(r.unit)}</p></td><td>${h(r.location)}</td><td>${h(quantity(r))}</td><td>${r.active?'启用':'停用'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h3>暂无符合条件的库存项目</h3><p>新建项目后，实际核对数量并登记期初。</p></div>';
   $('#warehouse-caption').textContent=data.total?`${offset+1}–${offset+data.rows.length} / ${data.total} 项`:'0 项';$('#warehouse-prev').disabled=offset===0;$('#warehouse-next').disabled=offset+data.limit>=data.total;
  }catch(e){if(!signal.aborted){$('#warehouse-results').textContent=e.status===404?'当前连接尚未部署产品与包材库存功能。':e.message;$('#warehouse-caption').textContent='读取未完成';}}
 }
 async function detail(id,{historyOffset=0,events=false,transfers=false}={}){
  await showPanel('库存项目',async signal=>{
   const [row,history]=await Promise.all([api.warehouseItem(id,signal),transfers?api.warehouseTransfers(id,historyOffset,false,signal):api.warehouseHistory(id,historyOffset,events,signal)]);
   const usable=canWrite()&&row.active,buttons=usable?(row.openingConfirmed?[action('inbound','登记入库',id),action('outbound','登记出库',id),action('stocktake','盘点调整',id),...(row.kind==='product'&&['件','个'].includes(row.unit)&&row.quantity>0?[action('transfer','转为拍摄样品',id)]:[])].join(''):action('opening','登记期初数量',id)):'';
   const purchaseActions=row.kind==='packaging'&&row.packagingScoped&&hasSensitive(getUser(),'finance')
    ?`<button class="secondary" data-packaging-purchase-history="${h(id)}">采购记录</button>${usable&&row.balances.some(b=>b.storeId===null||b.storeActive)?action('purchase-packaging','采购入库',id):''}`:'';
   const balances=row.balances===undefined?'':`<h3>包材库存归属</h3>${row.packagingScoped?row.balances.map(b=>`<p>${h(b.storeName||'公共库存')}${b.storeActive===false?'（店铺停用）':''} · ${h(b.quantity)} ${h(row.unit)}</p>`).join(''):'<p class="muted">库存归属待核对。</p>'}${usable?action('allocate-packaging',row.packagingScoped?'新增归属':'核对并分配库存',id):''}`;
   return `<div class="dialog-header"><h2>${h(row.name)}</h2><button class="icon-button" data-warehouse-close aria-label="关闭库存详情">×</button></div><div class="detail-meta"><span class="type-tag">${h(warehouseKinds[row.kind])}</span><span>${h(row.itemCode)}</span><span>${row.active?'启用':'停用'}</span></div><dl class="record-facts">${[['原产品',row.productName||'独立包材'],['规格',row.specification||'未填写'],['基础单位',row.unit],['存放位置',row.location],['当前库存',quantity(row)]].map(([label,value])=>`<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl><p class="preserve-text">${h(row.notes||'暂无备注')}</p><div class="action-row">${canWrite()?action('edit','编辑资料',id):''}${buttons}${purchaseActions}</div>${balances}<p class="muted">${row.openingConfirmed?'已登记期初，类型、产品、规格和基础单位保持锁定；盘点通过新调整记录修正。':'尚未登记期初，不能入库、出库或盘点调整；实际为零也需明确登记。'}${row.active?'':' 停用不清空数量与历史；重新启用后可登记变动。'}</p><div class="action-row"><button class="secondary" data-warehouse-history="${h(id)}" data-history-events="false">库存流水</button><button class="secondary" data-warehouse-history="${h(id)}" data-history-events="true">资料变更</button></div><button class="secondary" data-warehouse-history="${h(id)}" data-history-transfers="true">转样品记录</button><h3>${transfers?'转样品记录':events?'资料变更记录':'库存流水'}</h3>${history.rows.map(r=>transfers?`<article class="observation"><b>${h(r.sourceSnapshot.name)} → ${h(r.targetSnapshot.name)} · ${r.quantity} 件</b><p>产品库存 ${r.sourceBefore} → ${r.sourceAfter} ${h(r.sourceSnapshot.unit)}；样品可借 ${r.targetBefore} → ${r.targetAfter} 件</p><p>${h(r.actor)} · ${h(localTime(r.createdAt))}</p><p class="preserve-text">${h(r.reason)}</p><p>${h(r.sourceReference)}</p><button class="text-button" data-open-samples="">进入样品借用与归还 →</button></article>`:events?`<article class="observation"><b>${r.action==='registered'?'登记项目':'编辑资料'}</b><p>${h(r.actor)} · ${h(localTime(r.createdAt))}</p><p>${h(r.afterValue.name)} · ${h(r.afterValue.location)} · ${r.afterValue.active?'启用':'停用'}</p></article>`:`<article class="observation"><b>${h(r.transferId?'转为样品出库':movementLabels[r.type])}${r.packagingBalanceId?' · '+h(r.itemSnapshot.storeName||'公共库存'):''} · ${r.delta>0?'+':''}${r.delta} ${h(r.itemSnapshot.unit)}</b><p>${r.beforeQuantity===null?'未登记':r.beforeQuantity} → ${r.afterQuantity} ${h(r.itemSnapshot.unit)} · ${h(r.actor)} · ${h(localTime(r.createdAt))}</p><p class="preserve-text">${h(r.reason)}</p>${r.transferId?`<p>转入样品：${h(r.transferTargetSnapshot.name)}</p>`:''}${r.sourceReference?`<p>来源参考：${h(r.sourceReference)}</p>`:''}${consumptionLink(r.packagingConsumptionId)}${r.correctsMovementId?`<button class="text-button" data-warehouse-reference="${h(r.correctsMovementId)}" data-warehouse-id="${h(id)}">查看被引用的原流水 →</button>`:''}<small>${h(r.itemSnapshot.itemCode)} · ${h(r.itemSnapshot.name)}</small>${usable&&row.openingConfirmed&&!r.transferId&&(!row.packagingScoped||r.packagingBalanceId)?`<button class="text-button" data-warehouse-correct="${h(r.id)}" data-warehouse-id="${h(id)}">依据此记录纠错</button>`:''}</article>`).join('')||'<p class="muted">暂无记录。</p>'}<div class="pager"><button class="secondary" data-warehouse-history="${h(id)}" data-history-events="${events}" data-history-transfers="${transfers}" data-history-offset="${Math.max(0,historyOffset-50)}" ${historyOffset===0?'disabled':''}>上一页</button><span>${history.total?historyOffset+1+'–'+(historyOffset+history.rows.length)+' / '+history.total:'0 条记录'}</span><button class="secondary" data-warehouse-history="${h(id)}" data-history-events="${events}" data-history-transfers="${transfers}" data-history-offset="${historyOffset+50}" ${historyOffset+history.limit>=history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function reference(id,movement){
  await showPanel('原库存流水',async signal=>{const r=await api.warehouseMovement(id,movement,signal);return `<div class="dialog-header"><h2>${h(movementLabels[r.type])} · ${h(r.itemSnapshot.name)}</h2><button class="icon-button" data-warehouse-close aria-label="关闭库存详情">×</button></div><p>${h(r.itemSnapshot.itemCode)} · ${r.beforeQuantity===null?'未登记':r.beforeQuantity} → ${r.afterQuantity} ${h(r.itemSnapshot.unit)}</p><p>${h(r.actor)} · ${h(localTime(r.createdAt))}</p><p class="preserve-text">${h(r.reason)}</p><p>${h(r.sourceReference||'')}</p><button class="secondary" data-warehouse-detail="${h(id)}">回到库存详情</button>`;});
 }
 async function consumptionDetail(id){
  await showPanel('包材领用单',async signal=>{
   const doc=await api.consumptionDetail(id,signal);
   return `<div class="dialog-header"><h2>包材领用单</h2><button class="icon-button" data-warehouse-close aria-label="关闭领用单">×</button></div>
   <p>${h(doc.actor)} · ${h(localTime(doc.createdAt))}</p><p class="preserve-text">${h(doc.reason)}</p>
   ${doc.lines.map(line=>`<article class="observation"><b>${h(line.snapshot.name)} · ${h(line.snapshot.itemCode)} · ${h(line.quantity)} ${h(line.snapshot.unit)}</b>
    <p>${h(line.snapshot.storeName||'公共库存')} → ${h(line.snapshot.usedStoreName)}</p>
    <p>来源余额 ${h(line.beforeQuantity)} → ${h(line.afterQuantity)} ${h(line.snapshot.unit)}</p></article>`).join('')}`;
  });
 }
 async function purchaseHistory(id,offset=0){
  await showPanel('包材采购记录',async signal=>{
   const {rows,total,limit}=await api.packagingPurchaseHistory(id,offset,signal);
   return `<div class="dialog-header"><h2>包材采购记录</h2><button class="icon-button" data-warehouse-close aria-label="关闭采购记录">×</button></div>
    <button class="secondary" data-warehouse-detail="${h(id)}">回到包材详情</button>
    ${rows.map(r=>`<article class="observation"><b>${h(r.purchaseDate)} · ${h(r.supplier)} · ${h(money(r.totalCents))}</b>
    <p>单价 ${h(money(r.unitCents))} · 数量 ${h(r.quantity)} · ${h(r.actor)} · ${h(localTime(r.createdAt))}</p>
    <p>${r.allocations.map(a=>h((a.storeName||'公共库存')+' '+a.quantity)).join(' · ')}</p>
    <p>${r.expenseSnapshot?'原支出：'+h(r.expenseSnapshot.description)+' · '+h(money(r.expenseSnapshot.amountCents)):'尚未关联支出'}${r.sourceChanged?' · 原支出已变更':''}</p>
    <p class="preserve-text">${h(r.reason)}</p></article>`).join('')||'<p class="muted">暂无采购记录。</p>'}
    <div class="pager"><button class="secondary" data-packaging-purchase-history="${h(id)}" data-purchase-offset="${Math.max(0,offset-limit)}" ${offset===0?'disabled':''}>上一页</button><span>${total} 条采购</span><button class="secondary" data-packaging-purchase-history="${h(id)}" data-purchase-offset="${offset+limit}" ${offset+limit>=total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function refreshScoped(){
  const container=$('#scoped-stock-results');
  if(!container||parent?.aborted)return;
  request?.abort();request=new AbortController();
  const signal=AbortSignal.any([parent,request.signal]);
  container.textContent='正在读取包材库存…';
  try{
   const data=await api.scopedWarehouseCatalog({q:$('#scoped-stock-query').value,offset},signal);
   if(signal.aborted)return;
   container.innerHTML=data.rows.map(b=>`<article class="sample-record"><div><b>${h(b.name)}</b><p>${h(b.itemCode)} · ${h(b.storeName||'公共库存')} · ${h(b.quantity)} ${h(b.unit)}</p><p>${b.canMove?'可登记出入库':'仅查看'}</p></div><button class="secondary" data-scoped-stock-detail="${h(b.id)}">查看库存</button></article>`).join('')||'<p class="muted">当前授权范围内暂无符合条件的包材。</p>';
   $('#scoped-stock-prev').disabled=offset===0;$('#scoped-stock-next').disabled=offset+data.limit>=data.total;
   $('#scoped-stock-total').textContent=data.total+' 条归属余额';
  }catch(e){if(!signal.aborted)container.textContent=e.message;}
 }
 async function scopedDetail(id,offset=0){
  await showPanel('包材库存',async signal=>{
   const {balance:b,rows,total,limit}=await api.scopedWarehouseDetail(id,offset,signal);
   const actions=writable&&b.canMove?['inbound','outbound'].map(type=>`<button class="secondary" data-scoped-warehouse-move="${type}" data-balance-id="${h(b.id)}">登记${h(movementLabels[type])}</button>`).join(''):'';
   return `<div class="dialog-header"><h2>${h(b.name)}</h2><button class="icon-button" data-warehouse-close aria-label="关闭库存详情">×</button></div>
    <p>${h(b.itemCode)} · ${h(b.storeName||'公共库存')} · ${h(b.specification||'无规格说明')}</p><p>当前库存 ${h(b.quantity)} ${h(b.unit)} · ${h(b.location)}</p>
    <div class="action-row">${actions}</div><h3>此归属的数量流水</h3>
    ${rows.map(r=>`<p>${h(movementLabels[r.type])} · ${r.beforeQuantity===null?'未登记':h(r.beforeQuantity)} → ${h(r.afterQuantity)} ${h(b.unit)} ·  ${h(localTime(r.createdAt))} ${consumptionLink(r.packagingConsumptionId)}</p>`).join('')||'<p class="muted">暂无流水。</p>'}
    <div class="pager"><button class="secondary" data-scoped-stock-detail="${h(id)}" data-stock-offset="${Math.max(0,offset-limit)}" ${offset===0?'disabled':''}>上一页</button><span>${total} 条流水</span><button class="secondary" data-scoped-stock-detail="${h(id)}" data-stock-offset="${offset+limit}" ${offset+limit>=total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function renderScoped(signal){
  $('#main').innerHTML=heading('包材库存','查看获授权的公共库存和店铺库存。')+`<section class="work-panel module-panel">
   <div class="module-toolbar"><label class="module-search">查找包材<input id="scoped-stock-query" type="search" maxlength="100" placeholder="名称、编码、规格或店铺"></label>${consume()}</div>
   <div id="scoped-stock-results"></div><div class="pager"><button class="secondary" id="scoped-stock-prev" disabled>上一页</button><span id="scoped-stock-total"></span><button class="secondary" id="scoped-stock-next" disabled>下一页</button></div></section>`;
  $('#scoped-stock-query').oninput=()=>{offset=0;clearTimeout(timer);timer=setTimeout(refreshScoped,250);};
  $('#scoped-stock-prev').onclick=()=>{offset=Math.max(0,offset-50);refreshScoped();};
  $('#scoped-stock-next').onclick=()=>{offset+=50;refreshScoped();};
  signal.addEventListener('abort',()=>{clearTimeout(timer);request?.abort();},{once:true});
  await refreshScoped();
 }
 document.addEventListener('click',e=>{
  const close=e.target.closest('[data-warehouse-close]'),record=e.target.closest('button[data-warehouse-detail]'),history=e.target.closest('button[data-warehouse-history]'),original=e.target.closest('button[data-warehouse-reference]');
  const consumption=e.target.closest('button[data-consumption-detail]');
  if(consumption)consumptionDetail(consumption.dataset.consumptionDetail);
  const purchase=e.target.closest('button[data-packaging-purchase-history]');
  if(purchase)purchaseHistory(purchase.dataset.packagingPurchaseHistory,Number(purchase.dataset.purchaseOffset||0));
  const scoped=e.target.closest('button[data-scoped-stock-detail]');
  if(scoped)scopedDetail(scoped.dataset.scopedStockDetail,Number(scoped.dataset.stockOffset||0));
  if(original)reference(original.dataset.warehouseId,original.dataset.warehouseReference);if(close)$('#cloud-detail').close();if(record)detail(record.dataset.warehouseDetail);if(history)detail(history.dataset.warehouseHistory,{events:history.dataset.historyEvents==='true',transfers:history.dataset.historyTransfers==='true',historyOffset:Number(history.dataset.historyOffset||0)});
 });
 return {refresh,detail,purchaseHistory,consumptionDetail,refreshScoped,scopedDetail,async render(signal){
  parent=signal;offset=0;
  if(!hasSensitive(getUser(),'resources')&&getUser()?.scopedPackaging)return renderScoped(signal);
  $('#main').innerHTML=heading('仓库管理','按实际数量登记产品和包材库存，每次变动保留流水。')+`<section class="work-panel module-panel"><div class="module-toolbar"><label class="module-search">查找库存<input id="warehouse-search" type="search" maxlength="100" placeholder="编码、名称、产品、规格或位置"></label><label>类型<select id="warehouse-kind"><option value="all">全部类型</option><option value="product">产品库存</option><option value="packaging">包材库存</option></select></label><label>范围<select id="warehouse-active"><option value="active">启用项目</option><option value="all">全部项目</option><option value="inactive">停用项目</option></select></label>${canWrite()?'<button class="primary" data-warehouse-action="register">＋ 新建库存项目</button>':''}${consume()}</div><p class="muted">下方汇总覆盖当前筛选的全部项目，按类型与单位分别统计已登记数量；待登记期初不等于零库存。</p><div id="warehouse-summary" class="warehouse-summary"></div><div id="warehouse-results"></div><div class="pager"><button class="secondary" id="warehouse-prev">上一页</button><span id="warehouse-caption"></span><button class="secondary" id="warehouse-next">下一页</button></div><div class="module-foot">件／个单位的产品支持转为拍摄样品；转出后在原样品档案中借用与归还。订单和采购支出暂不自动关联。</div></section>`;
  $('#warehouse-search').oninput=()=>{offset=0;clearTimeout(timer);timer=setTimeout(refresh,250);};$('#warehouse-kind').onchange=()=>{offset=0;refresh();};$('#warehouse-active').onchange=()=>{offset=0;refresh();};$('#warehouse-prev').onclick=()=>{offset=Math.max(0,offset-50);refresh();};$('#warehouse-next').onclick=()=>{offset+=50;refresh();};signal.addEventListener('abort',()=>{clearTimeout(timer);request?.abort();},{once:true});await refresh();
 }};
}
