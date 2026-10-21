import { lerp } from '../math/utils.js';

/**
 * A tiny feed-forward network with step activations, the same shape as the
 * classic "self-driving car in plain JS" brain. Plain objects all the way down,
 * so a brain is just JSON: easy to save locally, in the NoSQL store, or share.
 */
export class Level {
  constructor(inputCount, outputCount, random = Math.random) {
    this.inputs = new Array(inputCount).fill(0);
    this.outputs = new Array(outputCount).fill(0);
    this.biases = new Array(outputCount);
    this.weights = [];
    for (let i = 0; i < inputCount; i++) this.weights[i] = new Array(outputCount);
    Level.randomize(this, random);
  }

  static randomize(level, random = Math.random) {
    for (let i = 0; i < level.inputs.length; i++) {
      for (let j = 0; j < level.outputs.length; j++) level.weights[i][j] = random() * 2 - 1;
    }
    for (let i = 0; i < level.biases.length; i++) level.biases[i] = random() * 2 - 1;
  }

  static feedForward(givenInputs, level) {
    for (let i = 0; i < level.inputs.length; i++) level.inputs[i] = givenInputs[i] ?? 0;
    for (let i = 0; i < level.outputs.length; i++) {
      let sum = 0;
      for (let j = 0; j < level.inputs.length; j++) sum += level.inputs[j] * level.weights[j][i];
      level.outputs[i] = sum > level.biases[i] ? 1 : 0;
    }
    return level.outputs;
  }
}

export class NeuralNetwork {
  /** @param {number[]} neuronCounts e.g. [7, 8, 4] */
  constructor(neuronCounts, random = Math.random) {
    this.levels = [];
    for (let i = 0; i < neuronCounts.length - 1; i++) {
      this.levels.push(new Level(neuronCounts[i], neuronCounts[i + 1], random));
    }
  }

  static shape(network) {
    return [network.levels[0].inputs.length, ...network.levels.map((l) => l.outputs.length)];
  }

  static feedForward(givenInputs, network) {
    let outputs = Level.feedForward(givenInputs, network.levels[0]);
    for (let i = 1; i < network.levels.length; i++) outputs = Level.feedForward(outputs, network.levels[i]);
    return outputs;
  }

  /** Nudges every weight and bias towards a random value by `amount` (0..1). */
  static mutate(network, amount = 1, random = Math.random) {
    for (const level of network.levels) {
      for (let i = 0; i < level.biases.length; i++) level.biases[i] = lerp(level.biases[i], random() * 2 - 1, amount);
      for (let i = 0; i < level.weights.length; i++) {
        for (let j = 0; j < level.weights[i].length; j++) {
          level.weights[i][j] = lerp(level.weights[i][j], random() * 2 - 1, amount);
        }
      }
    }
    return network;
  }

  /** Uniform crossover; both parents must share a shape. */
  static crossover(a, b, random = Math.random) {
    const child = NeuralNetwork.clone(a);
    child.levels.forEach((level, l) => {
      const other = b.levels[l];
      for (let i = 0; i < level.biases.length; i++) if (random() < 0.5) level.biases[i] = other.biases[i];
      for (let i = 0; i < level.weights.length; i++) {
        for (let j = 0; j < level.weights[i].length; j++) if (random() < 0.5) level.weights[i][j] = other.weights[i][j];
      }
    });
    return child;
  }

  static clone(network) {
    return JSON.parse(JSON.stringify(network));
  }

  static sameShape(a, b) {
    if (!a || !b || a.levels?.length !== b.levels?.length) return false;
    return a.levels.every((l, i) => l.inputs.length === b.levels[i].inputs.length && l.outputs.length === b.levels[i].outputs.length);
  }

  /** Validates untrusted JSON (imports, API payloads) before it is used as a brain. */
  static isValid(obj) {
    if (!obj || !Array.isArray(obj.levels) || obj.levels.length === 0 || obj.levels.length > 8) return false;
    return obj.levels.every(
      (l) =>
        Array.isArray(l.inputs) && Array.isArray(l.outputs) && Array.isArray(l.biases) && Array.isArray(l.weights) &&
        l.inputs.length <= 64 && l.outputs.length <= 64 &&
        l.biases.length === l.outputs.length && l.weights.length === l.inputs.length &&
        l.weights.every((row) => Array.isArray(row) && row.length === l.outputs.length && row.every(Number.isFinite)) &&
        l.biases.every(Number.isFinite),
    );
  }
}
