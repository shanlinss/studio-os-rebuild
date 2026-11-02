import test from 'node:test';
import assert from 'node:assert/strict';
import {maskContact,titleCatalog,knowledgeList,templateRecord,feishuDocumentUrl,knowledgeNavigationPayload} from '../dist/resource-model.mjs';
import {ContractError} from '../dist/cloud-contract.mjs';
test('contact display masks unknown-length private contact data and handles empty facts',()=>{
 assert.equal(maskContact('13812345678'),'138****5678');assert.equal(maskContact('1234'),'****');assert.equal(maskContact(null),'未填写');assert.doesNotMatch(maskContact('12345678901'),/12345678901/);
});
test('title pagination is validated independently from the title bodies',()=>{
 assert.equal(titleCatalog({items:[{id:'batch',name:'A'}],page:1,pageCount:2,total:30}).items.length,1);
 assert.throws(()=>titleCatalog({items:[],page:0,pageCount:0,total:0}),ContractError);
});
test('knowledge types stay separate and malformed tag data is not silently accepted',()=>{
 assert.equal(knowledgeList([{id:'k',title:'Article',entryType:'knowledge',kind:'article',tags:[]}])[0].entryType,'knowledge');
 assert.throws(()=>knowledgeList([{id:'k',title:'Article',entryType:'private-payroll',kind:'article',tags:[]}]),ContractError);
 assert.throws(()=>templateRecord({id:'t',name:'Template',version:2,archived:false,tags:'string'}),ContractError);
});

test('knowledge navigation accepts only Feishu links and metadata, rejecting body edits and missing versions',()=>{
 const value={title:'规范',category:'团队',summary:'说明',tags:['拍摄','拍摄'],sourceUrl:'https://studio.feishu.cn/docx/local-test'};
 assert.deepEqual(knowledgeNavigationPayload(value,2).tags,['拍摄']);assert.equal(knowledgeNavigationPayload(value,2).expectedVersion,2);
 assert.throws(()=>knowledgeNavigationPayload({...value,body:'正文'}),ContractError);
 assert.throws(()=>knowledgeNavigationPayload(value,0),ContractError);
 for(const url of ['https://feishu.cn.evil.example/','http://studio.feishu.cn/','javascript:alert(1)','https://user:pass@studio.feishu.cn/','https://studio.feishu.cn:444/']){assert.equal(feishuDocumentUrl(url),null);assert.throws(()=>knowledgeNavigationPayload({...value,sourceUrl:url}),ContractError);}
});
