import test from 'node:test';
import assert from 'node:assert/strict';
import {readDrafts,saveDraft,draftStorageKey,draftMarkdown} from '../dist/creation-model.mjs';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
const draft={id:'d1',name:'Draft',title:'Title',body:'Body',coverNote:'Cover',materialId:'m1',templateId:'',taskId:'t1',updatedAt:'2026-11-02T01:00:00Z'};
test('local drafts are separated by login identity and updates keep the existing draft ID',()=>{
 const s=storage();saveDraft(s,'a',draft);assert.deepEqual(readDrafts(s,'b'),[]);saveDraft(s,'a',{...draft,body:'Revised'});assert.equal(readDrafts(s,'a').length,1);assert.equal(readDrafts(s,'a')[0].body,'Revised');assert.match(draftMarkdown(draft),/# Title/);
});
test('corrupt existing draft data is preserved rather than silently overwritten',()=>{
 const s=storage();s.setItem(draftStorageKey('a'),'broken');assert.throws(()=>saveDraft(s,'a',draft));assert.equal(s.getItem(draftStorageKey('a')),'broken');
});
