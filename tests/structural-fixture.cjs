// Synthetic Word table revisions; no private document content.
const {readFileSync} = require('node:fs');
const JSZip = require('jszip');
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function deletedTableFixture(ns=WORD) {
  const zip = await JSZip.loadAsync(readFileSync('tests/reviewed.docx'));
  const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = text => `<w:tc>${p(text)}</w:tc>`;
  const table = `<w:tbl><w:tr>${cell('Visible row')}</w:tr><w:tr><w:trPr><w:del w:id="101" w:author="Row author"/></w:trPr>${cell('Deleted row')}${cell('Second removed cell')}</w:tr><w:tr><w:tc><w:tcPr><w:cellDel w:id="102" w:author="Cell author"/></w:tcPr>${p('Deleted cell')}</w:tc>${cell('Visible cell')}</w:tr><w:tr><w:trPr><w:trPrChange w:id="103"><w:trPr><w:del w:id="104"/></w:trPr></w:trPrChange></w:trPr><w:tc><w:tcPr><w:tcPrChange w:id="105"><w:tcPr><w:cellDel w:id="106"/></w:tcPr></w:tcPrChange></w:tcPr>${p('Historical properties retained')}</w:tc></w:tr></w:tbl>`;
  zip.file('word/document.xml', `<w:document xmlns:w="${ns}"><w:body>${table}<w:p><w:pPr><w:rPr><w:del w:id="107"/></w:rPr></w:pPr><w:r><w:t>Paragraph mark retained</w:t></w:r></w:p></w:body></w:document>`);
  zip.file('word/comments.xml', `<w:comments xmlns:w="${ns}"><w:comment w:id="108">${p('Visible comment')}<w:tbl><w:tr><w:trPr><w:del w:id="109"/></w:trPr>${cell('Removed comment row')}</w:tr></w:tbl></w:comment></w:comments>`);
  zip.file('word/header1.xml', `<w:hdr xmlns:w="${ns}"><w:tbl><w:tr><w:trPr><w:del w:id="110"/></w:trPr>${cell('Removed header row')}</w:tr></w:tbl></w:hdr>`);
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string')).replace('</Types>', '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
  return zip.generateAsync({type:'nodebuffer'});
}
module.exports = {deletedTableFixture};
