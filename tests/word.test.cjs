const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {zipSync,unzipSync,strToU8,strFromU8}=require('fflate');
const {createCanvas}=require('@napi-rs/canvas');
const W=import('../src/word.mjs');
const ns='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const rel=(id,type,target,extra='')=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" ${extra}/>`;
const p=t=>`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="008080"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
function fixture(){const c=createCanvas(120,30);c.getContext('2d').fillRect(0,0,120,30);return {
 '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
 'word/document.xml':strToU8(`<w:document ${ns}><w:body>${p('Old heading')}<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1000" cy="300"/><wp:docPr id="1" name="PRIVATE IMAGE NAME" descr="PRIVATE ALT"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="image1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc>${p('Old cell')}</w:tc></w:tr></w:tbl><w:sectPr><w:headerReference w:type="default" r:id="head"/><w:footerReference w:type="default" r:id="foot"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`),
 'word/_rels/document.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rel('image1','image','media/logo.png')+rel('head','header','header1.xml')+rel('foot','footer','footer1.xml')+rel('styles','styles','styles.xml')+'</Relationships>'),
 'word/header1.xml':strToU8(`<w:hdr ${ns}>${p('Old header')}</w:hdr>`),
 'word/footer1.xml':strToU8(`<w:ftr ${ns}>${p('Old footer')}</w:ftr>`),
 'word/styles.xml':strToU8(`<w:styles ${ns}><w:latentStyles/><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`),
 'word/media/logo.png':new Uint8Array(c.toBuffer('image/png')),
 'docProps/core.xml':strToU8('<author>PRIVATE AUTHOR</author>'),
 'word/comments.xml':strToU8('<comments>PRIVATE COMMENT</comments>'),
 };}
test('Word retains structure, picture, styles and margins while replacing all reviewed text',async()=>{
 const w=await W,original=fixture(),prepared=w.prepareWordTemplate(zipSync(original));assert.equal(prepared.slots.length,4);assert.equal(prepared.images.length,1);
 const result=w.exportWordTemplate(prepared.bytes,prepared.slots.map(s=>({origin:s.id,text:'Updated '+s.id+' with longer text that can flow normally.'}))),out=unzipSync(result);
 assert(out['word/styles.xml']);assert(out['word/media/logo.png']);assert(!out['docProps/core.xml']);assert(!out['word/comments.xml']);
 const xml=Object.entries(out).filter(([n])=>n.endsWith('.xml')).map(([,b])=>strFromU8(b)).join('');assert(!xml.includes('PRIVATE'));assert(!xml.includes('Old '));assert(xml.includes('<w:tbl>'));assert(xml.includes('w:headerReference'));assert(xml.includes('008080'));assert(xml.includes('Updated P0004'));
 const twice=w.prepareWordTemplate(prepared.bytes);assert.deepEqual(twice.slots,prepared.slots);
 const evidence=path.join(__dirname,'../evidence/word-design');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'synthetic-preserved.docx'),result);
});
test('Word rejects ambiguous AI structure and removes excluded picture bytes and references',async()=>{
 const w=await W,t=w.prepareWordTemplate(zipSync(fixture())),rows=t.slots.map(s=>({origin:s.id,text:s.text}));
 assert.throws(()=>w.exportWordTemplate(t.bytes,rows.slice(1)),/structure/);assert.throws(()=>w.exportWordTemplate(t.bytes,[...rows].reverse()),/structure/);assert.throws(()=>w.exportWordTemplate(t.bytes,rows.map(r=>({...r,origin:'P0001'}))),/structure/);
 const out=unzipSync(w.exportWordTemplate(t.bytes,rows,[t.images[0].name]));assert(!out[t.images[0].name]);assert(!strFromU8(out['word/document.xml']).includes('w:drawing'));assert(!strFromU8(out['word/_rels/document.xml.rels']).includes('image1'));
});
test('Word rejects hidden text, tracked changes, floating objects, fields and external images',async()=>{
 const w=await W;for(const fragment of ['<w:vanish/>','<w:ins/>','<w:fldChar/>','<wp:anchor/>','<w:hyperlink/>','<w:txbxContent/>','<w:styles><w:body><w:p><w:r><w:t>Hidden extra text</w:t></w:r></w:p></w:body></w:styles>']){const f=fixture();f['word/document.xml']=strToU8(strFromU8(f['word/document.xml']).replace('<w:body>','<w:body>'+fragment));assert.throws(()=>w.prepareWordTemplate(zipSync(f)));}
 const f=fixture();f['word/_rels/document.xml.rels']=strToU8(strFromU8(f['word/_rels/document.xml.rels']).replace('Target="media/logo.png"','Target="https://example.invalid/logo.png" TargetMode="External"'));assert.throws(()=>w.prepareWordTemplate(zipSync(f)),/External/);
 const bad=fixture();bad['word/document.xml']=strToU8(strFromU8(bad['word/document.xml']).replace('http://schemas.openxmlformats.org/wordprocessingml/2006/main','urn:fake'));assert.throws(()=>w.prepareWordTemplate(zipSync(bad)),/namespace/);
});
test('image metadata is stripped and unbounded/active image formats reject',async()=>{
 const w=await W,png=fixture()['word/media/logo.png'];const text=strToU8('PRIVATE METADATA'),chunk=new Uint8Array(text.length+12);new DataView(chunk.buffer).setUint32(0,text.length);chunk.set(strToU8('tEXt'),4);chunk.set(text,8);const injected=new Uint8Array(png.length+chunk.length);injected.set(png.slice(0,33));injected.set(chunk,33);injected.set(png.slice(33),33+chunk.length);assert(!strFromU8(w.cleanWordImage(injected)).includes('PRIVATE'));
 assert.throws(()=>w.cleanWordImage(strToU8('<svg>active content here</svg>')));const huge=png.slice();new DataView(huge.buffer).setUint32(16,1000000);assert.throws(()=>w.cleanWordImage(huge),/size/);
});

test('Word source references take precedence over coincidentally matching another paragraph',async()=>{
 const w=await W,model=[{text:'One',style:{bold:true},runs:[{text:'One',style:{bold:true}}]},{text:'Two',style:{bold:false},runs:[{text:'Two',style:{bold:false}}]}],reply=[{styleFrom:'P0001',restored:'Two'},{styleFrom:'P0002',restored:'Two'}];
 const out=w.wordOutputModel(model,[{id:'P0001'},{id:'P0002'}],reply);assert.deepEqual(out.map(p=>p.origin),['P0001','P0002']);assert(out[0].style.bold);assert.throws(()=>w.wordOutputModel(model,[{id:'P0001'}],[{restored:'One'}]),/reference/);
});
