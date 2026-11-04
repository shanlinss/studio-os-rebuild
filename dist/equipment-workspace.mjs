import {hasSensitive} from './admin-permissions.mjs';
import {profileScopes} from './resource-profiles.mjs';
import {equipmentLabels} from './equipment-contract.mjs';

export function createEquipmentWorkspace({api,h,writable,getUser,notify,localTime}){
 const dialog=document.createElement('dialog');dialog.className='editor wide-editor';dialog.setAttribute('aria-label','设备档案与借还');document.body.append(dialog);
 const $=s=>dialog.querySelector(s),admin=()=>hasSensitive(getUser(),'resources');let controller,request,tab='catalog',offset=0,historyId=null,serial=0,state,timer;
 function close(){controller?.abort();request?.abort();clearTimeout(timer);dialog.close();}
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 function controls(){
  $('#equipment-filter').hidden=tab!=='catalog';$('#equipment-loan-filter').hidden=!['own','team'].includes(tab);
  dialog.querySelectorAll('[data-equipment-tab]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.equipmentTab===tab)));
  $('#equipment-context').textContent=['history','handovers'].includes(tab)?'设备操作及交接历史，按页查看。':tab==='own'?'以下列出本人全部设备借用，不限当前拍摄需求。':tab==='team'?'团队借用仅供管理员查看，仍由实际借用人办理归还。':'每件设备单独建档；借用、维修和停用保留原记录。';
 }
 async function load(){
  if(!dialog.open)return;request?.abort();request=new AbortController();const signal=AbortSignal.any([controller.signal,request.signal]),current=++serial;
  controls();$('#equipment-results').textContent='正在读取设备…';$('#equipment-prev').disabled=true;$('#equipment-next').disabled=true;
  try{
   const data=tab==='catalog'?await api.equipmentCatalog({offset,q:$('#equipment-query').value,all:admin()&&($('#equipment-all').checked||$('#equipment-asset-status').value==='retired'),assetStatus:$('#equipment-asset-status').value},signal):tab==='history'?await api.equipmentHistory(historyId,offset,signal):tab==='handovers'?await api.equipmentHandovers(historyId,offset,signal):await api.equipmentLoans({offset,team:tab==='team',status:$('#equipment-status').value},signal);
   const accounts=tab==='catalog'&&admin()?await api.businessAccounts(signal):[];
   if(signal.aborted||current!==serial)return;
   const action=(label,kind,id)=>`<button class="secondary" data-equipment-action="${kind}" data-equipment-id="${h(id)}">${h(label)}</button>`;
   $('#equipment-results').innerHTML=data.rows.map(r=>{
    if(tab==='handovers')return `<article class="observation"><b>${h(r.fromName||'在库')} → ${h(r.toName)}</b><p>实际交接：${h(localTime(r.occurredAt))}</p><p class="preserve-text">设备状况：${h(r.condition)}</p><p class="preserve-text">${h(r.note)}</p><p>${(r.accountReviews||[]).map(a=>`<p>关联账号 ${h(a.before.name)}：${h(a.before.responsibleName)} → ${h(a.after.responsibleName)}（${a.decision==='sync'?'已同步':'保留原负责人'}）</p>`).join('')}${h(r.actor)} · 登记 ${h(localTime(r.createdAt))}</p></article>`;
    if(tab==='history'){const labels={'image-added':'添加或更换照片','image-removed':'移除照片',handover:'管理员交接',registered:'登记设备',edited:'修改档案',borrowed:'借出',returned:'归还',relocated:'更新使用位置',maintenance:'送修',ready:'恢复可借',retired:'停用'};return `<article class="observation"><b>${h(labels[r.action]||r.action)}</b><p>${h(r.actor)} · ${h(localTime(r.createdAt))}</p><p class="preserve-text">${h(r.note)}</p></article>`;}
    if(tab==='catalog'){
     const primary=accounts.find(a=>a.primaryDeviceId===r.id);
     const extras=accounts.filter(a=>a.extraDeviceIds?.includes(r.id));
     const linked=admin()?`<p>主账号：${h(primary?.name||'未关联')} · 额外账号：${h(extras.map(a=>a.name).join('、')||'未关联')}</p>`:'';
     return `<article class="sample-record"><div><b>${h(r.name)}</b><p>${h(r.assetTag)} · ${h([r.deviceType,r.brand,r.model].filter(Boolean).join(' · ')||'类型/型号未填写')}</p><p>归属：${h(profileScopes[r.ownershipScope]||'归属待确认')}${r.ownershipStoreName?' · '+h(r.ownershipStoreName):''} · 存放：${h(r.location)} · 保管人：${h(r.keeperName||'暂未指定')} · 当前使用人：${h(r.currentUserName===undefined?'尚未提供':r.currentUserName||'暂无')}</p>${linked}${r.imageId?`<button class="text-button" data-media-kind="equipment" data-media-owner="${h(r.id)}" data-media-open="${h(r.imageId)}" data-media-name="设备照片">查看照片</button>`:''}<span class="type-tag">${h(equipmentLabels[r.status])}</span></div><div class="action-row">${writable&&state.canBorrow&&r.status==='available'?action('借用','borrow',r.id):''}${admin()?`<button class="text-button" data-equipment-history="${h(r.id)}">记录</button><button class="text-button" data-equipment-handovers="${h(r.id)}">交接记录</button><button class="text-button" data-open-phone-cards data-phone-device="${h(r.id)}">关联手机卡</button>`:''}${writable&&hasSensitive(getUser(),'finance')?action('采购资料','purchase',r.id):''}${admin()&&writable?`<button class="secondary" data-resource-profile="equipment-store" data-id="${h(r.id)}">设备归属</button>`+action('编辑','edit',r.id)+action('照片','photo',r.id)+(['available','on_loan'].includes(r.status)?action('交接','handover',r.id):'')+(r.status==='available'?action('送修','maintenance',r.id):'')+(['maintenance','retired'].includes(r.status)?action(r.status==='retired'?'恢复启用':'维修完成','ready',r.id):'')+(['available','maintenance'].includes(r.status)?action('停用','retired',r.id):''):''}</div></article>`;
    }
    return `<article class="sample-record"><div><b>${h(r.name)} · ${h(r.assetTag)}</b><p>${tab==='team'?h(r.borrowerName)+' · ':''}借出 ${h(localTime(r.borrowedAt))}</p><p>使用位置：${h(r.location)} · 归还位置：${h(r.returnLocation)}</p>${r.shootingTitle?`<p>关联拍摄：${h(r.shootingTitle)}</p>`:''}${r.returnedAt?`<p>已归还 ${h(localTime(r.returnedAt))} · ${r.returnCondition==='handover'?'管理员交接，原借用结束':r.returnCondition==='issue'?'有异常，待维修':'完好'}</p>`:''}<p class="preserve-text">${h(r.returnNote||r.note||'')}</p></div><div class="action-row">${writable&&state.canBorrow&&!r.returnedAt&&r.ownerId===getUser()?.id?action('归还','return',r.id)+action('更新位置','relocate',r.id):''}</div></article>`;
   }).join('')||'<p class="muted">暂无符合条件的记录。</p>';
   if(!data.rows.length&&offset>0){offset=Math.max(0,offset-50);await load();return;}
   $('#equipment-caption').textContent=data.total?`${offset+1}–${offset+data.rows.length} / ${data.total} 条`:'0 条记录';$('#equipment-prev').disabled=offset===0;$('#equipment-next').disabled=offset+data.limit>=data.total;
  }catch(e){if(!signal.aborted)$('#equipment-results').textContent=e.status===404?'当前连接尚未部署设备功能。':e.message;}
 }
 async function open(shooting){
  if(dialog.open)return;controller?.abort();controller=new AbortController();const signal=controller.signal;tab='catalog';offset=0;historyId=null;
  dialog.dataset.shootingId=shooting||'';
  dialog.innerHTML='<div class="dialog-header"><h2>设备档案与借还</h2><button class="icon-button" data-equipment-close aria-label="关闭设备档案">×</button></div><p id="equipment-loading">正在读取身份范围…</p>';$('[data-equipment-close]').onclick=close;dialog.showModal();
  try{
   const identity=await api.sampleState(signal);if(signal.aborted)return;state=identity;
   $('#equipment-loading').outerHTML=`<p class="muted" id="equipment-context"></p><div class="action-row"><button class="secondary" data-equipment-tab="catalog" aria-pressed="true">设备目录</button><button class="secondary" data-equipment-tab="own" aria-pressed="false">我的借用</button>${admin()?'<button class="secondary" data-equipment-tab="team" aria-pressed="false">团队借用</button>':''}${admin()?'<button class="secondary" data-open-phone-cards>手机卡档案</button>':''}${admin()&&writable?'<button class="primary" data-equipment-action="register">＋ 登记设备</button>':''}</div>${state.canBorrow?'':'<p class="muted">尚未关联有效成员，暂不能借用或归还。</p>'}<div id="equipment-filter" class="module-toolbar"><label class="module-search">查找设备<input id="equipment-query" type="search" maxlength="100" placeholder="编号、类型、品牌、型号、位置或使用人"></label><label>设备状态<select id="equipment-asset-status"><option value="all">全部在用状态</option><option value="available">可借用</option><option value="on_loan">借用中</option><option value="maintenance">待维修</option>${admin()?'<option value="retired">已停用</option>':''}</select></label><label ${admin()?'':'hidden'}><input id="equipment-all" type="checkbox">包含停用设备</label></div><label id="equipment-loan-filter" hidden>归还状态<select id="equipment-status"><option value="open">未归还</option><option value="returned">已归还</option><option value="all">全部借用</option></select></label><div id="equipment-results"></div><div class="pager"><button class="secondary" id="equipment-prev">上一页</button><span id="equipment-caption"></span><button class="secondary" id="equipment-next">下一页</button></div>`;
   dialog.querySelectorAll('[data-equipment-tab]').forEach(el=>el.onclick=()=>{tab=el.dataset.equipmentTab;offset=0;load();});
   $('#equipment-query').oninput=()=>{offset=0;clearTimeout(timer);timer=setTimeout(load,250);};$('#equipment-asset-status').onchange=()=>{offset=0;load();};$('#equipment-all').onchange=()=>{offset=0;load();};$('#equipment-status').onchange=()=>{offset=0;load();};$('#equipment-prev').onclick=()=>{offset=Math.max(0,offset-50);load();};$('#equipment-next').onclick=()=>{offset+=50;load();};
   $('#equipment-results').onclick=e=>{const button=e.target.closest('[data-equipment-history],[data-equipment-handovers]');if(button){historyId=button.dataset.equipmentHistory||button.dataset.equipmentHandovers;tab=button.hasAttribute('data-equipment-handovers')?'handovers':'history';offset=0;load();}};await load();
  }catch(e){if(!signal.aborted){const loading=$('#equipment-loading');if(loading)loading.textContent=e.message;else notify(e.message);}}
 }
 document.addEventListener('click',e=>{const button=e.target.closest('button[data-open-equipment]');if(button)open(button.dataset.openEquipment);});
 return {refresh:load,context:()=>dialog.dataset.shootingId||null,close};
}
