import {ContractError,validDate} from './cloud-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
import {consumptionOptions,warehouseUnits} from './warehouse-contract.mjs';
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('商品库存标识无效。');return v;};
const quantity=v=>{if(!Number.isSafeInteger(v)||v<0||v>2147483647)throw new ContractError('商品数量无效。');return v;};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new ContractError('请核对日期、来源和说明。');return v.trim();};
export function productStockOptions(v){consumptionOptions(v);if(v.rows.some(row=>typeof row.skuCode!=='string'))throw new ContractError('SKU 资料不完整。');return v;}
export function productStockPayload(v){
 if(!v||Object.keys(v).some(k=>!['requestKey','operation','businessDate','sourceReference','reason','lines'].includes(k))||
  !['inbound','shipment'].includes(v.operation)||!validDate(v.businessDate)||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)throw new ContractError('请核对商品单据内容。');
 const lines=v.lines.map(line=>{
  if(!line||Object.keys(line).some(k=>!['balanceId','expectedVersion','quantity','businessStoreId'].includes(k))||quantity(line.quantity)===0)throw new ContractError('本次数量须大于零。');
  return {balanceId:id(line.balanceId),expectedVersion:expectedVersion(line.expectedVersion),quantity:line.quantity,businessStoreId:line.businessStoreId===null?null:id(line.businessStoreId)};
 });
 if(new Set(lines.map(line=>line.balanceId)).size!==lines.length)throw new ContractError('同一库存来源在一张单据中只能填写一次。');
 return {requestKey:id(v.requestKey),operation:v.operation,businessDate:v.businessDate,sourceReference:text(v.sourceReference,200),reason:text(v.reason,2000,true),lines};
}
export function productStockDetail(v,owner){
 if(!v||v.id!==owner||!['inbound','shipment'].includes(v.operation)||!validDate(v.businessDate)||typeof v.reason!=='string'||typeof v.sourceReference!=='string'||typeof v.actor!=='string'||!Number.isFinite(Date.parse(v.createdAt))||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100)throw new ContractError('商品单据不完整。');
 for(const line of v.lines){
  id(line.id);id(line.balanceId);quantity(line.quantity);quantity(line.beforeQuantity);quantity(line.afterQuantity);
  const s=line.snapshot;
  if(!s||typeof s.name!=='string'||typeof s.skuCode!=='string'||!warehouseUnits.includes(s.unit)||(s.businessStoreName!==null&&typeof s.businessStoreName!=='string')||
    (v.operation==='shipment'&&!s.businessStoreName)||line.afterQuantity-line.beforeQuantity!==(v.operation==='inbound'?line.quantity:-line.quantity))throw new ContractError('商品数量明细不完整。');
 }
 return v;
}
