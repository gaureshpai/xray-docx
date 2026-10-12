'use strict';
const $ = (id) => document.getElementById(id);
let documentResult = null;
let selectedPart = null;
let currentFile = null;
let busy = false;
let replayTimers = [];
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
function setBusy(value) {
  busy = value;
  for (const id of ['file', 'sample', 'export', 'download']) $(id).disabled = value;
  $('cancel').hidden = !value;
  $('dropzone').setAttribute('aria-busy', String(value));
}
const sdk = new window.DocxRayClient(message => status(message));
let selectionVersion = 0;
async function inspect(file) {
  if (busy) return;
  if (!file.name.toLowerCase().endsWith('.docx')) return status('Choose a .docx document.', true);
  if (!file.size) return status('Choose a nonempty document.', true);
  documentResult = null; selectedPart = null; currentFile = null; $('workspace').hidden = true;
  setBusy(true);
  status('Opening the ZIP package and reading its XML…');
  try {
    const result = await sdk.call('inspect', {file, filename:file.name});
    documentResult = result;
    currentFile = file;
    await render();
    status(`Inspected ${result.summary.parts} package parts and ${result.summary.xmlParts} XML parts.`);
    $('workspace').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
  } catch (error) {
    status(error.name === 'AbortError' ? 'Request timed out. Try a smaller document or use the CLI.' : error.message, true);
  } finally {setBusy(false);}
}
async function selectPart(part) {
  const version = ++selectionVersion;
  selectedPart = part;
  $('partname').textContent = part.path;
  $('xml').textContent = 'Reading this part in your browser…';
  renderParts();
  try {
    const data = await sdk.call('part', {path:part.path});
    if (version !== selectionVersion) return;
    $('partinfo').textContent = `${part.bytes.toLocaleString()} bytes · ${data.note}`;
    $('xml').textContent = data.xml ?? data.preview;
    $('download').disabled = false;
  } catch (error) {
    if (version === selectionVersion) $('xml').textContent = error.message;
  }
}
function renderParts() {
  const query = $('filter').value.toLowerCase();
  const nodes = documentResult.parts.filter(p => p.path.toLowerCase().includes(query)).map(part => {
    const button = element('button', part.path, selectedPart?.path === part.path ? 'selected' : '');
    button.setAttribute('aria-pressed', String(selectedPart?.path === part.path));
    button.append(element('small', `${part.kind.toUpperCase()} · ${part.bytes.toLocaleString()} B`));
    button.addEventListener('click', () => selectPart(part));
    return button;
  });
  $('parts').replaceChildren(...(nodes.length ? nodes : [element('p', 'No matching parts.', 'muted')]));
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
async function render() {
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
  $('paragraphs').replaceChildren(...documentResult.paragraphs.map(paragraph => {
    const button = element('button', paragraph.text || '(empty paragraph)');
    button.addEventListener('click', async () => {
      for (const child of $('paragraphs').children) child.classList.remove('selected');
      button.classList.add('selected');
      try {$('snippet').textContent = await sdk.call('paragraph', {index:paragraph.index});}
      catch (error) {$('snippet').textContent = error.message;}
    });
    return button;
  }));
  $('snippet').textContent = 'Select a paragraph.';
  $('relations').replaceChildren(...documentResult.relationships.map(rel => {
    const card = element('div', undefined, 'relationship');
    card.append(element('strong', `${rel.type} · ${rel.id}`), element('div', `${rel.source} → ${rel.target}`),
      element('span', rel.external ? 'External reference · not fetched' : rel.exists ? `Resolved: ${rel.resolved}` : `Missing: ${rel.resolved}`));
    return card;
  }));
  $('warnings').replaceChildren(...documentResult.warnings.map(warning => element('li', warning)));
  $('reviews').replaceChildren(...[...documentResult.comments.map(comment => ({...comment, type:'Comment'})), ...documentResult.revisions].map(review => {
    const card = element('div', undefined, 'relationship');
    card.append(element('strong', `${review.type} · ${review.author || 'Unknown author'} · ID ${review.id}`), element('p', review.text || '(formatting / structural change)'), element('pre', review.xml));
    card.append(element('small', `${review.part}${review.date ? ` · ${review.date}` : ''}`));
    return card;
  }));
  if (!$('reviews').children.length) $('reviews').append(element('p', 'No parsed comments or revision records found. Explore Raw XML for every part.', 'muted'));
  await selectPart(documentResult.parts.find(p => p.path === documentResult.mainPart));
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
  setBusy(true);
  status('Loading the sample…');
  try {
    const response = await fetch('/sample.docx');
    if (!response.ok) throw new Error('Could not load sample.');
    const file = new File([await response.blob()], 'sample.docx');
    setBusy(false);
    await inspect(file);
  } catch (error) {status(error.message, true); setBusy(false);}
});
$('filter').addEventListener('input', () => {if (documentResult) renderParts();});
$('replay').addEventListener('click', replay);
$('download').addEventListener('click', async () => {
  if (!selectedPart || busy) return;
  const part = selectedPart;
  setBusy(true);
  status('Preparing the original part in your browser…');
  try {
    const bytes = await sdk.call('download', {path:part.path});
    download(new Blob([bytes], {type:part.contentType}), part.path.split('/').pop());
    status('Downloaded original part bytes.');
  } catch (error) {status(error.message, true);} finally {setBusy(false);}
});
$('export').addEventListener('click', async () => {
  if (!currentFile || busy) return;
  setBusy(true);
  status('Preparing the original XML parts…');
  try {
    const bytes = await sdk.call('export');
    download(new Blob([bytes], {type:'application/zip'}), 'docx-ray-xml.zip');
    status('Downloaded XML bundle with original part bytes.');
  } catch (error) {status(error.message, true);} finally {setBusy(false);}
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

$('cancel').addEventListener('click', () => {sdk.cancel(); ++selectionVersion; documentResult = null; currentFile = null; $('workspace').hidden = true; setBusy(false); status('Processing cancelled.');});
