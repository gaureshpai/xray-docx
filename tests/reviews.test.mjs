import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
import {DocxRaySDK} from '../web/sdk.mjs';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function fixture(body, extras = {}) {
  const zip = await JSZip.loadAsync(readFileSync('tests/reviewed.docx'));
  zip.file('word/document.xml', `<w:document xmlns:w="${WORD}"><w:body>${body}</w:body></w:document>`);
  for (const [path, xml] of Object.entries(extras)) zip.file(path, xml);
  return zip.generateAsync({type:'uint8array'});
}

test('paragraph text preserves tabs, breaks and excludes removed/moved-from text', async () => {
  const bytes = await fixture('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t><w:cr/></w:r><w:moveFrom><w:r><w:t>old</w:t></w:r></w:moveFrom><w:del><w:r><w:delText>deleted</w:delText></w:r></w:del><w:ins><w:r><w:t>new</w:t></w:r></w:ins></w:p>');
  assert.equal((await new DocxRaySDK().inspect(bytes)).paragraphs[0].text, 'A\tB\nC\nnew');
});

test('revisions retain source order, mixed text order, property changes and source part', async () => {
  const bytes = await fixture('<w:p><w:del w:id="1"><w:r><w:delText>old</w:delText><w:t>mixed</w:t></w:r></w:del><w:ins w:id="2"><w:r><w:t>new</w:t></w:r></w:ins><w:pPr><w:pPrChange w:id="3"/></w:pPr></w:p><w:tbl><w:tblGrid><w:tblGridChange w:id="4"/></w:tblGrid><w:tr><w:trPr><w:trPrChange w:id="5"/></w:trPr><w:tc><w:tcPr><w:tcPrChange w:id="6"/></w:tcPr></w:tc></w:tr></w:tbl>');
  const result = await new DocxRaySDK().inspect(bytes);
  assert.deepEqual(result.revisions.map(r => r.id), ['1','2','3','4','5','6']);
  assert.equal(result.revisions[0].text, 'oldmixed');
  assert.ok(result.revisions.every(r => r.part === 'word/document.xml'));
});

test('reviews discover renamed comment parts and revisions in headers', async () => {
  const zip = await JSZip.loadAsync(await fixture('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
  const comments = await zip.file('word/comments.xml').async('string');
  zip.remove('word/comments.xml');
  zip.file('word/annotations.xml', comments);
  const types = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', types.replace('/word/comments.xml', '/word/annotations.xml').replace('</Types>', '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
  zip.file('word/header1.xml', `<w:hdr xmlns:w="${WORD}"><w:p><w:ins w:id="10" w:author="Header author"><w:r><w:t>Header revision</w:t></w:r></w:ins></w:p></w:hdr>`);
  const result = await new DocxRaySDK().inspect(await zip.generateAsync({type:'uint8array'}));
  assert.equal(result.comments[0]?.part, 'word/annotations.xml');
  assert.equal(result.revisions.find(r => r.id === '10')?.part, 'word/header1.xml');
});

test('paragraph text does not duplicate text inside a nested text-box paragraph', async () => {
  const bytes = await fixture('<w:p><w:r><w:t>Outer</w:t><w:drawing><w:txbxContent><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>');
  assert.deepEqual((await new DocxRaySDK().inspect(bytes)).paragraphs.map(p => p.text), ['Outer','Inner']);
});

test('comment cards show current text while removed text remains in revision records', async () => {
  const bytes = await fixture('<w:p/>', {'word/comments.xml':`<w:comments xmlns:w="${WORD}"><w:comment w:id="7"><w:p><w:del w:id="8"><w:r><w:delText>old</w:delText></w:r></w:del><w:moveFrom w:id="9"><w:r><w:t>moved</w:t></w:r></w:moveFrom><w:ins w:id="10"><w:r><w:t>current</w:t></w:r></w:ins></w:p></w:comment></w:comments>`});
  const result = await new DocxRaySDK().inspect(bytes);
  assert.equal(result.comments[0].text, 'current');
  assert.equal(result.revisions.find(r => r.id === '8').text, 'old');
  assert.equal(result.revisions.find(r => r.id === '9').text, 'moved');
});

test('removed text-box paragraphs stay mapped but do not leak into current text', async () => {
  for (const type of ['del','moveFrom']) {
    const bytes = await fixture(`<w:p><w:r><w:t>Visible</w:t></w:r><w:${type} w:id="20"><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Removed box</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:${type}></w:p>`);
    const sdk = new DocxRaySDK();
    const result = await sdk.inspect(bytes);
    assert.deepEqual(result.paragraphs.map(p => p.text), ['Visible','']);
    assert.equal(result.revisions.find(r => r.id === '20').text, 'Removed box');
    assert.match(sdk.paragraph(1), /Removed box/);
  }
});

test('multi-paragraph review text preserves boundaries, empty paragraphs and inline breaks', async () => {
  const xml = `<w:comments xmlns:w="${WORD}"><w:comment w:id="30"><w:p><w:r><w:t>First</w:t><w:br/><w:t>line</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Last</w:t></w:r><w:del><w:r><w:delText>hidden</w:delText></w:r></w:del></w:p></w:comment></w:comments>`;
  const bytes = await fixture('<w:p/>', {'word/comments.xml':xml});
  const sdk = new DocxRaySDK();
  const result = await sdk.inspect(bytes);
  assert.equal(result.comments[0].text, 'First\nline\n\nLast');
  assert.equal((await sdk.part('word/comments.xml')).xml, xml);
  assert.equal(Buffer.from(await sdk.download('word/comments.xml')).toString(), xml);
});
