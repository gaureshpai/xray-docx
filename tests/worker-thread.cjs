// Execute the exact browser bundle in a real Node worker for DOM integration tests.
const {parentPort} = require('node:worker_threads');
global.self = global;
self.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
require('../public/worker.js');
parentPort.on('message', data => self.onmessage({data}));
