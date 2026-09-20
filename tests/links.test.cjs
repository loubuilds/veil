const test=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core.js'),W=require('../src/workflow.js');
const links=(s,level='standard')=>C.detect(s,level).filter(h=>h.type==='URL').map(h=>s.slice(h.start,h.end));
test('profile and repository links include scheme-free, subdomain and bounded hard-wrap forms',()=>{
 for(const s of ['linkedin.com/in/fictional-person','https://uk.linkedin.com/in/fictional-person/','github.com/fictional-owner/project','gitlab.com/fictional-owner/project','instagram.com/fictional.person','bsky.app/profile/fictional.example','youtube.com/@fictional','linkedin.com/\nin/fictional-person','github.com/fictional-\nowner/project'])for(const level of C.LEVELS)assert.deepEqual(links(s,level),[s]);
 assert.deepEqual(links('See (linkedin.com/in/fictional-person).'),['linkedin.com/in/fictional-person']);
 assert.deepEqual(links('linkedin.com/in/fictional-person\nNext paragraph'),['linkedin.com/in/fictional-person']);
 assert.deepEqual(links('https://linkedin.com/in/fictional-person/\nNext paragraph'),['https://linkedin.com/in/fictional-person/']);
 assert.deepEqual(links('linkedin.com/in/\nfictional-person'),['linkedin.com/in/\nfictional-person']);
 assert.deepEqual(links('github.com/first/\ngithub.com/second'),['github.com/first/','github.com/second']);
 assert.deepEqual(links('https://linkedin.com.evil.example/in/example'),[]);
});
test('ordinary URLs depend on sensitivity; identifying values protect the whole link',()=>{
 for(const s of ['https://example.org/help','www.example.org','example.org/help']){assert.deepEqual(links(s),[]);assert.deepEqual(links(s,'cautious'),[s]);assert.deepEqual(links(s,'maximum'),[s]);}
 for(const s of ['https://example.org/?email=person%40example.org','https://example.org/person@example.org','example.org/?employee=12345','https://example.org/?token=secret-example']){assert.deepEqual(links(s),[s]);assert(C.autoTypes(s,'standard').every(t=>t==='URL'));}
 assert.deepEqual(links('person@example.org','cautious'),[]);
 assert.deepEqual(links('This sentence has no link.'),[]);
});
test('short Link placeholders restore full URLs and accept legacy Website replies',()=>{
 const text='Visit github.com/fictional-owner/project',packed=C.tokenise([{id:'B0001',text,auto:C.autoTypes(text,'standard'),overrides:Array(text.length).fill(null)}],'ABCD1234'),labels=C.friendlyLabels(packed.blocks),token=C.tokens(packed.blocks[0].text)[0];assert.equal(labels.byToken[token],'[Link 1]');
 const prompt=C.flowPromptFor('example',packed.blocks,'Improve clarity.');assert(prompt.includes('[Link 1]'));assert(!prompt.includes('[Website 1]'),'legacy aliases remain parser-only');
 for(const label of ['[Link 1]','[Website 1]']){const reply={version:1,document_id:'example',blocks:[{id:'B0001',text:packed.blocks[0].text.replace(token,label)}]};const parsed=C.parseReply(JSON.stringify(reply),'example',packed.blocks,packed.mapping);assert.equal(parsed[0].text,packed.blocks[0].text);}
 const override=Array(text.length).fill('');assert.equal(C.tokenise([{id:'B0001',text,auto:C.autoTypes(text),overrides:override}],'ABCD1234').blocks[0].text,text);
 const literal=C.friendlyLabels([{text:'[Website 1] '+token}]);assert.equal(literal.byToken[token],'[Link 2]');
});
test('hidden link warning is explicit and contains no destination value',()=>{
 const report=W.documentFeedback({hasText:true,pages:[{links:2,identifyingLinks:1}]});assert(report.notes.some(n=>n.includes('Check links for personal details')&&n.includes('even where nothing is highlighted')));assert(report.notes.some(n=>n.includes('not included in the AI prompt')));
});
