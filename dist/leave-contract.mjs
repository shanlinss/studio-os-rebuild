import {ContractError,validDate} from './cloud-contract.mjs';
import {pagedRows} from './management-model.mjs';
import {attendanceId} from './attendance-contract.mjs';
export const leaveLabels={pending:'待审核',approved:'已批准',rejected:'已驳回',withdrawn:'已撤回',revoked:'批准已撤销'};
export const leaveActions={submitted:'提交申请',edited:'修改待审核申请',approved:'批准请假',rejected:'驳回申请',withdrawn:'本人撤回',revoked:'管理员撤销批准'};
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const version=v=>{if(!Number.isSafeInteger(v)||v<1)throw new ContractError('请重新读取记录版本。');return v;};
export function leaveRecord(r){if(!r||typeof r.status!=='string'||!Object.hasOwn(leaveLabels,r.status)||typeof r.leave_type!=='string'||!r.leave_type.trim()||typeof r.reason!=='string'||!stamp(r.starts_at)||!stamp(r.ends_at)||Date.parse(r.ends_at)<=Date.parse(r.starts_at))throw new ContractError('请假记录不完整。');attendanceId(r.id);version(r.version);return r;}
export function leavePage(v){pagedRows(v);if(v.limit!==50||v.rows.length>50||new Set(v.rows.map(r=>r.id)).size!==v.rows.length)throw new ContractError();v.rows.forEach(leaveRecord);return v;}
export function leaveHistory(v){pagedRows(v);if(v.limit!==50)throw new ContractError();for(const r of v.rows){if(!r||!Object.hasOwn(leaveActions,r.action)||typeof r.actor_name!=='string'||!stamp(r.created_at))throw new ContractError();leaveRecord(r.after_value);}return v;}
export function leavePayload(action,v,expected){
 const keys=action==='create'||action==='edit'?['requestKey','leaveType','startsAt','endsAt','reason']:action==='decision'?['requestKey','decision','note']:['withdraw','revoke'].includes(action)?['requestKey','note']:null;
 if(!keys||!v||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))throw new ContractError('请核对请假填写。');const out={requestKey:attendanceId(v.requestKey)};
 if(action==='create'||action==='edit'){
  if(typeof v.leaveType!=='string'||!v.leaveType.trim()||v.leaveType.trim().length>40||typeof v.reason!=='string'||!v.reason.trim()||v.reason.trim().length>2000)throw new ContractError('请填写类型和原因。');
  for(const k of ['startsAt','endsAt'])if(!stamp(v[k])||!/(Z|[+-]\d\d:\d\d)$/.test(v[k])||!validDate(v[k].slice(0,10)))throw new ContractError('请填写带时区的有效起止时间。');if(Date.parse(v.endsAt)<=Date.parse(v.startsAt))throw new ContractError('结束时间须晚于开始时间。');Object.assign(out,{leaveType:v.leaveType.trim(),startsAt:v.startsAt,endsAt:v.endsAt,reason:v.reason.trim()});
 }else{if(typeof v.note!=='string'||!v.note.trim()||v.note.trim().length>2000)throw new ContractError('请填写处理说明。');out.note=v.note.trim();if(action==='decision'){if(!['approved','rejected'].includes(v.decision))throw new ContractError();out.decision=v.decision;}}
 if(action!=='create')out.expectedVersion=version(expected);return out;
}
export function leavePath(action,id){if(action==='create')return '/api/attendance/leaves';attendanceId(id);if(!['edit','decision','withdraw','revoke'].includes(action))throw new ContractError();return '/api/attendance/leaves/'+id+(action==='edit'?'':'/'+action);}
