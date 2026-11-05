// One access generation covers JSON, attachments, exports and mutation responses.
// A completed old request must not repaint a new identity's workspace.
export function createAccessObserver(fetcher,{onAccessDenied=()=>{}}={}){
 let generation=0;
 const cancelled=()=>new DOMException('登录或权限上下文已变化，请重新读取资料。','AbortError');
 function guardedBody(body,stamp){if(!body)return body;return new Proxy(body,{get(target,key){if(key==='getReader')return (...args)=>{const reader=target.getReader(...args);return new Proxy(reader,{get(r,k){if(k==='read')return async()=>{if(stamp!==generation){void r.cancel().catch(()=>{});throw cancelled();}const chunk=await r.read();if(stamp!==generation){void r.cancel().catch(()=>{});throw cancelled();}return chunk;};const value=Reflect.get(r,k,r);return typeof value==='function'?value.bind(r):value;}});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}
 function guarded(response,stamp){return new Proxy(response,{get(target,key){if(key==='body')return guardedBody(target.body,stamp);if(['json','blob','text','arrayBuffer','formData'].includes(key))return async(...args)=>{if(stamp!==generation)throw cancelled();const value=await target[key](...args);if(stamp!==generation)throw cancelled();return value;};if(key==='clone')return ()=>guarded(target.clone(),stamp);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}
 async function fetch(path,options){const stamp=generation,response=await fetcher(path,options);if(stamp!==generation)throw cancelled();
  if(path!=='/api/login'&&[401,403].includes(response.status)){
   if(response.status===401)generation++;
   try{Promise.resolve(onAccessDenied({status:response.status,path})).catch(()=>{});}catch{}
   if(response.status===401)return response;
  }
  return guarded(response,stamp);
 }
 return {fetch,invalidate(){generation++;},async protect(promise){const stamp=generation,value=await promise;if(stamp!==generation)throw cancelled();return value;}};
}
export function accessStamp(user,inventory){return JSON.stringify({id:user?.id??null,role:user?.role??null,superadmin:user?.superadmin===true,permissions:[...(user?.permissions??[])].sort(),manage:inventory?.canManageAll===true,quantity:inventory?.quantityOperationsAvailable===true,products:inventory?.productOperationsAvailable===true,grants:(inventory?.grants??[]).map(g=>({storeId:g.storeId??null,canMove:g.canMove===true,storeActive:g.storeActive??null})).sort((a,b)=>String(a.storeId).localeCompare(String(b.storeId)))});}
export function clearAccessSurfaces(document,dispatch=()=>{}){
 dispatch();
 for(const dialog of document.querySelectorAll('dialog')){if(dialog.open)dialog.close();if(dialog.id==='cloud-detail'){const body=document.createElement('div');body.id='cloud-detail-content';dialog.replaceChildren(body);}else dialog.replaceChildren();}
}
