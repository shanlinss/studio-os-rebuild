import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaUpload,readMedia,assetPath,maxFileBytes} from '../dist/media-contract.mjs';
import {shootingPayload,shootingAction,shootingActions} from '../dist/shooting-contract.mjs';
import {createCloudApi,ContractError} from '../dist/cloud-api.mjs';
const id='11111111-1111-4111-8111-111111111111',token='d'.repeat(64);
const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'封面.png',{type:'image/png'});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const draft={requestKey:id,title:'拍摄清单',productId:null,productDescription:'样品',assigneeId:null,dueOn:'2026-11-03',summary:'保持光线',items:[{id:null,title:'封面',kind:'图片',priority:'A',materialId:null,references:['原素材'],requirements:['背景干净']}]};
test('file validation rejects unsupported, empty, oversized and path-like names before HTTP',()=>{
 assert.equal(mediaUpload(file).mime,'image/png');
 for(const value of [new File([],'empty.png',{type:'image/png'}),new File(['x'],'bad.svg',{type:'image/svg+xml'}),{name:'large.mp4',size:maxFileBytes+1,type:'video/mp4',arrayBuffer(){}} ,new File(['x'],'../photo.png',{type:'image/png'})])assert.throws(()=>mediaUpload(value),ContractError);
 assert.throws(()=>mediaUpload(new File(['x'],'clip.mp4',{type:'video/mp4'}),{imagesOnly:true}),ContractError);
});
test('private previews bound streamed bytes and never render HTML as an image',async()=>{
 assert.equal((await readMedia(new Response(await file.arrayBuffer(),{headers:{'Content-Type':'image/png'}}))).size,file.size);
 await assert.rejects(readMedia(new Response('<script>bad</script>',{headers:{'Content-Type':'text/html'}})),ContractError);
 await assert.rejects(readMedia(new Response(new Uint8Array(maxFileBytes+1),{headers:{'Content-Type':'image/png'}})),ContractError);
 assert.throws(()=>assetPath('material','../outside',id),ContractError);assert.throws(()=>assetPath('external',id,id),ContractError);
});
test('binary uploads use original raw-body headers and private CSRF; read-only cannot upload or create receipts',async()=>{
 const calls=[],api=createCloudApi(async(path,options)=>{calls.push({path,options});return json(path==='/api/session'?{user:{id,username:'test',role:'admin'},csrfToken:token}:{id});},{allowWrites:true});
 await api.session();await api.uploadShooting(id,file,4,id,{note:'交付封面'});const call=calls.at(-1);
 assert.equal(call.options.body,file);assert.equal(call.options.headers['Content-Type'],'image/png');assert.equal(call.options.headers['x-file-name'],encodeURIComponent(file.name));assert.equal(call.options.headers['x-csrf-token'],token);assert.equal(call.options.headers['x-expected-version'],'4');assert.equal(call.options.headers['x-request-key'],id);assert.equal(call.options.redirect,'error');
 let sent=0;const readonly=createCloudApi(async()=>{sent++;throw Error('must not reach HTTP');});for(const action of [()=>readonly.uploadMaterial(id,file),()=>readonly.downloadMaterial(id,id),()=>readonly.createShooting(draft)])await assert.rejects(action(),e=>e.status===405);assert.equal(sent,0);
});
test('a binary upload with a lost response stays blocked until the original detail is read',async()=>{
 let writes=0;const api=createCloudApi(async(path,options)=>{if(path==='/api/session')return json({user:{id,username:'test',role:'admin'},csrfToken:token});if(options.method==='GET')return json({id,title:'Original',metadata:{},version:2,assets:[]});writes++;throw Error('lost');},{allowWrites:true});
 await api.session();await assert.rejects(api.uploadMaterial(id,file),e=>e.uncertain);await assert.rejects(api.uploadMaterial(id,file),e=>e.status===409);assert.equal(writes,1);await api.material(id);await assert.rejects(api.uploadMaterial(id,file),e=>e.uncertain);assert.equal(writes,2);
});
test('shooting edits preserve explicit identities, order and fields; state controls follow actual status',()=>{
 const edit={...draft,items:[{...draft.items[0],id}]};assert.equal(shootingPayload(edit,3).items[0].id,id);assert.equal(shootingPayload(edit,3).expectedVersion,3);assert.throws(()=>shootingPayload({title:'Rename only'},3),ContractError);
 assert.throws(()=>shootingPayload({...draft,dueOn:'2026-02-30'}),ContractError);assert.throws(()=>shootingPayload({...edit,items:[edit.items[0],edit.items[0]]},3),ContractError);
 assert.throws(()=>shootingAction({requestKey:id,action:'reshoot',feedback:' '},2),ContractError);
 assert.deepEqual(shootingActions({status:'待确认',archived:false},'employee'),['reshoot','approve']);assert.deepEqual(shootingActions({status:'已完成',archived:false},'employee'),[]);assert.deepEqual(shootingActions({status:'已完成',archived:false},'admin'),['reopen']);assert.deepEqual(shootingActions({status:'拍摄中',archived:true},'admin'),[]);
});
