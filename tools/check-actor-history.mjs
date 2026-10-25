import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleAcceptedRoles,acceptedHiddenRoles,messageKind} from '../app/web/core.js';

const all=[
 {roleId:'r-a',status:'done',character:'Сион',projectTitle:'Меч и жезл',season:'2',episodeId:'ep1',episodeNumber:'01',projectId:'p1'},
 {roleId:'r-b',status:'waiting',character:'Уилл',projectTitle:'Меч и жезл',season:'2',episodeId:'ep1',episodeNumber:'01',projectId:'p1'},
 {roleId:'r-c',status:'done',character:'Субару',projectTitle:'ReZero',season:'4',episodeId:'ep6',episodeNumber:'06',projectId:'p2'}
];
const visible=visibleAcceptedRoles(all,['r-a','r-c']);
const archived=acceptedHiddenRoles(all,['r-a','r-c']);
assert.deepEqual(visible.map(x=>x.roleId),['r-b']);
assert.deepEqual(archived.map(x=>x.roleId),['r-a','r-c']);
assert.equal(messageKind('role_archived'),'Роль в истории');
assert.equal(messageKind('role_restored'),'Роль возвращена');
const app=readFileSync(new URL('../app/web/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/web/actor.css',import.meta.url),'utf8');
for(const key of ['data-page="history"','<span>История</span>',
  "ui.page==='history'?'История ролей'",
  "ui.page==='history'?renderHistory(archived)",
  'function renderHistory(hiddenRoles)',
  'groupProjects(filtered)','actor-history-project','actor-history-episode',
  'Серия ','roleRow(r,true,true)','Вернуть в мои роли',
  'data-action="role-visibility"','roles/visibility'])
 assert.ok(app.includes(key),'History tab missing: '+key);
assert.ok(!app.includes('fvHiddenPanel()')&&!app.includes('showHiddenAccepted'),
  'Old archive must not appear at the bottom of Projects');
assert.ok(app.includes("ui.page=(state.view?.hiddenRoleIds||[]).includes(role.roleId)?'history':'projects'"),
  'Notification jump opens History if the role was archived');
assert.ok(css.includes('.actor-history-stack'));
assert.ok(css.includes('.actor-history-role-list'));
assert.ok(app.includes('messageKind(item.kind)'), 'Inbox displays new role transfer notifications');
console.log('PASS: Actor History sidebar, project/episode details, notifications and restore behavior');
