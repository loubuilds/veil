/* Bounded flowing design for text PDFs. No source pixels enter the output. */
import { flowModel, flowStyle, flowPDF, flowDOCX } from './flow.mjs';

function dominantStyle(runs){
  const weights=new Map();
  for(const run of runs){const weight=run.text.replace(/[\s■•●▪◦‣]/g,'').length;if(!weight)continue;const style=flowStyle(run.style),key=JSON.stringify(style),old=weights.get(key);weights.set(key,{style,weight:weight+(old?.weight||0)});}
  return [...weights.values()].sort((a,b)=>b.weight-a.weight)[0]?.style||flowStyle();
}
export function pdfFlowModel(blocks,design){
  const runs=b=>{
    const source=b.textRuns?.length?b.textRuns:[{text:b.text,style:{size:b.fontSize,...b.textStyle}}];
    if(!design.readableOnWhite)return source;
    return source.map(r=>{
      const style=flowStyle(r.style),rgb=style.color.slice(1).match(/../g).map(h=>{const v=parseInt(h,16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
      const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
      return {...r,style:{...style,color:1.05/(luminance+.05)<4.5?'#17212b':style.color}};
    });
  };
  const grouped=new Map();for(const b of blocks){const key=design.groups?.[b.id]||b.id;grouped.set(key,[...(grouped.get(key)||[]),...runs(b)]);}
  const advances=blocks.filter(b=>b.lineAdvance).map(b=>b.lineAdvance/dominantStyle(runs(b)).size).filter(n=>n>=1&&n<=1.8).sort((a,b)=>a-b);
  const lineHeight=advances.length?advances[Math.floor(advances.length/2)]:1.2;
  return flowModel(blocks.map(b=>{
    const group=grouped.get(design.groups?.[b.id]||b.id),style=dominantStyle(group),allBold=group.filter(r=>r.text.trim()&&!/^[■•●▪◦‣]$/.test(r.text.trim())).every(r=>r.style?.bold);
    return {text:b.text,runs:runs(b),style,lineHeight,kind:style.size>=18?'h1':allBold&&group.map(r=>r.text).join('').length<100?'h2':'p',...design.paragraphs[b.id]};
  }));
}

export function textPageGeometry(width,height,blocks){
  const visible=blocks.filter(b=>b.text?.trim());
  if(width<250||height<350||!visible.length||visible.some(b=>(b.locked&&!b.reflowSafe)||!b.rect||![b.rect.x,b.rect.y,b.rect.w,b.rect.h].every(Number.isFinite)||b.rect.x<0||b.rect.y<0||b.rect.w<=0||b.rect.h<=0||b.rect.x+b.rect.w>width+1||b.rect.y+b.rect.h>height+1))return null;
  const ordered=[...visible].sort((a,b)=>Math.abs((a.baseline??a.rect.y)-(b.baseline??b.rect.y))<2?a.rect.x-b.rect.x:a.rect.y-b.rect.y),rows=[];
  for(const block of ordered){
    const previous=rows.at(-1),last=previous?.blocks.at(-1);
    if(previous&&block.rect.y<previous.rect.y+previous.rect.h-2){
      const baseline=Math.abs((block.baseline??block.rect.y)-(last.baseline??last.rect.y))<2;
      const gap=block.rect.x-last.rect.x-last.rect.w;
      const date=/^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?(?:19|20)\d{2}|present|current)$/i.test(block.text.trim());
      if(!baseline||(block.lines||1)>1||(last.lines||1)>1||gap < -2 || (gap>Math.max(20,block.fontSize*2.5)&&!(date&&block.rect.w<=150)))return null;
      previous.blocks.push(block);previous.rect.w=Math.max(previous.rect.w,block.rect.x+block.rect.w-previous.rect.x);previous.rect.h=Math.max(previous.rect.h,block.rect.y+block.rect.h-previous.rect.y);
    }else rows.push({id:block.id,blocks:[block],rect:{...block.rect},fontSize:block.fontSize});
  }
  const left=Math.max(18,Math.min(...visible.map(b=>b.rect.x)));
  return {width,height,left,right:left,top:Math.max(24,Math.min(54,rows[0].rect.y)),bottom:height-42,rows};
}

// Accept only thin, continuous horizontal rules on white. Any other artwork rejects.
export function horizontalRules(pixels,width,height,scale){
  const bands=[];let active=[];
  for(let y=0;y<height;y++){
    const spans=[];let start=-1;
    for(let x=0;x<=width;x++){
      const at=(y*width+x)*4,ink=x<width&&pixels[at+3]&&Math.min(pixels[at],pixels[at+1],pixels[at+2])<255;
      if(ink&&start<0)start=x;
      if(!ink&&start>=0){spans.push({x:start,end:x-1});start=-1;}
    }
    const next=[];
    for(const span of spans){
      let band=active.find(b=>Math.abs(b.x-span.x)<=1&&Math.abs(b.end-span.end)<=1);
      if(band)band.bottom=y;
      else{band={...span,y,bottom:y,color:'#000000',dark:766};bands.push(band);}
      if((band.bottom-band.y+1)/scale>3||bands.length>200)return null;
      const at=(y*width+Math.floor((span.x+span.end)/2))*4,sum=pixels[at]+pixels[at+1]+pixels[at+2];
      if(sum<band.dark){band.dark=sum;band.color='#'+[pixels[at],pixels[at+1],pixels[at+2]].map(v=>v.toString(16).padStart(2,'0')).join('');}
      next.push(band);
    }
    active=next;
  }
  return bands.map(b=>({x:b.x/scale,y:b.y/scale,w:(b.end-b.x+1)/scale,h:(b.bottom-b.y+1)/scale,color:b.color}));
}

export async function extractTextDesign(doc,blocks,O,makeCanvas,deadline=p=>p){
  const paragraphs={},ruleOrigins=[],groups={},joiners={},groupIndexes={};let geometry=null;
  for(let number=1;number<=doc.numPages;number++){
    const page=await deadline(doc.getPage(number)),view=page.getViewport({scale:1}),rows=blocks.filter(b=>b.page===number).sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x);
    const g=textPageGeometry(view.width,view.height,rows);if(page.rotate||!g)return null;
    if(geometry&&(Math.abs(g.width-geometry.width)>1||Math.abs(g.height-geometry.height)>1))return null;
    const {rows:lineRows,...bounds}=g;
    geometry=geometry?{...geometry,left:Math.min(geometry.left,g.left),right:Math.min(geometry.right,g.right),top:Math.min(geometry.top,g.top)}:bounds;
    for(const row of lineRows)row.blocks.forEach((block,i)=>{groups[block.id]=row.id;groupIndexes[block.id]=i;const previous=row.blocks[i-1];joiners[block.id]=previous&&block.rect.x-previous.rect.x-previous.rect.w>block.fontSize*.16?' ':'';});
    const annotations=await deadline(page.getAnnotations({intent:'display'}));
    if(annotations.some(a=>a.subtype!=='Link'))return null; // Link destinations are never exported.
    const operators=await deadline(page.getOperatorList());
    if(operators.fnArray.some((op,i)=>op===O.setTextRenderingMode&&operators.argsArray[i][0]!==0))return null;
    const skip=new Set([O.showText,O.showSpacedText,O.nextLineShowText,O.nextLineSetSpacingShowText].filter(Number.isInteger));
    const scale=1.5,viewport=page.getViewport({scale});if(viewport.width*viewport.height>6000000)return null;
    const canvas=makeCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));let rules;
    try{const render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff',annotationMode:0,operationsFilter:i=>!skip.has(operators.fnArray[i])});await deadline(render.promise,()=>render.cancel());rules=horizontalRules(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,scale);}
    finally{canvas.width=canvas.height=1;}
    if(!rules)return null;
    lineRows.forEach((b,i)=>{const previous=lineRows[i-1];paragraphs[b.id]={spaceBefore:previous?Math.max(0,Math.min(72,b.rect.y-previous.rect.y-Math.max(previous.rect.h,previous.fontSize*1.4))):number===1?0:10};});
    for(const rule of rules){
      // Text underlines are decoration, not section rules. Do not move them between paragraphs.
      const underline=rows.some(b=>Number.isFinite(b.baseline)&&Math.abs(rule.y-b.baseline)<=2.5&&rule.x>=b.rect.x-2&&rule.x+rule.w<=b.rect.x+b.rect.w+2);
      if(underline)continue;
      if(rule.w<40)return null;
      if(rule.x<geometry.left-3||rule.x+rule.w>view.width-geometry.right+3)return null;
      if(lineRows.some(b=>rule.y<b.rect.y+b.rect.h&&rule.y+rule.h>b.rect.y))return null;
      const before=lineRows.filter(b=>b.rect.y+b.rect.h<=rule.y).at(-1),after=lineRows.find(b=>b.rect.y>=rule.y+rule.h);
      // A rule immediately below a heading belongs to that heading, otherwise the next section.
      const follows=before&&rule.y-before.rect.y-before.rect.h<=12;
      const anchor=follows?before:after;if(!anchor)return null;
      const key=follows?'ruleAfter':'ruleBefore';if(paragraphs[anchor.id][key])return null;
      paragraphs[anchor.id][key]={color:rule.color,thickness:Math.min(2,rule.h),fraction:Math.min(1,rule.w/(view.width-g.left-g.right))};
      const gapOwner=follows?after:anchor;if(gapOwner)paragraphs[gapOwner.id].spaceBefore=Math.max(0,paragraphs[gapOwner.id].spaceBefore-8);
      ruleOrigins.push(anchor.id);
    }
  }
  return {...geometry,kind:'text-flow',paragraphs,groups,joiners,groupIndexes,ruleOrigins:[...new Set(ruleOrigins)],header:[],footer:[]};
}

export function checkTextDesign(model,design){
  const normalized=flowModel(model);
  for(const id of design.ruleOrigins)if(normalized.filter(p=>p.origin===id).length!==1)throw new Error('A section divider could not be matched to the revised wording. Use the text-only layout instead.');
  const joined=[];let previousSource=null;
  for(const paragraph of normalized){
    if(!paragraph.text.trim())continue;
    const previous=joined.at(-1),group=design.groups?.[paragraph.origin];
    if(previous&&group&&design.groups?.[previous.origin]===group&&design.groupIndexes?.[paragraph.origin]===design.groupIndexes?.[previousSource]+1){
      const separator=/\s$/.test(previous.text)||/^\s/.test(paragraph.text)?'':(design.joiners?.[paragraph.origin]??' ');
      previous.text+=separator+paragraph.text;previous.runs.push({text:separator,style:previous.style},...paragraph.runs);
    }else joined.push({...paragraph,runs:[...paragraph.runs]});
    previousSource=paragraph.origin;
  }
  return flowModel(joined);
}
export async function textDesignedPDF(model,design,library,fonts){
  const body=checkTextDesign(model,design);
  return {bytes:await flowPDF(body,library,fonts,design),layout:{body,top:design.top,bottom:design.bottom}};
}
export function textDesignedDOCX(model,design){return flowDOCX(checkTextDesign(model,design),design);}
