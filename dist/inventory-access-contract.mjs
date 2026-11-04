import {ContractError} from './cloud-contract.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('库存授权标识无效。');return v;};
const version=v=>{if(!Number.isSafeInteger(v)||v<1)throw new ContractError('账号版本无效。');return v;};
function grant(g,full=false){
 if(!object(g)||!Object.hasOwn(g,'storeId')||typeof g.canMove!=='boolean')throw new ContractError('库存范围不完整。');
 const out={storeId:g.storeId===null?null:id(g.storeId),canMove:g.canMove};
 if(full){if(out.storeId===null?(g.storeName!==null||g.storeActive!==null):(typeof g.storeName!=='string'||typeof g.storeActive!=='boolean'))throw new ContractError('店铺范围资料不完整。');Object.assign(out,{storeName:g.storeName,storeActive:g.storeActive});}
 return out;
}
function grants(rows,full=false){if(!Array.isArray(rows)||rows.length>100)throw new ContractError('库存授权范围无效。');const out=rows.map(g=>grant(g,full));if(new Set(out.map(g=>g.storeId??'public')).size!==out.length)throw new ContractError('库存范围不能重复。');return out;}
export function inventoryAccessPayload(v,expected){
 if(!object(v)||Object.keys(v).some(k=>!['requestKey','grants','reason'].includes(k))||typeof v.reason!=='string'||!v.reason.trim()||v.reason.trim().length>2000)throw new ContractError('请核对库存范围并填写原因。');
 if(!Array.isArray(v.grants)||v.grants.some(g=>!object(g)||Object.keys(g).some(k=>!['storeId','canMove'].includes(k))))throw new ContractError('授权只能指定店铺范围与数量操作。');
 return {requestKey:id(v.requestKey),expectedVersion:version(expected),reason:v.reason.trim(),grants:grants(v.grants).sort((a,b)=>(a.storeId??'public').localeCompare(b.storeId??'public','en'))};
}
function snapshot(v){if(!object(v)||typeof v.username!=='string'||typeof v.active!=='boolean')throw new ContractError('库存授权资料不完整。');return {id:id(v.id),username:v.username,active:v.active,version:version(v.version),grants:grants(v.grants,true)};}
export function inventoryAccessState(v,owner){const out=snapshot(v);if(out.id!==owner||typeof v.quantityOperationsAvailable!=='boolean')throw new ContractError('库存授权状态不匹配。');return {...out,quantityOperationsAvailable:v.quantityOperationsAvailable};}
export function inventoryAccessMine(v){if(!object(v)||typeof v.canManageAll!=='boolean'||typeof v.quantityOperationsAvailable!=='boolean')throw new ContractError('库存授权状态不完整。');return {canManageAll:v.canManageAll,grants:grants(v.grants,true),quantityOperationsAvailable:v.quantityOperationsAvailable,...(v.productOperationsAvailable===true?{productOperationsAvailable:true}:{})};}
export function inventoryAccessResult(v,owner){if(!object(v)||v.id!==owner)throw new ContractError('库存授权回执不匹配。');return {id:id(v.id),version:version(v.version),eventId:id(v.eventId)};}
export function inventoryAccessHistory(v,owner){
 if(!object(v)||!Array.isArray(v.rows)||!Number.isSafeInteger(v.total)||v.total<0||!Number.isSafeInteger(v.offset)||v.offset<0||v.limit!==50||v.rows.length>50)throw new ContractError('库存授权记录不完整。');
 return {...v,rows:v.rows.map(r=>{if(!object(r)||typeof r.reason!=='string'||typeof r.actor!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw new ContractError('库存授权记录无效。');const before=snapshot(r.beforeValue),after=snapshot(r.afterValue);if(before.id!==owner||after.id!==owner)throw new ContractError('库存授权记录不匹配。');return {id:id(r.id),reason:r.reason,actor:r.actor,createdAt:r.createdAt,beforeValue:before,afterValue:after};})};
}
