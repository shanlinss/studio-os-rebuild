import {chinaDate} from './cloud-contract.mjs';
import {money} from './management-model.mjs';
import {hasSensitive} from './admin-permissions.mjs';
export function createCostSourcesViews({api,h,showPanel,getUser,writable,localTime,notify}){
 const maintain=()=>writable&&hasSensitive(getUser(),'finance')&&hasSensitive(getUser(),'resources');
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" data-source-close aria-label="关闭成本来源">×</button></div>`;
 async function reference(id,month=chinaDate().slice(0,7),offset=0){
  await showPanel('参考成本与履约方式',async signal=>{
   const s=await api.referenceCost(id,month,offset,signal),r=s.current;
   return head('参考成本与履约方式')+`<p>${h(s.sku.code)} · ${h(s.sku.name)}</p><button class="text-button" data-cost-sku="${h(id)}">返回成本核对</button><label>查看月份<input type="month" min="1900-01" max="2199-12" value="${h(month)}" data-reference-month="${h(id)}"></label><p>${r?`${h(r.effectiveMonth)} 起 · ${r.fulfillmentMode==='stocked'?'工作室备货':'一件代发'} · ${r.unitCents===null?'未启用参考估算':h(money(r.unitCents))+' / '+h(s.sku.unit)}`:'尚未登记适用于该月的参考成本'}</p>${maintain()?`<button class="secondary" data-reference-edit="${h(id)}" data-month="${h(month)}">登记或调整参考成本</button>`:''}
    <h3>调整历史</h3>${s.history.rows.map(r=>`<article class="observation"><b>第 ${r.version} 版 · ${h(r.effectiveMonth)} 起 · ${r.fulfillmentMode==='stocked'?'工作室备货':'一件代发'}</b><p>${r.unitCents===null?'停止使用参考估算':h(money(r.unitCents))+' / '+h(s.sku.unit)} · ${h(r.sourceReference)}</p><p class="preserve-text">${h(r.reason)}</p><small>${h(r.actor)} · ${h(localTime(r.createdAt))}</small></article>`).join('')||'<p class="muted">暂无调整记录。</p>'}
    <div class="pager"><button class="secondary" data-reference="${h(id)}" data-month="${h(month)}" data-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${s.history.total} 条版本</span><button class="secondary" data-reference="${h(id)}" data-month="${h(month)}" data-offset="${offset+50}" ${offset+50>=s.history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function list(offset=0){
  await showPanel('代发成本批次',async signal=>{
   const page=await api.dropshipList(offset,signal);
   return head('代发成本批次')+'<p>单独核对供应商代发成本与实际退款，不扣工作室库存。</p>'+ (maintain()?'<button class="primary" data-dropship-edit="">＋ 登记代发批次</button>':'')+page.rows.map(r=>`<button class="account-row" data-dropship="${h(r.id)}"><span><b>${h(r.code)} · ${h(r.supplier)}${r.status==='void'?' · 已作废':''}</b><small>${h(r.businessDate)}</small></span><span>›</span></button>`).join('')+(!page.rows.length?'<p class="muted">暂无代发批次。</p>':'')+`<div class="pager"><button class="secondary" data-dropship-list="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${page.total} 个批次</span><button class="secondary" data-dropship-list="${offset+50}" ${offset+50>=page.total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function detail(id,offset=0){
  await showPanel('代发批次成本与退款',async signal=>{
   const s=await api.dropshipDetail(id,offset,signal),d=s.document,active=s.record.status==='active';
   const lines=r=>r.lines.map(c=>{const l=r.facts?.lines.find(l=>l.id===c.lineId)||s.lines.find(l=>l.id===c.lineId);return `<p>${h(l.snapshot.skuCode)} · ${h(l.snapshot.name)} · ${h(l.snapshot.storeName)} · ${l.quantity} ${h(l.snapshot.unit)} · ${h(money(c.amountCents))} · ${c.basis==='actual'?'实际成本':`参考估算（${h(c.reference.effectiveMonth)} 起 / 第 ${c.reference.version} 版）`}<button class="text-button" data-cost-sku="${h(l.skuId)}">核对 SKU 成本</button></p>`;}).join('');
   return head(d.code+' · 代发成本')+`<p>${h(d.businessDate)} · ${h(d.supplier)} · ${h(d.sourceReference)}</p><button class="text-button" data-dropship-list="0">返回代发批次</button>${active&&maintain()?`<button class="secondary" data-dropship-edit="${h(id)}">修正成本</button><button class="secondary" data-dropship-facts="${h(id)}">更正日期、数量与店铺</button><button class="secondary" data-dropship-refund="${h(id)}">登记供应商退款</button><button class="text-button" data-dropship-void="${h(id)}">作废错误批次</button>`:''}
    ${!active?'<p class="save-error">本批次已作废，不计入有效成本或退款，不可继续修正金额或登记退款。</p>':''}${d.sourceConflict?'<p class="save-error">同供应商来源存在重复有效批次，请核对原单；当前经营成本不能确认。</p>':''}
    ${d.replacesId?`<button class="text-button" data-dropship="${h(d.replacesId)}">查看原作废批次</button>`:''}${d.replacementId?`<button class="text-button" data-dropship="${h(d.replacementId)}">查看关联重建批次</button>`:!active&&maintain()?`<button class="secondary" data-dropship-rebuild="${h(id)}">按原错单重建正确批次</button>`:''}
    <h3>${active?'当前成本':'作废前成本依据'} · 第 ${s.record.version} 版</h3>${lines(s.record)}<h3>退款记录</h3>${s.refunds.map(r=>`<article class="observation"><b>${h(r.businessDate)} · ${r.quantity} ${h(s.lines.find(l=>l.id===r.lineId).snapshot.unit)} · ${h(r.sourceReference)}${r.history[0].status==='void'?' · 已作废':''}</b>${r.replacesId?'<p>本记录关联重建原作废退款，原记录保留在下方历史中。</p>':''}${r.replacementId?'<p>已有关联重建退款，请核对同批次中的新记录。</p>':''}${r.history.map(v=>`<p>第 ${v.version} 版${v.status==='void'?' · 已作废':''} · 实际退款 ${h(money(v.amountCents))} · ${h(v.reason)} · ${h(v.actor)} · ${h(localTime(v.createdAt))}</p>`).join('')}${active&&maintain()?(r.history[0].status==='active'?`<button class="text-button" data-dropship-refund="${h(id)}" data-refund-id="${h(r.id)}">修正实际退款金额</button><button class="text-button" data-dropship-void="${h(id)}" data-refund-id="${h(r.id)}">作废错误退款</button>`:!r.replacementId?`<button class="text-button" data-dropship-refund-rebuild="${h(id)}" data-refund-id="${h(r.id)}">按此退款重建正确记录</button>`:''):''}</article>`).join('')||'<p class="muted">暂无供应商退款。</p>'}
    <h3>成本历史</h3>${s.history.rows.map(r=>`<article class="observation"><b>第 ${r.version} 版 · ${r.status==='void'?'已作废':'有效'}</b>${r.facts?`<p>${h(r.facts.businessDate)} · ${h(r.facts.supplier)} · ${h(r.facts.sourceReference)}</p>`:''}${lines(r)}<p class="preserve-text">${h(r.reason)}</p><small>${h(r.actor)} · ${h(localTime(r.createdAt))}</small></article>`).join('')}
    <div class="pager"><button class="secondary" data-dropship="${h(id)}" data-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${s.history.total} 条成本版本</span><button class="secondary" data-dropship="${h(id)}" data-offset="${offset+50}" ${offset+50>=s.history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-source-close]'))document.querySelector('#cloud-detail').close();
  const r=e.target.closest('[data-reference]'),l=e.target.closest('[data-dropship-list]'),d=e.target.closest('[data-dropship]');
  if(r)reference(r.dataset.reference,r.dataset.month||chinaDate().slice(0,7),Number(r.dataset.offset||0)).catch(e=>notify(e.message));
  if(l)list(Number(l.dataset.dropshipList||0)).catch(e=>notify(e.message));if(d)detail(d.dataset.dropship,Number(d.dataset.offset||0)).catch(e=>notify(e.message));
 });
 document.addEventListener('change',e=>{if(e.target.matches('[data-reference-month]'))reference(e.target.dataset.referenceMonth,e.target.value).catch(e=>notify(e.message));});
 return {reference,list,detail};
}
