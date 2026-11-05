import {ContractError} from './cloud-contract.mjs';
// Category keys and training ordering reuse LearningPanel / learning-assets-v2 from the supplied package.
export const knowledgeCategories=[
 {key:'weekly_review',name:'周会与复盘',description:'每周例会、阶段复盘与业务决定'},
 {key:'template',name:'模板库',description:'可以直接复制、套用和重复使用'},
 {key:'onboarding',name:'新人培训',description:'从基础到日常运营的学习路径'},
 {key:'sop',name:'SOP 操作手册',description:'具体工作一步一步应该怎么做'},
 {key:'case_review',name:'案例复盘',description:'团队真实案例与经验'},
 {key:'platform_rules',name:'平台规则与规范',description:'平台政策、风险与内部规范'},
 {key:'methodology',name:'方法论 / 业务知识',description:'运营方法、判断和经验'}
];
const aliases=new Map([['周会总结','weekly_review'],['周会与复盘','weekly_review'],['模板库','template'],['新人培训','onboarding'],['SOP','sop'],['SOP 操作手册','sop'],['案例拆解','case_review'],['案例复盘','case_review'],['平台规则','platform_rules'],['平台规则与规范','platform_rules'],['方法论 / 业务知识','methodology'],['方法论/业务知识','methodology'],...['内容方法','选题灵感','标题方法','视觉素材','数据分析'].map(v=>[v,'methodology'])]);
export const knowledgeCategoryKey=value=>aliases.get(value)||value||'';
export const knowledgeCategoryName=value=>knowledgeCategories.find(v=>v.key===knowledgeCategoryKey(value))?.name||value||'未分类';
export function knowledgeCategoryGroups(rows){const counts=new Map();for(const r of rows){const k=knowledgeCategoryKey(r.category);counts.set(k,(counts.get(k)||0)+1);}return [...knowledgeCategories.map(v=>({...v,count:counts.get(v.key)||0})),...[...counts].filter(([k])=>!knowledgeCategories.some(v=>v.key===k)).sort(([a],[b])=>a.localeCompare(b,'zh-CN')).map(([key,count])=>({key,name:knowledgeCategoryName(key),description:'自定义分类',count}))];}
export function filterKnowledgeNavigation(rows,{query='',category=null}={}){const q=query.trim().toLowerCase(),items=rows.filter(r=>(category===null||knowledgeCategoryKey(r.category)===category)&&[r.title,r.summary,knowledgeCategoryName(r.category),...(r.tags||[])].join(' ').toLowerCase().includes(q));if(category==='onboarding')items.sort((a,b)=>(a.sortOrder??Number.MAX_SAFE_INTEGER)-(b.sortOrder??Number.MAX_SAFE_INTEGER)||a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));return items;}
export function navigationCatalog(value){if(!value||value.navigationVersion!==1||value.access?.read!=='team'||value.access?.manage!=='administrators'||!Array.isArray(value.items))throw new ContractError('知识导航暂不可用，请刷新后重试。');for(const r of value.items){if(!r||typeof r.id!=='string'||typeof r.title!=='string'||r.entryType!=='knowledge'||!['link','article','conclusion'].includes(r.kind)||typeof r.category!=='string'||typeof r.summary!=='string'||r.sourceUrl!==null&&typeof r.sourceUrl!=='string'||!Array.isArray(r.tags)||r.tags.some(t=>typeof t!=='string')||!Number.isSafeInteger(r.version)||r.version<1||r.sortOrder!==null&&(!Number.isSafeInteger(r.sortOrder)||r.sortOrder<1)||['body','sourceFinding','sourceRecommendation','sourceTitle'].some(k=>Object.hasOwn(r,k)))throw new ContractError('知识导航信息不完整，请重新读取。');}return value;}
