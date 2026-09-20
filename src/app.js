/* Veil browser application. All document data stays in this closure. */
(async function () {
  'use strict';
  const $ = id => document.getElementById(id), C = VeilCore, W = VeilWorkflow;
  let pdfjs, originalBytes, pdfDocument, pages = [], blocks = [], masks = [], reviewed = new Set();
  let currentPage = 0, zoom = 1, tool = 'inspect', activeBlock = null, history = [], future = [];
  let documentId = '', namespace = '', prepared = null, restored = null, restorePage = 0, sharePage = 0, activeFit = null;
  let busy = false, renderSerial = 0, drag = null, lastBrush = null, dirty = false, restoreSeen = new Set(), pendingFit = false;
  const fitSettings = new Map(), urls = new Set();
  // Both views use the same live controls. Comment anchors put every node back
  // in its original position; switching views never recreates document state.
  let simpleMode = true, simpleStep = 'review', purpose = 'redact';
  let redactedBytes = null, redactedPage = 0, redactedSeen = new Set(), pendingImport = null, sourceInfo = null;
  let pendingRecovery = null, recoveryAttempt = 0, committingRecovery = false, returnOpenFocus = false;
  let redactedPreviewFailed = false, redactedDownloadURL = null, redactedPageCount = 0;
  const actionAnchor = document.createComment('Simple continue position'), privacyAnchor = document.createComment('Privacy confirmation position');
  $('simpleContinue').before(actionAnchor); $('privacyReview').before(privacyAnchor);
  const simpleMoves = [];
  function reserveSimpleGroup(first, last, destination) {
    const nodes = []; let node = first;
    while (node) { nodes.push(node); if (node === last) break; node = node.nextElementSibling; }
    for (const element of nodes) {
      const anchor = document.createComment('Full view position'); element.before(anchor);
      simpleMoves.push({ element, anchor, destination: $(destination) });
    }
  }
  const protectionPanel = document.querySelector('.controls');
  reserveSimpleGroup(protectionPanel.firstElementChild, protectionPanel.querySelector('.coverage'), 'simpleDetectionContent');
  reserveSimpleGroup(document.querySelector('label[for="findText"]'), $('findRemove').parentElement.nextElementSibling, 'simpleFindContent');
  reserveSimpleGroup($('pageList').previousElementSibling, protectionPanel.lastElementChild, 'simplePages');
  reserveSimpleGroup($('blockInspector'), $('blockInspector'), 'simpleInspectorContent');
  function updateSimpleUI() {
    if (simpleMode && purpose === 'redact') simpleStep = 'review';
    const home = !pages.length && !$('prepareView').hidden;
    document.body.classList.toggle('simple-home', simpleMode && home);
    document.body.classList.toggle('simple-restored', simpleMode && !!restored);
    document.body.dataset.simpleStep = simpleStep;
    $('simpleToggle').disabled = busy;
    $('purposeRedact').disabled = $('purposeAI').disabled = busy;
    $('loadRecovery').disabled = busy;
    for (const id of ['recoveryOpen', 'recoveryInline', 'saveRecoveryShare']) $(id).disabled = busy || !pages.length;
    for (const id of ['protectRecovery', 'recoveryPassword', 'recoveryConfirm', 'showRecoveryPassword', 'unlockPassword', 'showUnlockPassword']) $(id).disabled = busy;
    $('unlockRecovery').disabled = busy || !pendingRecovery;
    $('confirmImport').disabled = busy || !pendingImport || !$('importAck').checked;
    $('convertPaste').disabled = busy;
    $('simpleSteps').hidden = !simpleMode || !pages.length;
    $('simpleWelcome').hidden = !simpleMode || !home;
    $('simpleReview').hidden = !simpleMode || !pages.length || simpleStep !== 'review';
    document.querySelectorAll('button[data-simple-step]').forEach(button => {
      if (button.dataset.simpleStep === simpleStep) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      button.disabled = busy || !pages.length;
    });
    $('simpleContinue').disabled = busy || !pages.length || reviewed.size !== pages.length;
    $('simpleBack').disabled = busy;
    $('simpleSensitivity').textContent = { standard: 'Standard', cautious: 'Cautious', maximum: 'Maximum' }[$('sensitivity').value];
    $('simpleProgress').textContent = simpleStep === 'restore' ? 'Private details return on this device.' : `${reviewed.size} of ${pages.length} pages reviewed · ${$('redactionCount').textContent} protections`;
    $('simpleReviewHint').textContent = reviewed.size === pages.length && pages.length ? (purpose === 'redact' ? 'Every page checked. Confirm and preview your export next.' : 'Every page checked. Set your objective next.') : 'Check every page to continue.';
    $('simplePrepareHint').textContent = reviewed.size === pages.length && pages.length ? (purpose === 'redact' ? 'Pages reviewed. Confirm your privacy check, then inspect the exported PDF.' : 'Pages reviewed. Describe the edit, then confirm your privacy check.') : 'Some pages still need review. Go back and check them before preparing files.';
    updateOrdinaryFlow();
  }
  function sourceAction() { return W.sourceAction({ count: pages.length, current: currentPage, reviewed, acknowledged: $('reviewAck').checked, busy }); }
  function exportAction() { return W.exportAction({ count: redactedPageCount || pages.length, viewed: redactedSeen, acknowledged: calmReady || $('redactAck').checked, sourceReady: purpose === 'redact' && reviewed.size === pages.length && $('reviewAck').checked, hasPDF: !!redactedBytes, busy, failed: redactedPreviewFailed }); }
  function updateOrdinaryFlow() {
    const guided = simpleMode && purpose === 'redact' && !!pages.length && !$('prepareView').hidden;
    document.body.classList.toggle('guided-redact', guided); $('redactActionDock').hidden = !guided;
    if (guided) {
      if ($('simpleContinue').parentElement !== $('redactActionSlot')) $('redactActionSlot').append($('simpleContinue'));
      if ($('privacyReview').parentElement !== $('redactPrivacySlot')) $('redactPrivacySlot').append($('privacyReview'));
      const action = sourceAction();
      $('simpleContinue').textContent = busy ? 'Please wait…' : action.label; $('simpleContinue').disabled = action.disabled;
      $('simpleContinue').setAttribute('aria-describedby', 'redactActionHint');
      $('redactActionTitle').textContent = action.kind === 'preview' ? 'Ready to make your PDF' : `Check page ${currentPage + 1} of ${pages.length}`;
      $('redactActionHint').textContent = action.hint;
      $('privacyReview').hidden = action.kind !== 'preview';
      document.querySelector('button[data-simple-step="prepare"]').disabled = busy || action.kind !== 'preview' || !$('reviewAck').checked;
    } else {
      if ($('simpleContinue').previousSibling !== actionAnchor) actionAnchor.after($('simpleContinue'));
      if ($('privacyReview').previousSibling !== privacyAnchor) privacyAnchor.after($('privacyReview'));
      $('simpleContinue').removeAttribute('aria-describedby'); $('privacyReview').hidden = false;
    }
    $('simpleReviewHint').hidden = guided; $('reviewAck').disabled = busy;
    $('reviewLead').textContent = purpose === 'redact' ? 'Review the highlighted details. Use Add, Remove or Area mask to change what will be hidden. Confirm each page with the button at the bottom.' : 'Review the highlights. Use Add, Remove or Area mask to adjust them, then check off each page.';
    if (purpose === 'redact') $('exportHint').textContent = reviewed.size !== pages.length ? 'Check each source page first.' : !$('reviewAck').checked ? 'Tick the privacy confirmation above to continue.' : 'Next: check the actual PDF, then download it.';
    const output = exportAction();
    $('downloadRedacted').textContent = busy ? 'Please wait…' : output.label; $('downloadRedacted').disabled = output.disabled;
    $('downloadRedacted').setAttribute('aria-describedby', 'redactNextHint'); $('redactNextHint').textContent = output.hint;
    $('redactAckRow').hidden = calmReady || output.kind !== 'download'; $('redactAck').disabled = busy || output.kind !== 'download';
    if(calmReady&&output.kind==='download'){$('downloadRedacted').textContent=busy?'Please wait…':'Download checked PDF';$('redactNextHint').textContent='Downloading confirms you have checked every preview page and the details you want hidden are covered.';}
    $('redactPrev').disabled = busy || !redactedBytes || redactedPage === 0;
    $('redactNext').disabled = busy || !redactedBytes || redactedPage === (redactedPageCount || pages.length) - 1;
    const downloadable = output.kind === 'download' && !output.disabled;
    if (downloadable && redactedDownloadURL) $('redactDirectDownload').href = redactedDownloadURL;
    else $('redactDirectDownload').removeAttribute('href');
  }
  async function advanceRedaction() {
    const action = sourceAction();
    if (!pages.length) return;
    if (action.kind === 'review') { reviewed.add(currentPage); updatePageList(); updateButtons(); }
    const next = W.firstUnchecked(pages.length, reviewed);
    if (next !== -1) { currentPage = next; activeBlock = null; showInspector(null); await renderPage(); status(pageNotice()); return; }
    if (action.kind === 'preview' && $('reviewAck').checked) { await generate(); return; }
    updateButtons(); status('Every source page checked. Confirm the privacy check below, then preview your redacted PDF.');
  }
  function setPurpose(value) {
    purpose = value; const ai = purpose === 'ai'; document.body.dataset.purpose = purpose;
    $('purposeRedact').setAttribute('aria-pressed', String(!ai)); $('purposeAI').setAttribute('aria-pressed', String(ai));
    $('heroTitle').textContent = 'Protect sensitive details';
    $('purposeHint').textContent = ai ? 'Protect, draft elsewhere, then restore here.' : 'A permanently redacted PDF. No AI steps.';
    $('simplePrepareLabel').textContent = ai ? 'Prepare' : 'Preview & download';
    $('reviewStepLabel').textContent = ai ? 'STEP 1 OF 3' : 'STEP 1 OF 2';
    $('simpleContinue').textContent = ai ? 'Continue to prepare →' : 'Continue to export →';
    $('prepareHeading').textContent = ai ? 'Review & prepare' : 'Review & export';
    $('generate').textContent = ai ? 'Prepare AI files →' : 'Generate redacted PDF →';
    $('exportHint').textContent = ai ? 'You decide what to upload, and where.' : 'Preview the actual file before downloading.';
    $('welcomeOutputTitle').textContent = ai ? 'Take a protected copy to AI' : 'Download a redacted PDF';
    $('welcomeOutputText').textContent = ai ? 'Veil prepares your files and instructions.' : 'Check the export, then share it yourself.';
    if (!ai && !$('restoreView').hidden) showView(false);
    updateSimpleUI();
  }
  function resetRedacted() {
    redactedBytes = null; redactedSeen.clear(); redactedPage = 0; redactedPageCount = 0;
    redactedPreviewFailed = false;
    if (redactedDownloadURL) { URL.revokeObjectURL(redactedDownloadURL); urls.delete(redactedDownloadURL); redactedDownloadURL = null; }
    $('redactDirectDownload').removeAttribute('href'); $('redactDownloadStatus').hidden = true; $('redactDownloadStatus').textContent = ''; $('redactDownloadHelp').hidden = true; $('redactDownloadHelp').open = false;
    $('redactPreviewError').hidden = true; $('redactPreviewError').textContent = '';
    $('redactAck').checked = false; $('redactDialog').close(); $('downloadRedacted').disabled = true;
    $('redactCanvas').width = $('redactCanvas').height = 1;
  }
  function setInterface(simple) {
    simpleMode = simple;
    for (const { element, anchor, destination } of simpleMoves) {
      if (simple) destination.append(element); else anchor.after(element);
    }
    if (!$('restoreView').hidden) simpleStep = 'restore';
    else if (simpleStep === 'restore') simpleStep = 'review';
    if (simple && activeBlock) $('simplePrecision').open = true;
    document.body.classList.toggle('simple-mode', simple);
    $('simpleToggle').setAttribute('aria-checked', String(simple));
    updateSimpleUI();
  }
  async function goSimpleStep(step) {
    simpleStep = step; showView(step === 'restore');
    if (pages.length && step !== 'restore') await renderPage();
    status(step === 'restore' ? 'Paste the AI’s final reply, then preview your updated document.' : pageNotice());
  }
  const LIMIT_BYTES = 25 * 1024 * 1024, LIMIT_PAGES = 60, SCALE_EXPORT = 300 / 72;
  const sensitivityHints = {
    standard: 'Common structured identifiers, recognised profile/repository links and names with titles. Other web links need manual checking.',
    cautious: 'Includes other recognised web links, possible names, addresses and ambiguous identifiers. Expect some extra selections.',
    maximum: 'Includes every number and capitalised word. Many false positives; context and images still need review.'
  };
  function status(message, error = false) { $('status').textContent = message; $('status').className = 'status' + (error ? ' error' : busy ? ' busy' : ''); const visible=$('calmStatus');if(visible){visible.textContent=message;visible.className=error?'error':'';} }
  function fail(error) { status(error instanceof Error ? error.message : 'The operation could not be completed.', true); }
  async function run(message, fn) {
    if (busy) return;
    busy = true; document.body.classList.add('working'); $('prepareView').inert = true; $('restoreView').inert = true; status(message); updateButtons();
    try { await fn(); } catch (e) { fail(e); }
    finally { busy = false; if ($('status').textContent === message && !$('status').classList.contains('error')) status(''); document.body.classList.remove('working'); $('prepareView').inert = false; $('restoreView').inert = false; $('status').classList.remove('busy'); updateButtons(); calmAfterRun(); if ($('unlockDialog').open) $('unlockPassword').focus(); else if (returnOpenFocus) { returnOpenFocus = false; $('loadRecovery').focus(); } }
  }
  function blobURL(data, type) { const url = URL.createObjectURL(new Blob([data], { type })); urls.add(url); return url; }
  function download(data, type, filename) {
    const url = blobURL(data, type), a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 10000);
  }
  function make(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
  function intersect(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function union(rects) {
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
  }
  function expand(r, padding = 1.7) { return { x: r.x - padding, y: r.y - padding, w: r.w + padding * 2, h: r.h + padding * 2 }; }
  function pageBlocks(n) { return blocks.filter(b => b.page === n + 1); }
  function selectedType(b, i) { return b.overrides[i] == null ? b.auto[i] : b.overrides[i]; }
  function ensureDocument() { if (!pdfDocument) throw new Error('Open a PDF, paste text or open saved work first.'); }
  function resetRestored() {
    $('replyHelp').hidden = true; $('replyFixPrompt').value = ''; $('replyFixStatus').textContent = ''; $('replyFixDetails').open = false;
    restored = null; restoreSeen.clear(); fitSettings.clear(); activeFit = null; pendingFit = false; $('restoreAck').checked = false; $('downloadRestored').disabled = true;
    $('restoredCanvas').hidden = true; $('restoreEmpty').hidden = false; $('changedBlocks').replaceChildren(); $('fitControls').hidden = true;
    updateSimpleUI();
  }
  function invalidate(pageNumbers) {
    calmInvalidate();
    dirty = true; prepared = null; documentId = crypto.randomUUID(); resetRestored(); resetRedacted(); $('reviewAck').checked = false;
    if (pageNumbers) for (const n of pageNumbers) reviewed.delete(n); else reviewed.clear();
    $('shareDialog').close(); $('promptPreview').value = ''; $('replyJson').value = ''; $('replyStatus').textContent = 'Prepare the AI files again after changing protection.';
    updatePageList(); updateButtons(); updateCount();
  }
  function snapshot() { return { overrides: blocks.map(b => [...b.overrides]), masks: structuredClone(masks) }; }
  function remember() { history.push(snapshot()); if (history.length > 30) history.shift(); future = []; }
  function restoreSnapshot(s) { blocks.forEach((b, i) => { b.overrides = s.overrides[i]; }); masks = s.masks; invalidate(); drawOverlay(); showInspector(activeBlock); }
  function updateButtons() {
    $('generate').disabled = busy || !pages.length || reviewed.size !== pages.length || !$('reviewAck').checked;
    $('pageReviewed').disabled = !pages.length; $('pageReviewed').checked = reviewed.has(currentPage);
    $('undo').disabled = !history.length || busy; $('redo').disabled = !future.length || busy;
    const restoreNext = restoredAction();
    $('downloadRestored').disabled = restoreNext.kind !== 'download' || restoreNext.disabled;
    $('restoreDownloadHint').textContent = restoreNext.hint;
    $('restoreNextAction').hidden = !['apply', 'fit', 'navigate'].includes(restoreNext.kind);
    $('restoreNextAction').textContent = restoreNext.label || 'Continue review →'; $('restoreNextAction').disabled = restoreNext.disabled;
    $('restoreAck').disabled = busy || !['confirm', 'download'].includes(restoreNext.kind);
    $('saveRecovery').disabled = busy || !pages.length;
    updateSimpleUI();
    calmRefresh();
  }
  function updateCount() {
    const count = blocks.reduce((n, b) => n + C.segments(b.text, b.auto, b.overrides).length, 0) + masks.length;
    $('redactionCount').textContent = count;
    updateSimpleUI();
  }
  function updatePageList() {
    $('pageList').replaceChildren();
    pages.forEach((p, i) => {
      const button = make('button', 'page-button' + (i === currentPage ? ' active' : '') + (reviewed.has(i) ? ' reviewed' : ''));
      button.append(make('span', '', 'Page ' + (i + 1)), make('span', '', reviewed.has(i) ? '✓ Reviewed' : p.scan ? 'Manual review' : 'To review'));
      button.addEventListener('click', () => run('Rendering page…', async () => { currentPage = i; activeBlock = null; showInspector(null); await renderPage(); status(pageNotice()); }));
      $('pageList').append(button);
    });
    $('reviewCount').textContent = `${reviewed.size}/${pages.length} reviewed`;
    $('pageReviewed').checked = reviewed.has(currentPage);
  }
  function pageNotice() {
    if(calmRows)return 'Review the text and adjust protection. Use Undo to reverse a change.';
    const p = pages[currentPage];
    if (!p) return '';
    const notices = [];
    if (p.scan) notices.push('Veil cannot read some text on this page. Draw a box over anything private.');
    if (p.complex) notices.push('Some words must be protected together. Check the highlighted area.');
    if (p.annotations) notices.push('Check every page for private details. Veil may not highlight everything.');
    if (p.links) notices.push('Check links for personal details, even where nothing is highlighted.');
    return notices.join(' ') || 'Check every page for private details. Veil may not highlight everything.';
  }
  async function clearData() {
    calmReset();
    renderSerial++;
    if (pdfDocument) {const oldDoc=pdfDocument;try{await W.withDeadline(oldDoc.destroy(),5000,'Closing the previous PDF took too long.');}catch{/* The previous session is being cleared explicitly. */}}
    originalBytes = null; pdfDocument = null; pages = []; blocks = []; masks = []; reviewed.clear(); history = []; future = []; resetRedacted(); sourceInfo = null;
    currentPage = 0; activeBlock = null; prepared = null; resetRestored(); dirty = false; documentId = ''; namespace = ''; simpleStep = 'review';
    $('pdfInput').value = ''; $('jsonInput').value = ''; $('recoveryInput').value = ''; $('goal').value = ''; $('replyJson').value = ''; $('promptPreview').value = '';
    $('findText').value = ''; $('reviewAck').checked = false; $('recoveryPassword').value = ''; $('recoveryConfirm').value = '';
    $('pageStage').hidden = true; $('dropzone').hidden = false; $('fileLabel').textContent = 'Your document'; $('pageLabel').textContent = 'No document loaded'; $('sessionId').textContent = 'No document loaded';
    $('importNotice').hidden = true; $('importNoticeText').textContent = ''; $('pastedText').value = '';
    for (const id of ['pageCanvas', 'selectionCanvas', 'restoredCanvas', 'shareCanvas']) { $(id).width = 1; $(id).height = 1; }
    $('blockInspector').replaceChildren(make('span', 'mini-title', 'PRECISE SELECTION'), make('p', 'hint', 'Click a text block to inspect its characters.'));
    updatePageList(); updateCount(); updateButtons();
  }
  async function loadPDF(bytes, fileLabel, recoveryState = null, canCommit = () => true, assessDesign = true) {
    if (bytes.byteLength > LIMIT_BYTES) throw new Error('This PDF is too large. The limit is 25 MB.');
    const prefix = new TextDecoder().decode(bytes.subarray(0, 1024));
    if (!prefix.includes('%PDF-')) throw new Error('Choose a valid PDF file.');
    status('Opening the PDF reader…');
    const task = pdfjs.getDocument({ data: bytes.slice(), BinaryDataFactory: class {
      async fetch({ kind, filename }) {
        const data = BUNDLE.assets[kind]?.[filename];
        if (!data) throw new Error('Required PDF asset is not embedded.');
        return C.from64(data);
      }
    }, useWorkerFetch: false, useSystemFonts: false, isEvalSupported: false, enableXfa: false, stopAtErrors: true,
      cMapPacked: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, disableAutoFetch: true,
      canvasMaxAreaInBytes: 128_000_000, verbosity: 0 });
    let newDoc;
    const dispose=()=>{try{Promise.resolve(task.destroy()).catch(()=>{});}catch{}};
    const pdfStep=(promise,label)=>W.withDeadline(promise,45000,label+' took too long. Try a locally saved PDF or open this copy of Veil in another browser.',dispose);
    try { newDoc = await pdfStep(task.promise,'Starting the PDF reader'); } catch(error) { dispose(); if(error.code==='VEIL_TIMEOUT')throw error;throw new Error('This PDF could not be opened. Password-protected, damaged or unsupported PDFs must be converted to a supported PDF first.'); }
    try {
      if (newDoc.isPureXfa) throw new Error('XFA forms are not supported. Export a static PDF first.');
      if (newDoc.numPages > LIMIT_PAGES) throw new Error('This PDF exceeds the 60-page limit. Split it into smaller files.');
      const newPages = [], newBlocks = [];
      for (let i = 0; i < newDoc.numPages; i++) {
        status(`Opening page ${i + 1} of ${newDoc.numPages}…`);
        const page = await pdfStep(newDoc.getPage(i + 1),'Opening PDF page '+(i+1)), viewport = page.getViewport({ scale: 1 });
        if (viewport.width * viewport.height * SCALE_EXPORT * SCALE_EXPORT > 26_000_000 || Math.max(viewport.width, viewport.height) * SCALE_EXPORT > 16384) throw new Error('A page is too large to export safely at 300 DPI. Use a PDF with smaller pages.');
        status(`Reading text on page ${i+1} of ${newDoc.numPages}…`);
        const content = await pdfStep(page.getTextContent({ includeMarkedContent: false, disableNormalization: false }),'Reading PDF text on page '+(i+1));
        status(`Reading fonts and graphics on page ${i+1} of ${newDoc.numPages}…`);
        const operatorList = await pdfStep(page.getOperatorList(),'Reading PDF graphics on page '+(i+1));
        for (let op = 0; op < operatorList.fnArray.length; op++) {
          const fn = operatorList.fnArray[op], args = operatorList.argsArray[op];
          const isImage = fn === pdfjs.OPS.paintImageXObject;
          const inline = fn === pdfjs.OPS.paintInlineImageXObject || fn === pdfjs.OPS.paintImageMaskXObject;
          if ((isImage && args[1] * args[2] > 32_000_000) || (inline && args[0]?.width * args[0]?.height > 32_000_000)) throw new Error('A source image exceeds the safe decoding limit. Reduce its resolution before using this PDF.');
        }
        const fontStyles={};for(const item of content.items){if(!item.fontName||fontStyles[item.fontName])continue;let name='';try{if(page.commonObjs.has(item.fontName))name=page.commonObjs.get(item.fontName)?.name||'';}catch{}fontStyles[item.fontName]=F.pdfTextStyle(name,content.styles[item.fontName]?.fontFamily);}
        const extracted = extractBlocks(content, viewport, i + 1, newBlocks.length, glyphMetrics(operatorList,page),fontStyles,F.operatorTextColors(operatorList,pdfjs.OPS));
        if (newBlocks.length + extracted.length > 2500) throw new Error('This document has too many text blocks for a reliable editing session. Split the PDF.');
        newBlocks.push(...extracted);
        const annotations = await pdfStep(page.getAnnotations({ intent: 'display' }),'Reading PDF annotations on page '+(i+1));
        const links=annotations.filter(a=>a.subtype==='Link'&&(a.url||a.unsafeUrl));
        const identifyingLinks=links.filter(a=>C.detect(String(a.url||a.unsafeUrl),'standard').some(h=>['URL','EMAIL','PHONE','ID'].includes(h.type))).length;
        newPages.push({ width: viewport.width, height: viewport.height, scan: extracted.reduce((n, b) => n + b.text.trim().length, 0) < 20, complex: extracted.some(b => b.locked), annotations: annotations.length,links:links.length,identifyingLinks });
      }
      if (newBlocks.reduce((n, b) => n + b.text.length, 0) > 250000) throw new Error('This PDF contains too much text for one session. Split the document.');
      if (recoveryState) validateSavedDocument(recoveryState, newPages, newBlocks);
      if (!canCommit()) throw new Error('Opening saved work cancelled. Your current work is unchanged.');
      committingRecovery = Boolean(recoveryState);
      await clearData();
      if (!canCommit()) {calmShow('start');throw new Error('Opening saved work cancelled.');}
      originalBytes = bytes.slice(); pdfDocument = newDoc; pages = newPages; blocks = newBlocks;
      documentId = recoveryState?.documentId || crypto.randomUUID(); namespace = recoveryState?.namespace || Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      if (recoveryState) restoreSavedState(recoveryState);
      applyDetection();
      $('fileLabel').textContent = fileLabel; $('sessionId').textContent = 'Session ' + namespace;
      $('dropzone').hidden = true; $('pageStage').hidden = false; dirty = true;
      updatePageList(); updateCount(); updateButtons();status('Rendering the first page…'); await renderPage();
      if (recoveryState?.prepared && !calmReady) {
        prepareData(); $('replyStatus').textContent = 'Saved work opened. Paste the AI’s final reply for this document.';
        if (recoveryState.reply) {
          $('replyJson').value = recoveryState.reply; await validateReply();
          for (const [id, fit] of recoveryState.fits || []) {
            if (!fitSettings.has(id)) throw new Error('Saved text layout does not match an edited block.');
            fitSettings.set(id, { ...fit, areaAck: false });
          }
          refreshChanges(); await showRestoredPage();
          $('replyStatus').textContent = 'Approved edits and text layout reopened. Review every edited box and page again before downloading.';
        }
      }
      calmLoaded(recoveryState); if(assessDesign)await calmAssessDocument(); await renderPage();
      status(pageNotice());
    } catch (error) { if (newDoc !== pdfDocument) dispose();else {await clearData();calmShow('start');} throw error; }
    finally { committingRecovery = false; }
  }
  function glyphMetrics(operators,page) {
    return F.positionedGlyphs(operators,pdfjs.OPS,id=>{try{return page.commonObjs.get(id);}catch{return null;}});
  }
  function extractBlocks(content, viewport, pageNo, firstIndex, metricsByRun,fontStyles={},textColors=new Map()) {
    const lines = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim().length) continue;
      const t = pdfjs.Util.transform(viewport.transform, item.transform), style = content.styles[item.fontName] || {};
      const h = Math.max(1, Math.hypot(t[2], t[3])), width = Math.max(.1, item.width * viewport.scale), angle = Math.atan2(t[1], t[0]);
      const metrics = metricsByRun.resolve?metricsByRun.resolve(item):null;
      const skew = Math.abs(t[0] * t[2] + t[1] * t[3]) / Math.max(.001, Math.hypot(t[0], t[1]) * h);
      const reflowSafe = item.transform[0]*item.transform[3]-item.transform[1]*item.transform[2]>0 && Math.abs(angle) <= .01 && skew <= .001 && !style.vertical && item.dir !== 'rtl';
      const locked = !reflowSafe || !metrics;
      const ascent = Number.isFinite(style.ascent) ? style.ascent : .85;
      const descent = Number.isFinite(style.descent) ? style.descent : -.22;
      const family = style.fontFamily || 'sans-serif';
      const rect = locked ? polygonBounds(t, width, h, ascent, descent) : { x: t[4], y: t[5] - h * ascent, w: width, h: h * (ascent - descent) };
      const chars = Array.from({ length: item.str.length }, (_, i) => locked ? { ...rect } : { x: rect.x + metrics[i].start * width, y: rect.y, w: Math.max(.1, (metrics[i].end - metrics[i].start) * width), h: rect.h });
      const displayText=Array.from(item.str,(ch,i)=>metrics?.[i]?.display||ch).join('');
      const runStyle={size:h,...fontStyles[item.fontName],color:textColors.get(item.fontName+'\0'+item.str)||'#17212b'};
      const isBullet=l=>/^[■•●▪◦‣]$/.test(l.text.trim());
      let line = !locked && lines.find(l => !l.locked && (isBullet(l)?Math.abs(l.baseline-t[5])<h*.6:Math.abs(l.baseline-t[5])<h*.22&&Math.abs(l.fontSize-h)<h*.2) && rect.x >= l.rect.x + l.rect.w - 1 && rect.x - (l.rect.x + l.rect.w) < h * 2.2);
      if (line) {
        const joinsBullet=isBullet(line);
        if(joinsBullet){line.fontSize=h;line.baseline=t[5];line.textStyle={...fontStyles[item.fontName],color:runStyle.color};}
        const gap = rect.x - (line.rect.x + line.rect.w);
        if ((joinsBullet||gap > h * .16) && !/\s$/.test(line.text) && !/^\s/.test(item.str)) { line.text += ' '; line.chars.push(null);line.textRuns.push({text:' ',style:runStyle}); }
        line.text += displayText; line.textRuns.push({text:displayText,style:runStyle});line.chars.push(...chars); line.rect = union([line.rect, rect]);
      } else lines.push({ text: displayText,textRuns:[{text:displayText,style:runStyle}], chars, rect, fontSize: h, family, textStyle:{...fontStyles[item.fontName],color:textColors.get(item.fontName+'\0'+item.str)||'#17212b'}, baseline: t[5], locked, reflowSafe });
    }
    // PDF drawing order may place a marker after its text. Join only one unambiguous
    // neighbouring line, retaining every real glyph rectangle and a synthetic space.
    for(const bullet of [...lines].filter(l=>!l.locked&&/^[■•●▪◦‣]$/.test(l.text.trim()))){
      const candidates=lines.filter(l=>l!==bullet&&!l.locked&&!/^[■•●▪◦‣]/.test(l.text.trim())&&Math.abs(l.baseline-bullet.baseline)<l.fontSize*.6&&l.rect.x>=bullet.rect.x+bullet.rect.w-1&&l.rect.x-bullet.rect.x-bullet.rect.w<l.fontSize*2.2);
      if(candidates.length!==1)continue;
      const line=candidates[0];line.text=bullet.text+' '+line.text;line.textRuns=[...bullet.textRuns,{text:' ',style:line.textRuns[0].style},...line.textRuns];line.chars=[...bullet.chars,null,...line.chars];line.rect=union([bullet.rect,line.rect]);lines.splice(lines.indexOf(bullet),1);
    }
    lines.sort((a, b) => Math.abs(a.rect.y - b.rect.y) < 2 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y);
    const out = [];
    for (const line of lines) {
      const prev = out.at(-1), gap = prev ? line.rect.y - (prev.rect.y + prev.rect.h) : Infinity;
      if (prev && !prev.locked && !line.locked && !/^[■•●▪◦‣]/.test(line.text.trim()) && Math.abs(prev.rect.x - line.rect.x) < line.fontSize * .6 && Math.abs(prev.fontSize - line.fontSize) < .7 && gap >= -1 && gap < line.fontSize * .65 && line.rect.w > prev.rect.w * .35 && !/[.:]$/.test(prev.text.trim()) && prev.text.length < 3000) {
        prev.lineAdvance=(line.baseline-prev.baseline)/prev.lines;prev.textRuns.push({text:'\n',style:line.textRuns[0].style},...line.textRuns);prev.text += '\n' + line.text; prev.chars.push(null, ...line.chars); prev.rect = union([prev.rect, line.rect]); prev.lines++;
      } else out.push({ ...line, chars: [...line.chars], lines: 1 });
    }
    return out.map((b, i) => ({ ...b, id: `B${String(firstIndex + i + 1).padStart(4, '0')}`, page: pageNo, auto: Array(b.text.length).fill(''), overrides: Array(b.text.length).fill(null) }));
  }
  function polygonBounds(t, width, h, ascent, descent) {
    const baseline = Math.max(.001, Math.hypot(t[0], t[1]));
    const points = [[0, ascent], [width, ascent], [0, descent], [width, descent]].map(([x, rise]) => ({ x: t[4] + x * t[0] / baseline + t[2] * rise, y: t[5] + x * t[1] / baseline + t[3] * rise }));
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
    return { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y };
  }
  function applyDetection() {
    const level = $('sensitivity').value;
    detectBlocks(blocks, level);
    $('sensitivityHint').textContent = sensitivityHints[level];
  }
  function detectBlocks(targetBlocks, level) {
    // Run across block boundaries too, so split text runs do not evade address/date matches.
    const text = targetBlocks.map(b => b.text).join('\n'), all = C.autoTypes(text, level);
    let cursor = 0;
    for (const b of targetBlocks) {
      b.auto = all.slice(cursor, cursor + b.text.length); cursor += b.text.length + 1;
      if (b.locked) {
        const types = b.auto.filter(Boolean).sort((a, c) => (C.priority[c] || 0) - (C.priority[a] || 0));
        if (types.length) b.auto.fill(types[0]);
        if (b.overrides.some(v => v === 'CUSTOM')) b.overrides.fill('CUSTOM');
        else if (b.overrides.some(v => v === '')) b.overrides.fill('');
      }
    }
  }
  async function renderBase(pageIndex, scale) {
    const page = await W.withDeadline(pdfDocument.getPage(pageIndex + 1),45000,'Opening the page preview took too long. Try reopening a local copy of the PDF.'), viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const renderTask=page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff', annotationMode: pdfjs.AnnotationMode.ENABLE });
    try { await W.withDeadline(renderTask.promise,45000,'Rendering the PDF page took too long. Try a smaller PDF or another browser.',()=>renderTask.cancel()); }
    catch(error) { canvas.width = canvas.height = 1;if(error.code==='VEIL_TIMEOUT')throw error; throw new Error(`Page ${pageIndex + 1} could not be fully rendered. Generation is blocked.`); }
    return canvas;
  }
  async function renderPage() {
    if (!pages.length) return;
    const serial = ++renderSerial, p = pages[currentPage];
    const available = Math.max(260, $('documentViewport').clientWidth - 60), displayScale = Math.min(1.15, available / p.width) * zoom;
    const canvas = await renderBase(currentPage, displayScale * Math.min(2, devicePixelRatio || 1));
    if (serial !== renderSerial) return;
    const base = $('pageCanvas'), overlay = $('selectionCanvas');
    base.width = canvas.width; base.height = canvas.height; base.getContext('2d').drawImage(canvas, 0, 0); canvas.width = canvas.height = 1;
    base.style.width = overlay.style.width = p.width * displayScale + 'px'; base.style.height = overlay.style.height = p.height * displayScale + 'px';
    overlay.width = base.width; overlay.height = base.height;
    $('pageStage').style.width = base.style.width; $('pageStage').style.height = base.style.height;
    $('pageLabel').textContent = `Page ${currentPage + 1} of ${pages.length}`; $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
    if (calmReady) calmVisited.add(currentPage);
    drawOverlay(); updatePageList(); updateButtons();
  }
  function maskRects(block) {
    // Coalesce adjacent selected character boxes on a baseline, with a safety margin.
    const rects = []; let last = null;
    block.chars.forEach((char, i) => {
      if (!char || !selectedType(block, i)) { last = null; return; }
      if (last && Math.abs(last.y - char.y) < .5 && char.x - (last.x + last.w) < 2 && char.x >= last.x) { last.w = Math.max(last.w, char.x + char.w - last.x); last.h = Math.max(last.h, char.h); }
      else { last = { ...char }; rects.push(last); }
    });
    return rects.map(r => expand(r, Math.max(1.7, r.h * .15)));
  }
  function drawOverlay() {
    if (!pages.length) return;
    const canvas = $('selectionCanvas'), ctx = canvas.getContext('2d'), scale = canvas.width / pages[currentPage].width;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.scale(scale, scale);
    const solid = $('maskPreview').checked;
    for (const b of pageBlocks(currentPage)) {
      for (const r of maskRects(b)) { ctx.fillStyle = solid ? '#111820' : 'rgba(0,145,112,.30)'; ctx.fillRect(r.x, r.y, r.w, r.h); if (!solid) { ctx.strokeStyle = 'rgba(0,110,85,.7)'; ctx.lineWidth = .5; ctx.strokeRect(r.x, r.y, r.w, r.h); } }
      if (b.id === activeBlock) { ctx.strokeStyle = '#1d6bc1'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(b.rect.x - 2, b.rect.y - 2, b.rect.w + 4, b.rect.h + 4); ctx.setLineDash([]); }
    }
    for (const m of masks.filter(m => m.page === currentPage + 1)) { ctx.fillStyle = solid ? '#111820' : 'rgba(27,68,116,.4)'; ctx.fillRect(m.x, m.y, m.w, m.h); ctx.strokeStyle = '#204c7e'; ctx.lineWidth = 1; ctx.strokeRect(m.x, m.y, m.w, m.h); }
    if (drag && tool === 'area') { const r = dragRect(); ctx.fillStyle = '#1d6bc133'; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = '#1d6bc1'; ctx.strokeRect(r.x, r.y, r.w, r.h); }
    ctx.restore();
  }
  function showInspector(id) {
    activeBlock = id; const panel = $('blockInspector'); panel.replaceChildren();
    panel.append(make('span', 'mini-title', 'PRECISE SELECTION'));
    const b = blocks.find(b => b.id === id);
    if (!b) { panel.append(make('p', 'hint', 'Click a text block on the page, then click characters here to add or remove protection. Use an area mask for images.')); return; }
    if (simpleMode) { simpleStep = 'review'; $('simplePrecision').open = true; updateSimpleUI(); }
    const meta = make('div', 'block-meta'); meta.append(make('span', 'block-id', b.id), make('span', 'muted', b.locked ? 'Complex text · edits locked' : 'Page ' + b.page)); panel.append(meta);
    const charBox = make('div', 'character-editor'); charBox.setAttribute('aria-label', 'Toggle protection for each character');
    for (let i = 0; i < b.text.length; i++) {
      const char = b.text[i];
      if (char === '\n') { charBox.append(document.createElement('br')); continue; }
      const protectedType = selectedType(b, i), button = make('button', protectedType ? 'protected' : '', char);
      button.setAttribute('aria-label', `${protectedType ? 'Unprotect' : 'Protect'} character ${i + 1}: ${char === ' ' ? 'space' : char}`);
      button.title = protectedType ? `${protectedType.toLowerCase()} · click to unprotect` : 'Click to protect';
      button.addEventListener('click', () => { remember(); if (b.locked) b.overrides.fill(protectedType ? '' : 'CUSTOM'); else b.overrides[i] = protectedType ? '' : 'CUSTOM'; invalidate([b.page - 1]); showInspector(id); drawOverlay(); }); charBox.append(button);
    }
    panel.append(charBox);
    const row = make('div', 'button-row');
    for (const [label, value] of [['Protect block', 'CUSTOM'], ['Unprotect block', '']]) { const button = make('button', '', label); button.addEventListener('click', () => { remember(); b.overrides.fill(value); invalidate([b.page - 1]); showInspector(id); drawOverlay(); }); row.append(button); }
    panel.append(row, make('p', 'hint', b.locked ? 'These words must be protected together. Selecting any part protects the whole highlighted area.' : 'Green letters are protected. Zoom in on the redacted preview to check that the whole word is covered.'));
    const reasons = [...new Set(C.detect(b.text, $('sensitivity').value).map(h => h.reason))];
    if (reasons.length) panel.append(make('p', 'hint', 'Suggestions: ' + reasons.join('; ') + '.'));
  }
  function pointerPosition(event) {
    const r = $('selectionCanvas').getBoundingClientRect(), p = pages[currentPage];
    return { x: Math.max(0, Math.min(p.width, (event.clientX - r.left) / r.width * p.width)), y: Math.max(0, Math.min(p.height, (event.clientY - r.top) / r.height * p.height)) };
  }
  function paint(point) {
    const radius = Number($('brushSize').value), box = { x: point.x - radius, y: point.y - radius, w: radius * 2, h: radius * 2 };
    let changed = false;
    for (const b of pageBlocks(currentPage)) {
      if (!intersect(expand(b.rect, radius), box)) continue;
      b.chars.forEach((char, i) => { if (char && intersect(char, box)) { const v = tool === 'remove' ? '' : 'CUSTOM'; if (b.overrides[i] !== v) { b.overrides[i] = v; changed = true; } } });
      if (changed && b.locked) b.overrides.fill(tool === 'remove' ? '' : 'CUSTOM');
    }
    if (tool === 'remove') { const next = masks.filter(m => m.page !== currentPage + 1 || !intersect(m, box)); if (next.length !== masks.length) { masks = next; changed = true; } }
    return changed;
  }
  function paintPath(point) {
    let changed = false;
    if (lastBrush) {
      const dist = Math.hypot(point.x - lastBrush.x, point.y - lastBrush.y), steps = Math.max(1, Math.ceil(dist / Math.max(1, Number($('brushSize').value) / 2)));
      for (let i = 1; i <= steps; i++) changed = paint({ x: lastBrush.x + (point.x - lastBrush.x) * i / steps, y: lastBrush.y + (point.y - lastBrush.y) * i / steps }) || changed;
    } else changed = paint(point);
    lastBrush = point; if (changed && drag) drag.changed = true; drawOverlay();
  }
  function dragRect() { return { x: Math.min(drag.start.x, drag.end.x), y: Math.min(drag.start.y, drag.end.y), w: Math.abs(drag.end.x - drag.start.x), h: Math.abs(drag.end.y - drag.start.y) }; }
  $('selectionCanvas').addEventListener('pointerdown', event => {
    if (!pages.length || busy) return;
    const p = pointerPosition(event);
    if (tool === 'inspect') { const b = pageBlocks(currentPage).find(b => intersect(expand(b.rect, 2), { x: p.x, y: p.y, w: .1, h: .1 })); showInspector(b?.id); if (calmReady && b && !$('calmPrecision').open) $('calmPrecision').showModal(); drawOverlay(); return; }
    remember(); drag = { start: p, end: p, changed: false }; lastBrush = null; $('selectionCanvas').setPointerCapture(event.pointerId);
    if (tool !== 'area') paintPath(p);
  });
  $('selectionCanvas').addEventListener('pointermove', event => { if (!drag) return; const p = pointerPosition(event); drag.end = p; if (tool === 'area') drawOverlay(); else paintPath(p); });
  function finishDrag() {
    if (!drag) return;
    if (tool === 'area') {
      const r = dragRect(); if (r.w > 2 && r.h > 2) {
        masks.push({ ...r, page: currentPage + 1, id: crypto.randomUUID() });
        for (const b of pageBlocks(currentPage)) { let touched = false; b.chars.forEach((ch, i) => { if (ch && intersect(ch, r)) { b.overrides[i] = 'CUSTOM'; touched = true; } }); if (touched && b.locked) b.overrides.fill('CUSTOM'); }
        drag.changed = true;
      }
    }
    const changed = drag.changed; drag = null; lastBrush = null;
    if (changed) invalidate([currentPage]); else history.pop();
    showInspector(activeBlock); drawOverlay(); updateButtons();
  }
  $('selectionCanvas').addEventListener('pointerup', finishDrag); $('selectionCanvas').addEventListener('pointercancel', finishDrag);
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
    tool = button.dataset.tool; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected', b === button));
    $('toolHint').textContent = tool === 'area' ? 'Draw a reversible area mask. The Remove brush removes whole area masks; text selections remain separately editable.' : tool === 'inspect' ? 'Click a text block to inspect and toggle exact characters.' : `${tool === 'add' ? 'Add protection' : 'Remove protection'} by brushing over characters. Fine, medium and broad sizes are available.`;
  }));
  function findMatches(protect) {
    ensureDocument(); const needle = $('findText').value; if (!needle) throw new Error('Enter the exact name or phrase to find.');
    remember(); let count = 0; const touched = new Set();
    for (const b of blocks) { let at = 0; while ((at = b.text.indexOf(needle, at)) !== -1) { for (let i = at; i < at + needle.length; i++) b.overrides[i] = protect ? 'CUSTOM' : ''; if (b.locked) b.overrides.fill(protect ? 'CUSTOM' : ''); at += needle.length; count++; touched.add(b.page - 1); } }
    if (count) { invalidate(touched); drawOverlay(); showInspector(activeBlock); } else history.pop();
    status(`${count} exact occurrence${count === 1 ? '' : 's'} ${protect ? 'protected' : 'unprotected'}.`);
  }
  function prepareData() {
    W.requireTextSharing(false); // Legacy PDF prompt generation must not bypass the release boundary.
    const baseTokenised = C.tokenise(blocks, namespace);
    const goalText = $('goal').value, goalAuto = C.autoTypes(goalText, $('sensitivity').value), goalOverrides = Array(goalText.length).fill(null);
    // Protect exact manually selected values even when the goal's rules miss them.
    for (const value of Object.values(baseTokenised.mapping).sort((a, b) => b.length - a.length)) {
      let at = 0; while (value && (at = goalText.indexOf(value, at)) !== -1) { for (let i = at; i < at + value.length; i++) goalOverrides[i] = 'CUSTOM'; at += value.length; }
    }
    const packed = C.tokenise(blocks, namespace, [{ id: 'GOAL', page: 0, text: goalText, auto: goalAuto, overrides: goalOverrides }]);
    const regionTokens = masks.map((m, i) => `[[V_${namespace}_AREA_${String(i + 1).padStart(3, '0')}]]`);
    // Text whose geometry overlaps an area mask must not leak into the separate AI prompt.
    for (const b of blocks) for (const m of masks.filter(m => m.page === b.page)) for (let i = 0; i < b.chars.length; i++) {
      if (b.chars[i] && intersect(b.chars[i], m) && !selectedType(b, i)) throw new Error('An area mask overlaps text that was manually unprotected. Protect that text or remove the area mask before sharing.');
    }
    const prompt = C.promptFor(documentId, packed.blocks, packed.extra[0].text, regionTokens);
    prepared = { ...packed, prompt, regionTokens, pdfBytes: null };
    return prepared;
  }
  function paintMasks(canvas, pageIndex, scale, labels = true) {
    const ctx = canvas.getContext('2d'); ctx.save(); ctx.scale(scale, scale); ctx.fillStyle = '#111820';
    for (const b of pageBlocks(pageIndex)) for (const r of maskRects(b)) ctx.fillRect(r.x, r.y, r.w, r.h);
    for (const m of masks.filter(m => m.page === pageIndex + 1)) ctx.fillRect(m.x, m.y, m.w, m.h);
    if (labels && prepared) {
      for (const block of prepared.blocks.filter(b => b.page === pageIndex + 1)) {
        const source = blocks.find(b => b.id === block.id);
        for (const redaction of block.redactions) {
          const chars = source.chars.slice(redaction.start, redaction.end).filter(Boolean); if (!chars.length) continue;
          const r = union(chars), label = redaction.token.match(/_([A-Z]+_\d+)\]\]$/)[1], size = Math.min(7, r.h * .6, (r.w - 2) / (label.length * .61));
          if (size < 3) continue;
          ctx.font = `${size}px monospace`; ctx.fillStyle = '#ffffff'; ctx.fillText(label, r.x + 1, r.y + Math.min(r.h - 1, size + 1));
        }
      }
      masks.forEach((m, i) => { if (m.page !== pageIndex + 1) return; ctx.fillStyle = '#fff'; ctx.font = `${Math.min(9, m.h / 2, m.w / 8)}px monospace`; ctx.fillText('AREA ' + (i + 1), m.x + 2, m.y + Math.min(12, m.h - 1)); });
    }
    ctx.restore();
  }
  async function canvasPNG(canvas) { return new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer()); }
  async function makePDF(mode) {
    const doc = await PDFLib.PDFDocument.create();
    doc.setTitle(mode === 'redacted' ? 'Redacted document' : mode === 'sanitised' ? 'Protected document' : 'Updated document'); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer('Veil offline'); doc.setCreator('Veil offline');
    for (let i = 0; i < pages.length; i++) {
      status(`Generating ${mode === 'redacted' ? 'redacted' : mode === 'restored' ? 'restored' : 'protected'} PDF: page ${i + 1} of ${pages.length}…`);
      const canvas = mode === 'restored' ? await renderRestoredCanvas(i, SCALE_EXPORT, false) : await renderBase(i, SCALE_EXPORT);
      if (mode !== 'restored') paintMasks(canvas, i, SCALE_EXPORT, mode === 'sanitised');
      const png = await canvasPNG(canvas); canvas.width = canvas.height = 1;
      const image = await doc.embedPng(png), page = doc.addPage([pages[i].width, pages[i].height]);
      page.drawImage(image, { x: 0, y: 0, width: pages[i].width, height: pages[i].height });
      await image.embed(); // Release decoded pixels before processing the next page.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return doc.save({ useObjectStreams: true });
  }
  async function showSharePage() {
    if (!prepared?.pdfBytes) return;
    // Reopen the actual generated PDF: the preview is not just a UI overlay.
    const doc = await pdfjs.getDocument({ data: prepared.pdfBytes.slice(), isEvalSupported: false, useWorkerFetch: false, verbosity: 0 }).promise;
    try {
      const page = await doc.getPage(sharePage + 1), vp = page.getViewport({ scale: 1 });
      const canvas = $('shareCanvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      $('sharePageLabel').textContent = `${sharePage + 1} / ${pages.length}`;
    } finally { await doc.destroy(); }
  }
  async function generate() {
    ensureDocument(); if (reviewed.size !== pages.length || !$('reviewAck').checked) throw new Error('Review every page and confirm the privacy acknowledgement first.');
    if (purpose === 'redact') {
      resetRedacted(); redactedBytes = await makePDF('redacted'); $('redactDialog').showModal(); await showRedactedPage();
      status('Redacted PDF generated. Inspect every exported page, then confirm and download.'); return;
    }
    prepareData(); prepared.pdfBytes = await makePDF('sanitised');
    $('promptPreview').value = prepared.prompt; $('copyPrompt').textContent = 'Copy complete prompt'; $('promptCopyStatus').textContent = ''; $('optionalAIReference').open = false; $('promptDetails').open = false; sharePage = 0; $('shareDialog').showModal(); await showSharePage();
    $('replyStatus').textContent = 'Ready. Paste the AI’s final reply, then select Preview updated document.';
    status('Your complete AI prompt is ready. Review it, copy it, then paste it into your AI chat.');
  }
  async function showRedactedPage() {
    if (!redactedBytes) return;
    redactedPreviewFailed = false; $('redactPreviewError').hidden = true;
    let doc;
    try {
      doc = await pdfjs.getDocument({ data: redactedBytes.slice(), isEvalSupported: false, useWorkerFetch: false, verbosity: 0 }).promise;
      redactedPageCount = doc.numPages;
      const page = await doc.getPage(redactedPage + 1), viewport = page.getViewport({ scale: 1.3 }), canvas = $('redactCanvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      redactedSeen.add(redactedPage); $('redactPageLabel').textContent = `${redactedPage + 1} / ${redactedPageCount || pages.length}`;
      $('redactReviewCount').textContent = `${redactedSeen.size} of ${redactedPageCount || pages.length} exported pages viewed`;
      $('redactPrev').disabled = redactedPage === 0; $('redactNext').disabled = redactedPage === (redactedPageCount || pages.length) - 1;
      updateButtons();
    } catch (error) {
      redactedPreviewFailed = true; redactedSeen.delete(redactedPage); $('redactAck').checked = false;
      $('redactCanvas').width = $('redactCanvas').height = 1;
      $('redactPreviewError').textContent = 'This preview could not be displayed. Select Retry preview below. Your redactions are still available to edit.';
      $('redactPreviewError').hidden = false; updateButtons(); throw error;
    } finally { if (doc) await doc.destroy(); }
  }
  function defaultFit(block, reply) {
    const size = block.fontSize, originalBox = expand(block.rect, 1.7);
    return { ...originalBox, size, color: '#ffffff', family: block.family, text: reply.restored, areaAck: false };
  }
  function textLayout(text, width, size, family) {
    const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${size}px ${family}`;
    const lines = [], lineHeight = size * 1.18; let tooWide = false;
    for (const paragraph of text.split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      for (const word of paragraph.split(/(\s+)/)) {
        if (!line && /^\s+$/.test(word)) continue;
        const candidate = line + word;
        if (ctx.measureText(candidate).width <= width) line = candidate;
        else if (/^\s+$/.test(word)) { lines.push(line.trimEnd()); line = ''; }
        else {
          if (line.trim()) lines.push(line.trimEnd());
          line = word;
          if (ctx.measureText(word).width > width) tooWide = true;
        }
      }
      lines.push(line.trimEnd());
    }
    return { lines, lineHeight, height: lines.length * lineHeight, tooWide };
  }
  function fitIssue(block, fit) {
    const page = pages[block.page - 1];
    if (![fit.x, fit.y, fit.w, fit.h, fit.size].every(Number.isFinite) || fit.size < 5 || fit.size > 72 || fit.w < 5 || fit.h < 5 || fit.x < 0 || fit.y < 0 || fit.x + fit.w > page.width + .1 || fit.y + fit.h > page.height + .1) return 'Outside page / invalid box';
    const layout = textLayout(fit.text, fit.w - 4, fit.size, fit.family);
    if (layout.tooWide || layout.height + 2 > fit.h + .2) return 'Text overflow';
    if (masks.some(m => m.page === block.page && (intersect(fit, m) || intersect(expand(block.rect, 1.7), m)))) return 'Overlaps a private image area';
    if (blocks.some(other => other.id !== block.id && other.page === block.page && intersect({ x: fit.x + 1, y: fit.y + 1, w: fit.w - 2, h: fit.h - 2 }, other.rect))) return 'Overlaps another text block';
    if (!fit.areaAck) return 'Check background & box';
    return '';
  }
  function restoredAction() {
    const issues = (restored || []).filter(r => r.changed).map(r => {
      const b = blocks.find(b => b.id === r.id);
      return { id: r.id, page: b.page, reason: fitIssue(b, fitSettings.get(r.id)) };
    }).filter(i => i.reason);
    return VeilWorkflow.restoreAction({ count: pages.length, hasReply: !!restored, pending: pendingFit, issues, viewed: restoreSeen, acknowledged: $('restoreAck').checked, busy });
  }
  function allFitsPass() {
    if (!restored) return false;
    return restored.filter(r => r.changed).every(r => { const b = blocks.find(b => b.id === r.id); return !fitIssue(b, fitSettings.get(r.id)); });
  }
  async function validateReply() {
    W.requireTextSharing(!!calmRows);
    ensureDocument(); if (!prepared) throw new Error('Prepare AI files first, or open saved work from after preparation.');
    let parsed;
    try {
      parsed = C.parseReply($('replyJson').value, documentId, prepared.blocks, prepared.mapping);
      for (const r of parsed) if (r.changed && blocks.find(b => b.id === r.id).locked) throw new Error('The AI changed text that must stay fixed to preserve this page. Your document has not been updated. Copy the correction request below into the same AI chat.');
    } catch (e) { e.replyFixAvailable = true; throw e; }
    resetRestored(); restored = parsed;
    for (const r of restored.filter(r => r.changed)) { const b = blocks.find(b => b.id === r.id); fitSettings.set(r.id, defaultFit(b, r)); }
    restorePage = 0; refreshChanges(); await showRestoredPage();
    $('replyStatus').className = 'hint'; $('replyStatus').textContent = `${parsed.formatRepaired ? 'Copy-and-paste formatting corrected. ' : ''}Reply checks passed. ${restored.filter(r => r.changed).length} changed block(s). Review each page and resolve every fit warning.`;
    status('Placeholders restored locally. Check meaning, typography and fit before downloading.'); updateButtons();
  }
  function refreshChanges() {
    $('changedBlocks').replaceChildren();
    if (!restored) return;
    const changed = restored.filter(r => r.changed);
    if (!changed.length) $('changedBlocks').append(make('p', 'hint', 'No copy changes. All pages are restored from the original rendering.'));
    for (const r of changed) {
      const b = blocks.find(b => b.id === r.id), issue = fitIssue(b, fitSettings.get(r.id));
      const button = make('button', 'change-button' + (issue ? ' overflow' : '') + (activeFit === r.id ? ' selected' : ''));
      button.append(make('span', '', `${b.id} · p${b.page}`), make('span', '', issue || '✓ Fits'));
      button.addEventListener('click', () => run('Opening edited block…', async () => { if (pendingFit) throw new Error('Apply the current fit changes before opening another block.'); activeFit = r.id; restorePage = b.page - 1; showFit(r.id); refreshChanges(); await showRestoredPage(); status(issue || 'Review the restored copy in context.'); }));
      $('changedBlocks').append(button);
    }
    updateButtons();
  }
  function showFit(id) {
    const fit = fitSettings.get(id); if (!fit) return;
    activeFit = id; $('fitControls').hidden = false; $('fitTitle').textContent = id + ' · fit & finish';
    $('fitText').value = fit.text; $('fitFont').value = fit.size.toFixed(1); $('fitColor').value = fit.color;
    for (const key of ['x', 'y', 'w', 'h']) $('fit' + key.toUpperCase()).value = fit[key].toFixed(1);
    $('fitAreaAck').checked = fit.areaAck;
  }
  async function applyFit() {
    const fit = fitSettings.get(activeFit); if (!fit) return;
    fit.text = $('fitText').value; fit.size = Number($('fitFont').value); fit.color = $('fitColor').value; fit.areaAck = $('fitAreaAck').checked;
    for (const key of ['x', 'y', 'w', 'h']) fit[key] = Number($('fit' + key.toUpperCase()).value);
    pendingFit = false; $('restoreAck').checked = false; restoreSeen.clear(); refreshChanges(); await showRestoredPage();
    const issue = fitIssue(blocks.find(b => b.id === activeFit), fit); status(issue || 'Text fits. Review the final page before downloading.', !!issue);
  }
  async function renderRestoredCanvas(index, scale, guides) {
    const canvas = await renderBase(index, scale), ctx = canvas.getContext('2d'); ctx.save(); ctx.scale(scale, scale);
    for (const reply of restored.filter(r => r.changed && blocks.find(b => b.id === r.id).page === index + 1)) {
      const block = blocks.find(b => b.id === reply.id), fit = fitSettings.get(reply.id), original = expand(block.rect, 1.7);
      const layout = textLayout(fit.text, Math.max(1, fit.w - 4), fit.size, fit.family), issue = fitIssue(block, fit);
      if (!guides && issue) throw new Error('Resolve ' + block.id + ': ' + issue + ' before downloading.');
      ctx.fillStyle = fit.color; ctx.fillRect(original.x, original.y, original.w, original.h); ctx.fillRect(fit.x, fit.y, fit.w, fit.h);
      ctx.save(); ctx.beginPath(); ctx.rect(fit.x, fit.y, fit.w, fit.h); ctx.clip(); ctx.fillStyle = '#17212b'; ctx.font = `${fit.size}px ${fit.family}`; ctx.textBaseline = 'top';
      layout.lines.forEach((line, i) => ctx.fillText(line, fit.x + 2, fit.y + 1 + i * layout.lineHeight)); ctx.restore();
      if (guides) { ctx.strokeStyle = issue ? '#c53346' : '#078172'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(fit.x, fit.y, fit.w, fit.h); ctx.setLineDash([]); }
    }
    ctx.restore(); return canvas;
  }
  async function showRestoredPage() {
    if (!restored) return;
    const canvas = await renderRestoredCanvas(restorePage, 1.5, true), target = $('restoredCanvas'); target.width = canvas.width; target.height = canvas.height; target.getContext('2d').drawImage(canvas, 0, 0); canvas.width = canvas.height = 1;
    target.hidden = false; $('restoreEmpty').hidden = true; $('restorePageLabel').textContent = `${restorePage + 1} / ${pages.length}`; restoreSeen.add(restorePage); updateButtons();
  }
  function savedState() {
    return { version: 1, documentId, namespace, pdf: C.bytesTo64(originalBytes), sensitivity: $('sensitivity').value, goal: $('goal').value,
      selections: blocks.map(b => ({ id: b.id, text: b.text, overrides: b.overrides })), masks, prepared: calmReady ? false : !!prepared,
      reply: !calmReady && restored ? $('replyJson').value : '', fits: !calmReady && restored ? [...fitSettings.entries()] : [], purpose, sourceInfo, ...(calmReady ? {calm: calmSaved()} : {}) };
  }
  function validateSavedState(s) {
    calmValidateSaved(s?.calm);
    if (!s || s.version !== 1 || typeof s.documentId !== 'string' || !/^[a-f0-9-]{36}$/i.test(s.documentId) || typeof s.namespace !== 'string' || !/^[A-F0-9]{8}$/.test(s.namespace) || typeof s.pdf !== 'string' || !s.pdf.length || s.pdf.length > 36_000_000 || s.pdf.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s.pdf) || !C.LEVELS.includes(s.sensitivity) || typeof s.goal !== 'string' || s.goal.length > 12000 || typeof s.prepared !== 'boolean' || !Array.isArray(s.selections) || !Array.isArray(s.masks)) throw new Error('Saved work is invalid or unsupported.');
    if (s.selections.length > 2500 || s.masks.length > 5000) throw new Error('Saved work exceeds session limits.');
    let textLength = 0;
    for (const row of s.selections) {
      if (!row || typeof row.id !== 'string' || row.id.length > 20 || typeof row.text !== 'string' || (textLength += row.text.length) > 250000 || !Array.isArray(row.overrides) || row.overrides.length !== row.text.length || row.overrides.some(v => v !== null && v !== '' && v !== 'CUSTOM')) throw new Error('Saved selections are invalid.');
    }
    for (const m of s.masks) if (!m || typeof m.id !== 'string' || m.id.length > 100 || !Number.isInteger(m.page) || m.page < 1 || ![m.x, m.y, m.w, m.h].every(Number.isFinite) || m.x < 0 || m.y < 0 || m.w < 0 || m.h < 0) throw new Error('A saved area mask is invalid.');
    if (s.reply !== undefined && (typeof s.reply !== 'string' || s.reply.length > 4_000_000)) throw new Error('The saved AI response is invalid.');
    if (s.fits !== undefined && (!Array.isArray(s.fits) || s.fits.length > 2500)) throw new Error('Saved text layouts are invalid.');
    if ((!s.prepared && s.reply) || (!s.reply && s.fits?.length)) throw new Error('Saved edits are missing their approved response.');
    if (s.purpose !== undefined && !['redact', 'ai'].includes(s.purpose)) throw new Error('The saved workflow is invalid.');
    if (s.sourceInfo != null && (typeof s.sourceInfo.kind !== 'string' || s.sourceInfo.kind.length > 60 || typeof s.sourceInfo.summary !== 'string' || s.sourceInfo.summary.length > 2000 || !Array.isArray(s.sourceInfo.warnings) || s.sourceInfo.warnings.length > 30 || s.sourceInfo.warnings.some(w => typeof w !== 'string' || w.length > 100000))) throw new Error('Saved conversion information is invalid.');
    for (const row of s.fits || []) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !row[1]) throw new Error('Saved text layouts are invalid.');
      const f = row[1];
      if (![f.x, f.y, f.w, f.h, f.size].every(v => Number.isFinite(v) && Math.abs(v) <= 100000) || f.size <= 0 || f.size > 10000 || typeof f.text !== 'string' || f.text.length > 100000 || typeof f.family !== 'string' || f.family.length > 200 || typeof f.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(f.color)) throw new Error('Saved text layouts are invalid or too large.');
    }
  }
  function validateSavedDocument(s, targetPages, targetBlocks) {
    const sameSelections=s.selections.length===targetBlocks.length&&s.selections.every((row,i)=>row.id===targetBlocks[i].id&&row.text===targetBlocks[i].text);
    if(!sameSelections){
      // Rich-text sessions store their authoritative protection separately. The working
      // PDF may group glyphs differently after an extraction update, but must contain
      // the same ordered characters before replacing its unused selection scaffold.
      const characters=rows=>rows.map(b=>b.text.replace(/\s/g,'')).join('');
      if(s.calm?.model&&!s.prepared&&!s.reply&&!s.masks.length&&characters(s.selections)===characters(targetBlocks))s.selections=targetBlocks.map(b=>({id:b.id,text:b.text,overrides:Array(b.text.length).fill(null)}));
      else throw new Error('Saved selections do not match this PDF. Try the Veil version that saved the file.');
    }
    const maskIds = new Set();
    for (const m of s.masks) {
      const p = targetPages[m.page - 1];
      if (!p || maskIds.has(m.id) || m.x + m.w > p.width + .1 || m.y + m.h > p.height + .1) throw new Error('A saved area mask is outside its page or duplicated.');
      maskIds.add(m.id);
    }
    if (s.calm?.reply) {
      const source = s.calm.model ? F.flowModel(s.calm.model).map((p,i)=>({...p,page:1,overrides:s.calm.overrides[i],auto:C.autoTypes(p.text,s.sensitivity)})) : targetBlocks.map((b,i)=>({...b,overrides:s.selections[i].overrides,auto:C.autoTypes(b.text,s.sensitivity)}));
      const packed = C.tokenise(source,s.namespace),parsed=C.parseReply(s.calm.reply,s.documentId,packed.blocks,packed.mapping,'document');
      if((s.calm.localEdits||[]).some(([id])=>!parsed.some(b=>b.id===id)))throw new Error('Saved local wording refers to an unknown paragraph.');
    }
    if (!s.prepared) return;
    const staged = targetBlocks.map((b, i) => ({ ...b, overrides: [...s.selections[i].overrides] }));
    detectBlocks(staged, s.sensitivity);
    for (const b of staged) for (const m of s.masks.filter(m => m.page === b.page)) for (let i = 0; i < b.chars.length; i++) {
      if (b.chars[i] && intersect(b.chars[i], m) && !selectedType(b, i)) throw new Error('Saved AI preparation contains uncovered text beneath an area mask.');
    }
    if (s.reply) {
      const packed = C.tokenise(staged, s.namespace), parsed = C.parseReply(s.reply, s.documentId, packed.blocks, packed.mapping);
      const changed = new Set(parsed.filter(r => r.changed).map(r => r.id));
      if (staged.some(b => b.locked && changed.has(b.id))) throw new Error('Saved edits change a locked text block.');
      const fitIds = new Set();
      for (const [id] of s.fits || []) {
        if (!changed.has(id) || fitIds.has(id)) throw new Error('A saved text layout is unknown or duplicated.');
        fitIds.add(id);
      }
      if (fitIds.size !== changed.size) throw new Error('Saved edits are missing their text layouts.');
    }
  }
  function restoreSavedState(s) {
    blocks.forEach((b, i) => { b.overrides = [...s.selections[i].overrides]; }); masks = structuredClone(s.masks); $('sensitivity').value = s.sensitivity; $('goal').value = s.goal;
    setPurpose(s.purpose || 'ai'); sourceInfo = s.sourceInfo || null; updateImportNotice();
  }
  async function saveRecovery() {
    ensureDocument(); const protect = $('protectRecovery').checked, password = $('recoveryPassword').value;
    if (pendingFit) throw new Error('Apply the pending text layout changes before saving your progress.');
    if (protect && password.length < 12) throw new Error('Create a password with at least 12 characters. A few memorable words work well.');
    if (protect && password !== $('recoveryConfirm').value) throw new Error('The two passwords do not match. Please repeat the same password.');
    const state = savedState(); validateSavedState(state); validateSavedDocument(state, pages, blocks);
    const output = protect ? await C.encryptRecovery(state, password) : JSON.stringify({ format: 'VEIL-PROGRESS-1', protection: 'none', state });
    download(output, 'application/octet-stream', protect ? 'veil-private-work-locked.veil' : 'veil-private-work.veil');
    resetSavePassword();
    const message = protect ? 'Your password-protected saved work has downloaded. Keep the file and its password. Never upload either to AI.' : 'Your saved work has downloaded without a password. Keep this private file on your device; never upload it to AI.';
    $('recoveryStatus').textContent = message; status(message);
  }
  async function openRecovery(file) {
    if (!file) return;
    if (file.size > 80_000_000) throw new Error('This saved-work file is too large (80 MB maximum).');
    const input = await file.text(); let envelope;
    try { envelope = JSON.parse(input); } catch { throw new Error('This is not a readable Veil saved-work file. Choose a .veil file.'); }
    if (envelope?.format === 'VEIL-PROGRESS-1' && envelope.protection === 'none') {
      await openSavedState(envelope.state); return;
    }
    if (envelope?.format !== 'VEIL-RECOVERY-1' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 600000 || envelope.cipher !== 'AES-256-GCM' || typeof envelope.data !== 'string' || typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string') throw new Error('This saved-work format is unsupported or damaged.');
    try { if (envelope.salt.length !== 24 || envelope.iv.length !== 16 || C.from64(envelope.salt).length !== 16 || C.from64(envelope.iv).length !== 12 || envelope.data.length < 24 || envelope.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data)) throw new Error(); }
    catch { throw new Error('This password-protected file is damaged.'); }
    pendingRecovery = input; recoveryAttempt++;
    $('unlockPassword').value = ''; $('showUnlockPassword').checked = false; $('unlockPassword').type = 'password';
    $('savedWorkName').textContent = file.name; $('unlockStatus').textContent = 'Enter the password chosen when this file was saved. Veil has no password reset.';
    $('unlockDialog').showModal(); $('unlockPassword').focus();
  }
  async function openSavedState(state, canCommit = () => true) {
    validateSavedState(state);
    if (pages.length && !confirm('Open this saved work instead? Save your current progress first if you need to keep it.')) return false;
    await loadPDF(C.from64(state.pdf), 'Saved document', state, canCommit); showView(false);
    status('Saved work opened. Review the document again before sharing.'); return true;
  }
  async function unlockSavedWork() {
    const input = pendingRecovery, attempt = ++recoveryAttempt, password = $('unlockPassword').value;
    if (!input) throw new Error('Choose your saved-work file first.');
    if (!password) throw new Error('Enter the password for this file.');
    let state;
    try { state = await C.decryptRecovery(input, password); }
    catch { throw new Error('Unable to open this file. Check its password and try again; the file may also be damaged.'); }
    const canCommit = () => attempt === recoveryAttempt && $('unlockDialog').open;
    if (!canCommit()) return;
    if (await openSavedState(state, canCommit)) $('unlockDialog').close();
  }
  function resetSavePassword() {
    $('recoveryPassword').value = ''; $('recoveryConfirm').value = ''; $('showRecoveryPassword').checked = false;
    $('recoveryPassword').type = $('recoveryConfirm').type = 'password';
  }
  function updateSaveOptions() {
    const protect = $('protectRecovery').checked;
    $('savePasswordFields').hidden = !protect;
    $('saveRecovery').textContent = protect ? 'Download password-protected work' : 'Download saved work';
    $('saveProtectionHint').textContent = protect ? 'You will need this password to reopen the file. Veil cannot reset it.' : 'No password will be required. Anyone with this file can read the private document.';
    if (!protect) resetSavePassword();
  }
  function showView(restore) {
    if (restore && purpose !== 'ai') setPurpose('ai');
    $('prepareView').hidden = restore; $('restoreView').hidden = !restore; $('prepareTab').classList.toggle('active', !restore); $('restoreTab').classList.toggle('active', restore);
    if (restore) simpleStep = 'restore'; else if (simpleStep === 'restore') simpleStep = 'review';
    updateSimpleUI();
  }
  function openRecoveryDialog() {
    ensureDocument(); resetSavePassword(); $('protectRecovery').checked = false; updateSaveOptions();
    $('recoveryStatus').textContent = 'This saves a copy of your progress now. Save again after further changes.';
    $('savedSourceHint').textContent = sourceInfo ? 'This includes the working document, supported formatting and private protection data. Excluded source content is not included.' : 'This includes your working PDF, protection selections and any validated, applied edits.';
    $('recoveryDialog').showModal(); updateButtons();
  }
  async function openFile(file) {
    if (!file) return;
    if (/\.veil$/i.test(file.name)) { await openRecovery(file); return; }
    const extension = file.name.toLowerCase().split('.').pop();
    if(extension!=='pdf')throw new Error('This document type isn’t supported. Convert it to PDF first, or choose Prepare text for AI to paste your text.');
    if (file.size > LIMIT_BYTES) throw new Error('This file exceeds the 25 MB limit.');
    if (pages.length && !confirm('Open another document? This replaces the current session. Save your progress first if you need it.')) return;
    status('Reading the file from your device…');
    const bytes = await W.readLocalFile(file,FileReader);
    await loadPDF(bytes, file.name); showView(false);
  }

  function updateImportNotice() {
    $('importNotice').hidden = !sourceInfo;
    $('importNoticeText').textContent = sourceInfo ? sourceInfo.kind==='Word document'?'Word design available for Word download; PDF uses text layout.':sourceInfo.kind + ' · new text layout; images and attachments excluded.' : '';
  }
  function fillImportDialog(info, text, pending) {
    $('confirmImport').textContent=info.kind==='Word document'?'Review Word document':'Open converted PDF';
    $('importAckRow').querySelector('span').textContent=info.kind==='Word document'?'I understand the supported Word design is retained for Word download. I will check the text and pictures; PDF output uses a simpler text layout.':'I have checked the included text and exclusions. I understand that the PDF has a new layout and is not the complete original file.';
    $('importSummary').textContent = info.summary; $('importWarnings').replaceChildren(...info.warnings.map(w => make('li', '', w)));
    $('importTextPreview').value = text; $('importAck').checked = false;
    $('importAckRow').hidden = $('confirmImport').hidden = !pending; $('importDialog').showModal(); updateButtons();
  }
  async function stageImport(converted, name) {
    const flow = converted.flow || F.flowFromText(converted.text);
    const bytes = await calmWorkingPDF(flow);
    converted.flow = flow;
    pendingImport = { ...converted, bytes, name };
    fillImportDialog(converted, converted.text, true); status('Check the conversion summary before opening the new text PDF.');
  }
  async function demo() {
    if (pages.length && !confirm('Replace the current session with the fictional sample?')) return;
    const doc = await PDFLib.PDFDocument.create(), font = await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 758, width: 595.28, height: 84, color: PDFLib.rgb(.063, .145, .212) });
    page.drawText('NORTHSTAR / PEOPLE', { x: 48, y: 790, size: 16, font: bold, color: PDFLib.rgb(.8, .93, .91) });
    const text = (s, y, size = 11, f = font) => page.drawText(s, { x: 48, y, size, font: f, color: PDFLib.rgb(.10, .15, .20) });
    text('Private & confidential', 720, 10); text('A clearer way forward', 680, 24, bold);
    text('Date: 17 September 2026', 639); text('Dear Sam Taylor,', 603);
    text('Thank you for taking the time to speak with us.', 567);
    text('We would like to confirm the next steps for your application.', 539);
    text('Please contact Jane Smith to arrange a convenient time.', 511);
    text('Email: jane.smith@example.com', 465); text('Phone: 07700 900123', 440);
    text('Address: 12 Willow Road, Bristol, BS1 4AB', 415); text('Social: @jane_smith', 390);
    text('Vehicle registration: AB12 CDE', 365); text('Reference: EMP-847293', 340);
    text('We look forward to hearing from you.', 290); text('Kind regards,', 245); text('Alex Morgan', 220, 12, bold);
    page.drawLine({ start: { x: 48, y: 100 }, end: { x: 547, y: 100 }, thickness: 1, color: PDFLib.rgb(.8, .85, .88) });
    text('FICTIONAL SAMPLE - for trying Veil only', 76, 9);
    await loadPDF(await doc.save(), 'Fictional sample.pdf'); $('goal').value = 'Make this letter warmer and more concise. Keep its structure and factual content.'; $('calmGoal').value = $('goal').value;
  }
  /*__CALM__*/
  // Events: user content is only ever inserted as text, never interpreted as markup.
  $('simpleToggle').onclick = async () => { await run('Switching interface…', async () => {
    setInterface(!simpleMode);
    if (pages.length && !$('prepareView').hidden) await renderPage();
    status(pages.length ? (simpleStep === 'restore' ? 'Your document and edits are unchanged.' : pageNotice()) : 'Ready. Open a PDF, paste text or try the fictional sample.');
  }); $('simpleToggle').focus(); };
  document.querySelectorAll('button[data-simple-step]').forEach(button => button.onclick = () => run('Opening step…', () => simpleMode && purpose === 'redact' && button.dataset.simpleStep === 'prepare' ? generate() : goSimpleStep(button.dataset.simpleStep)));
  $('simpleContinue').onclick = async () => {
    const ordinary = simpleMode && purpose === 'redact';
    await run(ordinary ? 'Continuing redaction…' : 'Opening preparation…', () => ordinary ? advanceRedaction() : goSimpleStep('prepare'));
    if (ordinary && !$('redactDialog').open) ($('simpleContinue').disabled ? $('reviewAck') : $('simpleContinue')).focus();
  };
  $('simpleBack').onclick = () => run('Opening review…', () => goSimpleStep('review'));
  $('purposeRedact').onclick = () => setPurpose('redact'); $('purposeAI').onclick = () => setPurpose('ai');
  $('pasteOpen').onclick = e => { e.stopPropagation(); $('pasteDialog').showModal(); };
  $('convertPaste').onclick = () => run('Converting pasted text locally…', async () => {
    if (pages.length && !confirm('Replace the current session with this text after reviewing the conversion? Save your progress first if needed.')) return;
    const converted = VeilImporters.parseText($('pastedText').value); await stageImport(converted, 'Pasted text'); $('pasteDialog').close();
  });
  $('pasteDialog').addEventListener('close', () => { $('pastedText').value = ''; });
  $('importAck').onchange = updateButtons;
  $('confirmImport').onclick = () => run('Opening converted document…', async () => {
    if (!pendingImport || !$('importAck').checked) throw new Error('Review and acknowledge the conversion first.');
    const input = pendingImport; await loadPDF(input.bytes, input.name + ' · converted',null,()=>true,false);
    calmWord=input.wordTemplate||null;calmWordRemoved=[];calmWordOutput=null;calmModel = F.flowModel(input.flow); calmRows = calmModel.map(p => ({id:p.id,page:1,text:p.text,auto:C.autoTypes(p.text,$('sensitivity').value),overrides:Array(p.text.length).fill(null)})); calmDocumentFeedback();calmShow('review');
    sourceInfo = { kind: input.kind, summary: input.summary, warnings: input.warnings }; updateImportNotice(); showView(false); $('importDialog').close();
    status(calmWord?'Word design retained locally. Review private wording and every retained picture.':'Converted text PDF opened. The original file and excluded content are not part of this session.');
  });
  $('importDialog').addEventListener('close', () => { pendingImport = null; $('importSummary').textContent = ''; $('importWarnings').replaceChildren(); $('importTextPreview').value = ''; $('importAck').checked = false; });
  $('importDetails').onclick = () => { if (sourceInfo) fillImportDialog(sourceInfo, blocks.map(b => b.text).join('\n'), false); };
  $('choosePdf').onclick = () => $('pdfInput').click();
  $('dropzone').addEventListener('click', e => { if (!e.target.closest('#loadDemo, #pasteOpen')) $('pdfInput').click(); });
  $('dropzone').addEventListener('keydown', e => { if (e.target === $('dropzone') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); $('pdfInput').click(); } });
  $('pdfInput').onchange = e => {const file=e.target.files[0];e.target.value='';return run('Opening document…', () => openFile(file));};
  $('loadDemo').onclick = e => { e.stopPropagation(); run('Creating the fictional sample…', demo); };
  $('documentViewport').addEventListener('dragover', e => { e.preventDefault(); $('dropzone').classList.add('drag-over'); });
  $('documentViewport').addEventListener('dragleave', () => $('dropzone').classList.remove('drag-over'));
  $('documentViewport').addEventListener('drop', e => { e.preventDefault(); $('dropzone').classList.remove('drag-over'); run('Opening PDF locally…', () => openFile(e.dataTransfer.files[0])); });
  $('sensitivity').onchange = () => { if (pages.length) { applyDetection(); if (calmRows) for (const row of calmRows) row.auto = C.autoTypes(row.text, $('sensitivity').value); invalidate(); if (calmRows) calmDrawRich(); drawOverlay(); showInspector(activeBlock); status('Suggestions updated. Your manual additions and removals were preserved. Review the pages again.'); } else $('sensitivityHint').textContent = sensitivityHints[$('sensitivity').value]; };
  $('findAdd').onclick = () => { try { findMatches(true); } catch (e) { fail(e); } }; $('findRemove').onclick = () => { try { findMatches(false); } catch (e) { fail(e); } };
  $('undo').onclick = () => { if (!history.length) return; future.push(snapshot()); restoreSnapshot(history.pop()); };
  $('redo').onclick = () => { if (!future.length) return; history.push(snapshot()); restoreSnapshot(future.pop()); };
  $('pageReviewed').onchange = () => { if ($('pageReviewed').checked) reviewed.add(currentPage); else { reviewed.delete(currentPage); $('reviewAck').checked = false; } updatePageList(); updateButtons(); };
  $('reviewAck').onchange = updateButtons; $('restoreAck').onchange = updateButtons;
  $('goal').oninput = () => { prepared = null; documentId = crypto.randomUUID(); resetRestored(); $('reviewAck').checked = false; $('promptPreview').value = ''; $('replyJson').value = ''; updateButtons(); };
  $('maskPreview').onchange = drawOverlay;
  $('zoomIn').onclick = () => run('Rendering at a larger zoom…', async () => { zoom = Math.min(3, zoom + .25); await renderPage(); status(pageNotice()); });
  $('zoomOut').onclick = () => run('Rendering at a smaller zoom…', async () => { zoom = Math.max(.5, zoom - .25); await renderPage(); status(pageNotice()); });
  $('generate').onclick = () => run('Preparing protected files…', generate);
  async function navigateRedactedPage(index) {
    await run('Rendering exported page…', async () => { redactedPage = index; await showRedactedPage(); status('Inspect the actual exported page.'); });
    if ($('redactDialog').open) (!calmReady && exportAction().kind === 'download' && !$('redactAck').checked ? $('redactAck') : $('downloadRedacted')).focus();
  }
  $('redactPrev').onclick = () => navigateRedactedPage(Math.max(0, redactedPage - 1));
  $('redactNext').onclick = () => navigateRedactedPage(Math.min((redactedPageCount || pages.length) - 1, redactedPage + 1));
  $('redactAck').onchange = updateButtons;
  function redactedDownloadRequested() {
    $('redactDownloadStatus').textContent = 'Download requested: redacted-document.pdf. Check your browser’s downloads or save prompt.';
    $('redactDownloadStatus').hidden = false; $('redactDownloadHelp').hidden = false;
    status('Download requested. Check your browser’s downloads for redacted-document.pdf.');
  }
  $('downloadRedacted').onclick = () => {
    const action = exportAction(); if (action.disabled) return;
    if (action.kind === 'navigate' || action.kind === 'retry') {
      navigateRedactedPage(action.kind === 'navigate' ? action.next : redactedPage); return;
    }
    if (action.kind !== 'download') return;
    if (!redactedDownloadURL) redactedDownloadURL = blobURL(redactedBytes, 'application/pdf');
    $('redactDirectDownload').href = redactedDownloadURL;
    $('redactDirectDownload').click();
  };
  $('redactDirectDownload').onclick = e => {
    const action = exportAction();
    if (action.kind !== 'download' || action.disabled || !redactedDownloadURL) { e.preventDefault(); return; }
    redactedDownloadRequested();
  };
  $('downloadSanitised').onclick = () => { if (prepared?.pdfBytes) download(prepared.pdfBytes, 'application/pdf', 'protected-document.pdf'); };
  $('downloadPrompt').onclick = () => { if (!calmRows) { status('Choose Prepare text for AI to prepare an AI prompt.',true); return; } if (prepared) download(prepared.prompt, 'text/plain;charset=utf-8', 'ai-instructions.txt'); };
  $('copyPrompt').onclick = async () => { if (!calmRows) { status('Choose Prepare text for AI to prepare an AI prompt.',true); return; } if (!prepared) return; try { await navigator.clipboard.writeText(prepared.prompt); $('copyPrompt').textContent = 'Copy complete prompt'; $('promptCopyStatus').textContent = 'Copied. Paste this into your AI chat.'; } catch { $('promptDetails').open = true; $('promptPreview').focus(); $('promptPreview').select(); $('promptCopyStatus').textContent = 'The full prompt is selected. Press Ctrl+C (Command+C on Mac), then paste it into your AI chat.'; } };
  $('sharePrev').onclick = () => run('Rendering sharing preview…', async () => { sharePage = Math.max(0, sharePage - 1); await showSharePage(); status('Review the actual sanitised PDF before sharing.'); });
  $('shareNext').onclick = () => run('Rendering sharing preview…', async () => { sharePage = Math.min(pages.length - 1, sharePage + 1); await showSharePage(); status('Review the actual sanitised PDF before sharing.'); });
  $('prepareTab').onclick = () => showView(false); $('restoreTab').onclick = () => showView(true);
  $('goRestore').onclick = () => { $('shareDialog').close(); showView(true); $('replyJson').focus(); $('replyJson').scrollIntoView({ block: 'center' }); };
  $('chooseJson').onclick = () => $('jsonInput').click(); $('jsonInput').onchange = e => run('Reading the AI’s final reply…', async () => { const f = e.target.files[0]; if (!f) return; if (f.size > 4_000_000) throw new Error('The reply file is too large (4 MB maximum).'); $('replyJson').value = await f.text(); resetRestored(); status('Reply loaded. Select Preview updated document.'); });
  $('replyJson').oninput = () => { resetRestored(); $('replyStatus').textContent = 'Reply changed. Select Preview updated document again.'; };
  $('replyJson').addEventListener('dragover', e => e.preventDefault()); $('replyJson').addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); run('Reading the AI’s final reply…', async () => { const f = e.dataTransfer.files[0]; if (f.size > 4_000_000) throw new Error('The reply file is too large (4 MB maximum).'); $('replyJson').value = await f.text(); resetRestored(); status('Reply loaded. Select Preview updated document.'); }); });
  $('validateReply').onclick = () => run('Checking placeholders and restoring locally…', async () => { try { await validateReply(); } catch (e) { resetRestored(); $('replyStatus').className = 'hint error'; $('replyStatus').textContent = e.message; if (prepared && e.replyFixAvailable) { $('replyFixPrompt').value = C.replyCorrectionFor(documentId, prepared.blocks); $('replyHelp').hidden = false; } throw e; } });
  $('copyReplyFix').onclick = async () => {
    if (!calmRows) { status('Choose Prepare text for AI to prepare an AI prompt.',true); return; }
    if (!prepared || $('replyHelp').hidden) return;
    try { await navigator.clipboard.writeText($('replyFixPrompt').value); $('replyFixStatus').textContent = 'Copied. Paste into the same AI chat, then bring its corrected final reply back.'; }
    catch { $('replyFixDetails').open = true; $('replyFixPrompt').focus(); $('replyFixPrompt').select(); $('replyFixStatus').textContent = 'The request is selected. Copy it using your device’s Copy command, then paste into the same AI chat.'; }
  };
  $('restorePrev').onclick = () => run('Rendering restored page…', async () => { restorePage = Math.max(0, restorePage - 1); await showRestoredPage(); status('Check restored values and copy in context.'); });
  $('restoreNext').onclick = () => run('Rendering restored page…', async () => { restorePage = Math.min(pages.length - 1, restorePage + 1); await showRestoredPage(); status('Check restored values and copy in context.'); });
  $('applyFit').onclick = () => run('Applying text fit…', applyFit);
  for (const id of ['fitText', 'fitFont', 'fitColor', 'fitX', 'fitY', 'fitW', 'fitH']) $(id).oninput = () => { pendingFit = true; $('fitAreaAck').checked = false; $('restoreAck').checked = false; updateButtons(); };
  $('fitAreaAck').onchange = () => { pendingFit = true; $('restoreAck').checked = false; updateButtons(); };
  $('restoreNextAction').onclick = () => run('Opening the next review step…', async () => {
    const action = restoredAction();
    if (action.kind === 'apply') { $('fitControls').scrollIntoView({ block: 'center' }); $('applyFit').focus(); }
    else if (action.kind === 'fit') {
      const b = blocks.find(b => b.id === action.id); activeFit = action.id; restorePage = b.page - 1;
      showFit(action.id); refreshChanges(); await showRestoredPage();
      $('fitControls').scrollIntoView({ block: 'center' });
      status(action.hint);
    } else if (action.kind === 'navigate') {
      restorePage = action.next; await showRestoredPage(); $('restoredCanvas').scrollIntoView({ block: 'center' });
    }
  });
  $('downloadRestored').onclick = () => run('Building restored PDF…', async () => { if (restoredAction().kind !== 'download') throw new Error(restoredAction().hint); const bytes = await makePDF('restored'); download(bytes, 'application/pdf', 'restored-document.pdf'); status('Download requested: restored-document.pdf. Check your browser’s downloads or save prompt.'); });
  $('recoveryOpen').onclick = openRecoveryDialog; $('recoveryInline').onclick = openRecoveryDialog; $('saveRecoveryShare').onclick = openRecoveryDialog;
  $('saveRecovery').onclick = () => run('Saving your private work…', async () => { try { await saveRecovery(); } catch (e) { $('recoveryStatus').textContent = e.message; throw e; } });
  $('protectRecovery').onchange = () => { resetSavePassword(); updateSaveOptions(); $('recoveryStatus').textContent = 'This saves a copy of your progress now. Save again after further changes.'; if ($('protectRecovery').checked) $('recoveryPassword').focus(); };
  $('showRecoveryPassword').onchange = () => { $('recoveryPassword').type = $('recoveryConfirm').type = $('showRecoveryPassword').checked ? 'text' : 'password'; };
  $('showUnlockPassword').onchange = () => { $('unlockPassword').type = $('showUnlockPassword').checked ? 'text' : 'password'; };
  $('loadRecovery').onclick = () => $('recoveryInput').click();
  $('recoveryInput').onchange = e => run('Opening saved work locally…', async () => { try { await openRecovery(e.target.files[0]); } finally { $('recoveryInput').value = ''; } });
  $('unlockRecovery').onclick = () => run('Opening your password-protected work…', async () => { try { await unlockSavedWork(); } catch (e) { $('unlockStatus').textContent = e.message; throw e; } });
  $('unlockPassword').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('unlockRecovery').click(); } };
  $('clearSession').onclick = () => run('Clearing the current session…', async () => { if (pages.length && !confirm('Clear this session? Unsaved work and the private details needed to restore AI edits will be lost. Save your progress first if you want to continue later.')) return; await clearData(); showView(false); status('Session cleared.'); });
  $('helpOpen').onclick = () => $('helpDialog').showModal(); $('licensesOpen').onclick = () => $('licensesDialog').showModal();
  $('veilLicenseOpen').onclick = () => $('veilLicenseDialog').showModal();
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { if (b.dataset.close !== 'unlockDialog' || !committingRecovery) $(b.dataset.close).close(); });
  $('recoveryDialog').addEventListener('close', resetSavePassword);
  $('unlockDialog').addEventListener('cancel', e => { if (committingRecovery) e.preventDefault(); });
  $('unlockDialog').addEventListener('close', () => { pendingRecovery = null; recoveryAttempt++; $('unlockPassword').value = ''; $('unlockPassword').type = 'password'; $('showUnlockPassword').checked = false; $('savedWorkName').textContent = ''; $('unlockStatus').textContent = ''; returnOpenFocus = true; updateButtons(); if (!busy) { returnOpenFocus = false; $('loadRecovery').focus(); } });
  window.addEventListener('beforeunload', e => { if (dirty && (pages.length || (calmReady && $('calmPaste').textContent.trim()))) { e.preventDefault(); e.returnValue = ''; } });
  setInterface(false); setPurpose('ai'); calmInit();
  try {
    if (!crypto.subtle) throw new Error('This browser does not provide local encryption. Open this file in a current Microsoft Edge or Chrome browser.');
    const workerURL = blobURL(C.from64(BUNDLE.worker), 'text/javascript');
    pdfjs = await import(blobURL(C.from64(BUNDLE.pdf), 'text/javascript')); pdfjs.GlobalWorkerOptions.workerSrc = workerURL;
    $('loadDemo').disabled = false; status('Ready. Open a PDF, paste text or try the fictional sample.'); updateButtons();
  } catch (e) { fail(e); $('loadDemo').disabled = true; $('choosePdf').disabled = true; }
})();
