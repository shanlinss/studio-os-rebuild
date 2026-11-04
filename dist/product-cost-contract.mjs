import {ContractError} from './cloud-contract.mjs';
const fail=()=>{throw new ContractError('商品成本核对数据不完整。');};
const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const int=v=>Number.isSafeInteger(v);
const amount=v=>v===null||typeof v==='string'&&/^-?\d+\.\d{2}$/.test(v);
export function costMonth(v){if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)||v<'1900-01'||v>'2199-12')fail();return v;}
export function costCatalog(v){
 if(!v||!Array.isArray(v.rows)||!int(v.total)||v.total<0||!int(v.offset)||v.offset<0||v.limit!==50)fail();
 for(const r of v.rows)if(!id(r.id)||typeof r.code!=='string'||typeof r.name!=='string'||typeof r.unit!=='string'||!(r.quantity===null||int(r.quantity)))fail();
 return v;
}
export function costReview(v,owner,month){
 if(!v||v.sku?.id!==owner||typeof v.sku.code!=='string'||typeof v.sku.name!=='string'||v.method!=='moving-average'||v.month!==month||!int(v.quantity)||!Array.isArray(v.rows)||!Array.isArray(v.issues)||!v.issues.every(s=>typeof s==='string'))fail();
 for(const key of ['balanceAmount','averageAmount','shipmentAmount','returnAmount','netAmount'])if(!amount(v[key]))fail();
 if(!int(v.estimatedRows)||v.estimatedRows<0)fail();
 for(const key of ['indicativeShipmentAmount','indicativeReturnAmount','indicativeNetAmount'])if(!amount(v[key]))fail();
 const d=v.dropship,cents=v=>v===null||typeof v==='string'&&/^-?\d+$/.test(v);
 if(!d||!Array.isArray(d.rows)||!Array.isArray(d.refunds)||!int(d.estimatedRows)||d.estimatedRows<0)fail();
 for(const key of ['actualCents','indicativeCents','refundCents','netCents','indicativeNetCents'])if(!cents(d[key]))fail();
 for(const r of [...d.rows,...d.refunds])if(!id(r.id)||!id(r.documentId)||typeof r.code!=='string'||typeof r.day!=='string'||!r.day.startsWith(month+'-')||!int(r.quantity)||r.quantity<1||!cents(r.amountCents===null?null:String(r.amountCents))||r.amountCents===null||!r.snapshot)fail();
 if(d.rows.some(r=>!['actual','reference'].includes(r.basis)))fail();
 for(const key of ['shipmentQuantity','returnQuantity'])if(!int(v[key])||v[key]<0)fail();
 for(const r of v.rows){
  if(!id(r.id)||!(r.documentId===null||id(r.documentId))||typeof r.day!=='string'||!r.day.startsWith(month+'-')||!['opening','inbound','outbound','stocktake','shipment','return'].includes(r.kind)||!int(r.quantity)||!int(r.delta)||!int(r.balanceQuantity)||!r.snapshot||!Array.isArray(r.notes)||!r.notes.every(s=>typeof s==='string'))fail();
  if(!['actual','reference','missing'].includes(r.costBasis)||!amount(r.indicativeAmount)||!(r.referenceId===null||id(r.referenceId)))fail();
  for(const key of ['costAmount','balanceAmount','averageAmount'])if(!amount(r[key]))fail();
 }
 return v;
}
