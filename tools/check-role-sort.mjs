import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACTOR_ROLE_SORTS,sortActorRoles} from '../app/web/core.js';

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
