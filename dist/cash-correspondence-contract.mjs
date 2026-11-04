import {ContractError,validDate} from './cloud-contract.mjs';
import {costMonth} from './product-cost-contract.mjs';
const fail=()=>{throw new ContractError('资金到账或付款对应资料不完整，请重新核对。');};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))fail();return v;};
const integer=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>2147483647)fail();return v;};
const cents=(v,signed=false)=>{if(typeof v!=='string'||!(signed?/^-?\d+$/:/^\d+$/).test(v))fail();return v;};
const money=v=>{if(typeof v!=='string'||!/^\d{1,8}(?:\.\d{1,2})?$/.test(v))fail();const [a,b='']=v.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));integer(n,1);return n;};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail();return v.trim();};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))fail();};
function row(r){id(r.id);if(!['in','out'].includes(r.direction)||!['active','void'].includes(r.status)||!validDate(r.paidDate)||typeof r.description!=='string')fail();return r;}
export function cashPage(v){if(!v||!Array.isArray(v.rows)||v.rows.length>50||v.limit!==50||!v.summary)fail();integer(v.total);integer(v.offset);costMonth(v.month);for(const r of v.rows){row(r);if(!['manual','reimbursement'].includes(r.origin))fail();cents(r.amountCents);cents(r.unmatchedCents);}for(const k of ['inCents','outCents','reimbursementCents','unmatchedCents'])cents(v.summary[k]);return v;}
export function cashSourcePage(v){if(!v||!Array.isArray(v.rows)||v.rows.length>50||v.limit!==50||!['income','expense'].includes(v.kind))fail();integer(v.total);integer(v.offset);costMonth(v.month);for(const r of v.rows){if(r.kind==='income')id(r.storeId);else id(r.expenseId);integer(r.version,1);if(typeof r.key!=='string'||typeof r.label!=='string')fail();integer(Math.abs(r.amountCents));cents(r.cashCents);cents(r.differenceCents,true);}return v;}
function savedLine(l){if(!l||!['income','expense'].includes(l.kind)||typeof l.key!=='string'||!l.snapshot||typeof l.snapshot.label!=='string')fail();integer(l.amountCents,1);integer(l.snapshot.version,1);if(l.kind==='income'){id(l.storeId);costMonth(l.month);if(l.expenseId!==null||l.key!==`income:${l.storeId}:${l.month}`)fail();}else{if(l.storeId!==null||l.month!==null||l.key!==`expense:${l.expenseId}`)fail();id(l.expenseId);}return l;}
export function cashState(v,owner){
 if(!v||v.record?.id!==owner||!Array.isArray(v.matches)||!v.history||!Array.isArray(v.history.rows)||v.history.rows.length>50||v.history.limit!==50)fail();const r=v.record;row(r);text(r.accountLabel,100);text(r.sourceReference,200);integer(r.version,1);integer(r.amountCents,1);
 if(!Array.isArray(r.lines)||r.lines.length>50||r.lines.length!==v.matches.length)fail();r.lines.forEach(savedLine);
 for(const [i,m] of v.matches.entries()){savedLine(m.line);if(m.line.key!==r.lines[i].key||m.line.amountCents!==r.lines[i].amountCents||typeof m.sourceChanged!=='boolean'||typeof m.overmatched!=='boolean')fail();if(m.current!==null){if(m.current.key!==m.line.key||typeof m.current.label!=='string')fail();integer(m.current.version,1);integer(Math.abs(m.current.amountCents));}cents(m.cashCents);if(m.differenceCents!==null)cents(m.differenceCents,true);}
 cents(v.unmatchedCents);if(BigInt(v.unmatchedCents)!==BigInt(r.amountCents)-r.lines.reduce((n,l)=>n+BigInt(l.amountCents),0n))fail();integer(v.history.total);integer(v.history.offset);
 for(const r of v.history.rows){id(r.id);integer(r.version,1);integer(r.amountCents,1);if(!['active','void'].includes(r.status)||!validDate(r.paidDate)||!Array.isArray(r.lines)||!Number.isFinite(Date.parse(r.createdAt)))fail();r.lines.forEach(savedLine);}return v;
}
export function cashPayload(v,editing=false){
 fields(v,['requestKey',...(editing?['expectedVersion']:['direction','accountLabel','sourceReference']),'paidDate','amount','description','lines','reason']);
 if(!validDate(v.paidDate)||!Array.isArray(v.lines)||v.lines.length>50)fail();const total=money(v.amount),keys=new Set();let used=0n;
 const lines=v.lines.map(r=>{fields(r,['kind','storeId','month','expenseId','amount','sourceVersion']);if(!['income','expense'].includes(r.kind))fail();if(r.kind==='income'){id(r.storeId);costMonth(r.month);if(r.expenseId!==null)fail();}else{if(r.storeId!==null||r.month!==null)fail();id(r.expenseId);}integer(r.sourceVersion,1);used+=BigInt(money(r.amount));const key=r.kind==='income'?r.kind+':'+r.storeId+':'+r.month:r.kind+':'+r.expenseId;if(keys.has(key))fail();keys.add(key);return {...r};});
 if(used>BigInt(total))fail();const result={requestKey:id(v.requestKey),paidDate:v.paidDate,amount:v.amount,description:text(v.description,500),reason:text(v.reason,2000),lines};
 if(editing){integer(v.expectedVersion,1);if(v.expectedVersion>=2147483647)fail();return {...result,expectedVersion:v.expectedVersion};}
 if(!['in','out'].includes(v.direction)||lines.some(l=>(v.direction==='in')!==(l.kind==='income')))fail();return {...result,direction:v.direction,accountLabel:text(v.accountLabel,100),sourceReference:text(v.sourceReference,200)};
}
export function cashVoidPayload(v){fields(v,['requestKey','expectedVersion','reason']);integer(v.expectedVersion,1);if(v.expectedVersion>=2147483647)fail();return {requestKey:id(v.requestKey),expectedVersion:v.expectedVersion,reason:text(v.reason,2000)};}
