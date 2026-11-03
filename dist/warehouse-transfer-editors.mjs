import {ContractError} from './cloud-contract.mjs';

export function createWarehouseTransferEditors({api,h,mount,input,area,select}){
 async function warehouseToSamples(id){
  const [row,members]=await Promise.all([api.warehouseItem(id),api.members()]);
  if(!row.active||!row.openingConfirmed||row.kind!=='product'||!['件','个'].includes(row.unit)||row.quantity<1)throw new ContractError('仅支持已有期初且有余量的件/个产品库存转样品。');
  const key=crypto.randomUUID();let selected=null;
  const body=`<p>${h(row.name)} · ${h(row.specification||'无规格说明')} · 当前 ${row.quantity} ${h(row.unit)}</p>`+input('quantity','本次转为样品的数量','',`required type="number" min="1" max="${row.quantity}" step="1"`)+select('targetMode','样品目标','new',[['new','新建对应样品档案'],['existing','补充已有样品档案']])+`<div class="transfer-new-fields" data-transfer-new>${input('newSampleName','样品名称',row.name,'maxlength="120"')}${input('newSampleLocation','样品存放位置','','maxlength="150"')}${select('newKeeper','样品保管人','',[['','暂不指定'],...members.filter(m=>m.active).map(m=>[m.id,m.displayName])])}${area('newSampleNotes','样品说明',row.specification?'规格：'+row.specification:'')}</div><div class="transfer-existing-fields" data-transfer-existing hidden><label>查找样品<input type="search" data-transfer-query maxlength="100" placeholder="样品名称或存放位置"></label><p class="muted" data-transfer-selected>尚未选择样品。</p><fieldset class="material-picker" data-transfer-targets><legend>同一产品的可转入样品</legend></fieldset><div class="pager"><button type="button" class="secondary" data-transfer-prev>上一页</button><span data-transfer-caption></span><button type="button" class="secondary" data-transfer-next>下一页</button></div></div>`+area('reason','转为样品的原因（必填）')+input('sourceReference','来源参考','','maxlength="200"')+`<label class="transfer-confirm"><input type="checkbox" name="transferConfirmed" required>已核对规格与单位，按 1 ${h(row.unit)}转为 1 件样品登记。</label><p class="muted">已有样品一旦关联来源，后续只能接收本库存项目；转出后进入样品可借库存，后续领还在样品中登记，商品库存不自动增加。</p>`;
  mount('产品转为拍摄样品',body,f=>{
   const raw=f.get('quantity');if(typeof raw!=='string'||!raw.trim())throw new ContractError('请填写转出数量。');
   const mode=f.get('targetMode');if(mode==='existing'&&!selected)throw new ContractError('请选择已核对规格的目标样品。');
   const target=mode==='new'?{mode:'new',name:f.get('newSampleName'),warehouseLocation:f.get('newSampleLocation'),keeperMemberId:f.get('newKeeper')||null,notes:f.get('newSampleNotes')}:{mode:'existing',sampleId:selected.id,expectedVersion:selected.version};
   return api.warehouseToSamples(id,{requestKey:key,quantity:Number(raw),reason:f.get('reason'),sourceReference:f.get('sourceReference'),confirmed:f.get('transferConfirmed')==='on',target},row.version);
  },{kind:'warehouse',id},async()=>api.warehouseReceipt(key,'transfer',id),form=>{
   const lifetime=new AbortController();let request,timer,offset=0,serial=0,rows=[];
   const query=form.querySelector('[data-transfer-query]'),results=form.querySelector('[data-transfer-targets]'),previous=form.querySelector('[data-transfer-prev]'),next=form.querySelector('[data-transfer-next]'),caption=form.querySelector('[data-transfer-caption]');
   const chosen=()=>{form.querySelector('[data-transfer-selected]').textContent=selected?'已选择：'+selected.name+' · '+selected.warehouseLocation+' · 当前可借 '+selected.availableQuantity+' 件；'+(selected.sourceItemId?'已关联本来源。':'首次关联，请核对规格。'):'尚未选择样品。';};
   async function load(){
    if(lifetime.signal.aborted||form.elements.targetMode.value!=='existing')return;request?.abort();request=new AbortController();const signal=AbortSignal.any([lifetime.signal,request.signal]),current=++serial;
    results.innerHTML='<legend>同一产品的可转入样品</legend><p class="muted">正在读取…</p>';previous.disabled=true;next.disabled=true;
    try{
     const data=await api.warehouseSampleTargets(id,{q:query.value,offset},signal);if(signal.aborted||current!==serial||!form.isConnected||form.querySelector('[type=submit]').disabled)return;
     rows=data.rows;if(!rows.length&&offset>0){offset=Math.max(0,offset-50);await load();return;}
     results.innerHTML='<legend>同一产品的可转入样品</legend>'+rows.map(r=>`<label><input type="radio" name="targetSelection" value="${h(r.id)}" ${selected?.id===r.id?'checked':''}><span>${h(r.name)} · ${h(r.warehouseLocation)} · 可借 ${r.availableQuantity} 件${r.sourceItemId?' · 已关联本来源':''}</span></label>`).join('');
     if(!rows.length)results.insertAdjacentHTML('beforeend','<p class="muted">暂无可转入的样品，可切换为新建对应档案。</p>');caption.textContent=data.total?`${offset+1}–${offset+rows.length} / ${data.total} 项`:'0 项';previous.disabled=offset===0;next.disabled=offset+data.limit>=data.total;
    }catch(e){if(!signal.aborted)results.textContent=e.message;}
   }
   results.onchange=e=>{const target=rows.find(r=>r.id===e.target.value);if(target){selected=target;chosen();}};
   const sync=()=>{const existing=form.elements.targetMode.value==='existing';form.querySelector('[data-transfer-new]').hidden=existing;form.querySelector('[data-transfer-existing]').hidden=!existing;form.elements.newSampleName.required=!existing;form.elements.newSampleLocation.required=!existing;if(existing)load();else request?.abort();};
   form.elements.targetMode.onchange=sync;query.oninput=()=>{offset=0;clearTimeout(timer);timer=setTimeout(load,250);};previous.onclick=()=>{offset=Math.max(0,offset-50);load();};next.onclick=()=>{offset+=50;load();};chosen();sync();
   return ()=>{lifetime.abort();request?.abort();clearTimeout(timer);};
  });
 }
 return {warehouseToSamples};
}
