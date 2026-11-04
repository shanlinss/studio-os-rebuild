export function createProductOpeningEditors({api,h,mount,input,area}){
 async function productOpening(id){
  const state=await api.productOpening(id),key=crypto.randomUUID(),current=new Map((state.record?.lines||[]).map(line=>[line.movementId,line]));
  if(!state.lines.length)throw new Error('该 SKU 没有需要补录成本的原始非零期初。');
  const decimal=n=>Math.floor(n/100)+'.'+String(n%100).padStart(2,'0');
  const body=`<p>${h(state.sku.code)} · ${h(state.sku.name)}</p><p class="muted">按原期初数量逐行填写有依据的总成本，包含已经核实的附加费；确认零成本时填写 0。</p>`+
   state.lines.map((line,i)=>`<fieldset class="form-grid"><legend>${h(line.day)} · ${h(line.snapshot.storeName||'原总库存')} · ${line.quantity} ${h(state.sku.unit)}</legend>${input('amount'+i,'本行期初总成本（元）',current.has(line.id)?decimal(current.get(line.id).totalCents):'','required inputmode="decimal" maxlength="11"')}</fieldset>`).join('')+
   input('sourceReference','依据来源或单据编号',state.record?.sourceReference,'required maxlength="200"')+area('reason','登记或修正说明（必填）');
  mount(state.record?'修正期初成本依据':'补录期初成本依据',body,f=>api.saveProductOpening(id,{requestKey:key,expectedVersion:state.record?.version??0,sourceReference:f.get('sourceReference'),reason:f.get('reason'),
   lines:state.lines.map((line,i)=>({movementId:line.id,amount:f.get('amount'+i).trim()}))}),{kind:'product-opening',id},()=>api.productOpeningReceipt(id,key));
 }
 return {productOpening};
}
