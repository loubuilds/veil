/* Local PDF letterhead extraction and flowing document exports. */
import { flowModel, flowLines, flowDOCX } from './flow.mjs';
import fontkit from '@pdf-lib/fontkit';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export function designGeometry(width,height,blocks){
  if(!blocks.length||blocks.some(b=>b.locked||![b.rect.x,b.rect.y,b.rect.w,b.rect.h].every(Number.isFinite)||b.rect.x<0||b.rect.y<0||b.rect.w<=0||b.rect.h<=0||b.rect.x+b.rect.w>width||b.rect.y+b.rect.h>height)||width<250||height<350) return null;
  const header=blocks.filter(b=>b.rect.y+b.rect.h<height*.12),footer=blocks.filter(b=>b.rect.y>height*.88);
  const body=blocks.filter(b=>!header.includes(b)&&!footer.includes(b));if(!body.length)return null;
  for(const list of [header,footer])for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)if(Math.min(list[i].rect.y+list[i].rect.h,list[j].rect.y+list[j].rect.h)-Math.max(list[i].rect.y,list[j].rect.y)>1)return null;
  for(let i=0;i<body.length;i++)for(let j=i+1;j<body.length;j++){
    const a=body[i].rect,b=body[j].rect;
    if(Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>2)return null;
  }
  const left=Math.max(12,Math.min(...body.map(b=>b.rect.x))),right=left;
  const top=Math.max(height*.12,Math.min(...body.map(b=>b.rect.y)));
  const bottom=Math.min(height*.88,footer.length?Math.min(...footer.map(b=>b.rect.y))-24:height-48);
  if(bottom-top<120||width-left-right<150)return null;
  const slots=list=>list.map(b=>({id:b.id,x:b.rect.x,y:b.rect.y,w:Math.max(b.rect.w,width-b.rect.x-right),h:b.rect.h}));
  const headerSlots=slots(header),footerSlots=slots(footer);if([...headerSlots,...footerSlots].some(s=>s.w<=0))return null;
  return {width,height,left,right,top,bottom,header:headerSlots,footer:footerSlots};
}

// Preserve relative section gaps, never absolute source positions or page-sized blanks.
export function pdfParagraphSpacing(blocks,design){
 const fixed=new Set([...design.header,...design.footer].map(s=>s.id)),body=blocks.filter(b=>!fixed.has(b.id)).sort((a,b)=>a.rect.y-b.rect.y),result={};
 body.forEach((b,i)=>{const prev=body[i-1];result[b.id]=prev?Math.min(72,Math.max(0,b.rect.y-prev.rect.y-Math.max(prev.rect.h,(prev.fontSize||prev.rect.h)*1.4))):0;});
 return result;
}

export function operatorTextColors(list,O){
  const result=new Map(),stack=[];let state={font:'',color:'#000000'};
  for(let i=0;i<list.fnArray.length;i++){
    const op=list.fnArray[i],a=list.argsArray[i];
    if(op===O.save)stack.push({...state});else if(op===O.restore)state=stack.pop()||state;
    else if(op===O.setFont)state.font=a[0];
    else if(op===O.setFillRGBColor&&/^#[0-9a-f]{6}$/i.test(a[0]))state.color=a[0];
    else if(op===O.showText&&Array.isArray(a[0])){const text=a[0].filter(g=>g&&typeof g==='object').map(g=>g.unicode||'').join('');const key=state.font+'\0'+text;if(!result.has(key))result.set(key,state.color);else if(result.get(key)!==state.color)result.set(key,'#17212b');}
  }return result;
}

export function hasBodyArtwork(pixels,pixelWidth,pixelHeight,geometry){
  const from=Math.max(0,Math.ceil(geometry.top/geometry.height*pixelHeight)),to=Math.min(pixelHeight,Math.floor(geometry.bottom/geometry.height*pixelHeight));
  for(let y=from;y<to;y++)for(let x=0;x<pixelWidth;x++){const at=(y*pixelWidth+x)*4;if(pixels[at+3]>0&&Math.min(pixels[at],pixels[at+1],pixels[at+2])<255)return true;}return false;
}

export async function extractPageDesign(page,blocks,O,makeCanvas){
  if(page.rotate)return null;
  const viewport=page.getViewport({scale:1}),geometry=designGeometry(viewport.width,viewport.height,blocks);if(!geometry)return null;
  const annotations=await page.getAnnotations({intent:'display'});if(annotations.length)return null;
  const operators=await page.getOperatorList();
  // Clipping/stroked text may affect later artwork; never misrepresent it as a clean backdrop.
  if(operators.fnArray.some((op,i)=>op===O.setTextRenderingMode&&operators.argsArray[i][0]!==0))return null;
  const skip=new Set([O.showText,O.showSpacedText,O.nextLineShowText,O.nextLineSetSpacingShowText].filter(Number.isInteger));
  const scale=1.5,view=page.getViewport({scale});if(view.width*view.height>6000000)return null;
  const canvas=makeCanvas(Math.ceil(view.width),Math.ceil(view.height));
  try{
    await page.render({canvasContext:canvas.getContext('2d'),viewport:view,background:'#ffffff',annotationMode:0,operationsFilter:i=>!skip.has(operators.fnArray[i])}).promise;
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    // No artwork means all text should remain editable, including sender/footer.
    if(hasBodyArtwork(pixels,canvas.width,canvas.height,geometry)||!pixels.some((v,i)=>i%4!==3&&v<250&&pixels[i-i%4+3]>0))return null;
    const png=canvas.toBuffer?new Uint8Array(canvas.toBuffer('image/png')):new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());
    return {...geometry,background:png};
  }finally{canvas.width=canvas.height=1;}
}

export function designedLayout(model,design,measure){
  const paragraphs=flowModel(model),taken=new Set(),fixed=[];
  let top=design.top,bottom=design.bottom;
  for(const zone of ['header','footer'])for(const slot of design[zone]){
    if(paragraphs.filter(p=>p.origin===slot.id).length!==1)throw new Error('The revised letterhead cannot be matched confidently. Use the text-only layout.');
    const index=paragraphs.findIndex((p,i)=>p.origin===slot.id&&!taken.has(i));taken.add(index);
    const p=paragraphs[index],lines=flowLines([p],measure,slot.w).filter(l=>l.kind!=='gap');
    const height=lines.reduce((n,l)=>n+l.height,0),y=zone==='header'?slot.y:slot.y+slot.h-height;
    if(y<0||y+height>design.height-8||(zone==='header'&&y+height>design.top-8)||(zone==='footer'&&y<design.bottom+8))throw new Error('The revised letterhead is too large for its artwork. Use the text-only layout.');
    if(fixed.some(other=>Math.min(y+height,other.y+other.lines.reduce((n,l)=>n+l.height,0))-Math.max(y,other.y)>1))throw new Error('The revised letterhead lines overlap. Use the text-only layout.');
    fixed.push({x:slot.x,y,lines});if(zone==='header')top=Math.max(top,y+height+20);else bottom=Math.min(bottom,y-20);
  }
  if(bottom-top<100)throw new Error('The letterhead leaves too little space for the body. Use the text-only layout.');
  const body=paragraphs.filter((_,i)=>!taken.has(i));if(!body.length)throw new Error('No body text remains. Use the text-only layout.');
  const lines=flowLines(body,measure,design.width-design.left-design.right),pages=[[]];let y=top;
  for(const line of lines){if(y+line.height>bottom){if(line.kind==='gap')continue;if(pages.length>=60)throw new Error('This output exceeds 60 pages.');pages.push([]);y=top;}pages.at(-1).push({x:design.left,y,line});y+=line.height;}
  return {body,pages,fixed,top,bottom};
}

export async function designedPDF(model,design,library,fontBytes){
  const doc=await library.PDFDocument.create();doc.registerFontkit(fontkit);const fonts={};
  for(const name of ['Regular','Bold','Italic','BoldItalic'])fonts[name]=await doc.embedFont(fontBytes[name],{subset:true});
  const font=s=>fonts[s.bold?(s.italic?'BoldItalic':'Bold'):(s.italic?'Italic':'Regular')];
  const measure=(text,s)=>{const supported=new Set(font(s).getCharacterSet());for(const c of text)if(!supported.has(c.codePointAt(0)))throw new Error('A character is unsupported by the PDF font. Use text-only Word output.');return font(s).widthOfTextAtSize(text,s.size);};
  const layout=designedLayout(model,design,measure),background=await doc.embedPng(design.background);
  const draw=(page,x,y,line)=>{for(const run of line.runs){const s=run.style,c=s.color.slice(1),baseline=design.height-y-s.size;page.drawText(run.text,{x:x+run.x,y:baseline,size:s.size,font:font(s),color:library.rgb(parseInt(c.slice(0,2),16)/255,parseInt(c.slice(2,4),16)/255,parseInt(c.slice(4),16)/255)});if(s.underline)page.drawLine({start:{x:x+run.x,y:baseline-1},end:{x:x+run.x+measure(run.text,s),y:baseline-1},thickness:.5});}};
  for(const body of layout.pages){const page=doc.addPage([design.width,design.height]);page.drawImage(background,{x:0,y:0,width:design.width,height:design.height});for(const item of layout.fixed){let y=item.y;for(const line of item.lines){draw(page,item.x,y,line);y+=line.height;}}for(const item of body)draw(page,item.x,item.y,item.line);}
  doc.setTitle('Veil updated document');doc.setAuthor('');doc.setCreator('Veil offline');doc.setProducer('Veil offline');return {bytes:await doc.save(),layout};
}

// Header/footer pictures contain only freshly rendered output margins; body remains editable.
export function designedDOCX(body,design,layout,headerPNG,footerPNG){
  const files=unzipSync(flowDOCX(body)),head='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',relNS='http://schemas.openxmlformats.org/package/2006/relationships',office='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const emu=n=>Math.round(n*12700),twip=n=>Math.round(n*20);
  const drawing=(height,id)=>`<w:p><w:pPr><w:spacing w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${id===1?0:emu(layout.bottom)}</wp:posOffset></wp:positionV><wp:extent cx="${emu(design.width)}" cy="${emu(height)}"/><wp:wrapNone/><wp:docPr id="${id}" name="Veil letterhead ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="letterhead.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(design.width)}" cy="${emu(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
  const ns='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="'+office+'" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  for(const [kind,tag,bytes,height,id]of [['header','hdr',headerPNG,layout.top,1],['footer','ftr',footerPNG,design.height-layout.bottom,2]]){
    files[`word/${kind}1.xml`]=strToU8(head+`<w:${tag} ${ns}>`+drawing(height,id)+`</w:${tag}>`);files[`word/media/${kind}.png`]=bytes;
    files[`word/_rels/${kind}1.xml.rels`]=strToU8(head+`<Relationships xmlns="${relNS}"><Relationship Id="rIdImage" Type="${office}/image" Target="media/${kind}.png"/></Relationships>`);
  }
  files['word/_rels/document.xml.rels']=strToU8(head+`<Relationships xmlns="${relNS}"><Relationship Id="rIdHeader" Type="${office}/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="${office}/footer" Target="footer1.xml"/></Relationships>`);
  const sect=`<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${twip(design.width)}" w:h="${twip(design.height)}"/><w:pgMar w:top="${twip(layout.top)}" w:right="${twip(design.right)}" w:bottom="${twip(design.height-layout.bottom)}" w:left="${twip(design.left)}" w:header="0" w:footer="0"/></w:sectPr>`;
  files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace('<w:document ','<w:document xmlns:r="'+office+'" ').replace(/<w:sectPr>[\s\S]*?<\/w:sectPr>/,sect));
  files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace('</Types>','<Default Extension="png" ContentType="image/png"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
  return zipSync(files);
}
