const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=import('../src/flow.mjs'),D=import('../src/design.mjs'),lib=require('pdf-lib'),canvas=require('@napi-rs/canvas');
const {unzipSync,strFromU8}=require('fflate');
global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;global.ImageData=canvas.ImageData;
const fonts=Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,new Uint8Array(fs.readFileSync(path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/LiberationSans-'+k+'.ttf')))]));
const rows=[['Private letter',110,10],['A clearer way forward',145,24],['Date: 19 September 2026',200,11],['Dear Example Reader,',235,11],['Thank you for taking the time to speak with us.',280,11],['Please contact our team to arrange a convenient time.',310,11],['Email: example@example.com',360,11],['Phone: 07700 900123',385,11],['We look forward to hearing from you.',440,11],['Kind regards,',485,11],['Example Team',510,11]];
const blocks=rows.map(([text,y,size],i)=>({id:'B'+String(i+1).padStart(4,'0'),text,fontSize:size,rect:{x:48,y,w:460,h:size}}));
test('source section spacing survives rewritten paragraphs and is bounded',async()=>{
 const d=await D,f=await F,design={header:[],footer:[]},spacing=d.pdfParagraphSpacing(blocks,design);
 assert.equal(spacing.B0001,0);assert(Math.abs(spacing.B0007-34.6)<.01);assert(Math.abs(spacing.B0008-9.6)<.01);
 const model=f.flowModel(blocks.map(b=>({text:b.text,spaceBefore:spacing[b.id],style:{size:b.fontSize}})));
 const reply=blocks.map(b=>({text:'Changed '+b.text,restored:'Changed '+b.text,styleFrom:b.id}));const output=f.flowReply(model,blocks,reply);
 assert.equal(output[6].spaceBefore,spacing.B0007);assert.equal(f.flowModel([{text:'x',spaceBefore:Infinity}])[0].spaceBefore,undefined);assert.equal(f.flowModel([{text:'x',spaceBefore:99999}])[0].spaceBefore,72);
 const lines=f.flowLines(output,(s,style)=>s.length*style.size*.5);assert.equal(lines.filter(l=>l.kind==='gap')[5].height,spacing.B0007);
 const xml=strFromU8(unzipSync(f.flowDOCX(output))['word/document.xml']);assert(xml.includes('w:before="692"'));assert(f.flowHTML(output).includes('margin:34.6'));
});
test('spacing expands naturally after wrapping and retained letterhead output remains paginated',async()=>{
 const d=await D,f=await F,c=canvas.createCanvas(595,842),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,595,842);ctx.fillStyle='#102536';ctx.fillRect(0,0,595,80);ctx.strokeStyle='#bbcbd0';ctx.beginPath();ctx.moveTo(48,735);ctx.lineTo(547,735);ctx.stroke();
 const design={width:595,height:842,left:48,right:48,top:110,bottom:715,header:[],footer:[],background:new Uint8Array(c.toBuffer('image/png'))},spacing=d.pdfParagraphSpacing(blocks,design);
 const model=f.flowModel(blocks.map(b=>({text:b.text,origin:b.id,spaceBefore:spacing[b.id],kind:b.fontSize>20?'h1':'p',style:{size:b.fontSize,bold:b.fontSize>20}})));
 const result=await d.designedPDF(model,design,lib,fonts);assert.equal(result.layout.pages.length,1);
 const runs=result.layout.pages[0],email=runs.find(r=>r.line.runs.some(x=>x.text==='Email:'));assert(email);const previous=runs[runs.indexOf(email)-1];assert.equal(previous.line.kind,'gap');assert(Math.abs(previous.line.height-34.6)<.01);
 const long=model.map((p,i)=>i===4?{...p,text:'A longer revised paragraph flows naturally into the available space. '.repeat(140),runs:undefined}:p);const longer=await d.designedPDF(long,design,lib,fonts);assert(longer.layout.pages.length>1);for(const page of longer.layout.pages)for(const row of page)assert(row.y+row.line.height<=design.bottom+.001);
 const out=path.join(__dirname,'../evidence/paragraph-spacing');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'synthetic-spacing.pdf'),result.bytes);
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await pdfjs.getDocument({data:result.bytes.slice(),useSystemFonts:false}).promise;try{const pg=await doc.getPage(1),view=pg.getViewport({scale:1.3}),im=canvas.createCanvas(Math.ceil(view.width),Math.ceil(view.height));await pg.render({canvasContext:im.getContext('2d'),viewport:view}).promise;fs.writeFileSync(path.join(out,'synthetic-spacing.png'),im.toBuffer('image/png'));}finally{await doc.destroy();}
});
