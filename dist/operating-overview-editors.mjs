import {signedCostMoney} from './cost-sources-contract.mjs';
const decimal=n=>(n<0?'-':'')+Math.floor(Math.abs(n)/100)+'.'+String(Math.abs(n)%100).padStart(2,'0');
export function createOperatingOverviewEditors({api,h,mount,input,area}){
 async function monthIncome(id,month,withdraw=false){
  const s=await api.monthIncome(id,month),r=s.record,key=crypto.randomUUID();if(withdraw&&r?.status!=='confirmed')throw new Error('该月尚无有效收入确认。');
  const body=`<p>${h(s.store.name)} · ${h(month)}</p><p class="muted">按平台月度汇总单手工填写可提现金额，佣金、退款等平台已扣项目不再扣一次。商品货款、一件代发成本及工作室其他费用另算；平台单据上的“净利润”在这里作为经营收入起点。</p>`+
   (withdraw?`<p>撤回当前第 ${r.version} 版 · ${h(signedCostMoney(String(r.amountCents)))}</p>`:input('amount','本月平台可提现收入（元，可为零或负数）',r?decimal(r.amountCents):'','required inputmode="decimal" maxlength="12"')+input('sourceReference','平台月度汇总单编号或核对来源',r?.sourceReference,'required maxlength="200"'))+area('reason',withdraw?'撤回原因（必填）':'确认或修正依据（必填）');
  mount(withdraw?'撤回本月收入确认':'确认店铺月度收入',body,f=>api.saveMonthIncome(id,{requestKey:key,expectedVersion:r?.version??0,month,amount:withdraw?decimal(r.amountCents):f.get('amount').trim(),sourceReference:withdraw?r.sourceReference:f.get('sourceReference'),reason:f.get('reason'),status:withdraw?'withdrawn':'confirmed'}),{kind:'month-income',id,month},()=>api.monthIncomeReceipt(id,key,month));
 }
 return {monthIncome};
}
