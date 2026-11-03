import {ContractError} from './cloud-contract.mjs';
export function createInventoryAccessEditors({api,h,mount,area,select}){
 async function inventoryAccess(id){
  const [current,row,stores,history]=await Promise.all([api.session(),api.inventoryAccess(id),api.stores(),api.inventoryAccessHistory(id)]);
  const editable=current.superadmin===true&&row.active,key=crypto.randomUUID(),old=new Map(row.grants.map(g=>[g.storeId,g]));
  const choices=[{id:null,name:'公共库存',active:true},...stores.filter(s=>s.active||old.has(s.id))];
  for(const g of row.grants)if(g.storeId!==null&&!choices.some(s=>s.id===g.storeId))throw new ContractError('原授权店铺暂未读取完整，请重试。');
  const summary=rows=>rows.map(g=>(g.storeId===null?'公共库存':g.storeName)+(g.storeActive===false?'（已停用）':'')+'：'+(g.canMove?'查看及出入库':'仅查看')).join('；')||'未配置范围';
  const fields=choices.map(s=>{const g=old.get(s.id),options=[['none','不授权'],['read','仅查看'],...((s.active||g?.canMove)?[['move','查看及登记出入库']]:[])];return select('scope-'+(s.id??'public'),s.name+(s.active?'':'（已停用）'),g?(g.canMove?'move':'read'):'none',options);}).join('');
  const record=r=>`<article class="observation"><p>${h(summary(r.beforeValue.grants))} → ${h(summary(r.afterValue.grants))}</p><p class="preserve-text">${h(r.reason)}</p><p class="muted">${h(r.actor)} · ${h(new Date(r.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</p></article>`;
  mount('库存范围授权',`<p>${h(row.username)}</p><p class="planning-rule">仅超级管理员可以保存。范围授权不包含盘点、库存资料维护或财务权限；拥有资源管理权限的管理员仍可管理全部库存。</p><div class="form-grid">${fields}</div><p class="muted">保存后目标账号需要重新登录。范围配置可先保存，员工出入库将在公共与店铺余额分开后开放，现有总库存继续由资源管理员维护。</p>`+(editable?area('reason','变更原因（必填）'):'<p class="muted">当前仅可查看范围和记录。</p>')+`<h3>授权变更记录</h3><div data-scope-history>${history.rows.map(record).join('')||'<p class="muted">暂无范围变更记录。</p>'}</div><div class="module-toolbar"><button type="button" class="text-button" data-scope-prev>上一页</button><span data-scope-count></span><button type="button" class="text-button" data-scope-next>下一页</button></div><p class="save-error" data-history-error role="status"></p>`,f=>{
   if(!editable)throw new ContractError('当前只能查看库存授权。');
   return api.saveInventoryAccess(id,{requestKey:key,reason:f.get('reason'),grants:choices.flatMap(s=>{const value=f.get('scope-'+(s.id??'public'));if(!['none','read','move'].includes(value))throw new ContractError('库存范围选择无效。');return value==='none'?[]:[{storeId:s.id,canMove:value==='move'}];})},row.version);
  },{kind:'directory'},editable?()=>api.inventoryAccessReceipt(id,key):undefined,form=>{
   let page=history,loading=false,disposed=false;const abort=new AbortController(),prev=form.querySelector('[data-scope-prev]'),next=form.querySelector('[data-scope-next]');
   const update=()=>{prev.disabled=loading||page.offset===0;next.disabled=loading||page.offset+page.rows.length>=page.total;form.querySelector('[data-scope-count]').textContent=`共 ${page.total} 条 · 第 ${Math.floor(page.offset/50)+1} 页`;};update();
   if(!editable){form.querySelectorAll('select').forEach(el=>el.disabled=true);form.querySelector('[type=submit]').hidden=true;}
   async function load(offset){if(loading)return;loading=true;update();const error=form.querySelector('[data-history-error]');error.textContent='';try{const result=await api.inventoryAccessHistory(id,offset,abort.signal);if(disposed)return;page=result;form.querySelector('[data-scope-history]').innerHTML=page.rows.map(record).join('');}catch(e){if(!disposed&&e.name!=='AbortError')error.textContent=e.message;}finally{if(!disposed){loading=false;update();}}}
   prev.onclick=()=>load(Math.max(0,page.offset-50));next.onclick=()=>load(page.offset+50);
   return ()=>{disposed=true;abort.abort();};
  });
 }
 return {inventoryAccess};
}
