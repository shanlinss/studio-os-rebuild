import test from 'node:test';
import assert from 'node:assert/strict';
import {maskContact,titleCatalog,knowledgeList,templateRecord} from '../dist/resource-model.mjs';
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
