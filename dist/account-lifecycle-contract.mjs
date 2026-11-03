import {ContractError} from './cloud-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
const id=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new ContractError('账号或成员标识无效。');return v;};
export function accountLifecyclePayload(value,version){
 const reset=version!==undefined,keys=reset?['requestKey','password','reason']:['requestKey','username','role','password','memberId','memberVersion','reason'];
 if(!value||keys.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!keys.includes(k)))throw new ContractError('请填写完整账号信息。');
 if(typeof value.password!=='string'||value.password.length<12||value.password.length>128)throw new ContractError('密码须为12至128个字符。');
 if(typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000)throw new ContractError('请填写操作原因。');
 const out={requestKey:id(value.requestKey),password:value.password,reason:value.reason.trim()};
 if(reset)out.expectedVersion=expectedVersion(version);
 else{
  if(typeof value.username!=='string'||!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(value.username)||!['admin','employee'].includes(value.role))throw new ContractError('用户名使用3至64位小写字母、数字、点、下划线或短横线，首位为字母或数字。');
  out.username=value.username;out.role=value.role;out.memberId=value.memberId===null?null:id(value.memberId);out.memberVersion=out.memberId?expectedVersion(value.memberVersion):null;
  if(!out.memberId&&value.memberVersion!==null)throw new ContractError();
 }
 return out;
}
export function accountLifecycleResult(v,action,owner){
 if(!v||v.action!==action||typeof v.username!=='string'||(owner&&v.id!==owner)||Object.keys(v).some(k=>!['id','username','version','action','memberId'].includes(k)))throw new ContractError('账号操作回执不完整。');
 id(v.id);expectedVersion(v.version);if(v.memberId!==null)id(v.memberId);return v;
}
