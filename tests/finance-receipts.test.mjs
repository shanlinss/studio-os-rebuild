import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mediaUpload,readMedia,assetPath,maxFileBytes,expenseReceiptMaxBytes} from '../dist/media-contract.mjs';
import {financeRecord} from '../dist/management-model.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
test('expense receipt uploads support the original 10 MiB image limit without widening ordinary attachment limits',()=>{
 const file=new File([new Uint8Array(maxFileBytes+1)],'凭证.png',{type:'image/png'});
 assert.throws(()=>mediaUpload(file),ContractError);assert.equal(mediaUpload(file,{imagesOnly:true,maxBytes:expenseReceiptMaxBytes}).file,file);
 assert.throws(()=>mediaUpload(new File(['x'],'凭证.mp4',{type:'video/mp4'}),{imagesOnly:true,maxBytes:expenseReceiptMaxBytes}),ContractError);
 assert.throws(()=>mediaUpload({name:'large.png',type:'image/png',size:expenseReceiptMaxBytes+1,arrayBuffer(){}},{imagesOnly:true,maxBytes:expenseReceiptMaxBytes}),ContractError);
});
test('private receipt reads enforce image-only MIME, streamed size and scoped expense/receipt IDs',async()=>{
 const id=randomUUID(),receipt=randomUUID();assert.equal(assetPath('expense',id,receipt),'/api/finance/expenses/'+id+'/receipts/'+receipt);
 const response=()=>new Response(new Uint8Array(maxFileBytes+1),{headers:{'Content-Type':'image/png'}});
 assert.equal((await readMedia(response(),{imagesOnly:true,maxBytes:expenseReceiptMaxBytes})).size,maxFileBytes+1);
 await assert.rejects(readMedia(response()),ContractError);await assert.rejects(readMedia(new Response('video',{headers:{'Content-Type':'video/mp4'}}),{imagesOnly:true,maxBytes:expenseReceiptMaxBytes}),ContractError);
 assert.throws(()=>assetPath('expense','../other',receipt),ContractError);
});
test('expense uploads and deletes carry original version and CSRF, and remain blocked in read-only mode',async()=>{
 const id=randomUUID(),receipt=randomUUID(),calls=[],file=new File(['x'],'凭证.png',{type:'image/png'});
 const api=createCloudApi(async(path,options)=>{calls.push({path,options});return Response.json(path==='/api/session'?{user:{id,username:'local',role:'admin'},csrfToken:'a'.repeat(64)}:{id:receipt,version:3});},{allowWrites:true});
 await api.session();await api.uploadExpenseReceipt(id,file,2);let call=calls.at(-1);assert.equal(call.options.body,file);assert.equal(call.options.headers['x-expected-version'],'2');assert.equal(call.options.headers['x-csrf-token'],'a'.repeat(64));
 await api.removeExpenseReceipt(id,receipt,3);call=calls.at(-1);assert.equal(call.options.method,'DELETE');assert.deepEqual(JSON.parse(call.options.body),{expectedVersion:3});
 let writes=0;const readonly=createCloudApi(async()=>{writes++;throw Error('must not reach HTTP');});await assert.rejects(readonly.uploadExpenseReceipt(id,file,2),e=>e.status===405);await assert.rejects(readonly.removeExpenseReceipt(id,receipt,3),e=>e.status===405);assert.equal(writes,0);
});
test('malformed receipt metadata never becomes an editable empty attachment list',()=>{
 const data={categories:[],stores:[],members:[],records:[{id:'local',amountCents:'100',receipts:null}],settlements:[],payments:[]};assert.throws(()=>financeRecord(data),ContractError);
 assert.throws(()=>financeRecord({...data,records:[{id:'local',amountCents:'100',receipts:[{id:'file',name:'bad',mime:'text/html',size:10}]}]}),ContractError);
});
