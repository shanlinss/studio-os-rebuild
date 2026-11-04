import {ContractError} from './cloud-contract.mjs';
import {money} from './management-model.mjs';
const decimal=value=>Math.floor(value/100)+'.'+String(value%100).padStart(2,'0');
export function createProductPurchaseEditors({api,h,mount,input,area,select}){
 async function productPurchase(id){
  const [state,{records}]=await Promise.all([api.productPurchase(id),api.finance()]);
  const {document,batch,record}=state,key=crypto.randomUUID(),current=new Map((record?.lines||[]).map(line=>[line.movementId,line]));
  if(document.status==='void')throw new ContractError('原入库单已作废，采购成本保留历史，不能继续登记。');
  if(record?.expenseId&&!records.some(e=>e.id===record.expenseId))throw new ContractError('原关联支出未读取完整，请刷新后核对。');
  const body=(state.sourceChanged?'<p class="save-error">入库单或原支出已有变化，请重新核对单价、附加费及实际总成本后保存。</p>':'')+`<p>原入库日期 ${h(document.businessDate)} · ${h(document.sourceReference||'原商品入库单')}</p>`+
   input('code','采购批次编号',batch?.code,'required maxlength="64"'+(batch?' readonly':''))+
   input('purchaseDate','采购日期',record?.purchaseDate||document.businessDate,'required type="date"')+
   input('supplier','供应商',record?.supplier,'required maxlength="150"')+
   document.lines.map((line,i)=>`<fieldset class="form-grid"><legend>${h(line.snapshot.skuCode)} · ${h(line.snapshot.name)} · ${h(line.snapshot.storeName||'公共库存')} · 已入库 ${line.quantity} ${h(line.snapshot.unit)}</legend>
    ${input('unit'+i,'采购单价（元）',current.has(line.id)?decimal(current.get(line.id).unitCents):'','required inputmode="decimal" maxlength="11"')}
    ${input('extra'+i,'本行附加费用（元）',current.has(line.id)?decimal(current.get(line.id).additionalCents):'0.00','required inputmode="decimal" maxlength="11"')}</fieldset>`).join('')+
   '<p class="muted">附加费用按实际核对金额逐行填写，实际为零请填 0。</p>'+
   select('expenseId','引用已有财务支出',record?.expenseId||'',[['','暂不关联'],...records.map(e=>[e.id,`${e.expenseDate} · ${e.description} · ${money(e.amountCents)}`])])+area('reason','登记或修正依据（必填）');
  mount(batch?'修正商品采购成本':'登记商品采购批次',body,f=>{
   const expense=records.find(e=>e.id===f.get('expenseId'));
   return api.saveProductPurchase(id,{requestKey:key,expectedVersion:record?.version??0,stockCorrectionVersion:state.document.correctionVersion??0,code:f.get('code'),purchaseDate:f.get('purchaseDate'),supplier:f.get('supplier'),
    expenseId:expense?.id??null,expenseVersion:expense?.version??null,reason:f.get('reason'),
    lines:document.lines.map((line,i)=>({movementId:line.id,unitPrice:f.get('unit'+i).trim(),additionalAmount:f.get('extra'+i).trim()}))});
  },{kind:'product-purchase',id},()=>api.productPurchaseReceipt(id,key));
 }
 return {productPurchase};
}
