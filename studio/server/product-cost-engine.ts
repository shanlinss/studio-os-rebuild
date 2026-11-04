// Review calculation only. Fractions remain exact until display; rounded values never feed the next movement.
export type Fraction={n:bigint,d:bigint};
const zero=():Fraction=>({n:0n,d:1n});
export function fraction(n:bigint,d=1n):Fraction{let a=n<0n?-n:n,b=d;while(b){const r=a%b;a=b;b=r;}return {n:n/(a||1n),d:d/(a||1n)};}
export const plus=(a:Fraction,b:Fraction)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const times=(a:Fraction,n:number,d=1)=>fraction(a.n*BigInt(n),a.d*BigInt(d));
export function costAmount(a:Fraction|null):string|null{if(a===null)return null;const abs=a.n<0n?-a.n:a.n,cents=(abs*2n+a.d)/(2n*a.d);return `${a.n<0n&&cents>0n?'-':''}${cents/100n}.${String(cents%100n).padStart(2,'0')}`;}
export interface CostMovement{
 id:string;type:string;quantity:number;delta:number;day:string;postedAt:string;documentId:string|null;
 operation:string|null;totalCents:number|null;sourceShipmentId:string|null;purchaseVersion:number|null;
 businessStoreId?:string|null;referenceUnitCents?:number|null;referenceId?:string|null;openingVersion?:number|null;sourceChanged:boolean;snapshot:Record<string,unknown>;duplicateOpening:boolean;internalTransfer:boolean;
}
export function movingCosts(movements:CostMovement[],month:string){
 let quantity=0,value:Fraction|null=zero();
 const issues=new Set<string>(),shipments=new Map<string,{quantity:number,cost:Fraction|null,estimate:Fraction|null,referenceId:string|null}>();
 const totals:{shipment:Fraction|null,returns:Fraction|null}={shipment:zero(),returns:zero()};
 let shipmentQuantity=0,returnQuantity=0;
 const indicative:{shipment:Fraction|null,returns:Fraction|null}={shipment:zero(),returns:zero()};let estimatedRows=0;
 const rows=[];const stores=new Map<string|null,{cost:Fraction|null,missing:number}>();
 // Backdated business documents are replayed on their business date; no financial posting is changed.
 const ordered=[...movements].filter(m=>!m.duplicateOpening&&!m.internalTransfer)
  .sort((a,b)=>a.day.localeCompare(b.day)||a.postedAt.localeCompare(b.postedAt)||a.id.localeCompare(b.id));
 const ambiguous=new Set<string>();
 for(let i=0;i<ordered.length;){let j=i+1;while(j<ordered.length&&ordered[j].day===ordered[i].day&&ordered[j].postedAt===ordered[i].postedAt)j++;
  if(j-i>1&&new Set(ordered.slice(i,j).filter(m=>m.delta!==0).map(m=>m.operation??m.type)).size>1)for(let k=i;k<j;k++)ambiguous.add(ordered[k].id);i=j;
 }
 for(const m of ordered){
  if(m.day.slice(0,7)>month)break;
  const notes:string[]=[];let cost:Fraction|null=zero();
  if(ambiguous.has(m.id)){value=null;notes.push('同一时刻存在不同类型流水，成本顺序需核对');}
  if(m.delta>0){
   if(m.operation==='return'){
    const original=shipments.get(m.sourceShipmentId??'');
    cost=original?original.cost===null?null:times(original.cost,m.quantity,original.quantity):null;
    if(cost===null)notes.push('原发货成本尚未确定');
   }else if(m.operation==='inbound'){
    cost=m.totalCents===null?null:fraction(BigInt(m.totalCents));
    if(cost===null)notes.push('原入库单尚未登记采购成本');
   }else if(m.type==='opening'&&m.totalCents!==null){cost=fraction(BigInt(m.totalCents));}
   else{cost=null;notes.push(m.type==='opening'?'期初库存尚缺成本依据':'增加库存尚缺成本依据');}
   value=value===null||cost===null?null:plus(value,cost);
  }else if(m.delta<0){
   cost=value===null||quantity<=0||-m.delta>quantity?null:times(value,-m.delta,quantity);
   if(cost===null)notes.push('前序库存成本不完整或业务日期顺序需核对');
   value=value===null||cost===null?null:plus(value,times(cost,-1));
  }
  quantity+=m.delta;
  if(quantity<0){value=null;notes.push('按业务日期重放出现负库存，请核对日期');}
  // A fully depleted pool permits a new known basis; an unresolved shipment retains its own unknown cost.
  if(quantity===0)value=zero();
  if(m.sourceChanged)notes.push('采购引用的支出已变更，请核对采购成本版本');
  const original=m.operation==='return'?shipments.get(m.sourceShipmentId??''):null;
  let estimate:Fraction|null=null,referenceId:string|null=null;
  if(m.operation==='shipment'&&m.referenceUnitCents!=null){estimate=fraction(BigInt(m.referenceUnitCents)*BigInt(m.quantity));referenceId=m.referenceId??null;}
  if(m.operation==='return'&&original?.estimate){estimate=times(original.estimate,m.quantity,original.quantity);referenceId=original.referenceId;}
  if(m.operation==='shipment')shipments.set(m.id,{quantity:m.quantity,cost,estimate,referenceId});
  const indicativeCost=cost??estimate;

  if(m.day.startsWith(month)){
   if(m.operation==='shipment'){shipmentQuantity+=m.quantity;totals.shipment=totals.shipment===null||cost===null?null:plus(totals.shipment,cost);}
   if(m.operation==='return'){returnQuantity+=m.quantity;totals.returns=totals.returns===null||cost===null?null:plus(totals.returns,cost);}
   if(m.operation==='shipment'||m.operation==='return'){
    const store=(m.businessStoreId??m.snapshot.businessStoreId??null) as string|null,bucket=stores.get(store)??{cost:zero(),missing:0};
    if(cost===null){bucket.cost=null;bucket.missing++;}else if(bucket.cost!==null)bucket.cost=plus(bucket.cost,times(cost,m.operation==='return'?-1:1));
    stores.set(store,bucket);
    const key=m.operation==='shipment'?'shipment':'returns';
    indicative[key]=indicative[key]===null||indicativeCost===null?null:plus(indicative[key]!,indicativeCost);
    if(cost===null&&estimate!==null)estimatedRows++;
   }
   rows.push({id:m.id,day:m.day,postedAt:m.postedAt,kind:m.operation??m.type,quantity:m.quantity,delta:m.delta,documentId:m.documentId,
    purchaseVersion:m.purchaseVersion,openingVersion:m.openingVersion??null,snapshot:m.snapshot,indicativeAmount:costAmount(indicativeCost),costBasis:cost!==null?'actual':estimate!==null?'reference':'missing',referenceId:cost===null?referenceId:null,costAmount:costAmount(cost),balanceQuantity:quantity,balanceAmount:costAmount(value),
    averageAmount:costAmount(value!==null&&quantity>0?times(value,1,quantity):null),notes});
  }
  for(const note of notes)issues.add(note);
 }
 return {storeCosts:[...stores].map(([storeId,b])=>({storeId,missing:b.missing,exact:b.cost?{n:String(b.cost.n),d:String(b.cost.d)}:null})),month,quantity,balanceAmount:costAmount(value),averageAmount:costAmount(value!==null&&quantity>0?times(value,1,quantity):null),
  shipmentQuantity,returnQuantity,shipmentAmount:costAmount(totals.shipment),returnAmount:costAmount(totals.returns),
  estimatedRows,indicativeShipmentAmount:costAmount(indicative.shipment),indicativeReturnAmount:costAmount(indicative.returns),indicativeNetAmount:costAmount(indicative.shipment!==null&&indicative.returns!==null?plus(indicative.shipment,times(indicative.returns,-1)):null),
  netAmount:costAmount(totals.shipment!==null&&totals.returns!==null?plus(totals.shipment,times(totals.returns,-1)):null),issues:[...issues],rows};
}
