const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../src/workflow.js'),lib=require('pdf-lib'),canvas=require('@napi-rs/canvas'),{unzipSync,strFromU8}=require('fflate');
global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;global.ImageData=canvas.ImageData;
test('editing objective must contain visible instructions before primary copy',()=>{
 for(const value of ['', ' \n\t ', '\u200b\ufeff',null])assert.equal(W.hasEditingObjective(value),false);
 assert(W.hasEditingObjective('Improve clarity without changing facts.'));
 const source=fs.readFileSync(path.join(__dirname,'../src/calm.js'),'utf8'),handler=source.slice(source.indexOf("$('calmCopyPrompt').onclick"),source.indexOf("$('calmGoal').oninput"));
 assert(handler.indexOf('hasEditingObjective')<handler.indexOf('calmPrepare()'));assert(handler.includes("calmFocus('calmGoal');return;"));
});
test('early browser warning distinguishes Safari/iOS from desktop Chrome and Edge',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/shell.html'),'utf8');
 const source=html.slice(html.indexOf('function veilUnsupportedBrowser'),html.indexOf('(function(){'));
 const unsupported=Function(source+';return veilUnsupportedBrowser')();
 for(const ua of ['Version/18.0 Safari/605.1.15','iPhone CriOS/123 Mobile Safari/604','iPad FxiOS/123 Mobile'])assert(unsupported(ua,'',0));
 assert(unsupported('Version/18.0 Safari/605','MacIntel',5));
 for(const ua of ['Chrome/140.0 Safari/537.36','Chrome/140.0 Safari/537.36 Edg/140.0','Firefox/140.0'])assert.equal(unsupported(ua,'Win32',0),false);
 assert(html.indexOf('browserWarning')<html.indexOf('startupNotice'));
});
test('body style comes from words, not a larger bullet or bold prefix; lists wrap with hanging indent',async()=>{
 const F=await import('../src/flow.mjs'),D=await import('../src/text-design.mjs');
 const regular={size:10.5,color:'#17212b'},bold={...regular,bold:true};
 const rows=[
  {id:'B0001',text:'Fictional CV',textRuns:[{text:'Fictional CV',style:{size:23,bold:true}}]},
  {id:'B0002',text:'Skills: Clear writing and thoughtful delivery.',textRuns:[{text:'Skills: ',style:bold},{text:'Clear writing and thoughtful delivery.',style:regular}],lineAdvance:12.6},
  {id:'B0003',text:'•',textRuns:[{text:'•',style:{size:12}}]},
  {id:'B0004',text:'A fictional achievement with enough explanation to wrap naturally.',textRuns:[{text:'A fictional achievement with enough explanation to wrap naturally.',style:regular}]}
 ];
 const design={groups:{B0001:'B0001',B0002:'B0002',B0003:'B0003',B0004:'B0003'},paragraphs:{},groupIndexes:{B0001:0,B0002:0,B0003:0,B0004:1},joiners:{B0004:' '},ruleOrigins:[]};
 const model=D.pdfFlowModel(rows,design);assert.equal(model[0].kind,'h1');assert.equal(model[1].kind,'p');assert.equal(model[1].style.bold,false);assert.equal(model[1].runs[0].style.bold,true);assert.equal(model[2].style.size,10.5);assert.equal(model[2].lineHeight,1.2);
 const revised=F.flowReply(model,rows,[{text:'Fictional CV',restored:'Fictional CV'},{text:'Skills: Better writing and thoughtful delivery.',restored:'Skills: Better writing and thoughtful delivery.',styleFrom:'B0002'},{text:'• '+('A useful fictional achievement. '.repeat(15)),restored:'• '+('A useful fictional achievement. '.repeat(15)),styleFrom:'B0003'}]);
 assert.equal(revised[1].style.bold,false);assert(revised[1].runs[0].style.bold);assert(revised[1].runs.some(r=>!r.style.bold));assert.equal(revised[1].runs.map(r=>r.text).join(''),revised[1].text);assert.equal(revised[2].style.size,10.5);assert.equal(revised[2].kind,'li');
 const lines=F.flowLines([revised[2]],(s,style)=>s.length*style.size*.5,160).filter(l=>l.kind!=='gap');assert(lines.length>1);assert.equal(lines[0].runs[0].text,'•');assert.equal(lines.flatMap(l=>l.runs).filter(r=>r.text==='•').length,1);assert(lines.slice(1).every(l=>l.runs[0].x===14));
 const xml=strFromU8(unzipSync(F.flowDOCX(revised))['word/document.xml']);assert(xml.includes('w:hanging="280"'));assert(xml.includes('w:line="288"'));assert(xml.includes('<w:tab/>'));assert.equal(xml.split('•').length-1,1);
 const html=F.flowHTML(revised);assert(html.includes('padding-left:14pt'));assert(html.includes('line-height:1.2'));assert.equal(html.split('•').length-1,1);
 const fonts=Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,new Uint8Array(fs.readFileSync(path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/LiberationSans-'+k+'.ttf')))]));
 const pdf=await F.flowPDF(revised,lib,fonts),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await pdfjs.getDocument({data:pdf.slice(),useSystemFonts:false}).promise;
 const out=path.join(__dirname,'../evidence/objective-browser-format');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'synthetic-format.pdf'),pdf);fs.writeFileSync(path.join(out,'synthetic-format.docx'),F.flowDOCX(revised));
 try{const pg=await doc.getPage(1),view=pg.getViewport({scale:1.4}),c=canvas.createCanvas(Math.ceil(view.width),Math.ceil(view.height));await pg.render({canvasContext:c.getContext('2d'),viewport:view}).promise;fs.writeFileSync(path.join(out,'synthetic-format.png'),c.toBuffer('image/png'));const text=(await pg.getTextContent()).items.map(i=>i.str).join('');assert(text.includes('Fictional CV'));assert.equal(text.split('•').length-1,1);}finally{await doc.destroy();}
});
