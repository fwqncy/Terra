import { NeuralNetwork } from './network.js';

/**
 * Genetic trainer shared by cars, ships and planes.
 * Elitism keeps the all-time best brain; the rest of the population is the elite
 * mutated with a spread of rates (small tweaks through to bold leaps), plus some
 * crossover with the runner-up for diversity.
 */
export class Trainer {
  /**
   * @param {{populationSize?:number, mutation?:number, random?:()=>number, best?:any}} opts
   */
  constructor({ populationSize = 100, mutation = 0.15, random = Math.random, best = null } = {}) {
    this.populationSize = populationSize;
    this.mutation = mutation;
    this.random = random;
    this.best = best ? NeuralNetwork.clone(best) : null;
    this.bestFitness = 0;
    this.runnerUp = null;
    this.generation = 0;
    this.stagnant = 0;
    /** @type {{generation:number, best:number, mean:number, arrived:number, crashed:number, at:number}[]} */
    this.history = [];
  }

  /** Brains for the next generation (null entries mean "let the agent randomise"). */
  nextBrains() {
    const n = this.populationSize;
    if (!this.best) return new Array(n).fill(null);
    const brains = [NeuralNetwork.clone(this.best)];
    // Stuck on the same corner? Widen the search, and add some fresh random brains.
    const boost = Math.min(4, 1 + this.stagnant * 0.35);
    const fresh = Math.floor(n * (this.stagnant > 3 ? 0.15 : 0.05));
    for (let i = 1; i < n; i++) {
      if (i >= n - fresh) {
        brains.push(null);
        continue;
      }
      const spread = (0.25 + 1.5 * (i / n)) * boost;
      let child;
      if (this.runnerUp && NeuralNetwork.sameShape(this.best, this.runnerUp) && this.random() < 0.2) {
        child = NeuralNetwork.crossover(this.best, this.runnerUp, this.random);
      } else {
        child = NeuralNetwork.clone(this.best);
      }
      NeuralNetwork.mutate(child, Math.min(1, this.mutation * spread), this.random);
      brains.push(child);
    }
    return brains;
  }

  /**
   * Scores a finished generation and updates the elite.
   * @param {{brain:any, fitness:number, arrived?:boolean, damaged?:boolean}[]} agents
   */
  evaluate(agents) {
    const scored = agents.filter((a) => a.brain).sort((a, b) => b.fitness - a.fitness);
    const top = scored[0];
    const mean = scored.reduce((s, a) => s + a.fitness, 0) / Math.max(1, scored.length);
    if (top && top.fitness > this.bestFitness * 1.01) this.stagnant = 0;
    else this.stagnant++;
    if (top && top.fitness >= this.bestFitness) {
      if (this.best) this.runnerUp = this.best;
      this.best = NeuralNetwork.clone(top.brain);
      this.bestFitness = top.fitness;
    } else if (scored[1]) {
      this.runnerUp = NeuralNetwork.clone(scored[0].brain);
    }
    const entry = {
      generation: this.generation,
      best: top?.fitness ?? 0,
      mean,
      arrived: agents.filter((a) => a.arrived).length,
      crashed: agents.filter((a) => a.damaged).length,
      at: Date.now(),
    };
    this.history.push(entry);
    if (this.history.length > 500) this.history.shift();
    this.generation++;
    return entry;
  }

  reset(best = null) {
    this.best = best ? NeuralNetwork.clone(best) : null;
    this.bestFitness = 0;
    this.runnerUp = null;
    this.generation = 0;
    this.stagnant = 0;
    this.history = [];
  }
}
