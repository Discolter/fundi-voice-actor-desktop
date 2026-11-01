import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderReadonlyStudioProjects} from '../app/web/studio-projects.js';

const escapeHTML=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const feed={revision:10,roles:[
  {actorId:'a1',actorName:'Первый актёр',projectId:'p',projectTitle:'Адский рай 2',episodeId:'e1',episodeNumber:'1',character:'Габимару',status:'waiting'},
  {actorId:'a2',actorName:'Второй актёр',projectId:'p',projectTitle:'Адский рай 2',episodeId:'e1',episodeNumber:'1',character:'<script>alert(1)</script>',status:'done'}
]};
const ui={query:'',stageLabel:x=>({waiting:'Жду запись',done:'Принято'})[x],escapeHTML,expanded:new Set()};
const html=renderReadonlyStudioProjects(feed,ui);
for(const required of ['Проекты студии','', 'Адский рай 2','Габимару','Первый актёр','Второй актёр','Жду запись','Принято','50%','&lt;script&gt;'])
  assert.ok(html.includes(required),'Missing studio row: '+required);
assert.ok(!html.includes('<script>'),'Unescaped cast text');
assert.ok(!html.includes('data-action="role-visibility"'),'Read-only studio rows must not edit roles');
assert.ok(!html.includes('data-action="submit-role"'),'Read-only studio rows must not submit role files');
assert.ok(!html.includes('data-action="recording"'),'Read-only studio rows must not toggle recording');
assert.ok(renderReadonlyStudioProjects(feed,{...ui,query:'недоступный'}).includes('ничего не найдено'),'Search filter');
const host=readFileSync('app/ActorHost.cs','utf8');
const cloud=readFileSync('app/ActorCloud.cs','utf8');
const app=readFileSync('app/web/app.js','utf8');
for(const anchor of ['if(method=="GET"&&route=="studio-projects")','cloud.StudioProjects()', '"/studio-projects.js"','"/studio-projects.css"'])
  assert.ok(host.includes(anchor),'Host route or assets missing '+anchor);
assert.ok(cloud.includes('"/v1/actor/studio-projects","GET"'),'Actor must load read-only GET endpoint');
assert.ok(app.includes('data-page="studio-projects"'),'New sidebar link missing');
assert.ok(app.includes('studioProjectsData=null;studioProjectsError'),'Logout must clear sensitive cached roster');
console.log('PASS read-only studio project stages in Actor desktop');
