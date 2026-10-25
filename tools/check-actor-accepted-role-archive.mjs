import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleAcceptedRoles,acceptedHiddenRoles} from '../app/web/core.js';

const roles=[
 {roleId:'waiting',status:'waiting'},
 {roleId:'accepted',status:'done'},
 {roleId:'other-done',status:'done'},
 {roleId:'reopened',status:'retake'}
];
const ids=list=>list.map(x=>x.roleId);
assert.deepEqual(ids(visibleAcceptedRoles(roles,['accepted','reopened'])),['waiting','other-done','reopened']);
assert.deepEqual(ids(acceptedHiddenRoles(roles,['accepted','reopened'])),['accepted']);
assert.deepEqual(ids(visibleAcceptedRoles(roles,[])),ids(roles));
assert.deepEqual(ids(acceptedHiddenRoles(roles,[])),[]);
assert.deepEqual(ids(visibleAcceptedRoles(roles,null)),ids(roles));
assert.deepEqual(ids(acceptedHiddenRoles(roles,null)),[]);
const duplicateUser=visibleAcceptedRoles(roles,['not-mine']);
assert.deepEqual(ids(duplicateUser),ids(roles));
const app=readFileSync(new URL('../app/web/app.js',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../app/ActorCloud.cs',import.meta.url),'utf8');
const host=readFileSync(new URL('../app/ActorHost.cs',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/web/actor.css',import.meta.url),'utf8');
for(const term of ['visibleAcceptedRoles(all,state.view?.hiddenRoleIds)',
  'acceptedHiddenRoles(all,state.view?.hiddenRoleIds)',
  'data-action="role-visibility"','data-page="history"',
  'Вернуть в мои роли','Скрыть из кабинета','roles/visibility',
  'function renderHistory(hiddenRoles)','roleRow(r,true,true)'])assert.ok(app.includes(term),'Missing desktop Actor archive: '+term);
assert.match(host,/route=="roles\/visibility"/);
assert.match(cloud,/\/v1\/actor\/roles\/visibility/);
assert.ok(css.includes('.actor-history-stack'));
assert.ok(app.includes("ui.page==='history'?renderHistory(archived):renderDebts(active)"));
console.log('PASS actor accepted role archive uses personal visibility only, restored on demand');
