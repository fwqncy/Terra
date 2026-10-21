import { lerp } from '../math/utils.js';
import { withAlpha } from './comic.js';

/**
 * Draws a network: inputs at the bottom, outputs at the top. Positive weights use the
 * warm accent, negative the cool primary (a colour-blind-safe blue/amber diverging pair);
 * line opacity encodes magnitude, and dashes mark negative weights so colour isn't the only cue.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} network
 * @param {import('./comic.js').Palette} palette
 * @param {{width?:number, height?:number, outputLabels?:string[], margin?:number}} [opts]
 */
export function drawNetwork(ctx, network, palette, { width, height, outputLabels = ['↑', '←', '→', '↓'], margin = 28 } = {}) {
  const w = width ?? ctx.canvas.width;
  const h = height ?? ctx.canvas.height;
  const left = margin;
  const top = margin;
  const W = w - margin * 2;
  const Hh = h - margin * 2;
  const levelHeight = Hh / network.levels.length;
  for (let i = network.levels.length - 1; i >= 0; i--) {
    const levelTop = top + lerp(Hh - levelHeight, 0, network.levels.length === 1 ? 0.5 : i / (network.levels.length - 1));
    drawLevel(ctx, network.levels[i], left, levelTop, W, levelHeight, i === network.levels.length - 1 ? outputLabels : [], palette);
  }
}

function nodeX(nodes, index, left, right) {
  return lerp(left, right, nodes.length === 1 ? 0.5 : index / (nodes.length - 1));
}

function drawLevel(ctx, level, left, top, width, height, labels, palette) {
  const right = left + width;
  const bottom = top + height;
  const { inputs, outputs, weights, biases } = level;
  const radius = Math.max(7, Math.min(16, width / (Math.max(inputs.length, outputs.length) * 3.2)));
  const pos = palette.warn;
  const neg = palette.mode === 'dark' ? '#7aa2ff' : palette.primary;
  const ink = palette.mode === 'dark' ? palette.light : palette.ink;

  for (let i = 0; i < inputs.length; i++) {
    for (let j = 0; j < outputs.length; j++) {
      const v = weights[i][j];
      ctx.beginPath();
      ctx.moveTo(nodeX(inputs, i, left, right), bottom);
      ctx.lineTo(nodeX(outputs, j, left, right), top);
      ctx.lineWidth = 1 + Math.abs(v) * 1.5;
      ctx.strokeStyle = withAlpha(v > 0 ? pos : neg, 0.15 + Math.abs(v) * 0.75);
      ctx.setLineDash(v < 0 ? [4, 3] : []);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  const node = (x, y, value, label) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = palette.mode === 'dark' ? '#0c0a08' : '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(value > 0 ? pos : neg, Math.min(1, 0.15 + Math.abs(value) * 0.85));
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
    if (label) {
      ctx.fillStyle = ink;
      ctx.font = `900 ${radius * 1.2}px "Archivo", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 1);
    }
  };
  for (let i = 0; i < inputs.length; i++) node(nodeX(inputs, i, left, right), bottom, inputs[i]);
  for (let i = 0; i < outputs.length; i++) {
    const x = nodeX(outputs, i, left, right);
    node(x, top, outputs[i], labels[i]);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.arc(x, top, radius * 1.1, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(biases[i] > 0 ? pos : neg, 0.9);
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
