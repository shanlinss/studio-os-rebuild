import {ContractError,validDate,chinaDate} from './cloud-contract.mjs';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string';
export function productRecord(v,detail=false){
 if(!obj(v)||!str(v.id)||!str(v.name)||typeof v.active!=='boolean'||!Number.isSafeInteger(v.version))throw new ContractError();
 if(detail&&(!Array.isArray(v.stages)||!Array.isArray(v.plans)||!Array.isArray(v.tasks)||!Array.isArray(v.reviews)))throw new ContractError();
 return {...v};
}
export function shootingRecord(v){
 if(!obj(v)||!str(v.id)||!str(v.title)||!str(v.status)||!Array.isArray(v.items)||!Array.isArray(v.assets)||typeof v.archived!=='boolean'||!Number.isSafeInteger(v.version))throw new ContractError();
 if(v.items.some(i=>!obj(i)||!str(i.id)||!str(i.title)||typeof i.completed!=='boolean'))throw new ContractError();
 return {...v,visibleItems:v.items.filter(i=>!i.archived).sort((a,b)=>(a.position??0)-(b.position??0)),visibleAssets:v.assets.filter(a=>!a.removed)};
}
export function executionRows(values){
 if(!Array.isArray(values)||values.some(v=>!obj(v)||!str(v.id)||!str(v.title)||!str(v.kind)))throw new ContractError();
 if(values.some(v=>v.plannedPublishOn!==null&&v.plannedPublishOn!==undefined&&v.plannedPublishOn!==''&&!validDate(v.plannedPublishOn)))throw new ContractError();
 return values;
}
export function weekDates(date=chinaDate()){
 if(!validDate(date))throw new ContractError('请选择有效的日期。');
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
 return Array.from({length:7},(_,i)=>{const day=new Date(d);day.setUTCDate(day.getUTCDate()+i);return day.toISOString().slice(0,10);});
}
export function calendarGroups(rows,date){
 const days=weekDates(date),grouped=new Map(days.map(d=>[d,[]])),unplanned=[];
 const unique=new Map();
 for(const r of executionRows(rows)){
  if(unique.has(r.id))throw new ContractError('同一执行事项出现重复标识，请检查数据。');unique.set(r.id,true);
  if(!r.plannedPublishOn)unplanned.push(r);else grouped.get(r.plannedPublishOn)?.push(r);
 }
 return {days:days.map(date=>({date,items:grouped.get(date)})),unplanned};
}
export function publicationStage(t){
 for(const key of ['publishedCount','filledCount','targetCount'])if(t[key]!==null&&t[key]!==undefined&&!Number.isSafeInteger(t[key]))throw new ContractError();
 const published=Number.isSafeInteger(t.publishedCount)?t.publishedCount:null,filled=Number.isSafeInteger(t.filledCount)?t.filledCount:null,target=Number.isSafeInteger(t.targetCount)?t.targetCount:null;
 if(published!==null&&filled!==null&&filled>published)throw new ContractError();
 if([published,filled,target].some(n=>n!==null&&n<0))throw new ContractError();
 return {published,filled,target,needsPublishing:published!==null&&target!==null&&published<target,needsRefill:published!==null&&filled!==null&&published>filled,hasRefills:published!==null&&filled!==null&&published>0&&filled>=published};
}
