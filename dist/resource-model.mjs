import {ContractError} from './cloud-contract.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function namedList(value,key='name'){
 if(!Array.isArray(value)||value.some(r=>!object(r)||typeof r.id!=='string'||typeof r[key]!=='string'))throw new ContractError();return value;
}
export function templateRecord(v,detail=false){
 namedList([v]);if(!Array.isArray(v.tags)||typeof v.archived!=='boolean'||!Number.isSafeInteger(v.version))throw new ContractError();if(detail&&!Array.isArray(v.usages))throw new ContractError();return v;
}
export function titleCatalog(value){
 if(!object(value)||!Array.isArray(value.items)||!Number.isSafeInteger(value.page)||value.page<1||!Number.isSafeInteger(value.pageCount)||value.pageCount<1||!Number.isSafeInteger(value.total)||value.total<0)throw new ContractError();namedList(value.items);return value;
}
export function titleBatch(value){namedList([value]);namedList(value.items,'title');return value;}
export function knowledgeList(value){namedList(value,'title');if(value.some(r=>!['knowledge','learning'].includes(r.entryType)||!['article','link','conclusion'].includes(r.kind)||!Array.isArray(r.tags)))throw new ContractError();return value;}
export function maskContact(value){if(value===null||value===undefined||value==='')return '未填写';const text=String(value);return text.length<=4?'****':text.slice(0,Math.min(3,text.length-4))+'****'+text.slice(-4);}

export function feishuDocumentUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='feishu.cn'||u.hostname.endsWith('.feishu.cn'))?u.href:null;}catch{return null;}
}
export function knowledgeNavigationPayload(value,version){
 if(!object(value)||Object.keys(value).some(k=>!['title','category','summary','tags','sourceUrl'].includes(k)))throw new ContractError('导航信息格式不完整。');
 const result={};for(const [key,max] of [['title',200],['category',100],['summary',2000]]){if(typeof value[key]!=='string'||value[key].length>max)throw new ContractError('请核对文档名称、分类和说明的长度。');result[key]=value[key].trim();}
 if(!result.title)throw new ContractError('请填写文档名称。');
 if(!feishuDocumentUrl(value.sourceUrl))throw new ContractError('请填写 HTTPS 飞书文档链接。');result.sourceUrl=value.sourceUrl.trim();
 if(!Array.isArray(value.tags)||value.tags.length>30||value.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40))throw new ContractError('标签最多 30 个，每个最多 40 字。');result.tags=[...new Set(value.tags.map(t=>t.trim()))];
 if(version!==undefined){if(!Number.isSafeInteger(version)||version<1)throw new ContractError('请重新读取文档导航后编辑。');result.expectedVersion=version;}return result;
}
