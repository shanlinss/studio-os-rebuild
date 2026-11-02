import EmbeddedPostgres from 'embedded-postgres';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {createDatabase} from '../.build/server/database.js';

// Always creates its own disposable cluster. Never attaches to an existing DB,
// reads a .env, accepts a target URL, or uses the user's cloud credentials.
export async function startLocalDatabase(){
 if(process.env.STUDIO_RUNTIME&&process.env.STUDIO_RUNTIME!=='development')throw new Error('Local verification requires development mode');
 const check=net.createServer();await new Promise((resolve,reject)=>{check.once('error',()=>reject(new Error('Local test port 55432 is occupied; no existing database was touched')));check.listen(55432,'127.0.0.1',resolve);});await new Promise(resolve=>check.close(resolve));
 const directory=await mkdtemp(path.join(tmpdir(),'studio-os-db-'));
 const password=randomBytes(32).toString('hex');
 const pg=new EmbeddedPostgres({databaseDir:path.join(directory,'cluster'),port:55432,user:'postgres',password,authMethod:'scram-sha-256',persistent:false,createPostgresUser:false,autoRehydrateSymlinks:true,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-h','127.0.0.1','-k',directory,'-c','timezone=UTC'],onLog:()=>{},onError:()=>{}});
 let db,started=false;
 try{
  await pg.initialise();await pg.start();started=true;await pg.createDatabase('studio_os_test');
  db=createDatabase(`postgresql://postgres:${password}@127.0.0.1:55432/studio_os_test`);
  await db.client`SELECT 1`;
  return {db,async stop(){await db.close();await pg.stop();await rm(directory,{recursive:true,force:true});}};
 }catch(error){if(db)await db.close().catch(()=>{});if(started)await pg.stop().catch(()=>{});await rm(directory,{recursive:true,force:true});throw error;}
}
