import {ContractError} from './cloud-contract.mjs';
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('考勤记录标识无效。');return v;};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function dailyAttendanceState(v){
 if(!v||!date(v.today)||!time(v.serverNow)||!['not-applicable','unavailable','not-started','working','finished','needs-review'].includes(v.status)||![null,'member-unavailable','outside-employment','previous-open','multiple-periods','invalid-period'].includes(v.issue)||![true,false,null].includes(v.late)||![true,false,null].includes(v.insufficient)||(v.durationMinutes!==null&&(!Number.isSafeInteger(v.durationMinutes)||v.durationMinutes<0)))throw new ContractError('考勤状态不完整。');
 if(v.period!==null){const p=v.period;id(p.id);if(!date(p.workDate)||!Number.isSafeInteger(p.version)||p.version<1||(p.inAt!==null&&!time(p.inAt))||(p.outAt!==null&&!time(p.outAt)))throw new ContractError();}
 if(['working','finished'].includes(v.status)&&(!v.period||!v.period.inAt||v.period.workDate!==v.today||v.late===null||v.durationMinutes===null||(v.status==='working'?(v.period.outAt!==null||v.insufficient!==null):(!v.period.outAt||typeof v.insufficient!=='boolean'))))throw new ContractError('上下班状态与原记录不一致。');
 return v;
}
export function endWorkPayload(key,periodId,version){if(!Number.isSafeInteger(version)||version<1)throw new ContractError('请重新读取考勤版本。');return {requestKey:id(key),periodId:id(periodId),expectedVersion:version};}
export function endWorkResult(v,owner){if(!v||v.id!==owner||!date(v.workDate)||!time(v.outAt))throw new ContractError('结束工作结果未确认。');id(v.id);return v;}
export function createDailyAttendanceCard({api,h,localTime,notify,writable,onSignedOut,onAuthRequired}){
 return {async render(host,signal,user){
  if(!host||user.role!=='employee')return;
  const card=document.createElement('section');card.className='work-panel daily-attendance-card';card.setAttribute('aria-label','今日考勤');host.prepend(card);let saving=false,key=crypto.randomUUID(),state;
  const labels={'not-applicable':'无需考勤',unavailable:'暂不能生成考勤','not-started':'今日未上班',working:'工作中',finished:'已下班','needs-review':'待补正'};
  const issues={'outside-employment':'当前日期不在已登记在职期间，未自动登记打卡。请联系管理员核对适用日期。','member-unavailable':'当前账号未关联有效成员，请联系管理员核对。','previous-open':'有前一天未结束的记录，需核对补正；不会自动延长或补写下班时间。','multiple-periods':'当天有多条历史记录，请联系管理员核对。','invalid-period':'原考勤时间需要核对，请联系管理员补正。'};
  async function load(){
   if(signal.aborted||!card.isConnected)return;card.textContent='正在读取今日考勤…';
   try{state=await api.dailyAttendance(signal);if(signal.aborted||!card.isConnected)return;
    card.innerHTML=`<h2>今日考勤 <span class="type-tag">${h(labels[state.status])}</span></h2><p>${h(state.today)} · 北京时间</p>${state.period?`<p>上班：${h(state.period.inAt?localTime(state.period.inAt):'待补正')}</p><p>下班：${h(state.period.outAt?localTime(state.period.outAt):'尚未登记')}</p>`:''}${state.durationMinutes!==null?`<p>${state.status==='finished'?'本日时长':'截至本次读取'}：${Math.floor(state.durationMinutes/60)} 小时 ${state.durationMinutes%60} 分钟${state.late?' · 迟到':''}${state.insufficient?' · 时长不足':''}</p>`:''}<p class="muted">${h(issues[state.issue]||({'not-started':'请退出后重新登录，成功登录时登记今日首次上班。',working:'按上下班时间差计时，午休不另扣；普通退出不登记下班。',finished:'今日记录已保留，重新登录不会重新开始计时。'}[state.status])||'管理员无需打卡。')}</p><div class="action-row"><a class="text-button" href="#attendance">查看我的考勤 →</a><button class="text-button" data-refresh-attendance>核对状态</button>${writable&&state.status==='working'?'<button class="secondary" data-end-work>结束工作并退出</button>':''}</div><p role="alert" class="save-error"></p><div data-end-confirm hidden><p>确认结束今天的工作？系统将登记实际下班时间，并退出当前账号的所有设备。</p><div class="action-row"><button class="secondary" data-cancel-end>继续工作</button><button class="primary" data-confirm-end>确认结束并退出</button></div></div>`;
    card.querySelector('[data-refresh-attendance]').onclick=()=>{if(!saving)load();};card.querySelector('[data-end-work]')?.addEventListener('click',()=>{if(!saving)card.querySelector('[data-end-confirm]').hidden=false;});
    card.querySelector('[data-cancel-end]')?.addEventListener('click',()=>{if(!saving)card.querySelector('[data-end-confirm]').hidden=true;});
    card.querySelector('[data-confirm-end]')?.addEventListener('click',async()=>{
     if(saving)return;saving=true;card.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{await api.endWork(key,state.period.id,state.period.version);await onSignedOut();notify('已登记下班，当前账号的所有设备已退出。');}
     catch(e){if(signal.aborted)return;if(e.status===401){await onAuthRequired();return;}card.querySelector('[role=alert]').textContent=e.message+(e.uncertain?' 请先核对状态；若已退出，请重新登录查看今日记录。':'');card.querySelector('[data-end-confirm]').hidden=true;if(e.uncertain||e.status===409){card.querySelector('[data-end-work]').disabled=true;}}
     finally{saving=false;const refresh=card.querySelector('[data-refresh-attendance]');if(refresh)refresh.disabled=false;}
    });
    key=crypto.randomUUID();
   }catch(e){if(signal.aborted)return;if(e.status===401){await onAuthRequired();return;}card.innerHTML=`<h2>今日考勤</h2><p role="alert">${h(e.status===404?'当前连接尚未部署今日考勤功能。':e.message)}</p><button class="secondary" data-retry-attendance>重新读取</button>`;card.querySelector('button').onclick=load;}
  }
  await load();
 }};
}
