/* Calm interface lives inside the existing private document closure. */
let calmReady=false, calmScreen='start', calmModel=null, calmRows=null, calmPacked=null, calmOutput=null, calmReply='', calmPrompt='', calmVisited=new Set(), calmTrail=['start'], calmPosition=0, calmPasteModel=null, calmFallback=false, calmOutputPDF=null;
const F=VeilImporters;
let calmTextMode='add',calmTextHistory=[],calmTextFuture=[];
let calmNavigation=crypto.randomUUID(),calmPendingFocus=null,calmLocalEdits=[];
let calmWord=null,calmWordOutput=null,calmWordRemoved=[];
let calmDesign=null,calmDesignOutput=null,calmDesignAttempted=false,calmTextOnly=false;
function calmReviewReady(){return $('calmPrivacy').checked&&(!!calmRows||W.firstUnchecked(pages.length,calmVisited)===-1);}
function calmRequireReview(){if(!calmReviewReady())throw new Error('Review the private details before sharing.');}
function calmFocus(id,select=false){if(busy){calmPendingFocus={id,select};return;}const node=$(id);node.focus({preventScroll:true});if(select)node.select();}
function calmAfterRun(){if(calmPendingFocus){const pending=calmPendingFocus;calmPendingFocus=null;calmFocus(pending.id,pending.select);}}
function calmClearCopyFallback(){$('calmCopyFallbackText').value='';$('calmCopyFallback').hidden=true;$('calmCopyFallback').open=false;}
const calmTitles={start:['Protect sensitive details before you share.','Choose how you want to protect your private details.'],paste:['Paste your text','Keep the formatting supplied by your clipboard, then review private details.'],review:['Check your private details','Review the highlights and protect anything we’ve missed.'],outcome:['What would you like to do?','Your protection choices are ready. Choose the next step.'],fallback:['A simpler layout, without the fiddling','Check the extracted wording before continuing.'],handoff:['Take your text to AI (Beta)','Copy once. Paste into your chosen AI chat.'],return:['Paste the AI’s final reply','After approving with A, copy the AI’s entire final message.'],result:['Your updated document','Private details restored. Review before downloading.']};
function calmRefresh(){
  if(!calmReady)return;
  if(!pages.length&& !['start','paste'].includes(calmScreen))calmShow('start',false);
  $('calmRoot').inert=busy; $('calmBack').disabled=busy||calmPosition===0;
  for(const b of $('calmForward').querySelectorAll('button'))b.disabled=busy;
  for(const id of ['calmRedact','calmAI','calmProtectedCopy'])$(id).disabled=busy||(id!=='calmRedact'&&!calmRows);
  $('calmPDFSharingNote').hidden=!!calmRows;
  $('calmCopyCorrection').hidden=$('calmCorrection').hidden;
  $('calmPrivacy').disabled=busy;$('calmTextUndo').disabled=busy||!calmTextHistory.length;$('calmTextRedo').disabled=busy||!calmTextFuture.length;
  $('calmStatus').textContent=$('status').textContent; $('calmStatus').className=$('status').classList.contains('error')?'error':'';
  $('calmDemo').disabled=!pdfjs||busy; $('calmChoose').disabled=!pdfjs||busy;
  const labels={start:'Choose file',paste:'Review private details →',review:'Continue →',outcome:'Continue',fallback:'Use text-only layout →',handoff:'I have the AI’s reply →',return:'Preview my document →',result:'Download reviewed document'};
  $('calmPrimary').textContent=busy?'Please wait…':labels[calmScreen];
  $('calmPrimary').hidden=calmScreen==='outcome'||(calmScreen==='start'&&!pages.length);if(calmScreen==='start'&&pages.length)$('calmPrimary').textContent='Continue reviewing →';
  $('calmPrimary').disabled=busy||(calmScreen==='review'&&!$('calmPrivacy').checked)||(calmScreen==='return'&&!$('calmReply').value.trim())||(calmScreen==='result'&&!calmOutput);
  const unviewed=calmRows?-1:W.firstUnchecked(pages.length,calmVisited);
  if(calmScreen==='review'&&unviewed!==-1){$('calmPrimary').textContent=`View page ${unviewed+1} →`;$('calmPrimary').disabled=busy;}
  $('calmPage').textContent=calmRows?`${calmRows.length} paragraphs`:`${currentPage+1} / ${pages.length}`;
  $('calmPrev').hidden=$('calmNext').hidden=!!calmRows;
  $('calmPrev').disabled=busy||currentPage===0; $('calmNext').disabled=busy||currentPage>=pages.length-1;
  $('calmNextHint').textContent=calmScreen==='result'?'Download or copy confirms you have reviewed the wording and private details.':calmScreen==='fallback'?'This choice accepts a new text layout without original graphics.':'';
  for(const id of ['calmCopyFormatted','calmCopyPlain'])$(id).disabled=busy||!calmOutput;
  for(const id of ['calmSave','calmSaveInline'])$(id).disabled=busy||!pages.length;
  for(const id of ['calmSettingsOpen','calmSessionOpen'])$(id).disabled=busy;
}
function calmShow(screen,push=true){
  if(!calmTitles[screen])screen='start';
  if(!calmRows&&['fallback','handoff','return','result'].includes(screen))screen=pages.length?'outcome':'start';
  if(!pages.length&&!['start','paste'].includes(screen))screen='start';
  if(['outcome','fallback','handoff','return','result'].includes(screen)&&!calmReviewReady())screen='review';
  if(['return','result'].includes(screen)&&!calmPacked)screen='review';
  if(screen==='result'&&!calmOutput)screen='return';
  calmScreen=screen;
  document.body.dataset.calmScreen=screen;
  $('calmPrivacy').closest('label').hidden=screen!=='review';
  $('calmResultActions').hidden=screen!=='result';
  $('calmFormat').querySelector('option[value=pdf]').textContent=calmWord&&!calmTextOnly?'PDF (text layout)':'PDF';
  $('calmInputChoices').hidden=!['start','paste'].includes(screen);
  for(const [id,target]of [['calmOpenTab','start'],['calmPasteTab','paste']]){$(id).classList.toggle('selected',screen===target);$(id).setAttribute('aria-pressed',String(screen===target));}
  document.querySelectorAll('[data-calm-screen]').forEach(n=>n.hidden=n.dataset.calmScreen!==screen);
  $('calmTitle').textContent=calmTitles[screen][0];$('calmLead').textContent=calmTitles[screen][1];
  if(screen==='review'&&calmRows)$('calmLead').textContent='Choose Add or Remove, then drag across the words. Keyboard users can use Find a name or phrase, or Tab to a highlight.';
  $('calmDock').hidden=false;$('calmBack').hidden=screen==='start';
  document.querySelectorAll('[data-calm-actions]').forEach(n=>n.hidden=n.dataset.calmActions!==screen);
  [...$('calmSteps').children].forEach((n,i)=>n.classList.toggle('active',i===(['start','paste'].includes(screen)?0:['review','outcome','fallback'].includes(screen)?1:2)));
  if(push&&calmTrail[calmPosition]!==screen){calmTrail=calmTrail.slice(0,calmPosition+1);calmTrail.push(screen);calmPosition++;try{window.history.pushState({veilScreen:screen,veilIndex:calmPosition,veilNavigation:calmNavigation},'');}catch{/* Local browser may not support history updates. In-tool Back remains. */}}
  calmRefresh();
  if(screen==='review'){$('calmPdfSlot').hidden=!!calmRows;$('calmRichReview').hidden=!calmRows;$('calmTextTools').hidden=!calmRows;if(calmRows)calmDrawRich();}
  calmFocus(screen==='return'?'calmReply':'calmTitle');window.scrollTo(0,0);
}
function calmReset(){
  if(!calmReady)return;
  calmTextHistory=[];calmTextFuture=[];calmModel=calmRows=calmPacked=calmOutput=calmOutputPDF=calmPasteModel=null;calmReply=calmPrompt='';calmVisited.clear();calmFallback=false;calmPendingFocus=null;calmNavigation=crypto.randomUUID();calmLocalEdits=[];calmDesign=calmDesignOutput=null;calmWordOutput=null;calmDesignAttempted=calmTextOnly=false;calmWord=calmWordOutput=null;calmWordRemoved=[];
  $('calmCapabilities').hidden=true;$('calmDocumentDetails').open=false;for(const id of ['calmCapabilityTitle','calmCapabilityRedact','calmCapabilityAI','calmCapabilityNotes'])$(id).replaceChildren();
  for(const id of ['calmReply','calmGoal','calmPrompt','calmCorrectionText','calmCopyFallbackText'])$(id).value='';
  for(const id of ['calmPaste','calmFallbackText','calmPasteNotice','calmCopyStatus','calmReplyError'])$(id).replaceChildren();
  $('calmGoalError').hidden=true;$('calmGoalError').textContent='';$('calmGoal').removeAttribute('aria-invalid');
  $('calmCopyFallback').hidden=true;$('calmReplyInput').value='';$('calmTextFallback').hidden=true;
  for(const id of ['calmPrivacy','calmFinalAck','calmFallbackAck'])$(id).checked=false;
  $('calmResult').replaceChildren();$('calmRichReview').replaceChildren();$('calmCorrection').hidden=true;calmTrail=['start'];calmPosition=0;
  try{window.history.replaceState({veilScreen:'start',veilIndex:0,veilNavigation:calmNavigation},'');}catch{}
}
function calmInvalidate(){
  if(!calmReady)return;
  calmLocalEdits=[];calmDesignOutput=null;calmWordOutput=null;
  calmClearCopyFallback();
  calmPacked=calmOutput=calmOutputPDF=null;documentId=crypto.randomUUID();calmReply='';$('calmReply').value='';$('calmFinalAck').checked=false;$('calmPrivacy').checked=false;$('calmResult').replaceChildren();$('calmCorrection').hidden=true;calmPrompt='';$('calmPrompt').value='';
}
function calmLoaded(saved){
  if(!calmReady)return;
  if(saved?.calm){const s=saved.calm;if(s.word){calmWord=F.prepareWordTemplate(C.from64(s.word.data));calmWordRemoved=s.word.removed.slice();}calmModel=s.model?F.flowModel(s.model):null;calmRows=calmModel?calmModel.map((p,i)=>({id:p.id,page:1,text:p.text,auto:C.autoTypes(p.text,$('sensitivity').value),overrides:s.overrides[i]})):null;calmFallback=!!s.fallback;calmTextOnly=!!s.textOnly;$('calmGoal').value=s.goal||'';$('calmReply').value=s.reply||'';calmReply=s.reply||'';calmLocalEdits=s.localEdits||[];}
  else if(saved){$('calmGoal').value=saved.goal||'';calmReply=saved.reply||'';$('calmReply').value=calmReply;calmLocalEdits=(saved.fits||[]).map(([id,fit])=>[id,fit.text]);}
  calmVisited.add(currentPage);calmShow('review');
}
function calmDocumentFeedback(checkFailed=false){
  const feedback=W.documentFeedback({textModel:!!calmRows,word:!!calmWord,textOnly:calmTextOnly,design:calmDesign?.kind|| (calmDesign?'letterhead':null),hasText:blocks.some(b=>b.text.trim()),pages,checkFailed});
  $('calmCapabilityTitle').textContent=feedback.title;
  $('calmCapabilityRedact').textContent=feedback.redaction;
  $('calmCapabilityAI').textContent=feedback.ai;
  $('calmCapabilityNotes').replaceChildren(...feedback.notes.map(text=>make('p','',text)));
  $('calmCapabilities').hidden=false;
}
async function calmAssessDocument(){
  if(!calmReady)return;
  let failed=false,errorMessage='';
  if(!calmRows&&blocks.some(b=>b.text.trim())){
    status('Checking what this document can retain…');
    try{await calmFindDesign();}catch(error){failed=true;errorMessage=error.message||'Document design check failed.';calmDesign=null;calmDesignAttempted=false;}
  }
  calmDocumentFeedback(failed);
  if(errorMessage)$('calmCapabilityNotes').append(make('p','',errorMessage));
}
function calmValidateSaved(s){
  if(!s)return;
  if(s.word){if(typeof s.word.data!=='string'||s.word.data.length>16000000||!Array.isArray(s.word.removed)||s.word.removed.length>1000)throw new Error('Invalid saved Word template.');const word=F.prepareWordTemplate(C.from64(s.word.data));if(!s.model||word.slots.length!==s.model.length||word.slots.some((p,i)=>p.text!==s.model[i].text)||s.word.removed.some(n=>!word.images.some(im=>im.name===n)))throw new Error('Saved Word template does not match the reviewed text.');}
  if(s.textOnly!==undefined&&typeof s.textOnly!=='boolean')throw new Error('Invalid saved layout choice.');
  if(s.version!==1||typeof s.goal!=='string'||s.goal.length>12000||typeof s.reply!=='string'||s.reply.length>4000000||typeof s.fallback!=='boolean')throw new Error('Invalid saved flowing document.');
  if(s.localEdits!==undefined){let total=0;if(!Array.isArray(s.localEdits)||s.localEdits.length>2500||(!s.reply&&s.localEdits.length)||s.localEdits.some(r=>!Array.isArray(r)||r.length!==2||typeof r[0]!=='string'||typeof r[1]!=='string'||r[1].length>100000||(total+=r[1].length)>250000)||new Set(s.localEdits.map(r=>r[0])).size!==s.localEdits.length)throw new Error('Invalid saved local wording.');}
  if(s.model){const model=F.flowModel(s.model);if(!Array.isArray(s.overrides)||s.overrides.length!==model.length||s.overrides.some((row,i)=>!Array.isArray(row)||row.length!==model[i].text.length||row.some(v=>v!==null&&v!==''&&v!=='CUSTOM')))throw new Error('Invalid saved text protection.');}
  else if(s.overrides!==null)throw new Error('Invalid saved protection.');
}
function calmSaved(){return {version:1,model:calmModel,overrides:calmRows?calmRows.map(b=>b.overrides):null,goal:$('calmGoal').value,reply:calmReply,fallback:calmFallback,localEdits:calmLocalEdits,textOnly:calmTextOnly,...(calmWord?{word:{data:C.bytesTo64(calmWord.bytes),removed:calmWordRemoved}}:{})};}
function calmBullet(p){return p.kind==='li'&&!/^\s*(?:[•●▪◦‣](?:\s|$)|-\s)/.test(p.text)?'• ':'';}
function calmApplyTextSelection(){
  if(busy||calmScreen!=='review'||!calmRows)return;
  const box=$('calmRichReview'),sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.rangeCount||!box.contains(sel.anchorNode)||!box.contains(sel.focusNode))return;
  const range=sel.getRangeAt(0),before=calmTextSnapshot();let changed=false;
  for(const n of box.querySelectorAll('[data-flow-paragraph]')){
    if(!range.intersectsNode(n))continue;
    const part=range.cloneRange();
    if(!n.contains(range.startContainer))part.setStart(n,0);
    if(!n.contains(range.endContainer))part.setEnd(n,n.childNodes.length);
    const prefix=part.cloneRange();prefix.selectNodeContents(n);prefix.setEnd(part.startContainer,part.startOffset);
    const i=Number(n.dataset.flowParagraph),row=calmRows[i],bullet=calmBullet(calmModel[i]).length;
    const start=Math.max(0,prefix.toString().length-bullet),end=Math.min(row.text.length,prefix.toString().length+part.toString().length-bullet);
    const value=calmTextMode==='add'?'CUSTOM':'';
    for(let j=start;j<end;j++)if(row.overrides[j]!==value){row.overrides[j]=value;changed=true;}
  }
  if(changed){calmTextRemember(before);sel.removeAllRanges();calmInvalidate();dirty=true;calmDrawRich();calmRefresh();status(calmTextMode==='add'?'Selected text protected.':'Protection removed from selected text.');}
}
function calmTextSnapshot(){return calmRows.map(b=>b.overrides.slice());}
function calmTextRemember(before){calmTextHistory.push(before);if(calmTextHistory.length>20)calmTextHistory.shift();calmTextFuture=[];}
function calmTextTravel(redo){
 if(busy||!calmRows)return;const from=redo?calmTextFuture:calmTextHistory,to=redo?calmTextHistory:calmTextFuture;
 if(!from.length)return;to.push(calmTextSnapshot());const saved=from.pop();calmRows.forEach((b,i)=>b.overrides=saved[i]);
 calmInvalidate();dirty=true;calmDrawRich();calmRefresh();status(redo?'Protection change restored.':'Protection change undone.');
}
function calmRemoveMark(i,seg){
 if(busy||!window.getSelection()?.isCollapsed)return;
 const b=calmRows[i],before=calmTextSnapshot(),manual=b.overrides.slice(seg.start,seg.end).includes('CUSTOM');
 for(let j=seg.start;j<seg.end;j++)if(!manual||b.overrides[j]==='CUSTOM')b.overrides[j]=manual?null:'';
 calmTextRemember(before);calmInvalidate();dirty=true;calmDrawRich();calmRefresh();
 const paragraph=$('calmRichReview').querySelector(`[data-flow-paragraph="${i}"]`);paragraph?.focus({preventScroll:true});
 status(manual?'Added protection undone. Automatic suggestions remain.':'Protection removed. Use Undo if this was accidental.');
}
function calmDrawRich(){
  const box=$('calmRichReview');box.replaceChildren();
  if(calmWord){const activeWord=calmWord;const note=make('p','hint','Word download keeps the supported design. This screen reviews text and pictures, not exact Word pages. PDF/copy use a clean text layout.');box.append(note);for(const im of calmWord.images){const card=make('div','calm-word-picture'),img=document.createElement('img');img.alt='Retained Word picture: check for private details';img.src='data:'+im.type+';base64,'+C.bytesTo64(im.bytes);img.hidden=calmWordRemoved.includes(im.name);img.onerror=()=>{if(calmWord!==activeWord||!img.isConnected)return;if(!calmWordRemoved.includes(im.name)){calmWordRemoved.push(im.name);calmInvalidate();dirty=true;calmDrawRich();status('A picture could not be displayed and has been excluded from Word output.',true);calmRefresh();}};const button=make('button','quiet',img.hidden?'Restore picture':'Remove picture from Word output');button.onclick=()=>{if(calmWordRemoved.includes(im.name))calmWordRemoved=calmWordRemoved.filter(n=>n!==im.name);else calmWordRemoved.push(im.name);calmInvalidate();dirty=true;calmDrawRich();calmRefresh();};card.append(img,button);box.append(card);}}
  calmModel.forEach((p,i)=>{
    const n=document.createElement(p.kind==='li'?'p':p.kind);n.dataset.flowParagraph=i;n.tabIndex=-1;n.style.fontFamily=p.style.font;n.style.fontSize=p.style.size+'pt';n.style.fontWeight=p.style.bold?'700':'400';n.style.fontStyle=p.style.italic?'italic':'normal';
    if(calmBullet(p))n.append(document.createTextNode(calmBullet(p)));
    const b=calmRows[i],segs=C.segments(b.text,b.auto,b.overrides);let at=0;
    for(const seg of segs){n.append(document.createTextNode(b.text.slice(at,seg.start)));const mark=make('mark','',b.text.slice(seg.start,seg.end));mark.tabIndex=0;if(seg.type==='URL')mark.title=C.detect(b.text,$('sensitivity').value).find(h=>h.type==='URL'&&h.start<=seg.start&&h.end>=seg.end)?.reason||'Web link: may identify a person or organisation';mark.setAttribute('role','button');mark.setAttribute('aria-label',(b.overrides.slice(seg.start,seg.end).includes('CUSTOM')?'Undo added protection: ':'Remove protection: ')+mark.textContent);mark.onclick=()=>calmRemoveMark(i,seg);mark.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.getSelection()?.removeAllRanges();calmRemoveMark(i,seg);}};n.append(mark);at=seg.end;}
    n.append(document.createTextNode(b.text.slice(at)));box.append(n);
  });
}
function calmSource(){
  W.requireTextSharing(!!calmRows);
  if(calmRows)return calmRows;
  return blocks.map(b=>({...b,locked:false}));
}
function calmEnsureModel(){
  if(calmModel)return calmModel;
  if(calmDesign?.kind==='text-flow'&&!calmTextOnly)return F.pdfFlowModel(blocks,calmDesign);
  const spacing=calmDesign&&!calmTextOnly?F.pdfParagraphSpacing(blocks,calmDesign):{};
  // A layout fallback drops page geometry, not the safely extracted text styling.
  const paragraphs=Object.fromEntries(blocks.map(b=>[b.id,{spaceBefore:spacing[b.id],...(!calmTextOnly?calmDesign?.paragraphs?.[b.id]:{})}]));
  return F.pdfFlowModel(blocks,{paragraphs,readableOnWhite:!calmDesign||calmTextOnly});
}
async function calmFindDesign(){
  if(calmDesignAttempted||calmRows)return calmDesign;
  const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  if(pages.length===1){const page=await W.withDeadline(pdfDocument.getPage(1),45000,'Reading the document design took too long. Please try again.');calmDesign=await W.withDeadline(F.extractPageDesign(page,blocks,pdfjs.OPS,makeCanvas),45000,'Reading the document design took too long. Please try again.');}
  if(!calmDesign)calmDesign=await F.extractTextDesign(pdfDocument,blocks,pdfjs.OPS,makeCanvas,(promise,cancel)=>W.withDeadline(promise,45000,'Reading the document design took too long. Please try again.',cancel));
  calmDesignAttempted=true;return calmDesign;
}
async function calmRenderDesign(){
  const rendered=await (calmDesign.kind==='text-flow'?F.textDesignedPDF:F.designedPDF)(calmOutput,calmDesign,PDFLib,calmFonts());calmOutputPDF=rendered.bytes;
  const task=pdfjs.getDocument({data:rendered.bytes.slice(),useSystemFonts:false,isEvalSupported:false});const doc=await task.promise;
  const box=$('calmResult');box.replaceChildren();box.classList.add('designed-pages');
  try{for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i),scale=i===1?1.5:1,view=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
    if(i===1&&calmDesign.kind==='text-flow')calmDesignOutput=rendered;
    if(i===1&&calmDesign.kind!=='text-flow'){const crop=async(y,h)=>{const c=document.createElement('canvas');c.width=canvas.width;c.height=Math.max(1,h);c.getContext('2d').drawImage(canvas,0,y,canvas.width,h,0,0,canvas.width,h);const bytes=await canvasPNG(c);c.width=c.height=1;return bytes;};
      const top=Math.floor(rendered.layout.top*scale),bottom=Math.ceil(rendered.layout.bottom*scale);
      calmDesignOutput={...rendered,header:await crop(0,top),footer:await crop(bottom,canvas.height-bottom)};
    }
    canvas.setAttribute('aria-label',`Updated document page ${i} of ${doc.numPages}`);box.append(canvas,make('p','hint',`Page ${i} of ${doc.numPages}`));
  }const readable=document.createElement('details');readable.append(make('summary','','Read the updated text'));const text=make('div');text.innerHTML=F.flowHTML(calmOutput);readable.append(text);box.append(readable); }finally{await doc.destroy();}
}
function calmPrepare(correction=false,missingTokens=[]){
  W.requireTextSharing(!!calmRows);
  calmRequireReview();
  const rows=calmSource();if(!rows.length)throw new Error('No text is available for AI editing. Use ordinary PDF redaction for scanned documents.');
  if(!calmRows){$('goal').value=$('calmGoal').value;prepareData();}
  const base=C.tokenise(rows,namespace),goal=$('calmGoal').value,overrides=Array(goal.length).fill(null);
  for(const value of Object.values(base.mapping)){let at=0;while(value&&(at=goal.indexOf(value,at))!==-1){overrides.fill('CUSTOM',at,at+value.length);at+=value.length;}}
  calmPacked=C.tokenise(rows,namespace,[{id:'GOAL',page:0,text:goal,auto:C.autoTypes(goal,$('sensitivity').value),overrides}]);
  calmPrompt=C.flowPromptFor(documentId,calmPacked.blocks,calmPacked.extra[0].text,correction,missingTokens)+(calmWord&&!calmTextOnly?F.wordReplyPrompt():'');$('calmPrompt').value=calmPrompt;return calmPrompt;
}
function calmFonts(){return Object.fromEntries(['Regular','Bold','Italic','BoldItalic'].map(k=>[k,C.from64(BUNDLE.assets.standardFontDataUrl['LiberationSans-'+k+'.ttf'])]));}
async function calmWorkingPDF(model){try{return await F.flowPDF(model,PDFLib,calmFonts());}catch(e){if(e.code==='FLOW_UNSUPPORTED_GLYPH')throw new Error('This input contains characters the bundled review font cannot display. Remove unsupported symbols or export your original document to PDF for ordinary redaction. Your current work has not been replaced.');throw e;}}
async function calmImportRich(model,label){
  const validated=F.flowModel(model),bytes=await calmWorkingPDF(validated);await loadPDF(bytes,label,null,()=>true,false);
  calmModel=validated;calmRows=validated.map(p=>({id:p.id,page:1,text:p.text,auto:C.autoTypes(p.text,$('sensitivity').value),overrides:Array(p.text.length).fill(null)}));
  sourceInfo={kind:'Formatted text',summary:'Supported paragraph formatting; images, table layout and link targets are excluded.',warnings:['PDF uses embedded Liberation Sans. Word and formatted copy retain supplied font names where available. Unchanged passages keep inline styles. Rewritten passages keep supported source styles when the AI reply identifies them; other passages use clean body formatting.']};
  calmDocumentFeedback();calmShow('review');status(pageNotice());
}
async function calmCopy(text,textarea,details){
  try{await navigator.clipboard.writeText(text);return true;}catch{if(details)$(details).open=true;calmFocus(textarea,true);return false;}
}
async function calmPreview(){
  W.requireTextSharing(!!calmRows);
  let replyValidated=false;
  try{
    calmClearCopyFallback();calmRequireReview();
    if(!calmPacked)calmPrepare();
    await calmFindDesign();
    const parsed=C.parseReply($('calmReply').value,documentId,calmPacked.blocks,calmPacked.mapping,'document'),byId=new Map(parsed.map(b=>[b.id,b.restored]));
    replyValidated=true;$('calmTextFallback').hidden=true;calmDesignOutput=null;calmWordOutput=null;
    for(const [id,text]of calmLocalEdits){if(!byId.has(id))throw new Error('Saved local wording refers to an unknown paragraph.');byId.set(id,text);}
    calmOutput=(calmWord&&!calmTextOnly?F.wordOutputModel:F.flowReply)(calmEnsureModel(),calmPacked.blocks,parsed.map(b=>({...b,restored:byId.get(b.id)})));calmReply=$('calmReply').value;calmOutputPDF=null;
    $('calmResultNotice').textContent='Review the complete revised document. Supported source text styles are kept when identified; other passages use a clean text style. Original graphics and backgrounds are not included.'+(parsed.detailCountsChanged?' Some private details now appear more or fewer times. Check each reference still means the right person or fact.':'');
    if(calmWord&&!calmTextOnly){calmWordOutput=F.exportWordTemplate(calmWord.bytes,calmOutput,calmWordRemoved);$('calmResult').classList.remove('designed-pages');$('calmResult').innerHTML=F.flowHTML(calmOutput);$('calmFormat').value='docx';$('calmResultNotice').textContent='Word download retains the supported document design, including pictures you kept. This is a wording preview, not exact Word pages. Check the downloaded file in Word. PDF and clipboard use a clean text layout.'+(parsed.detailCountsChanged?' Check repeated private details still refer to the right person or fact.':'');}
    else if(calmDesign&&!calmTextOnly){if(calmDesign.kind==='text-flow')calmOutput=F.checkTextDesign(calmOutput,calmDesign);await calmRenderDesign();$('calmResultNotice').textContent=(calmDesign.kind==='text-flow'?'Headings, paragraph spacing and section dividers flow with your edited text. Inline styling may differ. Review each page. Word may paginate differently.':'Original letterhead artwork is retained; the edited body flows automatically. Review every page. Word keeps an editable body with picture-based letterhead and footer.')+(parsed.detailCountsChanged?' Check repeated private details still refer to the right person or fact.':'');}
    else{calmDesignOutput=null;calmWordOutput=null;$('calmResult').classList.remove('designed-pages');$('calmResult').innerHTML=F.flowHTML(calmOutput);}
    $('calmResultNotice').textContent+=' Download or copy confirms you have reviewed the wording and private details.';
    $('calmFinalAck').checked=false;$('calmCorrection').hidden=true;dirty=true;calmShow('result');
    status(calmLocalEdits.length?'Your saved local wording is included. Previous box positions are replaced by automatic text flow. Review before exporting.':'Review the restored wording. Text flows automatically in the exported document.');
  }catch(e){calmOutput=null;calmDesignOutput=null;calmWordOutput=null;$('calmReplyError').textContent=e.message;if(replyValidated&&(calmDesign||calmWord)&&!calmTextOnly){$('calmTextFallback').hidden=false;$('calmCorrection').hidden=true;}else{const request=calmPrepare(true,e.code==='MISSING_PROTECTED_DETAILS'?e.missingTokens:[]);$('calmCorrectionText').value=request;$('calmCorrection').hidden=false;}throw e;}
}
async function calmDownload(){
  W.requireTextSharing(!!calmRows);
  calmRequireReview();if(!calmOutput||calmScreen!=='result')throw new Error('Preview the updated document first.');
  if($('calmFormat').value==='docx')download(calmWordOutput|| (calmDesignOutput?(calmDesign.kind==='text-flow'?F.textDesignedDOCX(calmOutput,calmDesign):F.designedDOCX(calmDesignOutput.layout.body,calmDesign,calmDesignOutput.layout,calmDesignOutput.header,calmDesignOutput.footer)):F.flowDOCX(calmOutput)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document','updated-document.docx');
  else {if(!calmDesignOutput)calmOutputPDF=await F.flowPDF(calmOutput,PDFLib,calmFonts());download(calmOutputPDF,'application/pdf','updated-document.pdf');}
  status('Download requested. Check your browser’s downloads.');
}
async function calmCopyOutput(formatted){
  W.requireTextSharing(!!calmRows);
  calmRequireReview();if(!calmOutput||calmScreen!=='result')throw new Error('Preview the restored wording first.');
  const text=calmOutput.map(p=>p.text).join('\n\n');
  try{if(formatted){if(!window.ClipboardItem)throw new Error();await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([F.flowHTML(calmDesignOutput?calmOutput.map(p=>({...p,style:{...p.style,color:'#17212b'},runs:p.runs?.map(r=>({...r,style:{...r.style,color:'#17212b'}}))})):calmOutput)],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);}else await navigator.clipboard.writeText(text);status(formatted?'Formatted text copied. Paste into your document.':'Plain text copied.');}
  catch{$('calmCopyFallback').hidden=false;$('calmCopyFallback').open=true;$('calmCopyFallbackText').value=text;calmFocus('calmCopyFallbackText',true);status('Clipboard access was blocked. The plain text is selected for manual copying.');}
}
async function calmAdvance(){
  if(calmScreen==='start'&&pages.length){calmShow('review');return;}
  if(calmScreen==='paste'){if(!$('calmPaste').textContent.trim())throw new Error('Paste or type some text first.');if(pages.length&&!confirm('Replace this work with the pasted text? Save and continue later first if needed.'))return;const parsed=calmPasteModel?{model:calmPasteModel}:F.flowFromHTML($('calmPaste').innerHTML,$('calmPaste').textContent);await calmImportRich(parsed.model,'Pasted text');return;}
  if(calmScreen==='review'){
    const next=calmRows?-1:W.firstUnchecked(pages.length,calmVisited);if(next!==-1){currentPage=next;await renderPage();return;}
    if(!$('calmPrivacy').checked)throw new Error('Check the privacy confirmation first.');reviewed=new Set(pages.map((_,i)=>i));$('reviewAck').checked=true;calmShow('outcome');return;
  }
  if(calmScreen==='fallback'){calmFallback=true;calmShow('handoff');return;}
  if(calmScreen==='handoff'){calmPrepare();calmShow('return');return;}
  if(calmScreen==='return'){await calmPreview();return;}
  if(calmScreen==='result')await calmDownload();
}
function calmInit(){
  document.body.classList.add('calm');$('calmRoot').hidden=false;
  $('calmDock').append(document.querySelector('.app-footer'));
  const reserveDockSpace=()=>{$('calmRoot').style.paddingBottom=(Math.ceil($('calmDock').getBoundingClientRect().height)+32)+'px';};
  if(window.ResizeObserver)new ResizeObserver(reserveDockSpace).observe($('calmDock'));
  window.addEventListener('resize',reserveDockSpace);reserveDockSpace();
  $('calmConfirmSlot').append($('calmPrivacy').closest('label'));
  const importActions=document.createElement('div');importActions.className='calm-import-actions';$('importDialog').append(importActions);importActions.append($('importAckRow'),$('confirmImport'));
  $('calmResultActions').append(document.querySelector('.calm-result-options'));
  for(const [screen,ids]of [['start',['calmDemo','calmOpenSaved']],['handoff',['calmCopyPrompt']],['return',['calmReplyFile','calmCopyCorrection','calmTextFallback']]]){const group=make('div','calm-extra-group');group.dataset.calmActions=screen;for(const id of ids)group.append($(id));$('calmExtraActions').append(group);}
  $('calmPdfSlot').append(document.querySelector('#prepareView .document-panel'));
  $('calmSettingsSlot').append(protectionPanel);$('calmPrecisionSlot').append($('blockInspector'));
  $('helpOpen').textContent='Help';$('helpOpen').setAttribute('aria-label','Help');
  const settings=make('button','','Settings');settings.id='calmSettingsOpen';settings.onclick=()=>$('calmSettings').showModal();document.querySelector('.head-actions').append(settings);
  const session=make('button','','Work');session.id='calmSessionOpen';document.querySelector('.head-actions').append(session);
  const menu=document.createElement('dialog');menu.id='calmSessionMenu';const heading=make('h2','','Your work');menu.append(heading);
  for(const [id,label,action]of [['calmSave','Save and continue later',()=>{menu.close();openRecoveryDialog();}],['calmLoad','Open saved work',()=>{menu.close();$('recoveryInput').click();}],['calmClear','Clear this session',()=>{menu.close();$('clearSession').click();}],['calmCloseMenu','Close',()=>menu.close()]]){const b=make('button','',label);b.id=id;b.onclick=action;menu.append(b);}document.body.append(menu);session.onclick=()=>menu.showModal();
  $('recoveryInline').textContent='Save and continue later';$('saveRecoveryShare').textContent='Save and continue later';
  $('calmPDFPaste').onclick=()=>calmShow('paste');
  $('calmOpenTab').onclick=()=>calmShow('start');$('calmPasteTab').onclick=()=>calmShow('paste');
  $('calmChoose').onclick=e=>{e.stopPropagation();$('pdfInput').click();};$('calmDrop').onclick=e=>{if(!e.target.closest('button'))$('pdfInput').click();};$('calmDrop').onkeydown=e=>{if(e.target===$('calmDrop')&&['Enter',' '].includes(e.key)){e.preventDefault();$('pdfInput').click();}};
  $('calmDrop').ondragover=e=>e.preventDefault();$('calmDrop').ondrop=e=>{e.preventDefault();run('Opening document…',()=>openFile(e.dataTransfer.files[0]));};
  $('calmDemo').onclick=()=>run('Opening fictional sample…',demo);$('calmOpenSaved').onclick=()=>$('recoveryInput').click();
  $('calmPrimary').onclick=()=>run('Preparing your next step…',calmAdvance);
  $('calmBack').onclick=()=>{if(busy||calmPosition<=0)return;if(window.history.state?.veilNavigation===calmNavigation&&window.history.state?.veilIndex===calmPosition)window.history.back();else{calmPosition--;calmShow(calmTrail[calmPosition],false);}};
  window.addEventListener('popstate',e=>{if(!calmReady)return;const pos=e.state?.veilIndex;if(e.state?.veilNavigation===calmNavigation&&Number.isInteger(pos)&&pos>=0&&pos<calmTrail.length){calmPosition=pos;calmShow(calmTrail[pos],false);}else calmShow(pages.length?'review':'start',false);});
  for(const [id,delta]of [['calmPrev',-1],['calmNext',1]])$(id).onclick=()=>run('Opening page…',async()=>{currentPage=Math.max(0,Math.min(pages.length-1,currentPage+delta));await renderPage();});
  $('calmPrivacy').onchange=$('calmFinalAck').onchange=$('calmFallbackAck').onchange=calmRefresh;
  for(const mode of ['add','remove']){
    const button=$(mode==='add'?'calmTextAdd':'calmTextRemove');
    button.onmousedown=e=>e.preventDefault();
    button.onclick=()=>{calmTextMode=mode;for(const [id,value]of [['calmTextAdd','add'],['calmTextRemove','remove']])$(id).setAttribute('aria-pressed',String(value===mode));calmApplyTextSelection();};
  }
  // Defer until the click following mouseup has finished. It must not erase a new mark.
  document.addEventListener('mouseup',()=>{setTimeout(calmApplyTextSelection,0);});
  $('calmTextUndo').onclick=()=>calmTextTravel(false);$('calmTextRedo').onclick=()=>calmTextTravel(true);
  $('calmPromptDetails').ontoggle=()=>{if($('calmPromptDetails').open&&calmScreen==='handoff'&&calmReviewReady())try{calmPrepare();}catch(e){status(e.message,true);}};
  $('calmFind').onclick=()=>$('calmSettings').showModal();
  const originalFindAdd=$('findAdd').onclick,originalFindRemove=$('findRemove').onclick;
  for(const [id,protect,original]of [['findAdd',true,originalFindAdd],['findRemove',false,originalFindRemove]])$(id).onclick=()=>{
    if(!calmRows){original();return;}const needle=$('findText').value;if(!needle)return;const before=calmTextSnapshot();let count=0;
    for(const row of calmRows){let at=0;while((at=row.text.indexOf(needle,at))!==-1){row.overrides.fill(protect?'CUSTOM':'',at,at+needle.length);at+=needle.length;count++;}}
    if(count){calmTextRemember(before);calmInvalidate();dirty=true;calmDrawRich();}status(`${count} match(es) updated.`);calmRefresh();
  };
  $('calmRedact').onclick=()=>run('Creating redacted PDF…',async()=>{
    if(!$('calmPrivacy').checked)throw new Error('Review private details first.');
    if(calmRows){const redacted=F.flowUpdate(calmModel,calmRows.map(b=>{let s=b.text;for(const x of C.segments(b.text,b.auto,b.overrides).reverse())s=s.slice(0,x.start)+'[REDACTED]'+s.slice(x.end);return s;}));resetRedacted();redactedBytes=await F.flowPDF(redacted,PDFLib,calmFonts());setPurpose('redact');reviewed=new Set(pages.map((_,i)=>i));$('reviewAck').checked=true;redactedPage=0;redactedSeen.clear();$('redactAck').checked=false;$('redactDialog').showModal();await showRedactedPage();}
    else{setPurpose('redact');reviewed=new Set(pages.map((_,i)=>i));$('reviewAck').checked=true;await generate();}
  });
  $('calmAI').onclick=()=>run('Checking document design…',async()=>{calmRequireReview();if(!calmSource().some(b=>b.text.trim()))throw new Error('This PDF has no extractable text for AI editing. Choose Redact & download to hide details using area masks, or paste text instead.');setPurpose('ai');await calmFindDesign();calmDocumentFeedback();if(!calmRows&&!calmDesign&&!calmFallback){$('calmFallbackText').textContent=blocks.map(b=>b.text).join('\n\n');$('calmFallbackAck').checked=false;calmShow('fallback');}else{calmShow('handoff');status(calmDesign?(calmDesign.kind==='text-flow'?'Document formatting detected. Text and section dividers will flow automatically.':'Letterhead detected. It stays on this device and will be included in your final document.'):'Copy your protected prompt.');}});
  $('calmTextFallback').onclick=()=>run('Previewing text-only layout…',async()=>{calmTextOnly=true;calmDesignOutput=null;calmWordOutput=null;calmDocumentFeedback();$('calmTextFallback').hidden=true;await calmPreview();});
  $('calmProtectedCopy').onclick=()=>run('Copying protected text…',async()=>{calmPrepare();const packed=calmPacked,labels=C.friendlyLabels(packed.blocks),text=packed.blocks.map(b=>b.text.replace(/\[\[V_[A-F0-9]{8}_[A-Z]+_\d{3,6}\]\]/g,t=>labels.byToken[t]||t)).join('\n\n');$('calmPrompt').value=text;const ok=await calmCopy(text,'calmPrompt','calmPromptDetails');if(!ok){calmShow('handoff');$('calmPromptDetails').open=true;calmFocus('calmPrompt',true);}status(ok?'Protected text copied.':'Open View what you’ll share and copy the selected text.');});
  $('calmCopyPrompt').onclick=()=>{if(!W.hasEditingObjective($('calmGoal').value)){ $('calmGoalError').hidden=false;$('calmGoalError').textContent='First, tell the AI what you would like to change in the box above.';$('calmGoal').setAttribute('aria-invalid','true');$('calmGoal').scrollIntoView({block:'center'});calmFocus('calmGoal');return;}return run('Preparing protected prompt…',async()=>{const p=calmPrepare();const ok=await calmCopy(p,'calmPrompt','calmPromptDetails');$('calmCopyStatus').textContent=ok?'Copied. Paste into your AI chat.':'The prompt is selected. Use your device’s Copy command.';});};
  $('calmGoal').oninput=()=>{$('calmGoalError').hidden=true;$('calmGoal').removeAttribute('aria-invalid');calmPacked=calmOutput=calmOutputPDF=null;calmDesignOutput=null;calmWordOutput=null;$('calmTextFallback').hidden=true;calmLocalEdits=[];$('calmPrompt').value='';$('calmCopyStatus').textContent='Instructions changed. Copy a fresh prompt.';calmReply='';$('calmReply').value='';$('calmFinalAck').checked=false;documentId=crypto.randomUUID();dirty=true;};
  $('calmReply').oninput=()=>{calmOutput=calmOutputPDF=null;calmDesignOutput=null;calmWordOutput=null;$('calmTextFallback').hidden=true;calmReply='';calmLocalEdits=[];$('calmFinalAck').checked=false;$('calmReplyError').textContent='';$('calmCorrection').hidden=true;calmRefresh();};
  $('calmReplyFile').onclick=()=>$('calmReplyInput').click();$('calmReplyInput').onchange=e=>run('Reading reply…',async()=>{const f=e.target.files[0];if(!f)return;if(f.size>4000000)throw new Error('Reply is too large.');$('calmReply').value=await f.text();$('calmReply').oninput();});
  $('calmCopyCorrection').onclick=()=>run('Copying correction…',async()=>{W.requireTextSharing(!!calmRows);const ok=await calmCopy($('calmCorrectionText').value,'calmCorrectionText','calmCorrectionDetails');status(ok?'Paste the correction request into the same AI chat.':'The correction request is selected for copying.');});
  $('calmSaveInline').onclick=openRecoveryDialog;$('calmCopyFormatted').onclick=()=>run('Copying formatted text…',()=>calmCopyOutput(true));$('calmCopyPlain').onclick=()=>run('Copying text…',()=>calmCopyOutput(false));
  $('calmPaste').onpaste=e=>{e.preventDefault();try{const result=F.flowFromHTML(e.clipboardData.getData('text/html'),e.clipboardData.getData('text/plain'));calmPasteModel=result.model;$('calmPaste').innerHTML=F.flowHTML(result.model);dirty=true;$('calmPasteNotice').textContent=result.excluded?'Unsupported graphics, table structure or links were excluded. Check the text before continuing.':'';}catch(error){status(error.message,true);calmRefresh();}};
  $('calmPaste').oninput=()=>{calmPasteModel=null;dirty=true;};
  $('calmPaste').ondrop=e=>e.preventDefault();
  calmReady=true;try{window.history.replaceState({veilScreen:'start',veilIndex:0,veilNavigation:calmNavigation},'');}catch{}calmShow('start',false);document.body.classList.remove('starting');reserveDockSpace();calmFocus('calmTitle');
}
