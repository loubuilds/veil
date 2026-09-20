const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../src/workflow.js');
test('deadline releases a stalled operation, cancels once and ignores late completion',async()=>{
 let finish,cancelled=0;const stalled=new Promise(resolve=>finish=resolve);
 await assert.rejects(W.withDeadline(stalled,10,'Reader timed out',()=>{cancelled++;throw Error('cancel failed');}),e=>e.code==='VEIL_TIMEOUT'&&e.message==='Reader timed out');
 finish('late');await new Promise(r=>setTimeout(r,15));assert.equal(cancelled,1);
});
test('deadline preserves normal success/errors without cancelling',async()=>{
 let cancelled=0;assert.equal(await W.withDeadline(Promise.resolve('ready'),20,'timeout',()=>cancelled++),'ready');
 const original=Error('damaged');await assert.rejects(W.withDeadline(Promise.reject(original),20,'timeout',()=>cancelled++),e=>e===original);
 await new Promise(r=>setTimeout(r,25));assert.equal(cancelled,0);
});
test('local reader returns bytes and aborts inaccessible local files',async()=>{
 class Reader{readAsArrayBuffer(){this.result=Uint8Array.from([37,80,68,70]).buffer;this.onload();}abort(){throw Error('should not abort');}}
 assert.deepEqual(Array.from(await W.readLocalFile({},Reader,20)),[37,80,68,70]);
 let instance;class Stalled{constructor(){instance=this;}readAsArrayBuffer(){}abort(){this.aborted=true;this.onabort();}}
 await assert.rejects(W.readLocalFile({},Stalled,10),/download it to this device/);assert(instance.aborted);
 class Failed{readAsArrayBuffer(){this.onerror();}}
 await assert.rejects(W.readLocalFile({},Failed,20),/could not be read/);
});
