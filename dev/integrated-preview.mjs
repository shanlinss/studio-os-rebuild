import {mkdtemp,readdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startLocalDatabase} from './local-database.mjs';
import {migrate} from '../.build/server/migrations.js';
import {createStudioApp} from '../.build/server/app.js';
import {hashPassword} from '../.build/server/auth.js';
import {Materials} from '../.build/server/materials.js';

// Public disposable test credentials. Valid only in this newly-created local
// database; never provisioned in a cloud environment or imported business DB.
export const localTestPassword='StudioLocalOnly123!';
const local=await startLocalDatabase(),db=local.db;
let app,webRoot,stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;if(app)await app.close();await local.stop();if(webRoot)await rm(webRoot,{recursive:true,force:true});};
try{
 await migrate(db);
 for(const [username,name,role]of [['local_admin','隔离管理员','admin'],['local_employee_a','隔离员工 A','employee'],['local_employee_b','隔离员工 B','employee']]){
  const [u]=await db.client`INSERT INTO studio_os.accounts(username,password_hash,role) VALUES(${username},${await hashPassword(localTestPassword)},${role}) RETURNING id`;
  const [m]=await db.client`INSERT INTO studio_os.members(display_name,login_account_id) VALUES(${name},${u.id}) RETURNING id`;
  await db.client`INSERT INTO studio_os.business_accounts(name,responsible_member_id) VALUES(${'隔离账号 · '+name},${m.id})`;
  if(role==='admin')await new Materials(db).save({id:u.id,username,role},{title:'隔离参考素材：封面表达',sourceUrl:'https://example.com/reference',metadata:{notes:'仅供本机验证，不是真实业务资料。',tags:['隔离验证']},storeIds:[]});
 }
 webRoot=await mkdtemp(path.join(tmpdir(),'studio-os-integrated-web-'));
 for(const file of (await readdir('dist')).filter(f=>/\.(mjs|js|html|css|svg)$/.test(f)))await copyFile(path.join('dist',file),path.join(webRoot,file));
 const index=path.join(webRoot,'index.html');await writeFile(index,(await readFile(index,'utf8')).replace('name="studio-data-mode" content="prototype"','name="studio-data-mode" content="cloud-connected"'));
 app=await createStudioApp(db,webRoot,{diagnosticSink:()=>{}});await app.listen(4178,'127.0.0.1');
 console.log('Disposable integrated preview: http://127.0.0.1:4178/');
 console.log('Test-only login: local_admin / local_employee_a / local_employee_b; password is the public localTestPassword in dev/integrated-preview.mjs.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().catch(()=>{process.exitCode=1;});});
}catch(error){await stop();throw error;}
