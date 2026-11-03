import {hasSensitive} from './admin-permissions.mjs';
export function createSampleWorkspace({api,h,writable,getUser,notify,localTime}){
 const dialog=document.createElement('dialog');dialog.className='editor wide-editor';dialog.setAttribute('aria-label','样品借用与归还');document.body.append(dialog);
 let controller,request,serial=0,state,rows=[],tab='catalog',offset=0,context=null,saving=false,dirty=false,editing=false,timer,historyId;
 const $=s=>dialog.querySelector(s),admin=()=>hasSensitive(getUser(),'resources');
 const input=(name,label,value='',attrs='')=>`<label>${h(label)}<input name="${name}" value="${h(value??'')}" ${attrs}></label>`;
 const select=(name,label,value,options)=>`<label>${h(label)}<select name="${name}">${options.map(([id,title])=>`<option value="${h(id)}" ${id===value?'selected':''}>${h(title)}</option>`).join('')}</select></label>`;
 const note=()=>'<label>备注<textarea name="note" maxlength="2000" rows="2"></textarea></label>';
 function close(){if(saving)return;if(dirty){$('[data-discard]').hidden=false;return;}controller?.abort();request?.abort();clearTimeout(timer);dialog.close();}
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 function lockToolbar(value){dialog.querySelectorAll('[data-sample-toolbar] input,[data-sample-toolbar] select,[data-sample-toolbar] button').forEach(el=>el.disabled=value);}
 function hideForm(){editing=false;dirty=false;$('#sample-form').hidden=true;lockToolbar(false);}
 async function load(){
  if(!dialog.open||editing)return;request?.abort();request=new AbortController();const signal=AbortSignal.any([controller.signal,request.signal]),current=++serial;
  $('#sample-results').textContent='正在读取样品记录…';$('#sample-prev').disabled=true;$('#sample-next').disabled=true;
  try{
   const data=tab==='history'?await api.warehouseTransfers(historyId,offset,true,signal):tab==='catalog'?await api.sampleCatalog({offset,q:$('#sample-query').value,all:admin()&&$('#sample-all').checked},signal):await api.sampleLoans({offset,team:tab==='team',status:$('#sample-status').value},signal);
   if(signal.aborted||current!==serial)return;rows=data.rows;
   $('#sample-results').innerHTML=rows.map(r=>tab==='history'?`<article class="sample-record"><div><b>${h(r.sourceSnapshot.name)} → ${h(r.targetSnapshot.name)} · ${r.quantity} 件</b><p>产品库存 ${r.sourceBefore} → ${r.sourceAfter} ${h(r.sourceSnapshot.unit)}；样品可借 ${r.targetBefore} → ${r.targetAfter} 件</p><p>${h(r.actor)} · ${h(localTime(r.createdAt))}</p><p class="preserve-text">${h(r.reason)}</p><p>${h(r.sourceReference)}</p></div></article>`:tab==='catalog'?`<article class="sample-record"><div><b>${h(r.name)}</b><p>${h(r.productName||'未关联产品')} · ${h(r.warehouse_location)}${r.keeperName?' · 保管人 '+h(r.keeperName):''}</p><small>可借 ${r.available_quantity} 件${r.active?'':' · 已停用'}</small></div><div class="action-row">${admin()?`<button class="secondary" data-sample-history="${h(r.id)}">转入记录</button>`:''}${writable&&state.canBorrow&&r.active&&r.available_quantity>0?`<button class="primary" data-sample-action="borrow" data-id="${h(r.id)}">借用</button>`:''}${writable&&admin()?`<button class="secondary" data-sample-action="stock" data-id="${h(r.id)}">入库</button>`:''}</div></article>`:`<article class="sample-record"><div><b>${h(r.sampleName)}</b><p>${tab==='team'?h(r.borrowerName||'借用人')+' · ':''}借用 ${r.quantity} 件 · 已还 ${r.returned_quantity} 件 · 未还 ${r.quantity-r.returned_quantity} 件</p><p>存放：${h(r.location)} · 归还位置：${h(r.warehouseLocation||'请与保管人确认')}</p>${r.shooting_title?`<p>关联拍摄：${h(r.shooting_title)}</p>`:''}${r.note?`<p class="preserve-text">${h(r.note)}</p>`:''}</div><div class="action-row">${writable&&state.canBorrow&&r.owner_id===getUser()?.id&&r.returned_quantity<r.quantity?`<button class="primary" data-sample-action="return" data-id="${h(r.id)}">归还</button><button class="secondary" data-sample-action="relocate" data-id="${h(r.id)}">更新位置</button>`:''}</div></article>`).join('')||'<p class="muted">暂无符合条件的记录。</p>';
   $('#sample-caption').textContent=data.total?`${offset+1}–${offset+rows.length} / ${data.total} 条`:'0 条记录';
   if(!rows.length&&offset>0){offset=Math.max(0,offset-50);await load();return;}
   $('#sample-prev').disabled=offset===0;$('#sample-next').disabled=offset+data.limit>=data.total;
  }catch(e){if(!signal.aborted)$('#sample-results').textContent=e.message;}
 }
 async function edit(action,row){
  if(saving||editing)return;const signal=controller.signal;request?.abort();editing=true;lockToolbar(true);$('#sample-prev').disabled=true;$('#sample-next').disabled=true;const form=$('#sample-form');form.hidden=false;form.textContent='正在准备填写…';
  let fields='';
  try{
   if(action==='register'){
    const [products,members]=await Promise.all([api.products(signal),api.members(signal)]);if(signal.aborted)return;
    fields=input('name','样品名称','','required maxlength="120"')+input('warehouseLocation','仓库存放位置','','required maxlength="150"')+select('productId','关联产品','',[['','不关联'],...products.map(p=>[p.id,p.name])])+select('keeperMemberId','保管人','',[['','暂不指定'],...members.map(m=>[m.id,m.displayName])])+note();
   }else if(action==='borrow')fields=`<p>可借 ${row.available_quantity} 件，借用人：${h(state.member.displayName)}</p>`+input('quantity','借用件数',1,`required type="number" min="1" max="${row.available_quantity}" step="1"`)+input('location','借用后存放位置','','required maxlength="150"')+select('shootingRequestId','关联拍摄需求',context||'',[['','不关联'],...state.shooting.map(s=>[s.id,s.title])])+note();
   else if(action==='stock')fields=`<p>当前可借 ${row.available_quantity} 件；本次只追加实际入库件数。</p>`+input('quantity','新增入库件数',1,'required type="number" min="1" max="2147483647" step="1"')+note();
   else if(action==='return')fields=`<p>尚未归还 ${row.quantity-row.returned_quantity} 件。请交回 ${h(row.warehouseLocation||'原保管人确认的位置')}，再登记归还；支持部分归还。</p>`+input('quantity','本次归还件数',row.quantity-row.returned_quantity,`required type="number" min="1" max="${row.quantity-row.returned_quantity}" step="1"`)+note();
   else fields=input('location','当前存放位置',row.location,'required maxlength="150"')+note();
   const title={register:'登记样品',borrow:'借用样品',stock:'样品入库',return:'登记归还',relocate:'更新存放位置'}[action],key=crypto.randomUUID();let payload;
   form.innerHTML=`<h3>${h(title)}${row?' · '+h(row.name||row.sampleName):''}</h3>${fields}<p role="alert" class="save-error"></p><div data-discard hidden>尚未保存修改。<button type="button" class="text-button" data-keep>继续填写</button><button type="button" class="text-button" data-drop>放弃修改</button></div><button type="button" class="secondary" data-recover hidden>核对上次保存结果</button><div class="form-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit" class="primary">确认保存</button></div>`;
   dirty=false;form.oninput=()=>{dirty=true;};form.onchange=()=>{dirty=true;};
   form.querySelector('[data-cancel]').onclick=()=>{if(dirty)form.querySelector('[data-discard]').hidden=false;else{hideForm();load();}};
   form.querySelector('[data-keep]').onclick=()=>{form.querySelector('[data-discard]').hidden=true;};form.querySelector('[data-drop]').onclick=()=>{hideForm();load();};
   const error=form.querySelector('[role=alert]'),save=form.querySelector('[type=submit]'),recover=form.querySelector('[data-recover]');
   const freeze=value=>{form.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=value);$('[data-close-samples]').disabled=value;};
   const finished=async()=>{hideForm();notify('样品记录已保存');await load();};
   recover.onclick=async()=>{if(saving)return;saving=true;freeze(true);try{const result=await api.sampleReceipt(key,action,row?.id);if(result)await finished();else{error.textContent='未找到该次保存记录，可使用原填写再次提交。';recover.hidden=true;freeze(false);form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);}}catch(e){error.textContent=e.message;}finally{saving=false;freeze(false);if(editing){save.disabled=!recover.hidden;form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);}recover.disabled=false;}};
   form.onsubmit=async e=>{
    e.preventDefault();if(saving)return;const data=new FormData(form);saving=true;freeze(true);error.textContent='';let blocked=false;
    try{
     if(!payload){payload={requestKey:key,note:data.get('note')};if(action==='register')payload={requestKey:key,name:data.get('name'),warehouseLocation:data.get('warehouseLocation'),productId:data.get('productId')||null,keeperMemberId:data.get('keeperMemberId')||null,notes:data.get('note')};else{if(action!=='relocate')payload.quantity=Number(data.get('quantity'));if(['borrow','relocate'].includes(action))payload.location=data.get('location');if(action==='borrow')payload.shootingRequestId=data.get('shootingRequestId')||null;}}
     await api.sampleWrite(action,row?.id,payload,row?.version);await finished();
    }catch(err){error.textContent=err.message;if(err.uncertain){blocked=true;recover.hidden=false;error.textContent+=' 请先核对保存结果，避免重复扣减库存。';}else if(err.status===409){blocked=true;error.textContent+=' 请取消并重新读取记录后再填写。';}else payload=undefined;}
    finally{saving=false;freeze(false);if(blocked){save.disabled=true;form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);}}
   };
   form.querySelector('input')?.focus();
  }catch(e){if(!signal.aborted){hideForm();$('#sample-results').textContent=e.message;}}
 }
 async function open(shootingId){
  if(dialog.open)return;controller?.abort();controller=new AbortController();const signal=controller.signal;context=shootingId||null;tab='catalog';offset=0;editing=false;dirty=false;
  dialog.innerHTML='<div class="dialog-header"><h2>样品借用与归还</h2><button class="icon-button" data-close-samples aria-label="关闭样品借还">×</button></div><p id="sample-loading">正在读取样品权限…</p>';$('[data-close-samples]').onclick=close;dialog.showModal();
  try{
   const currentState=await api.sampleState(signal);if(signal.aborted)return;state=currentState;
   $('#sample-loading').outerHTML=`<p class="muted">${context?'从拍摄需求进入，新借用可默认关联该需求。':''}“我的借用”列出本人全部借用。拍摄完成不会自动归还样品。${state.canBorrow?'':'当前身份未关联有效成员，暂不能借用或归还。'}</p><div data-sample-toolbar><div class="action-row"><button class="secondary" data-tab="catalog" aria-pressed="true">可借样品</button><button class="secondary" data-tab="own" aria-pressed="false">我的借用</button>${admin()?'<button class="secondary" data-tab="team" aria-pressed="false">团队借用</button>':''}${admin()&&writable?'<button class="primary" data-register-sample>＋ 登记样品</button>':''}</div><div id="sample-catalog-filter"><label>查找样品<input id="sample-query" type="search" maxlength="100" placeholder="名称、产品或仓库位置"></label><label ${admin()?'':'hidden'}><input id="sample-all" type="checkbox">包含停用样品</label></div><label id="sample-loan-filter" hidden>归还状态<select id="sample-status"><option value="open">未全部归还</option><option value="returned">已全部归还</option><option value="all">全部借用</option></select></label></div><form id="sample-form" hidden></form><div id="sample-results"></div><div class="pager"><button class="secondary" id="sample-prev">上一页</button><span id="sample-caption"></span><button class="secondary" id="sample-next">下一页</button></div>`;
   dialog.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;dialog.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));offset=0;$('#sample-catalog-filter').hidden=tab!=='catalog';$('#sample-loan-filter').hidden=tab==='catalog';load();});
   $('#sample-query').oninput=()=>{offset=0;clearTimeout(timer);timer=setTimeout(load,250);};$('#sample-all').onchange=()=>{offset=0;load();};$('#sample-status').onchange=()=>{offset=0;load();};
   $('#sample-prev').onclick=()=>{offset=Math.max(0,offset-50);load();};$('#sample-next').onclick=()=>{offset+=50;load();};$('[data-register-sample]')?.addEventListener('click',()=>edit('register'));
   $('#sample-results').onclick=e=>{if(saving||editing)return;const history=e.target.closest('button[data-sample-history]');if(history&&admin()){historyId=history.dataset.sampleHistory;tab='history';offset=0;$('#sample-catalog-filter').hidden=true;$('#sample-loan-filter').hidden=true;dialog.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-pressed','false'));load();return;}const button=e.target.closest('button[data-sample-action]');if(!button||!writable)return;const row=rows.find(r=>r.id===button.dataset.id);if(row)edit(button.dataset.sampleAction,row);};await load();
  }catch(e){if(!signal.aborted)$('#sample-loading').textContent=e.message;}
 }
 document.addEventListener('click',e=>{const button=e.target.closest('button[data-open-samples]');if(button)open(button.dataset.openSamples);});
 return {open};
}
