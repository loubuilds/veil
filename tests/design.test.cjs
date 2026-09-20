const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const canvas=require('@napi-rs/canvas');
global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;global.ImageData=canvas.ImageData;
const lib=require('pdf-lib'),{unzipSync,strFromU8}=require('fflate');
const design=import('../src/design.mjs'),flow=import('../src/flow.mjs');
const directory=path.join(__dirname,'../evidence/page-design');
const fonts=Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,new Uint8Array(fs.readFileSync(path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/LiberationSans-'+k+'.ttf')))]));
async function fixture(bodyArtwork=false){
 const p=await lib.PDFDocument.create(),regular=await p.embedFont(lib.StandardFonts.Helvetica),bold=await p.embedFont(lib.StandardFonts.HelveticaBold),page=p.addPage([595.28,841.89]);
 page.drawRectangle({x:0,y:758,width:595.28,height:84,color:lib.rgb(.063,.145,.212)});
 page.drawText('SYNTHETIC LETTERHEAD',{x:48,y:790,size:16,font:bold,color:lib.rgb(.8,.93,.91)});
 const rows=[['Private letter',720,10],['Original heading',680,24],['ORIGINAL BODY MUST NOT SURVIVE',630,11],['Regards',210,11],['SAMPLE FOOTER',76,9]];
 for(const [text,y,size]of rows)page.drawText(text,{x:48,y,size,font:size===24?bold:regular});
 page.drawLine({start:{x:48,y:100},end:{x:547,y:100},thickness:1,color:lib.rgb(.8,.85,.88)});
 if(bodyArtwork)page.drawRectangle({x:100,y:400,width:40,height:40,color:lib.rgb(.5,.2,.2)});
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const bytes=await p.save(),task=pdfjs.getDocument({data:bytes,standardFontDataUrl:path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts').replace(/\\/g,'/')+'/',useSystemFonts:false,isEvalSupported:false});
 const doc=await task.promise,pg=await doc.getPage(1),content=await pg.getTextContent(),ops=await pg.getOperatorList(),D=await design,colors=D.operatorTextColors(ops,pdfjs.OPS);
 const blocks=content.items.filter(i=>i.str).map((i,n)=>{const size=Math.hypot(i.transform[2],i.transform[3]);return {id:'B'+String(n+1).padStart(4,'0'),text:i.str,page:1,locked:false,fontSize:size,rect:{x:i.transform[4],y:841.89-i.transform[5]-size*.8,w:i.width,h:size},color:colors.get(i.fontName+'\0'+i.str)};});
 return {doc,pg,blocks,pdfjs};
}
test('real PDF graphics-only extraction preserves letterhead with no old body; longer body paginates',async()=>{
 const D=await design,F=await flow,{doc,pg,blocks,pdfjs}=await fixture();fs.mkdirSync(directory,{recursive:true});
 try{
 const theme=await D.extractPageDesign(pg,blocks,pdfjs.OPS,canvas.createCanvas);assert(theme);assert(theme.header.length);assert(theme.footer.length);
 fs.writeFileSync(path.join(directory,'graphics-only.png'),theme.background);
 const image=await canvas.loadImage(theme.background),check=canvas.createCanvas(image.width,image.height);check.getContext('2d').drawImage(image,0,0);assert.equal(D.hasBodyArtwork(check.getContext('2d').getImageData(0,0,check.width,check.height).data,check.width,check.height,theme),false);
 const cyan=blocks.find(b=>b.text==='SYNTHETIC LETTERHEAD');assert.notEqual(cyan.color,'#000000');
 const model=F.flowModel(blocks.map(b=>({text:b.text,origin:b.id,kind:b.fontSize>=20?'h1':'p',style:{size:b.fontSize,bold:b.fontSize>=16,color:b.color}})));
 const expanded=model.map(p=>p.text==='ORIGINAL BODY MUST NOT SURVIVE'?{...p,text:'Updated content grows naturally. '.repeat(250),runs:undefined}:p);
 const result=await D.designedPDF(expanded,theme,lib,fonts);assert(result.layout.pages.length>1);assert(result.layout.pages.length<10);
 fs.writeFileSync(path.join(directory,'retained-design.pdf'),result.bytes);
 const updated=await pdfjs.getDocument({data:result.bytes.slice(),useSystemFonts:false}).promise;
 try{let all='';for(let i=1;i<=updated.numPages;i++){const page=await updated.getPage(i);all+=(await page.getTextContent()).items.map(x=>x.str).join(' ');}assert(!all.includes('ORIGINAL BODY MUST NOT SURVIVE'));assert.equal(all.split('SYNTHETIC LETTERHEAD').length-1,updated.numPages);
 const page=await updated.getPage(1),view=page.getViewport({scale:1.5}),c=canvas.createCanvas(Math.ceil(view.width),Math.ceil(view.height));await page.render({canvasContext:c.getContext('2d'),viewport:view}).promise;fs.writeFileSync(path.join(directory,'retained-first.png'),c.toBuffer('image/png'));
 const crop=(y,h)=>{const out=canvas.createCanvas(c.width,h);out.getContext('2d').drawImage(c,0,y,c.width,h,0,0,c.width,h);return new Uint8Array(out.toBuffer('image/png'));};
 const top=Math.floor(result.layout.top*1.5),bottom=Math.ceil(result.layout.bottom*1.5),word=D.designedDOCX(result.layout.body,theme,result.layout,crop(0,top),crop(bottom,c.height-bottom));
 const parts=unzipSync(word),xml=strFromU8(parts['word/document.xml']);assert(parts['word/media/header.png']);assert(parts['word/media/footer.png']);assert(xml.includes('Updated content grows naturally'));assert(!xml.includes('SYNTHETIC LETTERHEAD'));assert(!xml.includes('ORIGINAL BODY MUST NOT SURVIVE'));assert(xml.includes('headerReference'));fs.writeFileSync(path.join(directory,'retained-design.docx'),word);
 }finally{await updated.destroy();}
 }finally{await doc.destroy();}
});
test('body artwork and columns reject layout preservation instead of overlapping edits',async()=>{
 const D=await design,{doc,pg,blocks,pdfjs}=await fixture(true);
 try{assert.equal(await D.extractPageDesign(pg,blocks,pdfjs.OPS,canvas.createCanvas),null);const copy=structuredClone(blocks);copy.push({...copy[2],id:'B0900',rect:{...copy[2].rect,x:350,w:150}});assert.equal(D.designGeometry(595.28,841.89,copy),null);}finally{await doc.destroy();}
});
