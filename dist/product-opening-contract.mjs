import {ContractError,validDate} from './cloud-contract.mjs';
const fail=()=>{throw new ContractError('期初成本依据不完整，请重新核对。');};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const int=v=>{if(!Number.isSafeInteger(v)||v<0||v>2147483647)fail();return v;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail();return v.trim();};
function record(v){
 if(!v||!Array.isArray(v.lines)||!v.lines.length||!Number.isFinite(Date.parse(v.createdAt)))fail();
 id(v.id);if(!int(v.version))fail();int(v.totalCents);text(v.sourceReference,200);text(v.reason,2000);text(v.actor,200);
 const seen=new Set();let total=0;
 for(const line of v.lines){id(line.movementId);if(seen.has(line.movementId)||!int(line.quantity)||!line.snapshot||typeof line.snapshot.name!=='string')fail();seen.add(line.movementId);total+=int(line.totalCents);}
 if(total!==v.totalCents)fail();return v;
}
export function openingState(v,owner){
 if(!v||v.sku?.id!==owner||typeof v.sku.code!=='string'||typeof v.sku.name!=='string'||!Array.isArray(v.lines))fail();
 id(v.sku.itemId);const seen=new Map();
 for(const line of v.lines){id(line.id);if(seen.has(line.id)||!int(line.quantity)||!validDate(line.day)||!line.snapshot||typeof line.snapshot.name!=='string')fail();seen.set(line.id,line.quantity);}
 if(v.record!==null){record(v.record);if(v.record.lines.length!==seen.size||v.record.lines.some(line=>seen.get(line.movementId)!==line.quantity))fail();}
 return v;
}
export function openingHistory(v){if(!v||!Array.isArray(v.rows)||v.limit!==50)fail();int(v.total);int(v.offset);v.rows.forEach(record);return v;}
export function openingPayload(v){
 if(!v||Object.keys(v).some(k=>!['requestKey','expectedVersion','sourceReference','reason','lines'].includes(k))||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)fail();
 const lines=v.lines.map(line=>{if(!line||Object.keys(line).some(k=>!['movementId','amount'].includes(k))||typeof line.amount!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(line.amount))fail();return {movementId:id(line.movementId),amount:line.amount};});
 if(new Set(lines.map(line=>line.movementId)).size!==lines.length)fail();
 return {requestKey:id(v.requestKey),expectedVersion:int(v.expectedVersion),sourceReference:text(v.sourceReference,200),reason:text(v.reason,2000),lines};
}
