import {signedCostMoney} from './cost-sources-contract.mjs';
const decimal=n=>Math.floor(Number(n)/100)+'.'+String(Number(n)%100).padStart(2,'0');
export function createInventoryCostEditors({api,h,mount,input,area,select}){
 async function inventoryCost(id){
  const [state,finance]=await Promise.all([api.inventoryCost(id),api.finance()]),s=state.source,r=state.record,key=crypto.randomUUID(),basis=s.mode==='basis';
  if(!['basis','outflow'].includes(s.mode))throw new Error('请沿用原单据成本或自动领用归属入口。');
  const expense=finance.records.find(e=>e.id===r?.expenseId),eligible=finance.records.filter(e=>e.id===r?.expenseId||(basis?e.expenseUse==='inventory':e.expenseUse==='operating'&&e.expenseDate.startsWith(s.day.slice(0,7))));
  if(r?.expenseId&&!expense)throw new Error('原关联支出暂不可见，请重新核对。');
  const body=`<p>${h(s.day)} · ${h(s.snapshot.name)} · ${s.delta>0?'+':''}${s.delta} ${h(s.snapshot.unit)}</p>`+
   (basis?input('amount','本次增加库存的总成本（元）',expense?decimal(expense.amountCents):r?decimal(r.amountCents):s.costCents===null?'':decimal(s.costCents),'required inputmode="decimal" maxlength="11"')+'<p class="muted">金额只对应本次增加数量；采购原单价和数量保留，修正以新成本版本重算。</p>':`<p>按移动平均核对的本次成本 ${s.costCents===null?'待补原期初或入库依据':h(signedCostMoney(s.costCents))}</p>`+select('scope','本次费用归属',expense?.expenseScope||r?.scope||'unclassified',[['unclassified','待核对'],['public','工作室公共'],['store','店铺专属']])+select('storeId','专属店铺（公共不选店铺）',(expense?expense.storeId:r?.storeId)||'',[['','不指定'],...state.stores.map(store=>[store.id,store.name+(store.active?'':'（已停用）')])]))+
   (s.packagingPurchaseId&&basis?'<p class="muted">沿用原包材采购及其已有支出来源，本次不另建采购或支出。</p>':select('expenseId','引用已登记的整笔支出（可不引用）',r?.expenseId||'',[['','不引用已有支出'],...eligible.map(e=>[e.id,`${e.expenseDate} · ${e.description} · ${signedCostMoney(String(e.amountCents))}`])]))+
   (expense&&expense.version!==r?.expenseSnapshot?.version?'<p class="save-error">原关联支出已有新版本，请核对当前金额、用途与归属后再保存。</p>':'')+
   input('sourceReference','成本依据或归属核对来源',r?.sourceReference,'required maxlength="200"')+area('reason','本次登记或修正说明（必填）')+'<p class="muted">仅保存成本依据或费用归属，不改变原库存数量，不新增支出或报销。公共费用不分摊到店铺。</p>';
  mount(basis?'核对库存增加成本':'核对其他出库费用归属',body,f=>{
   const scope=basis?null:f.get('scope'),linked=finance.records.find(e=>e.id===f.get('expenseId'));
   return api.saveInventoryCost(id,{requestKey:key,expectedVersion:r?.version??0,amount:basis?f.get('amount').trim():null,scope,storeId:basis||scope==='public'?null:f.get('storeId')||null,expenseId:linked?.id??null,expenseVersion:linked?.version??null,purchaseSourceVersion:basis?s.purchaseSourceVersion:null,sourceReference:f.get('sourceReference'),reason:f.get('reason')});
  },{kind:'inventory-cost',id},()=>api.inventoryCostReceipt(id,key),form=>{
   const scope=form.querySelector('[name=scope]'),store=form.querySelector('[name=storeId]'),link=form.querySelector('[name=expenseId]');
   const changed=()=>{if(scope&&store){if(scope.value==='public')store.value='';store.closest('label').hidden=scope.value==='public';}};
   const selected=()=>{const e=finance.records.find(e=>e.id===link?.value);if(e){if(basis)form.querySelector('[name=amount]').value=decimal(e.amountCents);else{scope.value=e.expenseScope;store.value=e.storeId||'';changed();}}};
   scope?.addEventListener('change',changed);link?.addEventListener('change',selected);changed();return ()=>{scope?.removeEventListener('change',changed);link?.removeEventListener('change',selected);};
  });
 }
 return {inventoryCost};
}
