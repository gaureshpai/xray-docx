'use strict';
class DocxRayClient {
  constructor(onProgress = () => {}) {this.onProgress = onProgress; this.next = 0; this.pending = new Map(); this.worker = null;}
  start() {
    const worker = new Worker('/worker.js');
    this.worker = worker;
    worker.onmessage = ({data}) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.progress) {this.onProgress(data.progress); return;}
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    worker.onerror = event => {event.preventDefault?.(); if (this.worker === worker) this.cancel('Browser worker failed. Try again or use the offline CLI.');};
    worker.onmessageerror = () => {if (this.worker === worker) this.cancel('Browser worker response could not be read. Try again.');};
  }
  call(action, payload = {}) {
    const id = ++this.next;
    return new Promise((resolve,reject) => {
      try {
        if (!this.worker) this.start();
        this.pending.set(id,{resolve,reject});
        this.worker.postMessage({...payload,id,action});
      } catch (error) {this.pending.delete(id); reject(error);}
    });
  }
  cancel(message='Processing cancelled.') {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }
}
window.DocxRayClient = DocxRayClient;
