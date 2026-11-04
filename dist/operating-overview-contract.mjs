import {ContractError,validDate} from './cloud-contract.mjs';
import {costMonth} from './product-cost-contract.mjs';
const fail=()=>{throw new ContractError('经营总览资料不完整，请重新核对。');};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const int=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>2147483647)fail();return v;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail();return v.trim();};
const cents=(v,nullable=false)=>{if(nullable&&v===null)return null;if(typeof v!=='string'||!/^[-]?\d+$/.test(v))fail();return v;};
function income(v){id(v.id);int(v.version,1);if(!Number.isSafeInteger(v.amountCents)||Math.abs(v.amountCents)>2147483647||!['confirmed','withdrawn'].includes(v.status)||!Number.isFinite(Date.parse(v.createdAt)))fail();text(v.sourceReference,200);text(v.reason,2000);return v;}
export function monthIncomeState(v,owner,month){if(!v||v.store?.id!==owner||v.month!==month||!v.history||!Array.isArray(v.history.rows)||v.history.limit!==50)fail();int(v.history.total);int(v.history.offset);if(v.record!==null)income(v.record);v.history.rows.forEach(income);return v;}
export function monthIncomePayload(v){
 if(!v||Object.keys(v).some(k=>!['requestKey','expectedVersion','month','amount','sourceReference','reason','status'].includes(k))||typeof v.amount!=='string'||!/^[-]?\d{1,8}(?:\.\d{1,2})?$/.test(v.amount)||Math.abs(Number(v.amount))*100>2147483647||!['confirmed','withdrawn'].includes(v.status)||v.expectedVersion>=2147483647)fail();
 return {requestKey:id(v.requestKey),expectedVersion:int(v.expectedVersion),month:costMonth(v.month),amount:v.amount,sourceReference:text(v.sourceReference,200),reason:text(v.reason,2000),status:v.status};
}
export function overviewRecord(v,month){
 if(!v||v.month!==month||v.mode!=='recorded-sources'||!Array.isArray(v.rows)||!Array.isArray(v.stores)||!v.summary||!Array.isArray(v.publicPending))fail();
 cents(v.publicCents);cents(v.inventoryCents);cents(v.prepaidCents);int(v.publicPendingCount);int(v.summary.storeCount);
 for(const key of ['incomeCents','directCostCents','storeProfitCents','studioProfitCents'])cents(v.summary[key],true);
 for(const s of v.stores){id(s.id);text(s.name,150);if(typeof s.active!=='boolean')fail();}
 const seen=new Set();for(const r of v.rows){id(r.storeId);if(seen.has(r.storeId)||typeof r.active!=='boolean'||!Array.isArray(r.pending)||!Array.isArray(r.sources))fail();seen.add(r.storeId);text(r.name,150);int(r.pendingCount);int(r.sourceCount);for(const key of ['operatingCents','stockCents','dropshipCents','feeCents','directCostCents','profitCents','dailySaleCents','dailyRefundCents'])cents(r[key],true);if(r.income!==null){id(r.income.id);int(r.income.version,1);cents(r.income.amountCents);}}
 if(v.summary.storeCount!==v.rows.length)fail();return v;
}
