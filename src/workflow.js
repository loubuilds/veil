/* Veil's next-action decisions. Shared by the UI and local unit checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VeilWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function withDeadline(promise, milliseconds, message, cancel = () => {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(message); error.code = 'VEIL_TIMEOUT';
        reject(error);
        try { Promise.resolve(cancel()).catch(() => {}); } catch { /* Cancellation must not hold the UI. */ }
      }, milliseconds);
      Promise.resolve(promise).then(value => {
        if (settled) return; settled = true; clearTimeout(timer); resolve(value);
      }, error => {
        if (settled) return; settled = true; clearTimeout(timer); reject(error);
      });
    });
  }
  function readLocalFile(file, Reader, milliseconds = 30000) {
    const reader = new Reader();
    const read = new Promise((resolve, reject) => {
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(new Error('The file could not be read. Save a local copy on this device, then choose it again.'));
      reader.onabort = () => reject(new Error('Reading the file was cancelled. Choose the file again when ready.'));
      reader.readAsArrayBuffer(file);
    });
    return withDeadline(read, milliseconds, 'Reading the file took too long. If it is stored in iCloud or another cloud folder, download it to this device first, then use Choose file.', () => reader.abort());
  }
  function firstUnchecked(count, checked) {
    for (let i = 0; i < count; i++) if (!checked.has(i)) return i;
    return -1;
  }
  function sourceAction({ count, current, reviewed, acknowledged, busy }) {
    const next = firstUnchecked(count, reviewed);
    if (!count) return { kind: 'empty', disabled: true, label: 'Open a document first', hint: 'Choose a file or try the fictional sample.' };
    if (!reviewed.has(current)) return { kind: 'review', disabled: busy, label: `I've checked page ${current + 1}${count > 1 ? ' →' : ''}`, hint: 'Check the whole page, including images and context. Then confirm below.' };
    if (next !== -1) return { kind: 'navigate', next, disabled: busy, label: `Check page ${next + 1} →`, hint: 'There are still pages to check before making the PDF.' };
    return { kind: 'preview', disabled: busy || !acknowledged, label: 'Preview redacted PDF →', hint: acknowledged ? 'Ready. Preview the actual PDF before downloading.' : 'All pages checked. Tick the privacy confirmation below to continue.' };
  }
  function exportAction({ count, viewed, acknowledged, sourceReady, hasPDF, busy, failed }) {
    if (!count || !hasPDF || !sourceReady) return { kind: 'unavailable', disabled: true, label: 'Download redacted PDF', hint: 'Return to redaction and complete the source review first.' };
    if (failed) return { kind: 'retry', disabled: busy, label: 'Retry preview', hint: 'The preview could not be shown. Retry it before downloading.' };
    const next = firstUnchecked(count, viewed);
    if (next !== -1) return { kind: 'navigate', next, disabled: busy, label: `View page ${next + 1} →`, hint: `View every page of the finished PDF before downloading. Next: page ${next + 1}.` };
    return { kind: 'download', disabled: busy || !acknowledged, label: 'Download redacted PDF', hint: acknowledged ? 'Ready to download redacted-document.pdf.' : 'Tick the confirmation below, then download your PDF.' };
  }
  function restoreAction({ count, hasReply, pending, issues, viewed, acknowledged, busy }) {
    if (!hasReply || !count) return { kind: 'unavailable', disabled: true, hint: 'Preview the AI reply before downloading.' };
    if (pending) return { kind: 'apply', disabled: busy, label: 'Review pending changes →', hint: 'Your text or layout changes have not been applied. Check them, then choose Apply & preview.' };
    if (issues.length) {
      const issue = issues.find(i => i.reason !== 'Check background & box') || issues[0];
      const review = issue.reason === 'Check background & box';
      const explanation = issue.reason === 'Text overflow' ? 'The revised text does not fit its original space. Shorten it or adjust the text size or box, then Apply & preview.' : review ? 'Check that the edited text box and background do not cover other content, tick its confirmation, then Apply & preview.' : 'Adjust the text box to resolve this layout warning, then Apply & preview.';
      return { kind: 'fit', id: issue.id, disabled: busy, label: review ? 'Review edited area →' : 'Fix text layout →', hint: `${issues.length} edited area(s) still need attention. Page ${issue.page}: ${issue.reason}. ${explanation}` };
    }
    const next = firstUnchecked(count, viewed);
    if (next !== -1) return { kind: 'navigate', next, disabled: busy, label: `Review page ${next + 1} →`, hint: 'All text checks passed. View every updated page before the final confirmation.' };
    if (!acknowledged) return { kind: 'confirm', disabled: true, hint: 'Layout checks passed and every page has been viewed. Tick the final confirmation to download.' };
    return { kind: 'download', disabled: busy, hint: 'Ready to download restored-document.pdf.' };
  }
  function hasEditingObjective(value){return typeof value==='string'&&!!value.replace(/[\s\u200b-\u200d\ufeff]/g,'');}
  function requireTextSharing(textModel){
    if(!textModel)throw new Error('Text sharing from PDFs is unavailable in this release because PDFs can contain hidden words. Choose Prepare text for AI to review the wording before copying or using AI. You can still redact and download this PDF.');
  }
  function documentFeedback({textModel=false,word=false,textOnly=false,design=null,hasText=false,pages=[],checkFailed=false}={}){
    const notes=[];
    let ai,title='What to expect from this document';
    const redaction=textModel?'Creates a new text PDF with your chosen details hidden. It does not reproduce the original page design.':'Keeps the PDF page appearance with your chosen details hidden. Each page is saved as an image. Searching or copying its text may not work in your PDF reader.';
    if(word&&!textOnly)ai='Word download retains the supported document structure and formatting. PDF and copied text use a simpler layout. Edited text may change page breaks.';
    else if(textModel)ai='Uses the imported text and supported text styling in a new flowing document. Original graphics and table layout are not included.';
    else if(!hasText){title='Manual redaction only';ai='No editable text was found. AI editing is unavailable. Veil cannot read text from images; paste the wording separately to edit it.';}
    else if(checkFailed)ai='The layout check could not finish. Formatting support is unconfirmed. You can still review redactions; Veil will retry the check if you choose AI editing.';
    else if(textOnly||!design)ai='Needs a simpler layout. Supported text styling can be kept, but original graphics, columns, tables and section dividers will not be retained. Check the extracted reading order.';
    else if(design==='text-flow')ai='Can retain supported text styles, paragraph spacing and simple section dividers. Text will reflow; page breaks and exact fonts may change.';
    else ai='Can retain the detected letterhead and footer artwork around an editable body. Body text will reflow; page breaks and exact fonts may change.';
    if(!textModel){
      ai='AI editing and copying text from PDFs are unavailable in this release. Choose Prepare text for AI to review the wording before sharing.';
      const sparse=pages.filter(p=>p.scan).length;
      if(sparse)notes.push(`${sparse} of ${pages.length} pages have text Veil may not be able to read. Draw a box over anything private. AI editing may leave out text in images.`);
      if(pages.some(p=>p.annotations))notes.push('Check every page for private details. Veil may not highlight everything.');
      if(pages.some(p=>p.complex))notes.push('Some words must be protected together as a whole. Check the highlighted area.');
      const linked=pages.filter(p=>p.links).length;
      if(linked)notes.push(`${linked} of ${pages.length} pages have links. Check links for personal details, even where nothing is highlighted. Hidden web addresses are removed from exported PDFs and are not included in the AI prompt.`);
    }
    return {title,redaction,ai,notes};
  }
  return { requireTextSharing, documentFeedback, hasEditingObjective, sourceAction, exportAction, restoreAction, firstUnchecked, withDeadline, readLocalFile };
});
