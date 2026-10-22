import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync('app/web/app.js','utf8'),styles=readFileSync('app/web/actor.css','utf8');
assert.match(app,/Number\.isInteger\(role\.lineCount\)/);
assert.match(app,/Реплик:/);
assert.match(styles,/actor-role-lines/);
console.log('PASS: Actor role cards display only specified dialogue count');
