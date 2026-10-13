const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');

function client(Worker) {
  const dom = new JSDOM('', {runScripts:'outside-only'});
  dom.window.Worker = Worker;
  dom.window.eval(readFileSync('public/sdk-client.js', 'utf8'));
  return {dom, sdk:new dom.window.DocxRayClient()};
}

test('worker errors reject pending requests without a restart loop', async () => {
  const workers = [];
  class Worker {
    constructor() {workers.push(this);}
    postMessage() {}
    terminate() {this.terminated = true;}
  }
  const {dom, sdk} = client(Worker);
  try {
    const pending = sdk.call('inspect');
    workers[0].onerror({preventDefault() {}});
    await assert.rejects(pending, /worker failed/i);
    assert.equal(workers.length, 1);
    assert.equal(sdk.pending.size, 0);
    const retry = sdk.call('part');
    assert.equal(workers.length, 2);
    workers[1].onmessage({data:{id:2, result:'recovered'}});
    assert.equal(await retry, 'recovered');
  } finally {sdk.cancel(); dom.window.close();}
});

test('postMessage failures remove the pending request', async () => {
  class Worker {
    postMessage() {throw new Error('Cannot clone payload');}
    terminate() {}
  }
  const {dom, sdk} = client(Worker);
  try {
    await assert.rejects(sdk.call('inspect'), /clone/);
    assert.equal(sdk.pending.size, 0);
  } finally {sdk.cancel(); dom.window.close();}
});
