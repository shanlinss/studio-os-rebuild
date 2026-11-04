import {chinaDate} from './cloud-contract.mjs';
import {signedCostMoney} from './cost-sources-contract.mjs';
import {hasSensitive} from './admin-permissions.mjs';
export function createInventoryCostViews({api,h,showPanel,getUser,writable,notify,localTime}){
 let current={month:chinaDate().slice(0,7),kind:'all',mode:'all',q:'',offset:0};
 const labels={asset:'转为样品资产',basis:'增加库存成本',outflow:'其他出库归属',automatic:'按实际店铺领用',external:'沿用原单据成本',excluded:'调拨或分账'};
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" data-inventory-cost-close aria-label="关闭库存成本">×</button></div>`;
 const amount=v=>v===null?'待核对':h(signedCostMoney(v));
 async function list(params=current){current={...params};const query={...current};await showPanel('包材成本与其他出库归属',async signal=>{
  const d=await api.inventoryCosts(query,signal);
  return head('包材成本与其他出库归属')+'<p>复用原库存流水和采购依据，按移动平均核对实际领用成本；内部调拨和分账不计费用。其他出库单独核对公共或店铺归属。</p>'+`<form data-inventory-cost-filter class="module-toolbar"><label>月份<input name="month" type="month" value="${h(query.month)}" required min="1900-01" max="2199-12"></label><label>类型<select name="kind">${[['all','全部'],['packaging','包材'],['product','商品']].map(([v,t])=>`<option value="${v}" ${query.kind===v?'selected':''}>${t}</option>`).join('')}</select></label><label>核对内容<select name="mode">${[['all','全部'],['basis','增加库存成本'],['outflow','其他出库归属'],['automatic','实际领用'],['external','原单据成本'],['asset','转为样品资产']].map(([v,t])=>`<option value="${v}" ${query.mode===v?'selected':''}>${t}</option>`).join('')}</select></label><label>查找<input name="q" maxlength="100" value="${h(query.q)}" placeholder="物料名称或编号"></label><button class="secondary">筛选</button></form>`+
   d.rows.map(r=>`<button class="account-row" data-inventory-cost="${h(r.id)}"><span><b>${h(r.snapshot.name)} · ${h(labels[r.mode])}</b><small>${h(r.day)} · ${r.delta>0?'+':''}${r.delta} ${h(r.snapshot.unit)}${r.sourceChanged?' · 来源已变化':''}</small></span><span>${amount(r.costCents)} ›</span></button>`).join('')+(!d.rows.length?'<p class="muted">该筛选暂无库存流水。</p>':'')+`<div class="pager"><button class="secondary" data-inventory-cost-page="${Math.max(0,query.offset-50)}" ${query.offset===0?'disabled':''}>上一页</button><span>${d.total} 条流水</span><button class="secondary" data-inventory-cost-page="${query.offset+50}" ${query.offset+50>=d.total?'disabled':''}>下一页</button></div>`;
 });}
 async function detail(id,offset=0){await showPanel('库存成本依据与归属',async signal=>{
  const s=await api.inventoryCost(id,offset,signal),r=s.source,maintain=writable&&hasSensitive(getUser(),'finance')&&(r.mode==='outflow'||r.mode==='basis'&&hasSensitive(getUser(),'resources'));
  return head(r.snapshot.name+' · 库存成本')+`<button class="text-button" data-inventory-cost-list>返回库存成本核对</button><p>${h(r.day)} · ${r.delta>0?'+':''}${r.delta} ${h(r.snapshot.unit)} · ${h(labels[r.mode])}</p><p>本次实际成本 ${amount(r.costCents)}</p>${r.sourceChanged?'<p class="save-error">原采购或成本引用支出有新版本，请重新核对依据。</p>':''}
   ${maintain?`<button class="secondary" data-inventory-cost-edit="${h(id)}">${r.mode==='basis'?'登记或修正成本依据':'核对公共或店铺归属'}</button>`:''}
   ${r.mode==='asset'?'<p>按原商品成本转为样品资产，暂不扣经营利润。借出和归还不计费用；损耗或报废时再核对费用。</p>':''}
   ${r.mode==='automatic'?`<p>按原领用单的实际业务店铺计入成本，库存原归属不代替领用归属。</p>${hasSensitive(getUser(),'resources')?`<button class="text-button" data-consumption-detail="${h(r.consumptionId)}">查看原领用单</button>`:''}`:''}
   ${r.mode==='external'&&r.actualSkuId?`<button class="text-button" ${r.type==='opening'?'data-product-opening':'data-cost-sku'}="${h(r.actualSkuId)}" data-cost-period="${h(r.day.slice(0,7))}">沿用原商品${r.type==='opening'?'期初成本':'成本核对'}入口</button>`:''}
   ${r.mode==='external'&&!r.actualSkuId?'<p class="muted">商品原期初请先关联正式 SKU，再从原期初成本入口核对。</p>':''}
   <h3>依据历史</h3>${s.history.rows.map(v=>`<article class="observation"><b>第 ${v.version} 版 · ${v.mode==='basis'?amount(String(v.amountCents)):v.scope==='public'?'工作室公共':v.scope==='store'?'店铺专属':'归属待核对'}</b><p>${h(v.sourceReference)}${v.storeId?' · '+h(s.stores.find(store=>store.id===v.storeId)?.name||'原店铺'):''}</p><p class="preserve-text">${h(v.reason)}</p>${v.expenseSnapshot?`<p>原支出 ${h(v.expenseSnapshot.description)} · ${amount(String(v.expenseSnapshot.amountCents))} · 第 ${v.expenseSnapshot.version} 版</p>`:''}<small>${h(v.actor)} · ${h(localTime(v.createdAt))}</small></article>`).join('')||'<p class="muted">尚无人工核对版本；已有原采购或原商品成本仍保留使用。</p>'}
   <div class="pager"><button class="secondary" data-inventory-cost="${h(id)}" data-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${s.history.total} 条版本</span><button class="secondary" data-inventory-cost="${h(id)}" data-offset="${offset+50}" ${offset+50>=s.history.total?'disabled':''}>下一页</button></div>`;
 });}
 document.addEventListener('click',e=>{if(e.target.closest('[data-inventory-cost-close]'))document.querySelector('#cloud-detail').close();const l=e.target.closest('[data-inventory-cost-list]'),p=e.target.closest('[data-inventory-cost-page]'),r=e.target.closest('[data-inventory-cost]');if(l)list().catch(e=>notify(e.message));if(p)list({...current,offset:Number(p.dataset.inventoryCostPage)}).catch(e=>notify(e.message));if(r)detail(r.dataset.inventoryCost,Number(r.dataset.offset||0)).catch(e=>notify(e.message));});
 document.addEventListener('submit',e=>{if(e.target.matches('[data-inventory-cost-filter]')){e.preventDefault();const f=new FormData(e.target);list({month:f.get('month'),kind:f.get('kind'),mode:f.get('mode'),q:f.get('q').trim(),offset:0}).catch(e=>notify(e.message));}});
 return {list,detail};
}
