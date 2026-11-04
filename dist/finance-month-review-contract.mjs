import {ContractError} from './cloud-contract.mjs';
import {costMonth} from './product-cost-contract.mjs';
export const reviewSections={period:'月份状态',scope:'经营店铺范围',income:'收入确认',costs:'经营成本',assets:'库存与样品资产',cash:'实际资金对应',advances:'累计待报销'};
const fail=()=>{throw new ContractError('月度检查资料不完整，请刷新核对。');};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const int=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>2147483647)fail();return v;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail();return v.trim();};
function stores(rows){if(!Array.isArray(rows))fail();const seen=new Set();for(const s of rows){id(s.id);text(s.name,150);if(seen.has(s.id))fail();seen.add(s.id);}return rows;}
function page(p){if(!p||!Array.isArray(p.rows)||p.rows.length>50||p.limit!==50)fail();int(p.total);int(p.offset);if(p.rows.length>Math.max(0,p.total-p.offset))fail();}
function version(r){id(r.id);int(r.version,1);text(r.reason,2000);text(r.actor,100);if(!Number.isFinite(Date.parse(r.createdAt)))fail();stores(r.stores);}
export function scopeState(v,month){if(!v||v.month!==month)fail();stores(v.stores);for(const s of v.stores)if(typeof s.active!=='boolean'||!/^\d{4}-\d\d-\d\d$/.test(s.registeredDate))fail();if(v.record!==null)version(v.record);page(v.history);v.history.rows.forEach(version);return v;}
export function scopePayload(v){if(!v||Object.keys(v).some(k=>!['requestKey','month','expectedVersion','storeIds','reason'].includes(k))||!Array.isArray(v.storeIds)||v.storeIds.length>1000||new Set(v.storeIds).size!==v.storeIds.length||v.expectedVersion>=2147483647)fail();return {requestKey:id(v.requestKey),month:costMonth(v.month),expectedVersion:int(v.expectedVersion),storeIds:v.storeIds.map(id),reason:text(v.reason,2000)};}
export function scopeResult(v,month){if(!v||v.month!==month)fail();id(v.recordId);int(v.version,1);return v;}
const kinds=['period','scope','income','expense','operating','stock','dropship','packaging','inventory','sample-cost','sample','product-purchase','product-opening','cash','income-cash','advances'];
export function monthReview(v,month){
 if(!v||v.month!==month||v.mode!=='recorded-sources-review'||!Number.isFinite(Date.parse(v.checkedAt))||!['all',...Object.keys(reviewSections)].includes(v.section)||!['all','blocker','review'].includes(v.severity))fail();page(v);
 if(!v.counts?.sections||typeof v.recordedSourcesReady!=='boolean')fail();int(v.counts.blocker);int(v.counts.review);for(const s of Object.keys(reviewSections))int(v.counts.sections[s]);if(Object.values(v.counts.sections).reduce((a,b)=>a+b,0)!==v.counts.blocker+v.counts.review||v.recordedSourcesReady!==(v.counts.blocker===0))fail();
 if(v.scope!==null){int(v.scope.version,1);stores(v.scope.stores);}
 for(const r of v.rows){if(!Object.hasOwn(reviewSections,r.section)||!['blocker','review'].includes(r.severity)||!kinds.includes(r.kind))fail();if(['period','scope'].includes(r.kind)){if(r.id!==month)fail();}else id(r.id);if(r.storeId!=null)id(r.storeId);text(r.label,2000);if(r.amountCents!==undefined&&(typeof r.amountCents!=='string'||!/^[-]?\d+$/.test(r.amountCents)))fail();if(v.section!=='all'&&r.section!==v.section||v.severity!=='all'&&r.severity!==v.severity)fail();}
 return v;
}
