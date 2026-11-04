import {BadRequestException,ConflictException} from '@nestjs/common';
import type {TransactionSql} from 'postgres';
import {objectInput,uuid,version} from './validation';
export async function equipmentAccounts(tx:TransactionSql,id:string){return tx`SELECT b.id,b.name,b.active,b.version,b.responsible_member_id AS "responsibleMemberId",m.display_name AS "responsibleName",b.store_id AS "storeId",b.primary_device_id AS "primaryDeviceId",CASE WHEN b.primary_device_id=${id} THEN 'primary' ELSE 'extra' END AS link FROM studio_os.business_accounts b JOIN studio_os.members m ON m.id=b.responsible_member_id WHERE b.primary_device_id=${id} OR EXISTS(SELECT 1 FROM studio_os.business_account_extra_devices x WHERE x.account_id=b.id AND x.device_id=${id}) ORDER BY b.id`;}
export function accountReviewInput(value:unknown){if(value===undefined)return null;if(!Array.isArray(value)||value.length>1000)throw new BadRequestException();const rows=value.map(v=>{const r=objectInput(v,['id','expectedVersion','link','sync']);if(!['primary','extra'].includes(String(r.link))||typeof r.sync!=='boolean')throw new BadRequestException();return {id:uuid(r.id),expectedVersion:version(r.expectedVersion),link:r.link,sync:r.sync};});if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new BadRequestException();return rows;}
export async function reviewEquipmentAccounts(tx:TransactionSql,equipmentId:string,review:ReturnType<typeof accountReviewInput>,confirmed:unknown,to:string){
 const linked=await equipmentAccounts(tx,equipmentId);if(!review&&linked.length===0)return [];
 if(confirmed!==true||!review||review.length!==linked.length||linked.some(a=>!review.some(r=>r.id===a.id&&r.expectedVersion===a.version&&r.link===a.link)))throw new ConflictException('关联运营账号已有变化，请重新核对全部负责人');
 const results=[];for(const before of linked){const decision=review.find(r=>r.id===before.id)!;if(decision.sync&&!before.active)throw new ConflictException('已停用账号请保留原负责人，另行核对');let after=before;
  if(decision.sync&&before.responsibleMemberId!==to){await tx`SELECT id FROM studio_os.business_accounts WHERE id=${before.id} FOR UPDATE`;const [r]=await tx`UPDATE studio_os.business_accounts SET responsible_member_id=${to},version=version+1,updated_at=now() WHERE id=${before.id} AND version=${before.version} RETURNING version`;if(!r)throw new ConflictException();after={...before,responsibleMemberId:to,version:r.version};const [m]=await tx`SELECT display_name AS name FROM studio_os.members WHERE id=${to}`;after.responsibleName=m.name;}
  results.push({before,after,decision:decision.sync?'sync':'keep'});
 }return results;
}
