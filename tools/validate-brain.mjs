// Validates exported brain files with the browser's own check (NeuralNetwork.isValid) and the same
// size limit as "Import Brain…". With --world it also drives every route with the app's runEpisode.
// usage: node tools/validate-brain.mjs brain.json [more.json] [--world trainer/worlds/brisbane.json]
// Prints one JSON line per file and exits 1 if any file is invalid.
import fs from 'node:fs';
import path from 'node:path';
import { NeuralNetwork } from '../web/src/engine/ai/network.js';
import { bench } from './bench/bench-core.mjs';

const args = process.argv.slice(2);
const wi = args.indexOf('--world');
const worldPath = wi >= 0 ? args.splice(wi, 2)[1] : null;
const world = worldPath ? JSON.parse(fs.readFileSync(worldPath, 'utf8')) : null;
if (!args.length) {
  console.error('usage: node tools/validate-brain.mjs brain.json [...] [--world world.json]');
  process.exit(2);
}

let ok = true;
for (const file of args) {
  const bytes = fs.statSync(file).size;
  let result;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const network = parsed?.network ?? parsed;
    // BrainStore.importFile rejects files over 200 kB before validating
    const valid = bytes <= 200_000 && NeuralNetwork.isValid(network);
    result = { file: path.basename(file), valid, bytes, shape: valid ? NeuralNetwork.shape(network) : null };
    if (valid && world) result.scores = bench(world, [network]).scores[0];
  } catch (e) {
    result = { file: path.basename(file), valid: false, bytes, error: String(e.message ?? e) };
  }
  ok &&= result.valid;
  console.log(JSON.stringify(result));
}
process.exit(ok ? 0 : 1);
