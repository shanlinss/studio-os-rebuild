import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {fraction,plus,type Fraction} from './product-cost-engine';
import {inventoryCostSources,priceInventorySources,roundedCost} from './inventory-cost-sources';
const exact=(v:Fraction|null)=>v?{n:String(v.n),d:String(v.d)}:null;
// All sample assets, including borrowed units, remain in the same original sample cost pool.
// Borrow/return events do not enter the replay and never reset or consume asset value.
export function replaySampleCosts(sources:any[],month:string){
 const pools=new Map<string,{quantity:number,value:Fraction|null,changed:boolean,chain:any[],name:string}>(),rows:any[]=[];
 for(const r of [...sources].sort((a,b)=>a.postedAt.localeCompare(b.postedAt)||a.id.localeCompare(b.id))){
  if(r.day.slice(0,7)>month)continue;
  if(!pools.has(r.sampleId))pools.set(r.sampleId,{quantity:0,value:fraction(0n),changed:false,chain:[],name:r.snapshot.name});
  const pool=pools.get(r.sampleId)!;let cost:Fraction|null=null;
  if(r.delta>0){cost=r.mode==='transfer'?(r.transferExact?fraction(BigInt(r.transferExact.n),BigInt(r.transferExact.d)):null):r.amountCents!==null?fraction(BigInt(r.amountCents)):null;
   pool.value=cost&&pool.value?plus(pool.value,cost):null;pool.quantity+=r.delta;pool.changed=pool.changed||r.basisChanged;
  }else {cost=pool.quantity>=-r.delta&&pool.quantity>0&&pool.value?fraction(pool.value.n*BigInt(-r.delta),pool.value.d*BigInt(pool.quantity)):null;pool.quantity+=r.delta;pool.value=cost&&pool.value?plus(pool.value,fraction(-cost.n,cost.d)):null;}
  pool.name=r.snapshot.name;pool.chain.push({id:r.id,delta:r.delta,exact:exact(cost),basisVersion:r.mode==='basis'?r.version:null,changed:r.basisChanged});
  const costToken=createHash('sha256').update(JSON.stringify(pool.chain)).digest('hex'),sourceChanged=pool.changed;
  const row={...r,exact:exact(cost),costCents:roundedCost(exact(cost)),sourceChanged:sourceChanged||r.expenseChanged===true,costToken,attributionChanged:r.mode==='outflow'&&r.eventSnapshot?.costToken!==costToken};
  if(r.day.startsWith(month))rows.push(row);
  if(pool.quantity===0){pool.value=fraction(0n);pool.changed=false;pool.chain=[];} // A fully depleted pool starts afresh on the next real addition.
 }
 const balances=[...pools].map(([sampleId,p])=>({sampleId,name:p.name,quantity:p.quantity,costCents:p.changed?null:roundedCost(exact(p.value)),sourceChanged:p.changed}));
 let sum:Fraction|null=fraction(0n);for(const p of pools.values())sum=sum&&p.value&&!p.changed?plus(sum,p.value):null;
 return {rows,balances,assetCents:roundedCost(exact(sum)),pendingAssets:balances.filter(r=>r.costCents===null).length};
}
export async function sampleCostSources(tx:TransactionSql,sampleId?:string):Promise<any[]>{
 const rows=await tx`SELECT e.id,e.sample_id AS "sampleId",e.action,e.quantity_delta AS delta,
  (e.created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day,to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "postedAt",
  jsonb_build_object('name',coalesce(e.after_value->>'name',s.name),'unit','件','location',e.after_value->>'warehouse_location') AS snapshot,e.note,
  t.movement_id AS "movementId",v.version,v.amount_cents AS "amountCents",v.scope,v.store_id AS "storeId",v.loss_kind AS "lossKind",v.expense_id AS "expenseId",v.expense_snapshot AS "expenseSnapshot",v.event_snapshot AS "eventSnapshot",
  coalesce(x.version<>(v.expense_snapshot->>'version')::int,false) AS "basisChanged",
  EXISTS(SELECT 1 FROM studio_os.operating_finance_records f JOIN LATERAL(SELECT status FROM studio_os.operating_finance_versions z WHERE z.record_id=f.id ORDER BY version DESC LIMIT 1) z ON true WHERE f.expense_id=v.expense_id AND z.status='active') AS "expenseLinkedElsewhere"
  FROM studio_os.shooting_sample_events e JOIN studio_os.shooting_samples s ON s.id=e.sample_id
  LEFT JOIN studio_os.warehouse_sample_transfers t ON t.sample_event_id=e.id
  LEFT JOIN LATERAL(SELECT * FROM studio_os.sample_cost_evidence_versions v WHERE v.event_id=e.id ORDER BY version DESC LIMIT 1) v ON true
  LEFT JOIN studio_os.expense_records x ON x.id=v.expense_id
  WHERE e.action IN('stock-in','stocktake') AND e.quantity_delta<>0 AND (${sampleId??null}::uuid IS NULL OR s.id=${sampleId??null})`;
 const transfers=rows.filter(r=>r.movementId),byMovement=new Map<string,any>();
 if(transfers.length){const inventory=await inventoryCostSources(tx),ids=new Set(transfers.map(r=>r.movementId)),months=new Set(inventory.filter(r=>ids.has(r.id)).map(r=>r.day.slice(0,7)));
  for(const month of months)for(const row of priceInventorySources(inventory,month))if(row.mode==='asset')byMovement.set(row.id,{exact:row.priced?.exactCost??null,changed:inventory.some(r=>r.itemId===row.itemId&&r.day<=row.day&&r.sourceChanged)});
 }
 return rows.map(r=>({...r,expenseChanged:r.basisChanged,mode:r.movementId?'transfer':r.delta>0?'basis':'outflow',transferExact:byMovement.get(r.movementId)?.exact??null,
  basisChanged:r.delta>0&&(r.movementId?byMovement.get(r.movementId)?.changed??false:r.basisChanged)}));
}
export async function sampleCostSummary(tx:TransactionSql,month:string){
 return replaySampleCosts(await sampleCostSources(tx),month).rows.filter(r=>r.mode==='outflow').map(r=>({id:r.id,mode:'sample-loss',sourceKind:'sample-cost',scope:r.scope??'unclassified',storeId:r.storeId??null,exact:r.exact,costCents:r.costCents,sourceChanged:r.sourceChanged||r.attributionChanged,expenseId:r.expenseId,expenseSnapshot:r.expenseSnapshot,expenseLinkedElsewhere:r.expenseLinkedElsewhere}));
}
