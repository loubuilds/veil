const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/workflow.js');

test('single-page review has one explicit confirmation, then a privacy-gated preview', () => {
  const state = { count: 1, current: 0, reviewed: new Set(), acknowledged: false, busy: false };
  assert.equal(W.sourceAction(state).kind, 'review');
  assert.equal(W.sourceAction(state).disabled, false);
  state.reviewed.add(0);
  assert.equal(W.sourceAction(state).kind, 'preview');
  assert.equal(W.sourceAction(state).disabled, true);
  state.acknowledged = true;
  assert.equal(W.sourceAction(state).disabled, false);
  state.reviewed.clear();
  assert.equal(W.sourceAction(state).kind, 'review', 'a stale checkbox cannot skip changed-page review');
});

test('source review directs users to missing pages without treating navigation as review', () => {
  const state = { count: 3, current: 2, reviewed: new Set([0, 2]), acknowledged: true, busy: false };
  assert.deepEqual(W.sourceAction(state), { kind: 'navigate', next: 1, disabled: false, label: 'Check page 2 →', hint: 'There are still pages to check before making the PDF.' });
  assert.deepEqual([...state.reviewed], [0, 2]);
  state.current = 1;
  assert.equal(W.sourceAction(state).kind, 'review');
  state.busy = true;
  assert.equal(W.sourceAction(state).disabled, true);
});

test('export navigates all missing pages before offering the download confirmation', () => {
  const state = { count: 3, viewed: new Set([0, 2]), acknowledged: false, sourceReady: true, hasPDF: true, busy: false, failed: false };
  assert.equal(W.exportAction(state).kind, 'navigate');
  assert.equal(W.exportAction(state).next, 1);
  state.viewed.add(1);
  assert.equal(W.exportAction(state).kind, 'download');
  assert.equal(W.exportAction(state).disabled, true);
  state.acknowledged = true;
  assert.equal(W.exportAction(state).disabled, false);
});

test('all combinations of source, export, confirmation and busy gates fail closed', () => {
  for (const sourceReady of [false, true]) for (const hasPDF of [false, true])
  for (const acknowledged of [false, true]) for (const busy of [false, true])
  for (const allViewed of [false, true]) for (const failed of [false, true]) {
    const action = W.exportAction({ count: 2, viewed: new Set(allViewed ? [0, 1] : [0]), sourceReady, hasPDF, acknowledged, busy, failed });
    const canDownload = action.kind === 'download' && !action.disabled;
    assert.equal(canDownload, sourceReady && hasPDF && acknowledged && !busy && allViewed && !failed);
  }
});

test('failed rendering offers retry and never a download even with earlier acknowledgements', () => {
  const action = W.exportAction({ count: 1, viewed: new Set([0]), acknowledged: true, sourceReady: true, hasPDF: true, busy: false, failed: true });
  assert.equal(action.kind, 'retry');
  assert.equal(action.disabled, false);
});

test('empty documents and out-of-range markers do not satisfy the workflow', () => {
  assert.equal(W.sourceAction({ count: 0, reviewed: new Set(), current: 0 }).disabled, true);
  assert.equal(W.exportAction({ count: 0, viewed: new Set(), sourceReady: true, hasPDF: true }).disabled, true);
  assert.equal(W.firstUnchecked(2, new Set([1, 99])), 0);
});

test('restored PDF action explains each blocker and cannot skip it with acknowledgement', () => {
  const base = {count:2,hasReply:true,pending:false,issues:[],viewed:new Set([0,1]),acknowledged:true,busy:false};
  const action = changes => W.restoreAction({...base,...changes});
  assert.equal(action({}).kind,'download');
  assert.equal(action({busy:true}).disabled,true);
  assert.equal(action({hasReply:false}).kind,'unavailable');
  assert.equal(action({count:0}).kind,'unavailable');
  assert.equal(action({pending:true}).kind,'apply');
  const issue = {id:'B1',page:1,reason:'Text overflow'};
  assert.equal(action({issues:[issue]}).kind,'fit');
  assert.match(action({issues:[issue]}).hint,/does not fit/);
  assert.equal(action({issues:[{id:'B2',page:2,reason:'Check background & box'},issue]}).id,'B1');
  assert.equal(action({viewed:new Set([0])}).next,1);
  assert.equal(action({viewed:new Set([88,99])}).kind,'navigate');
  assert.equal(action({acknowledged:false}).kind,'confirm');
  for (const pending of [true,false]) for (const issuePresent of [true,false]) for (const viewedAll of [true,false]) for (const acknowledged of [true,false]) {
    const result = action({pending,issues:issuePresent?[issue]:[],viewed:new Set(viewedAll?[0,1]:[0]),acknowledged});
    assert.equal(result.kind==='download',!pending&&!issuePresent&&viewedAll&&acknowledged);
  }
});
