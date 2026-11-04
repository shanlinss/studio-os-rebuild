import {ContractError,validDate} from './cloud-contract.mjs';
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
 if(v.balances!==undefined){
  if(v.kind!=='packaging'||!Array.isArray(v.balances)||v.packagingScoped!==(v.balances.length>0))throw new ContractError();
  for(const b of v.balances){id(b.id);if(b.storeId!==null){id(b.storeId);if(typeof b.storeName!=='string'||typeof b.storeActive!=='boolean')throw new ContractError();}qty(b.quantity);expectedVersion(b.version);}
  if(v.packagingScoped&&v.balances.reduce((sum,b)=>sum+b.quantity,0)!==v.quantity)throw new ContractError('包材分账与总量不一致，请重新读取。');
 }
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
 if(v.transferId!==undefined&&v.transferId!==null){id(v.transferId);id(v.targetSampleId);if(v.type!=='outbound'||!v.transferTargetSnapshot||typeof v.transferTargetSnapshot.name!=='string'||v.transferTargetSnapshot.id!==v.targetSampleId)throw new ContractError('转样品关联不完整。');}
 if(v.correctsMovementId!==null){id(v.correctsMovementId);if(v.type!=='stocktake')throw new ContractError();}return v;
}
export function warehouseHistory(v,events=false){page(v);if(events){for(const r of v.rows)if(!r||!['registered','edited'].includes(r.action)||typeof r.actor!=='string'||!Number.isFinite(Date.parse(r.createdAt))||!r.afterValue||typeof r.afterValue!=='object'||typeof r.afterValue.name!=='string'||typeof r.afterValue.location!=='string'||typeof r.afterValue.active!=='boolean')throw new ContractError();}else v.rows.forEach(warehouseMovement);return v;}
export function warehousePayload(action,value,version){
 if(action==='allocate-packaging'){
  if(!value||Object.keys(value).some(k=>!['requestKey','reason','allocations'].includes(k))||!Array.isArray(value.allocations)||!value.allocations.length||value.allocations.length>100)throw new ContractError('请填写 1 至 100 个归属数量。');
  const allocations=value.allocations.map(row=>({storeId:row.storeId===null?null:id(row.storeId),quantity:qty(row.quantity)}));
  if(new Set(allocations.map(row=>row.storeId)).size!==allocations.length)throw new ContractError('同一归属只能填写一次。');
  return {requestKey:id(value.requestKey),expectedVersion:expectedVersion(version),reason:text(value.reason,2000,true),allocations};
 }

 const keys=['register','edit'].includes(action)?['itemCode','kind','productId','name','specification','unit','location','notes',...(action==='edit'?['active']:[])]:action==='move'?['type','quantity','reason','sourceReference','correctsMovementId']:null;
 if(!keys||!value||Object.keys(value).some(k=>!['requestKey',...keys,...(action==='move'?['packagingBalanceId']:[])].includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new ContractError('请保留完整库存信息。');const out={requestKey:id(value.requestKey)};
 if(action==='move'){
  if(value.packagingBalanceId!==undefined)out.packagingBalanceId=id(value.packagingBalanceId);
  if(typeof value.type!=='string'||!Object.hasOwn(movementLabels,value.type))throw new ContractError();out.type=value.type;out.quantity=qty(value.quantity,['opening','stocktake'].includes(value.type));out.reason=text(value.reason,2000,true);out.sourceReference=text(value.sourceReference,200);out.correctsMovementId=value.correctsMovementId===null?null:id(value.correctsMovementId);if(out.correctsMovementId&&value.type!=='stocktake')throw new ContractError('纠错须记录新的盘点调整。');
 }else{
  if(typeof value.kind!=='string'||!Object.hasOwn(warehouseKinds,value.kind)||!warehouseUnits.includes(value.unit))throw new ContractError('请选择库存类型和整数基础单位。');out.itemCode=text(value.itemCode,64,true);out.kind=value.kind;out.productId=value.productId===null?null:id(value.productId);if((out.kind==='product'&&!out.productId)||(out.kind==='packaging'&&out.productId))throw new ContractError('产品库存须关联原产品，包材独立建档。');out.name=text(value.name,120,true);out.specification=text(value.specification,200);out.unit=value.unit;out.location=text(value.location,150,true);out.notes=text(value.notes,2000);if(action==='edit'){if(typeof value.active!=='boolean')throw new ContractError();out.active=value.active;}
 }if(action!=='register')out.expectedVersion=expectedVersion(version);return out;
}
export function warehousePath(action,owner){if(action==='register')return '/api/warehouse/items';id(owner);if(action==='edit')return '/api/warehouse/items/'+owner;if(action==='move')return '/api/warehouse/items/'+owner+'/movements';if(action==='allocate-packaging')return '/api/warehouse/items/'+owner+'/packaging-balances';if(action==='transfer')return '/api/warehouse/items/'+owner+'/to-samples';throw new ContractError();}

export function sampleTargetPage(v){
 page(v);for(const r of v.rows){id(r.id);id(r.productId);if(typeof r.name!=='string'||typeof r.warehouseLocation!=='string'||r.active!==true)throw new ContractError('目标样品资料不完整。');qty(r.availableQuantity);expectedVersion(r.version);if(r.sourceItemId!==null)id(r.sourceItemId);if(r.keeperMemberId!==null)id(r.keeperMemberId);}return v;
}
export function sampleTransferPayload(v,version){
 const keys=['requestKey','quantity','reason','sourceReference','confirmed','target'];if(!v||keys.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k))||v.confirmed!==true)throw new ContractError('请先核对规格和一件对一件的数量关系。');
 const target=v.target;if(!target||!['new','existing'].includes(target.mode))throw new ContractError('请选择样品目标。');
 const allowed=target.mode==='new'?['mode','name','warehouseLocation','keeperMemberId','notes']:['mode','sampleId','expectedVersion'];if(allowed.some(k=>!Object.hasOwn(target,k))||Object.keys(target).some(k=>!allowed.includes(k)))throw new ContractError('目标样品信息不完整。');
 const destination=target.mode==='new'?{mode:'new',name:text(target.name,120,true),warehouseLocation:text(target.warehouseLocation,150,true),keeperMemberId:target.keeperMemberId===null?null:id(target.keeperMemberId),notes:text(target.notes,2000)}:{mode:'existing',sampleId:id(target.sampleId),expectedVersion:expectedVersion(target.expectedVersion)};
 return {requestKey:id(v.requestKey),quantity:qty(v.quantity,false),reason:text(v.reason,2000,true),sourceReference:text(v.sourceReference,200),confirmed:true,target:destination,expectedVersion:expectedVersion(version)};
}
export function sampleTransferRecord(r){
 if(!r||typeof r.reason!=='string'||!r.reason.trim()||typeof r.sourceReference!=='string'||typeof r.actor!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw new ContractError('转样品记录不完整。');for(const key of ['id','itemId','sampleId','movementId','sampleEventId'])id(r[key]);
 qty(r.quantity,false);for(const key of ['sourceBefore','sourceAfter','targetBefore','targetAfter'])qty(r[key]);
 if(r.sourceBefore-r.sourceAfter!==r.quantity||r.targetAfter-r.targetBefore!==r.quantity)throw new ContractError('转样品双方数量不一致。');
 if(!r.sourceSnapshot||typeof r.sourceSnapshot.name!=='string'||typeof r.sourceSnapshot.itemCode!=='string'||typeof r.sourceSnapshot.specification!=='string'||!['件','个'].includes(r.sourceSnapshot.unit)||!r.targetSnapshot||typeof r.targetSnapshot.name!=='string'||r.targetSnapshot.id!==r.sampleId||r.targetSnapshot.unit!=='件')throw new ContractError('转样品来源或目标快照不完整。');return r;
}
export function sampleTransferPage(v){page(v);v.rows.forEach(sampleTransferRecord);return v;}

function scopedBalance(v){
 if(!v||typeof v.canMove!=='boolean'||typeof v.name!=='string'||typeof v.itemCode!=='string'||typeof v.specification!=='string'||typeof v.location!=='string'||!warehouseUnits.includes(v.unit))throw new ContractError('包材库存资料不完整。');
 id(v.id);qty(v.quantity);expectedVersion(v.version);
 if(v.storeId===null){if(v.storeName!==null)throw new ContractError();}else{id(v.storeId);if(typeof v.storeName!=='string')throw new ContractError();}
 return v;
}
export function scopedWarehouseCatalog(v){page(v);v.rows.forEach(scopedBalance);return v;}
export function scopedWarehouseDetail(v,owner){
 page(v);if(scopedBalance(v.balance).id!==owner)throw new ContractError();
 for(const row of v.rows){
  id(row.id);qty(row.afterQuantity);if(row.beforeQuantity!==null)qty(row.beforeQuantity);
  if(!Object.hasOwn(movementLabels,row.type)||row.delta!==row.afterQuantity-(row.beforeQuantity??0)||!Number.isFinite(Date.parse(row.createdAt)))throw new ContractError('包材流水不完整。');
 }
 return v;
}
export function scopedWarehousePayload(v,version){
 if(!v||Object.keys(v).some(k=>!['requestKey','type','quantity','reason'].includes(k))||!['inbound','outbound'].includes(v.type))throw new ContractError('仅可登记入库或出库。');
 return {requestKey:id(v.requestKey),expectedVersion:expectedVersion(version),type:v.type,quantity:qty(v.quantity,false),reason:text(v.reason,2000,true)};
}

export function packagingPurchasePayload(v,version){
 if(!v||Object.keys(v).some(k=>!['requestKey','purchaseDate','supplier','unitPrice','expenseId','expenseVersion','reason','allocations'].includes(k))||!validDate(v.purchaseDate)||
   typeof v.unitPrice!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(v.unitPrice)||!Array.isArray(v.allocations)||!v.allocations.length||v.allocations.length>100)
  throw new ContractError('请核对采购日期、单价和分配数量。');
 const allocations=v.allocations.map(line=>({balanceId:id(line.balanceId),quantity:qty(line.quantity,false)}));
 if(new Set(allocations.map(line=>line.balanceId)).size!==allocations.length)throw new ContractError('分配归属不能重复。');
 if(v.expenseId===null&&v.expenseVersion!==null)throw new ContractError();
 return {requestKey:id(v.requestKey),expectedVersion:expectedVersion(version),purchaseDate:v.purchaseDate,supplier:text(v.supplier,150,true),
  unitPrice:v.unitPrice,expenseId:v.expenseId===null?null:id(v.expenseId),expenseVersion:v.expenseId===null?null:expectedVersion(v.expenseVersion),reason:text(v.reason,2000,true),allocations};
}
export function packagingPurchaseHistory(v){
 page(v);
 for(const row of v.rows){
  id(row.id);qty(row.quantity,false);qty(row.unitCents);qty(row.totalCents);
  if(!validDate(row.purchaseDate)||row.totalCents!==row.quantity*row.unitCents||typeof row.supplier!=='string'||
     typeof row.reason!=='string'||typeof row.actor!=='string'||typeof row.sourceChanged!=='boolean'||!Number.isFinite(Date.parse(row.createdAt))||
     !Array.isArray(row.allocations)||!row.allocations.length)throw new ContractError('采购记录不完整。');
  for(const line of row.allocations){id(line.id);qty(line.quantity,false);if(line.storeName!==null&&typeof line.storeName!=='string')throw new ContractError();}
  if(row.allocations.reduce((sum,line)=>sum+line.quantity,0)!==row.quantity)throw new ContractError('采购分配与合计不一致。');
  if(row.expenseSnapshot!==null){id(row.expenseSnapshot.id);qty(row.expenseSnapshot.amountCents);if(typeof row.expenseSnapshot.description!=='string')throw new ContractError();}
 }
 return v;
}

export function consumptionOptions(v){
 scopedWarehouseCatalog(v);
 if(!Array.isArray(v.stores)||v.stores.some(s=>!s||typeof s.name!=='string'))throw new ContractError();
 v.stores.forEach(s=>id(s.id));
 return v;
}
export function consumptionPayload(v){
 if(!v||Object.keys(v).some(k=>!['requestKey','reason','lines'].includes(k))||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)
  throw new ContractError('请填写 1 至 100 项领用。');
 const lines=v.lines.map(line=>({balanceId:id(line.balanceId),expectedVersion:expectedVersion(line.expectedVersion),
  quantity:qty(line.quantity,false),usedStoreId:line.usedStoreId===null?null:id(line.usedStoreId)}));
 if(new Set(lines.map(line=>line.balanceId)).size!==lines.length)throw new ContractError('同一库存来源在一张单据中只能填写一次。');
 return {requestKey:id(v.requestKey),reason:text(v.reason,2000,true),lines};
}
export function consumptionDetail(v,owner){
 if(!v||v.id!==owner||typeof v.reason!=='string'||typeof v.actor!=='string'||!Number.isFinite(Date.parse(v.createdAt))||
    !Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)throw new ContractError('包材领用记录不完整。');
 for(const line of v.lines){
  id(line.id);id(line.balanceId);qty(line.quantity,false);qty(line.beforeQuantity);qty(line.afterQuantity);
  if(line.beforeQuantity-line.afterQuantity!==line.quantity||!line.snapshot||typeof line.snapshot.name!=='string'||
   typeof line.snapshot.itemCode!=='string'||typeof line.snapshot.usedStoreName!=='string'||!warehouseUnits.includes(line.snapshot.unit))throw new ContractError('包材领用明细不完整。');
 }
 return v;
}
