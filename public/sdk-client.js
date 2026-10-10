'use strict';
class DocxRayClient {
  constructor(onProgress = () => {}) {this.onProgress = onProgress; this.next = 0; this.pending = new Map(); this.start();}
  start() {
    this.worker = new Worker('/worker.js');
    this.worker.onmessage = ({data}) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.progress) {this.onProgress(data.progress); return;}
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = () => this.cancel('Browser worker failed. Try again or use the offline CLI.');
  }
  call(action, payload = {}) {
    const id = ++this.next;
    return new Promise((resolve,reject) => {
      this.pending.set(id,{resolve,reject});
      this.worker.postMessage({id,action,...payload});
    });
  }
  cancel(message='Processing cancelled.') {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
    this.start();
  }
}
window.DocxRayClient = DocxRayClient;
