import {ContractError,validDate} from './cloud-contract.mjs';
import {costMonth} from './product-cost-contract.mjs';
const fail=()=>{throw new ContractError('销售、退款或手续费资料不完整，请重新核对。');};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const operatingId=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const int=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>2147483647)fail();return v;};
const cents=v=>{if(!Number.isSafeInteger(v)||v<1||v>2147483647)fail();return v;};
const total=v=>{if(typeof v!=='string'||!/^\d+$/.test(v))fail();return v;};
const text=(v,max,empty=false)=>{if(typeof v!=='string'||!empty&&!v.trim()||v.length>max)fail();return v.trim();};
const fields=(v,keys)=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail();};
const amount=v=>{if(typeof v!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(v)||Number(v)<=0||Number(v)*100>2147483647)fail();return v;};
function version(v){if(!object(v)||!validDate(v.businessDate)||!['active','void'].includes(v.status)||!Number.isFinite(Date.parse(v.createdAt)))fail();int(v.version,1);cents(v.amountCents);text(v.description,500);text(v.note,2000,true);text(v.reason,2000);text(v.actor,200);return v;}
function row(v){version(v);operatingId(v.id);operatingId(v.storeId);if(!['sale','refund','fee'].includes(v.kind)||typeof v.storeName!=='string'||typeof v.sourceChanged!=='boolean')fail();text(v.sourceReference,200);if(v.parentId!==null)operatingId(v.parentId);if(v.expenseId!==null)operatingId(v.expenseId);if((v.kind==='refund')!==(v.parentId!==null)||v.expenseId!==null&&v.kind!=='fee')fail();return v;}
function page(v){if(!object(v)||!Array.isArray(v.rows)||v.limit!==50)fail();int(v.offset);int(v.total);return v;}
export function operatingPage(v){page(v);v.rows.forEach(row);if(!Array.isArray(v.stores)||!v.summary)fail();for(const key of ['saleCents','refundCents','feeCents'])total(v.summary[key]);int(v.summary.changedSources);for(const s of v.stores){operatingId(s.id);text(s.name,150);if(typeof s.active!=='boolean')fail();}return v;}
export function operatingDetail(v,id){if(!object(v)||v.record?.id!==id||typeof v.parentChanged!=='boolean')fail();row(v.record);page(v.history);v.history.rows.forEach(version);total(v.refundedCents);if(v.record.parentId!==null){if(v.parent?.id!==v.record.parentId||!validDate(v.parent.businessDate)||!['active','void'].includes(v.parent.status))fail();int(v.parent.version,1);cents(v.parent.amountCents);}else if(v.parent!==null)fail();return v;}
export function operatingQuery(v={}){fields(v,['month','kind','storeId','status','q','offset']);const q=new URLSearchParams();if(v.month)q.set('month',costMonth(v.month));if(v.storeId)q.set('storeId',operatingId(v.storeId));for(const [key,values,fallback] of [['kind',['all','sale','refund','fee'],'all'],['status',['all','active','void'],'active']]){const value=v[key]??fallback;if(!values.includes(value))fail();q.set(key,value);}q.set('q',text(v.q??'',100,true));q.set('offset',int(v.offset??0));return q;}
export function operatingPayload(v,editing=false){
 fields(v,editing?['requestKey','expectedVersion','businessDate','amount','description','note','reason','parentVersion','expenseVersion']:['requestKey','kind','storeId','parentId','expenseId','sourceReference','businessDate','amount','description','note','reason','parentVersion','expenseVersion']);
 if(!validDate(v.businessDate))fail();const result={requestKey:operatingId(v.requestKey),businessDate:v.businessDate,amount:amount(v.amount),description:text(v.description,500),note:text(v.note,2000,true),reason:text(v.reason,2000),parentVersion:v.parentVersion===null?null:int(v.parentVersion,1),expenseVersion:v.expenseVersion===null?null:int(v.expenseVersion,1)};
 if(editing){if(v.expectedVersion>=2147483647)fail();return {...result,expectedVersion:int(v.expectedVersion,1)};}
 if(!['sale','refund','fee'].includes(v.kind)||(v.kind==='refund')!==(v.parentId!==null)||v.expenseId!==null&&v.kind!=='fee'||(v.parentId===null)!==(v.parentVersion===null)||(v.expenseId===null)!==(v.expenseVersion===null))fail();
 return {...result,kind:v.kind,storeId:operatingId(v.storeId),parentId:v.parentId===null?null:operatingId(v.parentId),expenseId:v.expenseId===null?null:operatingId(v.expenseId),sourceReference:text(v.sourceReference,200)};
}
export function operatingVoid(v){if(v?.expectedVersion>=2147483647)fail();fields(v,['requestKey','expectedVersion','reason']);return {requestKey:operatingId(v.requestKey),expectedVersion:int(v.expectedVersion,1),reason:text(v.reason,2000)};}
