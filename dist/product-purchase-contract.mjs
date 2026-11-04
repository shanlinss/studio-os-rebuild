import {ContractError,validDate} from './cloud-contract.mjs';
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('采购来源标识无效。');return v;};
const integer=v=>{if(!Number.isSafeInteger(v)||v<0||v>2147483647)throw new ContractError('采购金额或数量无效。');return v;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new ContractError('请填写采购批次、供应商和说明。');return v.trim();};
function record(v){
 if(!v||!validDate(v.purchaseDate)||typeof v.supplier!=='string'||typeof v.reason!=='string'||typeof v.actor!=='string'||!Number.isFinite(Date.parse(v.createdAt))||!Array.isArray(v.lines)||!v.lines.length)throw new ContractError('采购成本记录不完整。');
 id(v.id);if(integer(v.version)===0)throw new ContractError();
 integer(v.goodsCents);integer(v.additionalCents);integer(v.totalCents);
 for(const line of v.lines){
  id(line.movementId);integer(line.quantity);integer(line.unitCents);integer(line.goodsCents);integer(line.additionalCents);integer(line.totalCents);
  if(!line.quantity||!line.snapshot||typeof line.snapshot.skuCode!=='string'||line.goodsCents!==line.quantity*line.unitCents||line.totalCents!==line.goodsCents+line.additionalCents)throw new ContractError('采购明细计算不一致。');
 }
 if(v.lines.reduce((sum,line)=>sum+line.goodsCents,0)!==v.goodsCents||v.lines.reduce((sum,line)=>sum+line.additionalCents,0)!==v.additionalCents||v.totalCents!==v.goodsCents+v.additionalCents)throw new ContractError('采购合计不一致。');
 return v;
}
export function productPurchaseState(v,owner){
 if(!v||v.document?.id!==owner||!Array.isArray(v.document.lines)||!v.document.lines.length||typeof v.sourceChanged!=='boolean')throw new ContractError('采购入库来源不完整。');
 for(const line of v.document.lines){id(line.id);integer(line.quantity);if(!line.snapshot||typeof line.snapshot.skuCode!=='string')throw new ContractError();}
 if(v.batch!==null){id(v.batch.id);text(v.batch.code,64);record(v.record);}else if(v.record!==null)throw new ContractError();
 return v;
}
export function productPurchaseHistory(v){
 if(!v||!Array.isArray(v.rows)||!Number.isSafeInteger(v.total)||v.total<0||!Number.isSafeInteger(v.offset)||v.offset<0||v.limit!==50)throw new ContractError();
 v.rows.forEach(record);return v;
}
export function productPurchasePayload(v){
 if(!v||Object.keys(v).some(k=>!['requestKey','expectedVersion','code','purchaseDate','supplier','expenseId','expenseVersion','reason','lines','stockCorrectionVersion'].includes(k))||!validDate(v.purchaseDate)||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)throw new ContractError();
 const expectedVersion=integer(v.expectedVersion),lines=v.lines.map(line=>{
  if(!line||Object.keys(line).some(k=>!['movementId','unitPrice','additionalAmount'].includes(k)))throw new ContractError();
  for(const key of ['unitPrice','additionalAmount'])if(typeof line[key]!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(line[key]))throw new ContractError('采购金额最多填写两位小数，实际为零请填 0。');
  return {movementId:id(line.movementId),unitPrice:line.unitPrice,additionalAmount:line.additionalAmount};
 });
 if(new Set(lines.map(line=>line.movementId)).size!==lines.length)throw new ContractError('采购明细不能重复。');
 const expenseId=v.expenseId===null?null:id(v.expenseId);
 if(expenseId?(integer(v.expenseVersion)===0):v.expenseVersion!==null)throw new ContractError();
 return {requestKey:id(v.requestKey),expectedVersion,code:text(v.code,64),purchaseDate:v.purchaseDate,supplier:text(v.supplier,150),expenseId,expenseVersion:v.expenseVersion,reason:text(v.reason,2000),lines,...(v.stockCorrectionVersion===undefined?{}:{stockCorrectionVersion:integer(v.stockCorrectionVersion)})};
}
