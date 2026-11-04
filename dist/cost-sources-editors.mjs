import {chinaDate} from './cloud-contract.mjs';
const decimal=n=>Math.floor(n/100)+'.'+String(n%100).padStart(2,'0');
export function createCostSourcesEditors({api,h,mount,input,area,select}){
 async function referenceCost(id,month=chinaDate().slice(0,7)){
  const state=await api.referenceCost(id,month),key=crypto.randomUUID(),r=state.current;
  mount('参考成本与履约方式',`<p>${h(state.sku.code)} · ${h(state.sku.name)}</p>`+input('effectiveMonth','生效月份',month,'type="month" required min="1900-01" max="2199-12"')+
   input('unitPrice','参考单价（元，留空停止使用估算）',r?.unitCents==null?'':decimal(r.unitCents),'inputmode="decimal" maxlength="11"')+
   select('fulfillmentMode','该期默认履约方式',r?.fulfillmentMode||'stocked',[['stocked','工作室备货'],['dropship','一件代发']])+input('sourceReference','参考依据',r?.sourceReference,'required maxlength="200"')+
   area('reason','本次登记或调整说明')+'<p class="muted">参考单价仅用于明确标记的估算。实际库存成本保持独立；已保存代发批次保留当时依据。默认方式用于该期参考，不迁移或隐藏已有业务。</p>',f=>api.saveReferenceCost(id,{requestKey:key,expectedVersion:state.version,effectiveMonth:f.get('effectiveMonth'),unitPrice:f.get('unitPrice').trim()||null,fulfillmentMode:f.get('fulfillmentMode'),sourceReference:f.get('sourceReference'),reason:f.get('reason')}),{kind:'reference-cost',id,month},()=>api.referenceCostReceipt(id,key));
 }
 async function dropship(id=null){
  const key=crypto.randomUUID(),state=id?await api.dropshipDetail(id):null,options=id?null:await api.dropshipOptions();
  let indices=[0],next=1;
  const price=(i,r)=>select('basis'+i,'成本依据',r?.basis||'actual',[['actual','已核实的实际总成本'],['reference','按业务月份参考单价估算']])+input('amount'+i,'实际总成本（元，参考估算留空）',r?.basis==='actual'?decimal(r.amountCents):'','inputmode="decimal" maxlength="11"');
  const row=i=>`<fieldset data-drop-row="${i}"><legend>代发明细</legend>${input('sku'+i,'SKU 编号','','required list="drop-sku-list" maxlength="64"')}${select('store'+i,'业务店铺','',[['','请选择'],...options.stores.map(s=>[s.id,s.name])])}${input('quantity'+i,'实际代发数量','1','required type="number" min="1" max="2147483647" step="1"')}${price(i)}<button type="button" class="text-button" data-drop-remove="${i}">移除此行</button></fieldset>`;
  const doc=state?.document,body=state?`<p>${h(doc.code)} · ${h(doc.businessDate)} · ${h(doc.supplier)}</p>`+state.lines.map((line,i)=>`<fieldset><legend>${h(line.snapshot.skuCode)} · ${h(line.snapshot.name)} · ${h(line.snapshot.storeName)} · ${line.quantity} ${h(line.snapshot.unit)}</legend>${price(i,state.record.lines.find(c=>c.lineId===line.id))}</fieldset>`).join(''):
   input('code','代发批次编号','','required maxlength="64"')+input('businessDate','实际代发日期',chinaDate(),'required type="date"')+input('supplier','代发供应商','','required maxlength="150"')+input('sourceReference','原代发清单或结算单编号','','required maxlength="200"')+`<datalist id="drop-sku-list">${options.rows.map(s=>`<option value="${h(s.code)}">${h(s.name)} ${h(s.specification)}</option>`).join('')}</datalist><p class="muted">可直接填写正式 SKU 编号，建议列表展示前 50 个启用商品。每批最多 100 行，可包含多个 SKU 和店铺。</p><div data-drop-lines>${row(0)}</div><button type="button" class="secondary" data-drop-add>＋ 添加明细</button>`;
  mount(state?'修正代发成本':'登记代发成本批次',body+area('reason','成本核对依据与说明')+'<p class="muted">实际总成本包含本行已核实的附加费。选择参考估算时，使用保存时该业务月份适用的单价，并保留快照。保存成本不扣工作室库存，不自动生成支出或付款。</p>',f=>api.saveDropship(id,state?{requestKey:key,expectedVersion:state.record.version,reason:f.get('reason'),lines:state.lines.map((line,i)=>({lineId:line.id,basis:f.get('basis'+i),amount:f.get('basis'+i)==='reference'?null:f.get('amount'+i).trim()}))}:{requestKey:key,code:f.get('code'),businessDate:f.get('businessDate'),supplier:f.get('supplier'),sourceReference:f.get('sourceReference'),reason:f.get('reason'),lines:indices.map(i=>({skuCode:f.get('sku'+i),storeId:f.get('store'+i),quantity:Number(f.get('quantity'+i)),basis:f.get('basis'+i),amount:f.get('basis'+i)==='reference'?null:f.get('amount'+i).trim()}))}),{kind:'dropship-cost',id},()=>api.dropshipReceipt(key,id?'revise':'create',id),state?undefined:form=>{
   const click=e=>{if(form.querySelector('[type=submit]').disabled)return;const remove=e.target.closest('[data-drop-remove]');if(e.target.closest('[data-drop-add]')&&indices.length<100){const i=next++;indices.push(i);form.querySelector('[data-drop-lines]').insertAdjacentHTML('beforeend',row(i));form.dispatchEvent(new Event('input'));}if(remove&&indices.length>1){const i=Number(remove.dataset.dropRemove);indices=indices.filter(n=>n!==i);remove.closest('[data-drop-row]').remove();form.dispatchEvent(new Event('input'));}};
   form.addEventListener('click',click);return ()=>form.removeEventListener('click',click);
  });
 }
 async function dropshipRefund(id,refundId=null){
  const state=await api.dropshipDetail(id),old=refundId?state.refunds.find(r=>r.id===refundId):null,key=crypto.randomUUID(),latest=old?.history[0];
  if(refundId&&!old)throw new Error('原退款暂不可见。');
  const available=state.lines.filter(l=>l.quantity>l.returnedQuantity);if(!old&&!available.length)throw new Error('原批次已无可退数量。');
  const body=old?`<p>修正原退款 · ${h(old.businessDate)} · 数量 ${old.quantity} · ${h(old.sourceReference)}</p>`:
   select('lineId','原代发明细',available[0].id,available.map(l=>[l.id,`${l.snapshot.skuCode} · ${l.snapshot.storeName} · 尚可退 ${l.quantity-l.returnedQuantity} ${l.snapshot.unit}`]))+input('quantity','本次退货数量','1','required type="number" min="1" max="2147483647" step="1"')+input('businessDate','供应商实际退款日期',chinaDate(),'required type="date"')+input('sourceReference','供应商退款单号或来源编号','','required maxlength="200"');
  mount(old?'修正供应商退款金额':'登记代发退货退款',body+input('amount','供应商实际退回金额（元）',latest?decimal(latest.amountCents):'','required inputmode="decimal" maxlength="11"')+area('reason','退款核对或修正说明')+'<p class="muted">按供应商实际退款核实录入，不按原单价自动推算。回冲记入退款日期所在月份，不增加工作室库存。</p>',f=>api.saveDropshipRefund(id,{requestKey:key,refundId,expectedVersion:latest?.version??0,lineId:old?.lineId||f.get('lineId'),quantity:old?.quantity||Number(f.get('quantity')),businessDate:old?.businessDate||f.get('businessDate'),sourceReference:old?.sourceReference||f.get('sourceReference'),amount:f.get('amount').trim(),reason:f.get('reason')}),{kind:'dropship-cost',id},()=>api.dropshipReceipt(key,'refund',id));
 }
 return {referenceCost,dropship,dropshipRefund};
}
