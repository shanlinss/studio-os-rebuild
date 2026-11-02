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
 async function expense(id){
  const data=await api.finance(),row=id?data.records.find(r=>r.id===id):null;if(id&&(!row||row.settlementId))throw new ContractError('已结算或不可见的支出不能编辑。');const key=crypto.randomUUID();
  mount(row?'编辑支出':'记录支出',input('expenseDate','发生日期',row?.expenseDate||chinaDate(),'required type="date"')+area('description','支出事项',row?.description||'')+input('amount','金额（元）',row?decimal(row.amountCents):'','required inputmode="decimal" placeholder="0.00"')+select('paymentMode','支付方式',row?.paymentMode||'company',[['company','公司支付'],['advance','个人垫付']])+select('payerId','垫付人（公司支付时留空）',row?.payerId||'',choices(data.members,'displayName',row?.payerId))+select('storeId','店铺',row?.storeId||'',choices(data.stores,'name',row?.storeId))+select('categoryId','支出分类',row?.categoryId||'',choices(data.categories,'name',row?.categoryId))+area('note','备注',row?.note||'')+'<p class="muted">登记已发生的支出；本操作不发起扣款或转账。已纳入结算的支出保持原记录。</p>',f=>{const value={expenseDate:f.get('expenseDate'),description:f.get('description'),amount:f.get('amount').trim(),paymentMode:f.get('paymentMode'),payerId:f.get('payerId')||null,storeId:f.get('storeId')||null,categoryId:f.get('categoryId')||null,note:f.get('note')};if(!row)value.requestKey=key;return api.saveExpense(id,value,row?.version);},{kind:'finance'},row?undefined:async()=>{const fresh=await api.finance();return fresh.records.find(r=>r.requestKey===key)||null;});
 }
 function category(){mount('新增支出分类',input('name','分类名称','','required maxlength="100"'),f=>api.createExpenseCategory(f.get('name')),{kind:'finance'});}
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
 return {nextRound,experimentProduct,directory,expense,category,settlement,payment};
}
