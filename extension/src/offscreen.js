/* global chrome */
// Runs in a normal page context (chrome.offscreen), not ServiceWorkerGlobalScope — so unlike
// background.js, dynamic import(), Worker, and WebGPU are all actually available here. This
// is the whole reason this file exists instead of running the model in the service worker.
import { pipeline, env } from './vendor/transformers.web.min.js';

env.allowLocalModels = false;
// onnxruntime-web's multithreaded WASM path has a known bug; pin to 1 thread.
env.backends.onnx.wasm.numThreads = 1;
// Default wasmPaths points at jsdelivr, which the extension's CSP (script-src 'self') blocks.
// These files are vendored locally (extension/src/vendor/ort/, copied from the installed
// onnxruntime-web package) so onnxruntime-web loads them from the extension itself instead.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('src/vendor/ort/');

const MODEL_ID = 'onnx-community/tmr-ai-text-detector-ONNX';
let classifierPromise = null;

function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline('text-classification', MODEL_ID, { dtype: 'int8' }).catch((err) => {
      classifierPromise = null; // let the next call retry instead of staying permanently broken
      throw err;
    });
  }
  return classifierPromise;
}

async function classifyText(text) {
  const classifier = await getClassifier();
  const results = await classifier(text, { top_k: 2 });
  const aiEntry = results.find((r) => r.label === 'ai');
  return aiEntry ? aiEntry.score : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.target === 'offscreen' && message.type === 'realview:classifyText') {
    classifyText(message.text)
      .then((score) => sendResponse({ score }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  return false;
});
