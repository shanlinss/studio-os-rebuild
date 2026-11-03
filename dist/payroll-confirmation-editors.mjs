import {ContractError} from './cloud-contract.mjs';
import {hasSensitive} from './admin-permissions.mjs';
import {payrollMoney} from './payroll-contract.mjs';
export function createPayrollConfirmationEditors({api,h,mount,area}){
 const saveFile=(file,month)=>{const url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=`Studio-OS-payroll-${month}-${file.id.slice(0,8)}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return {async payrollConfirm(month,memberId,action){
  if(!hasSensitive(await api.session(),'payroll'))throw new ContractError('需要独立薪资授权。');const s=await api.payrollState(month,memberId),reopen=action==='reopen';if(!s.draft||(reopen?!s.locked:s.locked||!s.attendanceValid||s.attendanceChanged||s.salaryChanged))throw new ContractError('工资状态或来源已变化，请重新核对。');const key=crypto.randomUUID();
  mount(reopen?'重新开放工资修订':'确认并锁定工资',`<p>${h(s.member.name)} · ${h(month)}</p><p>本次草稿第 ${s.draft.revision} 版 · 合计 ${h(payrollMoney(s.draft.total_cents))}</p>`+area('note',reopen?'重新开放原因（必填）':'工资确认说明（必填）')+`<label><input name="confirmed" type="checkbox" required>${reopen?'我确认重新开放修订，保留原锁定版本':'我已核对各项金额、考勤和基础工资版本，确认锁定本次工资'}</label><p class="muted">${reopen?'重新开放后才能修改草稿；原确认内容和导出记录继续保留。':'锁定后不能直接修改金额；后续来源变化需重新开放并核对。'} 本操作不登记支付，不生成财务流水。</p>`,f=>api.payrollConfirmationSave({requestKey:key,month,memberId,action,expectedDraftId:s.draft.id,expectedConfirmationId:s.confirmation?.id||null,note:f.get('note'),confirmed:f.get('confirmed')==='on'}),{kind:'attendance'},()=>api.payrollConfirmationReceipt(key));
 },async payrollExport(month){
  if(!hasSensitive(await api.session(),'payroll'))throw new ContractError('需要独立薪资授权。');const s=await api.payrollExportable(month),ready=s.rows.filter(r=>r.ready),key=crypto.randomUUID();if(!ready.length)throw new ContractError('本月暂无来源一致、已确认锁定的工资可以导出。');
  mount('核对工资表导出范围',`<p>${h(month)} · 请选择本次导出的员工</p>${s.rows.map(r=>r.ready?`<label><input type="checkbox" name="confirmationIds" value="${h(r.confirmation.id)}" checked>${h(r.member.name)} · ${h(payrollMoney(r.totalCents))}</label>`:`<p class="muted">${h(r.member.name)}：尚未有效确认或来源已有变化，本次不能选入。</p>`).join('')}<p class="planning-rule">仅导出本次勾选范围，包含工资汇总、确认依据及导出记录。文件表示工资确认，不表示实际支付。保存后开始下载。</p>`,async f=>{const file=await api.payrollExport({requestKey:key,month,confirmationIds:f.getAll('confirmationIds')});saveFile(file,month);return {id:file.id};},{kind:'attendance',submitLabel:'导出工资表'},async()=>{const receipt=await api.payrollExportReceipt(key);if(!receipt)return null;saveFile(await api.payrollExportFile(receipt.id),month);return receipt;});
 }};
}
