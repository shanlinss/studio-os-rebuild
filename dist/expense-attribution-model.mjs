import {ContractError} from './cloud-contract.mjs';
import {cents,financeRecord} from './management-model.mjs';
export const expenseScopes={public:'工作室公共',store:'店铺专属',unclassified:'归属待核对'};
export const expenseUses={operating:'日常运营费用',inventory:'库存采购',prepaid:'预付款项',unclassified:'用途待核对'};
export function classification(scope,use,store){if(typeof scope!=='string'||typeof use!=='string'||!Object.hasOwn(expenseScopes,scope)||!Object.hasOwn(expenseUses,use)||scope==='public'&&store!==null||scope==='store'&&!store)throw new ContractError('请核对费用归属、用途和店铺。');return {expenseScope:scope,expenseUse:use};}
export function attributionPayload(v){
 if(!v||Object.keys(v).some(k=>!['requestKey','expectedVersion','expenseScope','expenseUse','storeId','reason'].includes(k)))throw new ContractError();
 const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError();return v;};
 if(!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||v.expectedVersion>=2147483647||typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>2000)throw new ContractError('请填写归属核对依据。');
 const storeId=v.storeId===null?null:id(v.storeId);
 return {requestKey:id(v.requestKey),expectedVersion:v.expectedVersion,...classification(v.expenseScope,v.expenseUse,storeId),storeId,reason:v.reason.trim()};
}
export function expenseOverview(records){
 let publicCents=0n,directCents=0n,inventoryCents=0n,prepaidCents=0n,pendingCents=0n,pendingCount=0;const stores=new Map();
 for(const row of records){const amount=cents(row.amountCents),scope=row.expenseScope??'unclassified',use=row.expenseUse??'unclassified';classification(scope,use,row.storeId??null);
  if(scope==='unclassified'||use==='unclassified'){pendingCents+=amount;pendingCount++;continue;}
  if(use==='inventory'){inventoryCents+=amount;continue;}if(use==='prepaid'){prepaidCents+=amount;continue;}
  if(scope==='public'){publicCents+=amount;continue;}
  directCents+=amount;const s=stores.get(row.storeId)||{storeId:row.storeId,storeName:row.storeName||'原店铺',cents:0n};s.cents+=amount;stores.set(row.storeId,s);
 }
 return {publicCents:String(publicCents),directCents:String(directCents),inventoryCents:String(inventoryCents),prepaidCents:String(prepaidCents),pendingCents:String(pendingCents),pendingCount,stores:[...stores.values()].map(s=>({storeId:s.storeId,storeName:s.storeName,amountCents:String(s.cents)})).sort((a,b)=>a.storeName.localeCompare(b.storeName,'zh-CN'))};
}
export function advancesByPerson(value){
 const data=financeRecord(value),people=new Map();
 const get=(id,name)=>{if(typeof id!=='string'||!id)throw new ContractError('垫付人关联不完整。');if(!people.has(id))people.set(id,{payerId:id,payerName:name||'原垫付人',unassigned:0n,inStatements:0n});return people.get(id);};
 for(const r of data.records)if(r.paymentMode==='advance'&&!r.settlementId)get(r.payerId,r.payerName).unassigned+=cents(r.amountCents);
 for(const s of data.settlements)get(s.payerId,s.payerName).inStatements+=cents(s.remainingCents);
 return [...people.values()].filter(p=>p.unassigned+p.inStatements>0n).map(p=>({payerId:p.payerId,payerName:p.payerName,unassignedCents:String(p.unassigned),inStatementsCents:String(p.inStatements),totalCents:String(p.unassigned+p.inStatements)})).sort((a,b)=>BigInt(a.totalCents)===BigInt(b.totalCents)?a.payerName.localeCompare(b.payerName,'zh-CN'):BigInt(a.totalCents)>BigInt(b.totalCents)?-1:1);
}
