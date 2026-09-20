const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const canvas=require('@napi-rs/canvas'),lib=require('pdf-lib'),{unzipSync,strFromU8}=require('fflate');
global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;global.ImageData=canvas.ImageData;
const D=import('../src/text-design.mjs'),F=import('../src/flow.mjs');
const directory=path.join(__dirname,'../evidence/multipage-flow');
const fontPath=path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts');
const fonts=Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,new Uint8Array(fs.readFileSync(path.join(fontPath,'LiberationSans-'+k+'.ttf')))]));
async function fixture(artwork=false){
 const pdf=await lib.PDFDocument.create(),font=await pdf.embedFont(lib.StandardFonts.Helvetica),bold=await pdf.embedFont(lib.StandardFonts.HelveticaBold),blocks=[];
 for(let number=1;number<=2;number++){
  const page=pdf.addPage([595.28,841.89]);let y=790;
  const row=(text,size=10,isBold=false)=>{page.drawText(text,{x:48,y,size,font:isBold?bold:font});blocks.push({id:'B'+String(blocks.length+1).padStart(4,'0'),page:number,text,fontSize:size,textStyle:{bold:isBold,color:'#000000'},rect:{x:48,y:841.89-y-size*.8,w:(isBold?bold:font).widthOfTextAtSize(text,size),h:size},locked:false});y-=size*1.4+8;};
  if(number===1){row('Alex Example',23,true);row('FICTIONAL CV | example@example.com',9);}
  for(let section=0;section<3;section++){
   row('Section '+number+'.'+section,12,true);
   page.drawLine({start:{x:48,y:y+9},end:{x:547,y:y+9},thickness:.6,color:lib.rgb(.2,.3,.4)});y-=8;
   row('Original experience paragraph to be rewritten.',10);
   row('A second paragraph describes fictional achievements.',10);y-=24;
  }
  if(artwork)page.drawRectangle({x:400,y:90,width:60,height:40,color:lib.rgb(.1,.3,.6)});
 }
 const bytes=await pdf.save(),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const doc=await pdfjs.getDocument({data:bytes.slice(),standardFontDataUrl:fontPath.replace(/\\/g,'/')+'/',useSystemFonts:false,isEvalSupported:false}).promise;
 return {doc,blocks,pdfjs,bytes};
}
test('two-page text PDF retains moving rules and spacing in PDF and editable Word',async()=>{
 const d=await D,f=await F,{doc,blocks,pdfjs,bytes}=await fixture();fs.mkdirSync(directory,{recursive:true});
 try{
  const design=await d.extractTextDesign(doc,blocks,pdfjs.OPS,canvas.createCanvas);assert(design);assert.equal(design.ruleOrigins.length,6);assert.equal(design.paragraphs[blocks.find(b=>b.page===2).id].spaceBefore,10);
  const model=f.flowModel(blocks.map(b=>({text:b.text,...design.paragraphs[b.id],kind:b.textStyle.bold?'h2':'p',style:{size:b.fontSize,...b.textStyle}})));
  const reply=blocks.map(b=>({text:b.text,restored:b.text,styleFrom:b.id}));
  const output=f.flowReply(model,blocks,reply);assert.equal(output.filter(p=>p.ruleAfter||p.ruleBefore).length,6);
  const short=await d.textDesignedPDF(output,design,lib,fonts),shortDoc=await lib.PDFDocument.load(short.bytes);assert.equal(shortDoc.getPageCount(),1,'source page breaks are not forced');
  const long=f.flowReply(model,blocks,reply.map(b=>({...b,text:b.text.startsWith('Original')?'Revised experience. '.repeat(180):b.text,restored:b.text.startsWith('Original')?'Revised experience. '.repeat(180):b.text})));
  const result=await d.textDesignedPDF(long,design,lib,fonts),updated=await pdfjs.getDocument({data:result.bytes.slice(),useSystemFonts:false}).promise;
  try{
   assert(updated.numPages>2);let all='',rules=0;
   for(let i=1;i<=updated.numPages;i++){
    const pg=await updated.getPage(i),content=await pg.getTextContent();all+=content.items.map(x=>x.str).join(' ');assert(content.items.some(x=>x.str),'no blank output pages');
    for(const item of content.items.filter(x=>x.str)){assert(item.transform[5]>35);assert(item.transform[5]<810);}
    const operators=await pg.getOperatorList(),skip=new Set([pdfjs.OPS.showText]);
    const view=pg.getViewport({scale:1.5}),c=canvas.createCanvas(Math.ceil(view.width),Math.ceil(view.height));
    await pg.render({canvasContext:c.getContext('2d'),viewport:view,operationsFilter:j=>!skip.has(operators.fnArray[j])}).promise;
    const found=d.horizontalRules(c.getContext('2d').getImageData(0,0,c.width,c.height).data,c.width,c.height,1.5);assert(found);rules+=found.length;
    if(i===1){await pg.render({canvasContext:c.getContext('2d'),viewport:view}).promise;fs.writeFileSync(path.join(directory,'synthetic-expanded-first.png'),c.toBuffer('image/png'));}
   }
   assert.equal(rules,6);assert(!all.includes('Original experience'));assert(all.includes('Revised experience'));
  }finally{await updated.destroy();}
  const word=d.textDesignedDOCX(long,design),xml=strFromU8(unzipSync(word)['word/document.xml']);assert.equal((xml.match(/<w:pBdr>/g)||[]).length,6);assert(xml.includes('Revised experience'));assert(!xml.includes('Original experience'));assert(!xml.includes('w:br w:type="page"'));
  fs.writeFileSync(path.join(directory,'synthetic-source.pdf'),bytes);fs.writeFileSync(path.join(directory,'synthetic-expanded.pdf'),result.bytes);fs.writeFileSync(path.join(directory,'synthetic-short.pdf'),short.bytes);fs.writeFileSync(path.join(directory,'synthetic-expanded.docx'),word);
  assert.throws(()=>d.checkTextDesign(output.filter(p=>p.origin!==design.ruleOrigins[0]),design),/divider/);
  assert.throws(()=>d.checkTextDesign([...output,output.find(p=>p.origin===design.ruleOrigins[0])],design),/divider/);
 }finally{await doc.destroy();}
});
test('complex body artwork and parallel text regions retain explicit fallback',async()=>{
 const d=await D,{doc,blocks,pdfjs}=await fixture(true);try{assert.equal(await d.extractTextDesign(doc,blocks,pdfjs.OPS,canvas.createCanvas),null);}finally{await doc.destroy();}
 const b={id:'B0001',text:'Fictional column',rect:{x:48,y:100,w:180,h:12},fontSize:12};assert.equal(d.textPageGeometry(595,842,[b,{...b,id:'B0002',rect:{...b.rect,x:330}}]),null);
 const c=canvas.createCanvas(600,800),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,800);ctx.fillStyle='black';ctx.fillRect(48,100,500,1);ctx.fillRect(48,100,1,50);assert.equal(d.horizontalRules(ctx.getImageData(0,0,600,800).data,600,800,1),null);
});
test('long heading chains paginate naturally and a following divider stays with its paragraph',async()=>{
 const f=await F,g={width:595,height:350,left:48,right:48,top:24,bottom:308};
 const headings=Array.from({length:40},(_,i)=>({text:'Heading '+i,kind:'h2',spaceBefore:0,style:{size:12}}));
 const bytes=await f.flowPDF(headings,lib,fonts,g),doc=await lib.PDFDocument.load(bytes);assert(doc.getPageCount()<=4);
 // 19 lines at 14pt consume 266pt. The last text/rule pair needs 22pt and moves together.
 const model=Array.from({length:20},(_,i)=>({text:'Row '+i,spaceBefore:0,style:{size:10},...(i===19?{ruleAfter:{color:'#000000',fraction:1,thickness:1}}:{})}));
 const result=await f.flowPDF(model,lib,fonts,g),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),parsed=await pdfjs.getDocument({data:result.slice(),useSystemFonts:false}).promise;
 try{assert.equal(parsed.numPages,2);const last=await parsed.getPage(2),text=(await last.getTextContent()).items.map(x=>x.str).join(' ');assert(text.includes('Row 19'));}
 finally{await parsed.destroy();}
});
test('real extraction keeps redaction locks but reflows split lines, date labels and disjoint underlines',async()=>{
 const f=await F,d=await D,pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),vm=require('node:vm');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),context={pdfjs,union:rs=>{const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return {x,y,w:Math.max(...rs.map(r=>r.x+r.w))-x,h:Math.max(...rs.map(r=>r.y+r.h))-y};}};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('  function glyphMetrics('),app.indexOf('  function applyDetection(')),context);
 const pdf=await lib.PDFDocument.create(),font=await pdf.embedFont(lib.StandardFonts.Helvetica);
 for(let i=0;i<2;i++){
  const p=pdf.addPage([595.28,841.89]);
  p.drawText('Fictional role '+i,{x:48,y:770,size:11,font});p.drawText('Jan 2020 to Jun 2024',{x:450,y:770,size:9,font});
  p.drawText('An ordinary underlined paragraph about examples.',{x:48,y:720,size:10,font});
  p.drawLine({start:{x:65,y:719},end:{x:112,y:719},thickness:.5});p.drawLine({start:{x:150,y:719},end:{x:199,y:719},thickness:.5});
  p.drawText('Section '+i,{x:48,y:670,size:12,font});p.drawLine({start:{x:48,y:660},end:{x:547,y:660},thickness:.6});
  p.drawText('Detailed fictional body text.',{x:48,y:640,size:10,font});
 }
 const doc=await pdfjs.getDocument({data:await pdf.save(),standardFontDataUrl:fontPath.replace(/\\/g,'/')+'/',useSystemFonts:false}).promise;
 try{
  const blocks=[];for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);blocks.push(...context.extractBlocks(await p.getTextContent(),p.getViewport({scale:1}),n,blocks.length,new Map()));}
  assert(blocks.every(b=>b.locked),'missing glyph metrics still locks partial redaction');assert(blocks.every(b=>b.reflowSafe));assert(blocks.every(b=>b.textRuns.map(r=>r.text).join('')===b.text));
  const design=await d.extractTextDesign(doc,blocks,pdfjs.OPS,canvas.createCanvas);assert(design);assert.equal(design.ruleOrigins.length,2,'inline underlines are not misclassified as section dividers');
  const model=f.flowModel(blocks.map(b=>({text:b.text,origin:b.id,style:{size:b.fontSize},...design.paragraphs[b.id]}))),joined=d.checkTextDesign(model,design);
  assert(joined.some(p=>p.text.includes('Fictional role 0 Jan 2020 to Jun 2024')));
  assert.deepEqual(d.checkTextDesign(joined,design),joined,'grouping is idempotent');
  const result=await d.textDesignedPDF(model,design,lib,fonts);assert((await lib.PDFDocument.load(result.bytes)).getPageCount()>0);
  const rotated=structuredClone(blocks);rotated[0].reflowSafe=false;assert.equal(await d.extractTextDesign(doc,rotated,pdfjs.OPS,canvas.createCanvas),null);
 }finally{await doc.destroy();}
 const group={ruleOrigins:[],groups:{B0001:'B0001',B0002:'B0001'},groupIndexes:{B0001:0,B0002:1},joiners:{B0002:''}};
 assert.equal(d.checkTextDesign([{text:'Micro',origin:'B0001'},{text:'scope',origin:'B0002'}],group)[0].text,'Microscope');
 assert.equal(d.checkTextDesign([{text:'Second',origin:'B0002'},{text:'First',origin:'B0001'}],group).length,2);
 assert.equal(d.checkTextDesign([{text:'First',origin:'B0001'},{text:'Again',origin:'B0001'}],group).length,2);
});
