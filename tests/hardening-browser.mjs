import assert from 'node:assert/strict';
import fs from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {launch,fx,out,schemaFromPrompt} from './lib/calm-harness.mjs';
fs.mkdirSync(new URL('../evidence/hardening/browser/',import.meta.url),{recursive:true});
const results=[];
async function journey(name,fn){const h=await launch();h.page.setDefaultTimeout(12000);try{await h.open();await fn(h);assert.deepEqual(h.log.errors,[]);assert(!h.log.requests.some(u=>/^https?:/.test(u)));results.push({name,pass:true});console.log('PASS',name);}catch(e){await h.shot(name+'-failure');results.push({name,pass:false,error:e.stack});throw e;}finally{await h.finish(name+'-log');fs.writeFileSync(out('results.json'),JSON.stringify(results,null,2));}}
const review=async h=>{await h.page.check('#calmPrivacy');await h.click('#calmPrimary');};
const ai=async h=>{await h.click('#calmAI');if(await h.screen()==='fallback')await h.click('#calmPrimary');};
const prompt=async h=>{await h.page.fill('#calmGoal','Make this clearer and keep all references.');await h.click('#calmCopyPrompt');const p=await h.page.inputValue('#calmPrompt');assert(p.includes('keep all references.'));return p;};
await journey('text-review',async h=>{
 const p=h.page;await h.click('#calmPasteTab');await h.pasteHTML('<p>Contact Marisol Quintrell-Sentinel at marisol@example.org or 07700 900777.</p><p>Ordinary wording for editing.</p>','');await h.click('#calmPrimary');
 assert(!/Complex text/.test(await h.calmStatus()));
 const marks=()=>p.locator('#calmRichReview mark').allTextContents();const initial=await marks();assert(initial.includes('Marisol Quintrell-Sentinel'));
 // A real mouse drag across an entire paragraph, including existing detections.
 const bounds=await p.locator('[data-flow-paragraph="0"]').evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);const rects=[...range.getClientRects()];return {first:{x:rects[0].x,y:rects[0].y,h:rects[0].height},last:{right:rects.at(-1).right,y:rects.at(-1).y,h:rects.at(-1).height}};});
 await p.mouse.move(bounds.first.x,bounds.first.y+bounds.first.h/2);await p.mouse.down();await p.mouse.move(bounds.last.right,bounds.last.y+bounds.last.h/2,{steps:20});await p.mouse.up();await p.waitForTimeout(80);
 assert(await p.locator('#calmTextUndo').isEnabled());
 await p.locator('[data-flow-paragraph="0"] mark').first().click();
 assert((await marks()).some(s=>s.includes('marisol@example.org')));assert((await marks()).some(s=>s.includes('07700 900777')));
 await h.click('#calmTextUndo');await h.click('#calmTextRedo');assert.deepEqual(await marks(),initial);
 // Keyboard-operable highlight, with undo, instead of unsupported caret browsing.
 const email=p.locator('#calmRichReview mark').filter({hasText:'marisol@example.org'});await email.focus();await p.keyboard.press('Enter');assert(!(await marks()).some(s=>s.includes('marisol@example.org')));await h.click('#calmTextUndo');assert.deepEqual(await marks(),initial);
 await review(h);await h.click('#calmProtectedCopy');const copied=await h.clipboard();assert(!copied.includes('[[V_'));assert(!copied.includes('marisol@example.org'));
 await ai(h);const text=await prompt(h);assert(!text.includes('marisol@example.org'));const reply=schemaFromPrompt(text);
 await h.click('#calmPrimary');await p.fill('#calmReply',JSON.stringify(reply));await h.click('#calmPrimary');assert.equal(await h.screen(),'result');
 assert((await p.locator('#calmResult').textContent()).includes('marisol@example.org'));await h.shot('text-result');
});
await journey('pdf-sharing-withheld',async h=>{
 const p=h.page;await h.openFixture('chromium-letter.pdf');assert((await p.locator('#calmCapabilityAI').textContent()).includes('unavailable'));
 await h.click('#calmBack');assert.equal(await h.screen(),'start');await h.click('#calmPrimary');assert.equal(await h.screen(),'review');await review(h);
 assert(await p.locator('#calmAI').isDisabled());assert(await p.locator('#calmProtectedCopy').isDisabled());assert(await p.locator('#calmPDFSharingNote').isVisible());
 await h.click('#calmPDFPaste');assert.equal(await h.screen(),'paste');await h.click('#calmOpenTab');await h.click('#calmPrimary');assert.equal(await h.screen(),'review');
});
await journey('scan-and-empty-input',async h=>{
 const p=h.page;await h.click('#calmPasteTab');await h.click('#calmPrimary');assert((await h.calmStatus()).includes('Paste or type'));await h.click('#calmOpenTab');await h.openFixture('scanned-no-text.pdf');assert.equal(await p.locator('#calmCapabilityTitle').textContent(),'Manual redaction only');assert((await p.locator('#calmCapabilityAI').textContent()).includes('unavailable'));await review(h);assert(await p.locator('#calmAI').isDisabled());assert.equal(await h.screen(),'outcome');
});
await journey('save-and-stale-reply',async h=>{
 const p=h.page;await h.click('#calmPasteTab');await h.pasteHTML('<p>Write to marisol@example.org about the fictional meeting.</p>','');await h.click('#calmPrimary');await review(h);await ai(h);const old=schemaFromPrompt(await prompt(h));await p.fill('#calmGoal','Make it more concise.');await h.click('#calmCopyPrompt');await h.click('#calmPrimary');await p.fill('#calmReply',JSON.stringify(old));await h.click('#calmPrimary');assert((await h.calmStatus()).includes('changed protection or instructions'));
 await h.click('#calmSessionOpen');await h.click('#calmSave');await h.download(()=>p.locator('#saveRecovery').click(),'saved.veil');await h.open();await p.setInputFiles('#recoveryInput',out('saved.veil'));await h.ready();assert.equal(await h.screen(),'review');await review(h);await ai(h);await p.locator('#calmPromptDetails summary').click();await p.waitForFunction(()=>document.getElementById('calmPrompt').value.length>0);assert((await p.inputValue('#calmPrompt')).includes('Make it more concise.'));
});

await journey('unsupported-uploads',async h=>{
 const p=h.page;await h.openFixture('letter.pdf');const before=await p.locator('#fileLabel').textContent();
 for(const name of ['word-supported.docx','message.eml']){
 await h.openFixture(name);assert((await h.calmStatus()).includes('This document type isn’t supported'));assert.equal(await p.locator('#fileLabel').textContent(),before);assert.equal(await h.screen(),'review');assert(!(await p.locator('#importDialog').evaluate(n=>n.open)));
 }
 assert.equal(await p.locator('#pdfInput').getAttribute('accept'),'application/pdf,.pdf');
 const d=await p.evaluateHandle(()=>new DataTransfer());await d.evaluate((dt)=>dt.items.add(new File(['Fictional text'],'example.txt',{type:'text/plain'})));await p.dispatchEvent('#calmDrop','drop',{dataTransfer:d});await h.ready();assert((await h.calmStatus()).includes('This document type isn’t supported'));assert.equal(await p.locator('#fileLabel').textContent(),before);
});
await journey('ordinary-redaction',async h=>{
 const p=h.page;await h.openFixture('chromium-letter.pdf');await review(h);await h.click('#calmRedact');const bytes=await h.download(()=>p.locator('#downloadRedacted').click(),'redacted.pdf');assert(bytes.length>1000);
 const {DOMMatrix,Path2D,ImageData,createCanvas}=await import('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix,Path2D,ImageData});const P=await import('pdfjs-dist/legacy/build/pdf.mjs');const original=await P.getDocument({data:new Uint8Array(fs.readFileSync(fx('chromium-letter.pdf'))),useSystemFonts:false}).promise,redacted=await P.getDocument({data:new Uint8Array(bytes),useSystemFonts:false}).promise;
 try{
 const source=await original.getPage(1),page=await redacted.getPage(1);assert.equal((await page.getTextContent()).items.length,0);
 const content=await source.getTextContent(),ops=await source.getOperatorList(),{positionedGlyphs}=await import('../src/glyphs.mjs'),metrics=positionedGlyphs(ops,P.OPS,id=>source.commonObjs.get(id));
 const item=content.items.find(i=>i.str?.includes('01632 960888')),spans=metrics.resolve(item),first=item.str.indexOf('01632 960888'),last=first+'01632 960888'.length-1;
 const canvas=createCanvas(Math.ceil(page.view[2]*2),Math.ceil(page.view[3]*2));await page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:2})}).promise;
 const ctx=canvas.getContext('2d'),left=item.transform[4]+spans[first].start*item.width,right=item.transform[4]+spans[last].end*item.width,y=(page.view[3]-item.transform[5]-item.height*.3)*2;
 for(let x=Math.ceil(left*2);x<right*2;x++){const pixel=ctx.getImageData(x,Math.round(y),1,1).data;assert(Math.max(...pixel.slice(0,3))<65,'phone span fully covered in actual exported PDF');}
 fs.writeFileSync(out('redaction-render.png'),canvas.toBuffer('image/png'));
 }finally{await original.destroy();await redacted.destroy();}
});

await journey('previous-saved-work',async h=>{
 for(const name of ['previous-pdf.veil','previous-word.veil']){
 await h.open();await h.page.setInputFiles('#recoveryInput',fx(name));await h.ready();assert.equal(await h.screen(),'review');await review(h);if(name==='previous-pdf.veil'){assert(await h.page.locator('#calmAI').isDisabled());assert(await h.page.locator('#calmProtectedCopy').isDisabled());continue;}await ai(h);await h.page.locator('#calmPromptDetails summary').click();await h.page.waitForFunction(()=>document.getElementById('calmPrompt').value.length>0);assert(schemaFromPrompt(await h.page.inputValue('#calmPrompt')).blocks.length>0);
 }
});
await journey('precise-cross-paragraph-selection',async h=>{
 const p=h.page;await h.click('#calmPasteTab');await h.pasteHTML('<p>alpha beta gamma</p><p>delta epsilon zeta</p>','');await h.click('#calmPrimary');
 const drag=async(a,start,b,end)=>{
 const coords=await p.evaluate(({a,start,b,end})=>{
 const at=(i,offset)=>{const n=document.querySelector(`[data-flow-paragraph="${i}"]`),w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t;while(t=w.nextNode()){if(offset<=t.length){const r=document.createRange();r.setStart(t,offset);r.collapse(true);const box=r.getBoundingClientRect();return {x:box.x,y:box.y+box.height/2};}offset-=t.length;}throw new Error('bad offset');};return [at(a,start),at(b,end)];},{a,start,b,end});
 await p.mouse.move(coords[0].x,coords[0].y);await p.mouse.down();await p.mouse.move(coords[1].x,coords[1].y,{steps:15});await p.mouse.up();await p.waitForTimeout(80);
 };
 const marks=()=>p.locator('#calmRichReview mark').allTextContents();await drag(0,6,1,5);assert.deepEqual(await marks(),['beta gamma','delta']);await h.click('#calmTextRemove');await drag(0,7,0,10);assert.deepEqual(await marks(),['b',' gamma','delta']);await h.click('#calmTextUndo');assert.deepEqual(await marks(),['beta gamma','delta']);await h.click('#calmTextUndo');assert.deepEqual(await marks(),[]);assert.equal(await p.locator('[data-flow-paragraph="0"]').textContent(),'alpha beta gamma');
});

await journey('hidden-pdf-sharing-blocked',async h=>{
 const p=h.page;await h.openFixture('hidden-text.pdf');await review(h);
 await p.evaluate(()=>navigator.clipboard.writeText('unchanged clipboard'));
 for(const id of ['calmAI','calmProtectedCopy','calmCopyPrompt','calmCopyCorrection']){
   if(id==='calmCopyPrompt')await p.evaluate(()=>document.getElementById('calmGoal').value='Simplify this fictional document.');
   await p.evaluate(id=>document.getElementById(id).onclick(),id);await h.ready();
   assert((await h.calmStatus()).includes('Text sharing from PDFs is unavailable'),id);
   assert.equal(await h.clipboard(),'unchanged clipboard');
 }
 for(const id of ['calmPrompt','calmCorrectionText','promptPreview'])assert.equal(await p.inputValue('#'+id),'');
 assert.equal(await h.screen(),'outcome');
 await h.click('#calmRedact');const bytes=await h.download(()=>p.locator('#downloadRedacted').click(),'hidden-redacted.pdf');assert(bytes.length>1000);
});
