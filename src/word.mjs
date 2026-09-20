/* Bounded Word-to-Word preservation. No original archive is emitted verbatim. */
import sax from '../vendor/sax.cjs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main', R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS={w:W,r:R,a:'http://schemas.openxmlformats.org/drawingml/2006/main',wp:'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',pic:'http://schemas.openxmlformats.org/drawingml/2006/picture'};
const REL='http://schemas.openxmlformats.org/package/2006/relationships',CT='http://schemas.openxmlformats.org/package/2006/content-types';
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const el=(name,attrs={},children=[])=>({name,attrs,children});
const walk=(n,fn)=>{if(typeof n==='string')return;fn(n);for(const c of n.children)walk(c,fn);};
const all=(n,name)=>{const a=[];walk(n,x=>{if(x.name===name)a.push(x);});return a;};
const write=n=>typeof n==='string'?esc(n):'<'+n.name+Object.entries(n.attrs).map(([k,v])=>' '+k+'="'+esc(v)+'"').join('')+'>'+n.children.map(write).join('')+'</'+n.name+'>';
function read(bytes){
 const text=strFromU8(bytes);if(text.length>8000000||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Unsupported Word XML declarations or size.');
 const parser=sax.parser(true,{xmlns:true}),stack=[];let root,count=0;
 parser.onopentag=n=>{if(++count>100000||stack.length>80)throw Error('Word XML is too complex.');for(const [p,uri]of Object.entries(NS))if((n.prefix===p&&n.uri!==uri)||(n.ns[p]&&n.ns[p]!==uri))throw Error('Unsupported Word namespace.');const node=el(n.name,Object.fromEntries(Object.values(n.attributes).map(a=>[a.name,a.value])));if(stack.length)stack.at(-1).children.push(node);else if(root)throw Error('Multiple XML roots.');else root=node;stack.push(node);};
 parser.ontext=t=>{if(stack.length)stack.at(-1).children.push(t);};parser.oncdata=parser.ontext;parser.onclosetag=()=>stack.pop();parser.onerror=e=>{throw e;};parser.write(text).close();if(!root)throw Error('Empty Word XML.');return root;
}
function archive(bytes){let count=0,total=0;const names=new Set();if(bytes.length>12000000)throw Error('Word template is too large.');return unzipSync(bytes,{filter:f=>{if(++count>1500||(total+=f.originalSize)>64000000||f.originalSize>8000000||names.has(f.name)||!/^[\w\-./\[\]]+$/.test(f.name)||f.name.split('/').includes('..')||f.name.startsWith('/'))throw Error('Unsupported Word archive.');names.add(f.name);return true;}});}
const partsPattern=/^word\/(document|header\d+|footer\d+)\.xml$/;
// Only passive text, paragraph, table and inline raster-picture constructs.
const wordNames=new Set(('document body hdr ftr p pPr r rPr t tab br cr tbl tblPr tblW tblBorders top left bottom right insideH insideV tblCellMar tblLayout tblLook tblGrid gridCol tr trPr cantSplit tblHeader tc tcPr tcW tcBorders tcMar gridSpan vMerge vAlign shd jc spacing ind keepNext keepLines widowControl pageBreakBefore contextualSpacing outlineLvl pStyle rStyle rFonts b bCs i iCs u strike dstrike color sz szCs vertAlign caps smallCaps noProof lang kern position highlight textDirection bidi rtl numPr ilvl numId sectPr pgSz pgMar pgNumType cols docGrid titlePg headerReference footerReference drawing pBdr tblStyleRowBandSize tblStyleColBandSize tblStylePr tabs trHeight tblStyle tblInd tblCaption tblDescription suppressAutoHyphens snapToGrid adjustRightInd mirrorInd borders between bar textAlignment autoSpaceDE autoSpaceDN fitText emboss imprint shading w lang eastAsianLayout styles style name basedOn next link qFormat uiPriority semiHidden unhideWhenUsed docDefaults rPrDefault pPrDefault numbering abstractNum multiLevelType lvl start numFmt lvlText lvlJc pTab num abstractNumId lvlOverride startOverride').split(' '));
const drawingNames=new Set(('wp:inline wp:extent wp:effectExtent wp:docPr wp:cNvGraphicFramePr a:graphicFrameLocks a:graphic a:graphicData pic:pic pic:nvPicPr pic:cNvPr pic:cNvPicPr a:picLocks pic:blipFill a:blip a:srcRect a:stretch a:fillRect pic:spPr a:xfrm a:off a:ext a:prstGeom a:avLst a:noFill a:ln a:solidFill a:srgbClr a:schemeClr a:theme a:themeElements a:clrScheme a:dk1 a:lt1 a:dk2 a:lt2 a:accent1 a:accent2 a:accent3 a:accent4 a:accent5 a:accent6 a:hlink a:folHlink a:sysClr a:fontScheme a:majorFont a:minorFont a:latin a:ea a:cs a:font a:fmtScheme a:fillStyleLst a:lnStyleLst a:effectStyleLst a:bgFillStyleLst a:gradFill a:gsLst a:gs a:tint a:shade a:satMod a:lin a:path a:fillToRect a:prstDash a:miter a:headEnd a:tailEnd a:effectStyle a:effectLst a:outerShdw a:alpha a:objectDefaults a:extraClrSchemeLst').split(' '));
function sanitizeTree(root,styles=false){
 function clean(n,parent=''){if(typeof n==='string')return n;const parents={'w:document':[''],'w:hdr':[''],'w:ftr':[''],'w:styles':[''],'w:numbering':[''],'w:body':['w:document'],'w:sectPr':['w:body'],'w:tbl':['w:body','w:tc','w:hdr','w:ftr'],'w:tr':['w:tbl'],'w:tc':['w:tr'],'w:t':['w:r'],'w:r':['w:p'],'w:p':['w:body','w:tc','w:hdr','w:ftr'],'w:drawing':['w:r']};if(parents[n.name]&&!parents[n.name].includes(parent))throw Error('Unsupported nested Word text or picture.');const prefix=n.name.split(':')[0];
  if(prefix==='w'&&!wordNames.has(n.name.slice(2)))throw Error('This Word file uses unsupported features ('+n.name.slice(2)+').');
  if(prefix!=='w'&&!drawingNames.has(n.name))throw Error('This Word file contains unsupported graphics or layout.');
  if(n.name==='w:cols'&&+(n.attrs['w:num']||1)!==1)throw Error('Multiple Word columns need text-only output.');
  if(n.name==='w:br'&&n.attrs['w:type']&&n.attrs['w:type']!=='textWrapping')throw Error('Manual Word page/column breaks need text-only output.');
  if(n.name==='w:trHeight'&&n.attrs['w:hRule']==='exact')throw Error('Fixed table heights need text-only output.');
  for(const k of Object.keys(n.attrs)){
   if(k.startsWith('xmlns'))continue;
   if(k==='mc:Ignorable'||/^(?:w:rsid|w14:|w15:)/.test(k)||['descr','title','name','hidden'].includes(k)){delete n.attrs[k];continue;}
   if(k==='r:link'||(k.startsWith('r:')&&!['r:id','r:embed'].includes(k)))throw Error('Linked Word content is unsupported.');
   if(!/^(?:w:|r:|xml:)/.test(k)&&prefix==='w')delete n.attrs[k];
  }
  if(['wp:docPr','pic:cNvPr'].includes(n.name)){n.attrs.name='Picture';delete n.attrs.descr;delete n.attrs.title;}
  n.children=n.children.filter(c=>!['w:latentStyles','w:rsid','w:nsid','w:tmpl','a:extLst','a:objectDefaults','a:scene3d','a:sp3d','w:tblCaption','w:tblDescription'].includes(c.name)).filter(c=>typeof c!=='string'||n.name==='w:t').map(c=>clean(c,n.name));return n;
 }
 return clean(root);
}
export function cleanWordImage(bytes){
 // Preserve pixel payload, remove PNG ancillary metadata/JPEG APP and comment segments.
 if(bytes.length<24)throw Error('Unsupported image.');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];let width=0,height=0;
 if(bytes.slice(0,8).every((b,i)=>b===[137,80,78,71,13,10,26,10][i])){
  out.push(bytes.slice(0,8));let at=8,end=false;const types=[];
  while(at+12<=bytes.length){const len=view.getUint32(at),type=String.fromCharCode(...bytes.slice(at+4,at+8));if(len>bytes.length-at-12)throw Error('Broken PNG.');types.push(type);if(type==='IHDR'){if(len!==13||at!==8)throw Error('Invalid PNG header.');width=view.getUint32(at+8);height=view.getUint32(at+12);}if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type))out.push(bytes.slice(at,at+len+12));else if(type[0]===type[0].toUpperCase())throw Error('Unsupported PNG content.');at+=len+12;if(type==='IEND'){end=true;break;}}
  if(!end||!types.includes('IDAT'))throw Error('Incomplete PNG.');
  }else if(bytes[0]===255&&bytes[1]===216){out.push(bytes.slice(0,2));let at=2,scan=false,ended=false;
  while(at+2<=bytes.length){if(bytes[at]!==255)throw Error('Broken JPEG.');const marker=bytes[at+1];if(marker===217){out.push(bytes.slice(at,at+2));ended=true;break;}if(at+4>bytes.length)throw Error('Broken JPEG.');const len=view.getUint16(at+2);if(len<2||at+2+len>bytes.length)throw Error('Broken JPEG segment.');if([192,193,194].includes(marker)){if(len<8)throw Error('Broken JPEG dimensions.');height=view.getUint16(at+5);width=view.getUint16(at+7);}if(!((marker>=224&&marker<=239)||marker===254))out.push(bytes.slice(at,at+2+len));at+=2+len;
   if(marker===218){scan=true;const start=at;while(at+1<bytes.length){if(bytes[at]!==255){at++;continue;}const next=bytes[at+1];if(next===0||next>=208&&next<=215){at+=2;continue;}if(next===255){at++;continue;}break;}out.push(bytes.slice(start,at));}
  }
  if(!scan||!ended)throw Error('Incomplete JPEG.');
 }else throw Error('Only inline PNG and JPEG pictures are supported.');
 if(!width||!height||width*height>20000000)throw Error('Word picture exceeds the supported size.');
 const result=new Uint8Array(out.reduce((n,b)=>n+b.length,0));let at=0;for(const b of out){result.set(b,at);at+=b.length;}return result;
}
function paragraphText(p){let text='';walk(p,n=>{if(n.name==='w:t')text+=n.children.filter(x=>typeof x==='string').join('');if(n.name==='w:tab')text+='    ';if(['w:br','w:cr'].includes(n.name))text+='\n';});return text.trim();}
const relPath=part=>part.replace(/([^/]+)$/,'_rels/$1.rels');
function targetPath(part,target){if(!/^[\w./-]+$/.test(target)||target.includes('..')||target.startsWith('/'))throw Error('Unsupported Word relationship path.');return part.slice(0,part.lastIndexOf('/')+1)+target;}
export function prepareWordTemplate(bytes){
 const input=archive(bytes),out={},docs={},relationships={},needed=new Set(['word/document.xml']);
 if(!input['word/document.xml'])throw Error('Missing Word document.');
 for(const name of Object.keys(input))if(/vba|activeX|embeddings/i.test(name))throw Error('Embedded or active content needs text-only output.');
 const types=read(input['[Content_Types].xml']||new Uint8Array());if(!all(types,'Override').some(n=>n.attrs.PartName==='/word/document.xml'&&n.attrs.ContentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'))throw Error('Only standard Word documents are supported.');
 for(const part of needed){
  if(!input[part])throw Error('Missing linked Word part.');
  if(partsPattern.test(part)||/^word\/(styles|numbering)\.xml$/.test(part)||/^word\/theme\/theme\d+\.xml$/.test(part)){
   const doc=sanitizeTree(read(input[part]));const expected=part==='word/document.xml'?'w:document':/^word\/header/.test(part)?'w:hdr':/^word\/footer/.test(part)?'w:ftr':part.includes('/theme/')?'a:theme':part.includes('styles')?'w:styles':'w:numbering';if(doc.name!==expected)throw Error('Invalid Word part root.');docs[part]=doc;
   if(part==='word/document.xml'&&(all(doc,'w:sectPr').length!==1||!doc.children.some(n=>n.name==='w:body'&&n.children.some(c=>c.name==='w:sectPr'))))throw Error('Complex Word sections need text-only output.');
   const rp=relPath(part),rels=input[rp]?read(input[rp]):el('Relationships',{xmlns:REL});const kept=[];
   const used=new Set();walk(doc,n=>{for(const key of ['r:id','r:embed'])if(n.attrs[key])used.add(n.attrs[key]);});
   const ids=new Set();for(const r of rels.children.filter(c=>typeof c!=='string')){
    if(r.name!=='Relationship'||ids.has(r.attrs.Id))throw Error('Invalid Word relationships.');ids.add(r.attrs.Id);
    const type=r.attrs.Type?.replace(R+'/','');const referenced=used.has(r.attrs.Id)||part==='word/document.xml'&&['styles','numbering','theme'].includes(type);
    if(!referenced)continue;
    if(r.attrs.TargetMode||!['image','header','footer','styles','numbering','theme'].includes(type))throw Error('External or unsupported linked content needs text-only output.');
    const target=targetPath(part,r.attrs.Target);if(type==='image'?!/^word\/media\/[\w.-]+\.(png|jpe?g)$/i.test(target):type==='header'||type==='footer'?!new RegExp('^word/'+type+'\\d+\\.xml$').test(target):type==='theme'?!/^word\/theme\/theme\d+\.xml$/.test(target):target!=='word/'+type+'.xml')throw Error('Unsupported linked part.');
    needed.add(target);kept.push(el('Relationship',{Id:r.attrs.Id,Type:R+'/'+type,Target:r.attrs.Target}));
   }
   if([...used].some(id=>!kept.some(r=>r.attrs.Id===id)))throw Error('Unresolved Word picture or header.');
   relationships[part]=kept;out[rp]=strToU8(write(el('Relationships',{xmlns:REL},kept)));
  }else out[part]=cleanWordImage(input[part]);
 }
 const slots=[];for(const part of Object.keys(docs).filter(n=>partsPattern.test(n)).sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b))){
  const ps=all(docs[part],'w:p');ps.forEach((p,index)=>{const text=paragraphText(p);if(text){if(all(p,'w:drawing').length)throw Error('Pictures beside text in the same paragraph need text-only output.');slots.push({id:'P'+String(slots.length+1).padStart(4,'0'),part,index,text});}});
 }
 if(!slots.length||slots.length>2500||slots.reduce((n,s)=>n+s.text.length,0)>150000)throw Error('Word text exceeds supported limits.');
 for(const [part,doc]of Object.entries(docs))out[part]=strToU8(write(doc));
 out['_rels/.rels']=strToU8(write(el('Relationships',{xmlns:REL},[el('Relationship',{Id:'rId1',Type:R+'/officeDocument',Target:'word/document.xml'})])));
 const content=[el('Default',{Extension:'rels',ContentType:'application/vnd.openxmlformats-package.relationships+xml'}),el('Default',{Extension:'png',ContentType:'image/png'}),el('Default',{Extension:'jpg',ContentType:'image/jpeg'}),el('Default',{Extension:'jpeg',ContentType:'image/jpeg'})];
 for(const name of Object.keys(docs)){if(name.includes('/theme/')){content.push(el('Override',{PartName:'/'+name,ContentType:'application/vnd.openxmlformats-officedocument.theme+xml'}));continue;}const type=name==='word/document.xml'?'document.main':/^word\/header/.test(name)?'header':/^word\/footer/.test(name)?'footer':name.includes('styles')?'styles':'numbering';content.push(el('Override',{PartName:'/'+name,ContentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.'+type+'+xml'}));}
 out['[Content_Types].xml']=strToU8(write(el('Types',{xmlns:CT},content)));
 return {bytes:zipSync(out),slots,images:Object.keys(out).filter(n=>n.startsWith('word/media/')).map(name=>({name,bytes:out[name],type:/\.png$/i.test(name)?'image/png':'image/jpeg'}))};
}
export function wordReplyPrompt(){return '\nWORD DOCUMENT STRUCTURE: internal instructions only: For this Word file these rules replace the general permission above to combine, split or reorder paragraphs. Keep each original source paragraph exactly once and in its original order. Include style_from equal to that source ID on EVERY returned paragraph. Rewrite freely within each paragraph; Veil and Word handle wrapping. Do not merge, split, reorder or move text across paragraphs or table cells. Preserve header/footer wording unless asked to edit it. Show a normal readable draft without these technical references.\n';}
export function wordOutputModel(model,source,reply){
 return reply.map(row=>{const index=source.findIndex(p=>p.id===row.styleFrom);if(index<0)throw Error('The reply does not identify where its Word paragraphs belong. Use a clean text layout, or ask your AI to keep each source paragraph reference.');const original=model[index];return {...original,origin:row.styleFrom,text:row.restored,runs:row.restored===original.text?original.runs:[{text:row.restored,style:original.style}]};});
}
export function exportWordTemplate(template,model,removedImages=[]){
 const safe=prepareWordTemplate(template),files=archive(safe.bytes),byOrigin=new Map();
 if(model.length!==safe.slots.length||model.some((p,i)=>p.origin!==safe.slots[i].id||typeof p.text!=='string'))throw Error('These edits change the Word structure. Use a clean text layout for this reply, or ask your AI to keep the original paragraphs and table cells.');
 for(const p of model)byOrigin.set(p.origin,p);
 const docs={};for(const slot of safe.slots){const doc=docs[slot.part]||(docs[slot.part]=read(files[slot.part])),p=all(doc,'w:p')[slot.index],row=byOrigin.get(slot.id);if(row.text===slot.text)continue;
  const props=p.children.filter(n=>n.name==='w:pPr'),rpr=all(p,'w:rPr')[0];const runs=[];row.text.split('\n').forEach((line,i)=>{if(i)runs.push(el('w:r',{},[el('w:br')]));runs.push(el('w:r',{},[...(rpr?[rpr]:[]),el('w:t',{'xml:space':'preserve'},[line])]));});p.children=[...props,...runs];
 }
 for(const name of Object.keys(files).filter(n=>partsPattern.test(n))){const doc=docs[name]||read(files[name]),rp=relPath(name),rels=read(files[rp]);const removed=new Set(rels.children.filter(r=>r.name==='Relationship'&&removedImages.includes(targetPath(name,r.attrs.Target))).map(r=>r.attrs.Id));
  function strip(n){if(typeof n==='string')return;n.children=n.children.filter(c=>!(c.name==='w:drawing'&&all(c,'a:blip').some(b=>removed.has(b.attrs['r:embed']))));for(const c of n.children)strip(c);}strip(doc);rels.children=rels.children.filter(r=>!removed.has(r.attrs?.Id));files[name]=strToU8(write(doc));files[rp]=strToU8(write(rels));
 }
 for(const name of removedImages)if(name.startsWith('word/media/'))delete files[name];
 return zipSync(files);
}
