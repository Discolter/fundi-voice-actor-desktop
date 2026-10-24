import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actorWorkloadClass} from '../app/web/core.js';

const app=readFileSync('app/web/app.js','utf8');
const styles=readFileSync('app/web/actor.css','utf8');
assert.match(app,/Number\.isInteger\(role\.lineCount\)/);
assert.match(app,/Реплик:/);
assert.match(app,/actorWorkloadClass\(role\.lineCount\)/);
assert.match(styles,/actor-role-lines/);
const expected=[
 [0,'low'],[20,'low'],[49,'low'],[50,'low'],
 [51,'medium'],[75,'medium'],[100,'medium'],[101,'high'],[1000,'high'],
 [null,'unknown'],[undefined,'unknown'],[-1,'unknown'],[3.5,'unknown']
];
for(const [count,tier] of expected)
  assert.equal(actorWorkloadClass(count),'line-workload-'+tier,String(count));
for(const tier of ['low','medium','high']){
  assert.ok(styles.includes('.actor-role-lines.line-workload-'+tier),'Missing '+tier+' actor badge colors');
  assert.ok(styles.includes('body[data-theme=light] .role-name .actor-role-lines.line-workload-'+tier),
    'Missing light theme '+tier+' contrast colors');
}
console.log('PASS: Actor cards and debts show Studio-matched colors (0–50, 51–100, 101+)');
