import {bootstrapSuperadmin} from './permissions';
import {createDatabase} from './database';
// Explicit operator bootstrap of an existing identity, never an automatic migration choice.
async function main(){
 const [username,reason,...extra]=process.argv.slice(2);
 if(extra.length||!username||!reason?.trim()||reason.length>2000)throw new Error('Provide existing username and reason');
 const db=createDatabase();
 try{await bootstrapSuperadmin(db,username,reason);console.log('Existing administrator bootstrapped; sign in again.');}finally{await db.close();}
}
main().catch(()=>{console.error('Super administrator bootstrap refused; check schema, existing administrator and bootstrap state.');process.exitCode=1;});
