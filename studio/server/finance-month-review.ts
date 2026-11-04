import {BadRequestException} from '@nestjs/common';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission} from './permissions';
import {objectInput} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {operatingSources} from './operating-overview';
import {operatingOverview} from './operating-overview-model';
import {monthScope} from './finance-month-scope';
import {inventoryCostSources} from './inventory-cost-sources';
import {movingCosts} from './product-cost-engine';
import {sampleCostSources,replaySampleCosts} from './sample-cost-sources';
import {cashMonthEvidence,matchedIncomeCents} from './cash-correspondence';
export const reviewSections=['period','scope','income','costs','assets','cash','advances'] as const;
export function reviewPage(items:any[],section:string,severity:string,offset:number){
 const unique=[...new Map(items.map(r=>[JSON.stringify([r.section,r.kind,r.id,r.storeId??null,r.label]),r])).values()].sort((a,b)=>reviewSections.indexOf(a.section)-reviewSections.indexOf(b.section)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)||a.label.localeCompare(b.label));
 const filtered=unique.filter(r=>(section==='all'||r.section===section)&&(severity==='all'||r.severity===severity));
 return {rows:filtered.slice(offset,offset+50),total:filtered.length,offset,limit:50,counts:{blocker:unique.filter(r=>r.severity==='blocker').length,review:unique.filter(r=>r.severity==='review').length,sections:Object.fromEntries(reviewSections.map(s=>[s,unique.filter(r=>r.section===s).length]))},recordedSourcesReady:!unique.some(r=>r.severity==='blocker')};
}
export class FinanceMonthReview{
 constructor(private readonly db:StudioDatabase){}
 async read(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','section','severity','offset']),month=attendanceMonth(q.month),section=String(q.section??'all'),severity=String(q.severity??'all'),offset=Number(q.offset??0);
  if(!['all',...reviewSections].includes(section as any)||!['all','blocker','review'].includes(severity)||!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   return (await financeReviewEvidence(tx,month,section,severity,offset)).report;
  });
 }
}

export async function financeReviewEvidence(tx:TransactionSql,month:string,section='all',severity='all',offset=0){
   const [clock]=await tx`SELECT (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date::text AS today,clock_timestamp() AS checked`;
   const items:any[]=[],add=(section:string,kind:string,id:string,label:string,extra:any={})=>items.push({section,kind,id,label,severity:'blocker',...extra});
   const data=await operatingSources(tx,month),overview=operatingOverview(data,month,r=>{if(r.kind!=='unassigned')add('costs',r.kind,r.id,r.label,{storeId:r.storeId});}),scope=await monthScope(tx,month);
   if(month>=clock.today.slice(0,7))add('period','period',month,'该月份尚未结束，当前检查仅供日常补录');
   if(!scope)add('scope','scope',month,'尚未确认本月实际经营的店铺范围');
   const scoped=new Set<string>((scope?.stores??[]).map((s:any)=>s.id));
   for(const s of scope?.stores??[]){const income=data.incomes.find(r=>r.storeId===s.id);if(income?.status!=='confirmed')add('income','income',s.id,s.name+'：本月收入尚未确认（实际为零也需确认）',{storeId:s.id});}
   if(scope)for(const r of overview.rows)if(!scoped.has(r.storeId))add('scope','scope',month,r.name+'：本月已有业务来源，但未纳入已确认范围',{storeId:r.storeId});
   const inventory=await inventoryCostSources(tx),groups=new Map<string,any[]>();for(const r of inventory){if(!groups.has(r.itemId))groups.set(r.itemId,[]);groups.get(r.itemId)!.push(r);}
   for(const rows of groups.values()){
    const replay=movingCosts(rows as any,month);if(replay.quantity<=0)continue;
    const ordered=rows.filter(r=>r.day.slice(0,7)<=month&&!r.duplicateOpening&&!r.internalTransfer).sort((a,b)=>a.day.localeCompare(b.day)||a.postedAt.localeCompare(b.postedAt)||a.id.localeCompare(b.id));
    let quantity=0,chain:any[]=[];for(const r of ordered){quantity+=r.delta;chain.push(r);if(quantity===0)chain=[];}
    if(replay.balanceAmount!==null&&!chain.some(r=>r.sourceChanged))continue;
    const missing=chain.filter(r=>r.delta>0&&(r.totalCents===null||r.sourceChanged)),candidates=missing.length?missing:chain.slice(-1);
    for(const r of candidates){const kind=r.actualSkuId&&r.type==='opening'?'product-opening':r.kind==='product'&&r.documentOperation==='inbound'?'product-purchase':r.actualSkuId?'stock':'inventory',id=kind==='product-opening'||kind==='stock'?r.actualSkuId:kind==='product-purchase'?r.productDocumentId:r.id;
     add('assets',kind,id,String(r.snapshot.name??'库存')+'：月末仍有库存，成本依据缺失或需重核',{quantity:replay.quantity,itemId:r.itemId});}
   }
   const sampleSources=await sampleCostSources(tx),samples=replaySampleCosts(sampleSources,month);
   for(const b of samples.balances.filter(b=>b.quantity>0&&b.costCents===null)){
    const rows=sampleSources.filter(r=>r.sampleId===b.sampleId&&r.day.slice(0,7)<=month).sort((a,b)=>a.postedAt.localeCompare(b.postedAt)||a.id.localeCompare(b.id));let quantity=0,chain:any[]=[];for(const r of rows){quantity+=r.delta;chain.push(r);if(quantity===0)chain=[];}
    const missing=chain.filter(r=>r.delta>0&&(r.basisChanged||(r.mode==='transfer'?!r.transferExact:r.amountCents===null)));
    for(const r of missing.length?missing:chain.slice(-1))add('assets',r.movementId?'inventory':'sample-cost',r.movementId??r.id,b.name+'：保留的样品资产缺少成本依据或需重核',{quantity:b.quantity,sampleId:b.sampleId});
   }
   for(const r of await cashMonthEvidence(tx,month)){
    if(r.matches.some((m:any)=>m.sourceChanged||m.overmatched))add('cash','cash',r.id,'资金对应的原来源已有变化或付款对应超额，请重核',{severity:'review'});
    if(r.paidDate.startsWith(month)&&r.unmatchedCents!=='0')add('cash','cash',r.id,'本月实际资金还有未对应金额',{severity:'review',amountCents:r.unmatchedCents});
   }
   for(const r of data.incomes.filter(r=>r.status==='confirmed'&&scoped.has(r.storeId))){const matched=await matchedIncomeCents(tx,r.storeId,month),difference=(BigInt(r.amountCents)-BigInt(matched)).toString();if(difference!=='0')add('cash','income-cash',r.storeId,'已录资金对应差额，仅供核对（不代表欠款或额外费用）',{severity:'review',storeId:r.storeId,amountCents:difference});}
   // Original reimbursement balances are cumulative. Never allocate a mixed-month statement back into this month.
   const advances=await tx`SELECT m.id,m.display_name AS name,((SELECT coalesce(sum(e.amount_cents),0) FROM studio_os.expense_records e WHERE e.payer_id=m.id AND e.payment_mode='advance')-(SELECT coalesce(sum(p.amount_cents),0) FROM studio_os.expense_reimbursements p WHERE p.payer_id=m.id))::text AS cents FROM studio_os.members m WHERE EXISTS(SELECT 1 FROM studio_os.expense_records e WHERE e.payer_id=m.id AND e.payment_mode='advance') ORDER BY m.id`;
   for(const a of advances)if(a.cents!=='0')add('advances','advances',a.id,a.name+'：当前累计待报销，跨月，非所选月末余额',{severity:'review',amountCents:a.cents});
   const report={month,checkedAt:clock.checked,scope:scope?{version:scope.version,stores:scope.stores}:null,...reviewPage(items,section,severity,offset),section,severity,mode:'recorded-sources-review'};
   return {report,overview,data,scope,inventory,sampleSources,samples,issues:items};
}
