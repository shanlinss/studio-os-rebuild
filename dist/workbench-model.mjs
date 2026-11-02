import {ContractError,validDate,chinaDate} from './cloud-contract.mjs';
export const todoTypes=['内容制作','素材收集','数据记录','测试复盘','其他事项','内容策划','素材测试','数据回填','内容整理'];
export const todoStatuses=['待开始','进行中','已完成','取消'];
export function todoModel(value){
 if(!value||typeof value.id!=='string'||typeof value.title!=='string'||!todoStatuses.includes(value.status)||!Number.isSafeInteger(value.version)||value.version<1)throw new ContractError();
 if(value.plannedOn!==undefined&&value.plannedOn!==null&&!validDate(value.plannedOn))throw new ContractError('事项计划日期无效。');
 for(const key of ['dueAt','completedAt'])if(value[key]!==undefined&&value[key]!==null&&(typeof value[key]!=='string'||!Number.isFinite(Date.parse(value[key]))))throw new ContractError('事项时间无效。');
 return {...value};
}
export function todoEditable(row){
 todoModel(row);
 if(!Object.hasOwn(row,'plannedOn')||!Object.hasOwn(row,'dueAt')||row.plannedOn===undefined||row.dueAt===undefined||typeof row.notes!=='string'||!todoTypes.includes(row.taskType)||!['高','中','低'].includes(row.priority))throw new ContractError('事项日期兼容尚未接入，请保留原资料。');
 return {title:row.title,taskType:row.taskType,priority:row.priority,status:row.status,notes:row.notes,plannedOn:row.plannedOn,dueAt:row.dueAt};
}
export function todosForDate(rows,date){
 if(!validDate(date))throw new ContractError();
 return rows.map(todoModel).filter(t=>t.status!=='取消'&&(!t.plannedOn||t.plannedOn===date));
}
export function completedTodos(rows,date){
 if(!validDate(date))throw new ContractError();
 return rows.map(todoModel).filter(t=>t.status==='已完成'&&t.completedAt&&chinaDate(new Date(t.completedAt))===date);
}

export function businessForDate(rows,date){
 if(!validDate(date))throw new ContractError();
 return rows.filter(t=>{if(t.plannedPublishOn&&!validDate(t.plannedPublishOn))throw new ContractError('业务事项的计划日期无效。');return (!t.plannedPublishOn||t.plannedPublishOn===date)&&(t.experimentStatus!=='concluded'||!!t.completedAt);});
}
