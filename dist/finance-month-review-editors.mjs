export function createFinanceMonthEditors({api,h,mount,area}){
 async function financeMonthScope(month){
  const s=await api.financeMonthScope(month),r=s.record,key=crypto.randomUUID(),selected=new Set((r?.stores??[]).map(s=>s.id));
  mount('确认本月经营店铺范围',`<p>${h(month)} · ${r?'当前第 '+r.version+' 版':'尚未确认'}</p><p class="planning-rule">勾选该月实际经营的店铺，包括当月经营、之后停用的店铺。当前启用状态仅供参考；不会自动新增店铺或分摊公共费用。没有经营店铺时可全部不选，并填写原因。</p><fieldset><legend>该月实际经营的店铺</legend>${s.stores.map(store=>`<label><input type="checkbox" name="storeIds" value="${h(store.id)}" ${selected.has(store.id)?'checked':''}> ${h(store.name)}${store.active?'':'（当前已停用）'}</label>`).join('')||'<p class="muted">尚无店铺资料，可确认空范围并说明原因。</p>'}</fieldset>`+area('reason','确认或修正范围的依据（必填）'),f=>api.saveFinanceMonthScope({requestKey:key,month,expectedVersion:r?.version??0,storeIds:f.getAll('storeIds'),reason:f.get('reason')}),{kind:'finance-month-scope',month},()=>api.financeScopeReceipt(key,month));
 }
 return {financeMonthScope};
}
