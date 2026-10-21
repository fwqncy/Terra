import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NeuralNetwork } from '../../../engine/ai/network.js';
import { GraphEditor } from '../../../engine/editors/graph-editor.js';
import { MarkingEditor } from '../../../engine/editors/marking-editor.js';
import { Graph } from '../../../engine/graph.js';
import { HOME_STYLES } from '../../../engine/items/building.js';
import { CITY_MAPS, osmToCompact } from '../../../engine/maps.js';
import { createRng, hashString } from '../../../engine/math/rng.js';
import { halftonePattern, mix } from '../../../engine/render/comic.js';
import { CitySim } from '../../../engine/sim/city-sim.js';
import { MotorwaySim } from '../../../engine/sim/motorway-sim.js';
import { Viewport } from '../../../engine/viewport.js';
import { World } from '../../../engine/world.js';
import { ApiService } from '../../core/api.service';
import { IslandHandle, loadIsland, webglAvailable } from '../../core/cdn';
import { BrainStore, SavedBrain } from '../../core/brain-store.service';
import { fmt, formatCoins } from '../../core/format';
import { GameService, SimEvent } from '../../core/game.service';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { generateWorld } from '../../core/world-gen';
import { LineChart, LineSeries } from '../../shared/charts/line-chart';
import { ConfirmService } from '../../shared/confirm.service';
import { Icon } from '../../shared/icon';
import { NnCanvas } from '../../shared/nn-canvas';

type Mode = 'build' | 'train' | 'fleet' | 'motorway';
type Tool = 'pan' | 'graph' | 'start' | 'target' | 'stop' | 'yield' | 'light' | 'crossing' | 'parking';

const TOOLS: { id: Tool; label: string; icon: string; key: string; hint: string }[] = [
  { id: 'pan', label: 'Pan', icon: 'hand', key: 'H', hint: 'Drag to move around. Scroll or pinch to zoom.' },
  { id: 'graph', label: 'Roads', icon: 'road', key: 'R', hint: 'Click to drop an intersection; click again to connect a road. Drag points to move them. Right-click or Delete removes. Esc stops connecting.' },
  { id: 'start', label: 'Start', icon: 'flag', key: 'S', hint: 'Click a lane to set where the cars spawn. They drive in the direction of the lane (on the left, Aussie style).' },
  { id: 'target', label: 'Target', icon: 'target', key: 'T', hint: 'Click a lane to set the delivery address. Cars learn the shortest route there.' },
  { id: 'stop', label: 'Stop', icon: 'stopSign', key: 'X', hint: 'Paint a stop line on a lane.' },
  { id: 'yield', label: 'Give Way', icon: 'yield', key: 'Y', hint: 'Paint a give-way line on a lane.' },
  { id: 'light', label: 'Lights', icon: 'light', key: 'L', hint: 'Add traffic lights. Lights at the same intersection take turns; red lights block cars.' },
  { id: 'crossing', label: 'Crossing', icon: 'crossing', key: 'C', hint: 'Add a zebra crossing across a road.' },
  { id: 'parking', label: 'Parking', icon: 'parking', key: 'P', hint: 'Mark a parking bay on a lane.' },
];

interface Stats {
  generation: number;
  population: number;
  alive: number;
  crashed: number;
  arrived: number;
  progress: number;
  bestFitness: number;
  deliveries: number;
  passed: number;
  distance: number;
}

@Component({
  selector: 'app-city',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, LineChart, NnCanvas],
  templateUrl: './city.html',
  styleUrls: ['../../shared/workspace.css', './city.css'],
  host: { '(document:keydown)': 'onKey($event)' },
})
export class CityPage {
  /** Bound from the URL (?map=…&mode=…) so every view is deep-linkable. */
  readonly map = input<string>();
  readonly mode = input<string>();
  readonly view = input<string>();

  protected readonly game = inject(GameService);
  protected readonly theme = inject(ThemeService);
  protected readonly brains = inject(BrainStore);
  protected readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly mount3dRef = viewChild.required<ElementRef<HTMLDivElement>>('mount3d');

  protected readonly tools = TOOLS;
  protected readonly maps = CITY_MAPS;
  protected readonly homeStyles = Object.entries(HOME_STYLES).map(([id, s]) => ({ id, label: s.label }));
  protected readonly fmt = fmt;
  protected readonly formatCoins = formatCoins;
  protected readonly Math = Math;

  protected readonly mapId = signal('brisbane');
  protected readonly current = signal<Mode>('build');
  protected readonly tool = signal<Tool>('graph');
  protected readonly generating = signal(true);
  protected readonly genMs = signal(0);
  protected readonly counts = signal({ points: 0, segments: 0, buildings: 0, trees: 0, markings: 0 });
  protected readonly running = signal(false);
  protected readonly speed = signal(1);
  protected readonly population = signal(80);
  protected readonly mutation = signal(0.15);
  protected readonly showSensors = signal(true);
  protected readonly follow = signal(true);
  protected readonly obeyLights = signal(true);
  protected readonly seed = signal('factory');
  protected readonly fleetSize = signal(12);
  protected readonly brainName = signal('');
  protected readonly stats = signal<Stats>({ generation: 0, population: 0, alive: 0, crashed: 0, arrived: 0, progress: 0, bestFitness: 0, deliveries: 0, passed: 0, distance: 0 });
  protected readonly history = signal<{ generation: number; best: number; mean: number; arrived: number }[]>([]);
  protected readonly sessionCoins = signal(0);
  protected readonly status = signal('');
  protected readonly bootcamp = signal<{ running: boolean; generation: number; total: number; best: number; arrivals: number; routes: number } | null>(null);
  protected readonly bootGens = signal(30);
  protected readonly bootRoutes = signal(6);
  protected readonly routeInfo = signal<string>('');
  /** A start requested while the map was still generating. */
  private pendingStart: 'train' | 'fleet' | null = null;

  /** Orbitable three.js view of the same world (?view=3d). The M1 trainer stays 2D. */
  protected readonly view3d = signal(false);
  protected readonly show3d = computed(() => this.view3d() && this.current() !== 'motorway');
  protected readonly ready3d = signal(false);
  protected readonly coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** Bumped when the generated world or its Start/Target change; the 3D view rebuilds from it. */
  private readonly geoVersion = signal(0);
  private worldGen = 0;
  private island: IslandHandle | null = null;
  private islandIo: IntersectionObserver | null = null;
  private islandLoading = false;
  private destroyed = false;
  private routePts: number[][] | null = null;
  private baseGeo: { gen: number; geo: ReturnType<World['exportGeometry']> & { segments: number[] } } | null = null;
  private geoCache: { version: number; geo: unknown } | null = null;
  private readonly frame3d = { cars: [] as { x: number; y: number; a: number; s: number }[], leader: null as { x: number; y: number } | null, tag: 'LEADER', rays: [] as number[] };
  /** The fleet car the 3D camera trails until it delivers. */
  private courier: CitySim['cars'][number] | null = null;

  protected readonly activeTool = computed(() => TOOLS.find((t) => t.id === this.tool()) ?? TOOLS[1]);
  protected readonly mapMeta = computed(() => CITY_MAPS.find((m) => m.id === this.mapId()) ?? CITY_MAPS[0]);
  protected readonly domainBrains = computed(() => this.brains.forDomain(this.current() === 'motorway' ? 'motorway' : 'city'));
  protected readonly chartLabels = computed(() => this.history().map((h) => `Gen ${h.generation + 1}`));
  protected readonly chartSeries = computed<LineSeries[]>(() => {
    const h = this.history();
    const isMotorway = this.current() === 'motorway';
    return [
      { id: 'best', label: isMotorway ? 'Best (cars passed)' : 'Best progress', color: 'var(--series-road)', values: h.map((x) => x.best) },
      { id: 'mean', label: isMotorway ? 'Mean (cars passed)' : 'Mean progress', color: 'var(--series-air)', values: h.map((x) => x.mean) },
    ];
  });
  protected readonly chartFormat = computed(() => (this.current() === 'motorway' ? (n: number) => fmt.whole(n) : (n: number) => fmt.pct(n)));

  // engine objects (not signals: they mutate 60×/s)
  private world: World | null = null;
  private viewport: Viewport | null = null;
  private graphEditor: GraphEditor | null = null;
  private markingEditors = new Map<string, MarkingEditor>();
  private sim: CitySim | null = null;
  private motorway: MotorwaySim | null = null;
  private lastSegments = 0;
  private dirty = false;
  private regenTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private bootWorker: Worker | null = null;
  private time = 0;

  /** Network of the current leader, polled by the NN view. */
  protected readonly leaderBrain = () => {
    if (this.current() === 'motorway') return this.motorway?.leader()?.brain ?? null;
    return this.sim?.leader()?.brain ?? this.sim?.trainer.best ?? null;
  };

  constructor() {
    const destroyRef = inject(DestroyRef);

    // URL → state (initial load and Back/Forward)
    effect(() => {
      const m = this.mode();
      const id = this.map();
      const v = this.view();
      untracked(() => {
        const mode: Mode = m === 'train' || m === 'fleet' || m === 'motorway' ? m : 'build';
        if (mode !== this.current()) this.switchMode(mode, false);
        if (id && id !== this.mapId() && this.viewport) void this.loadMap(id, false);
        this.view3d.set(v === '3d');
      });
    });

    // 3D view: mount lazily, feed it props, unmount (freeing the GPU) when it's switched off
    effect(() => {
      const props = this.show3d() ? this.props3d() : null;
      untracked(() => void this.sync3d(this.show3d(), props));
    });

    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      this.viewport = new Viewport(canvas, { zoom: 6, minZoom: 0.25, maxZoom: 40 });
      if (matchMedia('(pointer: coarse)').matches) this.tool.set('pan');
      const initial = this.map() ?? this.game.equipped().map ?? 'brisbane';
      void this.loadMap(this.game.owns('maps', initial) ? initial : 'brisbane', false);

      let raf = 0;
      let lastStats = 0;
      const frame = (t: number) => {
        this.tick();
        this.draw();
        if (t - lastStats > 250) {
          lastStats = t;
          this.refreshStats();
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      destroyRef.onDestroy(() => cancelAnimationFrame(raf));
    });

    effect(() => this.applyTool());
    effect(() => {
      const p = this.population();
      const m = this.mutation();
      if (this.sim) {
        this.sim.trainer.populationSize = p;
        this.sim.trainer.mutation = m;
      }
      if (this.motorway) this.motorway.trainer.mutation = m;
    });
    effect(() => {
      if (this.sim) this.sim.obeyLights = this.obeyLights();
    });

    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.unmount3d();
      this.sim?.stop();
      this.motorway?.stop();
      this.graphEditor?.dispose();
      for (const e of this.markingEditors.values()) e.dispose();
      this.viewport?.dispose();
      this.bootWorker?.terminate();
      this.flushSave();
    });
  }

  // ---------- map lifecycle ----------

  protected async loadMap(id: string, updateUrl = true): Promise<void> {
    const meta = CITY_MAPS.find((m) => m.id === id);
    if (!meta) return;
    if (!this.game.owns('maps', id)) {
      this.toasts.push({ title: `${meta.title} is locked`, body: 'Unlock new cities in the Depot.', tone: 'info', action: { label: 'Open Depot', run: () => void this.router.navigate(['/depot'], { queryParams: { tab: 'maps' } }) } });
      return;
    }
    this.stopAll();
    this.flushSave();
    this.mapId.set(id);
    this.game.equip('map', id);
    this.generating.set(true);
    this.history.set([]);
    if (updateUrl) this.syncUrl();

    let world: World;
    const saved = this.readSaved(id);
    if (saved) {
      world = World.fromJSON(saved);
    } else {
      const data = (await meta.load()).default as { points: number[]; segments: number[] };
      world = new World(Graph.fromCompact(data));
    }
    this.attachWorld(world);
    this.genMs.set(await generateWorld(world));
    if (!world.markings.some((m: { type: string }) => m.type === 'start') && world.graph.points.length > 4) {
      const route = world.suggestRoute(createRng(hashString(id)));
      if (route) world.setRoute(route);
    }
    this.sim = this.makeSim();
    this.generating.set(false);
    this.updateCounts();
    this.fitView(true);
    this.describeRoute();
    this.worldChanged(true);
    this.status.set(`${meta.title} loaded: ${world.graph.points.length} intersections, ${world.buildings.length} buildings.`);
    const pending = this.pendingStart;
    this.pendingStart = null;
    if (pending === 'train' && this.current() === 'train') this.toggleTraining();
    if (pending === 'fleet' && this.current() === 'fleet') this.toggleFleet();
  }

  private attachWorld(world: World): void {
    const vp = this.viewport!;
    this.graphEditor?.dispose();
    for (const e of this.markingEditors.values()) e.dispose();
    this.markingEditors.clear();
    this.world = world;
    this.lastSegments = world.graph.segments.length;
    this.graphEditor = new GraphEditor(vp, world.graph, { onChange: () => this.onGraphChanged() });
    for (const t of TOOLS) {
      if (t.id === 'pan' || t.id === 'graph') continue;
      this.markingEditors.set(t.id, new MarkingEditor(vp, world, t.id, { onChange: () => this.onMarkingsChanged() }));
    }
    this.applyTool();
  }

  private makeSim(): CitySim {
    return new CitySim(this.world!, {
      populationSize: this.population(),
      mutation: this.mutation(),
      skin: this.game.equipped().skin,
      brain: this.seedNetwork('city'),
      onEvent: (e: SimEvent) => this.onSimEvent(e),
    });
  }

  private seedNetwork(domain: 'city' | 'motorway'): unknown {
    const s = this.seed();
    if (s === 'random') return null;
    if (s === 'factory') return this.brains.factory(domain);
    const saved = this.brains.brains().find((b) => b.id === s);
    return saved ? NeuralNetwork.clone(saved.network) : null;
  }

  private onGraphChanged(): void {
    const w = this.world!;
    const added = w.graph.segments.length - this.lastSegments;
    if (added > 0) this.game.record({ type: 'segment', count: added });
    this.lastSegments = w.graph.segments.length;
    this.updateCounts();
    this.scheduleSave();
    if (this.regenTimer) clearTimeout(this.regenTimer);
    this.regenTimer = setTimeout(async () => {
      this.generating.set(true);
      const ms = await generateWorld(w);
      if (ms >= 0) this.genMs.set(ms);
      this.generating.set(false);
      this.updateCounts();
      this.describeRoute();
      this.worldChanged(true);
    }, 350);
  }

  private onMarkingsChanged(): void {
    this.updateCounts();
    this.scheduleSave();
    // A new Start/Target means a new route: keep the brain, restart the scoreboard.
    if (this.sim) this.sim.trainer.reset(this.sim.trainer.best);
    this.history.set([]);
    this.describeRoute();
    this.worldChanged(false);
  }

  /** Tells the 3D view to rebuild: everything when the world was regenerated, else just Start/Target and the route. */
  private worldChanged(regenerated: boolean): void {
    if (regenerated) this.worldGen++;
    this.geoVersion.update((v) => v + 1);
  }

  private describeRoute(): void {
    const w = this.world;
    if (!w) return;
    const s = w.markings.find((m: { type: string }) => m.type === 'start');
    const t = w.markings.find((m: { type: string }) => m.type === 'target');
    this.routePts = null;
    if (!s || !t) {
      this.routeInfo.set(!s ? 'No Start yet: use the Start tool on a lane.' : 'No Target yet: use the Target tool on a lane.');
      return;
    }
    const c = w.generateCorridor(s.center, t.center, s.directionVector);
    this.routePts = c ? c.route.points.map((p: { x: number; y: number }) => [p.x, p.y]) : null;
    this.routeInfo.set(c ? `Route: ${fmt.whole(c.route.length / 6)} m through ${c.skeleton.length} road segments.` : 'Start and Target are not connected. Add a road between them.');
  }

  private updateCounts(): void {
    const w = this.world;
    if (!w) return;
    this.counts.set({ points: w.graph.points.length, segments: w.graph.segments.length, buildings: w.buildings.length, trees: w.trees.length, markings: w.markings.length });
  }

  // ---------- modes & tools ----------

  protected switchMode(mode: Mode, updateUrl = true): void {
    if (mode === this.current() && updateUrl) return;
    this.stopAll();
    this.current.set(mode);
    this.history.set([]);
    if (mode === 'motorway') {
      this.viewport?.lookAt(0, 0);
      if (this.viewport) this.viewport.zoom = 1.4;
    } else if (this.world && this.viewport) {
      this.fitView(true);
    }
    this.applyTool();
    if (updateUrl) this.syncUrl();
  }

  protected setTool(t: Tool): void {
    // editing happens on the 2D map: picking an editing tool leaves the 3D view
    const leave3d = this.show3d() && t !== 'pan';
    if (leave3d) {
      this.view3d.set(false);
      this.status.set('Back on the 2D map for editing.');
    }
    if (this.current() !== 'build') this.switchMode('build');
    else if (leave3d) this.syncUrl();
    this.tool.set(t);
  }

  protected setView(threeD: boolean): void {
    if (threeD === this.view3d()) return;
    this.view3d.set(threeD);
    this.syncUrl();
  }

  private applyTool(): void {
    const t = this.tool();
    const building = this.current() === 'build';
    if (!this.viewport) return;
    this.viewport.panMode = !building || t === 'pan';
    if (building && t === 'graph') this.graphEditor?.enable();
    else this.graphEditor?.disable();
    for (const [type, ed] of this.markingEditors) {
      if (building && type === t) ed.enable();
      else ed.disable();
    }
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      queryParams: { map: this.mapId(), mode: this.current() === 'build' ? null : this.current(), view: this.view3d() ? '3d' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select, [contenteditable], dialog')) return;
    const tool = TOOLS.find((t) => t.key === e.key.toUpperCase());
    if (tool && this.current() === 'build') {
      e.preventDefault();
      this.setTool(tool.id);
    } else if (e.key === '0') {
      this.fitView(true);
    } else if ((e.key === 'v' || e.key === 'V') && this.current() !== 'motorway') {
      e.preventDefault();
      this.setView(!this.view3d());
    }
  }

  // ---------- training / fleet / motorway ----------

  protected toggleTraining(): void {
    if (this.running()) {
      this.stopAll();
      return;
    }
    if (!this.world || !this.sim || this.generating()) {
      this.pendingStart = 'train';
      this.status.set('Training starts as soon as the map is ready.');
      return;
    }
    this.sim.skin = this.game.equipped().skin;
    if (!this.sim.trainer.best) this.sim.trainer.reset(this.seedNetwork('city') as never);
    const err = this.sim.startTraining();
    if (err) {
      this.toasts.push({ title: 'Can’t start training yet', body: err, tone: 'warning' });
      return;
    }
    this.running.set(true);
    const r = this.sim.corridor?.route;
    if (r && this.viewport) {
      const xs = r.points.map((p: { x: number }) => p.x);
      const ys = r.points.map((p: { y: number }) => p.y);
      this.viewport.fit({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }, 80);
      // close enough to see the cars and their sensors
      this.viewport.zoom = Math.min(this.viewport.zoom, 1.7);
    }
    this.status.set('Training started. Generation 1 is on the road.');
  }

  protected reseed(): void {
    if (this.current() === 'motorway') {
      this.motorway?.trainer.reset(this.seedNetwork('motorway') as never);
    } else if (this.sim) {
      this.sim.trainer.reset(this.seedNetwork('city') as never);
    }
    this.history.set([]);
  }

  protected toggleFleet(): void {
    if (this.running()) {
      this.stopAll();
      return;
    }
    if (!this.sim || this.generating()) {
      this.pendingStart = 'fleet';
      this.status.set('The fleet deploys as soon as the map is ready.');
      return;
    }
    if (!this.sim.trainer.best) this.sim.trainer.reset(this.seedNetwork('city') as never);
    if (!this.sim.trainer.best) this.sim.trainer.reset(this.brains.factory('city') as never);
    this.sim.skin = this.game.equipped().skin;
    const err = this.sim.deployFleet(this.fleetSize());
    if (err) {
      this.toasts.push({ title: 'Can’t deploy yet', body: err, tone: 'warning' });
      return;
    }
    this.sessionCoins.set(0);
    this.running.set(true);
    this.fitView(false);
    this.status.set(`${this.fleetSize()} cars deployed. Every delivery pays coins.`);
  }

  protected toggleMotorway(): void {
    if (this.running()) {
      this.stopAll();
      return;
    }
    this.motorway = new MotorwaySim({
      populationSize: Math.min(200, this.population() + 40),
      mutation: this.mutation(),
      skin: this.game.equipped().skin,
      brain: this.motorway?.trainer.best ?? this.seedNetwork('motorway'),
      onEvent: (e: SimEvent & { passed?: number }) => {
        this.game.record({ type: 'generation' });
        this.game.record({ type: 'overtakes', count: e.passed ?? 0 });
        this.pushHistory(e as never, 1);
      },
    });
    this.motorway.start();
    this.running.set(true);
  }

  private stopAll(): void {
    this.sim?.stop();
    this.motorway?.stop();
    this.running.set(false);
  }

  private onSimEvent(e: SimEvent & { generation?: number; best?: number; mean?: number; arrived?: number; routeLength?: number }): void {
    if (e.type === 'delivery') {
      const gained = this.game.record(e);
      this.sessionCoins.update((v) => v + gained);
      if (!e.training && this.stats().deliveries === 0) this.toasts.push({ title: 'First delivery!', body: `+${formatCoins(gained)} coins`, tone: 'coin' });
    } else if (e.type === 'crash') {
      this.game.record(e);
    } else if (e.type === 'generation') {
      this.game.record({ type: 'generation' });
      this.pushHistory(e as never, e.routeLength ?? 1);
      if (((e.generation ?? 0) + 1) % 5 === 0) this.status.set(`Generation ${(e.generation ?? 0) + 1} done: ${e.arrived ?? 0} cars reached the target.`);
    }
  }

  private pushHistory(e: { generation: number; best: number; mean: number; arrived: number; passed?: number }, norm: number): void {
    const motorway = this.current() === 'motorway';
    const best = motorway ? (e.passed ?? Math.floor(e.best / 1000)) : Math.min(1.5, e.best / norm);
    const mean = motorway ? Math.floor(e.mean / 1000) : Math.min(1.5, e.mean / norm);
    this.history.update((h) => [...h.slice(-59), { generation: e.generation, best, mean, arrived: e.arrived }]);
  }

  protected async saveBrain(): Promise<void> {
    const motorway = this.current() === 'motorway';
    const trainer = motorway ? this.motorway?.trainer : this.sim?.trainer;
    if (!trainer?.best) {
      this.toasts.push({ title: 'Nothing to save yet', body: 'Train for at least one generation first.', tone: 'info' });
      return;
    }
    const name = this.brainName().trim() || `${motorway ? 'M1' : this.mapMeta().title} gen ${trainer.generation}`;
    const b = await this.brains.save({ name, domain: motorway ? 'motorway' : 'city', map: this.mapId(), generation: trainer.generation, fitness: trainer.bestFitness, network: trainer.best });
    this.brainName.set('');
    this.toasts.push({ title: `Saved “${b.name}”`, body: b.remote ? 'Stored locally and in the cloud brain library.' : 'Stored in this browser.', tone: 'good' });
  }

  protected async removeBrain(b: SavedBrain): Promise<void> {
    const ok = await this.confirm.ask({ title: `Delete “${b.name}”?`, body: 'This removes the brain from this browser.', confirmLabel: 'Delete Brain' });
    if (!ok) return;
    this.brains.remove(b.id);
    if (this.seed() === b.id) this.seed.set('factory');
    this.toasts.push({ title: 'Brain deleted', tone: 'info', action: { label: 'Undo', run: () => this.brains.restore(b) } });
  }

  protected async importBrain(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const b = await this.brains.importFile(file, this.current() === 'motorway' ? 'motorway' : 'city');
      this.seed.set(b.id);
      this.toasts.push({ title: `Imported “${b.name}”`, body: 'Selected as the seed brain.', tone: 'good' });
    } catch (err) {
      this.toasts.push({ title: 'Import failed', body: err instanceof Error ? err.message : 'Unreadable file.', tone: 'critical' });
    }
  }

  protected startBootcamp(): void {
    if (!this.world || this.bootcamp()?.running) return;
    this.bootWorker?.terminate();
    this.bootWorker = new Worker(new URL('../../workers/bootcamp.worker', import.meta.url), { type: 'module' });
    this.bootcamp.set({ running: true, generation: 0, total: this.bootGens(), best: 0, arrivals: 0, routes: this.bootRoutes() });
    this.bootWorker.onmessage = async ({ data }) => {
      if (data.type === 'progress') {
        this.bootcamp.set({ running: true, generation: data.generation, total: data.total, best: data.best, arrivals: data.arrivals, routes: data.routes });
        this.game.record({ type: 'generation' });
      } else if (data.type === 'done') {
        this.bootcamp.update((b) => (b ? { ...b, running: false } : b));
        const saved = await this.brains.save({ name: `Bootcamp · ${this.mapMeta().title} (${data.routes} routes)`, domain: 'city', map: this.mapId(), generation: this.bootGens(), fitness: data.fitness, network: data.brain });
        this.seed.set(saved.id);
        this.sim?.trainer.reset(NeuralNetwork.clone(data.brain) as never);
        this.toasts.push({ title: 'Bootcamp graduated', body: `A generalist brain was saved and selected. It averaged ${fmt.pct(Math.min(1, data.fitness))} progress across ${data.routes} routes.`, tone: 'good' });
        this.bootWorker?.terminate();
        this.bootWorker = null;
      } else if (data.type === 'error') {
        this.bootcamp.set(null);
        this.toasts.push({ title: 'Bootcamp stopped', body: data.message, tone: 'warning' });
      }
    };
    this.bootWorker.postMessage({ graph: this.world.graph.toCompact(), generations: this.bootGens(), routes: this.bootRoutes(), seed: Date.now() % 100000, brain: this.seedNetwork('city') });
  }

  protected cancelBootcamp(): void {
    this.bootWorker?.terminate();
    this.bootWorker = null;
    this.bootcamp.set(null);
  }

  // ---------- build actions ----------

  protected randomRoute(): void {
    const w = this.world;
    if (!w) return;
    const r = w.suggestRoute(createRng(Date.now() % 1_000_003));
    if (!r) {
      this.toasts.push({ title: 'No route found', body: 'Build a longer connected road network first.', tone: 'warning' });
      return;
    }
    this.stopAll();
    w.setRoute(r);
    this.onMarkingsChanged();
    this.fitView(true);
  }

  protected async clearMarkings(): Promise<void> {
    if (!this.world?.markings.length) return;
    const ok = await this.confirm.ask({ title: 'Clear all markings?', body: 'Stops, lights, crossings, Start and Target will be removed. Roads stay.', confirmLabel: 'Clear Markings' });
    if (!ok) return;
    this.stopAll();
    this.world.markings = [];
    this.world.markingsChanged();
    this.onMarkingsChanged();
  }

  protected async clearRoads(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Erase every road?', body: `You’ll start ${this.mapMeta().title} from a blank canvas. You can restore the original streets later with Reset Map.`, confirmLabel: 'Erase Roads' });
    if (!ok || !this.world) return;
    this.stopAll();
    this.world.graph.dispose();
    this.world.markings = [];
    this.world.markingsChanged();
    this.onGraphChanged();
    this.describeRoute();
  }

  protected async resetMap(): Promise<void> {
    const ok = await this.confirm.ask({ title: `Reset ${this.mapMeta().title}?`, body: 'Your edits to this map will be replaced by the original OpenStreetMap streets.', confirmLabel: 'Reset Map' });
    if (!ok) return;
    try {
      localStorage.removeItem(this.saveKey(this.mapId()));
    } catch {
      /* ignore */
    }
    this.world = null;
    this.dirty = false;
    await this.loadMap(this.mapId(), false);
  }

  protected async importOsm(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 15_000_000) throw new Error('That export is over 15 MB. Export a smaller area.');
      const compact = osmToCompact(JSON.parse(await file.text()));
      this.stopAll();
      const world = new World(Graph.fromCompact(compact));
      this.attachWorld(world);
      this.generating.set(true);
      this.genMs.set(await generateWorld(world));
      const route = world.suggestRoute(createRng(7));
      if (route) world.setRoute(route);
      this.sim = this.makeSim();
      this.generating.set(false);
      this.updateCounts();
      this.fitView(true);
      this.scheduleSave();
      this.describeRoute();
      this.worldChanged(true);
      this.toasts.push({ title: 'OSM import complete', body: `${world.graph.points.length} intersections imported into ${this.mapMeta().title}.`, tone: 'good' });
    } catch (err) {
      this.toasts.push({ title: 'Import failed', body: err instanceof Error ? err.message : 'Unreadable file.', tone: 'critical' });
    }
  }

  protected exportWorld(): void {
    if (!this.world) return;
    const blob = new Blob([JSON.stringify(this.world.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `terra-${this.mapId()}.world.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  protected async saveToCloud(btn: HTMLButtonElement): Promise<void> {
    if (!this.world) return;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      await this.api.put(`/worlds/${this.api.playerId}/${this.mapId()}`, this.world.toJSON());
      this.toasts.push({ title: 'World saved to the cloud', body: 'Stored as a document in the NoSQL world library.', tone: 'good' });
    } catch {
      this.toasts.push({ title: 'Cloud save failed', body: 'The API didn’t respond. Your world is still saved in this browser.', tone: 'warning' });
    } finally {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }

  protected setHomeStyle(id: string): void {
    if (this.game.owns('homes', id)) this.game.equip('home', id);
    else this.toasts.push({ title: 'Locked style', body: 'Buy home styles in the Depot garage.', tone: 'info' });
  }

  // ---------- camera ----------

  protected zoom(factor: number): void {
    if (this.show3d() && this.island?.zoom) this.island.zoom(factor);
    else this.viewport?.zoomBy(factor);
  }

  protected fitView(preferRoute: boolean): void {
    if (this.show3d()) this.island?.resetView?.();
    const w = this.world;
    const vp = this.viewport;
    if (!w || !vp || !w.graph.points.length) {
      vp?.lookAt(0, 0);
      return;
    }
    const pts = preferRoute ? w.markings.filter((m: { type: string }) => m.type === 'start' || m.type === 'target').map((m: { center: { x: number; y: number } }) => m.center) : [];
    const source = pts.length === 2 ? pts : w.graph.points;
    const xs = source.map((p: { x: number }) => p.x);
    const ys = source.map((p: { y: number }) => p.y);
    const pad = pts.length === 2 ? 900 : 200;
    vp.fit({ minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad }, 24);
  }

  // ---------- loop ----------

  private tick(): void {
    const steps = this.speed();
    const mode = this.current();
    this.time += 1 / 60;
    if (mode === 'motorway') {
      if (this.motorway?.running) for (let i = 0; i < steps; i++) this.motorway.step();
      return;
    }
    if (!this.world) return;
    if (this.sim && this.sim.mode !== 'idle') {
      for (let i = 0; i < steps; i++) this.sim.step();
    } else {
      this.world.updateLights();
    }
  }

  private draw(): void {
    // the 3D view renders itself; the simulation keeps ticking underneath
    if (this.show3d() && this.ready3d()) return;
    const canvas = this.canvasRef().nativeElement;
    const vp = this.viewport;
    const ctx = canvas.getContext('2d');
    if (!ctx || !vp) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const palette = this.theme.palette();
    const ground = palette.mode === 'dark' ? mix(palette.ink, palette.deep, 0.22) : mix(palette.light, '#ffffff', 0.35);

    // follow camera
    if (this.current() === 'motorway' && this.motorway) {
      const leader = this.motorway.leader();
      if (leader) {
        vp.offset.x += (-leader.x * 0.3 - vp.offset.x) * 0.1;
        vp.offset.y += (-(leader.y - (h * 0.25 * vp.zoom)) - vp.offset.y) * 0.15;
      }
    } else if (this.follow() && this.sim && this.sim.mode === 'train') {
      const leader = this.sim.leader();
      if (leader && !vp.isPanning) {
        vp.offset.x += (-leader.x - vp.offset.x) * 0.06;
        vp.offset.y += (-leader.y - vp.offset.y) * 0.06;
      }
    }

    vp.reset(ctx, dpr, ground);
    const view = vp.visibleBounds(200);
    if (palette.halftone) {
      // dots stay a constant screen size at any zoom
      ctx.save();
      ctx.scale(vp.zoom, vp.zoom);
      ctx.fillStyle = halftonePattern(ctx, palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)', { spacing: 9, radius: 1.3 });
      ctx.fillRect(view.minX / vp.zoom, view.minY / vp.zoom, (view.maxX - view.minX) / vp.zoom, (view.maxY - view.minY) / vp.zoom);
      ctx.restore();
    }

    if (this.current() === 'motorway') {
      this.motorway?.draw(ctx, palette, view, { time: this.time });
      if (!this.motorway?.running) this.drawIdleMotorway(ctx, palette, view);
      return;
    }
    const world = this.world;
    if (!world) return;
    const training = this.sim?.mode === 'train';
    world.draw(ctx, vp.viewPoint(), palette, view, {
      homeStyle: this.game.equipped().home,
      corridor: training ? this.sim!.corridor : null,
      showItems: !this.generating() || world.buildings.length > 0,
    });
    if (this.current() === 'build') {
      if (this.tool() === 'graph') this.graphEditor?.display(ctx, palette);
      this.markingEditors.get(this.tool())?.display(ctx, palette);
    }
    this.sim?.draw(ctx, palette, { time: this.time, showSensors: this.showSensors() });
  }

  private idleRoad: MotorwaySim | null = null;
  private drawIdleMotorway(ctx: CanvasRenderingContext2D, palette: ReturnType<ThemeService['palette']>, view: { minX: number; minY: number; maxX: number; maxY: number }): void {
    this.idleRoad ??= new MotorwaySim({ populationSize: 1 });
    this.idleRoad.road.draw(ctx, palette, view);
  }

  private refreshStats(): void {
    if (this.current() === 'motorway') {
      const s = this.motorway?.stats();
      if (s) this.stats.set({ generation: s.generation, population: s.population, alive: s.alive, crashed: s.crashed, arrived: 0, progress: 0, bestFitness: s.bestFitness, deliveries: 0, passed: s.passed, distance: s.distance });
      return;
    }
    const s = this.sim?.stats();
    if (!s) return;
    this.stats.set({
      generation: s.generation,
      population: s.population,
      alive: s.alive,
      crashed: s.crashed,
      arrived: s.arrived,
      progress: s.leaderProgress,
      bestFitness: s.bestFitness,
      deliveries: s.deliveries,
      passed: 0,
      distance: 0,
    });
  }

  // ---------- 3D view ----------

  /** Island props; reading signals here makes the effect track them. */
  private props3d(): Record<string, unknown> | null {
    const geometry = this.geometry3d(this.geoVersion());
    if (!geometry) return null;
    const eq = this.game.equipped();
    return {
      geometry,
      palette: this.theme.palette(),
      halftone: this.theme.halftone(),
      reducedMotion: this.theme.reducedMotion(),
      homeStyle: eq.home,
      skin: eq.skin,
      follow: this.follow() && (this.current() === 'train' || this.current() === 'fleet'),
    };
  }

  /** World geometry for three.js. The heavy part (roads, buildings, trees) is only re-exported after a regeneration. */
  private geometry3d(version: number): unknown {
    const w = this.world;
    if (!w || version === 0) return null;
    if (this.geoCache?.version === version) return this.geoCache.geo;
    if (this.baseGeo?.gen !== this.worldGen) {
      const segments = w.graph.segments.flatMap((s: { p1: { x: number; y: number }; p2: { x: number; y: number } }) => [s.p1.x, s.p1.y, s.p2.x, s.p2.y]);
      this.baseGeo = { gen: this.worldGen, geo: { ...w.exportGeometry(), segments } };
    }
    const markings = w.markings
      .filter((m: { type: string }) => m.type === 'start' || m.type === 'target')
      .map((m: { type: string; center: { x: number; y: number } }) => ({ type: m.type, x: m.center.x, y: m.center.y }));
    this.geoCache = { version, geo: { ...this.baseGeo.geo, markings, route: this.routePts } };
    return this.geoCache.geo;
  }

  private async sync3d(on: boolean, props: Record<string, unknown> | null): Promise<void> {
    if (!on) {
      this.unmount3d();
      return;
    }
    if (!props) return; // the world is still generating
    if (this.island) {
      this.island.update(props);
      return;
    }
    if (this.islandLoading) return;
    if (!webglAvailable()) {
      this.fail3d('This browser can’t run WebGL, so the 3D view is unavailable.');
      return;
    }
    this.islandLoading = true;
    try {
      const mod = await loadIsland('city3d');
      if (this.destroyed || !this.show3d()) return;
      const el = this.mount3dRef().nativeElement;
      this.island = mod.mount(el, {
        ...(untracked(() => this.props3d()) ?? props),
        getFrame: this.getFrame3d,
        onReady: () => {
          this.ready3d.set(true);
          this.status.set(`3D view on. ${this.coarsePointer ? 'Drag to orbit, pinch to zoom, two fingers to pan.' : 'Drag to orbit, right-drag to pan, scroll to zoom.'}`);
        },
      });
      this.islandIo = new IntersectionObserver(([e]) => this.island?.update({ hidden: !e.isIntersecting }));
      this.islandIo.observe(el);
    } catch {
      this.fail3d('The 3D libraries didn’t load (are you offline?), so you’re on the 2D map.');
    } finally {
      this.islandLoading = false;
    }
  }

  private unmount3d(): void {
    this.islandIo?.disconnect();
    this.islandIo = null;
    this.island?.unmount();
    this.island = null;
    this.ready3d.set(false);
  }

  private fail3d(body: string): void {
    this.toasts.push({ title: '3D view unavailable', body, tone: 'warning' });
    this.setView(false);
  }

  /** Per-frame car snapshot for the 3D view (pooled: it's read 60×/s). */
  private readonly getFrame3d = () => {
    const f = this.frame3d;
    const sim = this.sim;
    f.leader = null;
    f.rays.length = 0;
    if (!sim || sim.mode === 'idle' || this.current() === 'motorway') {
      f.cars.length = 0;
      return f;
    }
    const training = sim.mode === 'train';
    let leader = training ? sim.leader() : null;
    if (!training) {
      // fleet: trail one courier until it delivers (or crashes), then pick up the next one on the road
      const c = this.courier;
      this.courier = c && !c.done && sim.cars.includes(c) ? c : (sim.cars.find((car) => !car.done) ?? null);
      leader = this.courier;
    }
    f.tag = training ? 'LEADER' : 'COURIER';
    const cars = sim.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const o = (f.cars[i] ??= { x: 0, y: 0, a: 0, s: 0 });
      o.x = c.x;
      o.y = c.y;
      o.a = c.angle;
      o.s = c === leader ? 1 : c.damaged || c.timedOut ? 2 : c.arrived ? 3 : 0;
    }
    f.cars.length = cars.length;
    if (leader) {
      f.leader = { x: leader.x, y: leader.y };
      if (training && this.showSensors() && leader.sensor && !leader.done) {
        const { rays, readings } = leader.sensor;
        for (let i = 0; i < rays.length; i++) {
          const [start, end] = rays[i];
          const hit = readings[i] ?? end;
          f.rays.push(start.x, start.y, hit.x, hit.y);
        }
      }
    }
    return f;
  };

  // ---------- persistence ----------

  private saveKey(id: string): string {
    return `terra.world.v1.${id}`;
  }

  private readSaved(id: string): ReturnType<World['toJSON']> | null {
    try {
      const raw = localStorage.getItem(this.saveKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 800);
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.world || !this.dirty) return;
    this.dirty = false;
    try {
      localStorage.setItem(this.saveKey(this.mapId()), JSON.stringify(this.world.toJSON()));
    } catch {
      /* storage full: the world stays in memory */
    }
  }
}
