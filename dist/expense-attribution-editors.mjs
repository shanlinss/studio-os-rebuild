import {expenseScopes,expenseUses} from './expense-attribution-model.mjs';
import {money} from './management-model.mjs';
export function expenseClassificationFields({h,select},data,row){return select('expenseScope','费用归属',row?.expenseScope||'unclassified',Object.entries(expenseScopes))+select('expenseUse','支出用途',row?.expenseUse||'unclassified',Object.entries(expenseUses))+select('storeId','专属店铺（公共费用不指定店铺）',row?.storeId||'',[['','不指定'],...data.stores.filter(s=>s.active||s.id===row?.storeId).map(s=>[s.id,s.name])])+'<p class="muted">公共运营费用只在工作室汇总扣除一次，不分摊给店铺。库存采购、预付款先单独核对，不计入这里的运营费用。</p>';}
export function expenseClassificationSetup(form){const scope=form.querySelector('[name=expenseScope]'),store=form.querySelector('[name=storeId]');const changed=()=>{if(scope.value==='public')store.value='';store.closest('label').hidden=scope.value==='public';};scope.addEventListener('change',changed);changed();return ()=>scope.removeEventListener('change',changed);}
export function expenseClassificationValue(f){return {expenseScope:f.get('expenseScope'),expenseUse:f.get('expenseUse'),storeId:f.get('expenseScope')==='public'?null:f.get('storeId')||null};}
export function createExpenseAttributionEditors({api,h,mount,select,area}){
 async function expenseAttribution(id){
  const data=await api.finance(),row=data.records.find(r=>r.id===id),key=crypto.randomUUID();if(!row)throw new Error('原支出暂不可见。');
  mount('核对支出用途与归属',`<p>${h(row.expenseDate)} · ${h(row.description)} · ${h(money(row.amountCents))}</p>`+expenseClassificationFields({h,select},data,row)+area('reason','本次归属核对依据（必填）')+(row.settlementId?'<p class="muted">本次仅调整用途与归属，原金额、垫付人和报销记录保持不变。</p>':''),f=>api.saveExpenseAttribution(id,{requestKey:key,expectedVersion:row.version,...expenseClassificationValue(f),reason:f.get('reason')}),{kind:'expense-attribution',id},()=>api.expenseAttributionReceipt(id,key),expenseClassificationSetup);
 }
 return {expenseAttribution};
}
