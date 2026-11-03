import {ContractError} from './cloud-contract.mjs';
import {attachmentList} from './attachments.mjs';
export function createEquipmentAssetsEditors({api,h,mount,input,area,select}){
 async function equipmentHandover(id){
  const state=await api.equipmentHandoverState(id),r=state.equipment,loan=state.currentLoan,key=crypto.randomUUID();
  if(!['available','on_loan'].includes(r.status))throw new ContractError('设备需处于可借或使用中状态才能交接。');
  const choices=state.recipients.filter(m=>m.id!==loan?.memberId).map(m=>[m.id,m.displayName]);
  const now=new Date(Date.now()+8*3600000).toISOString().slice(0,23);
  mount('管理员设备交接',`<p>${h(r.assetTag)} · ${h(r.name)}</p><p>原使用人：${h(loan?.borrowerName||'暂无，当前在库')}</p><p class="planning-rule">交接会结束原借用并登记接收人的新借用；不改变设备编号、保管人、存放位置或运营账号负责人。请核对设备状况与实际交接时间。</p>`+select('toMemberId','接收人','',[['','请选择有效团队成员'],...choices])+input('occurredAt','实际交接时间（北京时间）',now,'required type="datetime-local" step="0.001"')+input('location','接收后的使用位置','','required maxlength="150"')+area('condition','交接时设备状况（必填）','',500)+area('note','交接原因与备注（必填）'),f=>{
   const time=f.get('occurredAt');return api.equipmentHandover(id,{requestKey:key,expectedVersion:r.version,previousLoanId:loan?.id||null,previousLoanVersion:loan?.version||null,toMemberId:f.get('toMemberId'),occurredAt:time+(time.length===16?':00':'')+'+08:00',location:f.get('location'),condition:f.get('condition'),note:f.get('note')});
  },{kind:'equipment'},()=>api.equipmentReceipt(key,'handover',id));
 }
 async function equipmentPhoto(id){
  const r=await api.equipmentDetail(id),key=crypto.randomUUID();
  mount('设备照片',`<p>${h(r.assetTag)} · ${h(r.name)}</p>${attachmentList(h,'equipment',id,r.image?[r.image]:[])}<p class="planning-rule">设备照片可供员工查看，请勿上传采购票据、实名资料或其他敏感文件。支持8 MiB以内的PNG、JPG、GIF、WebP图片。</p>`+select('action','本次操作','replace',[['replace',r.image?'更换照片':'添加照片'],...(r.image?[['remove','移除当前照片']]:[])])+`<label>选择照片<input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp"></label>`,f=>{
   if(f.get('action')==='remove')return api.removeEquipmentImage(id,{requestKey:key,expectedVersion:r.version});
   return api.uploadEquipmentImage(id,f.get('file'),r.version,key);
  },{kind:'equipment'},()=>api.equipmentReceipt(key,'image',id));
 }
 return {equipmentHandover,equipmentPhoto};
}
