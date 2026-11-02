import {ContractError,validDate} from './cloud-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new ContractError('拍摄字段暂不兼容，请保留编辑内容。');return value;};
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('关联记录无效。');return v;};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new ContractError('请填写必要信息，并检查文字长度。');return required?v.trim():v;};
const lines=v=>{if(!Array.isArray(v)||v.length>20)throw new ContractError('单项参考或要求最多 20 行。');return v.map(t=>text(t,200,true));};
export function shootingPayload(value,version){
 const b=fields(value,['requestKey','title','productId','productDescription','assigneeId','dueOn','summary','items']);
 if(version!==undefined&&['productId','productDescription','assigneeId','dueOn','summary','items'].some(k=>!Object.hasOwn(b,k)))throw new ContractError('原拍摄资料不完整，请重新读取后编辑。');
 if(!validDate(b.dueOn)||!Array.isArray(b.items)||!b.items.length||b.items.length>50)throw new ContractError('请填写交付日期和 1 至 50 个拍摄项。');
 const items=b.items.map(value=>{const i=fields(value,['id','title','kind','priority','materialId','references','requirements']);if(!['图片','视频'].includes(i.kind)||!['S','A','B','C'].includes(i.priority))throw new ContractError('请选择拍摄类型与优先级。');return {id:i.id?id(i.id):null,title:text(i.title,200,true),kind:i.kind,priority:i.priority,materialId:i.materialId?id(i.materialId):null,references:lines(i.references),requirements:lines(i.requirements)};});
 const ids=items.filter(i=>i.id).map(i=>i.id);if(new Set(ids).size!==ids.length||(version===undefined&&ids.length))throw new ContractError('拍摄项标识重复或暂不可用。');
 return {requestKey:id(b.requestKey),title:text(b.title,200,true),productId:b.productId?id(b.productId):null,productDescription:text(b.productDescription??'',200),assigneeId:b.assigneeId?id(b.assigneeId):null,dueOn:b.dueOn,summary:text(b.summary??'',2000),items,...(version===undefined?{}:{expectedVersion:expectedVersion(version)})};
}
export function shootingAction(value,version){
 const b=fields(value,['requestKey','action','feedback','nasPath']);if(!['start','deliver','reshoot','approve','reopen'].includes(b.action))throw new ContractError('这项拍摄操作暂不可用。');
 if(b.action==='reshoot'&&(!b.feedback||!b.feedback.trim()))throw new ContractError('请填写需要补拍的原因。');
 return {requestKey:id(b.requestKey),expectedVersion:expectedVersion(version),action:b.action,...(b.feedback!==undefined?{feedback:text(b.feedback,2000)}:{}),...(b.nasPath!==undefined?{nasPath:text(b.nasPath,2000)}:{})};
}
export function shootingProgress(requestKey,completed,version){if(typeof completed!=='boolean')throw new ContractError();return {requestKey:id(requestKey),completed,expectedVersion:expectedVersion(version)};}
export function shootingArchive(requestKey,archived,version){if(typeof archived!=='boolean')throw new ContractError();return {requestKey:id(requestKey),archived,expectedVersion:expectedVersion(version)};}
export function shootingActions(row,role){if(row.archived)return [];return row.status==='待拍摄'||row.status==='需补拍'?['start']:row.status==='拍摄中'?['deliver']:row.status==='待确认'?['reshoot','approve']:row.status==='已完成'&&role==='admin'?['reopen']:[];}
