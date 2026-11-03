import {ContractError} from './cloud-contract.mjs';
import {warehouseUnits,warehouseKinds,movementLabels} from './warehouse-contract.mjs';

export function createWarehouseEditors({api,h,mount,input,area,select}){
 async function warehouse(action,id,correctionId=null){
  if(!['register','edit',...Object.keys(movementLabels)].includes(action)||(correctionId&&action!=='stocktake'))throw new ContractError();
  const row=id?await api.warehouseItem(id):null,key=crypto.randomUUID();let body='',operation=action,setup;
  if(['register','edit'].includes(action)){
   const products=await api.products(),options=[['','请选择原产品'],...products.filter(p=>p.active||p.id===row?.productId).map(p=>[p.id,p.name])];
   if(row?.productId&&!options.some(([id])=>id===row.productId))options.push([row.productId,row.productName||'原关联产品']);
   body=input('itemCode','库存编码',row?.itemCode,'required maxlength="64"')+input('name','库存名称',row?.name,'required maxlength="120"');
   if(row?.openingConfirmed)body+=`<p class="muted">${h(warehouseKinds[row.kind])} · ${h(row.productName||'独立包材')} · ${h(row.specification||'无规格说明')} · ${h(row.unit)}；期初登记后上述内容保持锁定。</p>`;
   else body+=select('kind','库存类型',row?.kind||'product',Object.entries(warehouseKinds))+select('productId','关联原产品',row?.productId||'',options)+input('specification','规格说明',row?.specification,'maxlength="200"')+select('unit','整数基础单位',row?.unit||'件',warehouseUnits.map(u=>[u,u]));
   body+=input('location','存放位置',row?.location,'required maxlength="150"')+area('notes','库存说明',row?.notes||'')+(row?select('active','使用状态',String(row.active),[['true','启用'],['false','停用']]):'')+'<p class="muted">新项目不自动生成数量。请实际核对并登记期初；基础单位不做自动换算。没有可选产品时，请先在产品管理登记。</p>';
   if(!row?.openingConfirmed)setup=form=>{const kind=form.elements.kind,product=form.elements.productId,label=product.closest('label');label.classList.add('warehouse-product-field');const sync=()=>{const packaging=kind.value==='packaging';label.hidden=packaging;product.required=!packaging;};kind.onchange=sync;sync();};
  }else{
   if(!row.active)throw new ContractError('库存项目已停用，请先重新启用。');if(action==='opening'?row.openingConfirmed:!row.openingConfirmed)throw new ContractError('请先登记期初数量，且只能登记一次。');operation='move';
   const corrected=correctionId?await api.warehouseMovement(id,correctionId):null;
   body=`<p>${h(row.name)} · ${h(row.itemCode)} · ${row.openingConfirmed?'当前 '+row.quantity+' '+h(row.unit):'尚未登记期初'}</p>`+(corrected?`<p class="muted">本次盘点引用原${h(movementLabels[corrected.type])}记录（${h(corrected.reason)}）。原流水保留，请填写当前实际盘点数。</p>`:'')+input('quantity',action==='opening'?'实际期初数量':action==='stocktake'?'当前实际盘点数量':action==='inbound'?'本次入库数量':'本次出库数量','',`required type="number" min="${['opening','stocktake'].includes(action)?0:1}" max="2147483647" step="1"`)+area('reason','原因与依据（必填）')+input('sourceReference','来源参考（可填送货单号或领用说明）','','maxlength="200"')+`<p class="muted">${action==='stocktake'?'盘点填写实际结余，不填写增减差额；系统将差异记为一条新流水。':action==='opening'?'实际为零也需明确填写 0；保存后不能再次登记期初。':'只登记实际数量变化，不生成采购支出或订单记录。'}</p>`;
  }
  const title=action==='register'?'新建库存项目':action==='edit'?'编辑库存资料':movementLabels[action];
  mount(title,body,f=>{
   let value;
   if(['register','edit'].includes(action)){
    const locked=row?.openingConfirmed,kind=locked?row.kind:f.get('kind');
    value={requestKey:key,itemCode:f.get('itemCode'),name:f.get('name'),kind,productId:locked?row.productId:kind==='packaging'?null:f.get('productId')||null,specification:locked?row.specification:f.get('specification'),unit:locked?row.unit:f.get('unit'),location:f.get('location'),notes:f.get('notes')};if(row)value.active=f.get('active')==='true';
   }else{const raw=f.get('quantity');if(typeof raw!=='string'||!raw.trim())throw new ContractError('请明确填写实际数量。');value={requestKey:key,type:action,quantity:Number(raw),reason:f.get('reason'),sourceReference:f.get('sourceReference'),correctsMovementId:correctionId};}
   return api.warehouseWrite(operation,id,value,row?.version);
  },{kind:'warehouse',id},async()=>api.warehouseReceipt(key,operation,id),setup);
 }
 return {warehouse};
}
