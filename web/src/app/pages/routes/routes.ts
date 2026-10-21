import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NeuralNetwork } from '../../../engine/ai/network.js';
import { GraphEditor } from '../../../engine/editors/graph-editor.js';
import { Coastline, KM_PER_UNIT, PLACES, buildLaneGraph, ensureIds, loadLanes, project, serializeLanes } from '../../../engine/geo/geo.js';
import { EMISSIONS } from '../../../engine/logistics/catalog.js';
import { drawGeoMap, drawLanes, drawPlaces } from '../../../engine/render/geo-map.js';
import { GeoSim } from '../../../engine/sim/geo-sim.js';
import { Viewport } from '../../../engine/viewport.js';
import { BrainStore } from '../../core/brain-store.service';
import { fmt, formatCoins } from '../../core/format';
import { GameService, SimEvent } from '../../core/game.service';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { LineChart, LineSeries } from '../../shared/charts/line-chart';
import { ConfirmService } from '../../shared/confirm.service';
import { Icon } from '../../shared/icon';
import { NnCanvas } from '../../shared/nn-canvas';

type Domain = 'sea' | 'air';
type Mode = 'train' | 'fleet' | 'chart';

const VIEWS = {
  bay: { label: 'Moreton Bay', box: { lon: [152.95, 153.6], lat: [-27.6, -26.85] } },
  coral: { label: 'Coral & Tasman', box: { lon: [146, 180], lat: [-38, -8] } },
  pacific: { label: 'Whole Region', box: { lon: [112, 188], lat: [-46, -2] } },
} as const;

/** Effective door-to-door speeds for the quote card (km/h). */
const QUOTE_SPEED = { sea: 30, air: 780 };

@Component({
  selector: 'app-routes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, LineChart, NnCanvas],
  templateUrl: './routes.html',
  styleUrls: ['../../shared/workspace.css', './routes.css'],
})
export class RoutesPage {
  readonly domain = input<string>();
  readonly from = input<string>();
  readonly to = input<string>();

  protected readonly game = inject(GameService);
  protected readonly theme = inject(ThemeService);
  private readonly brains = inject(BrainStore);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly fmt = fmt;
  protected readonly formatCoins = formatCoins;
  protected readonly views = Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label }));
  protected readonly Math = Math;

  protected readonly current = signal<Domain>('sea');
  protected readonly mode = signal<Mode>('train');
  protected readonly origin = signal('PBNE');
  protected readonly dest = signal('NOUP');
  protected readonly running = signal(false);
  protected readonly speed = signal(5);
  protected readonly population = signal(60);
  protected readonly storms = signal(10);
  protected readonly fleetSize = signal(10);
  protected readonly follow = signal(false);
  protected readonly seed = signal<'factory' | 'random'>('factory');
  protected readonly landWarnings = signal(0);
  protected readonly laneCount = signal(0);
  protected readonly stats = signal({ generation: 0, population: 0, alive: 0, crashed: 0, arrived: 0, progress: 0, deliveries: 0 });
  protected readonly history = signal<{ generation: number; arrived: number; best: number }[]>([]);
  protected readonly sessionCoins = signal(0);
  protected readonly status = signal('');
  protected readonly routeError = signal<string | null>(null);

  protected readonly places = computed(() => PLACES.filter((p) => p.kind === this.current()));
  protected readonly destinations = computed(() => this.places().filter((p) => p.id !== this.origin()));
  protected readonly unit = computed(() => (this.current() === 'sea' ? 'ship' : 'plane'));
  protected readonly quote = computed(() => {
    const km = this.routeKm();
    const d = this.current();
    if (!km) return null;
    const hours = km / QUOTE_SPEED[d] + (d === 'sea' ? 24 : 6);
    return { km, hours, co2PerTonne: km * EMISSIONS[d === 'sea' ? 'sea' : 'air'], nameFrom: PLACES.find((p) => p.id === this.origin())?.name, nameTo: PLACES.find((p) => p.id === this.dest())?.name };
  });
  protected readonly routeKm = signal(0);
  protected readonly chartSeries = computed<LineSeries[]>(() => [
    { id: 'arrived', label: 'Arrived', color: 'var(--series-sea)', values: this.history().map((h) => h.arrived) },
  ]);
  protected readonly chartLabels = computed(() => this.history().map((h) => `Gen ${h.generation + 1}`));

  private coast = new Coastline();
  private viewport: Viewport | null = null;
  private graph = buildLaneGraph('sea');
  private editor: GraphEditor | null = null;
  private sim: GeoSim | null = null;
  private time = 0;
  private badLanes = new Set<unknown>();
  private activeLanes = new Set<unknown>();

  protected readonly leaderBrain = () => this.sim?.leader()?.brain ?? this.sim?.trainer.best ?? null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const d: Domain = this.domain() === 'air' ? 'air' : 'sea';
      const f = this.from();
      const t = this.to();
      untracked(() => {
        if (d !== this.current() || !this.sim) this.setDomain(d, false);
        if (f && PLACES.some((p) => p.id === f && p.kind === d)) this.origin.set(f);
        if (t && PLACES.some((p) => p.id === t && p.kind === d)) this.dest.set(t);
        this.applyRoute();
      });
    });

    afterNextRender(() => {
      this.viewport = new Viewport(this.canvasRef().nativeElement, { zoom: 3, minZoom: 0.02, maxZoom: 14 });
      this.viewport.panMode = true;
      this.createEditor();
      this.showView(this.origin() === 'PBNE' && ['TANG', 'DUNW', 'GCSW'].includes(this.dest()) ? 'bay' : 'coral');
      let raf = 0;
      let last = 0;
      const frame = (t: number) => {
        this.tick();
        this.draw();
        if (t - last > 250) {
          last = t;
          this.refreshStats();
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      destroyRef.onDestroy(() => cancelAnimationFrame(raf));
    });

    effect(() => {
      const n = this.population();
      if (this.sim) this.sim.trainer.populationSize = n;
    });

    destroyRef.onDestroy(() => {
      this.sim?.stop();
      this.editor?.dispose();
      this.viewport?.dispose();
    });
  }

  // ---------- domain / route ----------

  protected setDomain(d: Domain, updateUrl = true): void {
    this.stop();
    const changed = d !== this.current();
    this.current.set(d);
    this.graph = loadLanes(d, this.readLanes(d));
    const valid = (id: string) => PLACES.some((p) => p.id === id && p.kind === d);
    if (changed || !valid(this.origin())) this.origin.set(d === 'sea' ? 'PBNE' : 'BNE');
    if (changed || !valid(this.dest())) this.dest.set(d === 'sea' ? 'NOUP' : 'NAN');
    this.createEditor();
    this.sim = this.makeSim();
    this.validateLanes();
    this.history.set([]);
    if (updateUrl) this.syncUrl();
  }

  private createEditor(): void {
    this.editor?.dispose();
    this.editor = null;
    if (!this.viewport) return;
    this.editor = new GraphEditor(this.viewport, this.graph, {
      onChange: () => this.onLanesChanged(),
      pointSize: 10,
      screenSize: true,
      snap: 14,
      canRemove: (p: { place?: unknown }) => !p.place,
      canMove: (p: { place?: unknown }) => !p.place,
    });
    if (this.mode() === 'chart') this.editor.enable();
  }

  private makeSim(): GeoSim {
    const d = this.current();
    return new GeoSim(d, {
      coast: this.coast,
      graph: this.graph,
      populationSize: this.population(),
      storms: this.storms(),
      brain: this.seed() === 'factory' ? this.brains.factory(d) : null,
      seed: 5,
      onEvent: (e: SimEvent & { generation?: number; arrived?: number; best?: number }) => this.onEvent(e),
    });
  }

  protected applyRoute(): void {
    if (!this.sim) return;
    this.stop();
    const err = this.sim.setRoute(this.origin(), this.dest());
    this.routeError.set(err);
    this.routeKm.set(err ? 0 : this.sim.routeKm);
    this.activeLanes = new Set(this.sim.route ? this.segmentsOnRoute() : []);
    this.history.set([]);
  }

  private segmentsOnRoute(): unknown[] {
    const pts = this.sim?.route?.points ?? [];
    const ids = (pts as unknown as { id?: string }[]).map((p) => p.id);
    return this.graph.segments.filter((s: { p1: { id?: string }; p2: { id?: string } }) => {
      const a = ids.indexOf(s.p1.id);
      const b = ids.indexOf(s.p2.id);
      return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
    });
  }

  protected pickOrigin(id: string): void {
    this.origin.set(id);
    if (this.dest() === id) this.dest.set(this.destinations()[0]?.id ?? id);
    this.syncUrl();
  }

  protected pickDest(id: string): void {
    this.dest.set(id);
    this.syncUrl();
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      queryParams: { domain: this.current(), from: this.origin(), to: this.dest() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---------- modes ----------

  protected setMode(m: Mode): void {
    this.stop();
    this.mode.set(m);
    if (m === 'chart') this.editor?.enable();
    else this.editor?.disable();
    if (this.viewport) this.viewport.panMode = m !== 'chart';
  }

  protected toggleTraining(): void {
    if (this.running()) return this.stop();
    if (!this.sim) return;
    if (this.routeError()) {
      this.toasts.push({ title: 'No route', body: this.routeError() ?? '', tone: 'warning' });
      return;
    }
    this.sim.weather && (this.sim.weather.count = this.storms());
    this.sim.startTraining();
    this.running.set(true);
    this.fitRoute();
    this.status.set(`Training ${this.unit()}s from ${this.origin()} to ${this.dest()}.`);
  }

  protected toggleFleet(): void {
    if (this.running()) return this.stop();
    if (!this.sim) return;
    if (!this.sim.trainer.best) this.sim.trainer.reset(this.brains.factory(this.current()) as never);
    const err = this.sim.deployFleet(this.fleetSize());
    if (err) {
      this.toasts.push({ title: 'Can’t deploy yet', body: err, tone: 'warning' });
      return;
    }
    this.sessionCoins.set(0);
    this.running.set(true);
    this.showView(this.current() === 'sea' ? 'coral' : 'pacific');
  }

  protected reseed(v: 'factory' | 'random'): void {
    this.seed.set(v);
    this.sim?.trainer.reset((v === 'factory' ? this.brains.factory(this.current()) : null) as never);
    this.history.set([]);
  }

  protected stop(): void {
    this.sim?.stop();
    this.running.set(false);
  }

  private onEvent(e: SimEvent & { generation?: number; arrived?: number; best?: number }): void {
    if (e.type === 'delivery') {
      const gained = this.game.record(e);
      this.sessionCoins.update((v) => v + gained);
    } else if (e.type === 'crash') {
      this.game.record(e);
    } else if (e.type === 'generation') {
      this.game.record({ type: 'generation' });
      this.history.update((h) => [...h.slice(-59), { generation: e.generation ?? 0, arrived: e.arrived ?? 0, best: e.best ?? 0 }]);
      if (((e.generation ?? 0) + 1) % 5 === 0) this.status.set(`Generation ${(e.generation ?? 0) + 1}: ${e.arrived ?? 0} ${this.unit()}s arrived.`);
    }
  }

  protected async saveBrain(): Promise<void> {
    const t = this.sim?.trainer;
    if (!t?.best) {
      this.toasts.push({ title: 'Nothing to save yet', body: 'Train for at least one generation first.', tone: 'info' });
      return;
    }
    const b = await this.brains.save({ name: `${this.origin()}→${this.dest()} gen ${t.generation}`, domain: this.current(), generation: t.generation, fitness: t.bestFitness, network: NeuralNetwork.clone(t.best) });
    this.toasts.push({ title: `Saved “${b.name}”`, tone: 'good' });
  }

  // ---------- lanes ----------

  private onLanesChanged(): void {
    ensureIds(this.graph);
    this.validateLanes();
    try {
      localStorage.setItem(`terra.lanes.v1.${this.current()}`, JSON.stringify(serializeLanes(this.graph)));
    } catch {
      /* ignore */
    }
    this.applyRoute();
    this.game.record({ type: 'segment', count: 0 });
  }

  private validateLanes(): void {
    this.laneCount.set(this.graph.segments.length);
    if (this.current() !== 'sea') {
      this.badLanes = new Set();
      this.landWarnings.set(0);
      return;
    }
    this.badLanes = new Set(this.graph.segments.filter((s: { p1: unknown; p2: unknown }) => this.coast.crossesLand(s.p1, s.p2)));
    this.landWarnings.set(this.badLanes.size);
  }

  protected async resetLanes(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Reset the lanes?', body: `Your ${this.current() === 'sea' ? 'sea lanes' : 'airways'} go back to the default chart.`, confirmLabel: 'Reset Lanes' });
    if (!ok) return;
    try {
      localStorage.removeItem(`terra.lanes.v1.${this.current()}`);
    } catch {
      /* ignore */
    }
    this.setDomain(this.current(), false);
    this.applyRoute();
  }

  private readLanes(d: Domain): unknown {
    try {
      const raw = localStorage.getItem(`terra.lanes.v1.${d}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------- camera ----------

  protected showView(id: string): void {
    const v = VIEWS[id as keyof typeof VIEWS];
    if (!v || !this.viewport) return;
    const a = project(v.box.lon[0], v.box.lat[1]);
    const b = project(v.box.lon[1], v.box.lat[0]);
    this.viewport.fit({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, 16);
  }

  protected fitRoute(): void {
    const pts = this.sim?.route?.points;
    if (!pts?.length || !this.viewport) return;
    const xs = pts.map((p: { x: number }) => p.x);
    const ys = pts.map((p: { y: number }) => p.y);
    const pad = this.current() === 'sea' ? 40 : 120;
    this.viewport.fit({ minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad }, 24);
  }

  protected zoom(f: number): void {
    this.viewport?.zoomBy(f);
  }

  // ---------- loop ----------

  private tick(): void {
    this.time += 1 / 60;
    if (!this.sim) return;
    const steps = this.running() ? this.speed() : 1;
    for (let i = 0; i < steps; i++) this.sim.step();
  }

  private draw(): void {
    const canvas = this.canvasRef().nativeElement;
    const vp = this.viewport;
    const ctx = canvas.getContext('2d');
    if (!ctx || !vp || !this.sim) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    if (this.follow() && this.mode() === 'train' && this.running()) {
      const l = this.sim.leader();
      if (l && !vp.isPanning) {
        vp.offset.x += (-l.x - vp.offset.x) * 0.05;
        vp.offset.y += (-l.y - vp.offset.y) * 0.05;
      }
    }
    const palette = this.theme.palette();
    vp.reset(ctx, dpr, palette.bg);
    const view = vp.visibleBounds(20 * vp.zoom);
    const px = vp.zoom;
    drawGeoMap(ctx, this.coast, palette, view, px, { time: this.time });
    if (this.mode() === 'chart') {
      this.editor?.display(ctx, palette);
      for (const s of this.badLanes as Set<{ draw: (c: CanvasRenderingContext2D, o: object) => void }>) s.draw(ctx, { color: '#E5484D', width: 4 * px, dash: [6 * px, 4 * px] });
    } else {
      drawLanes(ctx, this.graph, palette, px, { domain: this.current(), active: this.activeLanes });
    }
    drawPlaces(ctx, palette, px, { domain: this.current(), selected: [this.origin(), this.dest()] });
    this.sim.draw(ctx, palette, px, { time: this.time });
  }

  private refreshStats(): void {
    const s = this.sim?.stats();
    if (!s) return;
    this.stats.set({ generation: s.generation, population: s.population, alive: s.alive, crashed: s.crashed, arrived: s.arrived, progress: s.leaderProgress, deliveries: s.deliveries });
  }

  protected kmText(units: number): string {
    return fmt.km(units * KM_PER_UNIT);
  }
}
