import {ContractError,validDate} from './cloud-contract.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('采购资料关联标识无效。');return v;};
const version=(v,zero=false)=>{if(!Number.isSafeInteger(v)||v<(zero?0:1)||v>2147483647)throw new ContractError('采购资料版本无效。');return v;};
const cents=v=>{if(!Number.isSafeInteger(v)||v<0||v>2147483647)throw new ContractError('采购金额无效。');return v;};
function equipment(v){if(!object(v)||typeof v.name!=='string'||typeof v.assetTag!=='string'||!['available','on_loan','maintenance','retired'].includes(v.status))throw new ContractError('设备资料不完整。');return {id:id(v.id),assetTag:v.assetTag,name:v.name,status:v.status};}
function expense(v){if(!object(v)||typeof v.description!=='string'||!validDate(v.expenseDate))throw new ContractError('原支出资料不完整。');return {id:id(v.id),version:version(v.version),expenseDate:v.expenseDate,description:v.description,amountCents:cents(v.amountCents)};}
function record(v,owner){
 if(!object(v)||v.equipmentId!==owner||typeof v.supplier!=='string'||typeof v.reason!=='string'||typeof v.actor!=='string'||!Number.isFinite(Date.parse(v.createdAt))||(v.purchaseDate!==null&&!validDate(v.purchaseDate)))throw new ContractError('采购记录不完整。');
 const out={id:id(v.id),equipmentId:id(v.equipmentId),version:version(v.version),purchaseDate:v.purchaseDate,amountCents:v.amountCents===null?null:cents(v.amountCents),supplier:v.supplier,expenseId:v.expenseId===null?null:id(v.expenseId),expenseSnapshot:v.expenseSnapshot===null?null:expense(v.expenseSnapshot),equipmentSnapshot:equipment(v.equipmentSnapshot),reason:v.reason,actor:v.actor,createdAt:v.createdAt};
 if(out.equipmentSnapshot.id!==owner||(out.expenseId===null)!==(out.expenseSnapshot===null)||(out.expenseId&&out.expenseId!==out.expenseSnapshot.id))throw new ContractError('采购记录的来源不匹配。');return out;
}
export function equipmentPurchaseState(v,owner){
 if(!object(v)||typeof v.sourceChanged!=='boolean')throw new ContractError('采购资料不完整。');
 const out={equipment:equipment(v.equipment),record:v.record===null?null:record(v.record,owner),linkedExpense:v.linkedExpense===null?null:expense(v.linkedExpense),sourceChanged:v.sourceChanged};
 if(out.equipment.id!==owner||!!out.record?.expenseId!==!!out.linkedExpense||(out.linkedExpense&&out.linkedExpense.id!==out.record.expenseId)||out.sourceChanged!==(!!out.linkedExpense&&out.linkedExpense.version!==out.record.expenseSnapshot.version))throw new ContractError('关联支出状态不匹配。');return out;
}
export function equipmentPurchaseHistory(v,owner){if(!object(v)||!Array.isArray(v.rows)||v.rows.length>50||!Number.isSafeInteger(v.offset)||v.offset<0||!Number.isSafeInteger(v.total)||v.total<0||v.limit!==50)throw new ContractError('采购历史不完整。');return {...v,rows:v.rows.map(r=>record(r,owner))};}
export function equipmentPurchasePayload(v){
 const keys=['requestKey','expectedVersion','purchaseDate','amount','supplier','expenseId','expenseVersion','reason'];
 if(!object(v)||keys.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k))||(v.purchaseDate!==null&&!validDate(v.purchaseDate))||typeof v.supplier!=='string'||v.supplier.trim().length>150||typeof v.reason!=='string'||!v.reason.trim()||v.reason.trim().length>2000)throw new ContractError('请核对采购资料并填写变更原因。');
 if(v.amount!==null){if(typeof v.amount!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(v.amount))throw new ContractError('金额最多保留两位小数，未知请留空。');const [whole,fraction='']=v.amount.split('.');cents(Number(whole)*100+Number(fraction.padEnd(2,'0')));}
 const out={...v,requestKey:id(v.requestKey),expectedVersion:version(v.expectedVersion,true),supplier:v.supplier.trim(),reason:v.reason.trim()};
 if(v.expenseId!==null){out.expenseId=id(v.expenseId);out.expenseVersion=version(v.expenseVersion);}else if(v.expenseVersion!==null)throw new ContractError('请核对关联支出版本。');return out;
}
export function equipmentPurchaseResult(v,owner){if(!object(v)||v.id!==owner)throw new ContractError('采购资料回执不匹配。');return {id:id(v.id),recordId:id(v.recordId),version:version(v.version)};}
