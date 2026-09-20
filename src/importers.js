export { positionedGlyphs } from './glyphs.mjs';
import { prepareWordTemplate } from './word.mjs';
export * from './word.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import PostalMime from 'postal-mime';
import fontkit from '@pdf-lib/fontkit';
import { flowModel, flowStyle } from './flow.mjs';

const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const MAX_TEXT = 150000, MAX_INPUT = 8 * 1024 * 1024;
const isWord = (node, name) => node.nodeType === 1 && WORD.has(node.namespaceURI) && node.localName === name;
const wordNodes = (root, name) => [...root.getElementsByTagNameNS('*', name)].filter(node => WORD.has(node.namespaceURI));
function clean(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
function boundedText(text) {
  text = clean(text).trim();
  if (!text) throw new Error('No supported text was found. Export the original as a PDF to include its visible content.');
  if (text.length > MAX_TEXT) throw new Error('Converted text exceeds 150,000 characters. Split the document first.');
  return text;
}
function xml(bytes, name) {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported XML declarations in ' + name + '.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid Word XML in ' + name + '.');
  return doc;
}
function paragraphText(paragraph, trim = true) {
  const output = [];
  function visit(node) {
    if (node !== paragraph && isWord(node, 'p')) return; // Text boxes are separate paragraphs.
    if (isWord(node, 'del') || isWord(node, 'moveFrom') || isWord(node, 'instrText') || isWord(node, 'delText')) return;
    if (isWord(node, 't')) { output.push(node.textContent); return; }
    if (isWord(node, 'tab')) output.push('    ');
    if (isWord(node, 'br') || isWord(node, 'cr')) output.push('\n');
    for (const child of node.children || []) visit(child);
  }
  visit(paragraph); const result=clean(output.join(''));return trim?result.trim():result;
}
export function parseDocx(bytes) {
  if (bytes.length > MAX_INPUT) throw new Error('Word imports are limited to 8 MB. Export a PDF for larger documents.');
  let entries = 0, total = 0; const names = new Set();
  const files = unzipSync(bytes, { filter(file) {
    if (++entries > 1500 || file.originalSize > 64 * 1024 * 1024 || (total += file.originalSize) > 128 * 1024 * 1024) throw new Error('This Word archive exceeds the safe unpacking limits.');
    if (names.has(file.name) || /(?:^|\/)\.\.(?:\/|$)|\\|^\//.test(file.name)) throw new Error('Unsupported or duplicate Word archive paths.');
    names.add(file.name);
    if (/vbaProject|activeX|embeddings\/.*\.bin$/i.test(file.name)) throw new Error('This Word file contains macros, active controls or embedded binary objects. Export a static PDF first.');
    const include = /^(?:\[Content_Types\]\.xml|word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml)$/.test(file.name);
    if (include && file.originalSize > 8 * 1024 * 1024) throw new Error('A Word text part is too large.');
    return include;
  }});
  if (!files['word/document.xml'] || !files['[Content_Types].xml']) throw new Error('This is not a supported .docx file.');
  const types = xml(files['[Content_Types].xml'], 'content types');
  if (![...types.getElementsByTagNameNS('*', 'Override')].some(n => n.getAttribute('PartName') === '/word/document.xml' && n.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw new Error('Only standard, non-macro .docx files are supported.');
  const parts = ['word/document.xml', ...Object.keys(files).filter(n => /^word\/(?:header|footer)\d+\.xml$/.test(n)).sort(), ...['word/footnotes.xml', 'word/endnotes.xml'].filter(n => files[n])];
  const sections = [], flowParagraphs = []; let deleted = 0, inserted = 0, drawings = 0, fields = 0;
  for (const name of parts) {
    const doc = xml(files[name], name);
    if (!WORD.has(doc.documentElement.namespaceURI)) throw new Error('Unsupported Word document namespace.');
    if (wordNodes(doc, 'altChunk').length) throw new Error('This Word file embeds external document content. Export it as a PDF first.');
    deleted += wordNodes(doc, 'del').length + wordNodes(doc, 'moveFrom').length;
    inserted += wordNodes(doc, 'ins').length + wordNodes(doc, 'moveTo').length;
    drawings += wordNodes(doc, 'drawing').length + wordNodes(doc, 'pict').length;
    fields += wordNodes(doc, 'instrText').length;
    const paragraphs = wordNodes(doc, 'p').filter(p => {
      for (let n = p.parentElement; n; n = n.parentElement) {
        if (isWord(n, 'del') || isWord(n, 'moveFrom')) return false;
        if ((isWord(n, 'footnote') || isWord(n, 'endnote')) && [...n.attributes].some(a => a.localName === 'type' && ['separator', 'continuationSeparator'].includes(a.value))) return false;
      }
      return true;
    });
    for(const p of paragraphs){
      const text=paragraphText(p);if(!text)continue;
      const get=(node,name)=>wordNodes(node,name)[0];
      const val=n=>n?[...n.attributes].find(a=>a.localName==='val')?.value:undefined;
      const styleId=val(get(p,'pStyle'))||'',heading=/heading\s*([1-3])/i.exec(styleId);
      const kind=heading?'h'+heading[1]:/^title$/i.test(styleId)?'h1':get(p,'numPr')?'li':'p';
      const inherited=flowStyle({size:kind==='h1'?24:kind==='h2'?18:kind==='h3'?14:11,bold:kind!=='p'&&kind!=='li'});
      const runs=wordNodes(p,'r').filter(r=>{for(let n=r.parentElement;n&&n!==p;n=n.parentElement)if(isWord(n,'del')||isWord(n,'moveFrom'))return false;return true;}).map(r=>{
        const fonts=get(r,'rFonts'),font=fonts?[...fonts.attributes].find(a=>a.localName==='ascii')?.value:undefined;
        return {text:paragraphText(r,false),style:flowStyle({...inherited,font:font||inherited.font,size:val(get(r,'sz'))?Number(val(get(r,'sz')))/2:inherited.size,bold:get(r,'b')?!['0','false'].includes(val(get(r,'b'))):inherited.bold,italic:!!get(r,'i')&&!['0','false'].includes(val(get(r,'i'))),underline:!!get(r,'u')&&val(get(r,'u'))!=='none'})};
      });
      // Preserve whole paragraph wording if run trimming changes spacing.
      flowParagraphs.push({text,kind,style:runs[0]?.style||inherited,runs});
    }
    const paragraphStrings=paragraphs.map(p=>paragraphText(p)).filter(Boolean);
    if (!paragraphStrings.length) continue;
    const heading = name === 'word/document.xml' ? '' : /^word\/header/.test(name) ? 'Header text' : /^word\/footer/.test(name) ? 'Footer text' : name.includes('endnotes') ? 'Endnotes' : 'Footnotes';
    sections.push((heading ? heading + '\n\n' : '') + paragraphStrings.join('\n\n'));
  }
  const media = [...names].filter(n => n.startsWith('word/media/') && !n.endsWith('/')).length;
  const warnings = [
    'A new flowing text layout. Basic headings, font sizes and direct emphasis are retained where available. PDF uses an embedded sans-serif font; Word and formatted copy preserve supplied font names. Original pagination, graphics, tables and automatic numbering are not preserved. Equations are excluded.',
    'Headers, footers and notes, when present, are appended as text sections. Hidden formatting is removed, so hidden text may become visible for review.',
    'Comments, document properties, link targets and unused package parts are excluded. Saved work includes only the converted PDF, not the original Word file or excluded content.'
  ];
  if (media || drawings) warnings.push(`${media} media file(s) and ${drawings} drawing/image object(s) excluded. Export Word to PDF yourself if images, signatures or the original layout must be retained.`);
  if ([...names].some(n => /comments/.test(n))) warnings.push('Comments are present and are excluded from this conversion.');
  if (deleted || inserted) warnings.push(`Tracked changes: ${deleted} deleted/moved-from region(s) omitted; ${inserted} inserted/moved-to region(s) included. Check that this is the intended version.`);
  if (fields) warnings.push('Field instructions are excluded; any stored displayed field text is included and may be out of date.');
  if (parts.some(n => /<m:oMath\b|<m:oMathPara\b/.test(strFromU8(files[n])))) warnings.push('Mathematical equations are excluded. Export the original to PDF to retain them.');
  let wordTemplate=null;try{wordTemplate=prepareWordTemplate(bytes);if(wordTemplate.slots.length!==flowParagraphs.length||wordTemplate.slots.some((p,i)=>p.text!==flowParagraphs[i].text))throw Error('Word reading order could not be matched safely.');}catch(e){wordTemplate=null;warnings.unshift('Original Word design cannot be retained: '+e.message+' This import uses the text-only layout described below.');}
  if(wordTemplate){warnings.splice(0,warnings.length,'Word download retains supported paragraph styles, simple tables, headers, footers and inline pictures. Word handles wrapping and pagination. Rewritten paragraphs use their first run style; unchanged paragraphs keep mixed formatting.','This is a text review, not a Word page preview. Review retained pictures below; remove any that contain private details. Pictures are not scanned or sent to AI. Removing picture metadata can affect orientation or colour; check the retained pictures. PDF and clipboard output use the clean text layout.','Comments, links, hidden content, complex sections and unsupported objects prevent this preservation route. Document properties and picture descriptions/metadata are removed. Saved work includes a private sanitized Word template.');}
  return {wordTemplate, flow: flowModel(flowParagraphs), kind: wordTemplate?'Word document':'Word text', text: boundedText(sections.join('\n\n')), warnings, summary: wordTemplate?'Supported Word design is available for Word download. Review the text and retained pictures before continuing.':'Review the text extracted from this Word file. Only this text will enter the new PDF.' };
}

// Template content is inert and is never attached to the live document.
// No imported HTML, URLs or styles enter the app's visible DOM.
export function htmlToText(html) {
  const template = document.createElement('template'); template.innerHTML = html;
  const out = [], excluded = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH']);
  const block = new Set(['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'SECTION', 'HR']);
  function visit(node) {
    if (node.nodeType === 3) { out.push(node.textContent.replace(/\s+/g, ' ')); return; }
    const name = node.nodeName.toUpperCase();
    if (node.nodeType === 1 && node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    if (excluded.has(name)) return;
    if (block.has(name)) out.push('\n');
    for (const child of node.childNodes || []) visit(child);
    if (['TD', 'TH'].includes(name)) out.push(' | ');
    if (block.has(name)) out.push('\n');
  }
  visit(template.content);
  return clean(out.join('')).replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function addressText(value) {
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(', ');
  if (!value) return '';
  if (value.group) return (value.name ? value.name + ': ' : '') + addressText(value.group);
  return [value.name, value.address ? '<' + value.address + '>' : ''].filter(Boolean).join(' ');
}
export async function parseEmail(bytes) {
  if (bytes.length > MAX_INPUT) throw new Error('Email imports are limited to 8 MB. Remove large attachments or export a PDF first.');
  const email = await PostalMime.parse(bytes, { maxNestingDepth: 24, maxHeadersSize: 256000, maxRfc822NestingDepth: 0, forceRfc822Attachments: true });
  const headers = [];
  for (const [label, key] of [['From', 'from'], ['Sender', 'sender'], ['To', 'to'], ['Cc', 'cc'], ['Bcc', 'bcc'], ['Reply-to', 'replyTo']]) {
    const value = addressText(email[key]); if (value) headers.push(label + ': ' + value);
  }
  if (email.date) headers.push('Date: ' + email.date);
  if (email.subject) headers.push('Subject: ' + email.subject);
  const body = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : '';
  if (!body.trim()) throw new Error('This email has no supported readable body. Encrypted and attachment-only messages cannot be converted.');
  const attachments = email.attachments || [];
  if (attachments.length > 500) throw new Error('This email contains too many attachments to review safely.');
  const warnings = [
    'Only From, Sender, To, Cc, Bcc, Reply-to, Date and Subject fields, when supplied, and the selected readable body are included. Routing headers, message IDs and other raw headers are excluded.',
    email.text?.trim() ? 'The plain-text body is used. An HTML alternative, if present, is excluded; compare it with the original message.' : 'The HTML body is converted to plain text. Images, formatting, link targets and active content are excluded; hidden styling is removed.',
    'This is a new text PDF, not an email file. Saved work retains this PDF only. It cannot restore excluded attachments or the original email.'
  ];
  const attachmentLabels = attachments.map((a, i) => `${i + 1}. ${a.filename || 'unnamed file'} (${a.mimeType || 'unknown type'})`).join('; ');
  if (attachmentLabels.length > 90000) throw new Error('Attachment labels are too large to review and save safely. Remove the attachments or export a PDF first.');
  if (attachments.length) warnings.push('Excluded attachments/inline files (not opened): ' + attachmentLabels);
  else warnings.push('No attachments were reported by the email parser. Remote images are never loaded.');
  return { kind: 'Email text', text: boundedText(headers.join('\n') + '\n\n' + body), warnings, summary: 'Review the included message text and any excluded attachments before continuing.' };
}
export function parseText(text) {
  return { kind: 'Pasted / plain text', text: boundedText(text), summary: 'This text will become a new PDF for review and redaction.', warnings: ['Only the text supplied here is included. Pasted email excerpts do not include the rest of the original message, hidden headers or attachments.', 'Original formatting is replaced with a clean text layout. Saved work retains this converted PDF only.'] };
}
export async function textPDF(input, library, fontBytes) {
  const text = boundedText(input), pdf = await library.PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const unsupported = [...new Set([...text].filter(c => c !== '\n' && !supported.has(c.codePointAt(0))))];
  if (unsupported.length) throw new Error('The embedded conversion font cannot represent some characters (for example ' + unsupported.slice(0, 6).join(' ') + '). Export the original as a PDF instead; no characters have been silently replaced.');
  const size = 11, lineHeight = 16, width = 499, lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
  }
  const perPage = 44;
  if (Math.ceil(lines.length / perPage) > 60) throw new Error('The converted document exceeds 60 pages. Split the text first.');
  pdf.setTitle('Converted document'); pdf.setAuthor(''); pdf.setSubject(''); pdf.setCreator('Veil offline'); pdf.setProducer('Veil offline');
  for (let start = 0; start < lines.length; start += perPage) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText('VEIL / CONVERTED TEXT', { x: 48, y: 800, font, size: 8, color: library.rgb(.35, .42, .47) });
    lines.slice(start, start + perPage).forEach((line, i) => { if (line) page.drawText(line, { x: 48, y: 768 - i * lineHeight, font, size, color: library.rgb(.09, .13, .18) }); });
    page.drawText('Page ' + (start / perPage + 1), { x: 48, y: 38, font, size: 8, color: library.rgb(.35, .42, .47) });
  }
  return pdf.save();
}

export * from './flow.mjs';
export * from './design.mjs';

export * from './text-design.mjs';
