import {chinaDate} from './cloud-contract.mjs';
import {money} from './management-model.mjs';
const decimal=n=>Math.floor(n/100)+'.'+String(n%100).padStart(2,'0');
export function createOperatingFinanceEditors({api,h,mount,input,area,select}){
 async function operatingFinance(kind='sale',id=null,parentId=null){
  const [state,data]=await Promise.all([id?api.operatingRecord(id):null,api.finance()]);
  const r=state?.record,parent=parentId?await api.operatingRecord(parentId):state?.parent?await api.operatingRecord(state.parent.id):null;
  if(r?.status==='void')throw new Error('这条记录已经作废。');
  kind=r?.kind||kind;const original=parent?.record;if(kind==='refund'&&(!original||original.kind!=='sale'||original.status!=='active'))throw new Error('请从有效原销售记录登记客户退款。');
  const key=crypto.randomUUID(),expense=r?.expenseId?data.records.find(e=>e.id===r.expenseId):null;
  if(r?.expenseId&&!expense)throw new Error('原支出暂不可见，请重新核对。');
  const currentExpense=expense?.version!==r?.expenseSnapshot?.version,labels={sale:'日常销售',refund:'客户退款',fee:'平台已扣佣金／手续费'};
  const fixedStore=r?.storeId||original?.storeId;
  const body=`<p>${h(labels[kind])}${r?' · '+h(r.sourceReference):''}</p>`+(kind==='fee'?'<p class="muted">记录平台已经从可提现金额中扣除的项目，仅供核对，不再扣利润；另外支付的费用请从记账本记录日常支出。</p>':'')+(fixedStore?`<p>业务店铺 ${h(r?.storeName||original.storeName)}</p>`:select('storeId','业务店铺','',[['','请选择'],...data.stores.filter(s=>s.active).map(s=>[s.id,s.name])]))+
   (original?`<p>原销售 ${h(original.sourceReference)} · ${h(original.businessDate)} · ${h(money(original.amountCents))} · 当前有效退款 ${h(money(parent.refundedCents))}</p>`:'')+
   (!r?input('sourceReference','来源编号（订单、日汇总或平台单号）','','required maxlength="200"'):'')+
   (kind==='fee'&&!r?select('expenseId','引用已登记支出（整笔金额）','',[['','不引用已有支出'],...data.records.map(e=>[e.id,`${e.expenseDate} · ${e.description} · ${money(e.amountCents)}`])]):expense?`<p>原支出 ${h(expense.description)} · ${h(money(expense.amountCents))}${currentExpense?' · 本次按当前支出重新核对':''}</p>`:'')+
   input('businessDate',kind==='refund'?'实际退款日期':'业务发生日期',r?.businessDate||chinaDate(),'required type="date"')+
   input('amount','金额（元）',expense?decimal(expense.amountCents):r?decimal(r.amountCents):'','required inputmode="decimal" maxlength="11"'+(expense?' readonly':''))+
   input('description','事项说明',r?.description,'required maxlength="500"')+area('note','补充备注',r?.note)+area('reason',r?'本次修正依据':'登记依据');
  mount((r?'修正':'登记')+labels[kind],body,f=>{
   const source=r?expense:kind==='fee'?data.records.find(e=>e.id===f.get('expenseId')):null;
   const value={requestKey:key,businessDate:f.get('businessDate'),amount:f.get('amount').trim(),description:f.get('description'),note:f.get('note'),reason:f.get('reason'),parentVersion:original?.version??null,expenseVersion:source?.version??null};
   return api.saveOperatingRecord(id,r?{...value,expectedVersion:r.version}:{...value,kind,storeId:fixedStore||f.get('storeId'),parentId:original?.id??null,expenseId:source?.id??null,sourceReference:f.get('sourceReference')});
  },{kind:'operating-finance',id},()=>api.operatingReceipt(key,id?'revise':'create',id),form=>{
   const choice=form.querySelector('[name=expenseId]');if(!choice)return;
   const changed=()=>{const expense=data.records.find(e=>e.id===choice.value),amount=form.querySelector('[name=amount]');amount.readOnly=!!expense;if(expense){amount.value=decimal(expense.amountCents);amount.dispatchEvent(new Event('input',{bubbles:true}));}};
   choice.addEventListener('change',changed);return ()=>choice.removeEventListener('change',changed);
  });
 }
 async function operatingFinanceVoid(id){
  const {record:r}=await api.operatingRecord(id),key=crypto.randomUUID();if(r.status==='void')throw new Error('这条记录已经作废。');
  mount('作废收支记录',`<p>${h(r.sourceReference)} · ${h(r.description)} · ${h(money(r.amountCents))}</p><p class="muted">作废后保留历史，不再计入有效日常记录合计；引用的原支出保持原记录。</p>`+area('reason','作废原因（必填）'),f=>api.voidOperatingRecord(id,{requestKey:key,expectedVersion:r.version,reason:f.get('reason')}),{kind:'operating-finance',id},()=>api.operatingReceipt(key,'void',id));
 }
 return {operatingFinance,operatingFinanceVoid};
}
