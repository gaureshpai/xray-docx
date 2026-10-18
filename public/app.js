'use strict';
const $ = (id) => document.getElementById(id);
let documentResult = null;
let selectedPart = null;
let currentFile = null;
let busy = false;
let replayTimers = [];
let operationVersion = 0;
let snippetVersion = 0;
let sampleController = null;
function prettyXml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) return source;
  const document = new DOMParser().parseFromString(source, 'application/xml');
  const root = document.documentElement;
  if (!root || root.localName === 'parsererror') return source;
  const serializer = new XMLSerializer();
  const indent = depth => '  '.repeat(depth);
  const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  function format(element, depth=0) {
    const children = [...element.childNodes];
    const elementChildren = children.some(child => child.nodeType === 1);
    if (!elementChildren) {
      const attributes = [...element.attributes].map(attribute => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
      if (!children.length) return `${indent(depth)}<${element.nodeName}${attributes}/>`;
      return `${indent(depth)}<${element.nodeName}${attributes}>${children.map(child => serializer.serializeToString(child)).join('')}</${element.nodeName}>`;
    }
    if (element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space') === 'preserve' || children.some(child => [3,4].includes(child.nodeType) && child.nodeValue.trim())) {
      return `${indent(depth)}${serializer.serializeToString(element)}`;
    }
    const attributes = [...element.attributes].map(attribute => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
    const content = children.filter(child => !(child.nodeType === 3 && !child.nodeValue.trim())).map(child => child.nodeType === 1 ? format(child, depth + 1) : `${indent(depth + 1)}${serializer.serializeToString(child)}`);
    return `${indent(depth)}<${element.nodeName}${attributes}>\n${content.join('\n')}\n${indent(depth)}</${element.nodeName}>`;
  }
  const declaration = source.match(/^\s*(<\?xml\b[^?]*\?>)/i)?.[1];
  return `${declaration ? `${declaration}\n` : ''}${format(root)}`;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function replaceContents(id, nodes) {
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(node);
  $(id).replaceChildren(fragment);
}
function setBusy(value) {
  busy = value;
  for (const id of ['file', 'sample']) $(id).disabled = value;
  $('export').disabled = value || !currentFile;
  $('download').disabled = value || !selectedPart;
  for (const button of document.querySelectorAll('#parts button, #paragraphs button, #reviews button')) button.disabled = value;
  $('cancel').hidden = !value;
  $('dropzone').setAttribute('aria-busy', String(value));
}
const sdk = new window.DocxRayClient(message => status(message));
let selectionVersion = 0;
async function inspect(file) {
  if (busy) return;
  if (!file.name.toLowerCase().endsWith('.docx')) return status('Choose a .docx document.', true);
  if (!file.size) return status('Choose a nonempty document.', true);
  const version = ++operationVersion;
  ++selectionVersion; ++snippetVersion;
  replayTimers.forEach(clearTimeout); replayTimers = [];
  documentResult = null; selectedPart = null; currentFile = null; $('workspace').hidden = true;
  setBusy(true);
  status('Opening the ZIP package and reading its XML…');
  try {
    const result = await sdk.call('inspect', {file, filename:file.name});
    if (version !== operationVersion) return;
    documentResult = result;
    currentFile = file;
    await render(version);
    if (version !== operationVersion) return;
    status(`Inspected ${result.summary.parts} package parts and ${result.summary.xmlParts} XML parts.`);
    $('workspace').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
  } catch (error) {
    if (version !== operationVersion) return;
    documentResult = null; selectedPart = null; currentFile = null;
    $('workspace').hidden = true;
    status(error.name === 'AbortError' ? 'Request timed out. Try a smaller document or use the CLI.' : error.message, true);
  } finally {if (version === operationVersion) setBusy(false);}
}
async function selectPart(part, allowBusy=false) {
  if (busy && !allowBusy) return;
  const version = ++selectionVersion;
  selectedPart = part;
  $('partname').textContent = part.path;
  $('xml').textContent = 'Reading this part in your browser…';
  $('partinfo').textContent = '';
  $('download').disabled = true;
  renderParts();
  try {
    const data = await sdk.call('part', {path:part.path});
    if (version !== selectionVersion) return;
    $('partinfo').textContent = `${part.bytes.toLocaleString()} bytes · ${data.note}`;
    $('xml').textContent = data.xml ? prettyXml(data.xml) : data.preview;
    $('download').disabled = busy;
  } catch (error) {
    if (allowBusy) throw error;
    if (version === selectionVersion) $('xml').textContent = error.message;
  }
}
function renderParts() {
  const query = $('filter').value.toLowerCase();
  const nodes = documentResult.parts.filter(p => p.path.toLowerCase().includes(query)).map(part => {
    const button = element('button', part.path, selectedPart?.path === part.path ? 'selected' : '');
    button.setAttribute('aria-pressed', String(selectedPart?.path === part.path));
    button.disabled = busy;
    button.append(element('small', `${part.kind.toUpperCase()} · ${part.bytes.toLocaleString()} B`));
    button.addEventListener('click', () => selectPart(part));
    return button;
  });
  replaceContents('parts', nodes.length ? nodes : [element('p', 'No matching parts.', 'muted')]);
}
function showTab(name) {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const active = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`${tab.dataset.tab}-panel`).hidden = !active;
  }
}
function replay() {
  replayTimers.forEach(clearTimeout);
  replayTimers = [];
  const steps = [...$('steps').children];
  steps.forEach(step => step.classList.remove('active'));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    steps.forEach(step => step.classList.add('active'));
    return;
  }
  steps.forEach((step, i) => replayTimers.push(setTimeout(() => step.classList.add('active'), i * 420)));
}
async function render(version) {
  const renderedDocument = documentResult;
  $('workspace').hidden = false;
  $('filename').textContent = documentResult.filename;
  $('filter').value = '';
  const labels = {parts:'Package parts',xmlParts:'XML parts',paragraphs:'Paragraphs',runs:'Text runs',tables:'Tables',media:'Media assets'};
  $('stats').replaceChildren(...Object.entries(documentResult.summary).map(([key, value]) => {
    const card = element('div', undefined, 'stat');
    card.append(element('strong', String(value)), element('span', labels[key]));
    return card;
  }));
  $('steps').replaceChildren(...documentResult.steps.map((step, i) => {
    const node = element('li');
    node.append(element('b', `0${i + 1}`), element('strong', step.title), element('p', step.detail));
    return node;
  }));
  replaceContents('paragraphs', documentResult.paragraphs.map(paragraph => {
    const button = element('button', paragraph.text || '(empty paragraph)');
    button.disabled = busy;
    button.addEventListener('click', async () => {
      if (busy) return;
      const snippet = ++snippetVersion;
      for (const child of $('paragraphs').children) child.classList.remove('selected');
      button.classList.add('selected');
      try {
        const xml = await sdk.call('paragraph', {index:paragraph.index});
        if (snippet === snippetVersion && renderedDocument === documentResult) $('snippet').textContent = xml;
      } catch (error) {if (snippet === snippetVersion && renderedDocument === documentResult) $('snippet').textContent = error.message;}
    });
    return button;
  }));
  $('snippet').textContent = 'Select a paragraph.';
  replaceContents('relations', documentResult.relationships.map(rel => {
    const card = element('div', undefined, 'relationship');
    card.append(element('strong', `${rel.type} · ${rel.id}`), element('div', `${rel.source} → ${rel.target}`),
      element('span', rel.external ? 'External reference · not fetched' : rel.exists ? `Resolved: ${rel.resolved}` : `Missing: ${rel.resolved}`));
    return card;
  }));
  replaceContents('warnings', documentResult.warnings.map(warning => element('li', warning)));
  replaceContents('reviews', [...documentResult.comments.map(comment => ({...comment, type:'Comment'})), ...documentResult.revisions].map(review => {
    const card = element('div', undefined, 'relationship');
    card.append(element('strong', `${review.type} · ${review.author || 'Unknown author'} · ID ${review.id}`), element('p', review.text || '(formatting / structural change)'), element('pre', review.xml));
    card.append(element('small', `${review.part}${review.date ? ` · ${review.date}` : ''}`));
    const source = element('button', 'Open source part', 'link');
    source.type = 'button';
    source.disabled = busy;
    source.addEventListener('click', () => {
      if (busy) return;
      showTab('raw');
      selectPart(documentResult.parts.find(part => part.path === review.part));
    });
    card.append(source);
    return card;
  }));
  if (!$('reviews').children.length) $('reviews').append(element('p', 'No parsed comments or revision records found. Explore Raw XML for every part.', 'muted'));
  await selectPart(documentResult.parts.find(p => p.path === documentResult.mainPart), true);
  if (version !== operationVersion) return;
  showTab('raw');
  replay();
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('file').addEventListener('change', event => {
  if (event.target.files[0]) inspect(event.target.files[0]);
  event.target.value = '';
});
$('sample').addEventListener('click', async () => {
  if (busy) return;
  const version = ++operationVersion;
  const controller = new AbortController();
  sampleController = controller;
  setBusy(true);
  status('Loading the sample…');
  try {
    const response = await fetch('/sample.docx', {signal:controller.signal});
    if (!response.ok) throw new Error('Could not load sample.');
    const file = new File([await response.blob()], 'sample.docx');
    if (version !== operationVersion) return;
    setBusy(false);
    await inspect(file);
  } catch (error) {if (version === operationVersion) {status(error.message, true); setBusy(false);}}
  finally {if (sampleController === controller) sampleController = null;}
});
$('filter').addEventListener('input', () => {if (documentResult) renderParts();});
$('replay').addEventListener('click', replay);
$('download').addEventListener('click', async () => {
  if (!selectedPart || busy) return;
  const part = selectedPart;
  const version = ++operationVersion;
  setBusy(true);
  status('Preparing the original part in your browser…');
  try {
    const bytes = await sdk.call('download', {path:part.path});
    if (version !== operationVersion) return;
    download(new Blob([bytes], {type:part.contentType}), part.path.split('/').pop());
    status('Downloaded original part bytes.');
  } catch (error) {if (version === operationVersion) status(error.message, true);} finally {if (version === operationVersion) setBusy(false);}
});
$('export').addEventListener('click', async () => {
  if (!currentFile || busy) return;
  const version = ++operationVersion;
  setBusy(true);
  status('Preparing the original XML parts…');
  try {
    const bytes = await sdk.call('export');
    if (version !== operationVersion) return;
    download(new Blob([bytes], {type:'application/zip'}), 'xray-docx-xml.zip');
    status('Downloaded XML bundle with original part bytes.');
  } catch (error) {if (version === operationVersion) status(error.message, true);} finally {if (version === operationVersion) setBusy(false);}
});
const tabs = [...document.querySelectorAll('[data-tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    showTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });
});
showTab('raw');
for (const name of ['dragenter','dragover']) $('dropzone').addEventListener(name, event => {event.preventDefault(); $('dropzone').classList.add('drag');});
for (const name of ['dragleave','drop']) $('dropzone').addEventListener(name, event => {event.preventDefault(); $('dropzone').classList.remove('drag');});
$('dropzone').addEventListener('drop', event => {const file = event.dataTransfer.files[0]; if (file) inspect(file);});

$('cancel').addEventListener('click', () => {
  ++operationVersion; ++selectionVersion; ++snippetVersion;
  sampleController?.abort(); sampleController = null;
  sdk.cancel();
  replayTimers.forEach(clearTimeout); replayTimers = [];
  documentResult = null; currentFile = null; selectedPart = null;
  $('workspace').hidden = true; setBusy(false); status('Processing cancelled.');
});
setBusy(false);
