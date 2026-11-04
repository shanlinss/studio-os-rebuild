import {ContractError} from './cloud-contract.mjs';
import {warehouseUnits} from './warehouse-contract.mjs';
export function createCommercialProductEditors({api,h,mount,input,area,select}){
 async function commercialProduct(action,id,skuId=null,storeId=null){
  const {product,formal,stock}=await api.commercialProduct(id),key=crypto.randomUUID();
  if(!product.active)throw new ContractError('原产品已停用。');
  const sku=skuId?formal?.skus.find(s=>s.id===skuId):null;
  if(skuId&&!sku)throw new ContractError('原 SKU 已变化，请重新读取。');
  const mapping=storeId?formal?.mappings.find(m=>m.skuId===skuId&&m.storeId===storeId):null;
  let body='',options=[];
  if(action==='formal'){
   if(formal)throw new ContractError('已登记正式商品。');
   body=input('code','正式商品编号','','required maxlength="64"');
  }else if(action==='sku'){
   options=[['','暂不关联'],...stock.filter(w=>w.id===sku?.warehouseItemId||(w.active&&!w.skuId)).map(w=>[w.id,`${w.itemCode} · ${w.specification||'默认规格'} · ${w.unit}`])];
   body=input('code','SKU 编号',sku?.code,'required maxlength="64"'+(sku?' readonly':''))+
    input('specification','规格',sku?.specification,'maxlength="200"'+(sku?.warehouseItemId?' readonly':''))+
    (sku?.warehouseItemId?input('unit','基础单位',sku.unit,'readonly'):select('unit','基础单位',sku?.unit||'件',warehouseUnits.map(u=>[u,u])))+
    (sku?.warehouseItemId?`<p>关联原库存 ${h(stock.find(w=>w.id===sku.warehouseItemId)?.itemCode||'')}</p><input type="hidden" name="warehouseItemId" value="${h(sku.warehouseItemId)}">`:select('warehouseItemId','关联已有库存','',options))+
    select('active','使用状态',String(sku?.active??true),[['true','启用'],['false','停用']]);
  }else if(action==='mapping'&&sku){
   const stores=await api.stores();
   options=stores.filter(s=>s.id===storeId||s.active).map(s=>[s.id,s.name]);
   body=mapping?`<p>${h(mapping.storeName)}</p>`:select('storeId','店铺','',[['','请选择'],...options]);
   body+=input('platformProductId','店铺商品 ID',mapping?.platformProductId,'required maxlength="100"')+
    input('platformSkuId','店铺 SKU ID',mapping?.platformSkuId,'required maxlength="100"')+
    input('listingUrl','店铺商品链接',mapping?.listingUrl,'type="url"')+
    select('active','映射状态',String(mapping?.active??true),[['true','启用'],['false','停用']]);
  }else throw new ContractError();
  mount({formal:'登记正式商品',sku:sku?'编辑 SKU':'新增 SKU',mapping:'店铺商品映射'}[action],`<p>${h(product.name)}</p>`+body+area('reason','本次变更原因（必填）'),f=>{
   let value;
   if(action==='formal')value={code:f.get('code')};
   else if(action==='sku')value={id:sku?.id??null,code:f.get('code'),specification:f.get('specification'),unit:f.get('unit'),active:f.get('active')==='true',warehouseItemId:f.get('warehouseItemId')||null};
   else value={skuId,storeId:storeId||f.get('storeId'),platformProductId:f.get('platformProductId'),platformSkuId:f.get('platformSkuId'),listingUrl:f.get('listingUrl')||null,active:f.get('active')==='true'};
   return api.saveCommercialProduct(id,action,{...value,requestKey:key,reason:f.get('reason')},formal?.version??0);
  },{kind:'commercial-product',id},()=>api.commercialProductReceipt(id,key,action),form=>{
   if(action!=='sku'||sku?.warehouseItemId)return;
   const field=form.elements.warehouseItemId;
   field.onchange=()=>{
    const item=stock.find(w=>w.id===field.value);
    if(item){form.elements.specification.value=item.specification;form.elements.unit.value=item.unit;}
   };
  });
 }
 return {commercialProduct};
}
