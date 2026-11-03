import {hasSensitive} from './admin-permissions.mjs';
import {groups} from './navigation.mjs';
import {ContractError} from './cloud-contract.mjs';
// Navigation follows the new sitemap and known app roles. It is not an API
// permission check: every operation remains authorized by the original server.
const administratorPages=new Set(['competitors','members','accounts','ledger','settlements','warehouse','assets','roles','shops','account-info']);
export function navigationForRole(role,user={role}){
 if(!['admin','employee'].includes(role))throw new ContractError('登录角色暂不可用。');
 const result=groups.map(([name,pages])=>[name,pages.filter(([id])=>(role==='admin'||!administratorPages.has(id))&&(!['ledger','settlements'].includes(id)||hasSensitive(user,'finance'))&&(id!=='roles'||hasSensitive(user,'account_security')))]);
 if(role==='employee'){for(const group of result)group[1]=group[1].filter(([id])=>!['attendance','profile'].includes(id));result.find(([name])=>name==='我的工作台')[1].push(['attendance','我的考勤'],['profile','个人资料']);}
 return result.filter(([,pages])=>pages.length);
}
