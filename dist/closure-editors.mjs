import {ContractError} from './cloud-contract.mjs';
import {closureBlockers} from './closure-contract.mjs';
import {monthlyStates} from './monthly-contract.mjs';
export function createClosureEditors({api,h,mount,area}){
 return {async closureAction(month,memberId,action){
  if((await api.session()).role!=='admin')throw new ContractError('考勤月份由管理员核定。');const s=await api.closureState(month,memberId),c=s.current,reopen=action==='reopen';
  if(!c.member)throw new ContractError('员工档案不存在。');if(reopen?s.status!=='locked':s.status==='locked')throw new ContractError('核定状态已变化，请重新读取。');if(!reopen&&s.blockers.length)throw new ContractError(s.blockers.map(k=>closureBlockers[k]).join('；'));
  const key=crypto.randomUUID();mount(reopen?'重新开放考勤核定':'核定并锁定考勤月份',`<p>${h(c.member.name)} · ${h(month)}</p>`+(reopen?'<p>本次保留原锁定版本并追加重新开放记录。重新核定前，该月份不能作为有效锁定依据。</p>':`<p>保存当次汇总、逐日原始记录、日历与来源版本。以下日期需要明确说明，说明不会改写实际考勤或自动决定工资。</p>${!c.member.active||!c.member.loginActive?'<p class="planning-rule">该成员或账号已停用，缺少离职生效日；请在核定说明中明确本次核对的适用范围。</p>':''}`+s.requiredDates.map((d,i)=>area('day-'+i,d.date+' · '+(monthlyStates[d.state]||'待核对')+'（说明必填）')).join(''))+area('note',reopen?'重新开放原因（必填）':'整月核定说明（必填）')+'<p class="muted">锁定版本不会随后续补卡、请假或日历变化而改写；来源变化后需重新开放并核定。此操作不生成工资或财务流水。</p>',f=>api.closureSave({requestKey:key,month,memberId,action,expectedLatestId:s.latest?.id||null,expectedSourceHash:reopen?s.latest.source_hash:c.sourceHash,note:f.get('note'),dayNotes:reopen?[]:s.requiredDates.map((d,i)=>({date:d.date,note:f.get('day-'+i)}))}),{kind:'attendance'},()=>api.closureReceipt(key));
 }};
}
