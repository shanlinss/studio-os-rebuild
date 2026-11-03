import {ContractError} from './cloud-contract.mjs';
import {hasSensitive} from './admin-permissions.mjs';
import {money} from './management-model.mjs';
const decimal=v=>v===null||v===undefined?'':Math.floor(v/100)+'.'+String(v%100).padStart(2,'0');
export function createEquipmentPurchaseEditors({api,h,mount,input,area,select}){
 async function equipmentPurchase(id){
  const [user,state,first]=await Promise.all([api.session(),api.equipmentPurchase(id),api.equipmentPurchaseHistory(id)]);
  if(!hasSensitive(user,'finance'))throw new ContractError('采购资料需要财务授权。');
  const editable=hasSensitive(user,'resources'),r=state.record,key=crypto.randomUUID(),records=editable?(await api.finance()).records:[];
  if(editable&&r?.expenseId&&!records.some(e=>e.id===r.expenseId))throw new ContractError('原关联支出未完整读取，请重试。');
  const brief=row=>`${row.purchaseDate||'日期未登记'} · ${row.amountCents===null?'金额未知':money(row.amountCents)} · ${row.supplier||'供应商未登记'}`;
  const historyRow=row=>`<article class="observation"><b>第 ${h(row.version)} 版 · ${h(brief(row))}</b><p>${row.expenseSnapshot?'引用支出：'+h(row.expenseSnapshot.description)+' · 当时 '+h(money(row.expenseSnapshot.amountCents)):'未关联支出'}</p><p class="preserve-text">${h(row.reason)}</p><p class="muted">${h(row.actor)} · ${h(new Date(row.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</p></article>`;
  const fields=editable?`<div class="form-grid">${input('purchaseDate','购买日期',r?.purchaseDate||'','type="date"')}${input('amount','设备采购金额（元）',decimal(r?.amountCents),'inputmode="decimal" maxlength="11" placeholder="未知请留空；确认免费填0"')}</div>`+input('supplier','供应商',r?.supplier||'','maxlength="150"')+select('expenseId','引用已有支出',r?.expenseId||'',[['','暂不关联'],...records.map(e=>[e.id,`${e.expenseDate} · ${e.description} · ${money(e.amountCents)}`])])+area('reason','本次登记或修改原因（必填）'):`<p>${h(r?brief(r):'尚未登记采购资料')}</p><p class="muted">当前可查看；修改还需要资源维护授权。</p>`;
  mount('设备采购资料',`<p>${h(state.equipment.name)} · ${h(state.equipment.assetTag)}</p><p class="planning-rule">采购资料仅供财务授权人员查看，不进入员工借还或普通设备记录。金额是人工核实的设备采购价，关联支出仅作来源参考，不分摊金额，也不重复记账。</p>${state.sourceChanged?'<p class="save-error">关联支出已修改。原采购历史仍保留当时版本，请核对当前支出后再保存。</p>':''}${state.linkedExpense?`<p>当前关联支出：${h(state.linkedExpense.description)} · ${h(money(state.linkedExpense.amountCents))}</p>`:''}${fields}<h3>采购资料历史</h3><div data-purchase-history>${first.rows.map(historyRow).join('')||'<p class="muted">暂无记录，金额保持未知。</p>'}</div><div class="module-toolbar"><button type="button" class="text-button" data-purchase-prev>上一页</button><span data-purchase-count></span><button type="button" class="text-button" data-purchase-next>下一页</button></div><p data-purchase-error role="status"></p>`,f=>{
   if(!editable)throw new ContractError('修改采购资料还需要资源维护授权。');
   const source=records.find(e=>e.id===f.get('expenseId'));
   return api.saveEquipmentPurchase(id,{requestKey:key,expectedVersion:r?.version||0,purchaseDate:f.get('purchaseDate')||null,amount:f.get('amount').trim()||null,supplier:f.get('supplier'),expenseId:source?.id||null,expenseVersion:source?.version||null,reason:f.get('reason')});
  },{kind:'equipment'},editable?()=>api.equipmentPurchaseReceipt(id,key):undefined,form=>{
   let page=first,loading=false,disposed=false;const abort=new AbortController(),prev=form.querySelector('[data-purchase-prev]'),next=form.querySelector('[data-purchase-next]');
   const update=()=>{prev.disabled=loading||page.offset===0;next.disabled=loading||page.offset+page.rows.length>=page.total;form.querySelector('[data-purchase-count]').textContent=`共 ${page.total} 条 · 第 ${Math.floor(page.offset/50)+1} 页`;};update();if(!editable)form.querySelector('[type=submit]').hidden=true;
   async function load(offset){if(loading)return;loading=true;update();const error=form.querySelector('[data-purchase-error]');error.textContent='';try{const result=await api.equipmentPurchaseHistory(id,offset,abort.signal);if(disposed)return;page=result;form.querySelector('[data-purchase-history]').innerHTML=page.rows.map(historyRow).join('');}catch(e){if(!disposed&&e.name!=='AbortError')error.textContent=e.message;}finally{if(!disposed){loading=false;update();}}}
   prev.onclick=()=>load(Math.max(0,page.offset-50));next.onclick=()=>load(page.offset+50);return ()=>{disposed=true;abort.abort();};
  });
 }
 return {equipmentPurchase};
}
