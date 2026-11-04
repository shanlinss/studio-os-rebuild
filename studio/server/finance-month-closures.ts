import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,longText} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {financeReviewEvidence} from './finance-month-review';
import {cashMonthEvidence} from './cash-correspondence';
const canonical=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const version=(v:any)=>{if(!Number.isSafeInteger(v)||v<0||v>=2147483647)throw new BadRequestException();return Number(v);};
export async function financeClosureHead(tx:TransactionSql,month:string){const [r]=await tx`SELECT id,month,version,action,previous_id AS "previousId",source_hash AS "sourceHash",snapshot,coverage_confirmed AS "coverageConfirmed",review_confirmed AS "reviewConfirmed",reason,actor_name AS actor,created_at AS "createdAt" FROM studio_os.finance_month_closures WHERE month=${month} ORDER BY version DESC LIMIT 1`;return r??null;}
export async function financeClosingCandidate(tx:TransactionSql,month:string){
 const e=await financeReviewEvidence(tx,month),relevantMovements=e.inventory.filter(r=>r.day.slice(0,7)<=month),samples=e.sampleSources.filter(r=>r.day.slice(0,7)<=month);
 const expenseIds=[...new Set([...e.data.expenses.filter(r=>r.month===month).map(r=>r.id),...relevantMovements.flatMap(r=>[r.expenseId,r.purchaseExpenseId]).filter(Boolean),...samples.map(r=>r.expenseId).filter(Boolean)])].sort();
 const sources={...e.data,stores:e.data.stores.filter(s=>e.overview.rows.some(r=>r.storeId===s.id)||(e.scope?.stores??[]).some((r:any)=>r.id===s.id)),expenses:e.data.expenses.filter(r=>expenseIds.includes(r.id)),movements:e.data.movements.filter(r=>r.day.slice(0,7)<=month),feeExpenseLinks:e.data.feeExpenseLinks.filter(r=>expenseIds.includes(r.expenseId))};
 const reimbursements=await tx`SELECT id,payer_id AS "payerId",settlement_id AS "settlementId",paid_date::text AS "paidDate",amount_cents AS "amountCents" FROM studio_os.expense_reimbursements ORDER BY id`;
 const expenseFacts=await tx`SELECT e.id,e.version,e.expense_date::text AS "expenseDate",e.description,e.amount_cents AS "amountCents",e.payment_mode AS "paymentMode",e.payer_id AS "payerId",e.store_id AS "storeId",e.expense_scope AS "expenseScope",e.expense_use AS "expenseUse",e.note FROM studio_os.expense_records e WHERE e.id=ANY(${tx.array(expenseIds)}::uuid[]) ORDER BY e.id`;
 const settlements=await tx`SELECT s.id,s.payer_id AS "payerId",s.start_date::text AS "startDate",s.end_date::text AS "endDate",s.version,(SELECT coalesce(jsonb_agg(jsonb_build_object('expenseId',i.expense_id,'amountCents',i.amount_cents) ORDER BY i.expense_id),'[]'::jsonb) FROM studio_os.expense_settlement_items i WHERE i.settlement_id=s.id) AS items FROM studio_os.expense_settlements s ORDER BY s.id`;
 const snapshot={expenseFacts,settlements,reimbursements,schemaVersion:1,month,scope:e.scope,overview:e.overview,sources,inventory:relevantMovements,sampleSources:samples,sampleBalances:e.samples.balances,issues:e.issues,counts:e.report.counts,expenseIds,cash:await cashMonthEvidence(tx,month),basis:'platform-withdrawable-net-goods-separate-public-once',cashBasis:'recorded-at-closing-not-bank-balance',checkedAt:e.report.checkedAt};
 const {checkedAt,...stable}=snapshot;return {snapshot,sourceHash:hash(stable),ready:e.report.recordedSourcesReady};
}
export class FinanceMonthClosures{
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','offset']),month=attendanceMonth(q.month),offset=Number(q.offset??0);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const record=await financeClosureHead(tx,month),candidate=record?.action==='lock'?null:await financeClosingCandidate(tx,month),history=await tx`SELECT id,version,action,source_hash AS "sourceHash",reason,actor_name AS actor,created_at AS "createdAt" FROM studio_os.finance_month_closures WHERE month=${month} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`,[count]=await tx`SELECT count(*)::int AS total FROM studio_os.finance_month_closures WHERE month=${month}`;return {month,record,candidate,history:{rows:history,total:count.total,offset,limit:50}};});
 }
 async detail(who:Identity,id:string){await currentPermission(this.db,who,'finance');id=uuid(id);const [r]=await this.db.client`SELECT id,month,version,action,previous_id AS "previousId",source_hash AS "sourceHash",snapshot,coverage_confirmed AS "coverageConfirmed",review_confirmed AS "reviewConfirmed",reason,actor_name AS actor,created_at AS "createdAt" FROM studio_os.finance_month_closures WHERE id=${id}`;if(!r)throw new NotFoundException();return r;}
 async action(who:Identity,value:unknown){
  const b=objectInput(value,['requestKey','month','action','expectedVersion','sourceHash','coverageConfirmed','reviewConfirmed','reason']),key=uuid(b.requestKey),month=attendanceMonth(b.month),expected=version(b.expectedVersion),reason=longText(b.reason,2000).trim();
  if(!reason||typeof b.action!=='string'||!['lock','reopen'].includes(b.action)||typeof b.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceHash)||typeof b.coverageConfirmed!=='boolean'||typeof b.reviewConfirmed!=='boolean'||b.action==='lock'&&(!b.coverageConfirmed||!b.reviewConfirmed))throw new BadRequestException();
  const action=b.action as string,coverage=b.coverageConfirmed as boolean,review=b.reviewConfirmed as boolean;
  const requestHash=hash({month,expected,reason,action:b.action,sourceHash:b.sourceHash,coverageConfirmed:b.coverageConfirmed,reviewConfirmed:b.reviewConfirmed});
  return this.db.client.begin(async tx=>{
   // Acquire before permissions or source rows, so closing never observes a half-finished source transaction.
   await tx`SELECT pg_advisory_xact_lock(hashtextextended('studio-finance-closing',0))`;
   const actor=await livePermission(tx,who.id,'finance'),[old]=await tx`SELECT month,action,request_hash,result FROM studio_os.finance_month_closure_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.month!==month||old.action!==b.action||old.request_hash!==requestHash)throw new ConflictException();return old.result;}
   const head=await financeClosureHead(tx,month);if((head?.version??0)!==expected)throw new ConflictException('月结状态已变化');
   let snapshot:any,sourceHash:string;
   if(b.action==='lock'){
    if(head?.action==='lock')throw new ConflictException('本月已经锁定');const candidate=await financeClosingCandidate(tx,month);if(!candidate.ready||candidate.sourceHash!==b.sourceHash)throw new ConflictException('来源未齐全或已有变化，请重新检查');snapshot=candidate.snapshot;sourceHash=candidate.sourceHash;
   }else{if(head?.action!=='lock'||head.sourceHash!==b.sourceHash)throw new ConflictException('本月未锁定或版本已变化');snapshot=head.snapshot;sourceHash=head.sourceHash;}
   const [r]=await tx`INSERT INTO studio_os.finance_month_closures(month,version,action,previous_id,source_hash,snapshot,coverage_confirmed,review_confirmed,reason,actor_id,actor_name) VALUES(${month},${expected+1},${action},${head?.id??null},${sourceHash},${JSON.stringify(snapshot)}::jsonb,${coverage},${review},${reason},${who.id},${actor.username}) RETURNING id,version`;
   const result={id:r.id,month,version:r.version,action:b.action};await tx`INSERT INTO studio_os.finance_month_closure_receipts(actor_id,request_key,month,action,request_hash,result) VALUES(${who.id},${key},${month},${action},${requestHash},${JSON.stringify(result)}::jsonb)`;return result;
  });
 }
 async receipt(who:Identity,key:string,month:string){await currentPermission(this.db,who,'finance');key=uuid(key);month=attendanceMonth(month);const [r]=await this.db.client`SELECT result FROM studio_os.finance_month_closure_receipts WHERE actor_id=${who.id} AND request_key=${key} AND month=${month}`;if(!r)throw new NotFoundException();return r.result;}
}
