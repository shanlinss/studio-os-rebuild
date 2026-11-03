import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hasSensitive,permissionPayload} from '../dist/admin-permissions.mjs';
import {navigationForRole} from '../dist/page-access.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const user=permissions=>({id:randomUUID(),username:'manager',role:'admin',superadmin:false,permissions}),pages=u=>navigationForRole(u.role,u).flatMap(([,items])=>items.map(([id])=>id));
test('personnel and resource navigation follow their own explicit capabilities without unlocking money or account security',()=>{
 const resources=pages(user(['resources'])),personnel=pages(user(['personnel']));for(const id of ['warehouse','assets','shops','accounts'])assert.ok(resources.includes(id));for(const id of ['ledger','settlements','roles','members'])assert.ok(!resources.includes(id));assert.ok(personnel.includes('members'));assert.ok(personnel.includes('attendance'));assert.ok(!personnel.includes('warehouse'));assert.ok(pages(user(['payroll'])).includes('attendance'));assert.ok(pages(user(['account_security'])).includes('members'));assert.ok(pages(user(['finance'])).includes('ledger'));assert.ok(!pages(user([])).includes('members'));
});
test('new maintenance grants fail closed for legacy claims and cannot be spoofed by employee roles or duplicate payload grants',()=>{
 for(const p of ['personnel','resources']){assert.equal(hasSensitive({role:'admin'},p),false);assert.equal(hasSensitive({role:'employee',superadmin:true,permissions:[p]},p),false);assert.equal(hasSensitive(user([p]),p),true);}assert.deepEqual(permissionPayload({permissions:['resources','personnel'],superadmin:false,reason:'核实管理职责'},2).permissions,['personnel','resources']);assert.throws(()=>permissionPayload({permissions:['resources','resources'],superadmin:false,reason:'重复'},2),ContractError);
});
test('session adaptation preserves all five capability claims while denying unknown authority fields',async()=>{
 const u=user(['finance','account_security','payroll','personnel','resources']),api=createCloudApi(async()=>Response.json({user:u}));assert.deepEqual((await api.session()).permissions,u.permissions);const bad=createCloudApi(async()=>Response.json({user:{...u,permissions:['all-stores']}}));await assert.rejects(bad.session(),ContractError);const superadmin={...user([]),superadmin:true};assert.equal(pages(superadmin).length,29);
});
