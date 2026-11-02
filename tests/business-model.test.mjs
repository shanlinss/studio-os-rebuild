import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarGroups,weekDates,publicationStage,shootingRecord,productRecord} from '../dist/business-model.mjs';
import {ContractError} from '../dist/cloud-contract.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
test('weekly schedule crosses year boundaries without moving unplanned work into today',()=>{
 assert.deepEqual(weekDates('2027-01-03'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 const result=calendarGroups([{id:a,title:'Unplanned',kind:'publication',plannedPublishOn:null},{id:b,title:'Friday',kind:'publication',plannedPublishOn:'2027-01-01'}],'2027-01-03');
 assert.equal(result.unplanned.length,1);assert.equal(result.days[4].items[0].id,b);assert.equal(result.days[6].items.length,0);
 assert.throws(()=>weekDates('2027-02-30'),ContractError);
});
test('one task stays one calendar record; duplicate IDs or invalid dates are reported',()=>{
 const row={id:a,title:'Task',kind:'action',plannedPublishOn:'2026-11-02'};
 assert.throws(()=>calendarGroups([row,row],'2026-11-02'),ContractError);
 assert.throws(()=>calendarGroups([{...row,plannedPublishOn:'2026-11-32'}],'2026-11-02'),ContractError);
});
test('publishing and refill needs can overlap, unknown is distinct from zero',()=>{
 const both=publicationStage({targetCount:5,publishedCount:2,filledCount:1});assert.equal(both.needsPublishing,true);assert.equal(both.needsRefill,true);
 const zero=publicationStage({targetCount:2,publishedCount:0,filledCount:0});assert.equal(zero.needsRefill,false);assert.equal(zero.hasRefills,false);
 const unknown=publicationStage({});assert.equal(unknown.published,null);assert.equal(unknown.needsPublishing,false);
 assert.throws(()=>publicationStage({publishedCount:1,filledCount:2}),ContractError);assert.throws(()=>publicationStage({publishedCount:'2'}),ContractError);
});
test('shooting progress excludes archived items and removed attachments without changing the original request',()=>{
 const raw={id:a,title:'Shoot',status:'拍摄中',archived:false,version:2,items:[{id:a,title:'First',completed:true,position:2},{id:b,title:'Old',completed:false,archived:true,position:1}],assets:[{id:a,removed:true},{id:b,removed:false}]};
 const result=shootingRecord(raw);assert.equal(result.visibleItems.length,1);assert.equal(result.visibleItems[0].completed,true);assert.equal(result.visibleAssets.length,1);assert.equal(raw.items.length,2);
});
test('product records retain stable IDs and versions and reject a malformed detail response',()=>{
 const p={id:a,name:'Product',active:true,version:3};assert.equal(productRecord(p).version,3);assert.throws(()=>productRecord(p,true),ContractError);assert.throws(()=>productRecord({...p,version:'3'}),ContractError);
});
