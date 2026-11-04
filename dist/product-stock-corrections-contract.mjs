import {ContractError,validDate} from './cloud-contract.mjs';
const fail=()=>{throw new ContractError('商品纠错核对资料不完整，请重新读取原单据。');};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const int=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>2147483647)fail();return v;};
export function stockCorrectionState(v,owner){
 if(!v||v.document?.id!==owner||!['inbound','shipment','return'].includes(v.document.operation)||!['active','void'].includes(v.document.status)||!validDate(v.document.businessDate)||!Array.isArray(v.lines)||!v.lines.length||!Array.isArray(v.stores)||!v.history||!Array.isArray(v.history.rows)||v.history.limit!==50||typeof v.token!=='string'||!/^[a-f0-9]{64}$/.test(v.token))fail();int(v.document.version);int(v.history.total);int(v.history.offset);
 const ids=new Set();for(const l of v.lines){id(l.id);id(l.itemId);id(l.balanceId);if(ids.has(l.id)||typeof l.quantityLocked!=='boolean'||!l.snapshot||typeof l.snapshot.skuCode!=='string')fail();ids.add(l.id);for(const k of ['quantity','currentQuantity','itemQuantity'])int(l[k]);int(l.balanceVersion,1);int(l.itemVersion,1);if(l.businessStoreId!==null)id(l.businessStoreId);}
 for(const r of v.history.rows){id(r.id);int(r.version,1);if(!['active','void'].includes(r.status)||!validDate(r.businessDate)||!Array.isArray(r.lines)||!Number.isFinite(Date.parse(r.createdAt)))fail();}return v;
}
export function stockCorrectionPayload(v,voided=false){
 const keys=voided?['requestKey','expectedVersion','token','reason']:['requestKey','expectedVersion','token','businessDate','sourceReference','reason','lines'];
 if(!v||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k))||typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>2000||typeof v.token!=='string'||!/^[a-f0-9]{64}$/.test(v.token)||v.expectedVersion>=2147483647)fail();const out={requestKey:id(v.requestKey),expectedVersion:int(v.expectedVersion),token:v.token,reason:v.reason.trim()};if(voided)return out;
 if(!validDate(v.businessDate)||typeof v.sourceReference!=='string'||v.sourceReference.length>200||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)fail();const lines=v.lines.map(l=>{if(!l||Object.keys(l).some(k=>!['movementId','quantity','businessStoreId'].includes(k)))fail();return {movementId:id(l.movementId),quantity:int(l.quantity,1),businessStoreId:l.businessStoreId===null?null:id(l.businessStoreId)};});if(new Set(lines.map(l=>l.movementId)).size!==lines.length)fail();return {...out,businessDate:v.businessDate,sourceReference:v.sourceReference.trim(),lines};
}
