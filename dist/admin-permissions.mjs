import {ContractError} from './cloud-contract.mjs';
export const sensitivePermissions={finance:'财务访问与维护',account_security:'账号开通、员工密码与状态管理',payroll:'薪资查看、基础工资与草稿管理',personnel:'人员资料与团队考勤管理',resources:'设备、样品、库存与运营资源管理',resource_identity:'资源实名资料查看与维护（同时需要资源管理）'};
export function hasSensitive(user,permission){return user?.role==='admin'&&(user.superadmin===true||user.permissions?.includes(permission)===true||(['finance','account_security'].includes(permission)&&!Object.hasOwn(user,'permissions')&&!Object.hasOwn(user,'superadmin')));}
export function permissionPayload(value,version){
 if(!value||Object.keys(value).some(k=>!['permissions','superadmin','reason'].includes(k))||typeof value.superadmin!=='boolean'||!Array.isArray(value.permissions)||value.permissions.some(p=>!Object.hasOwn(sensitivePermissions,p))||new Set(value.permissions).size!==value.permissions.length||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000||!Number.isSafeInteger(version)||version<1)throw new ContractError('请核对授权范围、原因和账号版本。');
 return {permissions:[...value.permissions].sort(),superadmin:value.superadmin,reason:value.reason.trim(),expectedVersion:version};
}
