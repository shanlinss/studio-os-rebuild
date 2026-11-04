import {chinaDate} from './cloud-contract.mjs';
import {money} from './management-model.mjs';
import {hasSensitive} from './admin-permissions.mjs';
export function createOperatingFinanceViews({api,h,showPanel,getUser,writable,localTime,notify}){
 let current={month:chinaDate().slice(0,7),kind:'all',status:'active',storeId:'',q:'',offset:0};
 const labels={sale:'日常销售',refund:'客户退款',fee:'平台手续费'},maintain=()=>writable&&hasSensitive(getUser(),'finance');
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" data-operating-close aria-label="关闭日常收支">×</button></div>`;
 async function list(params=current){
  current={...params};const query={...current};
  await showPanel('销售、退款与手续费',async signal=>{
   const data=await api.operatingRecords(query,signal),s=data.summary;
   return head('销售、退款与手续费')+`<p class="muted">这里是日常登记金额。正式结算收入、实际到账和利润将在对应来源核对后分别接入。手续费引用原支出时不新增支出。</p>
    <section class="summary-strip"><div><b>${h(money(s.saleCents))}</b><span>有效日常销售</span></div><div><b>${h(money(s.refundCents))}</b><span>有效客户退款</span></div><div><b>${h(money(s.feeCents))}</b><span>有效平台手续费</span></div></section>
    <form data-operating-filter class="module-toolbar"><label>发生月份<input type="month" name="month" value="${h(query.month||'')}" min="1900-01" max="2199-12"></label><label>店铺<select name="storeId"><option value="">全部</option>${data.stores.map(store=>`<option value="${h(store.id)}" ${query.storeId===store.id?'selected':''}>${h(store.name)}${store.active?'':'（已停用）'}</option>`).join('')}</select></label><label>类型<select name="kind">${[['all','全部'],...Object.entries(labels)].map(([v,label])=>`<option value="${v}" ${query.kind===v?'selected':''}>${h(label)}</option>`).join('')}</select></label><label>状态<select name="status">${[['active','有效'],['void','已作废'],['all','全部']].map(([v,label])=>`<option value="${v}" ${query.status===v?'selected':''}>${label}</option>`).join('')}</select></label><label>关键词<input name="q" type="search" maxlength="100" value="${h(query.q||'')}" placeholder="说明、来源编号或店铺"></label><button class="secondary" type="submit">筛选</button></form>
    <p class="muted">合计覆盖当前筛选的全部有效记录，按各自业务日期归月。三类金额分别核对。</p>${s.changedSources?`<p class="save-error">${s.changedSources} 条手续费的关联支出已变化，请核对来源版本。</p>`:''}
    ${maintain()?'<div class="action-row"><button class="primary" data-operating-create="sale">＋ 登记日常销售</button><button class="secondary" data-operating-create="fee">＋ 登记平台手续费</button></div>':''}
    ${data.rows.map(r=>`<button class="account-row" data-operating-record="${h(r.id)}"><span><b>${h(r.description)}</b><small>${h(r.businessDate)} · ${h(r.storeName)} · ${h(labels[r.kind])} · ${h(r.sourceReference)}${r.status==='void'?' · 已作废':''}${r.sourceChanged?' · 来源待复核':''}</small></span><span>${h(money(r.amountCents))} ›</span></button>`).join('')||'<p class="muted">暂无符合筛选的日常收支记录。</p>'}
    <div class="pager"><button class="secondary" data-operating-page="${Math.max(0,query.offset-50)}" ${query.offset===0?'disabled':''}>上一页</button><span>${data.total} 条记录</span><button class="secondary" data-operating-page="${query.offset+50}" ${query.offset+50>=data.total?'disabled':''}>下一页</button></div>`;
  });
 }
 async function detail(id,offset=0){
  await showPanel('日常收支详情',async signal=>{
   const s=await api.operatingRecord(id,offset,signal),r=s.record;
   return head(labels[r.kind]+' · '+r.description)+`<button class="text-button" data-operating-list>返回日常收支</button><p>${h(r.businessDate)} · ${h(r.storeName)} · ${h(r.sourceReference)} · ${h(money(r.amountCents))} · ${r.status==='active'?'有效':'已作废'}</p>
    ${s.parent?`<p>原销售 ${h(s.parent.description)} · ${h(s.parent.businessDate)} · ${h(money(s.parent.amountCents))}<button class="text-button" data-operating-record="${h(s.parent.id)}">查看原销售</button></p>`:''}
    ${r.kind==='sale'?`<p>有效客户退款合计 ${h(money(s.refundedCents))}</p>`:''}
    ${r.expenseSnapshot?`<p>引用原支出 ${h(r.expenseSnapshot.description)} · ${h(r.expenseSnapshot.expenseDate)} · 当时金额 ${h(money(r.expenseSnapshot.amountCents))} · 第 ${r.expenseSnapshot.version} 版<button class="text-button" data-operating-expense="${h(r.expenseId)}">查看原支出与凭证</button></p>`:''}
    ${r.sourceChanged||s.parentChanged?'<p class="save-error">关联来源已有新版本，请核对。当前记录保留保存时的依据。</p>':''}
    ${maintain()&&r.status==='active'?`<div class="action-row"><button class="secondary" data-operating-edit="${h(id)}">修正记录</button>${r.kind==='sale'?`<button class="secondary" data-operating-refund="${h(id)}">登记客户退款</button>`:''}<button class="text-button" data-operating-void="${h(id)}">作废记录</button></div>`:''}
    <h3>记录历史</h3>${s.history.rows.map(v=>`<article class="observation"><b>第 ${v.version} 版 · ${v.status==='void'?'已作废':'有效'} · ${h(v.businessDate)} · ${h(money(v.amountCents))}</b><p>${h(v.description)}</p><p class="preserve-text">${h(v.note||'无补充备注')}</p><p class="preserve-text">${h(v.reason)}</p>${v.parentSnapshot?`<p>原销售第 ${v.parentSnapshot.version} 版 · ${h(v.parentSnapshot.description)} · ${h(money(v.parentSnapshot.amountCents))}</p>`:''}${v.expenseSnapshot?`<p>原支出第 ${v.expenseSnapshot.version} 版 · ${h(v.expenseSnapshot.description)} · ${h(money(v.expenseSnapshot.amountCents))}</p>`:''}<small>${h(v.actor)} · ${h(localTime(v.createdAt))}</small></article>`).join('')}
    <div class="pager"><button class="secondary" data-operating-record="${h(id)}" data-offset="${Math.max(0,offset-50)}" ${offset===0?'disabled':''}>上一页</button><span>${s.history.total} 条版本</span><button class="secondary" data-operating-record="${h(id)}" data-offset="${offset+50}" ${offset+50>=s.history.total?'disabled':''}>下一页</button></div>`;
  });
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-operating-close]'))document.querySelector('#cloud-detail').close();
  const l=e.target.closest('[data-operating-list]'),p=e.target.closest('[data-operating-page]'),r=e.target.closest('[data-operating-record]');
  if(l)list().catch(e=>notify(e.message));if(p)list({...current,offset:Number(p.dataset.operatingPage)}).catch(e=>notify(e.message));if(r)detail(r.dataset.operatingRecord,Number(r.dataset.offset||0)).catch(e=>notify(e.message));
 });
 document.addEventListener('submit',e=>{if(e.target.matches('[data-operating-filter]')){e.preventDefault();const f=new FormData(e.target);list({month:f.get('month'),kind:f.get('kind'),storeId:f.get('storeId'),status:f.get('status'),q:f.get('q').trim(),offset:0}).catch(e=>notify(e.message));}});
 return {list,detail};
}
