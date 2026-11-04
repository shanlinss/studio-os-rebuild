import {ContractError} from './cloud-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
import {warehouseUnits} from './warehouse-contract.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('商品关联标识无效。');return v;};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new ContractError('请核对商品编号、规格和说明。');return v.trim();};
function formal(v,owner){
 if(!object(v)||v.productId!==owner||!Array.isArray(v.skus)||!Array.isArray(v.mappings))throw new ContractError('正式商品资料不完整。');
 text(v.code,64,true);expectedVersion(v.version);
 for(const sku of v.skus){id(sku.id);text(sku.code,64,true);text(sku.specification,200);if(!warehouseUnits.includes(sku.unit)||typeof sku.active!=='boolean')throw new ContractError();if(sku.warehouseItemId!==null)id(sku.warehouseItemId);}
 for(const m of v.mappings){id(m.skuId);id(m.storeId);text(m.storeName,100,true);text(m.platformProductId,100,true);text(m.platformSkuId,100,true);if(typeof m.active!=='boolean'||typeof m.storeActive!=='boolean')throw new ContractError();}
 return v;
}
export function commercialState(v,owner){
 if(!object(v)||v.product?.id!==owner||typeof v.product.name!=='string'||typeof v.product.active!=='boolean'||!Array.isArray(v.stock))throw new ContractError('商品资料不完整。');
 if(v.formal!==null)formal(v.formal,owner);
 for(const stock of v.stock){id(stock.id);text(stock.itemCode,64,true);text(stock.specification,200);if(!warehouseUnits.includes(stock.unit)||typeof stock.active!=='boolean')throw new ContractError();}
 return v;
}
export function commercialPayload(action,v,expected){
 const keys={formal:['code'],sku:['id','code','specification','unit','active','warehouseItemId'],mapping:['skuId','storeId','platformProductId','platformSkuId','listingUrl','active']}[action];
 if(!keys||!object(v)||Object.keys(v).some(k=>!['requestKey','reason',...keys].includes(k))||keys.some(k=>!Object.hasOwn(v,k)))throw new ContractError();
 if(!Number.isSafeInteger(expected)||expected<0)throw new ContractError();
 const out={requestKey:id(v.requestKey),expectedVersion:expected,reason:text(v.reason,2000,true)};
 if(action==='formal')return {...out,code:text(v.code,64,true)};
 if(typeof v.active!=='boolean')throw new ContractError();
 if(action==='sku'){
  if(!warehouseUnits.includes(v.unit))throw new ContractError();
  return {...out,id:v.id===null?null:id(v.id),code:text(v.code,64,true),specification:text(v.specification,200),unit:v.unit,active:v.active,warehouseItemId:v.warehouseItemId===null?null:id(v.warehouseItemId)};
 }
 let url=null;
 if(v.listingUrl){try{url=new URL(v.listingUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error();}catch{throw new ContractError('请填写有效的 HTTPS 商品链接。');}}
 return {...out,skuId:id(v.skuId),storeId:id(v.storeId),platformProductId:text(v.platformProductId,100,true),platformSkuId:text(v.platformSkuId,100,true),listingUrl:url?.href??null,active:v.active};
}
export function commercialHistory(v,owner){
 if(!object(v)||!Array.isArray(v.rows)||v.limit!==50||!Number.isSafeInteger(v.total)||!Number.isSafeInteger(v.offset)||v.total<0||v.offset<0)throw new ContractError();
 for(const row of v.rows){id(row.id);formal(row.afterValue,owner);if(row.beforeValue!==null)formal(row.beforeValue,owner);if(typeof row.reason!=='string'||typeof row.actor!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw new ContractError();}
 return v;
}
