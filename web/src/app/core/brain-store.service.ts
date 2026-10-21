import { Injectable, inject, signal } from '@angular/core';
import { NeuralNetwork } from '../../engine/ai/network.js';
import { FACTORY_BRAINS } from '../../engine/data/brains.js';
import { ApiService } from './api.service';

export type BrainDomain = 'city' | 'motorway' | 'sea' | 'air';

export interface SavedBrain {
  id: string;
  name: string;
  domain: BrainDomain;
  map?: string;
  generation: number;
  fitness: number;
  savedAt: number;
  network: unknown;
  remote?: boolean;
}

const KEY = 'terra.brains.v1';

/** Trained brains: kept locally and, when online, in the API's NoSQL document store. */
@Injectable({ providedIn: 'root' })
export class BrainStore {
  private readonly api = inject(ApiService);
  readonly brains = signal<SavedBrain[]>(this.load());

  factory(domain: BrainDomain): unknown {
    return NeuralNetwork.clone((FACTORY_BRAINS as Record<string, unknown>)[domain]);
  }

  forDomain(domain: BrainDomain): SavedBrain[] {
    return this.brains().filter((b) => b.domain === domain);
  }

  async save(b: Omit<SavedBrain, 'id' | 'savedAt'>): Promise<SavedBrain> {
    const brain: SavedBrain = { ...b, id: `b-${Date.now().toString(36)}`, savedAt: Date.now() };
    this.brains.update((list) => [brain, ...list].slice(0, 30));
    this.persist();
    if (this.api.online()) {
      try {
        const r = await this.api.post<{ id: string }>('/brains', { ...brain, player: this.api.playerId });
        const synced: SavedBrain = { ...brain, remote: true, id: r?.id ?? brain.id };
        this.brains.update((list) => list.map((x) => (x.id === brain.id ? synced : x)));
        this.persist();
        return synced;
      } catch {
        /* local copy is enough */
      }
    }
    return brain;
  }

  remove(id: string): void {
    this.brains.update((list) => list.filter((b) => b.id !== id));
    this.persist();
  }

  restore(brain: SavedBrain): void {
    this.brains.update((list) => [brain, ...list.filter((b) => b.id !== brain.id)]);
    this.persist();
  }

  download(b: SavedBrain): void {
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${b.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.brain.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Validates an uploaded file before it ever reaches a car. */
  async importFile(file: File, domain: BrainDomain): Promise<SavedBrain> {
    if (file.size > 200_000) throw new Error('That file is too large to be a Terra brain.');
    const parsed = JSON.parse(await file.text());
    const network = parsed?.network ?? parsed;
    if (!NeuralNetwork.isValid(network)) throw new Error('That file is not a valid brain: it needs "levels" with weights and biases.');
    return this.save({
      name: typeof parsed?.name === 'string' ? parsed.name.slice(0, 40) : file.name.replace(/\.json$/i, ''),
      domain,
      generation: Number.isFinite(parsed?.generation) ? parsed.generation : 0,
      fitness: Number.isFinite(parsed?.fitness) ? parsed.fitness : 0,
      network,
    });
  }

  private load(): SavedBrain[] {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((b) => b && NeuralNetwork.isValid(b.network)) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.brains()));
    } catch {
      /* ignore */
    }
  }
}
