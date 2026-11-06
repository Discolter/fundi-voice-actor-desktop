import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderStudioMirror} from '../app/web/studio-projects-view.js';
const source=readFileSync(new URL('../app/web/app.js',import.meta.url),'utf8');
const host=readFileSync(new URL('../app/ActorHost.cs',import.meta.url),'utf8');
const html=readFileSync(new URL('../app/web/index.html',import.meta.url),'utf8');
for(const required of ['renderStudioMirror(studioCatalog','data-mirror-project','data-mirror-back','data-mirror-episode','data-mirror-role-status','loadStudioCatalog','Проекты студии'])
 assert.ok(source.includes(required),'Actor desktop mirror missing '+required);
assert.ok(html.includes('studio-projects-view.css'));
assert.ok(host.includes('"/studio-projects-view.js","/studio-projects-view.css"'));
const catalog={projects:[{id:'p',title:'РеЗеро',season:'4',archived:false,episodes:[{id:'ep',number:'06',stage:'record',roles:[{character:'Эмилия',actor:'Анна',status:'recording',lineCount:20}]}]}]};
assert.match(renderStudioMirror(catalog,{filter:'active'}),/data-mirror-project="p"/);
const frozen={projects:[{...catalog.projects[0],hidden:true}]};
assert.doesNotMatch(renderStudioMirror(frozen,{filter:'active'}),/data-mirror-project="p"/,'Frozen catalog projects must not be visible to actors');
const detail=renderStudioMirror(catalog,{projectId:'p'});
for(const value of ['data-mirror-episode','Эмилия','Анна','В записи'])assert.ok(detail.includes(value),value);
assert.ok(!detail.includes('data-action="save"'));
console.log('Actor read-only Studio mirror navigation and asset delivery checks passed');
let clock=100000,version=1,catalogRequests=0;
const context=vm.createContext({
  Date:class extends Date {static now(){return clock;}},
  state:{authenticated:true},ui:{page:'studioProjects'},lastStatus:'',
  modal:{open:false},document:{querySelector:()=>null},
  render(){},renderTransferNotice(){},updateMessageBadge(){},
  api:async route=>{
    if(route==='studio-projects'){catalogRequests++;return {projects:[{id:'p',cover:'picture-'+version}]};}
    return {authenticated:true};
  }
});
const catalogCode=source.slice(source.indexOf('let studioCatalog='),source.indexOf('function renderStudioCatalog'));
const updateCode=source.slice(source.indexOf('async function update(manual=false)'),source.indexOf("document.addEventListener('click',async event=>"));
vm.runInContext(catalogCode+'\n'+updateCode+'\nglobalThis.refreshMirror=update;globalThis.savedMirror=()=>studioCatalog;',context);
await context.refreshMirror(true);
assert.equal(context.savedMirror().projects[0].cover,'picture-1');
version=2;
await context.refreshMirror(false);
assert.equal(catalogRequests,1,'Status polling does not fetch the entire catalog every second');
clock+=61000;await context.refreshMirror(false);
assert.equal(context.savedMirror().projects[0].cover,'picture-2','Background sync updates already-open Studio cards');
version=3;await context.refreshMirror(true);
assert.equal(context.savedMirror().projects[0].cover,'picture-3','Manual refresh bypasses catalog throttle');
console.log('Actor mirror manual refresh and bounded background refresh passed');
