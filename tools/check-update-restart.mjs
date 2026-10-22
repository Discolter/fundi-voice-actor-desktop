// Regression test: in-app updates close only the previous Edge app window.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const host=readFileSync('app/ActorHost.cs','utf8');
const bridge=readFileSync('app/UpdateNotice.cs','utf8');
const start=host.indexOf('if( route == "update/restart")') >= 0
  ? host.indexOf('if( route == "update/restart")') : -1;
const route=host.indexOf('route=="update/restart"')>=0
  ? host.slice(host.indexOf('route=="update/restart"'),host.indexOf('route=="update/restart"')+750)
  : host.slice(host.indexOf('route == "update/restart"'),host.indexOf('route == "update/restart"')+750);
assert.ok(route.includes('SendJson(stream,200') || route.includes('Json(stream,200'),'Restart should acknowledge before closing');
assert.ok(route.includes('ThreadPool.QueueUserWorkItem'),'Close asynchronously after acknowledgment');
assert.ok(route.includes('CloseOldAppWindows(true)'),'Close the relevant old app');
assert.ok(route.indexOf('CloseOldAppWindows') > route.indexOf('stream,200'),'Close only after sending the response');
assert.ok(bridge.includes('IsAppWindowTitle(caption.ToString(),actor)'),'Match only application titles');
assert.ok(bridge.includes('windowClass.ToString()!="Chrome_WidgetWin_1"'),'Require Edge/Chromium app window');
assert.ok(bridge.includes('process.ProcessName,"msedge"'),'Require Microsoft Edge owner process');
assert.ok(bridge.includes('PostMessage(window,0x0010'),'Gracefully request WM_CLOSE');
assert.ok(!bridge.includes('process.Kill('),'Never terminate Edge and unrelated tabs');
assert.ok(bridge.includes('Wait-Process -Id'),'Wait for old local host before restarting launcher');
assert.ok(bridge.includes('Milliseconds 1600'),'Give old window time to close before launching');
assert.ok(bridge.includes('Fundi Voice Actor'));
console.log('PASS: Actor restart closes only the old Edge app window');
