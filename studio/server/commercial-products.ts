import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,optionalLongText,longText,httpsUrl} from './validation';

async function snapshot(tx:TransactionSql,id:string){
 const [formal]=await tx<{productId:string,code:string,version:number}[]>`SELECT product_id AS "productId",code,version FROM studio_os.commercial_products WHERE product_id=${id}`;
 if(!formal)return null;
 const skus=await tx`SELECT id,code,specification,unit,active,warehouse_item_id AS "warehouseItemId" FROM studio_os.product_skus WHERE product_id=${id} ORDER BY code,id`;
 const mappings=await tx`SELECT m.sku_id AS "skuId",m.store_id AS "storeId",s.name AS "storeName",s.active AS "storeActive",
  m.platform_product_id AS "platformProductId",m.platform_sku_id AS "platformSkuId",m.listing_url AS "listingUrl",m.active
  FROM studio_os.product_sku_stores m JOIN studio_os.product_skus k ON k.id=m.sku_id JOIN studio_os.stores s ON s.id=m.store_id
  WHERE k.product_id=${id} ORDER BY m.sku_id,m.store_id`;
 return {...formal,skus,mappings};
}
export class CommercialProducts {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){
  await currentPermission(this.db,who,'resources');id=uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [product]=await tx`SELECT id,name,active,version FROM studio_os.products WHERE id=${id}`;
   if(!product)throw new NotFoundException();
   const stock=await tx`SELECT w.id,w.item_code AS "itemCode",w.specification,w.unit,w.active,
    k.id AS "skuId" FROM studio_os.warehouse_items w LEFT JOIN studio_os.product_skus k ON k.warehouse_item_id=w.id
    WHERE w.product_id=${id} AND w.kind='product' ORDER BY w.item_code,w.id`;
   return {product,formal:await snapshot(tx,id),stock};
  });
 }
 async save(who:Identity,id:string,action:string,value:unknown){
  id=uuid(id);
  const keys=action==='formal'?['code']:action==='sku'?['id','code','specification','unit','active','warehouseItemId']:
   action==='mapping'?['skuId','storeId','platformProductId','platformSkuId','listingUrl','active']:null;
  if(!keys)throw new BadRequestException();
  const b=objectInput(value,['requestKey','expectedVersion','reason',...keys]),key=uuid(b.requestKey),reason=longText(b.reason,2000);
  if(!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>2147483647||keys.some(k=>!Object.hasOwn(b,k)))throw new BadRequestException();
  const hash=createHash('sha256').update(JSON.stringify({id,action,body:Object.fromEntries(Object.keys(b).sort().map(key=>[key,b[key]]))})).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'commercial-product:'+who.id+':'+key},0))`;
   const [receipt]=await tx`SELECT product_id,request_hash,result FROM studio_os.commercial_product_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(receipt){if(receipt.product_id!==id||receipt.request_hash!==hash)throw new ConflictException('请求标识已用于其他内容');return receipt.result;}
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'commercial-product-record:'+id},0))`;
   const [product]=await tx`SELECT id,active FROM studio_os.products WHERE id=${id} FOR SHARE`;
   if(!product)throw new NotFoundException();
   if(!product.active)throw new ConflictException('原产品已停用');
   const before=await snapshot(tx,id);
   if((before?.version??0)!==b.expectedVersion)throw new ConflictException('正式商品资料已变化，请重新读取');
   if(action==='formal'){
    if(before)throw new ConflictException('已登记正式商品');
    const code=shortText(b.code,64);
    await tx`INSERT INTO studio_os.commercial_products(product_id,code,created_by) VALUES(${id},${code},${who.id})`;
   }else{
    if(!before)throw new ConflictException('请先登记正式商品');
    if(action==='sku'){
     const skuId=b.id===null?null:uuid(b.id),code=shortText(b.code,64),specification=optionalLongText(b.specification,200),unit=String(b.unit);
     const warehouse=b.warehouseItemId===null?null:uuid(b.warehouseItemId);
     if(!['件','个','套','包','卷','箱'].includes(unit)||typeof b.active!=='boolean')throw new BadRequestException();
     const old=skuId?before.skus.find(row=>row.id===skuId):null;
     if(skuId&&!old)throw new NotFoundException();
     if(old&&(code!==old.code||(old.warehouseItemId&&(old.warehouseItemId!==warehouse||old.specification!==specification||old.unit!==unit))))
      throw new ConflictException('SKU 编号及已绑定库存的规格、单位和关联保持固定');
     if(warehouse){
      const [item]=await tx`SELECT product_id,kind,specification,unit,active FROM studio_os.warehouse_items WHERE id=${warehouse} FOR SHARE`;
      if(!item||item.product_id!==id||item.kind!=='product'||item.specification!==specification||item.unit!==unit||
       (!item.active&&warehouse!==old?.warehouseItemId))throw new ConflictException('原库存的产品、规格、单位或状态不匹配');
     }
     if(skuId)await tx`UPDATE studio_os.product_skus SET specification=${specification},unit=${unit},active=${b.active},warehouse_item_id=${warehouse} WHERE id=${skuId}`;
     else await tx`INSERT INTO studio_os.product_skus(product_id,code,specification,unit,active,warehouse_item_id)
      VALUES(${id},${code},${specification},${unit},${b.active},${warehouse})`;
    }else{
     const skuId=uuid(b.skuId),storeId=uuid(b.storeId),platformProduct=shortText(b.platformProductId,100),platformSku=shortText(b.platformSkuId,100),url=httpsUrl(b.listingUrl);
     const sku=before.skus.find(row=>row.id===skuId);
     if(!sku)throw new NotFoundException();
     if(typeof b.active!=='boolean')throw new BadRequestException();
     const [store]=await tx`SELECT name,active FROM studio_os.stores WHERE id=${storeId} FOR SHARE`;
     const old=before.mappings.find(row=>row.skuId===skuId&&row.storeId===storeId);
     if(!store||(!store.active&&(!old||b.active))||(!sku.active&&b.active))throw new ConflictException('停用店铺或 SKU 不能启用商品映射');
     await tx`INSERT INTO studio_os.product_sku_stores(sku_id,store_id,platform_product_id,platform_sku_id,listing_url,active)
      VALUES(${skuId},${storeId},${platformProduct},${platformSku},${url},${b.active})
      ON CONFLICT(sku_id,store_id) DO UPDATE SET platform_product_id=EXCLUDED.platform_product_id,platform_sku_id=EXCLUDED.platform_sku_id,
       listing_url=EXCLUDED.listing_url,active=EXCLUDED.active`;
    }
    await tx`UPDATE studio_os.commercial_products SET version=version+1 WHERE product_id=${id}`;
   }
   const after=await snapshot(tx,id);
   await tx`INSERT INTO studio_os.commercial_product_events(product_id,actor_id,reason,before_value,after_value)
    VALUES(${id},${who.id},${reason},${before?JSON.stringify(before):null}::jsonb,${JSON.stringify(after)}::jsonb)`;
   const result={id,version:after!.version};
   await tx`INSERT INTO studio_os.commercial_product_receipts(actor_id,request_key,product_id,request_hash,result)
    VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });}catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('商品编号、SKU 编号、原库存或店铺商品标识已被使用');throw error;}
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'resources');id=uuid(id);key=uuid(key);
  const [row]=await this.db.client`SELECT result FROM studio_os.commercial_product_receipts WHERE actor_id=${who.id} AND product_id=${id} AND request_key=${key}`;
  if(!row)throw new NotFoundException();return row.result;
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'resources');id=uuid(id);
  const b=objectInput(value,['offset']),offset=Number(b.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT e.id,e.reason,e.before_value AS "beforeValue",e.after_value AS "afterValue",e.created_at AS "createdAt",a.username AS actor
    FROM studio_os.commercial_product_events e JOIN studio_os.accounts a ON a.id=e.actor_id WHERE e.product_id=${id} ORDER BY e.created_at DESC,e.id DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.commercial_product_events WHERE product_id=${id}`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
}
