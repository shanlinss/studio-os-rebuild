import type {TransactionSql} from 'postgres';
import {inventoryCostSources,priceInventorySources,roundedCost} from './inventory-cost-sources';
export async function inventoryCostSummary(tx:TransactionSql,month:string){
 const sources=await inventoryCostSources(tx),priced=priceInventorySources(sources,month);
 const changedByItem=new Set(sources.filter(r=>r.day.slice(0,7)<=month&&r.sourceChanged).map(r=>r.itemId));
 const rows=priced.filter(r=>r.mode==='automatic'||r.mode==='outflow'||r.mode==='asset').map(r=>({id:r.id,itemId:r.itemId,kind:r.kind,mode:r.mode,day:r.day,consumptionId:r.consumptionId??null,
  storeId:r.mode==='automatic'?r.usedStoreId:r.costStoreId??null,scope:r.mode==='automatic'?'store':r.scope??'unclassified',
  exact:r.priced?.exactCost??null,costCents:roundedCost(r.priced?.exactCost??null),expenseId:r.expenseId??null,expenseSnapshot:r.expenseSnapshot??null,
  expenseLinkedElsewhere:r.expenseLinkedElsewhere,sourceChanged:changedByItem.has(r.itemId),snapshot:r.snapshot}));
 const losses=await tx`SELECT id FROM studio_os.shooting_sample_events WHERE action='stocktake' AND quantity_delta<0 AND to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM')=${month}`;
 return [...rows,...losses.map(r=>({id:r.id,mode:'sample-loss',scope:'unclassified',storeId:null,exact:null,costCents:null}))];
}
