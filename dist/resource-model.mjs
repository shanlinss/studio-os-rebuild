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
