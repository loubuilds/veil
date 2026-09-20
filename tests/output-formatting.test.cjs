const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const canvas=require('@napi-rs/canvas'),lib=require('pdf-lib'),{unzipSync,strFromU8}=require('fflate');
Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,Path2D:canvas.Path2D,ImageData:canvas.ImageData});
const root=path.join(__dirname,'..'),out=path.join(root,'evidence/output-formatting');
test('unsupported page layout retains text styles and real symbol bullets through AI exports',async()=>{
 const P=await import('pdfjs-dist/legacy/build/pdf.mjs'),F={...await import('../src/flow.mjs'),...await import('../src/design.mjs'),...await import('../src/text-design.mjs'),...await import('../src/glyphs.mjs')};
 const pdf=await lib.PDFDocument.create(),page=pdf.addPage([595,842]);
 const regular=await pdf.embedFont(lib.StandardFonts.Helvetica),bold=await pdf.embedFont(lib.StandardFonts.HelveticaBold),symbols=await pdf.embedFont(lib.StandardFonts.ZapfDingbats);
 page.drawText('Fictional profile',{x:48,y:790,size:22,font:bold,color:lib.rgb(.12,.22,.4)});
 page.drawText('Skills: ',{x:48,y:750,size:10,font:bold});page.drawText('Clear writing and reliable delivery.',{x:48+bold.widthOfTextAtSize('Skills: ',10),y:750,size:10,font:regular});
 page.drawText('Column one',{x:48,y:700,size:10,font:regular});page.drawText('Column two',{x:320,y:700,size:10,font:regular});
 for(let i=0;i<2;i++){const bullet=()=>page.drawText('■',{x:48,y:650-i*24,size:6,font:symbols}),body=()=>page.drawText('Fictional list item '+i+'.',{x:i===0?53:58,y:647-i*24,size:10,font:regular});if(i===0){bullet();body();}else{body();bullet();}}
 page.drawText('n',{x:48,y:570,size:10,font:regular});
 const bytes=await pdf.save(),doc=await P.getDocument({data:bytes.slice(),useSystemFonts:false,standardFontDataUrl:path.join(root,'node_modules/pdfjs-dist/standard_fonts/').replaceAll('\\','/')}).promise;
 try{
  const pg=await doc.getPage(1),content=await pg.getTextContent(),ops=await pg.getOperatorList(),fontStyles={};
  for(const i of content.items)if(i.fontName)fontStyles[i.fontName]=F.pdfTextStyle(pg.commonObjs.get(i.fontName)?.name,content.styles[i.fontName]?.fontFamily);
  const context={pdfjs:P,F,union:rs=>{const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return{x,y,w:Math.max(...rs.map(r=>r.x+r.w))-x,h:Math.max(...rs.map(r=>r.y+r.h))-y};}};
  vm.createContext(context);const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');vm.runInContext(app.slice(app.indexOf('  function glyphMetrics('),app.indexOf('  function applyDetection(')),context);
  const blocks=context.extractBlocks(content,pg.getViewport({scale:1}),1,0,context.glyphMetrics(ops,pg),fontStyles,F.operatorTextColors(ops,P.OPS));
  assert(blocks.every(b=>b.text.length===b.chars.length&&b.textRuns.map(r=>r.text).join('')===b.text));
  assert.equal(blocks.filter(b=>b.text.startsWith('■')).length,2,JSON.stringify({blocks:blocks.map(b=>b.text),fonts:Object.keys(fontStyles).map(n=>pg.commonObjs.get(n).name)}));assert(blocks.some(b=>b.text==='n'),'ordinary letters must not be converted');
  assert.equal(await F.extractTextDesign(doc,blocks,P.OPS,canvas.createCanvas),null,'parallel columns still require explicit fallback');
  const calm=fs.readFileSync(path.join(root,'src/calm.js'),'utf8');Object.assign(context,{blocks,calmModel:null,calmDesign:null,calmTextOnly:false});
  vm.runInContext(calm.slice(calm.indexOf('function calmEnsureModel('),calm.indexOf('async function calmFindDesign(')),context);
  const model=context.calmEnsureModel(),lead=model.find(p=>p.text.startsWith('Skills:'));
  assert.equal(lead.style.bold,false);assert(lead.runs[0].style.bold);assert(lead.runs.some(r=>!r.style.bold));assert.equal(model[0].style.color,'#1f3866');assert.equal(model.filter(p=>p.kind==='li').length,2);
  Object.assign(context,{calmTextOnly:true,calmDesign:{kind:'text-flow',paragraphs:{[blocks[0].id]:{ruleAfter:{color:'#000000',thickness:1,fraction:1}}}}});
  assert.equal(context.calmEnsureModel()[0].style.color,model[0].style.color);assert(!context.calmEnsureModel()[0].ruleAfter,'explicit fallback removes layout rules');
  const reply=blocks.map(b=>({text:b.text,restored:b.text,styleFrom:b.id}));const at=blocks.findIndex(b=>b.text.startsWith('Skills:'));reply[at]={text:'Skills: Thoughtful editing and dependable delivery.',restored:'Skills: Thoughtful editing and dependable delivery.',styleFrom:blocks[at].id};
  const result=F.flowReply(model,blocks,reply),xml=strFromU8(unzipSync(F.flowDOCX(result))['word/document.xml']);assert(xml.includes('w:color w:val="1f3866"'));assert.equal((xml.match(/w:hanging="280"/g)||[]).length,2);assert(result[at].runs.some(r=>r.style.bold)&&result[at].runs.some(r=>!r.style.bold));
  const fonts=Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,new Uint8Array(fs.readFileSync(path.join(root,'node_modules/pdfjs-dist/standard_fonts/LiberationSans-'+k+'.ttf')))]));
  const output=await F.flowPDF(result,lib,fonts);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'synthetic-source.pdf'),bytes);fs.writeFileSync(path.join(out,'synthetic-output.pdf'),output);fs.writeFileSync(path.join(out,'synthetic-output.docx'),F.flowDOCX(result));
  const rendered=await P.getDocument({data:output.slice(),useSystemFonts:false}).promise;try{const p=await rendered.getPage(1),v=p.getViewport({scale:1.4}),c=canvas.createCanvas(Math.ceil(v.width),Math.ceil(v.height));await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;fs.writeFileSync(path.join(out,'synthetic-output.png'),c.toBuffer('image/png'));assert.equal((await p.getTextContent()).items.map(i=>i.str).join('').split('•').length-1,2);}finally{await rendered.destroy();}
 }finally{await doc.destroy();}
});

test('text fallback keeps dark accents but makes pale runs readable without their background',async()=>{
 const D=await import('../src/text-design.mjs');
 const blocks=[{id:'B0001',text:'Light and dark',textRuns:[{text:'Light ',style:{color:'#ffffff',size:20,bold:true}},{text:'and dark',style:{color:'#1f3864',size:20,bold:true}}]}];
 const fallback=D.pdfFlowModel(blocks,{paragraphs:{},readableOnWhite:true});assert.equal(fallback[0].runs[0].style.color,'#17212b');assert.equal(fallback[0].runs[1].style.color,'#1f3864');
 assert.equal(D.pdfFlowModel(blocks,{paragraphs:{}})[0].runs[0].style.color,'#ffffff');
});
