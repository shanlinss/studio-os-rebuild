import {ContractError} from './cloud-contract.mjs';
import {pagedRows} from './management-model.mjs';
const max=2147483647;
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('样品关联标识无效。');return v;};
const text=(v,n,required=false)=>{if(typeof v!=='string'||v.length>n||(required&&!v.trim()))throw new ContractError('请核对名称、位置和说明。');return v.trim();};
const qty=(v,zero=false)=>{if(!Number.isSafeInteger(v)||v<(zero?0:1)||v>max)throw new ContractError('数量须为有效整数件数。');return v;};
export function sampleState(v){
 if(!v||typeof v.canBorrow!=='boolean'||!Array.isArray(v.shooting)||v.shooting.some(s=>!s||typeof s.title!=='string')||(v.member!==null&&(!v.member||typeof v.member.displayName!=='string')))throw new ContractError();
 v.shooting.forEach(s=>id(s.id));if(v.member)id(v.member.id);return v;
}
export function samplePage(v,loans=false){
 pagedRows(v);if(v.limit!==50||v.rows.length>50||v.offset+v.rows.length>v.total&&v.rows.length)throw new ContractError();
 const seen=new Set();for(const r of v.rows){id(r.id);if(seen.has(r.id))throw new ContractError();seen.add(r.id);qty(r.version);
  if(loans){id(r.sample_id);id(r.owner_id);qty(r.quantity);qty(r.returned_quantity,true);if(r.returned_quantity>r.quantity||typeof r.sampleName!=='string'||typeof r.location!=='string')throw new ContractError();if(r.shooting_request_id)id(r.shooting_request_id);}
  else{qty(r.available_quantity,true);if(typeof r.name!=='string'||typeof r.active!=='boolean'||typeof r.warehouse_location!=='string')throw new ContractError();}
 }return v;
}
export function samplePayload(action,value,version){
 const keys={register:['name','warehouseLocation','productId','keeperMemberId','notes'],stock:['quantity','note'],borrow:['quantity','location','shootingRequestId','note'],return:['quantity','note'],relocate:['location','note']}[action];
 if(!keys||!value||Object.keys(value).some(k=>!['requestKey',...keys].includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new ContractError('样品填写信息不完整。');
 const out={requestKey:id(value.requestKey)};
 if(action==='register'){out.name=text(value.name,120,true);out.warehouseLocation=text(value.warehouseLocation,150,true);out.productId=value.productId===null?null:id(value.productId);out.keeperMemberId=value.keeperMemberId===null?null:id(value.keeperMemberId);out.notes=text(value.notes,2000);}
 else{out.note=text(value.note,2000);if(action!=='relocate')out.quantity=qty(value.quantity);if(['borrow','relocate'].includes(action))out.location=text(value.location,150,true);if(action==='borrow')out.shootingRequestId=value.shootingRequestId===null?null:id(value.shootingRequestId);}
 if(['stock','return','relocate'].includes(action))out.expectedVersion=qty(version);return out;
}
export function sampleOperationPath(action,owner){
 if(action==='register')return '/api/samples/catalog';id(owner);
 if(action==='stock')return '/api/samples/catalog/'+owner+'/stock-in';
 if(action==='borrow')return '/api/samples/catalog/'+owner+'/borrow';
 if(action==='return')return '/api/samples/loans/'+owner+'/return';
 if(action==='relocate')return '/api/samples/loans/'+owner+'/location';
 throw new ContractError();
}
