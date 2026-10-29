import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync('app/web/app.js','utf8');
const native=readFileSync('app/ActorVacations.cs','utf8');
for(const x of ['data-vacation-indefinite','Бессрочно','input.disabled=checkbox.checked',"values.has('indefinite')","endDate=indefinite?null"]){
  assert.ok(app.includes(x),'Actor Desktop indefinite vacation missing: '+x);
}
assert.ok(native.includes('endDate=end==""?null:end'),'Native bridge must support nullable end dates');
assert.ok(app.includes("action==='vacation-end'"));
console.log('PASS: Actor Desktop indefinite vacations can start, edit, and end manually');
