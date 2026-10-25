import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.join(root,'app','web');
const host=readFileSync(path.join(root,'app','ActorHost.cs'),'utf8');
const allowlist=host.match(/static readonly HashSet<string> files=[^{]*\\{([\\s\\S]*?)\\}/)?.[1];
assert.ok(allowlist,'Missing Actor local HTTP allowlist');
const allowed=new Set([...allowlist.matchAll(/"([^"]+)"/g)].map(m=>m[1]));
const dependencies=new Set(['/app.js']);
for(const file of readdirSync(web).filter(f=>f.endsWith('.js'))){
  const source=readFileSync(path.join(web,file),'utf8');
  const imports=[
    ...source.matchAll(/^\\s*(?:import|export)\\b[^\\n]*?\\bfrom\\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\\s*import\\s*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\\bimport\\(\\s*['"]([^'"]+)['"]\\s*\\)/g)
  ];
  for(const match of imports){
    if(match[1].startsWith('.'))dependencies.add(path.posix.normalize(path.posix.join('/',path.posix.dirname(file),match[1])));
  }
}
for(const dep of dependencies){
  assert.ok(existsSync(path.join(web,dep.slice(1))),'Missing bundled module '+dep);
  assert.ok(allowed.has(dep),'Actor local host returns 404 for imported ES module: '+dep);
}
const html=readFileSync(path.join(web,'index.html'),'utf8');
for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  if(/^(?:https?:|data:)/.test(m[1]))continue;
  const url='/'+m[1].replace(/^\\/?/,'');
  assert.ok(allowed.has(url),'Actor local host returns 404 for HTML asset: '+url);
}
assert.ok(dependencies.has('/age.js'),'Regression must check age.js import');
console.log('PASS Actor startup: all '+dependencies.size+' imported modules and HTML assets served');
