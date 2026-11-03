import {ContractError} from './cloud-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
import {pagedRows} from './management-model.mjs';
export const warehouseUnits=['件','个','套','包','卷','箱'];
export const warehouseKinds={product:'产品',packaging:'包材'};
export const movementLabels={opening:'登记期初',inbound:'入库',outbound:'出库',stocktake:'盘点调整'};
const MAX=2147483647;
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('库存关联标识无效。');return v;};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new ContractError('请核对编码、名称和说明。');return v.trim();};
const qty=(v,zero=true)=>{if(!Number.isSafeInteger(v)||v<(zero?0:1)||v>MAX)throw new ContractError('数量须为有效整数。');return v;};
const page=v=>{pagedRows(v);if(v.rows.some(r=>!r||typeof r!=='object'||typeof r.id!=='string')||v.limit!==50||v.rows.length>50||(v.rows.length&&v.offset+v.rows.length>v.total)||new Set(v.rows.map(r=>r.id)).size!==v.rows.length)throw new ContractError();return v;};
export function warehouseItem(v){
 if(!v||typeof v.kind!=='string'||!Object.hasOwn(warehouseKinds,v.kind)||!warehouseUnits.includes(v.unit)||typeof v.itemCode!=='string'||typeof v.name!=='string'||typeof v.specification!=='string'||typeof v.location!=='string'||typeof v.notes!=='string'||typeof v.active!=='boolean'||typeof v.openingConfirmed!=='boolean')throw new ContractError('库存资料不完整。');
 id(v.id);expectedVersion(v.version);if(v.kind==='product')id(v.productId);else if(v.productId!==null)throw new ContractError();
 if(v.openingConfirmed)qty(v.quantity);else if(v.quantity!==null)throw new ContractError('未登记期初不能作为零库存展示。');return v;
}
export function warehouseCatalog(v){
 page(v);v.rows.forEach(warehouseItem);if(!Array.isArray(v.summary))throw new ContractError();const seen=new Set();let count=0;
 for(const r of v.summary){if(typeof r.kind!=='string'||!Object.hasOwn(warehouseKinds,r.kind)||!warehouseUnits.includes(r.unit)||typeof r.quantity!=='string'||!/^\d+$/.test(r.quantity)||!Number.isSafeInteger(r.initializedCount)||r.initializedCount<0||!Number.isSafeInteger(r.pendingCount)||r.pendingCount<0||r.initializedCount+r.pendingCount===0||(r.initializedCount===0&&BigInt(r.quantity)!==0n)||seen.has(r.kind+':'+r.unit))throw new ContractError('库存汇总不可用。');seen.add(r.kind+':'+r.unit);count+=r.initializedCount+r.pendingCount;}
 if(count!==v.total)throw new ContractError('库存汇总范围与列表不一致。');return v;
}
export function warehouseMovement(v){
 if(!v||typeof v.type!=='string'||!Object.hasOwn(movementLabels,v.type)||typeof v.reason!=='string'||!v.reason.trim()||typeof v.sourceReference!=='string'||typeof v.actor!=='string'||!Number.isFinite(Date.parse(v.createdAt))||!v.itemSnapshot||!warehouseUnits.includes(v.itemSnapshot.unit)||typeof v.itemSnapshot.name!=='string'||typeof v.itemSnapshot.itemCode!=='string')throw new ContractError('库存流水资料不完整。');
 id(v.id);id(v.itemId);qty(v.quantity,['opening','stocktake'].includes(v.type));qty(v.afterQuantity);if(!Number.isSafeInteger(v.delta)||Math.abs(v.delta)>MAX)throw new ContractError();
 if(v.type==='opening'){if(v.beforeQuantity!==null||v.afterQuantity!==v.quantity||v.delta!==v.quantity)throw new ContractError();}
 else{qty(v.beforeQuantity);if(v.afterQuantity-v.beforeQuantity!==v.delta||(v.type==='inbound'&&v.delta!==v.quantity)||(v.type==='outbound'&&v.delta!==-v.quantity)||(v.type==='stocktake'&&v.afterQuantity!==v.quantity))throw new ContractError();}
 if(v.correctsMovementId!==null){id(v.correctsMovementId);if(v.type!=='stocktake')throw new ContractError();}return v;
}
export function warehouseHistory(v,events=false){page(v);if(events){for(const r of v.rows)if(!r||!['registered','edited'].includes(r.action)||typeof r.actor!=='string'||!Number.isFinite(Date.parse(r.createdAt))||!r.afterValue||typeof r.afterValue!=='object'||typeof r.afterValue.name!=='string'||typeof r.afterValue.location!=='string'||typeof r.afterValue.active!=='boolean')throw new ContractError();}else v.rows.forEach(warehouseMovement);return v;}
export function warehousePayload(action,value,version){
 const keys=['register','edit'].includes(action)?['itemCode','kind','productId','name','specification','unit','location','notes',...(action==='edit'?['active']:[])]:action==='move'?['type','quantity','reason','sourceReference','correctsMovementId']:null;
 if(!keys||!value||Object.keys(value).some(k=>!['requestKey',...keys].includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new ContractError('请保留完整库存信息。');const out={requestKey:id(value.requestKey)};
 if(action==='move'){
  if(typeof value.type!=='string'||!Object.hasOwn(movementLabels,value.type))throw new ContractError();out.type=value.type;out.quantity=qty(value.quantity,['opening','stocktake'].includes(value.type));out.reason=text(value.reason,2000,true);out.sourceReference=text(value.sourceReference,200);out.correctsMovementId=value.correctsMovementId===null?null:id(value.correctsMovementId);if(out.correctsMovementId&&value.type!=='stocktake')throw new ContractError('纠错须记录新的盘点调整。');
 }else{
  if(typeof value.kind!=='string'||!Object.hasOwn(warehouseKinds,value.kind)||!warehouseUnits.includes(value.unit))throw new ContractError('请选择库存类型和整数基础单位。');out.itemCode=text(value.itemCode,64,true);out.kind=value.kind;out.productId=value.productId===null?null:id(value.productId);if((out.kind==='product'&&!out.productId)||(out.kind==='packaging'&&out.productId))throw new ContractError('产品库存须关联原产品，包材独立建档。');out.name=text(value.name,120,true);out.specification=text(value.specification,200);out.unit=value.unit;out.location=text(value.location,150,true);out.notes=text(value.notes,2000);if(action==='edit'){if(typeof value.active!=='boolean')throw new ContractError();out.active=value.active;}
 }if(action!=='register')out.expectedVersion=expectedVersion(version);return out;
}
export function warehousePath(action,owner){if(action==='register')return '/api/warehouse/items';id(owner);if(action==='edit')return '/api/warehouse/items/'+owner;if(action==='move')return '/api/warehouse/items/'+owner+'/movements';throw new ContractError();}
