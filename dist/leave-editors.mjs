import {ContractError} from './cloud-contract.mjs';
import {beijingCorrectionInput,correctionTimestamp} from './attendance-contract.mjs';
export function createLeaveEditors({api,h,mount,input,area}){
 async function leaveRequest(id){
  const user=await api.session();if(user.role!=='employee')throw new ContractError('请假由员工本人发起。');const row=id?await api.leaveDetail(id):null;if(row&&row.status!=='pending')throw new ContractError('仅待审核申请可以修改。');const key=crypto.randomUUID(),action=id?'edit':'create';
  mount(id?'修改请假申请':'申请请假',input('leaveType','请假类型',row?.leave_type||'','required maxlength="40" list="leave-type-suggestions"')+'<datalist id="leave-type-suggestions"><option value="事假"><option value="病假"><option value="年假"><option value="其他"></datalist>'+input('startsAt','开始时间（北京时间）',row?beijingCorrectionInput(row.starts_at):'','required type="datetime-local" step="0.001"')+input('endsAt','结束时间（北京时间）',row?beijingCorrectionInput(row.ends_at):'','required type="datetime-local" step="0.001"')+area('reason','请假原因（必填）',row?.reason||'')+'<p class="muted">可填写实际请假类型。同一员工的待审核或已批准时间段不能重叠；暂不折算出勤天数或工资。</p>',f=>api.leaveWrite(action,id,{requestKey:key,leaveType:f.get('leaveType'),startsAt:correctionTimestamp(f.get('startsAt')),endsAt:correctionTimestamp(f.get('endsAt')),reason:f.get('reason')},row?.version),{kind:'attendance'},()=>api.leaveReceipt(key,action,id));
 }
 async function leaveAction(id,action,decision){
  const user=await api.session(),row=await api.leaveDetail(id);if(action==='withdraw'?user.role!=='employee':user.role!=='admin')throw new ContractError('当前身份不能处理此申请。');if(action==='revoke'?row.status!=='approved':row.status!=='pending')throw new ContractError('申请状态已变化，请重新读取。');
  const label=action==='withdraw'?'撤回请假申请':action==='revoke'?'撤销已批准请假':decision==='approved'?'批准请假':'驳回请假',key=crypto.randomUUID();
  const fmt=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(v));
  mount(label,`<p>${h(row.memberName||'本人')} · ${h(row.leave_type)}</p><p>${h(fmt(row.starts_at))} — ${h(fmt(row.ends_at))}（北京时间）</p><p class="preserve-text">申请原因：${h(row.reason)}</p>`+area('note','处理说明（必填）')+'<p class="muted">处理结果和原因保留历史，不改写原打卡记录或自动扣款。</p>',f=>api.leaveWrite(action,id,{requestKey:key,note:f.get('note'),...(action==='decision'?{decision}:{})},row.version),{kind:'attendance',submitLabel:'确认'+label},()=>api.leaveReceipt(key,action,id));
 }
 return {leaveRequest,leaveAction};
}
