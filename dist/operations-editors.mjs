import {ContractError,chinaDate} from './cloud-contract.mjs';
import {money,cents} from './management-model.mjs';

export function createOperationsEditors({api,h,mount,input,area,select}){
 const stateSelect=(row)=>row?select('active','使用状态',String(row.active),[['true','启用'],['false','停用']]):'';
 const choices=(rows,key='name',current=null)=>[['','不关联'],...rows.filter(r=>r.active||r.id===current).map(r=>[r.id,r[key]])];
 const decimal=value=>{const n=BigInt(value);return (n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');};
 async function nextRound(id){
  const [root,materials]=await Promise.all([api.experiment(id),api.materials()]);if(root.status!=='testing')throw new ContractError('已结束实验不能新增轮次。');
  const last=root.rounds.at(-1),selected=new Set((last?.materials||root.materials).map(m=>m.id)),key=crypto.randomUUID();
  mount('继续下一轮实验',`<p class="muted">${h(root.title)} · 历史轮次及数据继续保留，本轮先保存，再安排执行。</p>`+input('title','本轮名称',`第 ${root.rounds.length+1} 轮`,'required maxlength="200"')+area('adjustment','根据上轮结果，本轮如何调整','',2000)+input('testVariable','本轮测试变量',last?.testVariable||'','maxlength="200"')+area('executionConditions','保持的执行条件',last?.executionConditions||'')+input('plannedPublishOn','计划日期','','type="date"')+`<fieldset class="material-picker"><legend>本轮参考素材</legend>${materials.map(m=>`<label><input name="materialIds" type="checkbox" value="${h(m.id)}" ${selected.has(m.id)?'checked':''}>${h(m.title)}</label>`).join('')}</fieldset>`,async f=>api.nextRound(id,{title:f.get('title'),requestKey:key,materialIds:f.getAll('materialIds'),lab:{adjustment:f.get('adjustment'),testVariable:f.get('testVariable'),executionConditions:f.get('executionConditions'),plannedPublishOn:f.get('plannedPublishOn')||null}},root.version),{kind:'test',id},async()=>{const fresh=await api.experiment(id);return fresh.rounds.find(r=>r.requestKey===key)||null;});
 }
 async function experimentProduct(id){
  const [root,products]=await Promise.all([api.experiment(id),api.products()]);if(root.status!=='testing')throw new ContractError('已结束实验不能更换关联产品。');
  const options=choices(products,'name',root.linkedProductId);if(root.linkedProductId&&!products.some(p=>p.id===root.linkedProductId))options.push([root.linkedProductId,root.linkedProductName||'原关联产品']);
  mount('关联产品',select('productId','实验对应产品',root.linkedProductId||'',options)+'<p class="muted">只修改产品关联，保留已有轮次、素材、任务和数据。</p>',f=>api.experimentProduct(id,f.get('productId')||null,root.version),{kind:'test',id});
 }
 async function directory(kind,id){
  const rows=await (kind==='member'?api.members():kind==='account'?api.businessAccounts():api.stores());const row=id?rows.find(r=>r.id===id):null;if(id&&!row)throw new ContractError('原资料不可见，请刷新后重试。');let body;
  if(kind==='member')body=input('displayName','成员姓名',row?.displayName,'required maxlength="100"')+input('jobTitle','岗位',row?.jobTitle,'maxlength="100"')+input('startDate','入职日期',row?.startDate,'type="date"')+input('employmentStatus','在职状态',row?.employmentStatus,'maxlength="40"')+'<p class="muted">已有登录关联保持原样；新增成员先建立档案。业务停用与登录账号状态分别管理。</p>';
  else if(kind==='account'){
   const members=await api.members();const options=members.filter(m=>m.active||m.id===row?.responsibleMemberId).map(m=>[m.id,m.displayName]);if(row?.responsibleMemberId&&!options.some(([id])=>id===row.responsibleMemberId))options.push([row.responsibleMemberId,row.responsibleName||'原负责人']);
   body=input('name','运营账号名称',row?.name,'required maxlength="100"')+input('profileUrl','主页链接',row?.profileUrl,'type="url"')+select('responsibleMemberId','负责人',row?.responsibleMemberId||'', [['','请选择'],...options])+input('boundPhone','绑定号码',row?.boundPhone,'maxlength="100"')+input('actualPhone','实际号码',row?.actualPhone,'maxlength="100"')+area('remark','备注',row?.remark||'')+'<p class="muted">变更负责人会影响后续执行范围，请按实际分工填写。</p>';
  }else body=input('name','店铺名称',row?.name,'required maxlength="100"');
  mount((row?'编辑':'新增')+{member:'成员资料',account:'运营账号',store:'店铺'}[kind],body+stateSelect(row),f=>{
   const value=kind==='member'?{displayName:f.get('displayName'),jobTitle:f.get('jobTitle'),startDate:f.get('startDate')||null,employmentStatus:f.get('employmentStatus')}:kind==='account'?{name:f.get('name'),profileUrl:f.get('profileUrl'),responsibleMemberId:f.get('responsibleMemberId'),boundPhone:f.get('boundPhone'),actualPhone:f.get('actualPhone'),remark:f.get('remark')}:{name:f.get('name')};if(row)value.active=f.get('active')==='true';return api.saveDirectory(kind,id,value,row?.version);
  },{kind:'directory'});
 }
 async function memberLogin(id){
  const [members,accounts]=await Promise.all([api.members(),api.loginAccounts()]),row=members.find(m=>m.id===id);
  if(!row||row.loginAccountId)throw new ContractError('成员不可见或已经关联登录账号，请刷新后核对。');
  const used=new Set(members.map(m=>m.loginAccountId).filter(Boolean)),available=accounts.filter(a=>a.active&&!used.has(a.id));
  if(!available.length)throw new ContractError('没有尚未关联成员的有效登录账号，请先由管理员开通账号。');
  mount('关联成员登录账号',`<p>${h(row.displayName)}</p>`+select('loginAccountId','已有登录账号','',[['','请选择'],...available.map(a=>[a.id,a.username+' · '+(a.role==='admin'?'管理员':'员工')])])+'<p class="muted">关联后，该账号按原权限访问此成员的工作。已有绑定不会被替换，也不修改账号角色或密码。</p>',f=>api.linkMemberLogin(id,f.get('loginAccountId'),row.version),{kind:'directory'});
 }
 async function accountAccess(id){
  const row=(await api.loginAccounts()).find(a=>a.id===id);if(!row)throw new ContractError('原登录账号暂不可见。');
  mount('维护登录权限',`<p>${h(row.username)}</p>`+select('role','账号角色',row.role,[['employee','员工'],['admin','管理员']])+stateSelect(row)+'<p class="muted">权限或状态变化后，该账号需要重新登录。此处不修改密码或成员绑定。</p>',f=>api.updateAccountAccess(id,{role:f.get('role'),active:f.get('active')==='true'},row.version),{kind:'directory'});
 }
 async function equipment(action,id,shootingId=null){
  let row=null,body='',operation=action;const key=crypto.randomUUID();
  if(['return','relocate'].includes(action))row=await api.equipmentLoan(id);else if(id)row=await api.equipmentDetail(id);
  if(['register','edit'].includes(action)){
   const members=await api.members(),keepers=[['','暂未指定'],...members.filter(m=>m.active||m.id===row?.keeperMemberId).map(m=>[m.id,m.displayName])];
   body=input('assetTag','设备编号',row?.assetTag,'required maxlength="64"')+input('name','设备名称',row?.name,'required maxlength="120"')+input('model','型号说明',row?.model,'maxlength="200"')+select('keeperMemberId','保管人',row?.keeperMemberId||'',keepers)+input('location','归还及存放位置',row?.location,'required maxlength="150"')+area('notes','设备说明',row?.notes||'');
  }else if(action==='borrow'){
   if(row.status!=='available')throw new ContractError('设备当前不可借，请刷新目录。');const state=await api.sampleState();if(!state.canBorrow)throw new ContractError('请先关联有效成员档案。');
   body=`<p>${h(row.name)} · ${h(row.assetTag)} · 借用人：${h(state.member.displayName)}</p>`+input('location','借用后使用位置','','required maxlength="150"')+select('shootingRequestId','关联拍摄需求',shootingId||'',[['','不关联'],...state.shooting.map(s=>[s.id,s.title])])+area('note','借用说明');
  }else if(action==='return'){
   if(row.returnedAt)throw new ContractError('这条借用已归还。');body=`<p>${h(row.name)} · 请交回 ${h(row.returnLocation)}，再登记归还。</p>`+select('condition','归还状况','ok',[['ok','完好'],['issue','有异常，需要维修']])+area('note','归还说明（异常时必填）')+'<p class="muted">异常设备归还后进入待维修，不会直接恢复可借。</p>';
  }else if(action==='relocate')body=input('location','当前使用位置',row.location,'required maxlength="150"')+area('note','变更说明');
  else{operation='state';body=`<p>${h(row.name)} · ${h(row.assetTag)}</p>`+area('note','操作原因（必填）')+'<p class="muted">在借设备必须先由借用人归还，维修及停用记录会保留。</p>';}
  const label={register:'登记设备',edit:'编辑设备',borrow:'借用设备',return:'归还设备',relocate:'更新设备使用位置',maintenance:'设备送修',ready:row?.status==='retired'?'恢复设备':'完成设备维修',retired:'停用设备'}[action];
  mount(label,body,f=>{
   let value;if(['register','edit'].includes(action))value={assetTag:f.get('assetTag'),name:f.get('name'),model:f.get('model'),keeperMemberId:f.get('keeperMemberId')||null,location:f.get('location'),notes:f.get('notes')};
   else if(action==='borrow')value={location:f.get('location'),shootingRequestId:f.get('shootingRequestId')||null,note:f.get('note')};
   else if(action==='return')value={condition:f.get('condition'),note:f.get('note')};else if(action==='relocate')value={location:f.get('location'),note:f.get('note')};else value={action,note:f.get('note')};
   return api.equipmentWrite(operation,id,{...value,requestKey:key},row?.version);
  },{kind:'equipment'},async()=>api.equipmentReceipt(key,operation,id));
 }
 async function expense(id){
  const data=await api.finance(),row=id?data.records.find(r=>r.id===id):null;if(id&&(!row||row.settlementId))throw new ContractError('已结算或不可见的支出不能编辑。');const key=crypto.randomUUID();
  mount(row?'编辑支出':'记录支出',input('expenseDate','发生日期',row?.expenseDate||chinaDate(),'required type="date"')+area('description','支出事项',row?.description||'')+input('amount','金额（元）',row?decimal(row.amountCents):'','required inputmode="decimal" placeholder="0.00"')+select('paymentMode','支付方式',row?.paymentMode||'company',[['company','公司支付'],['advance','个人垫付']])+select('payerId','垫付人（公司支付时留空）',row?.payerId||'',choices(data.members,'displayName',row?.payerId))+select('storeId','店铺',row?.storeId||'',choices(data.stores,'name',row?.storeId))+select('categoryId','支出分类',row?.categoryId||'',choices(data.categories,'name',row?.categoryId))+area('note','备注',row?.note||'')+'<p class="muted">登记已发生的支出；本操作不发起扣款或转账。已纳入结算的支出保持原记录。</p>',f=>{const value={expenseDate:f.get('expenseDate'),description:f.get('description'),amount:f.get('amount').trim(),paymentMode:f.get('paymentMode'),payerId:f.get('payerId')||null,storeId:f.get('storeId')||null,categoryId:f.get('categoryId')||null,note:f.get('note')};if(!row)value.requestKey=key;return api.saveExpense(id,value,row?.version);},{kind:'finance'},row?undefined:async()=>{const fresh=await api.finance();return fresh.records.find(r=>r.requestKey===key)||null;});
 }
 async function category(id){
  const row=id?(await api.finance()).categories.find(c=>c.id===id):null;if(id&&!row)throw new ContractError('原分类暂不可见。');
  mount(row?'编辑支出分类':'新增支出分类',input('name','分类名称',row?.name||'','required maxlength="100"')+stateSelect(row)+'<p class="muted">停用后不再用于新增支出，原有支出的分类关联继续保留。</p>',f=>row?api.updateExpenseCategory(row.id,f.get('name'),f.get('active')==='true',row.version):api.createExpenseCategory(f.get('name')),{kind:'finance'});
 }
 async function removeExpenseReceipt(id,receipt){
  const data=await api.finance(),row=data.records.find(r=>r.id===id),file=row?.receipts?.find(r=>r.id===receipt);
  if(!row||!file)throw new ContractError('原凭证不可见，请刷新支出后核对。');if(row.settlementId)throw new ContractError('已纳入结算的支出不能删除凭证。');
  mount('删除支出凭证',`<p>${h(file.name)}</p><p>删除后无法从工作台恢复文件，操作记录会保留。请先确认原文件已另行保存。</p><label><input type="checkbox" name="confirmed" required>我确认删除这张凭证</label>`,f=>{if(f.get('confirmed')!=='on')throw new ContractError('请先确认要删除的凭证。');return api.removeExpenseReceipt(id,receipt,row.version);},{kind:'finance',expenseId:id,submitLabel:'确认删除'});
 }
 async function settlement(){
  const data=await api.finance(),pending=data.records.filter(r=>r.paymentMode==='advance'&&!r.settlementId);if(!pending.length)throw new ContractError('没有可纳入结算的垫付。');const payers=[...new Map(pending.map(r=>[r.payerId,r.payerName])).entries()],key=crypto.randomUUID();
  mount('新建垫付结算',select('payerId','垫付人',payers[0][0],payers)+input('startDate','支出起始日期','','required type="date"')+input('endDate','支出截止日期','','required type="date"')+'<fieldset class="material-picker" id="settlement-items"><legend>纳入本次结算的支出</legend></fieldset><p id="settlement-total" class="muted"></p>'+area('note','结算说明')+'<p class="muted">结算只确认选中明细，不代表已经报销。实际报销发生后再单独登记。</p>',f=>{const selected=f.getAll('expenseIds').map(id=>pending.find(r=>r.id===id));if(selected.some(r=>!r||r.payerId!==f.get('payerId')||r.expenseDate<f.get('startDate')||r.expenseDate>f.get('endDate')))throw new ContractError('所选明细必须属于同一垫付人及日期区间。');return api.createSettlement({payerId:f.get('payerId'),startDate:f.get('startDate'),endDate:f.get('endDate'),items:selected.map(r=>({expenseId:r.id,expectedVersion:r.version})),note:f.get('note'),requestKey:key});},{kind:'finance'},async()=>{const fresh=await api.finance();return fresh.settlements.find(s=>s.requestKey===key)||null;},form=>{
   const render=()=>{const records=pending.filter(r=>r.payerId===form.elements.payerId.value),dates=records.map(r=>r.expenseDate).sort();form.elements.startDate.value=dates[0]||'';form.elements.endDate.value=dates.at(-1)||'';form.querySelector('#settlement-items').innerHTML='<legend>纳入本次结算的支出</legend>'+records.map(r=>`<label><input type="checkbox" name="expenseIds" value="${h(r.id)}">${h(r.expenseDate)} · ${h(r.description)} · ${h(money(r.amountCents))}</label>`).join('');total();};
   const total=()=>{const ids=[...form.querySelectorAll('[name=expenseIds]:checked')].map(el=>el.value);form.querySelector('#settlement-total').textContent='本次选中 '+ids.length+' 笔 · '+money(pending.filter(r=>ids.includes(r.id)).reduce((sum,r)=>sum+cents(r.amountCents),0n).toString());};form.elements.payerId.onchange=render;form.querySelector('#settlement-items').onchange=total;render();
  });
 }
 async function payment(id){
  const data=await api.finance(),row=data.settlements.find(s=>s.id===id);if(!row||cents(row.remainingCents)===0n)throw new ContractError('这张结算没有待登记的报销余额。');const key=crypto.randomUUID();
  mount('登记已发生的报销',`<p>${h(row.payerName)} · 当前尚未结清 ${h(money(row.remainingCents))}</p>`+input('amount','本次实际报销金额（元）','','required inputmode="decimal"')+input('paidDate','实际报销日期',chinaDate(),'required type="date"')+area('note','报销说明')+'<p class="muted">仅记录已经发生的报销，支持部分报销。本操作不执行银行付款。</p>',f=>api.recordPayment({settlementId:id,requestKey:key,amount:f.get('amount').trim(),paidDate:f.get('paidDate'),note:f.get('note')},row.version),{kind:'finance'},async()=>{const fresh=await api.finance();return fresh.payments.find(p=>p.requestKey===key)||null;});
 }
 return {nextRound,experimentProduct,directory,memberLogin,accountAccess,equipment,expense,category,removeExpenseReceipt,settlement,payment};
}
