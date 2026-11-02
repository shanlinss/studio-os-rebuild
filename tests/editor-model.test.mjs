import test from 'node:test';
import assert from 'node:assert/strict';
import {beijingInput,beijingTimestamp} from '../dist/record-editors.mjs';
import {taskModel,ContractError} from '../dist/cloud-api.mjs';
test('editor times stay explicitly in Beijing independent of the computer timezone',()=>{
 assert.equal(beijingInput('2026-12-31T18:30:00Z'),'2027-01-01T02:30');
 assert.equal(beijingTimestamp('2027-01-01T02:30'),'2027-01-01T02:30:00+08:00');
 assert.throws(()=>beijingTimestamp('2027-01-01'),ContractError);
});
test('publication editor receives only the original task material relations',()=>{
 const materials=[{id:'reference',title:'Linked material',targetCount:3}];
 const task=taskModel({task:{id:'task',title:'Task'},materials,publications:[],snapshots:[]});
 assert.deepEqual(task.materials,materials);assert.notEqual(task.materials,materials);
 assert.throws(()=>taskModel({task:{id:'task',title:'Task'},materials:[{}],publications:[],snapshots:[]}),ContractError);
});
