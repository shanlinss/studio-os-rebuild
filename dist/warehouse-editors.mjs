import {money} from './management-model.mjs';
import {ContractError,chinaDate} from './cloud-contract.mjs';
import {warehouseUnits,warehouseKinds,movementLabels} from './warehouse-contract.mjs';

export function createWarehouseEditors({api,h,mount,input,area,select}){
 async function warehouse(action,id,correctionId=null){
  if(!['register','edit','allocate-packaging',...Object.keys(movementLabels)].includes(action)||(correctionId&&action!=='stocktake'))throw new ContractError();
  const row=id?await api.warehouseItem(id):null,key=crypto.randomUUID();let body='',operation=action,setup;
  if(action==='allocate-packaging'){
   if(!row?.active||row.kind!=='packaging')throw new ContractError('请选择启用的包材。');
   const used=new Set((row.balances||[]).map(b=>b.storeId));
   const scopes=[{id:null,name:'公共库存'},...(await api.stores()).filter(s=>s.active)].filter(s=>!used.has(s.id));
   if(!scopes.length)throw new ContractError('所有启用的库存归属均已建立。');
   const hint=row.packagingScoped?'新归属请填 0。':row.openingConfirmed?`分配合计须等于旧库存 ${row.quantity} ${row.unit}。`:'按实盘数量填写，确认是零时请填 0。';
   body=`<p>${h(row.name)} · ${h(hint)} 留空表示本次不建立该归属。</p>`+
    scopes.map((scope,i)=>input('scope'+i,scope.name,'',`type="number" min="0" max="${row.packagingScoped?0:2147483647}" step="1"`)).join('')+area('reason','核对依据（必填）');
   mount(row.packagingScoped?'新增包材归属':'核对并分配包材库存',body,f=>{
    const allocations=scopes.flatMap((scope,i)=>{
     const raw=f.get('scope'+i);
     return raw===''?[]:[{storeId:scope.id,quantity:Number(raw)}];
    });
    return api.warehouseWrite(action,id,{requestKey:key,allocations,reason:f.get('reason')},row.version);
   },{kind:'warehouse',id},()=>api.warehouseReceipt(key,action,id));
   return;
  }
  let fixedBalance;
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
   const balances=(row.balances||[]).filter(b=>b.storeId===null||b.storeActive);
   fixedBalance=corrected?.packagingBalanceId;
   if(row.packagingScoped&&(!balances.length||(corrected&&!balances.some(b=>b.id===fixedBalance))))throw new ContractError('没有可登记变动的包材归属。');
   const scopeOptions=balances.map(b=>[b.id,(b.storeName||'公共库存')+' · '+b.quantity+' '+row.unit]);
   const scopeField=row.packagingScoped?(fixedBalance?`<p>${h(scopeOptions.find(([key])=>key===fixedBalance)[1])}</p>`:select('packagingBalanceId','库存归属','',[['','请选择'],...scopeOptions])):'';
   body=scopeField+`<p>${h(row.name)} · ${h(row.itemCode)} · ${row.openingConfirmed?(row.packagingScoped?'全部归属合计 ':'当前 ')+row.quantity+' '+h(row.unit):'尚未登记期初'}</p>`+(corrected?`<p class="muted">本次盘点引用原${h(movementLabels[corrected.type])}记录（${h(corrected.reason)}）。原流水保留，请填写当前实际盘点数。</p>`:'')+input('quantity',action==='opening'?'实际期初数量':action==='stocktake'?'当前实际盘点数量':action==='inbound'?'本次入库数量':'本次出库数量','',`required type="number" min="${['opening','stocktake'].includes(action)?0:1}" max="2147483647" step="1"`)+area('reason','原因与依据（必填）')+input('sourceReference','来源参考（可填送货单号或领用说明）','','maxlength="200"')+`<p class="muted">${action==='stocktake'?'盘点填写实际结余，不填写增减差额；系统将差异记为一条新流水。':action==='opening'?'实际为零也需明确填写 0；保存后不能再次登记期初。':'只登记实际数量变化，不生成采购支出或订单记录。'}</p>`;
  }
  const title=action==='register'?'新建库存项目':action==='edit'?'编辑库存资料':movementLabels[action];
  mount(title,body,f=>{
   let value;
   if(['register','edit'].includes(action)){
    const locked=row?.openingConfirmed,kind=locked?row.kind:f.get('kind');
    value={requestKey:key,itemCode:f.get('itemCode'),name:f.get('name'),kind,productId:locked?row.productId:kind==='packaging'?null:f.get('productId')||null,specification:locked?row.specification:f.get('specification'),unit:locked?row.unit:f.get('unit'),location:f.get('location'),notes:f.get('notes')};if(row)value.active=f.get('active')==='true';
   }else{const raw=f.get('quantity');if(typeof raw!=='string'||!raw.trim())throw new ContractError('请明确填写实际数量。');value={requestKey:key,type:action,quantity:Number(raw),reason:f.get('reason'),sourceReference:f.get('sourceReference'),correctsMovementId:correctionId};if(row.packagingScoped)value.packagingBalanceId=fixedBalance||f.get('packagingBalanceId');}
   return api.warehouseWrite(operation,id,value,row?.version);
  },{kind:'warehouse',id},async()=>api.warehouseReceipt(key,operation,id),setup);
 }
 async function consumePackaging(){
  const first=await api.consumptionOptions(),balances=[...first.rows];
  for(let offset=first.limit;offset<first.total;offset+=first.limit)balances.push(...(await api.consumptionOptions(offset)).rows);
  if(!balances.length)throw new ContractError('当前范围内没有可扣减的包材库存。');
  const sources=new Map(balances.map(b=>[b.id,b])),key=crypto.randomUUID();
  const choices=[['','请选择包材和库存归属'],...balances.map(b=>[b.id,`${b.name} · ${b.itemCode} · ${b.storeName||'公共库存'} · 可用 ${b.quantity} ${b.unit}`])];
  const stores=[['','请选择实际领用店铺'],...first.stores.map(s=>[s.id,s.name])];
  const line=()=>`<fieldset class="form-grid" data-consumption-line><legend>领用明细</legend>
   ${select('balanceId','包材和库存来源','',choices)}
   ${input('quantity','领用数量','','required type="number" min="1" max="2147483647" step="1"')}
   ${select('usedStoreId','实际领用店铺','',stores)}
   <button type="button" class="text-button" data-remove-consumption-line>移除此项</button></fieldset>`;
  const body='<p class="muted">店铺库存由所属店铺领用。使用公共库存时，请选择实际领用店铺。</p>'+
   `<div data-consumption-lines>${line()}</div><button type="button" class="secondary" data-add-consumption-line>＋ 添加包材</button>`+area('reason','领用原因（必填）');
  mount('包材批量消耗',body,f=>{
   const quantities=f.getAll('quantity'),selectedStores=f.getAll('usedStoreId');
   const lines=f.getAll('balanceId').map((id,i)=>{
    const source=sources.get(id);
    if(!source)throw new ContractError('请为每项选择库存来源。');
    if(source.storeId===null&&!selectedStores[i])throw new ContractError('公共库存须选择实际领用店铺。');
    return {balanceId:id,expectedVersion:source.version,quantity:Number(quantities[i]),usedStoreId:source.storeId===null?selectedStores[i]:null};
   });
   return api.saveConsumption({requestKey:key,reason:f.get('reason'),lines});
  },{kind:'packaging-consumption'},()=>api.consumptionReceipt(key),form=>{
   const list=form.querySelector('[data-consumption-lines]'),add=form.querySelector('[data-add-consumption-line]');
   const sync=()=>{
    const rows=[...list.children];add.disabled=rows.length>=100;
    for(const row of rows){
     const source=row.querySelector('[name=balanceId]'),store=row.querySelector('[name=usedStoreId]');
     source.required=true;store.required=sources.get(source.value)?.storeId===null;
     store.closest('label').hidden=!store.required;
     row.querySelector('[data-remove-consumption-line]').disabled=rows.length===1;
    }
   };
   add.onclick=()=>{if(list.children.length>=100)return;list.insertAdjacentHTML('beforeend',line());form.dispatchEvent(new Event('change'));list.lastElementChild.querySelector('select').focus();};
   list.onclick=e=>{const button=e.target.closest('[data-remove-consumption-line]');if(button&&list.children.length>1){button.closest('[data-consumption-line]').remove();form.dispatchEvent(new Event('change'));}};
   form.addEventListener('change',sync);sync();
  });
 }
 async function packagingPurchase(id){
  const [row,{records}]=await Promise.all([api.warehouseItem(id),api.finance()]);
  const balances=(row.balances||[]).filter(b=>b.storeId===null||b.storeActive);
  if(row.kind!=='packaging'||!row.active||!balances.length)throw new ContractError('请先为启用的包材建立库存归属。');
  const key=crypto.randomUUID();
  const body=`<p>${h(row.name)} · ${h(row.itemCode)} · 按 ${h(row.unit)} 分配。留空表示该归属本次无入库。</p>`+
   input('purchaseDate','采购日期',chinaDate(),'required type="date"')+input('supplier','供应商','','required maxlength="150"')+
   input('unitPrice','采购单价（元）','','required inputmode="decimal" maxlength="11"')+
   balances.map((b,i)=>input('balance'+i,(b.storeName||'公共库存')+' · 当前 '+b.quantity+' '+row.unit,'','type="number" min="1" max="2147483647" step="1"')).join('')+
   select('expenseId','引用已有支出','',[['','暂不关联'],...records.map(e=>[e.id,`${e.expenseDate} · ${e.description} · ${money(e.amountCents)}`])])+
   area('reason','采购依据（必填）')+'<p class="muted">总额按单价乘以分配数量合计计算。关联已有支出只保留来源。</p>';
  mount('包材采购入库',body,f=>{
   const expense=records.find(e=>e.id===f.get('expenseId'));
   const allocations=balances.flatMap((b,i)=>{const raw=f.get('balance'+i);return raw===''?[]:[{balanceId:b.id,quantity:Number(raw)}];});
   return api.savePackagingPurchase(id,{requestKey:key,purchaseDate:f.get('purchaseDate'),supplier:f.get('supplier'),unitPrice:f.get('unitPrice').trim(),
    reason:f.get('reason'),expenseId:expense?.id??null,expenseVersion:expense?.version??null,allocations},row.version);
  },{kind:'packaging-purchase',id},()=>api.packagingPurchaseReceipt(id,key));
 }
 async function scopedWarehouse(type,id){
  if(!['inbound','outbound'].includes(type))throw new ContractError();
  const {balance}=await api.scopedWarehouseDetail(id);
  if(!balance.canMove)throw new ContractError('该归属仅可查看。');
  const key=crypto.randomUUID();
  const body=`<p>${h(balance.name)} · ${h(balance.storeName||'公共库存')} · 当前 ${h(balance.quantity)} ${h(balance.unit)}</p>`+
   input('quantity','本次数量','','required type="number" min="1" max="2147483647" step="1"')+area('reason','原因（必填）');
  mount('登记'+movementLabels[type],body,f=>api.scopedWarehouseMove(id,{requestKey:key,type,quantity:Number(f.get('quantity')),reason:f.get('reason')},balance.version),
   {kind:'scoped-warehouse',id},()=>api.scopedWarehouseReceipt(id,key));
 }
 return {warehouse,scopedWarehouse,packagingPurchase,consumePackaging};
}
