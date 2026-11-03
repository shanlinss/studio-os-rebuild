import {ContractError} from './cloud-contract.mjs';
export function createAccountLifecycleEditors({api,h,mount,input,area,select}){
 async function accountLifecycle(id){
  const current=await api.session();let row,members=[];if(id){row=(await api.loginAccounts()).find(a=>a.id===id);if(!row)throw new ContractError('账号暂不可见，请重新读取。');}else members=(await api.members()).filter(m=>m.active&&!m.loginAccountId);
  const key=crypto.randomUUID(),action=id?'password-reset':'created';
  const fields=(id?`<p>账号：${h(row.username)}。保存后该账号的已有登录全部失效，角色、启停状态和成员关联保持原样。</p>`:input('username','登录用户名','','required minlength="3" maxlength="64" pattern="[a-z0-9][a-z0-9_.-]{2,63}" autocomplete="off"')+select('role','角色','employee',(current.superadmin?[['employee','员工'],['admin','管理员']]:[['employee','员工']]))+select('memberId','关联已有成员','',[['','暂不关联'],...members.map(m=>[m.id,m.displayName])])+'<p class="muted">成员档案不重复创建；已有绑定不能覆盖。新管理员默认不具备财务和账号安全权限，由超级管理员另行授权。</p>')+input('password','新密码','','required type="password" minlength="12" maxlength="128" autocomplete="new-password"')+input('confirmPassword','再次输入新密码','','required type="password" minlength="12" maxlength="128" autocomplete="new-password"')+area('reason','操作原因（必填）')+'<p class="muted">密码不会出现在账号列表、操作记录或导出中；关闭窗口会清空密码输入。</p>';
  mount(id?'重置登录密码':'开通登录账号',fields,f=>{
   if(f.get('password')!==f.get('confirmPassword'))throw new ContractError('两次密码输入不一致。');
   const value={requestKey:key,password:f.get('password'),reason:f.get('reason')};
   if(!id){const member=members.find(m=>m.id===f.get('memberId'));Object.assign(value,{username:f.get('username'),role:f.get('role'),memberId:member?.id||null,memberVersion:member?.version||null});}
   return api.accountLifecycle(id,value,row?.version);
  },{kind:'directory'},()=>api.accountOperation(key,action,id),form=>()=>{form.querySelectorAll('input[type=password]').forEach(el=>el.value='');});
 }
 return {accountLifecycle};
}
