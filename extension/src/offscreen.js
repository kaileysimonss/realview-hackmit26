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

const MODEL_ID_TEXT = 'onnx-community/tmr-ai-text-detector-ONNX';
// Swin classifier fine-tuned specifically for AI-vs-real image detection (98% F1 on its own
// test split, 75-98% out-of-domain accuracy against DALL-E/Flux/Imagen/Stable Diffusion —
// see the model card). Its score is fed into image.js's combine() as one more signal
// alongside the pixel heuristics, not used as a standalone verdict.
const MODEL_ID_IMAGE = 'onnx-community/SMOGY-Ai-images-detector-ONNX';

let textClassifierPromise = null;
let imageClassifierPromise = null;

function getTextClassifier() {
  if (!textClassifierPromise) {
    textClassifierPromise = pipeline('text-classification', MODEL_ID_TEXT, { dtype: 'int8' }).catch((err) => {
      textClassifierPromise = null; // let the next call retry instead of staying permanently broken
      throw err;
    });
  }
  return textClassifierPromise;
}

function getImageClassifier() {
  if (!imageClassifierPromise) {
    imageClassifierPromise = pipeline('image-classification', MODEL_ID_IMAGE, { dtype: 'int8' }).catch((err) => {
      imageClassifierPromise = null;
      throw err;
    });
  }
  return imageClassifierPromise;
}

async function classifyText(text) {
  const classifier = await getTextClassifier();
  const results = await classifier(text, { top_k: 2 });
  const aiEntry = results.find((r) => r.label === 'ai');
  return aiEntry ? aiEntry.score : null;
}

async function classifyImage(dataUrl) {
  const classifier = await getImageClassifier();
  const results = await classifier(dataUrl, { top_k: 2 });
  const artificialEntry = results.find((r) => r.label === 'artificial');
  return artificialEntry ? artificialEntry.score : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.target === 'offscreen' && message.type === 'realview:classifyText') {
    classifyText(message.text)
      .then((score) => sendResponse({ score }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  if (message && message.target === 'offscreen' && message.type === 'realview:classifyImage') {
    classifyImage(message.dataUrl)
      .then((score) => sendResponse({ score }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }
  return false;
});
