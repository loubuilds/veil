const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const fixture = 'Name: Jane Smith\nAddress: 12 Willow Road, Bristol, BS1 4AB\nEmail: jane.smith@example.com\nPhone: 07700 900123\nSocial: @jane_smith\nVehicle registration: AB12 CDE\nDate: 17 September 2026\nReference: EMP-847293';
test('cautious rules cover representative requested UK identifiers', () => {
  const hits = C.detect(fixture);
  for (const type of ['NAME', 'ADDRESS', 'EMAIL', 'PHONE', 'HANDLE', 'PLATE', 'DATE', 'ID']) assert(hits.some(h => h.type === type), type);
});
test('sensitivity expands detection and does not remove strong matches', () => {
  const counts = C.LEVELS.map(l => C.autoTypes(fixture + '\nArlo 42', l).filter(Boolean).length);
  assert(counts[0] <= counts[1]); assert(counts[1] < counts[2]);
});
test('specific types outrank broad numeric matches and names exclude salutations', () => {
  for (const [text, type, value] of [['Phone: 07700 900123', 'PHONE', '07700 900123'], ['Vehicle registration: AB12 CDE', 'PLATE', 'AB12 CDE'], ['Dear Jane Smith,', 'NAME', 'Jane Smith']]) {
    const found = C.segments(text, C.autoTypes(text), Array(text.length).fill(null));
    assert(found.some(s => s.type === type && s.value === value));
  }
  assert(C.detect('07700 900123', 'standard').some(s => s.type === 'PHONE'));
  assert(!C.detect('AB12 CDE\nReference: EMP-847293').some(s => s.type === 'ID' && s.start < 9 && s.end > 9));
});
test('manual add and remove override changing automatic sensitivity', () => {
  const text = 'Arlo 42 jane@example.com'; const overrides = Array(text.length).fill(null);
  overrides[0] = 'CUSTOM'; overrides[text.indexOf('@')] = '';
  for (const level of C.LEVELS) {
    const s = C.segments(text, C.autoTypes(text, level), overrides);
    assert(s.some(s => s.start === 0)); assert(!s.some(s => s.start <= text.indexOf('@') && s.end > text.indexOf('@')));
  }
});
function pack() {
  const text = 'Contact jane@example.com, or jane@example.com.';
  return C.tokenise([{ id: 'B0001', page: 1, text, auto: C.autoTypes(text), overrides: Array(text.length).fill(null) }], 'ABCDEF12');
}
test('exact repeated values share a token and private values stay out of protected text', () => {
  const p = pack(); assert.equal(Object.keys(p.mapping).length, 1); assert.equal(C.tokens(p.blocks[0].text).length, 2); assert(!p.blocks[0].text.includes('jane@'));
});
test('manual, automatic and objective occurrences of the same value reuse one token', () => {
  const text = 'Jane Smith';
  const b = { id: 'B0001', page: 1, text, auto: C.autoTypes(text), overrides: Array(text.length).fill(null) };
  const manual = { ...b, id: 'B0002', overrides: Array(text.length).fill('CUSTOM') };
  const p = C.tokenise([b, manual], 'ABCDEF12', [{ ...manual, id: 'GOAL' }]);
  assert.equal(Object.keys(p.mapping).length, 1); assert.equal(p.blocks[0].text, p.blocks[1].text); assert.equal(p.blocks[0].text, p.extra[0].text);
});
test('strict JSON restores surviving tokens once without recursive replacement', () => {
  const p = pack(), data = { version: 1, document_id: 'document', blocks: [{ id: 'B0001', text: p.blocks[0].text.replace('Contact', 'Please contact') }] };
  assert(C.parseReply(JSON.stringify(data), 'document', p.blocks, p.mapping)[0].restored.includes('jane@example.com'));
  const maliciousOriginal = '[[V_ABCDEF12_NAME_999]]'; const token = Object.keys(p.mapping)[0]; p.mapping[token] = maliciousOriginal;
  assert(C.parseReply(JSON.stringify(data), 'document', p.blocks, p.mapping)[0].restored.includes(maliciousOriginal));
});
test('wrong documents, missing tokens, duplication, malformed and unknown tokens fail closed', () => {
  const p = pack(), valid = { version: 1, document_id: 'document', blocks: [{ id: 'B0001', text: p.blocks[0].text }] };
  const check = d => C.parseReply(JSON.stringify(d), 'document', p.blocks, p.mapping);
  assert.throws(() => check({ ...valid, document_id: 'another' }));
  const token = C.tokens(valid.blocks[0].text)[0];
  for (const text of [valid.blocks[0].text.replace(token, ''), valid.blocks[0].text + token, valid.blocks[0].text + ' [[V_ABCDEF12_NAME_999]]', valid.blocks[0].text.replace(token, token.toLowerCase())]) assert.throws(() => check({ ...valid, blocks: [{ id: 'B0001', text }] }));
  assert.throws(() => check({ ...valid, extra: true }));
  assert.throws(() => check({ ...valid, blocks: [{ id: 'B0002', text: valid.blocks[0].text }] }));
});
test('tokens cannot move between blocks', () => {
  const p = pack(), expected = [...p.blocks, { id: 'B0002', page: 1, text: 'No private content.' }];
  const moved = { version: 1, document_id: 'doc', blocks: [{ id: 'B0001', text: '' }, { id: 'B0002', text: p.blocks[0].text }] };
  assert.throws(() => C.parseReply(JSON.stringify(moved), 'doc', expected, p.mapping));
});
test('prompt carries approval workflow, stable schema and no mapping', () => {
  const p = pack(), prompt = C.promptFor('doc', p.blocks, 'Shorten the letter.', []);
  assert(prompt.includes('Commands are case-insensitive')); assert(prompt.includes('clarifying questions')); assert(prompt.includes('JSON object only')); assert(!prompt.includes('jane@example.com'));
});
test('one complete prompt contains the protected text and a returnable schema without a PDF', () => {
  const p = pack(), prompt = C.promptFor('doc', [...p.blocks, { id: 'B0002', page: 2, text: 'Locked example.', locked: true }], 'Shorten the letter.', []);
  const schema = JSON.parse(prompt.split('DOCUMENT AND REQUIRED JSON SCHEMA\n')[1]);
  assert.equal(schema.document_id, 'doc'); assert.equal(schema.blocks.length, 2);
  assert.equal(schema.blocks[0].text, p.blocks[0].text);
  assert(prompt.includes('No PDF upload is required'));
  assert(prompt.includes('only of A or a (ignoring surrounding whitespace)'));
  assert(prompt.includes('R or r means revise'));
  assert(!prompt.includes('single uppercase letter'));
  assert(!prompt.includes('Approval is case-sensitive'));
  assert(prompt.includes('A - Approve and produce the final reply to paste into Veil\nR - Revise (include the changes you want)'));
  assert(prompt.includes('EXACT wording of the latest approved draft'));
  assert(prompt.includes('NEVER display them as labels or references in drafts or revision replies'));
  assert(prompt.includes('After every revision, show the complete new draft in the same natural readable format'));
  assert(prompt.includes('Only at this final stage include the technical block IDs'));
  assert(prompt.includes('Use the exact short labels from DRAFT LABELS'));
  assert(prompt.includes('[Email 1] = ' + C.tokens(p.blocks[0].text)[0]));
  assert(prompt.includes('Do not leave short labels in the final JSON'));
  assert(!prompt.includes('organised by its existing pages and block IDs'));
  assert(prompt.includes('No text before or after it, no Markdown code fences'));
  assert(prompt.includes('B0002: page 2 - LOCKED'));
  assert(prompt.includes('Do not claim to preserve exact fonts'));
});
test('reply conversion accepts the expected JSON and rejects surrounding AI commentary', () => {
  const p = pack(), prompt = C.promptFor('doc', p.blocks, '', []);
  const schema = JSON.parse(prompt.split('DOCUMENT AND REQUIRED JSON SCHEMA\n')[1]);
  const json = JSON.stringify(schema);
  assert.equal(C.parseReply(json, 'doc', p.blocks, p.mapping)[0].changed, false);
  assert.throws(() => C.parseReply('Here is your result:\n' + json, 'doc', p.blocks, p.mapping));
  assert.throws(() => C.parseReply(json + '\nA - Approve', 'doc', p.blocks, p.mapping));
});
test('recovery uses random authenticated encryption and rejects wrong passwords and tampering', async () => {
  const original = { private: 'SYNTHETIC-PRIVATE-CONTENT', pdf: 'SYNTHETIC-PDF' }, password = 'a fictional strong passphrase';
  const a = await C.encryptRecovery(original, password), b = await C.encryptRecovery(original, password);
  assert.notEqual(a, b); assert(!a.includes(original.private)); assert.deepEqual(await C.decryptRecovery(a, password), original);
  await assert.rejects(C.decryptRecovery(a, 'different passphrase'));
  const tampered = JSON.parse(a); tampered.data = (tampered.data[0] === 'A' ? 'B' : 'A') + tampered.data.slice(1);
  await assert.rejects(C.decryptRecovery(JSON.stringify(tampered), password));
  await assert.rejects(C.encryptRecovery(original, 'short'));
});

test('friendly labels are deterministic, repeated, typed and avoid literal collisions', () => {
  const blocks = [{ id: 'B1', text: '[name 1] [ Name 2 ] [[V_ABCDEF12_NAME_001]] [[V_ABCDEF12_EMAIL_002]] [[V_ABCDEF12_NAME_001]] [[V_ABCDEF12_NAME_003]]' }];
  const labels = C.friendlyLabels(blocks);
  assert.equal(labels.byToken['[[V_ABCDEF12_NAME_001]]'], '[Name 3]');
  assert.equal(labels.byToken['[[V_ABCDEF12_NAME_003]]'], '[Name 4]');
  assert.equal(labels.byToken['[[V_ABCDEF12_EMAIL_002]]'], '[Email 1]');
  assert.deepEqual(C.friendlyLabels(JSON.parse(JSON.stringify(blocks))), labels);
});

test('friendly and mixed replies restore once and preserve canonical changed detection', () => {
  const p = pack(), token = C.tokens(p.blocks[0].text)[0];
  const parse = text => C.parseReply(JSON.stringify({ version: 1, document_id: 'doc', blocks: [{ id: 'B0001', text }] }), 'doc', p.blocks, p.mapping)[0];
  for (const text of [p.blocks[0].text, p.blocks[0].text.replaceAll(token, '[Email 1]'), p.blocks[0].text.replace(token, '[Email 1]')]) {
    const reply = parse(text);
    assert.equal(reply.changed, false); assert.equal(reply.text, p.blocks[0].text);
    assert.equal(reply.restored, 'Contact jane@example.com, or jane@example.com.');
  }
  assert.equal(parse(p.blocks[0].text.replaceAll(token, '[Email 1]').replace('Contact', 'Please contact')).changed, true);
  p.mapping[token] = '[Email 1]';
  assert.equal(parse(p.blocks[0].text.replaceAll(token, '[Email 1]')).restored, 'Contact [Email 1], or [Email 1].');
});

test('unknown, altered, missing, duplicate and moved friendly labels fail closed', () => {
  const p = pack(), token = C.tokens(p.blocks[0].text)[0], friendly = p.blocks[0].text.replaceAll(token, '[Email 1]');
  const expected = [...p.blocks, { id: 'B0002', text: 'Ordinary text.' }];
  const parse = (text, second = expected[1].text) => C.parseReply(JSON.stringify({ version: 1, document_id: 'doc', blocks: [{ id: 'B0001', text }, { id: 'B0002', text: second }] }), 'doc', expected, p.mapping);
  for (const label of ['', '[Email 2]', '[email 1]', '[ Email 1 ]', '[Email 1][Email 1]', token + '[Email 1]']) assert.throws(() => parse(friendly.replace('[Email 1]', label)));
  assert.throws(() => parse(friendly.replace('[Email 1]', ''), 'Ordinary text. [Email 1]'));
  assert.throws(() => parse(friendly + ' [Name 99]'));
  assert.equal(parse(friendly + ' [Section 1]')[0].changed, true);
});

test('literal label text remains literal; locked aliases and regenerated saved blocks stay unchanged', () => {
  const token = '[[V_ABCDEF12_NAME_001]]', expected = [{ id: 'B1', page: 1, text: '[Name 1] ' + token, locked: true }], mapping = { [token]: 'Fictional Person' };
  const parse = text => C.parseReply(JSON.stringify({ version: 1, document_id: 'doc', blocks: [{ id: 'B1', text }] }), 'doc', JSON.parse(JSON.stringify(expected)), mapping)[0];
  assert.equal(parse('[Name 1] [Name 2]').restored, '[Name 1] Fictional Person');
  assert.equal(parse('[Name 1] [Name 2]').changed, false);
  assert.throws(() => parse('[Name 1] [Name 1] [Name 2]'));
});

test('objective-only tokens get no document alias or permission to enter the reply', () => {
  const p = pack(), goalToken = '[[V_ABCDEF12_NAME_999]]';
  p.mapping[goalToken] = 'Fictional Objective Person';
  const prompt = C.promptFor('doc', p.blocks, 'Write to ' + goalToken, []);
  assert(!prompt.includes('[Name 1] =')); assert(!prompt.includes(p.mapping[goalToken]));
  assert(!prompt.includes('jane@example.com'));
  const reply = text => JSON.stringify({ version: 1, document_id: 'doc', blocks: [{ id: 'B0001', text }] });
  for (const extra of [' [Name 1]', ' ' + goalToken]) assert.throws(() => C.parseReply(reply(p.blocks[0].text + extra), 'doc', p.blocks, p.mapping));
});

test('copy/paste smart delimiters and escaped identifier underscores restore without changing prose', () => {
  const p = pack();
  const prose = 'We’re pleased. “A clearer way forward,” she said. Then "Hello". ';
  const data = { version: 1, document_id: 'doc', blocks: [{ id: 'B0001', text: prose + p.blocks[0].text }] };
  const canonical = JSON.stringify(data);
  // Mimic smart punctuation applied to JSON delimiters, preserving escaped quotes.
  const smart = canonical.replace(/"((?:\\.|[^"\\])*)"/g, (_, content) => '“' + content + '”');
  const escaped = smart.replace(/_/g, '\\_');
  for (const input of [canonical, smart, escaped, canonical.replace(/_/g, '\\_'), '```json\n' + escaped + '\n```']) {
    const parsed = C.parseReply(input, 'doc', p.blocks, p.mapping);
    assert.equal(parsed[0].text, data.blocks[0].text);
    assert.equal(parsed[0].restored, prose + 'Contact jane@example.com, or jane@example.com.');
    assert.equal(parsed.formatRepaired, input !== canonical);
  }
});

test('repair never removes arbitrary Markdown escapes or bypasses schema and token checks', () => {
  const p = pack(), token = C.tokens(p.blocks[0].text)[0];
  const reply = text => JSON.stringify({ version: 1, document_id: 'doc', blocks: [{ id: 'B0001', text }] }).replace(/"((?:\\.|[^"\\])*)"/g, (_, content) => '“' + content + '”');
  for (const text of [p.blocks[0].text.replace(token, ''), p.blocks[0].text + token, p.blocks[0].text + ' [[V_ABCDEF12_NAME_999]]']) {
    assert.throws(() => C.parseReply(reply(text), 'doc', p.blocks, p.mapping), /placeholder/i);
  }
  const good = reply(p.blocks[0].text);
  for (const invalid of [good.slice(0, -1), good + '\nHere you go.', 'Here you go.\n' + good, good.replace('“version”:1', '“version”:2'), good.replace('“doc”', '“wrong”'), good.replace('“blocks”', '“extra”'), good.replace('Contact', 'Contact\\_us')]) {
    assert.throws(() => C.parseReply(invalid, 'doc', p.blocks, p.mapping));
  }
  const literal = 'A literal \\_ and \\n stay literal. ' + p.blocks[0].text;
  assert.equal(C.parseReply(reply(literal), 'doc', p.blocks, p.mapping)[0].text, literal);
});

test('copy-safe instructions and failed paste guidance explain the next action', () => {
  const p = pack(), prompt = C.promptFor('doc', p.blocks, '', []);
  assert(prompt.includes('ASCII U+0022')); assert(prompt.includes('Do not Markdown-escape underscores'));
  assert.throws(() => C.parseReply('{“text”: “unfinished', 'doc', p.blocks, p.mapping), /Use the AI’s Copy button/);
});

test('rich-text indentation and an empty Sources footer are tolerated only outside strings', () => {
  const p = pack(), text = 'Literal &#x20; &nbsp; &#32; Sources “quoted”. ' + p.blocks[0].text;
  const data = {version: 1, document_id: 'doc', blocks: [{id: 'B0001', text}]};
  const raw = JSON.stringify(data, null, 2);
  for (const entity of ['&#x20;', '&#32;', '&nbsp;']) {
    const pasted = raw.replace(/^  /gm, entity).replace(/_/g, '\\_') + '\n\nSources';
    const result = C.parseReply(pasted, 'doc', p.blocks, p.mapping);
    assert.equal(result[0].text, text); assert.equal(result.formatRepaired, true);
  }
  assert.equal(C.parseReply('```json\n' + raw + '\n```\nSources', 'doc', p.blocks, p.mapping)[0].text, text);
  for (const tail of ['Sources\nhttps://example.com', 'Sources: anything', 'Other commentary', 'Sources\nSources']) assert.throws(() => C.parseReply(raw + '\n' + tail, 'doc', p.blocks, p.mapping));
});

test('reported moved name and duplicated contacts are diagnosed after formatting repair', () => {
  const token = type => `[[V_7DC774A2_${type}_001]]`;
  const expected = [
    {id:'B0007', page:1, text:'We are pleased to confirm next steps.'},
    {id:'B0008', page:1, text:'Contact ' + token('NAME') + ' to arrange a time.'},
    ...['EMAIL','PHONE','ADDRESS','HANDLE','PLATE','ID'].map((type,i) => ({id:'B' + String(i+9).padStart(4,'0'),page:1,text:type + ': ' + token(type)}))
  ];
  const mapping = Object.fromEntries(expected.flatMap(b => C.tokens(b.text)).map(t => [t, 'Fictional private value']));
  const bad = {version:1,document_id:'doc',blocks:expected.map(b => ({id:b.id,text:b.text}))};
  bad.blocks[0].text += ' Contact ' + token('NAME') + ' now.';
  bad.blocks[1].text = expected.slice(2).map(b=>b.text).join('\n');
  const pasted = JSON.stringify(bad,null,2).replace(/^  /gm,'&#x20;').replace(/_/g,'\\_') + '\nSources';
  assert.throws(() => C.parseReply(pasted,'doc',expected,mapping), /AI moved, removed or duplicated.*page 1/);
  const valid = JSON.stringify({...bad, blocks:expected.map(b=>({id:b.id,text:b.text}))},null,2).replace(/^  /gm,'&#x20;').replace(/_/g,'\\_') + '\nSources';
  assert(C.parseReply(valid,'doc',expected,mapping).every(b=>!b.changed));
});

test('correction request carries protected authority and reapproval rules without a private mapping', () => {
  const p = pack(), blocks = [...p.blocks, {id:'B0002',page:2,text:'Unchanged locked text.',locked:true}];
  const request = C.replyCorrectionFor('doc',blocks);
  assert(!request.includes('jane@example.com'));
  assert(request.includes('not approval of new wording'));
  assert(request.includes('show a new normal readable draft'));
  assert(request.includes('A or a'));
  assert(request.includes('B0002: page 2; LOCKED'));
  const schema = JSON.parse(request.split('AUTHORITATIVE PROTECTED SOURCE AND REQUIRED JSON STRUCTURE\n')[1]);
  assert.deepEqual(schema.blocks,blocks.map(b=>({id:b.id,text:b.text})));
  assert(C.parseReply(JSON.stringify(schema),'doc',blocks,p.mapping).every(b=>!b.changed));
  assert(C.promptFor('doc',blocks,'',[]).includes('internally compare EVERY block'));
});
