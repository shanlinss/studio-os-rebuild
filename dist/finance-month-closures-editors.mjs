export function createFinanceClosingEditors({api,h,mount,area}){
 async function financeClosing(month){
  const s=await api.financeClosing(month),locked=s.record?.action==='lock',candidate=s.candidate,key=crypto.randomUUID();if(!locked&&!candidate?.ready)throw new Error('本月经营依据尚未齐全，请先处理月度来源检查中的待补项。');
  const title=locked?'重新开放财务月份':'确认并锁定财务月份';
  mount(title,`<p>${h(month)} · ${locked?'当前第 '+s.record.version+' 版已锁定':'来源已读取，保存时将再次核查'}</p>`+(locked?'<p class="planning-rule">重新开放后可以更正原收入、支出和成本。原锁定快照及开放原因保留；更正完成后重新检查并锁定。若历史库存成本涉及其他已锁月份，需要同时开放受影响的月份。</p>':`<p class="planning-rule">锁定保留当前经营结果和来源，历史更正需先重新开放。实际到账与报销仍按原记录继续处理，不重复计入利润。</p><label><input type="checkbox" name="coverageConfirmed" required> 我已核对平台月度收入、商品／代发成本、公共费用和其他应计事项，确认该月没有遗漏应录来源。</label><label><input type="checkbox" name="reviewConfirmed" required> 我已核对本次 ${candidate.snapshot.counts.review} 项资金与报销提示，理解它们不代表银行余额或所选月末报销余额。</label>`)+area('reason',locked?'重新开放原因（必填）':'月结核对说明（必填）'),f=>api.saveFinanceClosing({requestKey:key,month,action:locked?'reopen':'lock',expectedVersion:s.record?.version??0,sourceHash:locked?s.record.sourceHash:candidate.sourceHash,coverageConfirmed:locked?false:f.get('coverageConfirmed')==='on',reviewConfirmed:locked?false:f.get('reviewConfirmed')==='on',reason:f.get('reason')}),{kind:'finance-closing',month},()=>api.financeClosingReceipt(key,month));
 }
 return {financeClosing};
}
