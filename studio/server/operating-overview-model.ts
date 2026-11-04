import {movingCosts,fraction,plus,costAmount,type Fraction,type CostMovement} from './product-cost-engine';
const cents=(v:unknown)=>BigInt(String(v));
const signed=(n:bigint)=>n.toString();
function rounded(value:Fraction){const text=costAmount(value)!,negative=text.startsWith('-'),[whole,part]=text.replace('-','').split('.');return (BigInt(whole)*100n+BigInt(part))*(negative?-1n:1n);}
export function operatingOverview(data:{stores:any[],incomes:any[],expenses:any[],fees:any[],daily:any[],dropship:any[],refunds:any[],movements:(CostMovement&{skuId:string})[],packaging:any[],inventoryCosts?:any[],feeExpenseLinks?:any[]},month:string){
 const byStore=new Map(data.stores.map(s=>[s.id,s])),rows=new Map<string,any>(),publicIssues:any[]=[],expenseById=new Map(data.expenses.map(e=>[e.id,e]));
 let sampleAssets=fraction(0n),sampleAssetPending=0;const sampleAssetSources:any[]=[];
 const feeLinks=new Map((data.feeExpenseLinks??data.fees).filter(f=>f.expenseId).map(f=>[f.expenseId,f]));
 let publicInventory=fraction(0n),publicCents=0n,inventoryCents=0n,prepaidCents=0n;
 const get=(id:string)=>{if(!rows.has(id)){const store=byStore.get(id);if(!store)throw Error('Missing store source');rows.set(id,{storeId:id,name:store.name,active:store.active,income:null,operating:0n,stock:fraction(0n),packaging:fraction(0n),otherInventory:fraction(0n),drop:0n,fee:0n,platformFeeReference:0n,dailySale:0n,dailyRefund:0n,pending:[],sources:[]});}return rows.get(id);};
 const issue=(row:any|null,kind:string,id:string,label:string)=>{(row?row.pending:publicIssues).push({kind,id,label});};
 const source=(row:any,kind:string,id:string)=>row.sources.push({kind,id});
 for(const income of data.incomes)if(income.status==='confirmed')get(income.storeId).income={id:income.id,version:income.version,amountCents:String(income.amountCents),sourceReference:income.sourceReference};
 for(const e of data.expenses){if(e.month!==month)continue;const row=e.storeId?get(e.storeId):null;
  const scope=e.expenseScope,use=e.expenseUse,platformFee=feeLinks.get(e.id);
  if(platformFee){const feeRow=get(platformFee.storeId);source(feeRow,'operating',platformFee.id);
   if(platformFee.sourceChanged||scope!=='store'||e.storeId!==platformFee.storeId||use!=='operating'||e.purchaseLinked){issue(feeRow,'operating',platformFee.id,'平台已扣手续费的关联支出版本、用途或店铺归属待核对');if(scope==='public'||row&&row!==feeRow)issue(scope==='public'?null:row,'expense',e.id,'平台扣费引用支出归属或用途不一致，请核对');}
   continue; // Platform net income already includes this charge, even if the expense was recorded in another month.
  }
  if(scope==='unclassified'||use==='unclassified'){issue(scope==='public'?null:row,'expense',e.id,'支出用途或归属待核对');continue;}
  if(use==='inventory'){inventoryCents+=cents(e.amountCents);continue;}if(use==='prepaid'){prepaidCents+=cents(e.amountCents);continue;}
  const target=scope==='public'?null:row;
  if(e.purchaseLinked){issue(target,'expense',e.id,'采购来源仍标为运营费用，需核对以避免重复扣成本');continue;}
  if(target){target.operating+=cents(e.amountCents);source(target,'expense',e.id);}else publicCents+=cents(e.amountCents);
 }
 for(const f of data.fees){const row=get(f.storeId);source(row,'operating',f.id);row.platformFeeReference+=cents(f.amountCents);
  if(f.expenseId){const original=expenseById.get(f.expenseId);
   if(!original||f.sourceChanged||original.expenseScope!=='store'||original.storeId!==f.storeId||original.expenseUse!=='operating'||original.purchaseLinked)issue(row,'operating',f.id,'手续费关联支出的版本、用途或店铺归属待核对');
   // Original evidence remains auditable; valid platform deductions never reduce net income a second time.
  }
 }
 for(const d of data.daily){const row=get(d.storeId);if(d.kind==='sale')row.dailySale+=cents(d.amountCents);else row.dailyRefund+=cents(d.amountCents);}
 for(const d of data.dropship){const row=get(d.storeId);source(row,'dropship',d.documentId);if(d.basis!=='actual')issue(row,'dropship',d.documentId,'代发仍为参考估算，需核实实际成本');else row.drop+=cents(d.amountCents);}
 for(const r of data.refunds){const row=get(r.storeId);row.drop-=cents(r.amountCents);source(row,'dropship',r.documentId);}
 const movements=new Map<string,CostMovement[]>();for(const m of data.movements){if(!movements.has(m.skuId))movements.set(m.skuId,[]);movements.get(m.skuId)!.push(m);}
 for(const [skuId,list]of movements){const result=movingCosts(list,month);
  for(const bucket of result.storeCosts){if(!bucket.storeId){issue(null,'stock',skuId,'商品发货或退货缺少业务店铺');continue;}const row=get(bucket.storeId);source(row,'stock',skuId);
   if(!bucket.exact)issue(row,'stock',skuId,'商品已售成本缺少实际依据');else row.stock=plus(row.stock,fraction(BigInt(bucket.exact.n),BigInt(bucket.exact.d)));
  }
  for(const m of list)if(data.inventoryCosts===undefined&&m.day.startsWith(month)&&!m.internalTransfer&&!m.duplicateOpening&&m.delta<0&&m.operation!=='shipment')issue(null,'stock',skuId,'其他商品出库或盘点的费用归属待核对');
  for(const m of list)if(m.day.slice(0,7)<=month&&m.sourceChanged&&result.storeCosts.length)for(const b of result.storeCosts)if(b.storeId)issue(get(b.storeId),'stock',skuId,'采购引用支出已变化，请核对成本来源版本');
 }
 for(const p of data.packaging)issue(get(p.storeId),'packaging',p.id,'包材领用金额尚未接入经营汇总，需核对成本');
 for(const c of data.inventoryCosts??[]){if(c.mode==='sample-loss'&&!c.sourceKind){issue(null,'sample',c.id,'样品盘亏的成本与费用归属待核对');continue;}if(c.mode==='asset'){sampleAssetSources.push({kind:'inventory',id:c.id});if(c.exact&&!c.sourceChanged)sampleAssets=plus(sampleAssets,fraction(BigInt(c.exact.n),BigInt(c.exact.d)));else sampleAssetPending++;continue;}const row=c.storeId?get(c.storeId):null,target=c.scope==='public'?null:row;
  const sourceKind=c.sourceKind??'inventory',label=c.mode==='sample-loss'?'样品损耗或报废':c.mode==='automatic'?'包材领用':'其他库存出库';
  if(c.scope==='unclassified'||c.scope==='store'&&!row){issue(row,sourceKind,c.id,label+'费用归属待核对');continue;}
  if(!c.exact||c.sourceChanged){issue(target,sourceKind,c.id,label+'成本依据缺失或原来源有新版本');continue;}
  if(c.expenseId){const e=expenseById.get(c.expenseId);if(!e||e.month!==month||c.expenseLinkedElsewhere||e.purchaseLinked||e.expenseUse!=='operating'||e.expenseScope!==c.scope||e.storeId!==c.storeId||e.amountCents.toString()!==c.costCents||c.expenseSnapshot?.version!==e.version)issue(target,sourceKind,c.id,'关联支出的金额、用途、归属或版本待核对');if(target)source(target,sourceKind,c.id);continue;}
  const amount=fraction(BigInt(c.exact.n),BigInt(c.exact.d));
  if(target){if(c.mode==='automatic')target.packaging=plus(target.packaging,amount);else target.otherInventory=plus(target.otherInventory,amount);source(target,sourceKind,c.id);}else publicInventory=plus(publicInventory,amount);
 }
 publicCents+=rounded(publicInventory);
 const unallocated=data.expenses.some(e=>e.month===month&&e.expenseScope==='unclassified'&&!e.storeId)||(data.inventoryCosts??[]).some(c=>c.mode!=='asset'&&c.scope==='unclassified'&&!c.storeId);
 const list=[...rows.values()].map(row=>{
  if(unallocated)issue(row,'unassigned',row.storeId,'存在未归属支出，本店专属成本待核对');
  const stock=rounded(row.stock),packaging=rounded(row.packaging),otherInventory=rounded(row.otherInventory),pending=row.pending as any[],total=row.operating+stock+row.drop+row.fee+packaging+otherInventory;
  const income=row.income?cents(row.income.amountCents):null;
  return {storeId:row.storeId,name:row.name,active:row.active,income:row.income,operatingCents:signed(row.operating),stockCents:pending.some(p=>p.kind==='stock')?null:signed(stock),dropshipCents:pending.some(p=>p.kind==='dropship')?null:signed(row.drop),feeCents:signed(row.fee),platformFeeReferenceCents:signed(row.platformFeeReference),packagingCents:pending.some(p=>p.kind==='inventory')?null:signed(packaging),otherInventoryCents:pending.some(p=>['inventory','sample-cost'].includes(p.kind))?null:signed(otherInventory),directCostCents:pending.length?null:signed(total),profitCents:income===null||pending.length?null:signed(income-total),dailySaleCents:signed(row.dailySale),dailyRefundCents:signed(row.dailyRefund),pendingCount:pending.length,pending:pending.slice(0,50),sourceCount:row.sources.length,sources:row.sources.slice(0,50)};
 }).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const sum=(key:string)=>list.reduce((n,r)=>n+cents((r as any)[key]),0n);
 const complete=list.length>0&&list.every(r=>r.profitCents!==null),shopProfit=complete?sum('profitCents'):null;
 return {sampleAssetTransferCents:sampleAssetPending?null:signed(rounded(sampleAssets)),sampleAssetPending,sampleAssetSourceCount:sampleAssetSources.length,sampleAssetSources:sampleAssetSources.slice(0,50),month,mode:'recorded-sources',rows:list,stores:data.stores,publicCents:signed(publicCents),publicPendingCount:publicIssues.length,publicPending:publicIssues.slice(0,50),inventoryCents:signed(inventoryCents),prepaidCents:signed(prepaidCents),summary:{storeCount:list.length,incomeCents:list.length&&list.every(r=>r.income!==null)?list.reduce((n,r)=>n+cents(r.income.amountCents),0n).toString():null,directCostCents:list.length&&list.every(r=>r.directCostCents!==null)?sum('directCostCents').toString():null,storeProfitCents:shopProfit===null?null:signed(shopProfit),studioProfitCents:shopProfit===null||publicIssues.length?null:signed(shopProfit-publicCents)}};
}
