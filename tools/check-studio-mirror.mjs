import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
const detail=renderStudioMirror(catalog,{projectId:'p'});
for(const value of ['data-mirror-episode','Эмилия','Анна','В записи'])assert.ok(detail.includes(value),value);
assert.ok(!detail.includes('data-action="save"'));
console.log('Actor read-only Studio mirror navigation and asset delivery checks passed');
