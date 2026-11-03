import {ContractError,validDate} from './cloud-contract.mjs';
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('交接关联标识无效。');return v;};
const version=v=>{if(!Number.isSafeInteger(v)||v<1)throw new ContractError('设备或借用版本无效。');return v;};
export function handoverState(v,owner){
 if(!v||!v.equipment||v.equipment.id!==owner||typeof v.equipment.name!=='string'||typeof v.equipment.assetTag!=='string'||!['available','on_loan','maintenance','retired'].includes(v.equipment.status)||!Array.isArray(v.recipients))throw new ContractError('交接资料不完整。');version(v.equipment.version);
 for(const r of v.recipients){id(r.id);if(typeof r.displayName!=='string')throw new ContractError();}
 if(v.currentLoan!==null){id(v.currentLoan?.id);version(v.currentLoan.version);id(v.currentLoan.memberId);if(typeof v.currentLoan.borrowerName!=='string'||!Number.isFinite(Date.parse(v.currentLoan.borrowedAt)))throw new ContractError();}
 if((v.equipment.status==='on_loan')!==(v.currentLoan!==null))throw new ContractError('当前使用状态不一致。');return v;
}
export function handoverPayload(v){
 const keys=['requestKey','expectedVersion','previousLoanId','previousLoanVersion','toMemberId','occurredAt','condition','location','note'];
 if(!v||keys.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k)))throw new ContractError('请保留完整交接资料。');
 id(v.requestKey);version(v.expectedVersion);id(v.toMemberId);if(v.previousLoanId===null){if(v.previousLoanVersion!==null)throw new ContractError();}else{id(v.previousLoanId);version(v.previousLoanVersion);}
 if(typeof v.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|\+08:00)$/.test(v.occurredAt)||!validDate(v.occurredAt.slice(0,10))||!Number.isFinite(Date.parse(v.occurredAt)))throw new ContractError('请填写有效的交接时间。');
 for(const [key,max]of [['condition',500],['location',150],['note',2000]])if(typeof v[key]!=='string'||!v[key].trim()||v[key].trim().length>max)throw new ContractError('请填写设备状况、接收位置和交接说明。');
 return {...v,condition:v.condition.trim(),location:v.location.trim(),note:v.note.trim()};
}
export function handoverPage(v){
 if(!v||!Array.isArray(v.rows)||v.rows.length>50||!Number.isSafeInteger(v.total)||v.total<0||!Number.isSafeInteger(v.offset)||v.offset<0||v.limit!==50)throw new ContractError('交接记录不完整。');
 for(const r of v.rows){id(r.id);id(r.newLoanId);if(r.previousLoanId!==null)id(r.previousLoanId);if((r.previousLoanId===null)!==(r.fromName===null)||[r.toName,r.condition,r.note,r.actor].some(s=>typeof s!=='string')||!Number.isFinite(Date.parse(r.occurredAt))||!Number.isFinite(Date.parse(r.createdAt)))throw new ContractError();}return v;
}
