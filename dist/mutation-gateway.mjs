import {readWorkbook,workbookMime} from './payroll-confirmation-contract.mjs';
import {readMedia} from './media-contract.mjs';
import {ApiError} from './cloud-contract.mjs';
// Used only by explicit connected builds. Read-only previews never request a mutation token.
export function createMutationGateway(fetcher,{enabled=false}={}){
 let token=null;const pending=new Set(),uncertain=new Set();
 const acceptSession=data=>{token=enabled&&/^[a-f0-9]{64}$/.test(data?.csrfToken)?data.csrfToken:null;if(token)uncertain.delete('/api/login');};
 const confirmRead=(path,{exact=false}={})=>{for(const p of uncertain)if(p===path||(!exact&&p.startsWith(path+'/')))uncertain.delete(p);};
 async function send(path,method,body,{login=false,binary=false,headers={},responseType='json'}={}){
  if(!enabled)throw new ApiError(405,'当前为只读预览，未发送保存请求。');
  if(!login&&!token)throw new ApiError(401,'请先登录，再保存修改。');
  if(pending.has(path))throw new ApiError(409,'这项操作正在保存，请稍候。');
  if(uncertain.has(path))throw new ApiError(409,'上次保存结果尚未确认，请先刷新并核对记录。');
  pending.add(path);
  try{
   let response;
   try{response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(binary||responseType==='media'?60000:15000),headers:{Accept:responseType==='workbook'?workbookMime:responseType==='media'?'image/png,image/jpeg,image/gif,image/webp,video/mp4':'application/json',...(!binary?{'Content-Type':'application/json'}:{}),...headers,...(!login?{'x-csrf-token':token}:{})},body:binary?body:JSON.stringify(body)});}
   catch{uncertain.add(path);const error=new ApiError(0,'保存结果未确认，请先刷新列表核对，避免重复提交。');error.uncertain=true;throw error;}
   if(response.status>=500){uncertain.add(path);const error=new ApiError(response.status,'服务暂未确认保存结果，请先核对原记录，避免重复提交。');error.uncertain=true;throw error;}
   if(!response.ok){if(response.status===409){let locked=false;try{locked=(await response.clone().json())?.reason==='finance_month_locked';}catch{}if(locked)throw new ApiError(409,'该来源涉及已锁定的财务月份，请先从月结入口重新开放相关月份。');}if(response.status===401)token=null;throw new ApiError(response.status,response.status===409?'记录已变化，请刷新详情后重新编辑。':response.status===401?'登录已失效，请重新登录。':response.status===403?'当前账号无权进行这项操作。':response.status===413?'文件或内容超过本次限制，请精简后再提交。':'保存未完成，请核对填写内容。');}
   let data;try{if(responseType==='workbook'){data=await readWorkbook(response);}else if(responseType==='media'){const blob=await readMedia(response),receipt=response.headers.get('X-Studio-Download-Receipt');if(!receipt||!/^[a-f0-9-]{36}$/.test(receipt))throw Error();data={blob,receipt};}else data=await response.json();}catch{uncertain.add(path);const e=new ApiError(0,'保存响应不完整，请先核对原记录。');e.uncertain=true;throw e;}
   if(login)acceptSession(data);return data;
  }finally{pending.delete(path);}
 }
 return {acceptSession,confirmRead,send,clear:()=>{token=null;}};
}
