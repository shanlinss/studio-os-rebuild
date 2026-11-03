import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {confirmationPayload,exportPayload,readWorkbook,workbookMime} from '../dist/payroll-confirmation-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id=randomUUID(),key=randomUUID(),value={requestKey:key,memberId:id,month:'2020-01',action:'confirm',expectedDraftId:randomUUID(),expectedConfirmationId:null,note:'核对本次金额与来源',confirmed:true};
test('wage confirmation requires exact draft and prior confirmation identities plus explicit acknowledgement, never payment fields',()=>{
 assert.equal(confirmationPayload(value).action,'confirm');for(const patch of [{confirmed:false},{expectedDraftId:'bad'},{expectedConfirmationId:'bad'},{note:' '},{action:'paid'},{paymentAccount:'x'}])assert.throws(()=>confirmationPayload({...value,...patch}),ContractError);
});
test('workbook selection must be explicit, unique and limited to the requested month',()=>{
 const v={requestKey:key,month:'2020-01',confirmationIds:[id]};assert.equal(exportPayload(v).confirmationIds.length,1);for(const patch of [{confirmationIds:[]},{confirmationIds:[id,id]},{confirmationIds:[id,'bad']},{month:'2020-99'},{includeUnconfirmed:true}])assert.throws(()=>exportPayload({...v,...patch}),ContractError);
});
test('workbook responses require actual ZIP magic, expected content type and a matching SHA256 before download',async()=>{
 const bytes=Buffer.from([80,75,3,4,1,2,3]),hash=createHash('sha256').update(bytes).digest('hex'),headers={'content-type':workbookMime,'x-studio-export-id':id,'x-studio-file-hash':hash};assert.equal((await readWorkbook(new Response(bytes,{headers}))).id,id);await assert.rejects(readWorkbook(new Response(bytes,{headers:{...headers,'content-type':'text/html'}})),ContractError);await assert.rejects(readWorkbook(new Response('wrong',{headers})),ContractError);await assert.rejects(readWorkbook(new Response(bytes,{headers:{...headers,'x-studio-file-hash':'a'.repeat(64)}})),ContractError);
});
test('lost confirmation or binary export responses recover privately and readonly previews send no confirmation or export operation',async()=>{
 let writes=0;const api=createCloudApi(async path=>{if(path==='/api/session')return Response.json({user:{id,username:'payroll',role:'admin',permissions:['payroll']},csrfToken:'a'.repeat(64)});if(path==='/api/payroll/confirmation-receipts/'+key)return Response.json({id,revision:1});if(path==='/api/payroll/export-receipts/'+key)return Response.json({id,month:'2020-01'});writes++;throw Error('lost');},{allowWrites:true});await api.session();await assert.rejects(api.payrollConfirmationSave(value),e=>e.uncertain);await assert.rejects(api.payrollConfirmationSave(value),e=>e.status===409);assert.equal((await api.payrollConfirmationReceipt(key)).id,id);const v={requestKey:key,month:'2020-01',confirmationIds:[id]};await assert.rejects(api.payrollExport(v),e=>e.uncertain);await assert.rejects(api.payrollExport(v),e=>e.status===409);assert.equal((await api.payrollExportReceipt(key)).id,id);assert.equal(writes,2);const readonly=createCloudApi(async()=>{throw Error('not reached');});await assert.rejects(readonly.payrollConfirmationSave(value),e=>e.status===405);await assert.rejects(readonly.payrollExport(v),e=>e.status===405);await assert.rejects(readonly.payrollExportFile(id),e=>e.status===405);
});
