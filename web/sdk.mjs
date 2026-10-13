/** Browser-compatible OOXML SDK. No network calls and no application size caps. */
import JSZip from 'jszip';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';
import {loadArchive} from './archive.mjs';

const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = new Set(['http://schemas.openxmlformats.org/package/2006/relationships','http://purl.oclc.org/ooxml/package/relationships']);
const OFFICE_DOCUMENT = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument','http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument']);
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const localChildren = node => [...node.childNodes].filter(child => child.nodeType === 1);
const list = (node, ns, name) => [...node.getElementsByTagNameNS(ns, name)];
const attr = (node, ns, name) => node.getAttributeNS(ns, name) || '';
function pushChildren(stack, node) {
  for (let child = node.lastChild; child; child = child.previousSibling) {
    if (child.nodeType === 1) stack.push(child);
  }
}
const REVISION_TYPES = new Set(['ins','del','moveFrom','moveTo','rPrChange','pPrChange','tblPrChange','tblGridChange','trPrChange','tcPrChange','sectPrChange','numberingChange','cellIns','cellDel','cellMerge','customXmlInsRangeStart','customXmlDelRangeStart','customXmlMoveFromRangeStart','customXmlMoveToRangeStart']);
function textProjection(root, {removed=false, nestedParagraphs=true} = {}) {
  // A paragraph discovered independently can still belong to a removed drawing.
  if (!removed && !nestedParagraphs) {
    for (let parent = root.parentNode; parent; parent = parent.parentNode) {
      if (WORD.has(parent.namespaceURI) && ['del','moveFrom'].includes(parent.localName)) return '';
    }
  }
  const chunks = [], stack = [root];
  let paragraphCount = 0;
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType !== 1) continue;
    if (WORD.has(node.namespaceURI)) {
      if (!removed && ['del','moveFrom'].includes(node.localName)) continue;
      if (!nestedParagraphs && node !== root && node.localName === 'p') continue;
      if (nestedParagraphs && node.localName === 'p' && paragraphCount++) chunks.push('\n');
      if (node.localName === 't' || (removed && node.localName === 'delText')) {chunks.push(node.textContent); continue;}
      if (node.localName === 'tab') chunks.push('\t');
      if (['br','cr'].includes(node.localName)) chunks.push('\n');
      if (node.localName === 'noBreakHyphen') chunks.push('\u2011');
      if (node.localName === 'softHyphen') chunks.push('\u00ad');
    }
    pushChildren(stack, node);
  }
  return chunks.join('');
}
const normalize = value => {
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {if (!parts.length) throw new Error('Relationship escapes the package.'); parts.pop();}
    else parts.push(part);
  }
  return parts.join('/');
};
function decode(bytes) {
  let encoding = 'utf-8';
  let skip = 0;
  const le32 = bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0;
  const be32 = bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff;
  if (le32 || be32) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if ((bytes.length - 4) % 4) throw new Error('Invalid UTF-32 XML.');
    let output = '', points = [];
    for (let offset = 4; offset < bytes.length; offset += 4) {
      const point = view.getUint32(offset, le32);
      if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error('Invalid UTF-32 code point.');
      points.push(point);
      if (points.length === 8192) {output += String.fromCodePoint(...points); points = [];}
    }
    return output + String.fromCodePoint(...points);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {encoding = 'utf-16le'; skip = 2;}
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) {encoding = 'utf-16be'; skip = 2;}
  else if (bytes[0] === 0 && bytes[1] === 0x3c) encoding = 'utf-16be';
  else if (bytes[0] === 0x3c && bytes[1] === 0) encoding = 'utf-16le';
  else {
    const declaration = new TextDecoder().decode(bytes.slice(0, 256)).match(/<\?xml[^>]*encoding\s*=\s*['"]([^'"]+)['"]/i);
    if (declaration) encoding = declaration[1];
  }
  return new TextDecoder(encoding, {fatal:true}).decode(bytes.subarray(skip));
}
function parse(text) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new Error('XML contains a forbidden control character.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD/entity declarations are not parsed. Original XML can still be viewed and downloaded.');
  return new DOMParser({onError:(level, message) => {
    // Bytes were decoded with a fatal decoder. A literal U+FFFD is legal XML text.
    if (level === 'warning' && message === 'Unicode replacement character detected, source encoding issues?') return;
    throw new Error(`Malformed XML: ${message}`);
  }}).parseFromString(text, 'application/xml');
}
function hex(bytes) {
  const lines = [];
  for (let offset = 0; offset < Math.min(bytes.length, 512); offset += 16) {
    const row = bytes.subarray(offset, offset + 16);
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${[...row].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${[...row].map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('')}`);
  }
  return lines.join('\n');
}
export class DocxRaySDK {
  constructor() {this.archive = null; this.parts = []; this.paragraphNodes = [];}
  async inspect(input, filename='document.docx', progress=() => {}) {
    this.archive = null;
    this.parts = [];
    this.paragraphNodes = [];
    try {return await this.#inspectPackage(input, filename, progress);}
    catch (error) {
      this.archive = null; this.parts = []; this.paragraphNodes = [];
      throw error;
    }
  }
  requireDocument() {
    if (!this.archive) throw new Error('Inspect a valid document first.');
  }
  async #inspectPackage(input, filename, progress) {
    if (!filename.toLowerCase().endsWith('.docx')) throw new Error('Choose a .docx document.');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length) throw new Error('Choose a nonempty document.');
    progress('Opening the ZIP package and verifying entry CRCs…');
    let archive;
    try {archive = await loadArchive(bytes);}
    catch (error) {throw new Error(`Invalid, corrupt, encrypted or unsupported ZIP: ${error.message}`);}
    const entries = Object.values(archive.files).filter(file => !file.dir);
    for (const file of entries) {
      const name = file.unsafeOriginalName || file.name;
      if (name !== file.name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('Unsafe archive path.');
    }
    if (!archive.file('[Content_Types].xml') || !archive.file('_rels/.rels')) throw new Error('Not an OOXML package: content types and relationships are required.');
    const types = parse(decode(await archive.file('[Content_Types].xml').async('uint8array')));
    if (types.documentElement.namespaceURI !== CONTENT || types.documentElement.localName !== 'Types') throw new Error('Invalid package content types.');
    const overrides = new Map(), defaults = new Map();
    for (const item of localChildren(types.documentElement)) {
      if (item.namespaceURI !== CONTENT) continue;
      if (item.localName === 'Override') overrides.set(item.getAttribute('PartName').replace(/^\//,''), item.getAttribute('ContentType'));
      if (item.localName === 'Default') defaults.set(item.getAttribute('Extension').toLowerCase(), item.getAttribute('ContentType'));
    }
    const relationships = [], warnings = [];
    let mainPart;
    progress('Reading package relationships…');
    for (const file of entries.filter(file => file.name.endsWith('.rels'))) {
      let root;
      try {
        root = parse(decode(await file.async('uint8array'))).documentElement;
        if (root.localName !== 'Relationships' || !REL.has(root.namespaceURI)) throw new Error('Invalid package relationships XML.');
      }
      catch (error) {
        if (file.name === '_rels/.rels') throw error;
        warnings.push(`${file.name}: ${error.message}`); continue;
      }
      const source = file.name === '_rels/.rels' ? '/' : file.name.replace(/(^|\/)\_rels\//, '$1').replace(/\.rels$/, '');
      for (const item of localChildren(root)) {
        if (item.localName !== 'Relationship' || item.namespaceURI !== root.namespaceURI) continue;
        const target = item.getAttribute('Target');
        const external = item.getAttribute('TargetMode') === 'External';
        const base = source === '/' || target.startsWith('/') ? '' : source.slice(0, source.lastIndexOf('/') + 1);
        let resolved = null;
        if (!external) resolved = normalize(base + target);
        const relation = {source, target, external, resolved, id:item.getAttribute('Id'), type:item.getAttribute('Type').split('/').pop(), exists:external ? null : Boolean(archive.file(resolved))};
        relationships.push(relation);
        if (source === '/' && OFFICE_DOCUMENT.has(item.getAttribute('Type')) && !external) {
          if (mainPart) throw new Error('Multiple main document relationships.');
          mainPart = resolved;
        }
      }
    }
    if (!mainPart || !archive.file(mainPart) || overrides.get(mainPart) !== MAIN_TYPE) throw new Error('This package does not contain a macro-free DOCX main document.');
    // Size metadata uses the pinned JSZip entry representation.
    // Regression tests compare these values with actual uncompressed bytes.
    const parts = entries.map(file => {
      const contentType = overrides.get(file.name) || defaults.get(file.name.split('.').pop().toLowerCase()) || 'application/octet-stream';
      return {path:file.name, kind:/\.(xml|rels)$/i.test(file.name) || /xml/i.test(contentType) ? 'xml' : 'binary', contentType,
        bytes:file._data?.uncompressedSize ?? 0, compressedBytes:file._data?.compressedSize ?? 0};
    });
    progress('Mapping document text, comments and tracked changes…');
    const main = parse(decode(await archive.file(mainPart).async('uint8array'))).documentElement;
    if (main.localName !== 'document' || !WORD.has(main.namespaceURI)) throw new Error('Invalid WordprocessingML document root.');
    const ns = main.namespaceURI;
    const paragraphNodes = list(main, ns, 'p');
    const paragraphs = paragraphNodes.map((node, index) => ({index, text:textProjection(node, {nestedParagraphs:false})}));
    const revisions = [], comments = [];
    const commentTargets = new Set(relationships.filter(rel => !rel.external && rel.type === 'comments').map(rel => rel.resolved));
    const reviewParts = parts.filter(part => part.path === mainPart || part.contentType.includes('wordprocessingml') || commentTargets.has(part.path) || /(^|\/)comments[^/]*\.xml$/i.test(part.path));
    for (const part of reviewParts.filter(part => part.kind === 'xml')) {
      try {
        const root = part.path === mainPart ? main : parse(decode(await archive.file(part.path).async('uint8array'))).documentElement;
        const stack = [root];
        while (stack.length) {
          const node = stack.pop();
          if (WORD.has(node.namespaceURI)) {
            const type = node.localName, nodeNs = node.namespaceURI;
            if (type === 'comment' || REVISION_TYPES.has(type)) {
              const record = {part:part.path, id:attr(node, nodeNs, 'id'), author:attr(node, nodeNs, 'author'), date:attr(node, nodeNs, 'date'),
                text:textProjection(node, {removed:['del','moveFrom'].includes(type)}), xml:new XMLSerializer().serializeToString(node)};
              if (type === 'comment') comments.push(record); else revisions.push({...record, type});
            }
          }
          pushChildren(stack, node);
        }
      } catch (error) {warnings.push(`${part.path}: ${error.message}`);}
    }
    warnings.push('The text view is a projection, not a Word layout renderer. Deleted text appears under Reviews and Raw XML.', 'Paragraph and review snippets are reserialized. Raw XML and downloads retain the original part contents.', 'No application file-size cap. Available browser memory and ZIP/encoding support set practical limits.');
    if (relationships.some(rel => rel.external)) warnings.push('External relationships are displayed only, never fetched.');
    this.archive = archive; this.parts = parts; this.paragraphNodes = paragraphNodes;
    return {filename, mainPart, compressedBytes:bytes.length, expandedBytes:parts.reduce((sum, part) => sum + part.bytes,0), parts, relationships, paragraphs, revisions, comments, warnings,
      summary:{parts:parts.length, xmlParts:parts.filter(part => part.kind === 'xml').length, paragraphs:paragraphs.length, runs:list(main,ns,'r').length, tables:list(main,ns,'tbl').length, media:parts.filter(part => part.path.includes('/media/')).length},
      steps:[{title:'Open ZIP container',detail:`${bytes.length.toLocaleString()} bytes read in your browser.`},{title:'Validate package',detail:'Verified CRCs, package paths and content types.'},{title:'Locate document',detail:`Main document: ${mainPart}.`},{title:'Explore package parts',detail:`${parts.length} files; XML is decoded on demand.`},{title:'Map text and reviews',detail:`${paragraphs.length} paragraphs, ${comments.length} comments, ${revisions.length} revision records.`}]};
  }
  async part(path) {
    this.requireDocument();
    const metadata = this.parts.find(part => part.path === path);
    if (!metadata) throw new Error('Package part not found.');
    const bytes = await this.archive.file(path).async('uint8array');
    if (metadata.kind === 'binary') return {...metadata, preview:hex(bytes), note:'Hex preview of the first 512 bytes. Download the full original part.'};
    try {return {...metadata, xml:decode(bytes), note:'Decoded source XML. Download preserves original bytes and encoding.'};}
    catch (error) {return {...metadata, preview:hex(bytes), note:error.message};}
  }
  paragraph(index) {
    this.requireDocument();
    const node = this.paragraphNodes[index];
    if (!node) throw new Error('Paragraph not found.');
    return new XMLSerializer().serializeToString(node);
  }
  async download(path) {
    this.requireDocument();
    if (!this.parts.some(part => part.path === path)) throw new Error('Package part not found.');
    return this.archive.file(path).async('uint8array');
  }
  async exportXml() {
    this.requireDocument();
    const output = new JSZip();
    for (const part of this.parts.filter(part => part.kind === 'xml')) output.file(part.path, await this.download(part.path));
    return output.generateAsync({type:'uint8array', compression:'DEFLATE'});
  }
}
