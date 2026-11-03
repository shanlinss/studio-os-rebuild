import {hasSensitive} from './admin-permissions.mjs';
import {ContractError} from './cloud-contract.mjs';
import {calendarModes} from './monthly-contract.mjs';
export function createMonthlyEditors({api,h,mount,area,select}){
 return {async calendarEdit(date){
  if(!hasSensitive(await api.session(),'personnel'))throw new ContractError('工作日历由管理员维护。');const v=await api.attendanceCalendar(date.slice(0,7)),d=v.days.find(d=>d.date===date);if(!d)throw new ContractError();const key=crypto.randomUUID();
  mount('调整工作日历',`<p>${h(date)} · 对全工作室生效</p>`+select('mode','当日安排',d.mode,Object.entries(calendarModes))+area('note','修改原因（必填）',d.note)+'<p class="muted">默认周一至周五工作，周六、周日休息。节假日及调休需逐日登记；恢复默认也保留修改历史。修改后月度汇总会重新读取，不修改任何打卡、请假或工资。</p>',f=>api.calendarSave(date,{requestKey:key,expectedVersion:d.version,mode:f.get('mode'),note:f.get('note')}),{kind:'attendance'},()=>api.calendarReceipt(key,date));
 }};
}
