import {openingState,openingHistory,openingPayload} from './product-opening-contract.mjs';
import {costMonth,costCatalog,costReview} from './product-cost-contract.mjs';
import {productPurchaseState,productPurchaseHistory,productPurchasePayload} from './product-purchase-contract.mjs';
import {productStockOptions,productStockPayload,productStockDetail,productReturnPayload} from './product-stock-contract.mjs';
import {commercialState,commercialPayload,commercialHistory} from './commercial-products-contract.mjs';
import {financeState,rechargeRecord,rechargePage,rechargeHistory,balancePage,reminderState,reminderHistory,reminderPage,rechargePayload,voidPayload,balancePayload,reminderPayload,operationPath,operationAction,operationResult} from './phone-card-finance-contract.mjs';
import {phoneCard,phoneCardPage,phoneCardHistory,phoneCardIdentity,phoneCardOptions,phoneCardPayload,phoneCardIdentityPayload,phoneCardResult} from './phone-cards-contract.mjs';
import {handoverState,handoverPayload,handoverPage} from './equipment-assets-contract.mjs';
import {equipmentPurchaseState,equipmentPurchaseHistory,equipmentPurchasePayload,equipmentPurchaseResult} from './equipment-purchase-contract.mjs';
import {inventoryAccessPayload,inventoryAccessState,inventoryAccessMine,inventoryAccessHistory,inventoryAccessResult} from './inventory-access-contract.mjs';
import {employmentPayload,adminReviewPayload,personnelHistory,adminReviewHistory} from './personnel-contract.mjs';
import {confirmationDetail,confirmationHistory,confirmationPayload,exportable,exportPayload,readWorkbook} from './payroll-confirmation-contract.mjs';
import {payrollState,payrollHistory,payrollPayload} from './payroll-contract.mjs';
import {closureState,closureDetail,closureHistory,closurePayload} from './closure-contract.mjs';
import {validMonth,monthlyResult,calendarMonth,calendarHistory,calendarPayload} from './monthly-contract.mjs';
import {exceptionPage,exceptionDetail,exceptionHistory,exceptionPayload} from './exception-contract.mjs';
import {leavePage,leaveRecord,leaveHistory,leavePayload,leavePath} from './leave-contract.mjs';
import {attendancePage,attendanceDetail,attendanceHistory,attendancePayload,attendanceWritePath} from './attendance-contract.mjs';
import {dailyAttendanceState,endWorkPayload,endWorkResult} from './daily-attendance.mjs';
import {permissionPayload} from './admin-permissions.mjs';
import {accountLifecyclePayload,accountLifecycleResult} from './account-lifecycle-contract.mjs';
import {warehouseItem,warehouseCatalog,warehouseMovement,warehouseHistory,warehousePayload,warehousePath,sampleTargetPage,sampleTransferPayload,sampleTransferPage,scopedWarehouseCatalog,scopedWarehouseDetail,scopedWarehousePayload,packagingPurchasePayload,packagingPurchaseHistory,consumptionOptions,consumptionPayload,consumptionDetail,packagingTransferPayload,packagingTransferDetail,reorderAlerts,reorderThresholdPayload} from './warehouse-contract.mjs';
import {equipmentRecord,equipmentPage,equipmentPayload,equipmentPath} from './equipment-contract.mjs';
import {sampleState,samplePage,samplePayload,sampleOperationPath} from './sample-contract.mjs';
import {assetPath,mediaUpload,readMedia,expenseReceiptMaxBytes} from './media-contract.mjs';
import {shootingPayload,shootingAction,shootingProgress,shootingArchive} from './shooting-contract.mjs';
import {expectedVersion} from './write-contract.mjs';
import {createMutationGateway} from './mutation-gateway.mjs';
import {materialPayload,productPayload,publicationPayload,snapshotPayload,todoPayload,experimentDraftPayload,dispatchPayload,reviewPayload,conclusionPayload,nextRoundPayload,directoryPayload,expensePayload,settlementPayload,paymentPayload,accountAccessPayload} from './write-contract.mjs';
import {todoModel} from './workbench-model.mjs';
import {financeRecord,pagedRows} from './management-model.mjs';
import {namedList,templateRecord,titleCatalog,titleBatch,knowledgeList,knowledgeNavigationPayload} from './resource-model.mjs';
import {ApiError,ContractError,chinaDate,validDate} from './cloud-contract.mjs';
export {ApiError,ContractError,chinaDate,validDate} from './cloud-contract.mjs';
import {productRecord,shootingRecord,executionRows} from './business-model.mjs';
// View adapter for existing HTTP APIs. Writes require an explicit connected build and authenticated token.
const record = v => v!==null&&typeof v==='object'&&!Array.isArray(v);
const string = v => typeof v==='string';
const number = v => typeof v==='number'&&Number.isFinite(v);
function list(value){if(!Array.isArray(value))throw new ContractError();return value;}
function identity(v){if(!record(v)||!string(v.id)||!string(v.username)||!['admin','employee'].includes(v.role))throw new ContractError();const out={id:v.id,username:v.username,role:v.role};if(Object.hasOwn(v,'superadmin')){if(typeof v.superadmin!=='boolean')throw new ContractError();out.superadmin=v.superadmin;}if(Object.hasOwn(v,'permissions')){if(!Array.isArray(v.permissions)||v.permissions.some(p=>!['finance','account_security','payroll','personnel','resources','resource_identity'].includes(p)))throw new ContractError();out.permissions=[...v.permissions];}return out;}
function base(v){if(!record(v)||!string(v.id)||!string(v.title))throw new ContractError();return v;}
function endpointId(id){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new ContractError('记录标识格式无效。');return id;}
export function materialModel(raw){
  base(raw);if(!record(raw.metadata)||!number(raw.version)||(raw.metadata.tags!==undefined&&(!Array.isArray(raw.metadata.tags)||!raw.metadata.tags.every(string))))throw new ContractError();
  const meta=raw.metadata;
  return {...raw,tags:[...(meta.tags??[])],note:string(meta.notes)?meta.notes:'',kind:meta.mediaType==='视频'?'视频':meta.category==='标题'?'标题':meta.category==='图片'?'图片':meta.mediaType?'参考笔记':'未分类',
    // Preserve original independent dimensions; never write a guessed inverse mapping.
    sourceMetadata:{...meta},archiveSupported:false,assetCount:Array.isArray(raw.assets)?raw.assets.length:null};
}
export function experimentModel(raw){
  base(raw);if(!string(raw.status)||!number(raw.version)||!Array.isArray(raw.rounds))throw new ContractError();
  const refs=new Map();
  for(const round of raw.rounds){if(!record(round)||!string(round.id)||!Array.isArray(round.materials)||!Array.isArray(round.tasks))throw new ContractError();for(const m of round.materials){base(m);refs.set(m.id,{...m});}}
  return {...raw,materials:[...refs.values()],phase:raw.status==='testing'?(raw.rounds.some(r=>r.tasks.length)?'测试中':'待安排'):raw.status==='concluded'?'已结束':'未知状态',finding:raw.finding??null,recommendation:raw.recommendation??null};
}
export function ownTasks(rows,profile,role){
  list(rows);if(!profile)return [];
  rows.forEach(base);
  if(role==='employee')return rows; // The server intentionally redacts memberId for employees.
  if(role!=='admin')throw new ContractError();
  return rows.filter(t=>t.memberId===profile.id);
}
export function taskModel(raw){
  if(!record(raw)||!record(raw.task))throw new ContractError();base(raw.task);
  const publications=list(raw.publications),snapshots=list(raw.snapshots);
  if(raw.materials!==undefined&&(!Array.isArray(raw.materials)||raw.materials.some(m=>!record(m)||!string(m.id)||!string(m.title))))throw new ContractError();
  return {...raw.task,materials:raw.materials?.map(m=>({...m}))??[],completion:raw.completion??null,publications:publications.map(p=>{if(!record(p)||!string(p.id))throw new ContractError();return {...p,snapshots:snapshots.filter(s=>{if(!record(s)||!string(s.publicationId))throw new ContractError();return s.publicationId===p.id;})};})};
}
export function metricValue(value){if(value===null||value===undefined)return '未记录';if(!number(value)||value<0)throw new ContractError();return String(value);}
export function taskProgress(t){
  if(t.completedAt)return '已完成';
  if(t.kind==='shooting')return t.shootingStatus||'待处理';
  if(t.kind==='action')return '待完成';
  const n=number(t.publishedCount)?t.publishedCount:null,filled=number(t.filledCount)?t.filledCount:null;
  return n===null?'执行进度未提供':`已发布 ${n}${number(t.targetCount)?' / '+t.targetCount:''} 篇${filled===null?'':' · '+filled+' 篇已回填'}`;
}
export function createCloudApi(fetcher=globalThis.fetch,{allowWrites=false}={}){
  const mutations=createMutationGateway(fetcher,{enabled:allowWrites});
  async function get(path,signal){
    let r;try{r=await fetcher(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json'}});}catch(e){if(e.name==='AbortError')throw e;throw new ApiError(0,allowWrites?'工作空间连接暂时中断，请稍后重新读取资料。':'云端连接中断，请检查 SSH 窗口是否仍然开启。');}
    if(r.status===401)mutations.clear();
    if(!r.ok)throw new ApiError(r.status,r.status===401?'登录已失效，请回原工作台登录后重试。':r.status===403?'当前账号没有读取这项资料的权限。':'云端读取失败，请重试。');
    try{return await r.json();}catch{throw new ContractError();}
  }
  async function read(path,signal,adapt){const value=adapt(await get(path,signal));mutations.confirmRead(path);return value;}
  async function labCapability(){if(!allowWrites)throw new ApiError(405,'当前为只读预览，未发送保存请求。');const c=await get('/api/workbench/capabilities');if(!record(c)||c.materialLabDrafts!==1)throw new ContractError('实验草稿与执行安排兼容尚未接入。');}
  return {
    async asset(kind,owner,asset,context={},signal){let r;try{r=await fetcher(assetPath(kind,owner,asset,context),{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});}catch(e){if(e.name==='AbortError')throw e;throw new ApiError(0,'附件读取中断，请重试。');}if(!r.ok){if(r.status===401)mutations.clear();throw new ApiError(r.status,r.status===401?'登录已失效，请重新登录。':r.status===403?'当前账号无权读取这个附件。':'附件暂不可读取，请刷新资料核对。');}return readMedia(r,kind==='expense'?{maxBytes:expenseReceiptMaxBytes,imagesOnly:true}:{});},
    async uploadExpenseReceipt(id,file,version){const f=mediaUpload(file,{imagesOnly:true,maxBytes:expenseReceiptMaxBytes});return mutations.send('/api/finance/expenses/'+endpointId(id)+'/receipts','POST',f.file,{binary:true,headers:{'Content-Type':f.mime,'x-file-name':encodeURIComponent(f.name),'x-expected-version':String(expectedVersion(version))}});},
    async removeExpenseReceipt(id,receipt,version){return mutations.send(assetPath('expense',id,receipt),'DELETE',{expectedVersion:expectedVersion(version)});},
    async financeEvents(id,signal){return read('/api/finance/events/'+endpointId(id),signal,v=>{if(!Array.isArray(v)||v.some(e=>!record(e)||typeof e.action!=='string'||typeof e.actor!=='string'||!Number.isFinite(Date.parse(e.createdAt))))throw new ContractError();return v;});},
    async uploadMaterial(id,file){const f=mediaUpload(file);return mutations.send('/api/materials/'+endpointId(id)+'/assets','POST',f.file,{binary:true,headers:{'Content-Type':f.mime,'x-file-name':encodeURIComponent(f.name),'x-asset-kind':'screenshot'}});},
    async downloadMaterial(id,asset){return mutations.send(assetPath('material',id,asset)+'/downloads','POST',{}, {responseType:'media'});},
    async confirmMaterialDownload(id,asset,receipt){return mutations.send(assetPath('material',id,asset)+'/downloads/'+endpointId(receipt),'POST',{});},
    async uploadPublication(task,publication,file){const f=mediaUpload(file);return mutations.send('/api/tasks/'+endpointId(task)+'/publications/'+endpointId(publication)+'/assets','POST',f.file,{binary:true,headers:{'Content-Type':f.mime,'x-file-name':encodeURIComponent(f.name)}});},
    async shootingAssignees(signal){return namedList(await get('/api/shooting/assignees',signal),'displayName');},
    async createShooting(value){return mutations.send('/api/shooting/requests','POST',shootingPayload(value));},
    async updateShooting(id,value,version){return mutations.send('/api/shooting/requests/'+endpointId(id),'PATCH',shootingPayload(value,version));},
    async shootingState(id,value,version){return mutations.send('/api/shooting/requests/'+endpointId(id)+'/state','POST',shootingAction(value,version));},
    async shootingItem(id,item,completed,version,key){return mutations.send('/api/shooting/requests/'+endpointId(id)+'/items/'+endpointId(item),'PATCH',shootingProgress(key,completed,version));},
    async archiveShooting(id,archived,version,key){return mutations.send('/api/shooting/requests/'+endpointId(id)+'/archive','POST',shootingArchive(key,archived,version));},
    async uploadShooting(id,file,version,key,{itemId,note=''}={}){const f=mediaUpload(file,{imagesOnly:!!itemId}),v=expectedVersion(version);endpointId(key);if(typeof note!=='string'||note.length>1000)throw new ContractError('附件说明最多 1000 字。');return mutations.send('/api/shooting/requests/'+endpointId(id)+(itemId?'/items/'+endpointId(itemId):'')+'/assets','POST',f.file,{binary:true,headers:{'Content-Type':f.mime,'x-file-name':encodeURIComponent(f.name),'x-expected-version':String(v),'x-request-key':key,'x-file-note':encodeURIComponent(note)}});},
    async nextRound(id,value,version){return mutations.send('/api/lab/experiments/'+endpointId(id)+'/rounds','POST',nextRoundPayload(value,version));},
    async experimentProduct(id,product,version){return mutations.send('/api/lab/experiments/'+endpointId(id)+'/product','PATCH',{linkedProductId:product===null?null:endpointId(product),expectedVersion:expectedVersion(version)});},
    async experimentPriority(id,priority,version){if(typeof priority!=='boolean')throw new ContractError();return mutations.send('/api/lab/experiments/'+endpointId(id)+'/priority','PATCH',{priority,expectedVersion:expectedVersion(version)});},
    async linkMemberLogin(id,login,version){return mutations.send('/api/admin/members/'+endpointId(id),'PATCH',{loginAccountId:endpointId(login),expectedVersion:expectedVersion(version)});},
    async accountLifecycle(id,value,version){const path=id?'/api/admin/accounts/'+endpointId(id)+'/password-reset':'/api/admin/accounts';return mutations.send(path,'POST',accountLifecyclePayload(value,version));},
    async accountOperation(key,action,id){const path=id?'/api/admin/accounts/'+endpointId(id)+'/password-reset':'/api/admin/accounts';try{const result=accountLifecycleResult(await get('/api/admin/account-operations/'+endpointId(key)),action,id);mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async inventoryAccess(id,signal){return read('/api/admin/accounts/'+endpointId(id)+'/inventory-access',signal,v=>inventoryAccessState(v,id));},
    async myInventoryAccess(signal){return read('/api/inventory-access',signal,inventoryAccessMine);},
    async inventoryAccessHistory(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ContractError();return read('/api/admin/accounts/'+endpointId(id)+'/inventory-access/history?offset='+offset,signal,v=>inventoryAccessHistory(v,id));},
    async saveInventoryAccess(id,value,version){return mutations.send('/api/admin/accounts/'+endpointId(id)+'/inventory-access','POST',inventoryAccessPayload(value,version));},
    async inventoryAccessReceipt(id,key){const path='/api/admin/accounts/'+endpointId(id)+'/inventory-access';try{const result=inventoryAccessResult(await get(path+'/receipts/'+endpointId(key)),id);mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async updateAccountPermissions(id,value,version){return mutations.send('/api/admin/accounts/'+endpointId(id)+'/permissions','PATCH',permissionPayload(value,version));},
    async updateAccountAccess(id,value,version){return mutations.send('/api/admin/accounts/'+endpointId(id),'PATCH',accountAccessPayload(value,version));},
    async accountAccessHistory(id,signal){return read('/api/admin/accounts/'+endpointId(id)+'/history',signal,v=>{if(!Array.isArray(v)||v.some(e=>!record(e)||typeof e.actor!=='string'||!record(e.beforeValue)||!record(e.afterValue)||!Number.isFinite(Date.parse(e.createdAt))))throw new ContractError();return v;});},
    async saveDirectory(kind,id,value,version){const route={member:'members',account:'business-accounts',store:'stores'}[kind];if(!route)throw new ContractError();return mutations.send('/api/admin/'+route+(id?'/'+endpointId(id):''),id?'PATCH':'POST',directoryPayload(kind,value,version));},
    async saveExpense(id,value,version){return mutations.send('/api/finance/expenses'+(id?'/'+endpointId(id):''),id?'PATCH':'POST',expensePayload(value,version));},
    async createSettlement(value){return mutations.send('/api/finance/settlements','POST',settlementPayload(value));},
    async recordPayment(value,version){return mutations.send('/api/finance/payments','POST',paymentPayload(value,version));},
    async updateExpenseCategory(id,name,active,version){if(typeof name!=='string'||!name.trim()||name.length>100||typeof active!=='boolean')throw new ContractError('请核对分类名称与使用状态。');return mutations.send('/api/finance/categories/'+endpointId(id),'PATCH',{name:name.trim(),active,expectedVersion:expectedVersion(version)});},
    async createExpenseCategory(name){if(typeof name!=='string'||!name.trim()||name.length>100)throw new ContractError('分类名称最多 100 字。');return mutations.send('/api/finance/categories','POST',{name:name.trim()});},
    async createExperiment(value){const payload=experimentDraftPayload(value);await labCapability();return mutations.send('/api/lab/experiments','POST',payload);},
    async dispatchRound(id,round,value,version){const payload=dispatchPayload(value,version),path='/api/lab/experiments/'+endpointId(id)+'/rounds/'+endpointId(round)+'/assignments';await labCapability();return mutations.send(path,'POST',payload);},
    async dispatchReceipt(id,round,key){const path='/api/lab/experiments/'+endpointId(id)+'/rounds/'+endpointId(round)+'/assignments';try{const value=await get(path+'/'+endpointId(key));if(!record(value)||!Array.isArray(value.taskIds)||value.taskIds.some(id=>typeof id!=='string')||!Number.isSafeInteger(value.version))throw new ContractError();mutations.confirmRead(path);return value;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async reviewRound(id,round,value,version){return mutations.send('/api/lab/experiments/'+endpointId(id)+'/rounds/'+endpointId(round)+'/reviews','POST',reviewPayload(value,version));},
    async concludeExperiment(id,value,version){return mutations.send('/api/lab/experiments/'+endpointId(id)+'/conclusion','POST',conclusionPayload(value,version));},
    async capabilities(signal){const value=await get('/api/workbench/capabilities',signal);if(!record(value)||value.personalTodoSchedule!==1)throw new ContractError('工作台日期兼容尚未接入。');return value;},
    async createTodo(value){if(!allowWrites)throw new ApiError(405,'当前为只读预览，未发送保存请求。');const body=todoPayload(value);await this.capabilities();return mutations.send('/api/workbench/todos','POST',body);},
    async updateTodo(id,value,version){if(!allowWrites)throw new ApiError(405,'当前为只读预览，未发送保存请求。');const path='/api/workbench/todos/'+endpointId(id),body=todoPayload(value,version);await this.capabilities();return mutations.send(path,'PATCH',body);},
    async dailyAttendance(signal){const v=await read('/api/attendance/daily',signal,dailyAttendanceState);mutations.confirmRead('/api/attendance/end-work');return v;},
    async endWork(key,id,version){const v=await mutations.send('/api/attendance/end-work','POST',endWorkPayload(key,id,version));try{endWorkResult(v,id);}catch(e){e.uncertain=true;throw e;}mutations.clear();return v;},
    async logout(){const result=await mutations.send('/api/logout','POST',{});mutations.clear();return result;},
    async login(username,password){const d=await mutations.send('/api/login','POST',{username,password},{login:true});return identity(d.user);},
    async createMaterial(value){return mutations.send('/api/materials','POST',materialPayload(value));},
    async updateMaterial(id,value,version){return mutations.send('/api/materials/'+endpointId(id),'PATCH',materialPayload(value,version));},
    async createProduct(value){return mutations.send('/api/products','POST',productPayload(value));},
    async updateProduct(id,value,version){return mutations.send('/api/products/'+endpointId(id),'PATCH',productPayload(value,version));},
    async publish(id,value){return mutations.send('/api/tasks/'+endpointId(id)+'/publications','POST',publicationPayload(value));},
    async recordSnapshot(id,publicationId,value){return mutations.send('/api/tasks/'+endpointId(id)+'/publications/'+endpointId(publicationId)+'/snapshots','POST',snapshotPayload(value));},
    async session(signal){const d=await get('/api/session',signal);const user=identity(d.user);mutations.acceptSession(d);return user;},
    async navigation(signal){const d=list(await get('/api/navigation',signal));if(!d.every(v=>record(v)&&string(v.id)&&string(v.title)))throw new ContractError();return d;},
    async profile(signal){const d=await get('/api/workbench/profile',signal);if(d.profile===null)return null;if(!record(d.profile)||!string(d.profile.id))throw new ContractError();return d.profile;},
    async materials(signal){return read('/api/materials',signal,v=>list(v).map(materialModel));},
    async material(id,signal){return read('/api/materials/'+endpointId(id),signal,materialModel);},
    async experiments(signal){return read('/api/lab/experiments',signal,v=>list(v).map(experimentModel));},
    async experiment(id,signal){return read('/api/lab/experiments/'+endpointId(id),signal,experimentModel);},
    async tasks(profile,user,signal){if(!profile)return [];return ownTasks(await get('/api/tasks',signal),profile,user.role);},
    async task(id,signal){return read('/api/tasks/'+endpointId(id),signal,taskModel);},
    async todos(signal){return read('/api/workbench/todos',signal,v=>list(v).map(todoModel));},
    async finance(signal){return read('/api/finance',signal,financeRecord);},
    async competitors(signal){return namedList(await get('/api/competitors',signal));},
    async productOpening(id,signal){return read('/api/product-opening-costs/'+endpointId(id),signal,v=>openingState(v,id));},
    async productOpeningHistory(id,offset=0,signal){return read('/api/product-opening-costs/'+endpointId(id)+'/history?offset='+offset,signal,openingHistory);},
    async saveProductOpening(id,value){return mutations.send('/api/product-opening-costs/'+endpointId(id),'POST',openingPayload(value));},
    async productOpeningReceipt(id,key){const path='/api/product-opening-costs/'+endpointId(id);try{const result=await get(path+'/receipts/'+endpointId(key));if(result?.id!==id||!Number.isSafeInteger(result.version)||result.version<1)throw new ContractError();endpointId(result.recordId);mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async productCostCatalog(offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ContractError();return read('/api/product-costs?offset='+offset,signal,costCatalog);},
    async productCostReview(id,month,signal){costMonth(month);return read('/api/product-costs/'+endpointId(id)+'?month='+month,signal,v=>costReview(v,id,month));},
    async productPurchase(id,signal){return read('/api/product-purchases/'+endpointId(id),signal,v=>productPurchaseState(v,id));},
    async productPurchaseHistory(id,offset=0,signal){return read('/api/product-purchases/'+endpointId(id)+'/history?offset='+offset,signal,productPurchaseHistory);},
    async saveProductPurchase(id,value){return mutations.send('/api/product-purchases/'+endpointId(id),'POST',productPurchasePayload(value));},
    async productPurchaseReceipt(id,key){
      const path='/api/product-purchases/'+endpointId(id);
      try{const result=await get(path+'/receipts/'+endpointId(key));if(result?.id!==id||!Number.isSafeInteger(result.version))throw new ContractError();endpointId(result.batchId);endpointId(result.recordId);mutations.confirmRead(path);return result;}
      catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}
    },
    async productStockOptions(offset=0,signal){return read('/api/product-stock-documents/options?offset='+offset,signal,productStockOptions);},
    async saveProductStockDocument(value){return mutations.send('/api/product-stock-documents','POST',productStockPayload(value));},
    async productStockDocument(id,signal){return read('/api/product-stock-documents/'+endpointId(id),signal,v=>productStockDetail(v,id));},
    async saveProductStockReturn(id,value){return mutations.send('/api/product-stock-documents/'+endpointId(id)+'/returns','POST',productReturnPayload(value));},
    async productStockReceipt(key,shipmentId=null){
      const path='/api/product-stock-documents'+(shipmentId?'/'+endpointId(shipmentId)+'/returns':'');
      try{const result=await get('/api/product-stock-documents/receipts/'+endpointId(key));endpointId(result?.id);mutations.confirmRead(path);return result;}
      catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}
    },
    async commercialProduct(id,signal){return read('/api/commercial-products/'+endpointId(id),signal,v=>commercialState(v,id));},
    async commercialProductHistory(id,offset=0,signal){return read('/api/commercial-products/'+endpointId(id)+'/history?offset='+offset,signal,v=>commercialHistory(v,id));},
    async saveCommercialProduct(id,action,value,version){return mutations.send('/api/commercial-products/'+endpointId(id)+'/'+action,'POST',commercialPayload(action,value,version));},
    async commercialProductReceipt(id,key,action){
      const path='/api/commercial-products/'+endpointId(id)+'/'+action;
      try{const result=await get('/api/commercial-products/'+endpointId(id)+'/receipts/'+endpointId(key));if(result?.id!==id||!Number.isSafeInteger(result.version))throw new ContractError();mutations.confirmRead(path);return result;}
      catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}
    },
    async warehouseReorderAlerts(offset=0,signal){return read('/api/warehouse/reorder-alerts?offset='+offset,signal,reorderAlerts);},
    async saveWarehouseReorderThreshold(id,balance,value,version){
      return mutations.send(warehousePath('reorder-threshold',id,balance),'POST',reorderThresholdPayload(value,version));
    },
    async packagingTransferDetail(id,transfer,signal,kind='packaging'){
      return read(warehousePath(kind==='product'?'transfer-product':'transfer-packaging',id)+'/'+endpointId(transfer),signal,v=>packagingTransferDetail(v,id,transfer));
    },
    async savePackagingTransfer(id,value,kind='packaging'){return mutations.send(warehousePath(kind==='product'?'transfer-product':'transfer-packaging',id),'POST',packagingTransferPayload(value));},
    async consumptionOptions(offset=0,signal){return read('/api/packaging-consumptions/options?offset='+offset,signal,consumptionOptions);},
    async consumptionDetail(id,signal){return read('/api/packaging-consumptions/'+endpointId(id),signal,v=>consumptionDetail(v,id));},
    async saveConsumption(value){return mutations.send('/api/packaging-consumptions','POST',consumptionPayload(value));},
    async consumptionReceipt(key){
      const path='/api/packaging-consumptions';
      try{const result=await get(path+'/receipts/'+endpointId(key));endpointId(result?.id);mutations.confirmRead(path);return result;}
      catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}
    },
    async packagingPurchaseHistory(id,offset=0,signal){return read('/api/warehouse/items/'+endpointId(id)+'/packaging-purchases?offset='+offset,signal,packagingPurchaseHistory);},
    async savePackagingPurchase(id,value,version){return mutations.send('/api/warehouse/items/'+endpointId(id)+'/packaging-purchases','POST',packagingPurchasePayload(value,version));},
    async packagingPurchaseReceipt(id,key){
      const path='/api/warehouse/items/'+endpointId(id)+'/packaging-purchases';
      try{const result=await get(path+'/receipts/'+endpointId(key));if(result?.id!==id)throw new ContractError();endpointId(result.purchaseId);mutations.confirmRead(path);return result;}
      catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}
    },
    async scopedWarehouseCatalog(params={},signal,kind='packaging'){const q=new URLSearchParams({q:params.q??'',offset:String(params.offset??0)});return read((kind==='product'?'/api/product-stock?':'/api/packaging-stock?')+q,signal,scopedWarehouseCatalog);},
    async scopedWarehouseDetail(id,offset=0,signal,kind='packaging'){return read((kind==='product'?'/api/product-stock/':'/api/packaging-stock/')+endpointId(id)+'?offset='+offset,signal,v=>scopedWarehouseDetail(v,id));},
    async scopedWarehouseMove(id,value,version){return mutations.send('/api/packaging-stock/'+endpointId(id),'POST',scopedWarehousePayload(value,version));},
    async scopedWarehouseReceipt(id,key){
      const path='/api/packaging-stock/'+endpointId(id);
      try{const result=await get(path+'/receipts/'+endpointId(key));if(result?.id!==id)throw new ContractError();endpointId(result.movementId);mutations.confirmRead(path);return result;}
      catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}
    },
    async warehouseCatalog(params={},signal){const q=new URLSearchParams({q:params.q??'',kind:params.kind??'all',active:params.active??'active',offset:String(params.offset??0)});if(params.reorder)q.set('reorder','low');return read('/api/warehouse/items?'+q,signal,warehouseCatalog);},
    async warehouseItem(id,signal){return read('/api/warehouse/items/'+endpointId(id),signal,warehouseItem);},
    async warehouseHistory(id,offset=0,events=false,signal){return read('/api/warehouse/items/'+endpointId(id)+'/'+(events?'events':'movements')+'?offset='+String(offset),signal,v=>warehouseHistory(v,events));},
    async warehouseMovement(id,movement,signal){return read('/api/warehouse/items/'+endpointId(id)+'/movements/'+endpointId(movement),signal,warehouseMovement);},
    async warehouseSampleTargets(id,params={},signal){const q=new URLSearchParams({q:params.q??'',offset:String(params.offset??0)});return read('/api/warehouse/items/'+endpointId(id)+'/sample-targets?'+q,signal,sampleTargetPage);},
    async warehouseToSamples(id,value,version){return mutations.send(warehousePath('transfer',id),'POST',sampleTransferPayload(value,version));},
    async warehouseTransfers(id,offset=0,bySample=false,signal){const path=bySample?'/api/samples/catalog/'+endpointId(id)+'/transfers':'/api/warehouse/items/'+endpointId(id)+'/transfers';return read(path+'?offset='+String(offset),signal,sampleTransferPage);},
    async warehouseWrite(action,id,value,version){return mutations.send(warehousePath(action,id),action==='edit'?'PATCH':'POST',warehousePayload(action,value,version));},
    async warehouseReceipt(key,action,id,balance){const path=warehousePath(action,id,balance);try{const result=await get('/api/warehouse/receipts/'+endpointId(key));if(!record(result)||typeof result.id!=='string')throw new ContractError();endpointId(result.id);if(result.movementId!==undefined)endpointId(result.movementId);if(['transfer-packaging','transfer-product'].includes(action))endpointId(result.packagingTransferId);if(action==='transfer'){for(const key of ['movementId','transferId','sampleId','sampleEventId'])endpointId(result[key]);}mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async cardFinanceState(id,signal){return financeState(await get('/api/phone-card-finance/'+endpointId(id),signal),id);},
    async cardRecharges(id,params={},signal){const q=new URLSearchParams({offset:String(params.offset||0),status:params.status||'all'});for(const k of ['q','from','to','storeId'])if(params[k])q.set(k,params[k]);return rechargePage(await get('/api/phone-card-finance/'+endpointId(id)+'/recharges?'+q,signal),id);},
    async cardRecharge(id,root,signal){return rechargeRecord(await get('/api/phone-card-finance/'+endpointId(id)+'/recharges/'+endpointId(root),signal),id,root);},
    async cardRechargeHistory(id,root,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0)throw new ContractError();return rechargeHistory(await get('/api/phone-card-finance/'+endpointId(id)+'/recharges/'+endpointId(root)+'/history?offset='+offset,signal),id,root);},
    async cardBalances(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0)throw new ContractError();return balancePage(await get('/api/phone-card-finance/'+endpointId(id)+'/balances?offset='+offset,signal),id);},
    async cardReminderState(id,signal){return reminderState(await get('/api/phone-card-reminders/'+endpointId(id),signal),id);},
    async cardReminderHistory(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0)throw new ContractError();return reminderHistory(await get('/api/phone-card-reminders/'+endpointId(id)+'/history?offset='+offset,signal),id);},
    async cardReminders(params={},signal){const q=new URLSearchParams({offset:String(params.offset||0)});if(params.until)q.set('until',params.until);return reminderPage(await get('/api/phone-card-reminders?'+q,signal));},
    async saveCardRecharge(id,value,root){return mutations.send(operationPath(root?'correct':'recharge',id,root),'POST',rechargePayload(value,!!root));},
    async voidCardRecharge(id,root,value){return mutations.send(operationPath('void',id,root),'POST',voidPayload(value));},
    async saveCardBalance(id,value){return mutations.send(operationPath('balance',id),'POST',balancePayload(value));},
    async saveCardReminder(id,value){return mutations.send(operationPath('reminder',id),'POST',reminderPayload(value));},
    async cardOperationReceipt(kind,id,key,root){const path=operationPath(kind,id,root),action=operationAction(kind,id,root);try{const result=operationResult(await get('/api/phone-card-operations/receipts/'+endpointId(key)),id,action,root);mutations.confirmRead(path,{exact:true});return result;}catch(e){if(e.status===404){mutations.confirmRead(path,{exact:true});return null;}throw e;}},
    async phoneCards(params={},signal){const q=new URLSearchParams({q:params.q||'',status:params.status||'current',offset:String(params.offset||0)});for(const k of ['deviceId','accountId','storeId'])if(params[k])q.set(k,endpointId(params[k]));return phoneCardPage(await get('/api/phone-cards?'+q,signal));},
    async phoneCard(id,signal){return phoneCard(await get('/api/phone-cards/'+endpointId(id),signal),id);},
    async phoneCardOptions(signal){return phoneCardOptions(await get('/api/phone-cards/options',signal));},
    async phoneCardHistory(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ContractError();return phoneCardHistory(await get('/api/phone-cards/'+endpointId(id)+'/history?offset='+offset,signal),id);},
    async phoneCardIdentity(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ContractError();return phoneCardIdentity(await get('/api/phone-cards/'+endpointId(id)+'/identity?offset='+offset,signal),id);},
    async savePhoneCard(id,value,version){return mutations.send('/api/phone-cards'+(id?'/'+endpointId(id):''),id?'PATCH':'POST',phoneCardPayload(value,version));},
    async savePhoneCardIdentity(id,value){return mutations.send('/api/phone-cards/'+endpointId(id)+'/identity','POST',phoneCardIdentityPayload(value));},
    async phoneCardReceipt(key,owner,scope='profile'){if(!['profile','identity'].includes(scope)||scope==='identity'&&!owner)throw new ContractError();const action=scope==='identity'?'identity:'+endpointId(owner):'save:'+(owner?endpointId(owner):'new'),path='/api/phone-cards'+(owner?'/'+endpointId(owner):'')+(scope==='identity'?'/identity':'');try{const result=phoneCardResult(await get('/api/phone-cards/receipts/'+endpointId(key)),owner,action);mutations.confirmRead(path,{exact:true});return result;}catch(e){if(e.status===404){mutations.confirmRead(path,{exact:true});return null;}throw e;}},
    async equipmentCatalog(params={},signal){const q=new URLSearchParams({q:params.q??'',offset:String(params.offset??0),all:String(params.all===true)});if(params.assetStatus&&params.assetStatus!=='all')q.set('assetStatus',params.assetStatus);return read('/api/equipment/catalog?'+q,signal,equipmentPage);},
    async equipmentDetail(id,signal){return read('/api/equipment/catalog/'+endpointId(id),signal,v=>{equipmentRecord(v);if(typeof v.notes!=='string')throw new ContractError('设备说明不完整，请重新读取。');return v;});},
    async equipmentLoan(id,signal){return read('/api/equipment/loans/'+endpointId(id),signal,v=>equipmentPage({rows:[v],total:1,offset:0,limit:50},true).rows[0]);},
    async equipmentLoans(params={},signal){const q=new URLSearchParams({view:params.team?'team':'own',status:params.status??'open',offset:String(params.offset??0)});return read('/api/equipment/loans?'+q,signal,v=>equipmentPage(v,true));},
    async equipmentPurchase(id,signal){return read('/api/equipment/catalog/'+endpointId(id)+'/purchase',signal,v=>equipmentPurchaseState(v,id));},
    async equipmentPurchaseHistory(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ContractError();return read('/api/equipment/catalog/'+endpointId(id)+'/purchase/history?offset='+offset,signal,v=>equipmentPurchaseHistory(v,id));},
    async saveEquipmentPurchase(id,value){return mutations.send('/api/equipment/catalog/'+endpointId(id)+'/purchase','POST',equipmentPurchasePayload(value));},
    async equipmentPurchaseReceipt(id,key){const path='/api/equipment/catalog/'+endpointId(id)+'/purchase';try{const result=equipmentPurchaseResult(await get(path+'/receipts/'+endpointId(key)),id);mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async equipmentHandoverState(id,signal){return read('/api/equipment/catalog/'+endpointId(id)+'/handover',signal,v=>handoverState(v,id));},
    async equipmentHandover(id,value){return mutations.send('/api/equipment/catalog/'+endpointId(id)+'/handover','POST',handoverPayload(value));},
    async equipmentHandovers(id,offset=0,signal){if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ContractError();return read('/api/equipment/catalog/'+endpointId(id)+'/handovers?offset='+offset,signal,handoverPage);},
    async uploadEquipmentImage(id,file,version,key){const f=mediaUpload(file,{imagesOnly:true});return mutations.send('/api/equipment/catalog/'+endpointId(id)+'/image','POST',f.file,{binary:true,headers:{'Content-Type':f.mime,'x-file-name':encodeURIComponent(f.name),'x-expected-version':String(expectedVersion(version)),'x-request-key':endpointId(key)}});},
    async removeEquipmentImage(id,value){if(!record(value)||Object.keys(value).some(k=>!['requestKey','expectedVersion'].includes(k)))throw new ContractError();return mutations.send('/api/equipment/catalog/'+endpointId(id)+'/image','DELETE',{requestKey:endpointId(value.requestKey),expectedVersion:expectedVersion(value.expectedVersion)});},
    async equipmentHistory(id,offset=0,signal){return read('/api/equipment/catalog/'+endpointId(id)+'/history?offset='+String(offset),signal,v=>{pagedRows(v);if(v.rows.some(e=>!record(e)||typeof e.action!=='string'||typeof e.actor!=='string'||typeof e.note!=='string'||!Number.isFinite(Date.parse(e.createdAt))))throw new ContractError();return v;});},
    async equipmentWrite(action,id,value,version){return mutations.send(equipmentPath(action,id),['edit','relocate'].includes(action)?'PATCH':'POST',equipmentPayload(action,value,version));},
    async equipmentReceipt(key,action,id){const path=equipmentPath(action,id);try{const value=await get('/api/equipment/receipts/'+endpointId(key));if(!record(value)||typeof value.id!=='string')throw new ContractError();endpointId(value.id);mutations.confirmRead(path);return value;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async sampleState(signal){return read('/api/samples/state',signal,sampleState);},
    async sampleCatalog(params={},signal){const q=new URLSearchParams({offset:String(params.offset??0),q:params.q??'',active:params.all?'all':'active'});return read('/api/samples/catalog?'+q,signal,v=>samplePage(v));},
    async sampleLoans(params={},signal){const q=new URLSearchParams({offset:String(params.offset??0),view:params.team?'team':'own',status:params.status??'open'});return read('/api/samples/loans?'+q,signal,v=>samplePage(v,true));},
    async sampleWrite(action,owner,value,version){return mutations.send(sampleOperationPath(action,owner),action==='relocate'?'PATCH':'POST',samplePayload(action,value,version));},
    async sampleReceipt(key,action,owner){const path=sampleOperationPath(action,owner);try{const result=await get('/api/samples/receipts/'+endpointId(key));if(!record(result)||typeof result.id!=='string')throw new ContractError();endpointId(result.id);mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async samples(params={},signal){const q=new URLSearchParams({offset:String(params.offset??0),q:params.q??'',active:'all'});return pagedRows(await get('/api/samples/catalog?'+q,signal));},
    async employmentSave(id,value){return mutations.send('/api/admin/members/'+endpointId(id)+'/employment','POST',employmentPayload(value));},
    async employmentHistory(id,offset=0,signal){return read('/api/admin/members/'+endpointId(id)+'/history?offset='+String(offset),signal,personnelHistory);},
    async employmentReceipt(key,id){try{const r=await get('/api/admin/employment-receipts/'+endpointId(key));if(r?.id!==id)throw new ContractError();mutations.confirmRead('/api/admin/members/'+id+'/employment');return r;}catch(e){if(e.status===404){mutations.confirmRead('/api/admin/members/'+id+'/employment');return null;}throw e;}},
    async adminPayrollReviewSave(value){return mutations.send('/api/payroll/admin-reviews','POST',adminReviewPayload(value));},
    async adminPayrollReviewHistory(month,memberId,offset=0,signal){const q=new URLSearchParams({month:validMonth(month),memberId:endpointId(memberId),offset:String(offset)});return read('/api/payroll/admin-reviews?'+q,signal,adminReviewHistory);},
    async adminPayrollReviewReceipt(key){try{const r=await get('/api/payroll/admin-review-receipts/'+endpointId(key));endpointId(r?.id);mutations.confirmRead('/api/payroll/admin-reviews');return r;}catch(e){if(e.status===404){mutations.confirmRead('/api/payroll/admin-reviews');return null;}throw e;}},
    async payrollConfirmationSave(value){return mutations.send('/api/payroll/confirmations','POST',confirmationPayload(value));},
    async payrollConfirmationDetail(id,signal){return read('/api/payroll/confirmations/'+endpointId(id),signal,confirmationDetail);},
    async payrollConfirmationHistory(month,memberId,offset=0,signal){const q=new URLSearchParams({month:validMonth(month),memberId:endpointId(memberId),offset:String(offset)});return read('/api/payroll/confirmations?'+q,signal,confirmationHistory);},
    async payrollConfirmationReceipt(key){try{const r=await get('/api/payroll/confirmation-receipts/'+endpointId(key));endpointId(r?.id);if(!Number.isSafeInteger(r.revision)||r.revision<1)throw new ContractError();mutations.confirmRead('/api/payroll/confirmations');return r;}catch(e){if(e.status===404){mutations.confirmRead('/api/payroll/confirmations');return null;}throw e;}},
    async payrollExportable(month,signal){return read('/api/payroll/exportable?month='+validMonth(month),signal,exportable);},
    async payrollExportHistory(month,offset=0,signal){const q=new URLSearchParams({month:validMonth(month),offset:String(offset)});return read('/api/payroll/exports?'+q,signal,v=>{pagedRows(v);for(const r of v.rows){endpointId(r.id);if(!Array.isArray(r.names)||r.names.some(n=>typeof n!=='string'))throw new ContractError();}return v;});},
    async payrollExport(value){return mutations.send('/api/payroll/exports','POST',exportPayload(value),{responseType:'workbook'});},
    async payrollExportReceipt(key){try{const r=await get('/api/payroll/export-receipts/'+endpointId(key));endpointId(r?.id);validMonth(r.month);mutations.confirmRead('/api/payroll/exports');return r;}catch(e){if(e.status===404){mutations.confirmRead('/api/payroll/exports');return null;}throw e;}},
    async payrollExportFile(id,signal){if(!allowWrites)throw new ApiError(405,'只读预览不提供私人导出文件。');return readWorkbook(await fetcher('/api/payroll/exports/'+endpointId(id),{credentials:'same-origin',cache:'no-store',redirect:'error',signal}));},
    async payrollState(month,memberId,signal){const q=new URLSearchParams({month:validMonth(month)});if(memberId)q.set('memberId',endpointId(memberId));return read('/api/payroll/state?'+q,signal,payrollState);},
    async payrollHistory(month,memberId,offset=0,salaries=false,signal){const q=new URLSearchParams({memberId:endpointId(memberId),offset:String(offset)});if(!salaries)q.set('month',validMonth(month));return read('/api/payroll/'+(salaries?'salaries':'drafts')+'?'+q,signal,v=>payrollHistory(v,salaries));},
    async payrollSave(value,salaries=false){return mutations.send('/api/payroll/'+(salaries?'salaries':'drafts'),'POST',payrollPayload(value,salaries));},
    async payrollReceipt(key){try{const r=await get('/api/payroll/receipts/'+endpointId(key));endpointId(r?.id);if(!Number.isSafeInteger(r.revision)||r.revision<1)throw new ContractError();mutations.confirmRead('/api/payroll');return r;}catch(e){if(e.status===404){mutations.confirmRead('/api/payroll');return null;}throw e;}},
    async closureState(month,memberId,signal){const q=new URLSearchParams({month:validMonth(month)});if(memberId)q.set('memberId',endpointId(memberId));return read('/api/attendance/month-closures?'+q,signal,closureState);},
    async closureDetail(id,signal){return read('/api/attendance/month-closures/'+endpointId(id),signal,closureDetail);},
    async closureHistory(month,memberId,offset=0,signal){const q=new URLSearchParams({month:validMonth(month),memberId:endpointId(memberId),offset:String(offset)});return read('/api/attendance/month-closures/history?'+q,signal,closureHistory);},
    async closureSave(value){return mutations.send('/api/attendance/month-closures','POST',closurePayload(value));},
    async closureReceipt(key){try{const r=await get('/api/attendance/month-closure-receipts/'+endpointId(key));endpointId(r?.id);if(!Number.isSafeInteger(r.revision)||r.revision<1)throw new ContractError();mutations.confirmRead('/api/attendance/month-closures');return r;}catch(e){if(e.status===404){mutations.confirmRead('/api/attendance/month-closures');return null;}throw e;}},
    async monthlyAttendance(month,memberId,signal){const q=new URLSearchParams({month:validMonth(month)});if(memberId)q.set('memberId',endpointId(memberId));return read('/api/attendance/monthly?'+q,signal,monthlyResult);},
    async attendanceCalendar(month,signal){return read('/api/attendance/calendar?month='+validMonth(month),signal,calendarMonth);},
    async calendarHistory(date,offset=0,signal){if(!validDate(date))throw new ContractError();return read('/api/attendance/calendar/'+date+'/history?offset='+String(offset),signal,calendarHistory);},
    async calendarSave(date,value){if(!validDate(date))throw new ContractError();return mutations.send('/api/attendance/calendar/'+date,'POST',calendarPayload(value));},
    async calendarReceipt(key,date){const path='/api/attendance/calendar/'+date;try{const r=await get('/api/attendance/calendar-receipts/'+endpointId(key));if(r?.date!==date||!Number.isSafeInteger(r.version)||r.version<1)throw new ContractError();mutations.confirmRead(path);return r;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async exceptionList(params={},signal){const q=new URLSearchParams({view:params.view??'own',status:params.status??'pending',kind:params.kind??'all',offset:String(params.offset??0)});for(const k of ['from','to'])if(params[k]){if(!validDate(params[k]))throw new ContractError();q.set(k,params[k]);}if(params.from&&params.to&&params.from>params.to)throw new ContractError('开始日期不能晚于结束日期。');return read('/api/attendance/exceptions?'+q,signal,exceptionPage);},
    async exceptionDetail(id,signal){return read('/api/attendance/periods/'+endpointId(id)+'/exceptions',signal,exceptionDetail);},
    async exceptionHistory(id,offset=0,signal){return read('/api/attendance/periods/'+endpointId(id)+'/exceptions/history?offset='+String(offset),signal,exceptionHistory);},
    async exceptionReview(id,value){return mutations.send('/api/attendance/periods/'+endpointId(id)+'/exceptions','POST',exceptionPayload(value));},
    async exceptionReceipt(key,id){const path='/api/attendance/periods/'+endpointId(id)+'/exceptions';try{const result=await get('/api/attendance/exception-receipts/'+endpointId(key));if(result?.id!==id)throw new ContractError();endpointId(result.reviewId);mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async leaveList(params={},signal){const q=new URLSearchParams({view:params.view??'own',status:params.status??'all',offset:String(params.offset??0)});for(const k of ['from','to'])if(params[k]){if(!validDate(params[k]))throw new ContractError();q.set(k,params[k]);}if(params.from&&params.to&&params.from>params.to)throw new ContractError('开始日期不能晚于结束日期。');return read('/api/attendance/leaves?'+q,signal,leavePage);},
    async leaveDetail(id,signal){return read('/api/attendance/leaves/'+endpointId(id),signal,leaveRecord);},
    async leaveHistory(id,offset=0,signal){return read('/api/attendance/leaves/'+endpointId(id)+'/history?offset='+String(offset),signal,leaveHistory);},
    async leaveWrite(action,id,value,version){return mutations.send(leavePath(action,id),action==='edit'?'PATCH':'POST',leavePayload(action,value,version));},
    async leaveReceipt(key,action,id){const path=leavePath(action,id);try{const result=await get('/api/attendance/leave-receipts/'+endpointId(key));endpointId(result?.id);if(id&&result.id!==id)throw new ContractError();mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async attendanceCorrections(params={},signal){const q=new URLSearchParams({view:params.view??'own',status:params.status??'all',offset:String(params.offset??0)});for(const k of ['from','to'])if(params[k]){if(!validDate(params[k]))throw new ContractError();q.set(k,params[k]);}if(params.from&&params.to&&params.from>params.to)throw new ContractError('开始日期不能晚于结束日期。');if(params.periodId)q.set('periodId',endpointId(params.periodId));return read('/api/attendance/corrections?'+q,signal,v=>attendancePage(v,true));},
    async attendanceDetail(id,correction=false,signal){return read('/api/attendance/'+(correction?'corrections/':'periods/')+endpointId(id),signal,v=>attendanceDetail(v,correction));},
    async attendanceHistory(id,correction=false,offset=0,signal){return read('/api/attendance/'+(correction?'corrections/':'periods/')+endpointId(id)+'/history?offset='+String(offset),signal,attendanceHistory);},
    async attendanceWrite(action,id,value,version){return mutations.send(attendanceWritePath(action,id),action==='edit'?'PATCH':'POST',attendancePayload(action,value,version));},
    async attendanceReceipt(key,action,id){const path=attendanceWritePath(action,id);try{const result=await get('/api/attendance/receipts/'+endpointId(key));endpointId(result?.id);if(id&&result.id!==id)throw new ContractError();mutations.confirmRead(path);return result;}catch(e){if(e.status===404){mutations.confirmRead(path);return null;}throw e;}},
    async attendance(params={},signal){const q=new URLSearchParams({view:params.view??'own',offset:String(params.offset??0)});for(const key of ['from','to']){if(params[key]){if(!validDate(params[key]))throw new ContractError('日期格式无效。');q.set(key,params[key]);}}if(params.from&&params.to&&params.from>params.to)throw new ContractError('开始日期不能晚于结束日期。');return attendancePage(await get('/api/attendance/periods?'+q,signal));},
    async loginAccounts(signal){return read('/api/admin/accounts',signal,value=>{const rows=list(value);if(rows.some(r=>!record(r)||!string(r.id)||!string(r.username)||!['admin','employee'].includes(r.role)||typeof r.active!=='boolean'))throw new ContractError();return rows;});},
    async templates(signal){return list(await get('/api/templates',signal)).map(v=>templateRecord(v));},
    async template(id,signal){return templateRecord(await get('/api/templates/'+endpointId(id),signal),true);},
    async titleCatalog(params={},signal){const q=new URLSearchParams({page:String(params.page??1),q:params.q??''});return titleCatalog(await get('/api/titles/catalog?'+q,signal));},
    async titleBatch(id,signal){return titleBatch(await get('/api/titles/'+endpointId(id),signal));},
    async tools(signal){return namedList(await get('/api/toolbox',signal));},
    async knowledge(signal){return read('/api/knowledge',signal,knowledgeList);},
    async createKnowledgeNavigation(value){return mutations.send('/api/knowledge/navigation','POST',knowledgeNavigationPayload(value));},
    async updateKnowledgeNavigation(id,value,version){return mutations.send('/api/knowledge/'+endpointId(id)+'/navigation','PATCH',knowledgeNavigationPayload(value,version));},
    async members(signal){return read('/api/admin/members',signal,v=>namedList(v,'displayName'));},
    async businessAccountHistory(id,signal){return read('/api/admin/business-accounts/'+endpointId(id)+'/history',signal,v=>{if(!Array.isArray(v)||v.some(e=>!e?.afterValue||typeof e.createdAt!=='string'))throw new ContractError('账号变更记录不完整。');return v;});},
    async businessAccounts(signal){return read('/api/admin/business-accounts',signal,namedList);},
    async stores(signal){return read('/api/admin/stores',signal,namedList);},
    async workTasks(signal){return executionRows(await get('/api/tasks',signal));},
    async products(signal){return read('/api/products',signal,v=>list(v).map(p=>productRecord(p)));},
    async product(id,signal){return read('/api/products/'+endpointId(id),signal,v=>productRecord(v,true));},
    async shooting(signal){return read('/api/shooting/requests',signal,v=>list(v).map(shootingRecord));},
    async shootingDetail(id,signal){return read('/api/shooting/requests/'+endpointId(id),signal,shootingRecord);},
    async completed(date,user,profile,signal){
      if(!validDate(date))throw new ContractError('请填写有效日期。');
      if(!profile)return [];
      const q=new URLSearchParams({date,source:'all'});if(user.role==='admin')q.set('member',endpointId(profile.id));
      const d=await get('/api/workbench/completed?'+q,signal);if(d.date!==date)throw new ContractError();
      return list(d.rows);
    },
  };
}
