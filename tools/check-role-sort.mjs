import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACTOR_ROLE_SORTS,sortActorRoles,sortActorProjects,actorProjectWorkload,groupProjects} from '../app/web/core.js';

const fixture=[
 {roleId:'n',lineCount:null,character:'Unknown'}, {roleId:'t',lineCount:100,character:'Large'},
 {roleId:'z',lineCount:0,character:'Zero'}, {roleId:'a',lineCount:51,character:'Medium'},
 {roleId:'u',character:'Missing'},{roleId:'o',lineCount:1,character:'Small'}
];
const ids=mode=>sortActorRoles(fixture,mode).map(r=>r.roleId);
assert.deepEqual(ids('default'),['n','t','z','a','u','o']);
assert.deepEqual(ids('linesAsc'),['z','o','a','t','n','u']);
assert.deepEqual(ids('linesDesc'),['t','a','o','z','n','u']);
assert.deepEqual(ids('invalid'),ids('default'));
assert.equal(fixture[0].roleId,'n','sorting should not mutate the original feed');
assert.deepEqual(ACTOR_ROLE_SORTS.map(s=>s[0]),['default','linesAsc','linesDesc']);
const app=readFileSync('app/web/app.js','utf8');
const css=readFileSync('app/web/actor.css','utf8');
for(const needle of ['actor-role-sort','sortActorRoles(ep.roles,ui.roleSort)','sortActorRoles(selectDebts','roleSort:ui.roleSort','saveAppearance();render();'])
 assert.ok(app.includes(needle),'Missing UI wiring: '+needle);
assert.ok(css.includes('.actor-role-sort-bar'));
console.log('PASS: Actor role workload sort (ascending, descending, unknown last, project and debt views)');

const projectRoles=[
 {projectId:'alpha',projectTitle:'Альфа',episodeId:'1',lineCount:15,character:'A'},
 {projectId:'beta',projectTitle:'Бета',episodeId:'1',lineCount:200,character:'B'},
 {projectId:'alpha',projectTitle:'Альфа',episodeId:'2',lineCount:85,character:'C'},
 {projectId:'gamma',projectTitle:'Гамма',episodeId:'1',lineCount:null,character:'D'}
];
const groups=groupProjects(projectRoles);
assert.deepEqual(groups.map(x=>x.id),['alpha','beta','gamma']);
assert.equal(actorProjectWorkload(groups[0]).total,100);
assert.deepEqual(sortActorProjects(groups,'linesAsc').map(p=>p.id),['alpha','beta','gamma']);
assert.deepEqual(sortActorProjects(groups,'linesDesc').map(p=>p.id),['beta','alpha','gamma']);
assert.equal(actorProjectWorkload(groups[2]).known,0);
assert.deepEqual(groups.map(x=>x.id),['alpha','beta','gamma'],'project ordering must not mutate groups');
assert.ok(app.includes('sortActorProjects(groupProjects(all,ui.query),ui.roleSort)'));
