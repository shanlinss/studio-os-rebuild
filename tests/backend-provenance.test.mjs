import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('all 33 imported migration checksums and unmodified backend source match the source manifest',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../docs/backend-source-manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.files.filter(f=>f.path.startsWith('studio/migrations/')).length,33);
 const intentional=new Set(['studio/server/personal-todos.ts','studio/server/workflow.ts','studio/server/lab.ts','studio/server/app.ts','studio/server/shooting.ts','studio/server/knowledge.ts','studio/server/finance.ts','studio/server/readiness.ts','studio/server/samples.ts','studio/server/auth.ts']);
 for(const file of manifest.files){if(intentional.has(file.path))continue;assert.equal(createHash('sha256').update(await readFile(new URL('../'+file.path,import.meta.url))).digest('hex'),file.sha256,file.path+' must retain the imported source bytes');}
});
