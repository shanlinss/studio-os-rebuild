import {ContractError} from './cloud-contract.mjs';
export function cents(value){
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)throw new ContractError();return BigInt(value);}
 if(typeof value==='string'&&/^\d+$/.test(value))return BigInt(value);
 throw new ContractError('金额数据暂时无法读取。');
}
export function money(value){const n=cents(value);return '¥'+(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');}
export function financeRecord(value){
 if(!value||typeof value!=='object'||['categories','stores','members','records','settlements','payments'].some(k=>!Array.isArray(value[k])))throw new ContractError();
 const ids=new Set();for(const row of value.records){if(typeof row.id!=='string'||ids.has(row.id))throw new ContractError();ids.add(row.id);cents(row.amountCents);if(row.expenseScope!==undefined||row.expenseUse!==undefined){if(!['public','store','unclassified'].includes(row.expenseScope)||!['operating','inventory','prepaid','unclassified'].includes(row.expenseUse)||row.expenseScope==='public'&&row.storeId!==null||row.expenseScope==='store'&&!row.storeId)throw new ContractError('费用归属或用途不完整。');}if(row.receipts!==undefined&&(!Array.isArray(row.receipts)||row.receipts.some(r=>!r||typeof r.id!=='string'||typeof r.name!=='string'||!['image/png','image/jpeg','image/gif','image/webp'].includes(r.mime)||!Number.isSafeInteger(r.size)||r.size<1||r.size>10485760)))throw new ContractError('凭证列表不完整，请重新读取支出。');}
 const settlements=value.settlements.map(s=>{const total=cents(s.totalCents),paid=cents(s.paidCents);if(paid>total)throw new ContractError('结算付款金额超过了明细，请核对原记录。');return {...s,remainingCents:(total-paid).toString()};});
 for(const payment of value.payments)cents(payment.amountCents);
 return {...value,settlements};
}
export function outstandingAdvance(value){
 const data=financeRecord(value);
 const unassigned=data.records.filter(r=>r.paymentMode==='advance'&&!r.settlementId).reduce((n,r)=>n+cents(r.amountCents),0n);
 const inStatements=data.settlements.reduce((n,s)=>n+cents(s.remainingCents),0n);
 return {unassigned:unassigned.toString(),inStatements:inStatements.toString(),total:(unassigned+inStatements).toString()};
}
export function pagedRows(value){if(!value||!Array.isArray(value.rows)||!Number.isSafeInteger(value.total)||value.total<0||!Number.isSafeInteger(value.offset)||value.offset<0||!Number.isSafeInteger(value.limit)||value.limit<1)throw new ContractError();return value;}
export function visibleExecutionSummary(rows){
 const targets=rows.filter(t=>t.kind==='publication');
 const total=key=>targets.some(t=>!Number.isSafeInteger(t[key])||t[key]<0)?null:targets.reduce((n,t)=>n+BigInt(t[key]),0n).toString();
 return {taskCount:targets.length,published:total('publishedCount'),filled:total('filledCount'),target:total('targetCount')};
}
