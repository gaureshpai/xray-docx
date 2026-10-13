const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Worker} = require('node:worker_threads');
const {join} = require('node:path');
const {readFileSync} = require('node:fs');

test('worker serializes an inspection followed immediately by a part read', async () => {
  const worker = new Worker(join(__dirname, 'worker-thread.cjs'));
  try {
    const responses = new Map();
    const completed = new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', data => {
        if (data.progress) return;
        responses.set(data.id, data);
        if (responses.size === 2) resolve();
      });
    });
    worker.postMessage({id:1, action:'inspect', file:new File([readFileSync('public/sample.docx')], 'sample.docx'), filename:'sample.docx'});
    worker.postMessage({id:2, action:'part', path:'word/document.xml'});
    await completed;
    assert.equal(responses.get(1).error, undefined);
    assert.equal(responses.get(2).error, undefined);
    assert.match(responses.get(2).result.xml, /Hello from DOCX Ray/);
  } finally {await worker.terminate();}
});
