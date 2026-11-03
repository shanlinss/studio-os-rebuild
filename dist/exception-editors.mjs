import {hasSensitive} from './admin-permissions.mjs';
import {ContractError} from './cloud-contract.mjs';
import {exceptionKinds,exceptionOutcomes,exceptionIssues} from './exception-contract.mjs';
export function createExceptionEditors({api,h,mount,area,select}){
 async function exceptionReview(id,kind,reopen=false){
  if(!hasSensitive(await api.session(),'personnel'))throw new ContractError('由管理员核实，员工可查看本人记录。');const d=await api.exceptionDetail(id),r=d.rows.find(r=>r.kind===kind);if(!d.eligible||!r?.flag)throw new ContractError(exceptionIssues[d.issue]||'当前没有该项时间异常，请重新核对。');if(reopen&&!['confirmed','special'].includes(r.reviewStatus))throw new ContractError('该项已在待核实或待复核状态。');
  const p=d.period,key=crypto.randomUUID(),time=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(v));
  mount(reopen?'重新核实考勤异常':'记录异常核实',`<p>${h(p.work_date)} · ${h(exceptionKinds[kind])}</p><p>当前核准上班：${h(time(p.adjusted_in||p.original_in))}</p><p>当前核准下班：${h(time(p.adjusted_out||p.original_out))}</p><p>实际时长：${Math.floor(d.metrics.durationMinutes/60)} 小时 ${d.metrics.durationMinutes%60} 分钟</p>`+(reopen?'<p>本次追加“重新待核实”记录，原说明和历史继续保留。</p>':select('outcome','核实结论','',[['','请选择'],...['confirmed','special'].map(k=>[k,exceptionOutcomes[k]])]))+area('note','核实说明（必填）')+'<p class="muted">核实说明不修改打卡时间，不抹去迟到或不足时长的事实，也不自动计算扣款。</p>',f=>api.exceptionReview(id,{requestKey:key,expectedPeriodVersion:p.version,expectedReviewId:r.latest?.id||null,kind,outcome:reopen?'reopened':f.get('outcome'),note:f.get('note')}),{kind:'attendance'},()=>api.exceptionReceipt(key,id));
 }
 return {exceptionReview};
}
