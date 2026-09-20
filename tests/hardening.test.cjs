const test=require('node:test');const assert=require('node:assert/strict');const C=require('../src/core.js');
test('identifier detection preserves prose and protects only labelled code values',()=>{
 for(const s of ['Please refer to the account team.','The ID card and the account were checked.','The account is active.','Keep all references.','An account of our work.'])assert.equal(C.detect(s).filter(x=>x.type==='ID').length,0,s);
 for(const [s,value] of [['Our reference is QX-0042 and my direct line','QX-0042'],['Reference: QX-0042','QX-0042'],['Employee number: EMP-31','EMP-31'],['Ref. #99-0012','99-0012'],['patient no. ab12','ab12'],['Reference is HM-\nSENTINEL-19. Please call.','HM-\nSENTINEL-19']])assert.deepEqual(C.detect(s).filter(x=>x.reason==='Identifier-labelled value').map(x=>s.slice(x.start,x.end)),[value]);
});
test('compound names are covered without leaving hyphen fragments',()=>{
 for(const name of ['Marisol Quintrell-Sentinel','Lorcan Thistlewood-Sentinel','Anne-Marie Smith'])assert(C.detect(name).some(x=>x.type==='NAME'&&x.start===0&&x.end===name.length),name);
 assert(!C.detect('well-known Person').some(x=>x.type==='NAME'));
});

test('position-aware glyph matching resolves real Chromium items without substring guessing',async()=>{
 const fs=require('node:fs'),path=require('node:path'),canvas=require('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,Path2D:canvas.Path2D,ImageData:canvas.ImageData});
 const P=await import('pdfjs-dist/legacy/build/pdf.mjs'),G=await import('../src/glyphs.mjs');
 for(const name of ['chromium-letter.pdf','letter.pdf','cv.pdf']){
 const doc=await P.getDocument({data:new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures/hardening',name))),useSystemFonts:false,standardFontDataUrl:path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/').replaceAll('\\','/')}).promise;
 try{for(let n=1;n<=doc.numPages;n++){
 const page=await doc.getPage(n),content=await page.getTextContent(),ops=await page.getOperatorList(),m=G.positionedGlyphs(ops,P.OPS,id=>page.commonObjs.get(id));
 for(const item of content.items.filter(x=>x.str?.trim())){const spans=m.resolve(item);assert(spans,`${name}: unresolved ${item.str}`);assert.equal(spans.length,item.str.length);assert(spans.every(r=>Number.isFinite(r.start)&&r.end>r.start));assert.equal(m.resolve({...item,transform:[...item.transform.slice(0,4),item.transform[4]+5,item.transform[5]]}),null,'wrong location cannot borrow same text metrics');}
 }}finally{await doc.destroy();}
 }
});
