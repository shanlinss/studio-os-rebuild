import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {navigationForRole} from '../dist/page-access.mjs';
import {permissionPayload,hasSensitive} from '../dist/admin-permissions.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
test('new session claims drive sensitive navigation independently without removing ordinary business pages',()=>{
 const pages=user=>navigationForRole(user.role,user).flatMap(([,rows])=>rows.map(([id])=>id));
 const base={role:'admin',superadmin:false,permissions:[]};assert.ok(pages(base).includes('materials'));for(const p of ['ledger','settlements','roles'])assert.ok(!pages(base).includes(p));
 assert.ok(pages({...base,permissions:['finance']}).includes('ledger'));assert.ok(!pages({...base,permissions:['finance']}).includes('roles'));
 assert.ok(pages({...base,permissions:['account_security']}).includes('roles'));assert.ok(!pages({...base,permissions:['account_security']}).includes('ledger'));
 assert.ok(pages({...base,superadmin:true}).includes('ledger'));assert.equal(hasSensitive({role:'employee',superadmin:true,permissions:['finance']},'finance'),false);
});
test('permission updates reject unsupported grants, duplicate grants, stale versions and unknown fields',()=>{
 const value={permissions:['finance'],superadmin:false,reason:'岗位授权'};assert.equal(permissionPayload(value,2).expectedVersion,2);
 for(const change of [{permissions:['unknown']},{permissions:['finance','finance']},{superadmin:'true'},{reason:''},{password:'secret'}])assert.throws(()=>permissionPayload({...value,...change},2),ContractError);assert.throws(()=>permissionPayload(value,0),ContractError);
});
test('session adaptation retains safe permission claims and rejects malformed claims',async()=>{
 const user={id:randomUUID(),username:'admin',role:'admin',superadmin:false,permissions:['finance']};const api=createCloudApi(async()=>Response.json({user,csrfToken:'hidden'}));assert.deepEqual(await api.session(),user);
 const malformed=createCloudApi(async()=>Response.json({user:{...user,permissions:['unknown']}}));await assert.rejects(malformed.session(),ContractError);
});
