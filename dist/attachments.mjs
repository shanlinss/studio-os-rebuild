import {fileSize,mediaUpload,expenseReceiptMaxBytes} from './media-contract.mjs';
export function attachmentList(h,kind,ownerId,assets,{taskId,removable=false}={}){
 return `<div class="attachment-list">${assets.map(a=>`<div class="attachment-entry"><button class="attachment-card" data-media-open="${h(a.id)}" data-media-kind="${h(kind)}" data-media-owner="${h(ownerId)}" ${taskId?`data-media-task="${h(taskId)}"`:''} data-media-name="${h(a.name)}"><span class="attachment-icon">${String(a.mime).startsWith('video/')?'▷':'▧'}</span><span><b>${h(a.name)}</b><small>${h(fileSize(a.size))}${a.note?' · '+h(a.note):''}${a.download?' · 首次领取：'+h(a.download.name):''}</small></span><span>预览 →</span></button>${kind==='expense'&&removable?`<button class="text-button" data-remove-expense-receipt="${h(a.id)}" data-expense-id="${h(ownerId)}">删除凭证</button>`:''}</div>`).join('')||'<p class="muted">暂无附件。</p>'}</div>`;
}
export function createAttachmentViews({api,h,writable,notify,onSaved}){
 const dialog=document.createElement('dialog');dialog.className='editor media-editor';dialog.setAttribute('aria-label','附件预览与上传');document.body.append(dialog);
 let controller,objectUrl,saving=false,downloadUrl;
 const revoke=()=>{for(const video of dialog.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}for(const img of dialog.querySelectorAll('img'))img.removeAttribute('src');if(objectUrl)URL.revokeObjectURL(objectUrl);if(downloadUrl)URL.revokeObjectURL(downloadUrl);objectUrl=null;downloadUrl=null;};
 const close=()=>{if(saving)return;controller?.abort();revoke();dialog.close();};
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{controller?.abort();revoke();});window.addEventListener('pagehide',revoke);
 const head=title=>`<div class="dialog-header"><h2>${h(title)}</h2><button class="icon-button" type="button" data-media-close aria-label="关闭附件">×</button></div>`;
 const mount=(title,body)=>{controller?.abort();controller=new AbortController();revoke();dialog.innerHTML=head(title)+body;dialog.querySelector('[data-media-close]').onclick=close;if(!dialog.open)dialog.showModal();return controller.signal;};
 const saveBlob=(blob,name)=>{if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(blob);const a=document.createElement('a');a.href=downloadUrl;a.download=name;a.click();};
 async function preview({kind,owner,asset,name,taskId}){
  const signal=mount(name,'<p class="muted">正在读取私有附件…</p>');
  try{
   const blob=await api.asset(kind,owner,asset,{taskId},signal);if(signal.aborted)return;objectUrl=URL.createObjectURL(blob);
   dialog.innerHTML=head(name)+`<div class="media-stage">${blob.type.startsWith('image/')?`<img src="${h(objectUrl)}" alt="${h(name)}">`:`<video src="${h(objectUrl)}" controls preload="metadata"></video>`}</div><p class="muted">${h(fileSize(blob.size))} · 私有附件</p><p class="save-error" role="alert"></p><div class="action-row"><button class="primary" data-download-file>${kind==='material'&&writable?'下载并记录领取':'下载文件'}</button><button class="secondary" data-confirm-download hidden>已保存到本地，确认领取</button></div><p class="muted" data-download-caption>${kind==='material'&&writable?'预览不会记录领取；下载后请确认已保存，才登记领取信息。':'预览与下载副本不会改变业务记录。'}</p>`;
   dialog.querySelector('[data-media-close]').onclick=close;
   const previewMedia=dialog.querySelector('img,video');previewMedia?.addEventListener('error',()=>{if(!signal.aborted&&dialog.open){const error=dialog.querySelector('[role=alert]');if(error)error.textContent='这个文件暂时无法预览，可以下载原文件后查看。';}},{once:true});
   const download=dialog.querySelector('[data-download-file]'),confirm=dialog.querySelector('[data-confirm-download]'),error=dialog.querySelector('[role=alert]');let receipt;
   download.onclick=async()=>{if(saving)return;saving=true;download.disabled=true;error.textContent='';try{
    if(kind==='material'&&writable){const result=await api.downloadMaterial(owner,asset);receipt=result.receipt;saveBlob(result.blob,name);confirm.hidden=false;dialog.querySelector('[data-download-caption]').textContent='下载已发起。确认文件保存成功后，再登记领取；这不代表系统能判断浏览器是否已保存。';}
    else{saveBlob(blob,name);notify('下载已发起');}
   }catch(e){error.textContent=e.message;if(e.uncertain)download.dataset.blocked='true';}finally{saving=false;download.disabled=download.dataset.blocked==='true';}};
   confirm.onclick=async()=>{if(saving||!receipt)return;saving=true;confirm.disabled=true;try{await api.confirmMaterialDownload(owner,asset,receipt);confirm.hidden=true;dialog.querySelector('[data-download-caption]').textContent='已确认领取。';notify('领取信息已记录');saving=false;close();await onSaved({kind,owner,taskId});}catch(e){error.textContent=e.message;confirm.disabled=false;}finally{saving=false;}};
  }catch(e){if(e.name!=='AbortError'&&!signal.aborted){dialog.innerHTML=head('附件暂不可用')+`<p class="save-error">${h(e.message)}</p>`;dialog.querySelector('[data-media-close]').onclick=close;}}
 }
 async function upload({kind,owner,taskId,itemId}){
  if(!writable)return;let row=null;if(kind==='shooting')row=await api.shootingDetail(owner);if(kind==='expense'){row=(await api.finance()).records.find(r=>r.id===owner);if(!row)throw new Error('这笔支出暂不可见，请刷新后重试。');if(row.settlementId){notify('这笔支出已纳入结算，不能增减凭证。');return;}if(!Array.isArray(row.receipts))throw new Error('原凭证资料不完整，请重新读取支出。');if(row.receipts.length>=20){notify('每笔支出最多保留 20 张凭证。');return;}}
  if(kind==='shooting'&&row&&(row.archived||row.status==='已完成')){notify('当前需求已结束或归档，不能继续添加文件。');return;}
  const requestKey=crypto.randomUUID();mount(kind==='expense'?'上传支出凭证':itemId?'添加拍摄参考':kind==='shooting'?'上传交付文件':'添加附件',`<form data-media-form><label>选择文件<input name="file" type="file" required accept="${itemId||kind==='expense'?'image/png,image/jpeg,image/gif,image/webp':'image/png,image/jpeg,image/gif,image/webp,video/mp4'}"></label>${kind==='shooting'?'<label>附件说明<textarea name="note" rows="3" maxlength="300"></textarea></label>':''}<p class="muted">单个文件不超过 ${kind==='expense'?'10':'8'} MiB，支持 PNG、JPG、GIF、WebP${itemId||kind==='expense'?'':' 和 MP4'}。${kind==='expense'?'每笔最多 20 张，总计不超过 100 MiB。':''}${kind==='shooting'&&!itemId?'较大视频可在提交交付时填写存放路径。':''}</p><p role="alert" class="save-error"></p><div class="form-actions"><button type="button" class="secondary" data-cancel-upload>取消</button><button class="primary" type="submit">上传并保存</button></div></form>`);
  const form=dialog.querySelector('form'),submit=form.querySelector('[type=submit]'),fileInput=form.elements.file,error=form.querySelector('[role=alert]');form.querySelector('[data-cancel-upload]').onclick=close;
  form.onsubmit=async e=>{e.preventDefault();if(saving)return;error.textContent='';let file;try{file=mediaUpload(fileInput.files[0],{imagesOnly:!!itemId||kind==='expense',...(kind==='expense'?{maxBytes:expenseReceiptMaxBytes}:{})}).file;}catch(err){error.textContent=err.message;return;}saving=true;submit.disabled=true;fileInput.disabled=true;submit.textContent='正在上传…';form.querySelectorAll('textarea').forEach(el=>el.disabled=true);
   try{if(kind==='expense')await api.uploadExpenseReceipt(owner,file,row.version);else if(kind==='material')await api.uploadMaterial(owner,file);else if(kind==='publication')await api.uploadPublication(taskId,owner,file);else await api.uploadShooting(owner,file,row.version,requestKey,{itemId,note:form.elements.note.value});saving=false;close();notify('附件已保存');try{await onSaved({kind,owner,taskId});}catch{notify('附件已保存，页面刷新失败，请重新读取资料。');}}
   catch(err){error.textContent=err.message;if(err.uncertain||err.status===409){submit.dataset.blocked='true';error.textContent+=' 文件仍保留在选择框，请先核对原记录，避免重复上传。';}}
   finally{saving=false;submit.disabled=submit.dataset.blocked==='true';fileInput.disabled=submit.disabled;form.querySelectorAll('textarea').forEach(el=>el.disabled=submit.disabled);submit.textContent='上传并保存';}
  };
 }
 document.addEventListener('click',e=>{const open=e.target.closest('[data-media-open]'),add=e.target.closest('[data-media-upload]');if(open)preview({kind:open.dataset.mediaKind,owner:open.dataset.mediaOwner,asset:open.dataset.mediaOpen,name:open.dataset.mediaName,taskId:open.dataset.mediaTask}).catch(err=>notify(err.message));if(add)upload({kind:add.dataset.mediaUpload,owner:add.dataset.mediaOwner,taskId:add.dataset.mediaTask,itemId:add.dataset.mediaItem}).catch(err=>notify(err.message));});
 return {close};
}
