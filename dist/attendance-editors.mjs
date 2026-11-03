import {hasSensitive} from './admin-permissions.mjs';
import {ContractError} from './cloud-contract.mjs';
import {beijingCorrectionInput,correctionTimestamp,approvalBlockers} from './attendance-contract.mjs';
export function createAttendanceEditors({api,h,mount,input,area,select}){
 const time=v=>v?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(v)):'未登记';
 const source=p=>p?`<p>原工作日：${h(p.work_date)}（北京时间）</p><p>原上班：${h(time(p.original_in))}；原下班：${h(time(p.original_out))}</p><p>当前核准上班：${h(time(p.adjusted_in||p.original_in))}；当前核准下班：${h(time(p.adjusted_out||p.original_out))}</p>`:'<p>该日没有原工作段时，先申请补上班；审核通过后，再从该日记录申请补下班。</p>';
 async function attendanceCorrection({id,periodId,direction='in'}={}){
  const user=await api.session();if(user.role!=='employee')throw new ContractError('员工本人发起补卡，管理员在申请中审核。');
  const detail=id?await api.attendanceDetail(id,true):periodId?await api.attendanceDetail(periodId):null,request=id?detail.record:null,period=detail?.period;
  if(request&&request.status!=='pending')throw new ContractError('仅待审核申请可以修改；已驳回请从原考勤记录重新申请。');
  const action=id?'edit':'create',key=crypto.randomUUID(),dir=request?.direction||direction;
  mount(id?'修改待审核补卡':'申请补卡',source(period)+(!id&&period?select('direction','补正方向',dir,[['in','上班'],['out','下班']]):`<p>补正：${dir==='in'?'上班':'下班'}</p>`)+input('proposedAt','实际发生时间（北京时间）',request?beijingCorrectionInput(request.proposed_at):'','required type="datetime-local" step="0.001"')+area('reason','补卡原因（必填）',request?.reason||'')+'<p class="muted">填写已发生的真实时间。原工作室记录的补正须在原工作日内，不自动推算缺失时间或工资。</p>',f=>{
   const v={requestKey:key,proposedAt:correctionTimestamp(f.get('proposedAt')),reason:f.get('reason')};if(!id){v.periodId=periodId||null;v.direction=period?f.get('direction'):dir;}return api.attendanceWrite(action,id,v,request?.version);
  },{kind:'attendance'},()=>api.attendanceReceipt(key,action,id));
 }
 async function attendanceDecision(id,decision){
  const user=await api.session();if(!hasSensitive(user,'personnel'))throw new ContractError('仅管理员可审核。');
  const d=await api.attendanceDetail(id,true),r=d.record;if(r.status!=='pending')throw new ContractError('该申请已处理，请重新读取。');
  if(decision==='approved'&&d.approvalBlocker)throw new ContractError(approvalBlockers[d.approvalBlocker]||'请先核对原记录。');
  if(decision==='approved'&&d.period&&d.period.version!==r.period_version)throw new ContractError('原考勤已经变化，请让员工重新核对并修改待审核申请；也可驳回并说明。');
  const key=crypto.randomUUID();mount(decision==='approved'?'批准补卡申请':'驳回补卡申请',`<p>${h(r.memberName)} · ${r.direction==='in'?'上班':'下班'}补卡</p><p>申请时间：${h(time(r.proposed_at))}</p><p class="preserve-text">申请原因：${h(r.reason)}</p>`+source(d.period)+area('note','审核说明（必填）')+'<p class="muted">批准仅写入核准时间，保留原始记录。审核和操作历史一起保存。</p>',f=>api.attendanceWrite('decision',id,{requestKey:key,decision,note:f.get('note')},r.version),{kind:'attendance'},()=>api.attendanceReceipt(key,'decision',id));
 }
 return {attendanceCorrection,attendanceDecision};
}
