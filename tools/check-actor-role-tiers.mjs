import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderStudioMirror} from '../app/web/studio-projects-view.js';
const catalog={projects:[{id:'p',title:'Тест',episodes:[{id:'e',number:'1',roles:[
 {character:'Прохожий',roleTier:'extras',status:'waiting'},
 {character:'Герой',roleTier:'main',status:'received'},
 {character:'Подруга',roleTier:'supporting',status:'done'},
 {character:'Старая роль',status:'waiting'}
]}]}]};
const html=renderStudioMirror(catalog,{projectId:'p'});
const headers=['Главные роли','Второстепенные роли','Массовка'];
for(const heading of headers)assert.match(html,new RegExp(heading));
assert.ok(html.indexOf(headers[0])<html.indexOf(headers[1]));
assert.ok(html.indexOf(headers[1])<html.indexOf(headers[2]));
assert.match(html,/Старая роль/);
assert.doesNotMatch(html,/data-mirror-save|contenteditable/i);
const app=readFileSync('app/web/app.js','utf8');
const css=readFileSync('app/web/actor.css','utf8');
assert.match(app,/function renderTieredActorRoles/);
assert.match(app,/actorRoleTierLabel/);
assert.match(app,/renderTieredActorRoles\(sortActorRoles\(ep.roles,ui.roleSort\)/);
assert.match(app,/renderTieredActorRoles\(selected/);
assert.match(css,/\.actor-tier-header/);
console.log('PASS: Actor Desktop role tier groups, legacy fallback and read-only Studio mirror');
