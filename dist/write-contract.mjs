import {ContractError,validDate} from './cloud-contract.mjs';
const fields=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw new ContractError('保存字段暂不兼容，请保留编辑内容后核对。');return v;};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new ContractError(required?'请填写必要信息。':'文字超过允许长度。');return required?v.trim():v;};
export const expectedVersion=v=>{if(!Number.isSafeInteger(v)||v<1)throw new ContractError('缺少有效记录版本，请刷新详情。');return v;};
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('关联记录标识无效。');return v;};
const https=(v,required=false)=>{if(!v&&!required)return '';try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)throw new Error();return u.href;}catch{throw new ContractError('请填写有效的 HTTPS 链接。');}};
const timestamp=v=>{if(typeof v!=='string'||!validDate(v.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v)||!Number.isFinite(new Date(v).getTime()))throw new ContractError('请填写带时区的有效时间。');return new Date(v).toISOString();};
export function materialPayload(value,version){
 const b=fields(value,['title','sourceUrl','metadata','storeIds']);
 if(version!==undefined&&['metadata','storeIds','sourceUrl'].some(k=>!Object.hasOwn(b,k)))throw new ContractError('原资料不完整，请刷新详情后再编辑。');
 if(b.storeIds!==undefined&&(!Array.isArray(b.storeIds)||b.storeIds.length>50))throw new ContractError('店铺关联资料无效。');
 const meta=fields(b.metadata||{},['mediaType','product','category','scene','source','tags','rating','status','notes','referenceTitles','expectedTestCount']);
 for(const [key,choices] of Object.entries({mediaType:['图文','视频'],category:['','标题','图片','场景','文案','内页'],source:['素人笔记','竞品对标','跨类目','其他'],status:['未测试','测试中','有效','待复用','淘汰']}))if(meta[key]!==undefined&&!choices.includes(meta[key]))throw new ContractError('素材分类暂不兼容，请核对原资料。');
 for(const key of ['product','scene'])if(meta[key]!==undefined)text(meta[key],200);
 for(const [key,max] of [['rating',5],['expectedTestCount',20]])if(meta[key]!==undefined&&(!Number.isInteger(meta[key])||meta[key]<1||meta[key]>max))throw new ContractError('素材评价或计划测试数量无效。');
 if(meta.tags!==undefined&&(!Array.isArray(meta.tags)||meta.tags.length>30||meta.tags.some(t=>typeof t!=='string'||t.length>40)))throw new ContractError('标签数量或长度不符合要求。');
 if(meta.notes!==undefined)text(meta.notes,4000);if(meta.referenceTitles!==undefined)text(meta.referenceTitles,4000);
 const out={title:text(b.title,200,true),sourceUrl:https(b.sourceUrl),metadata:{...meta},storeIds:(b.storeIds||[]).map(uuid)};if(version!==undefined)out.expectedVersion=expectedVersion(version);return out;
}
export function productPayload(value,version){
 const b=fields(value,['name','notes','storeId',...(version===undefined?['stages']:[])]);if(version!==undefined&&['notes','storeId'].some(k=>!Object.hasOwn(b,k)))throw new ContractError('原产品资料不完整，请刷新详情后再编辑。');const out={name:text(b.name,200,true),notes:text(b.notes??'',2000),storeId:b.storeId?uuid(b.storeId):null};
 if(version===undefined){if(!Array.isArray(b.stages)||!b.stages.length||b.stages.length>20)throw new ContractError('请设置 1 至 20 个工作阶段。');out.stages=b.stages.map(s=>text(s,100,true));if(new Set(out.stages).size!==out.stages.length)throw new ContractError('工作阶段名称不能重复。');}else out.expectedVersion=expectedVersion(version);return out;
}
export function publicationPayload(value){const b=fields(value,['url','publishedAt','materialId','title','note']);return {url:https(b.url,true),publishedAt:timestamp(b.publishedAt),materialId:b.materialId?uuid(b.materialId):null,title:text(b.title??'',200),note:text(b.note??'',2000)};}
export function snapshotPayload(value){
 const metricKeys=['views','likes','favorites','comments','productClicks','addToCart','conversions'],b=fields(value,['observedAt','hasConversion',...metricKeys]),out={observedAt:timestamp(b.observedAt)};
 for(const k of metricKeys){const v=b[k];if(v!==null&&v!==undefined&&(!Number.isInteger(v)||v<0||v>2147483647))throw new ContractError('观察指标须为非负整数，未知请留空。');out[k]=v??null;}
 out.hasConversion=b.hasConversion??null;if(out.hasConversion!==null&&typeof out.hasConversion!=='boolean')throw new ContractError();
 if(out.conversions!==null&&out.hasConversion!==null&&out.hasConversion!==(out.conversions>0))throw new ContractError('成交状态与成交数量不一致。');
 if(metricKeys.every(k=>out[k]===null)&&out.hasConversion===null)throw new ContractError('至少填写一个观察指标或成交状态。');return out;
}
