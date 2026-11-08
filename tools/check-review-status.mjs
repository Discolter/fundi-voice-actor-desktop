import assert from 'node:assert/strict';
import {reviewedRole} from '../app/web/core.js';
const role={roleId:'hero',status:'waiting'};
const review=state=>[{roleId:role.roleId,state}];
for(const status of ['processing','processed']){
  const actual=reviewedRole({...role,status},review('pending'));
  assert.equal(actual.status,'processing','Pending review must not mask the processing stage');
  assert.equal(actual.reviewLabel,'Обрабатываю');
}
assert.equal(reviewedRole(role,review('pending')).status,'received');
assert.equal(reviewedRole(role,review('pending')).reviewLabel,'На проверке');
assert.equal(reviewedRole({...role,status:'processing'},review('accepted')).status,'done');
assert.equal(reviewedRole({...role,status:'processing'},review('retake')).status,'retake');
assert.equal(reviewedRole({...role,status:'recording'},review('retake')).status,'recording');
assert.equal(reviewedRole({...role,status:'processed'}).status,'processing');
const queued=reviewedRole({...role,status:'processing'},review('pending'),[{operation:'submit',body:{roleId:role.roleId}}]);
assert.equal(queued.status,'received');
assert.equal(queued.reviewLabel,'Ожидает отправки');
console.log('Actor stages preserve processing, retakes, decisions and queued submissions');
