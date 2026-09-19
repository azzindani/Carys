import type { Volume } from './types.js';

export function histogram(data: ArrayLike<number>, bins = 256): {
  hist: Uint32Array;
  min: number;
  max: number;
} {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const hist = new Uint32Array(bins);
  const span = max - min || 1;
  for (let i = 0; i < data.length; i++) {
    const b = Math.min(
      bins - 1,
      Math.floor(((data[i] - min) / span) * bins),
    );
    hist[b]++;
  }
  return { hist, min, max };
}

export function volumeStats(v: Volume): {
  min: number;
  max: number;
  mean: number;
} {
  const d = v.data;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  return { min, max, mean: sum / d.length };
}
