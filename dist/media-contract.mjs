import {ContractError} from './cloud-contract.mjs';
export const maxFileBytes=8388608;
export const expenseReceiptMaxBytes=10485760;
export const mediaTypes=['image/png','image/jpeg','image/gif','image/webp','video/mp4'];
export function mediaUpload(file,{imagesOnly=false,maxBytes=maxFileBytes}={}){
 if(!file||typeof file.name!=='string'||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1||file.size>maxBytes)throw new ContractError('请选择不超过 '+(maxBytes/1048576)+' MiB 的'+(imagesOnly?'图片。':'图片或 MP4 文件。较大交付可填写交付路径。'));
 if(!file.name.trim()||file.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(file.name))throw new ContractError('文件名无效，请使用不含路径的简短名称。');
 const extensions={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4'};
 const mime=file.type||extensions[file.name.split('.').pop()?.toLowerCase()];
 if(!mediaTypes.includes(mime)||(imagesOnly&&!mime.startsWith('image/')))throw new ContractError(imagesOnly?'参考附件仅支持 PNG、JPG、GIF、WebP 图片。':'支持 PNG、JPG、GIF、WebP 图片和 MP4 视频。');
 return {file,name:file.name,mime};
}
export async function readMedia(response,{maxBytes=maxFileBytes,imagesOnly=false}={}){
 const mime=(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase();
 if(!mediaTypes.includes(mime)||(imagesOnly&&!mime.startsWith('image/'))||Number(response.headers.get('Content-Length'))>maxBytes)throw new ContractError('附件类型或大小不符合当前预览范围。');
 if(!response.body)throw new ContractError('附件内容不完整，请重新读取。');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new ContractError('附件超过当前预览大小。');}chunks.push(value);}}finally{reader.releaseLock();}
 if(!size)throw new ContractError('附件为空，请核对原文件。');return new Blob(chunks,{type:mime});
}
const id=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw new ContractError('附件关联记录无效。');return value;};
export function assetPath(kind,ownerId,assetId,{taskId}={}){
 const owner=id(ownerId),asset=id(assetId);
 if(kind==='equipment')return `/api/equipment/catalog/${owner}/images/${asset}`;
 if(kind==='expense')return `/api/finance/expenses/${owner}/receipts/${asset}`;
 if(kind==='material')return `/api/materials/${owner}/assets/${asset}`;
 if(kind==='shooting')return `/api/shooting/requests/${owner}/assets/${asset}`;
 if(kind==='publication')return `/api/tasks/${id(taskId)}/publications/${owner}/assets/${asset}`;
 throw new ContractError('附件类型暂不可用。');
}
export function fileSize(bytes){return !Number.isSafeInteger(bytes)||bytes<0?'大小未提供':bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KiB':(bytes/1048576).toFixed(1)+' MiB';}
