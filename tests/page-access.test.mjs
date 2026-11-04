import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationForRole} from '../dist/page-access.mjs';
import {ContractError} from '../dist/cloud-contract.mjs';
test('new sitemap keeps 29 administrator pages and employee self-service without management dead ends',()=>{
 const admin=navigationForRole('admin').flatMap(([,pages])=>pages.map(([id])=>id));assert.equal(admin.length,29);assert.equal(new Set(admin).size,29);
 const employee=navigationForRole('employee').flatMap(([,pages])=>pages.map(([id])=>id));for(const id of ['daily','history','attendance','profile','materials','tests','publishing'])assert.ok(employee.includes(id));
 for(const id of ['ledger','settlements','roles','members','accounts','competitors','shops','warehouse'])assert.ok(!employee.includes(id));
 const scoped=navigationForRole('employee',{role:'employee',scopedPackaging:true}).find(([name])=>name==='我的工作台')[1];
 assert.ok(scoped.some(([id,label])=>id==='warehouse'&&label==='包材库存'));
 assert.throws(()=>navigationForRole('unknown'),ContractError);
});
