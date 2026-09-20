/* Structured flowing text: no imported HTML or document package is emitted verbatim. */
import { zipSync, strToU8 } from 'fflate';
import fontkit from '@pdf-lib/fontkit';
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const clean = s => String(s).replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
export function flowStyle(s = {}) {
  return { font: typeof s.font === 'string' && /^[\w ,'-]{1,80}$/.test(s.font) ? s.font : 'Arial', size: Number.isFinite(+s.size) ? Math.min(40,Math.max(8,+s.size)) : 11, bold: s.bold === true, italic:s.italic===true, underline:s.underline===true, color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#17212b' };
}
function flowRule(rule) {
  return rule && /^#[0-9a-f]{6}$/i.test(rule.color) && Number.isFinite(rule.thickness) && Number.isFinite(rule.fraction)
    ? {color:rule.color,thickness:Math.min(2,Math.max(.25,rule.thickness)),fraction:Math.min(1,Math.max(.1,rule.fraction))}:null;
}
function ruleHTML(rule){return rule?`border-top:${rule.thickness}pt solid ${rule.color};padding-top:4pt;`:'';}
function ruleWord(p){const tags=['ruleBefore','ruleAfter'].filter(k=>p[k]).map(k=>`<w:${k==='ruleBefore'?'top':'bottom'} w:val="single" w:sz="${Math.round(p[k].thickness*8)}" w:space="4" w:color="${p[k].color.slice(1)}"/>`).join('');return tags?`<w:pBdr>${tags}</w:pBdr>`:'';}
export function flowModel(input) {
  if (!Array.isArray(input) || !input.length || input.length > 2500) throw new Error('This text must contain between 1 and 2,500 paragraphs.');
  let count=0;
  return input.map((p,i) => {
    if (!p || typeof p.text !== 'string' || (count+=p.text.length)>250000 || p.text.length>100000) throw new Error('This text is too large. Split it into smaller documents.');
    const text=clean(p.text), style=flowStyle(p.style), kind=/^\s*(?:[■•●▪◦‣](?:\s|$)|-\s)/.test(text)?'li':['p','h1','h2','h3','li'].includes(p.kind)?p.kind:'p';
    const runs=Array.isArray(p.runs)&&p.runs.length<=10000 ? p.runs.map(r=>({text:clean(r.text || ''),style:flowStyle(r.style)})) : [{text,style}];
    return {id:'P'+String(i+1).padStart(4,'0'),text,kind,style,...(Number.isFinite(p.lineHeight)?{lineHeight:Math.min(2,Math.max(1,p.lineHeight))}:{}),...(flowRule(p.ruleBefore)?{ruleBefore:flowRule(p.ruleBefore)}:{}),...(flowRule(p.ruleAfter)?{ruleAfter:flowRule(p.ruleAfter)}:{}),...(Number.isFinite(p.spaceBefore)?{spaceBefore:Math.min(72,Math.max(0,p.spaceBefore))}:{}),...(/^[BP]\d{4}$/.test(p.origin||'')?{origin:p.origin}:{}),runs:runs.map(r=>r.text).join('')===text?runs:[{text,style}]};
  });
}
export function flowFromText(text) { return flowModel(clean(text).split(/\n\s*\n/).filter(s=>s.trim()).map(text=>({text}))); }
export function pdfTextStyle(name='',family='sans-serif') {
  const label=String(name),font=/Times/i.test(label)||(/serif/i.test(family)&&!/sans/i.test(family))?'Times New Roman':/Courier|mono/i.test(label+' '+family)?'Courier New':'Arial';
  return {font,bold:/bold|black|heavy|demi/i.test(label),italic:/italic|oblique/i.test(label)};
}
export function flowFromHTML(html, plain='') {
  if (html.length>2000000) throw new Error('Pasted formatting is too large. Paste a smaller section.');
  if (!html) return {model:flowFromText(plain), excluded:false};
  const template=document.createElement('template'); template.innerHTML=html;
  const paragraphs=[]; let runs=[],base=flowStyle(),kind='p',excluded=false,nodes=0;
  const flush=()=>{const text=runs.map(r=>r.text).join('');if(text.trim()) paragraphs.push({text,runs,style:base,kind});runs=[];};
  const omit=new Set(['SCRIPT','STYLE','HEAD','TITLE','IFRAME','OBJECT','EMBED','TEMPLATE','NOSCRIPT','SVG','MATH','IMG','VIDEO','AUDIO','CANVAS','INPUT','BUTTON']);
  function walk(n,style,depth=0) {
    if(++nodes>50000||depth>100) throw new Error('Pasted formatting is too complex. Use plain text.');
    if(n.nodeType===3) { runs.push({text:clean(n.textContent).replace(/[\t\r\n ]+/g,' '),style});return; }
    if(n.nodeType!==1&&n.nodeType!==11)return;
    const tag=n.nodeName.toUpperCase();
    if(omit.has(tag)){excluded=true;return;}
    if(tag==='BR'){runs.push({text:'\n',style});return;}
    const block=['P','DIV','H1','H2','H3','H4','H5','H6','LI','TR','BLOCKQUOTE','SECTION','PRE'].includes(tag);
    const st=n.style, size=st?.fontSize;
    const next=flowStyle({...style,bold:style.bold||['B','STRONG','H1','H2','H3'].includes(tag)||/bold|[6-9]00/.test(st?.fontWeight||''),italic:style.italic||['I','EM'].includes(tag)||st?.fontStyle==='italic',underline:style.underline||tag==='U'||/underline/.test(st?.textDecoration||''),font:st?.fontFamily||style.font,size:size&&/^\d+(\.\d+)?(pt|px)$/.test(size)?parseFloat(size)*(size.endsWith('px')?.75:1):/^H[1-6]$/.test(tag)?({H1:24,H2:18,H3:14}[tag]||12):style.size});
    if(['TABLE','TD','TH','A'].includes(tag)) excluded=true; // No hidden link targets or table promises.
    if(block){flush();base=next;kind=['H1','H2','H3','LI'].includes(tag)?tag.toLowerCase():'p';}
    for(const child of n.childNodes)walk(child,next,depth+1);
    if(['TD','TH'].includes(tag))runs.push({text:' | ',style:next});
    if(block){flush();base=style;kind='p';}
  }
  walk(template.content,base);flush();
  return {model:paragraphs.length?flowModel(paragraphs):flowFromText(plain),excluded};
}
export function flowUpdate(model,texts) {
  if(texts.length!==model.length)throw new Error('The paragraph structure changed. Ask the AI to return every paragraph.');
  return flowModel(model.map((p,i)=>({...p,text:texts[i],runs:texts[i]===p.text?p.runs:[{text:texts[i],style:p.style}]})));
}
// Matching by protected wording avoids applying a moved heading's style by stale ID.
function revisedRuns(paragraph,text){
  if(text===paragraph.text)return paragraph.runs;
  let prefix=0,suffix=0;
  while(prefix<Math.min(text.length,paragraph.text.length)&&text[prefix]===paragraph.text[prefix])prefix++;
  while(suffix<Math.min(text.length,paragraph.text.length)-prefix&&text[text.length-1-suffix]===paragraph.text[paragraph.text.length-1-suffix])suffix++;
  const slice=(from,to)=>{let at=0;return paragraph.runs.flatMap(run=>{const start=at;at+=run.text.length;const part=run.text.slice(Math.max(0,from-start),Math.max(0,Math.min(run.text.length,to-start)));return part?[{text:part,style:run.style}]:[];});};
  return [...slice(0,prefix),...(text.length-prefix-suffix?[{text:text.slice(prefix,text.length-suffix),style:paragraph.style}]:[]),...slice(paragraph.text.length-suffix,paragraph.text.length)];
}
export function flowReply(model, source, reply) {
  const normalized=flowModel(model),body=normalized.filter(p=>p.kind==='p'&&p.style.size>=10&&p.style.size<=14&&!p.style.bold).sort((a,b)=>b.text.length-a.text.length)[0]?.style||flowStyle();
  const available=source.map((b,i)=>({id:b.id,text:b.text,paragraph:normalized[i]}));
  return flowModel(reply.map(row=>{
    const at=available.findIndex(b=>b.text===row.text);
    const entry=at>=0?available.splice(at,1)[0]:null,matched=entry?.paragraph||(row.styleFrom?normalized[source.findIndex(b=>b.id===row.styleFrom)]:null);
    return matched?{...matched,origin:entry?.id||row.styleFrom,text:row.restored,runs:revisedRuns(matched,row.restored)}:{text:row.restored,kind:'p',style:body};
  }));
}
// Hanging lists share the same text/run handling in PDF, Word and clipboard output.
function paragraphRuns(p){
  if(p.kind!=='li')return p.runs;
  let trim=(p.text.match(/^\s*(?:[■•●▪◦‣]\s*|-\s+)/)||[''])[0].length;
  return p.runs.map(r=>{const drop=Math.min(trim,r.text.length);trim-=drop;return {...r,text:r.text.slice(drop)};}).filter(r=>r.text);
}
export function flowHTML(input) {
  const model=flowModel(input);
  return model.map((p,i)=>`<${p.kind==='li'?'p':p.kind} style="margin:${i?(p.spaceBefore??12):0}pt 0 0;line-height:${p.lineHeight??1.4};${p.kind==='li'?'padding-left:14pt;':''}${ruleHTML(p.ruleBefore)}${p.ruleAfter?`border-bottom:${p.ruleAfter.thickness}pt solid ${p.ruleAfter.color};padding-bottom:4pt;`:''}">${p.kind==='li'?'<span style="display:inline-block;width:14pt;margin-left:-14pt">•</span>':''}${paragraphRuns(p).map(r=>{const s=r.style;return `<span style="font-family:${escape(s.font)};font-size:${s.size}pt;font-weight:${s.bold?'700':'400'};font-style:${s.italic?'italic':'normal'};text-decoration:${s.underline?'underline':'none'};color:${s.color}">${escape(r.text).replace(/\n/g,'<br>')}</span>`;}).join('')}</${p.kind==='li'?'p':p.kind}>`).join('\n');
}
export function flowDOCX(input, geometry=null) {
  const model=flowModel(input),xmlHead='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const body=model.map((p,i)=>`<w:p><w:pPr>${/^h/.test(p.kind)?'<w:keepNext/>':''}${ruleWord(p)}${p.kind==='li'?'<w:tabs><w:tab w:val="left" w:pos="280"/></w:tabs>':''}<w:spacing w:before="${Math.round((i?(p.spaceBefore??8):0)*20)}" w:after="0" w:line="${Math.round((p.lineHeight??1.4)*240)}" w:lineRule="auto"/>${p.kind==='li'?'<w:ind w:left="280" w:hanging="280"/>':''}${/^h/.test(p.kind)?`<w:outlineLvl w:val="${+p.kind[1]-1}"/>`:''}</w:pPr>${(p.kind==='li'?[{text:'•\t',style:p.style},...paragraphRuns(p)]:p.runs).map(r=>{const s=r.style;return `<w:r><w:rPr><w:rFonts w:ascii="${escape(s.font.split(',')[0].replace(/['"]/g,''))}" w:hAnsi="${escape(s.font.split(',')[0].replace(/['"]/g,''))}"/><w:sz w:val="${Math.round(s.size*2)}"/>${s.bold?'<w:b/>':''}${s.italic?'<w:i/>':''}${s.underline?'<w:u w:val="single"/>':''}<w:color w:val="${s.color.slice(1)}"/></w:rPr>${r.text.split('\n').map(line=>`<w:t xml:space="preserve">${escape(line).replace(/\t/g,'</w:t><w:tab/><w:t xml:space="preserve">')}</w:t>`).join('<w:br/>')}</w:r>`;}).join('')}</w:p>`).join('');
  const section=geometry?`<w:sectPr><w:pgSz w:w="${Math.round(geometry.width*20)}" w:h="${Math.round(geometry.height*20)}"/><w:pgMar w:top="${Math.round(geometry.top*20)}" w:right="${Math.round(geometry.right*20)}" w:bottom="${Math.round((geometry.height-geometry.bottom)*20)}" w:left="${Math.round(geometry.left*20)}"/></w:sectPr>`:'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="960" w:right="960" w:bottom="960" w:left="960"/></w:sectPr>';
  return zipSync({
    '[Content_Types].xml':strToU8(xmlHead+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8(xmlHead+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml':strToU8(xmlHead+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+section+'</w:body></w:document>')
  });
}
export function flowLines(model, measure, width=499) {
  const out=[],paragraphs=flowModel(model);
  for(const [index,p] of paragraphs.entries()) {
    if(p.ruleBefore)out.push({kind:'rule',runs:[],height:8,rule:p.ruleBefore,placement:'before'});
    const indent=p.kind==='li'?14:0,leading=p.lineHeight??1.4;
    let line=p.kind==='li'?[{text:'•',style:p.style,x:0}]:[],used=indent,height=0;
    const flush=()=>{out.push({runs:line,height:Math.max(height,p.style.size*leading),kind:p.kind});line=[];used=indent;height=0;};
    const write=(text,style)=>{const w=measure(text,style);line.push({text,style,x:used});used+=w;height=Math.max(height,style.size*leading);};
    for(const run of paragraphRuns(p)) for(const part of run.text.split(/(\n|[^\S\n]+)/)) {
      if(!part)continue;
      if(part==='\n'){flush();continue;}
      if(used===indent&&/^\s+$/.test(part))continue;
      if(used+measure(part,run.style)>width){if(used>indent)flush();if(/^\s+$/.test(part))continue;}
      if(measure(part,run.style)>width-indent) {for(const char of part){if(used+measure(char,run.style)>width)flush();write(char,run.style);}}
      else write(part,run.style);
    }
    if(line.length)flush();if(p.ruleAfter)out.push({kind:'rule',runs:[],height:8,rule:p.ruleAfter,placement:'after'});out.push({runs:[],height:paragraphs[index+1]?.spaceBefore??10,kind:'gap'});
  }
  return out;
}
export async function flowPDF(model,library,fontBytes,geometry=null) {
  const pdf=await library.PDFDocument.create();pdf.registerFontkit(fontkit);
  const fonts={};for(const key of ['Regular','Bold','Italic','BoldItalic'])fonts[key]=await pdf.embedFont(fontBytes[key],{subset:true});
  const key=s=>s.bold?(s.italic?'BoldItalic':'Bold'):(s.italic?'Italic':'Regular');
  const sets=Object.fromEntries(Object.entries(fonts).map(([k,f])=>[k,new Set(f.getCharacterSet())]));
  const measure=(s,style)=>{for(const ch of s)if(!sets[key(style)].has(ch.codePointAt(0))){const error=new Error('The PDF font cannot represent a character in this text. Choose Word or copy formatted text instead.');error.code='FLOW_UNSUPPORTED_GLYPH';throw error;}return fonts[key(style)].widthOfTextAtSize(s,style.size);};
  const g=geometry||{width:595.28,height:841.89,left:48,right:48,top:47.89,bottom:793.89},bottom=g.height-g.bottom;
  const lines=flowLines(model,measure,g.width-g.left-g.right);let page=null,y=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];let keep=line.height;
    if(/^h/.test(line.kind)||(line.kind==='rule'&&line.placement==='before')){
      // Keep a section title, its divider and the first following body line together.
      for(let j=i+1;j<lines.length;j++){keep+=lines[j].height;if(lines[j].runs.length&&!/^h/.test(lines[j].kind))break;}
    }else if(lines[i+1]?.kind==='rule'&&lines[i+1].placement==='after')keep+=lines[i+1].height;
    if(keep>g.bottom-g.top)keep=line.height; // Oversized headings may wrap across pages.
    if(line.kind==='gap'&&(!page||y-line.height<bottom))continue;
    if(!page||y-keep<bottom){if(pdf.getPageCount()>=60)throw new Error('This output exceeds 60 pages. Shorten or split the document.');page=pdf.addPage([g.width,g.height]);y=g.height-g.top;}
    if(line.kind==='rule'){const c=line.rule.color.slice(1);page.drawLine({start:{x:g.left,y:y-4},end:{x:g.left+(g.width-g.left-g.right)*line.rule.fraction,y:y-4},thickness:line.rule.thickness,color:library.rgb(parseInt(c.slice(0,2),16)/255,parseInt(c.slice(2,4),16)/255,parseInt(c.slice(4),16)/255)});}
    for(const run of line.runs){const s=run.style,c=s.color.slice(1);page.drawText(run.text,{x:g.left+run.x,y:y-s.size,font:fonts[key(s)],size:s.size,color:library.rgb(parseInt(c.slice(0,2),16)/255,parseInt(c.slice(2,4),16)/255,parseInt(c.slice(4,6),16)/255)});if(s.underline)page.drawLine({start:{x:g.left+run.x,y:y-s.size-1},end:{x:g.left+run.x+measure(run.text,s),y:y-s.size-1},thickness:.5});}
    y-=line.height;
  }
  pdf.setTitle('Veil document');pdf.setAuthor('');pdf.setCreator('Veil offline');return pdf.save();
}
