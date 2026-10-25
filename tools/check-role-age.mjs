import assert from 'node:assert/strict';
import {ageInfo,ageBadge} from '../app/web/age.js';
assert.equal(ageInfo('',new Date('2026-10-25T00:00:00Z')),null);
assert.equal(ageInfo('nonsense'),null);
assert.equal(ageInfo('2026-10-11T11:00:00Z',new Date('2026-10-25T00:00:00Z')).level,'green');
assert.equal(ageInfo('2026-10-10T11:00:00Z',new Date('2026-10-25T00:00:00Z')).level,'yellow');
assert.equal(ageInfo('2026-09-24T11:00:00Z',new Date('2026-10-25T00:00:00Z')).level,'red');
assert.equal(ageInfo('2026-09-10T11:00:00Z',new Date('2026-10-25T00:00:00Z')).label,'1 мес. 15 дн.');
assert.equal(ageInfo('2026-01-31T11:00:00Z',new Date('2026-03-01T00:00:00Z')).label,'1 мес. 1 дн.');
assert.match(ageBadge(null),/дата неизвестна/);
assert.match(ageBadge('2026-10-10T11:00:00Z',true),/fv-age-date/);

import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app/web/app.js',import.meta.url),'utf8');
assert.ok(app.includes('ageBadge(role.createdAt)'));
assert.ok(app.includes('ageBadge(p.roles[0]?.projectCreatedAt,true)'));
console.log('Actor age display checks passed');
