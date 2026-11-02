import {groups} from './navigation.mjs';
import {ContractError} from './cloud-contract.mjs';
// Navigation follows the new sitemap and known app roles. It is not an API
// permission check: every operation remains authorized by the original server.
const administratorPages=new Set(['competitors','members','accounts','ledger','settlements','warehouse','assets','roles','shops','account-info']);
export function navigationForRole(role){
 if(!['admin','employee'].includes(role))throw new ContractError('登录角色暂不可用。');
 return groups.map(([name,pages])=>[name,pages.filter(([id])=>role==='admin'||!administratorPages.has(id))]).filter(([,pages])=>pages.length);
}
