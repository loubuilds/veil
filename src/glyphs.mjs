/* Replay PDF text positioning. Ambiguous or unsupported geometry remains locked. */
const I=[1,0,0,1,0,0];
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function positionedGlyphs(list,O,fontFor){
 const records=[],stack=[];let s={ctm:I,tm:I,x:0,y:0,lx:0,ly:0,font:'',size:0,cs:0,ws:0,hs:1,rise:0,leading:0,mode:0};
 const move=(x,y)=>{s.x=s.lx+=x;s.y=s.ly+=y;};
 const unsupported=new Set(['paintFormXObjectBegin','paintFormXObjectEnd','beginGroup','endGroup','showSpacedText','nextLineShowText','nextLineSetSpacingShowText'].map(k=>O[k]).filter(Number.isInteger));
 for(let i=0;i<list.fnArray.length;i++){
  const op=list.fnArray[i],a=list.argsArray[i]||[];
  if(unsupported.has(op))return {resolve:()=>null};
  if(op===O.save){stack.push({...s});continue;}
  if(op===O.restore){if(!stack.length)return {resolve:()=>null};s=stack.pop();continue;}
  if(op===O.transform){s.ctm=mul(s.ctm,a);continue;}
  if(op===O.beginText){s.tm=I;s.x=s.y=s.lx=s.ly=0;continue;}
  if(op===O.setTextMatrix){s.tm=Array.from(a.length===1?a[0]:a);s.x=s.y=s.lx=s.ly=0;continue;}
  if(op===O.setFont){s.font=a[0];s.size=a[1];continue;}
  if(op===O.setCharSpacing){s.cs=a[0];continue;}
  if(op===O.setWordSpacing){s.ws=a[0];continue;}
  if(op===O.setHScale){s.hs=a[0]/100;continue;}
  if(op===O.setTextRise){s.rise=a[0];continue;}
  if(op===O.setLeading){s.leading=-a[0];continue;}
  if(op===O.setTextRenderingMode){s.mode=a[0];continue;}
  if(op===O.moveText){move(a[0],a[1]);continue;}
  if(op===O.setLeadingMoveText){s.leading=a[1];move(a[0],a[1]);continue;}
  if(op===O.nextLine){move(0,s.leading);continue;}
  // Extended graphics state may alter fonts. Unsupported fonts never inherit old advances.
  if(op===O.setGState){if(a[0]?.some(e=>e[0]==='Font'))return {resolve:()=>null};continue;}
  if(op!==O.showText)continue;
  const font=fontFor(s.font),fm=font?.fontMatrix||[.001,0,0,.001,0,0];
  const supported=font&&!font.isInvalidPDFjsFont&&!font.isType3Font&&!font.vertical&&fm?.length===6&&fm.every((v,j)=>Math.abs(v-[.001,0,0,.001,0,0][j])<1e-8)&&s.size>0&&s.hs>0&&s.mode===0;
  if(!supported||!Array.isArray(a[0]))return {resolve:()=>null};
  const m=mul(s.ctm,s.tm),height=Math.hypot(m[2],m[3])*s.size;
  for(const g of a[0]){
   if(typeof g==='number'){s.x-=g*s.size/1000*s.hs;continue;}
   const advance=g?.width*s.size*.001,spacing=s.cs+(g?.isSpace?s.ws:0);
   if(!Number.isFinite(advance+spacing))return {resolve:()=>null};
   const start=point(m,s.x,s.y+s.rise),end=point(m,s.x+advance*s.hs,s.y+s.rise);
   const valid=typeof g.unicode==='string'&&g.unicode.length===1&&!g.accent&&advance>0&&[...m,...start,...end,height].every(Number.isFinite)&&height>0&&m[0]>0&&m[3]>0&&Math.abs(m[1])<1e-6&&Math.abs(m[2])<1e-6&&end[0]>start[0];
   // Standard ZapfDingbats a73 is a square, despite some PDFs mapping it to "n".
   // PDF.js may remap its rendered glyph into the private-use range when embedding.
   const display=font.name==='ZapfDingbats' ? (/^[■▪●•]$/.test(g.fontChar)?g.fontChar:g.originalCharCode===110&&g.unicode==='n'&&g.width===761?'■':null):null;
   records.push({text:g.unicode,...(display?{display}:{}),font:s.font,x:start[0],y:start[1],end:end[0],advanceEnd:end[0]+spacing*s.hs*m[0],height,valid});
   s.x+=(advance+spacing)*s.hs;
  }
 }
 return {resolve(item){
  if(!item.str?.trim()||item.dir==='rtl'||!item.transform||item.transform.length!==6||![...item.transform,item.width].every(Number.isFinite)||!(item.width>0)||item.transform[0]*item.transform[3]-item.transform[1]*item.transform[2]<=0)return null;
  const x=item.transform[4],y=item.transform[5],height=Math.hypot(item.transform[2],item.transform[3]);
  if(!(height>0))return null;
  const tolerance=Math.max(.025,height*.015),candidates=[];
  for(let first=0;first<records.length;first++){
   const firstGlyph=records[first];
   if(firstGlyph.text!==item.str[0]||firstGlyph.font!==item.fontName||Math.abs(firstGlyph.x-x)>tolerance||Math.abs(firstGlyph.y-y)>tolerance)continue;
   const spans=[];let at=first,previous=null,valid=true;
   for(const ch of item.str){
    const g=records[at];
    if(!g||!g.valid||g.font!==item.fontName||Math.abs(g.y-y)>tolerance||Math.abs(g.height-height)>tolerance){valid=false;break;}
    if(ch===' '&&g.text!==' '&&previous&&g.x-previous.end>tolerance){spans.push({start:previous.end,end:g.x});continue;}
    if(g.text!==ch||(previous&&g.x<=previous.x)||g.x<x-tolerance||g.end>x+item.width+tolerance){valid=false;break;}
    spans.push({start:g.x,end:g.end,...(g.display?{display:g.display}:{})});previous=g;at++;
   }
   if(valid&&previous&&Math.min(Math.abs(previous.end-(x+item.width)),Math.abs(previous.advanceEnd-(x+item.width)))<=tolerance&&spans.length===item.str.length)candidates.push(spans.map(r=>({start:(r.start-x)/item.width,end:(r.end-x)/item.width,...(r.display?{display:r.display}:{})})));
  }
  return candidates.length===1?candidates[0]:null;
 }};
}
