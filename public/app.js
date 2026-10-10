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
  for (const id of ['file', 'sample', 'export']) $(id).disabled = value;
  $('dropzone').setAttribute('aria-busy', String(value));
}
async function request(path, file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(path, {method: 'POST', headers: {
      'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name)
    }, body: file, signal: controller.signal});
    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try {message = (await response.json()).error || message;} catch { /* Non-JSON platform error. */ }
      throw new Error(message);
    }
    return response;
  } finally { clearTimeout(timer); }
}
async function inspect(file) {
  if (busy) return;
  if (!file.name.toLowerCase().endsWith('.docx')) return status('Choose a .docx document.', true);
  if (!file.size || file.size > 3000000) return status('Choose a nonempty document up to 3 MB. Use the CLI for larger files.', true);
  setBusy(true);
  status('Opening the ZIP package and reading its XML…');
  try {
    const response = await request('/api/inspect', file);
    const result = await response.json();
    documentResult = result;
    currentFile = file;
    render();
    status(`Inspected ${result.summary.parts} package parts and ${result.summary.xmlParts} XML parts.`);
    $('workspace').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
  } catch (error) {
    status(error.name === 'AbortError' ? 'Request timed out. Try a smaller document or use the CLI.' : error.message, true);
  } finally {setBusy(false);}
}
function selectPart(part) {
  selectedPart = part;
  $('partname').textContent = part.path;
  $('partinfo').textContent = `${part.bytes.toLocaleString()} bytes · ${part.kind === 'xml' ? 'Decoded source XML · downloads preserve original part bytes' : 'Binary part; shown in the package inventory only'}`;
  $('xml').textContent = part.kind === 'xml' ? part.xml : 'This is a binary asset, not an XML document.';
  $('download').disabled = part.kind !== 'xml';
  renderParts();
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
function render() {
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
    button.addEventListener('click', () => {
      for (const child of $('paragraphs').children) child.classList.remove('selected');
      button.classList.add('selected');
      $('snippet').textContent = paragraph.xml;
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
  selectPart(documentResult.parts.find(p => p.path === documentResult.mainPart));
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
  if (selectedPart?.kind !== 'xml' || busy) return;
  const part = selectedPart;
  setBusy(true);
  status('Preparing the original XML part…');
  try {
    const response = await request(`/api/part?path=${encodeURIComponent(part.path)}`, currentFile);
    download(await response.blob(), part.path.split('/').pop());
    status('Downloaded original XML part bytes.');
  } catch (error) {status(error.message, true);} finally {setBusy(false);}
});
$('export').addEventListener('click', async () => {
  if (!currentFile || busy) return;
  setBusy(true);
  status('Preparing the original XML parts…');
  try {
    const response = await request('/api/export', currentFile);
    download(await response.blob(), 'docx-ray-xml.zip');
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
