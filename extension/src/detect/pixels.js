// Shared by the content script and the service worker, so it must not touch the DOM.
(() => {
  const SAMPLE = 96;
  const TILE_GRID = 4; // 4x4 tiles of 24x24px each (96 / 4)
  const TILE_SIZE = SAMPLE / TILE_GRID;

  function statsFromImageData(data, width, height) {
    const luma = new Float32Array(SAMPLE * SAMPLE);
    let saturationSum = 0;
    for (let i = 0; i < SAMPLE * SAMPLE; i += 1) {
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturationSum += max === 0 ? 0 : (max - min) / max;
    }

    // Sensor noise: mean absolute residual against a 3x3 box blur. Also bucketed per tile
    // (see noiseUniformity below) — real photos vary this noise level by region (shadows,
    // texture, ISO grain); a lot of synthetic grain is close to uniform across the whole
    // frame, which survives re-compression/added-grain far better than the raw noise level
    // does as a tell on its own.
    let residualSum = 0;
    let edgeSum = 0;
    let samples = 0;
    const tileResidualSum = new Float32Array(TILE_GRID * TILE_GRID);
    const tileSamples = new Int32Array(TILE_GRID * TILE_GRID);
    for (let y = 1; y < SAMPLE - 1; y += 1) {
      const tileY = Math.min(TILE_GRID - 1, Math.floor(y / TILE_SIZE));
      for (let x = 1; x < SAMPLE - 1; x += 1) {
        const idx = y * SAMPLE + x;
        let neighborhood = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            neighborhood += luma[(y + dy) * SAMPLE + (x + dx)];
          }
        }
        const residual = Math.abs(luma[idx] - neighborhood / 9);
        residualSum += residual;
        const gx = luma[idx + 1] - luma[idx - 1];
        const gy = luma[idx + SAMPLE] - luma[idx - SAMPLE];
        edgeSum += Math.hypot(gx, gy);
        samples += 1;

        const tileX = Math.min(TILE_GRID - 1, Math.floor(x / TILE_SIZE));
        const tileIdx = tileY * TILE_GRID + tileX;
        tileResidualSum[tileIdx] += residual;
        tileSamples[tileIdx] += 1;
      }
    }

    const tileMeans = [];
    for (let t = 0; t < tileResidualSum.length; t += 1) {
      if (tileSamples[t] > 0) tileMeans.push(tileResidualSum[t] / tileSamples[t]);
    }
    const tileMean = tileMeans.reduce((a, b) => a + b, 0) / tileMeans.length;
    const tileVariance =
      tileMeans.reduce((sum, v) => sum + (v - tileMean) ** 2, 0) / Math.max(1, tileMeans.length - 1);
    // Coefficient of variation: stdev relative to the mean, so it's comparable across images
    // of different overall noise levels (not just absolute spread).
    const noiseUniformity = tileMean > 0 ? Math.sqrt(tileVariance) / tileMean : 0;

    const histogram = new Array(32).fill(0);
    for (let i = 0; i < luma.length; i += 1) {
      histogram[Math.min(31, Math.floor(luma[i] * 32))] += 1;
    }
    const occupied = histogram.filter((n) => n > luma.length * 0.002).length / 32;

    return {
      noise: residualSum / samples,
      edges: edgeSum / samples,
      saturation: saturationSum / (SAMPLE * SAMPLE),
      tonalSpread: occupied,
      noiseUniformity,
      width,
      height
    };
  }

  self.RealViewPixels = { SAMPLE, statsFromImageData };
})();
