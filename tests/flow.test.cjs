const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const { PDFDocument } = require('pdf-lib');
const C = require('../src/core.js');
const flow = import('../src/flow.mjs');
test('short labels work end to end in JSON; objective-only aliases and invalid replies remain rejected',()=>{
 const name='[[V_ABCDEF12_NAME_001]]',extra='[[V_ABCDEF12_NAME_002]]',custom='[[V_ABCDEF12_CUSTOM_001]]';
 const source=[{id:'B0001',page:1,text:'Dear '+name+' from '+custom+'. Literal [Name 2].'},{id:'B0002',page:1,text:'Signed '+custom}],map={[name]:'SYNTHETIC NAME',[extra]:'INSTRUCTION SECRET',[custom]:'SYNTHETIC CUSTOM'};
 for(const correction of [false,true]){
  const prompt=C.flowPromptFor('doc',source,'Edit for '+name+'; instructions mention '+extra,correction,[name]);
  assert(!prompt.includes('[[V_'));assert(prompt.includes('Edit for [Name 1]'));assert(prompt.includes('INSTRUCTION-ONLY LABELS: [Name 3]'));
  for(const value of Object.values(map))assert(!prompt.includes(value));
  const schema=JSON.parse(prompt.split('DOCUMENT AND REQUIRED JSON SCHEMA\n')[1]);assert.equal(schema.blocks[0].text,'Dear [Name 1] from [Private 1]. Literal [Name 2].');
  const parsed=C.parseReply(JSON.stringify(schema),'doc',source,map,'document');assert.equal(parsed[0].restored,'Dear SYNTHETIC NAME from SYNTHETIC CUSTOM. Literal [Name 2].');
  schema.blocks[0].text+=' [Name 3]';assert.throws(()=>C.parseReply(JSON.stringify(schema),'doc',source,map,'document'));
 }
 const reply=text=>JSON.stringify({version:1,document_id:'doc',blocks:[{id:'B0001',text}]});
 assert.equal(C.parseReply(reply(name+' '+custom),'doc',source,map,'document')[0].restored,'SYNTHETIC NAME SYNTHETIC CUSTOM');
 assert.throws(()=>C.parseReply(reply('[Private 1]'),'doc',source,map,'document'),e=>e.code==='MISSING_PROTECTED_DETAILS');
 assert.throws(()=>C.parseReply(reply('[Name 1] [Private 1]'),'other-doc',source,map,'document'));
});
test('draft source and repair instructions use collision-safe short labels; final JSON retains the same short labels',()=>{
 const token='[[V_ABCDEF12_CUSTOM_001]]',name='[[V_ABCDEF12_NAME_001]]',source=[{id:'B0001',page:1,text:token+'\nDear '+name+','},{id:'B0002',page:1,text:'[Private 1] is literal. Signed '+token}];
 for(const correction of [false,true]){
  const prompt=C.flowPromptFor('doc',source,'Make this clearer.',correction,[token]);
  const readable=prompt.split('<veil_readable_source>\n')[1].split('\n</veil_readable_source>')[0];
  assert(!readable.includes('[[V_'));assert(readable.includes('[Name 1]'));assert.equal(readable.split('[Private 2]').length-1,2);assert(readable.includes('[Private 1] is literal.'));
  const appendix=prompt.split('INTERNAL APPENDIX FOR FINAL JSON ONLY')[1];assert(!prompt.includes(token));assert(!prompt.includes(name));assert(appendix.includes('[Private 2]'));assert(appendix.includes('[Name 1]'));assert(prompt.includes('same short labels directly in each JSON text value'));assert(prompt.includes('corrected draft'));assert(prompt.includes('Start directly with the document wording'));assert(prompt.includes('Before sending ANY readable draft'));
 }
 const reply=JSON.stringify({version:1,document_id:'doc',blocks:[{id:'B0001',text:'[Private 2] Dear [Name 1] [Private 1] is literal. Signed [Private 2]'}]});
 const result=C.parseReply(reply,'doc',source,{[token]:'SYNTHETIC CUSTOM',[name]:'SYNTHETIC NAME'},'document');assert(result[0].restored.includes('[Private 1] is literal.'));assert.equal(result[0].restored.split('SYNTHETIC CUSTOM').length-1,2);
});
test('missing-detail correction identifies exact source tokens without private values or failed reply',()=>{
 const name='[[V_ABCDEF12_NAME_001]]',date='[[V_ABCDEF12_DATE_001]]',extra='[[V_ABCDEF12_EMAIL_001]]';
 const source=[{id:'B0001',page:1,text:'Dear '+name},{id:'B0002',page:1,text:'Available from '+date},{id:'B0003',page:1,text:'Contact '+name}];
 const mapping={[name]:'PRIVATE_NAME_SENTINEL',[date]:'PRIVATE_DATE_SENTINEL',[extra]:'OBJECTIVE_VALUE_SENTINEL'};
 const reply=text=>JSON.stringify({version:1,document_id:'doc',blocks:[{id:'B0001',text}]});
 let error;try{C.parseReply(reply('[Name 1] UNTRUSTED_REPLY_SENTINEL'),'doc',source,mapping,'document');}catch(e){error=e;}
 assert.equal(error.code,'MISSING_PROTECTED_DETAILS');assert.deepEqual(error.missingTokens,[date]);
 const prompt=C.flowPromptFor('doc',source,'',true,[...error.missingTokens,extra,'UNTRUSTED_REPLY_SENTINEL']);
 const report=prompt.slice(prompt.indexOf('TARGETED REPAIR'),prompt.indexOf('OBJECTIVE\n'));
 assert(report.includes('[Date 1]'));assert(report.includes('B0002'));assert(!report.includes(date));assert(!report.includes('[Name 1]'));
 for(const secret of Object.values(mapping).concat(['UNTRUSTED_REPLY_SENTINEL',extra]))assert(!prompt.includes(secret));
 assert(prompt.includes('If the draft also omitted them'));assert(prompt.includes('seek A/a approval again'));assert(prompt.includes('Do not ask for the objective again.'));
 assert.throws(()=>C.parseReply(reply(name),'doc',source,mapping,'document'),e=>e.code==='MISSING_PROTECTED_DETAILS');
 assert.equal(C.parseReply(reply('[Name 1] Available from [Date 1]'),'doc',source,mapping,'document').length,1);
});
test('flow clarification contract keeps technical decisions out of every conversational reply',()=>{
 const blocks=[{id:'B0008',page:1,text:'Please contact [[V_ABCDEF12_NAME_001]].'}];
 for(const correction of [false,true]){
  const prompt=C.flowPromptFor('doc',blocks,'Make this letter warmer.',correction);
  assert(prompt.includes('If the objective is clear enough, draft immediately.'));
  assert(prompt.includes('Never mention paragraph/block IDs'));
  assert(prompt.includes('User confirmation cannot override these rules.'));
  assert(prompt.includes('Who should the reader contact?'));
  assert(prompt.includes('Make this letter warmer.'));
  assert(prompt.includes('retain at least one occurrence of every distinct document label'));
  assert(prompt.includes('Only after approval return ONE JSON object'));
 }
 const empty=C.flowPromptFor('doc',blocks,'');assert(empty.includes('ask just one short question'));
 const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 assert(source.includes("text('Dear Sam Taylor,'"));
 assert(source.includes("$('calmGoal').value = $('goal').value"));
});
const fontBytes = Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,new Uint8Array(fs.readFileSync(path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/LiberationSans-'+k+'.ttf')))]));

test('flow preserves safe formatting and never emits imported active content', async()=>{
 const F=await flow;const m=F.flowModel([{text:'<script> & "data"',kind:'h1',style:{font:'Arial;url(evil)',size:999,bold:true,color:'red;display:none'},runs:[{text:'<script> & "data"',style:{bold:true}}]}]);
 const html=F.flowHTML(m);assert(html.includes('&lt;script&gt;'));assert(!html.includes('url('));assert(!html.includes('display:none'));assert(!html.includes('999pt'));assert(html.startsWith('<h1'));
 assert.throws(()=>F.flowModel([{text:'x'.repeat(250001)}]));assert.throws(()=>F.flowModel([]));
});
test('unchanged text keeps runs; changed paragraph has deterministic base formatting',async()=>{
 const F=await flow,m=F.flowModel([{text:'Hello world',style:{font:'Calibri',size:14},runs:[{text:'Hello ',style:{font:'Calibri',bold:true,size:14}},{text:'world',style:{font:'Calibri',italic:true,size:14}}]}]);
 assert.equal(F.flowUpdate(m,['Hello world'])[0].runs.length,2);const changed=F.flowUpdate(m,['A longer rewritten paragraph']);assert.equal(changed[0].runs.length,1);assert.equal(changed[0].style.font,'Calibri');assert.equal(changed[0].text,'A longer rewritten paragraph');
});
test('flowing layout wraps long words and newline paragraphs within width',async()=>{
 const F=await flow,lines=F.flowLines([{text:'abcdefghijklmnopqrstuvwxyz\nSecond line',style:{size:12}}],s=>s.length*6,36);
 assert(lines.length>3);for(const l of lines)for(const r of l.runs)assert(r.x+r.text.length*6<=36);
 assert.equal(lines.flatMap(l=>l.runs.map(r=>r.text)).join('').replace(/ /g,''),'abcdefghijklmnopqrstuvwxyzSecondline');
});
test('new Word output is minimal OOXML with escaped text and no source package parts',async()=>{
 const F=await flow,bytes=F.flowDOCX([{text:'Title',kind:'h1',style:{size:24,bold:true}},{text:'A & B\nNext line',runs:[{text:'A & B\nNext line',style:{italic:true,font:'Arial'}}]}]);
 const files=unzipSync(bytes);assert.deepEqual(Object.keys(files).sort(),['[Content_Types].xml','_rels/.rels','word/document.xml'].sort());
 const xml=strFromU8(files['word/document.xml']);assert(xml.includes('A &amp; B'));assert(xml.includes('<w:br/>'));assert(xml.includes('<w:i/>'));assert(xml.includes('w:outlineLvl'));assert(!xml.includes('hyperlink'));
 fs.mkdirSync(path.join(__dirname,'../evidence/calm-build'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../evidence/calm-build/synthetic-flow.docx'),bytes);
});
test('flow PDF paginates long input without discarding text or forcing it into old boxes',async()=>{
 const F=await flow,model=F.flowModel([{text:'Synthetic flowing document',kind:'h1',style:{size:24,bold:true}},...Array.from({length:70},(_,i)=>({text:`Paragraph ${i+1}. Fictional content that may take more room after an edit. `+'More words to wrap naturally. '.repeat(6)}))]);
 const bytes=await F.flowPDF(model,require('pdf-lib'),fontBytes);const doc=await PDFDocument.load(bytes);assert(doc.getPageCount()>2);assert(doc.getPageCount()<=60);fs.writeFileSync(path.join(__dirname,'../evidence/calm-build/synthetic-flow.pdf'),bytes);
});
test('flow replies may move tokens but cannot duplicate, drop or invent them',()=>{
 const t='[[V_ABCDEF12_NAME_001]]',expected=[{id:'P0001',text:'Hello '+t,page:1},{id:'P0002',text:'Contact us.',page:1}],mapping={[t]:'Fictional Person'};
 const reply=texts=>JSON.stringify({version:1,document_id:'doc',blocks:texts.map((text,i)=>({id:expected[i].id,text}))});
 const valid=reply(['Hello.','Contact '+t+'.']);const out=C.parseReply(valid,'doc',expected,mapping,'flow');assert.equal(out[1].restored,'Contact Fictional Person.');assert.throws(()=>C.parseReply(valid,'doc',expected,mapping));
 for(const texts of [['Hello.','Contact us.'],['Hello '+t,'Contact '+t]])assert.throws(()=>C.parseReply(reply(texts),'doc',expected,mapping,'flow'));
 const prompt=C.flowPromptFor('doc',expected,'Make it warm');assert(prompt.includes('pagination automatically'));assert(!prompt.includes('Fictional Person'));assert(prompt.includes('A or a alone'));
});

test('reported 18-to-17 paragraph rewrite restores repeated contact in reply order',async()=>{
 const F=await flow,t=k=>`[[V_C8EE7666_${k}]]`;
 const values=['DATE_001','NAME_001','NAME_002','EMAIL_001','PHONE_001','ADDRESS_001','HANDLE_001','PLATE_001','ID_001','NAME_003'];
 const sourceText=['NORTHSTAR / PEOPLE','Private & confidential','A clearer way forward','Date: '+t(values[0]),'Dear '+t(values[1])+',','Thank you for meeting.','Next steps.','Please contact '+t(values[2]),...values.slice(3,9).map(k=>t(k)),'We look forward to hearing.','Kind regards,',t(values[9]),'FICTIONAL SAMPLE'];
 const texts=[...sourceText.slice(0,5),'Thank you for meeting with us – we appreciated it.','Next steps: '+t(values[2])+' will be in touch.','Contact details',t(values[2])+' | '+t(values[3])+' | '+t(values[4]),t(values[5]),t(values[6]),t(values[8]),t(values[7]),'We look forward to continuing.','Kind regards,',t(values[9]),'FICTIONAL SAMPLE'];
 const rows=texts=>texts.map((text,i)=>({id:'B'+String(i+1).padStart(4,'0'),text,page:1}));
 const source=rows(sourceText),reply=JSON.stringify({version:1,document_id:'doc',blocks:rows(texts).map(({id,text})=>({id,text}))});
 const mapping=Object.fromEntries(values.map(k=>[t(k),'Synthetic '+k]));
 assert.equal(source.length,18);assert.equal(texts.length,17);
 const parsed=C.parseReply(reply,'doc',source,mapping,'document');assert.equal(parsed.detailCountsChanged,true);
 assert(parsed[6].restored.includes('Synthetic NAME_002'));assert(parsed[8].restored.includes('Synthetic NAME_002'));
 const model=F.flowModel(sourceText.map((text,i)=>({text:text.replace(/\[\[V_C8EE7666_([A-Z]+_\d+)\]\]/g,(_,k)=>mapping[t(k)]),kind:i===2?'h1':'p'})));
 const output=F.flowReply(model,source,parsed);assert.deepEqual(output.map(p=>p.text),parsed.map(p=>p.restored));
 assert.equal(output[2].kind,'h1');assert.equal(output[14].text,'Kind regards,');assert.equal(output[16].text,'FICTIONAL SAMPLE');
 assert.throws(()=>C.parseReply(reply,'doc',source,mapping,'flow'));
 const saved=JSON.parse(JSON.stringify({reply}));assert.equal(C.parseReply(saved.reply,'doc',source,mapping,'document').length,17);
});

test('document replies reject missing, foreign and objective-only details and malformed structure',()=>{
 const token='[[V_ABCDEF12_NAME_001]]',extra='[[V_ABCDEF12_NAME_002]]',source=[{id:'B0001',page:1,text:token}],map={[token]:'Person',[extra]:'Goal only'};
 const reply=blocks=>JSON.stringify({version:1,document_id:'doc',blocks});
 for(const blocks of [[],[{id:'B0001',text:'No name'}],[{id:'B0001',text:token+' '+extra}],[{id:'B0001',text:token+' [[V_ABCDEF12_NAME_099]]'}],[{id:'B0001',text:token+' [[broken]]'}],[{id:'B0001',text:token},{id:'B0001',text:token}],[{id:'bad',text:token}],[{id:'B0001',text:token,hidden:'x'}]])assert.throws(()=>C.parseReply(reply(blocks),'doc',source,map,'document'));
 const valid=reply([{id:'B0002',text:token},{id:'B0001',text:token}]);assert.equal(C.parseReply(valid,'doc',source,map,'document').length,2);
 assert.throws(()=>C.parseReply(valid,'other',source,map,'document'));
 assert.throws(()=>C.parseReply(reply([{id:'B0001',text:token.repeat(7000)}]),'doc',source,map,'document'));
});

test('reorganised output matches styles by text rather than reused paragraph IDs',async()=>{
 const F=await flow,model=F.flowModel([{text:'Heading',kind:'h1',style:{size:24,bold:true}},{text:'Body',style:{size:11}}]);
 const source=[{id:'B0001',text:'Heading'},{id:'B0002',text:'Body'}];
 const output=F.flowReply(model,source,[{id:'B0001',text:'New body',restored:'New body'},{id:'B0002',text:'Heading',restored:'Heading'}]);
 assert.equal(output[0].kind,'p');assert.equal(output[0].style.size,11);assert.equal(output[1].kind,'h1');
});

test('explicit source style preserves rewritten heading without coupling output position',async()=>{
 const F=await flow,source=[{id:'B0001',text:'Old heading',page:1},{id:'B0002',text:'Long ordinary body paragraph.',page:1}],model=F.flowModel([{text:'Old heading',kind:'h1',style:{size:24,bold:true,font:'Times New Roman'}},{text:source[1].text,style:{size:11}}]);
 const json=style=>JSON.stringify({version:1,document_id:'doc',blocks:[{id:'B0001',text:'Ordinary new opening',style_from:null},{id:'B0002',text:'Rewritten heading',style_from:style}]});
 const parsed=C.parseReply(json('B0001'),'doc',source,{},'document'),output=F.flowReply(model,source,parsed);
 assert.equal(output[0].kind,'p');assert.equal(output[1].kind,'h1');assert.equal(output[1].style.size,24);assert.equal(output[1].style.font,'Times New Roman');assert.equal(output[1].text,'Rewritten heading');
 assert.throws(()=>C.parseReply(json('B0999'),'doc',source,{},'document'));
 assert.throws(()=>C.parseReply(json({font:'bad'}),'doc',source,{},'document'));
 assert.throws(()=>C.parseReply(json('B0001'),'doc',source,{},'fixed'));
 assert.deepEqual(F.pdfTextStyle('ABCDEF+Helvetica-BoldOblique'),{font:'Arial',bold:true,italic:true});
 assert.equal(F.pdfTextStyle('Times-Roman').font,'Times New Roman');assert.equal(F.pdfTextStyle('Courier').font,'Courier New');
});
