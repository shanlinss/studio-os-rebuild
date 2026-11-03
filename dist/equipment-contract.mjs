import {ContractError} from './cloud-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
import {pagedRows} from './management-model.mjs';
export const equipmentLabels={available:'可借用',on_loan:'借用中',maintenance:'待维修',retired:'已停用'};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('设备关联标识无效。');return v;};
const text=(v,n,required=false)=>{if(typeof v!=='string'||v.length>n||(required&&!v.trim()))throw new ContractError('请核对设备名称、位置与说明。');return v.trim();};
export function equipmentRecord(r){
 if(!r||typeof r.assetTag!=='string'||typeof r.name!=='string'||typeof r.model!=='string'||typeof r.location!=='string'||!Object.hasOwn(equipmentLabels,r.status))throw new ContractError('设备资料不完整。');id(r.id);for(const k of ['deviceType','brand','serialNumber'])if(Object.hasOwn(r,k)&&typeof r[k]!=='string')throw new ContractError();if(r.imageId!==undefined&&r.imageId!==null)id(r.imageId);if(Object.hasOwn(r,'image')&&r.image!==null){id(r.image?.id);if(typeof r.image.name!=='string'||!['image/png','image/jpeg','image/gif','image/webp'].includes(r.image.mime)||!Number.isSafeInteger(r.image.size)||r.image.size<1||r.image.size>8388608||(r.imageId!==undefined&&r.image.id!==r.imageId))throw new ContractError();}expectedVersion(r.version);if(r.keeperMemberId)id(r.keeperMemberId);return r;
}
export function equipmentPage(value,loans=false){
 pagedRows(value);if(value.limit!==50||value.rows.length>50||(value.rows.length&&value.offset+value.rows.length>value.total))throw new ContractError();const seen=new Set();
 for(const r of value.rows){id(r.id);if(seen.has(r.id))throw new ContractError();seen.add(r.id);
  if(!loans)equipmentRecord(r);
  else{expectedVersion(r.version);id(r.equipmentId);id(r.ownerId);if(typeof r.name!=='string'||typeof r.assetTag!=='string'||typeof r.location!=='string'||typeof r.returnLocation!=='string'||!Number.isFinite(Date.parse(r.borrowedAt)))throw new ContractError();if(r.returnedAt!==null&&(!Number.isFinite(Date.parse(r.returnedAt))||!['ok','issue','handover'].includes(r.returnCondition)))throw new ContractError();if(r.returnedAt===null&&r.returnCondition!==null)throw new ContractError();if(r.shootingRequestId)id(r.shootingRequestId);}
 }return value;
}
export function equipmentPayload(action,value,version){
 const keys={register:['assetTag','name','model','keeperMemberId','location','notes'],edit:['assetTag','name','model','keeperMemberId','location','notes'],borrow:['location','shootingRequestId','note'],return:['condition','note'],relocate:['location','note'],state:['action','note']}[action];
 if(!keys||!value||Object.keys(value).some(k=>!['requestKey',...keys,...(['register','edit'].includes(action)?['deviceType','brand','serialNumber']:[])].includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new ContractError('请保留完整设备信息。');
 const out={requestKey:id(value.requestKey)};
 if(['register','edit'].includes(action)){out.assetTag=text(value.assetTag,64,true);out.name=text(value.name,120,true);out.model=text(value.model,200);out.keeperMemberId=value.keeperMemberId===null?null:id(value.keeperMemberId);out.location=text(value.location,150,true);out.notes=text(value.notes,2000);for(const [k,max] of [['deviceType',80],['brand',100],['serialNumber',150]])if(Object.hasOwn(value,k))out[k]=text(value[k],max);}
 else{out.note=text(value.note,2000);if(['borrow','relocate'].includes(action))out.location=text(value.location,150,true);if(action==='borrow')out.shootingRequestId=value.shootingRequestId===null?null:id(value.shootingRequestId);if(action==='return'){if(!['ok','issue'].includes(value.condition)||(value.condition==='issue'&&!out.note))throw new ContractError('异常归还需要说明问题。');out.condition=value.condition;}if(action==='state'){if(!['maintenance','ready','retired'].includes(value.action)||!out.note)throw new ContractError('请选择操作并填写原因。');out.action=value.action;}}
 if(action!=='register')out.expectedVersion=expectedVersion(version);return out;
}
export function equipmentPath(action,owner){
 if(action==='register')return '/api/equipment/catalog';id(owner);
 if(action==='image')return '/api/equipment/catalog/'+owner+'/image';
 if(action==='handover')return '/api/equipment/catalog/'+owner+'/handover';
 if(action==='edit')return '/api/equipment/catalog/'+owner;
 if(['borrow','state'].includes(action))return '/api/equipment/catalog/'+owner+'/'+action;
 if(action==='return')return '/api/equipment/loans/'+owner+'/return';
 if(action==='relocate')return '/api/equipment/loans/'+owner+'/location';throw new ContractError();
}
