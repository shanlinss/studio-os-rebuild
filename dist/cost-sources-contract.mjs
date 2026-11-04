import {ContractError,validDate} from './cloud-contract.mjs';
import {costMonth} from './product-cost-contract.mjs';
const fail=()=>{throw new ContractError('成本来源数据不完整，请重新核对。');};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const costId=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const integer=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>2147483647)fail();return v;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail();return v.trim();};
const fields=(v,keys)=>{if(!obj(v)||Object.keys(v).some(k=>!keys.includes(k)))fail();};
const amount=v=>{if(typeof v!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(v)||Number(v)*100>2147483647)fail();return v;};
const cents=v=>integer(v);
function reference(v){if(!obj(v))fail();costId(v.id);integer(v.version,1);costMonth(v.effectiveMonth);if(v.unitCents!==null)cents(v.unitCents);if(!['stocked','dropship'].includes(v.fulfillmentMode))fail();text(v.sourceReference,200);return v;}
function page(v,adapt){if(!obj(v)||!Array.isArray(v.rows)||v.limit!==50)fail();integer(v.total);integer(v.offset);v.rows.forEach(adapt);return v;}
export function referenceState(v,id,month){if(!obj(v)||v.sku?.id!==id||v.month!==month)fail();integer(v.version);if(v.current!==null)reference(v.current);page(v.history,reference);return v;}
export function referencePayload(v){fields(v,['requestKey','expectedVersion','effectiveMonth','unitPrice','fulfillmentMode','sourceReference','reason']);if(!['stocked','dropship'].includes(v.fulfillmentMode))fail();return {requestKey:costId(v.requestKey),expectedVersion:integer(v.expectedVersion),effectiveMonth:costMonth(v.effectiveMonth),unitPrice:v.unitPrice===null?null:amount(v.unitPrice),fulfillmentMode:v.fulfillmentMode,sourceReference:text(v.sourceReference,200),reason:text(v.reason,2000)};}
export function dropshipList(v){return page(v,row=>{costId(row.id);text(row.code,64);if(!validDate(row.businessDate))fail();text(row.supplier,150);});}
export function dropshipOptions(v){if(!obj(v)||!Array.isArray(v.rows)||!Array.isArray(v.stores)||v.limit!==50)fail();integer(v.offset);v.rows.forEach(r=>{costId(r.id);text(r.code,64);});v.stores.forEach(s=>{costId(s.id);text(s.name,150);});return v;}
function version(v,ids){costId(v.id);integer(v.version,1);if(!Array.isArray(v.lines)||v.lines.length!==ids.size)fail();const seen=new Set();for(const line of v.lines){costId(line.lineId);if(!ids.has(line.lineId)||seen.has(line.lineId)||!['actual','reference'].includes(line.basis))fail();seen.add(line.lineId);cents(line.amountCents);if(line.basis==='reference')reference(line.reference);else if(line.reference!==null)fail();}return v;}
export function dropshipDetail(v,id){
 if(!obj(v)||v.document?.id!==id||!validDate(v.document.businessDate)||!Array.isArray(v.lines)||!v.lines.length||!Array.isArray(v.refunds))fail();
 const ids=new Set();for(const l of v.lines){costId(l.id);costId(l.skuId);costId(l.storeId);if(ids.has(l.id)||!l.snapshot||typeof l.snapshot.skuCode!=='string')fail();ids.add(l.id);integer(l.quantity,1);integer(l.returnedQuantity);if(l.returnedQuantity>l.quantity)fail();}
 version(v.record,ids);page(v.history,r=>version(r,ids));
 for(const r of v.refunds){costId(r.id);if(!ids.has(r.lineId)||!validDate(r.businessDate)||!Array.isArray(r.history)||!r.history.length)fail();integer(r.quantity,1);for(const h of r.history){integer(h.version,1);cents(h.amountCents);}}
 return v;
}
const price=v=>{if(!['actual','reference'].includes(v.basis))fail();if(v.basis==='reference'&&v.amount!==null)fail();return {basis:v.basis,amount:v.basis==='reference'?null:amount(v.amount)};};
export function dropshipPayload(v,revise=false){
 fields(v,revise?['requestKey','expectedVersion','reason','lines']:['requestKey','code','businessDate','supplier','sourceReference','reason','lines']);
 if(!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)fail();
 const lines=v.lines.map(l=>{fields(l,revise?['lineId','basis','amount']:['skuCode','storeId','quantity','basis','amount']);return revise?{lineId:costId(l.lineId),...price(l)}:{skuCode:text(l.skuCode,64),storeId:costId(l.storeId),quantity:integer(l.quantity,1),...price(l)};});
 if(revise&&new Set(lines.map(l=>l.lineId)).size!==lines.length)fail();
 if(!revise&&!validDate(v.businessDate))fail();
 return {requestKey:costId(v.requestKey),reason:text(v.reason,2000),lines,...(revise?{expectedVersion:integer(v.expectedVersion,1)}:{code:text(v.code,64),businessDate:v.businessDate,supplier:text(v.supplier,150),sourceReference:text(v.sourceReference,200)})};
}
export function dropshipRefundPayload(v){fields(v,['requestKey','refundId','expectedVersion','lineId','quantity','businessDate','sourceReference','amount','reason']);if(!validDate(v.businessDate)||v.refundId===null&&v.expectedVersion!==0)fail();return {requestKey:costId(v.requestKey),refundId:v.refundId===null?null:costId(v.refundId),expectedVersion:integer(v.expectedVersion),lineId:costId(v.lineId),quantity:integer(v.quantity,1),businessDate:v.businessDate,sourceReference:text(v.sourceReference,200),amount:amount(v.amount),reason:text(v.reason,2000)};}
export function signedCostMoney(v){if(typeof v!=='string'||!/^[-]?\d+$/.test(v))fail();const n=BigInt(v),abs=n<0n?-n:n;return (n<0n?'-':'')+'¥'+(abs/100n)+'.'+String(abs%100n).padStart(2,'0');}
