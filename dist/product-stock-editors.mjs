import {ContractError,chinaDate} from './cloud-contract.mjs';
export function createProductStockEditors({api,h,mount,input,area,select}){
 async function productStock(operation,firstBalanceId=null){
  if(!['inbound','shipment'].includes(operation))throw new ContractError();
  const first=await api.productStockOptions(),balances=[...first.rows];
  for(let offset=first.limit;offset<first.total;offset+=first.limit)balances.push(...(await api.productStockOptions(offset)).rows);
  const available=balances.filter(row=>operation==='inbound'||row.quantity>0),sources=new Map(available.map(row=>[row.id,row]));
  if(!available.length)throw new ContractError('当前授权范围内没有可登记的商品库存归属。');
  const key=crypto.randomUUID(),choices=[['','请选择商品与库存归属'],...available.map(row=>[row.id,`${row.skuCode} · ${row.name} · ${row.storeName||'公共库存'} · 当前 ${row.quantity} ${row.unit}`])];
  const stores=[['','请选择业务店铺'],...first.stores.map(row=>[row.id,row.name])];
  const line=(selected='')=>`<fieldset class="form-grid" data-product-stock-line><legend>商品明细</legend>
   ${select('balanceId','商品与库存归属',selected,choices)}${input('quantity','本次数量','','required type="number" min="1" max="2147483647" step="1"')}
   ${select('businessStoreId',operation==='shipment'?'发货店铺':'业务店铺（可留空）','',stores)}
   <button type="button" class="text-button" data-remove-product-stock-line>移除此项</button></fieldset>`;
  const body=input('businessDate',operation==='inbound'?'入库日期':'发货日期',chinaDate(),'required type="date"')+
   `<p class="muted">${operation==='inbound'?'逐项选择入库归属，数量以实际收货为准。':'逐项选择扣减来源；公共库存发货请填写实际业务店铺。'}</p><div data-product-stock-lines>${line(sources.has(firstBalanceId)?firstBalanceId:'')}</div><button type="button" class="secondary" data-add-product-stock-line>＋ 添加商品</button>`+
   input('sourceReference','来源参考（送货单号或发货批次）','','maxlength="200"')+area('reason','登记说明（必填）');
  mount(operation==='inbound'?'商品批量入库':'商品批量发货',body,f=>{
   const quantities=f.getAll('quantity'),businessStores=f.getAll('businessStoreId');
   const lines=f.getAll('balanceId').map((id,i)=>{
    const source=sources.get(id);if(!source)throw new ContractError('请为每一项选择商品与库存归属。');
    const businessStoreId=source.storeId??(businessStores[i]||null);
    if(operation==='shipment'&&!businessStoreId)throw new ContractError('公共库存发货须填写实际业务店铺。');
    return {balanceId:id,expectedVersion:source.version,quantity:Number(quantities[i]),businessStoreId};
   });
   return api.saveProductStockDocument({requestKey:key,operation,businessDate:f.get('businessDate'),sourceReference:f.get('sourceReference'),reason:f.get('reason'),lines});
  },{kind:'product-stock-document'},()=>api.productStockReceipt(key),form=>{
   const list=form.querySelector('[data-product-stock-lines]'),add=form.querySelector('[data-add-product-stock-line]');
   const sync=()=>{
    add.disabled=list.children.length>=100;
    for(const row of list.children){
     const source=row.querySelector('[name=balanceId]'),store=row.querySelector('[name=businessStoreId]'),publicStock=sources.get(source.value)?.storeId===null;
     source.required=true;store.required=operation==='shipment'&&publicStock;store.closest('label').hidden=!publicStock;
     row.querySelector('[data-remove-product-stock-line]').disabled=list.children.length===1;
    }
   };
   add.onclick=()=>{if(list.children.length>=100)return;list.insertAdjacentHTML('beforeend',line());form.dispatchEvent(new Event('change'));list.lastElementChild.querySelector('select').focus();};
   list.onclick=e=>{const button=e.target.closest('[data-remove-product-stock-line]');if(button&&list.children.length>1){button.closest('[data-product-stock-line]').remove();form.dispatchEvent(new Event('change'));}};
   form.addEventListener('change',sync);sync();
  });
 }
 return {productStock};
}
