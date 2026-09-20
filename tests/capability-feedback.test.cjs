const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../src/workflow.js');
test('format feedback distinguishes the export routes and does not promise original geometry',()=>{
 for(const input of [{hasText:true,pages:[{}],design:'text-flow'},{hasText:true,design:'letterhead'},{hasText:true},{hasText:true,design:'text-flow',textOnly:true}]){const pdf=W.documentFeedback(input);assert.match(pdf.redaction,/saved as an image/);assert.match(pdf.ai,/copying text from PDFs are unavailable/);}
 const word=W.documentFeedback({textModel:true,word:true});assert.match(word.ai,/Word download retains/);assert.match(word.ai,/PDF and copied text use a simpler layout/);assert.match(word.redaction,/does not reproduce/);
 for(const input of [{textModel:true},{textModel:true,word:true,textOnly:true}]){const text=W.documentFeedback(input);assert.match(text.ai,/Original graphics and table layout are not included/);assert.doesNotMatch(text.ai,/Word download retains/);}
});
test('scan, partial text, annotations and uncertain positions have concrete warnings',()=>{
 const empty=W.documentFeedback({pages:[{scan:true}]});assert.equal(empty.title,'Manual redaction only');assert.match(empty.ai,/unavailable/);assert.match(empty.notes[0],/1 of 1/);
 const partial=W.documentFeedback({hasText:true,design:'text-flow',pages:[{}, {scan:true,complex:true,annotations:1}]});assert.equal(partial.notes.length,3);assert.match(partial.notes[0],/may leave out text in images/);assert.match(partial.notes[1],/may not highlight everything/);assert.match(partial.notes[2],/whole/);
 assert.match(W.documentFeedback({hasText:true,checkFailed:true}).ai,/unavailable/);
});
test('failed early layout assessment preserves redaction and enables retry, retaining real error',async()=>{
 const source=fs.readFileSync(require.resolve('../src/calm.js'),'utf8'),notices=[],ctx={calmReady:true,calmRows:null,blocks:[{text:'Fictional wording'}],calmDesign:{},calmDesignAttempted:true,status:()=>{},calmFindDesign:async()=>{throw new Error('Synthetic render timeout');},calmDocumentFeedback:failed=>notices.push(failed),$:()=>({append:v=>notices.push(v)}),make:(_tag,_class,text)=>text};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function calmAssessDocument('),source.indexOf('function calmValidateSaved(')),ctx);await ctx.calmAssessDocument();assert.equal(ctx.calmDesign,null);assert.equal(ctx.calmDesignAttempted,false);assert.deepEqual(notices,[true,'Synthetic render timeout']);
 notices.length=0;ctx.calmRows=[{}];await ctx.calmAssessDocument();assert.deepEqual(notices,[false],'converted and restored text models do not assess their backing PDF');
});

test('PDF text-sharing guard rejects missing or false model, allows reviewed text model',()=>{for(const v of [undefined,null,false])assert.throws(()=>W.requireTextSharing(v),/hidden words/);assert.doesNotThrow(()=>W.requireTextSharing(true));});
