// Run every regression separately and preserve its exit status on Windows and Linux.
import {readdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
function run(command,args,label){
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:'inherit'});
  if(result.error||result.status!==0){
    console.error('FAILED: '+label,result.error?.message||'exit '+result.status);
    process.exit(1);
  }
}
for(const name of readdirSync(resolve(root,'app/web')).filter(n=>extname(n)==='.js').sort())
  run(process.execPath,['--check','app/web'+'/'+name],name+' syntax');
const checks=readdirSync(resolve(root,'tools')).filter(n=>/^check-.+\.(mjs|py)$/.test(n)).sort();
for(const name of checks)
  run(name.endsWith('.py')?(process.env.PYTHON||(process.platform==='win32'?'python':'python3')):process.execPath,['tools/'+name],name);
console.log('Passed '+checks.length+' regression scripts and all browser module syntax checks.');
