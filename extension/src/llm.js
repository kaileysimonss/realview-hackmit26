/* global chrome, createImageBitmap, OffscreenCanvas */
// Model-backed detection. Runs in the service worker so the API key never
// reaches page context and the provider call is not subject to page CORS.
(() => {
  const Settings = self.RealViewSettings;

  const MAX_EDGE = 512; // frames are downscaled before upload: cost and latency
  const CACHE_LIMIT = 200;
  const MAX_CONCURRENT = 3;
  const TEXT_LIMIT = 4000;

  const INSTRUCTIONS = {
    text:
      'You judge whether a passage of web text was written by an AI language model. ' +
      'Weigh rhythm, specificity, hedging, formulaic transitions, and lived detail. ' +
      'Polished human writing is not automatically synthetic, and an excerpt may be mixed.',
    image:
      'You judge whether an image was generated or heavily altered by an AI image model. ' +
      'Weigh anatomy and object coherence, text and logo rendering, lighting and reflection ' +
      'consistency, surface micro-detail, and background logic. Stock photography, heavy ' +
      'editing, and rendering are not automatically synthetic.',
    video:
      'You judge whether these frames, sampled in order from one video clip, came from an ' +
      'AI video generator. Weigh per-frame realism and how coherently objects, faces, and ' +
      'text persist across the frames.'
  };

  const FORMAT =
    'Reply with JSON only: {"score": <integer 0-100 likelihood it is AI-generated>, ' +
    '"reason": "<one clause, at most 15 words, naming the specific evidence>"}. ' +
    'Use the middle of the range when the evidence is genuinely ambiguous.';

  const cache = new Map();
  let active = 0;
  const queue = [];

  function cacheKey(request) {
    const body = request.text || (request.sources || []).join('|');
    return `${request.kind}:${request.model}:${body.length}:${hash(body)}`;
  }

  function hash(value) {
    let h = 0;
    for (let i = 0; i < value.length; i += 1) {
      h = (h * 31 + value.charCodeAt(i)) | 0;
    }
    return h;
  }

  function remember(key, value) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, value);
  }

  // Providers are billed per call and rate limited, so a page full of media
  // queues instead of opening one connection per element.
  function withSlot(task) {
    if (active >= MAX_CONCURRENT) {
      return new Promise((resolve) => queue.push(() => resolve(withSlot(task))));
    }
    active += 1;
    return task().finally(() => {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function shrink(blob) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return bytesToBase64(new Uint8Array(await jpeg.arrayBuffer()));
  }

  // The content script sends data URLs for same-origin media it could rasterize
  // itself, and a plain URL when the page canvas was tainted.
  async function toBase64(source) {
    if (source.startsWith('data:')) {
      const [, payload] = source.split(',');
      return source.startsWith('data:image/jpeg') ? payload : shrink(await (await fetch(source)).blob());
    }
    const response = await fetch(source, { credentials: 'omit' });
    if (!response.ok) throw new Error(`media fetch failed: ${response.status}`);
    return shrink(await response.blob());
  }

  function openaiRequest({ key, model, kind, text, images }) {
    const content = [{ type: 'text', text: `${INSTRUCTIONS[kind]}\n\n${FORMAT}` }];
    if (text) content.push({ type: 'text', text: `Passage:\n${text}` });
    images.forEach((data) =>
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } })
    );
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }]
        })
      },
      read: (json) => json.choices?.[0]?.message?.content || ''
    };
  }

  function anthropicRequest({ key, model, kind, text, images }) {
    const content = images.map((data) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data }
    }));
    content.push({ type: 'text', text: text ? `Passage:\n${text}\n\n${FORMAT}` : FORMAT });
    return {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          // Required for requests issued from an extension or browser context.
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          system: INSTRUCTIONS[kind],
          messages: [{ role: 'user', content }]
        })
      },
      read: (json) => json.content?.find((part) => part.type === 'text')?.text || ''
    };
  }

  const PROVIDERS = { openai: openaiRequest, anthropic: anthropicRequest };

  function parseVerdict(raw) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('model returned no JSON');
    const parsed = JSON.parse(match[0]);
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) throw new Error('model returned no score');
    return {
      score: Math.min(1, Math.max(0, score > 1 ? score / 100 : score)),
      reason: String(parsed.reason || '').slice(0, 160)
    };
  }

  async function call(request) {
    const settings = await Settings.load();
    const provider = PROVIDERS[settings.llmProvider] ? settings.llmProvider : 'openai';
    const key = await Settings.loadKey(provider);
    if (!settings.llmEnabled || !key) return { error: 'disabled' };

    const model = Settings.modelFor({ ...settings, llmProvider: provider });
    const cached = cache.get(cacheKey({ ...request, model }));
    if (cached) return cached;

    const images = [];
    for (const source of request.sources || []) {
      try {
        images.push(await toBase64(source));
      } catch (err) {
        // A frame that cannot be read is dropped; the rest still carry evidence.
      }
    }
    if (request.kind !== 'text' && !images.length) return { error: 'no media' };

    const text = request.text ? request.text.slice(0, TEXT_LIMIT) : '';
    const { url, init, read } = PROVIDERS[provider]({ key, model, kind: request.kind, text, images });

    const result = await withSlot(async () => {
      try {
        const response = await fetch(url, init);
        const json = await response.json();
        if (!response.ok) {
          return { error: json.error?.message || `provider error ${response.status}` };
        }
        return { verdict: parseVerdict(read(json)), model };
      } catch (err) {
        return { error: err.message };
      }
    });

    if (result.verdict) remember(cacheKey({ ...request, model }), result);
    return result;
  }

  self.RealViewLLM = { call };
})();
