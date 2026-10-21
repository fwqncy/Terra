import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FACILITIES, MAX_FACILITY_LEVEL, facilityCost } from '../../../engine/idle/economy.js';
import { IslandHandle, loadIsland, webglAvailable } from '../../core/cdn';
import { fmt, formatCoins } from '../../core/format';
import { GameService } from '../../core/game.service';
import { LogisticsService } from '../../core/logistics.service';
import { ThemeService } from '../../core/theme.service';
import { Icon } from '../../shared/icon';

const KIND_ICON: Record<string, string> = { warehouse: 'warehouse', seaport: 'ship', airport: 'plane' };

/** 3D Ops: a live strategy-game floor over the logistics simulation. */
@Component({
  selector: 'app-ops',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  templateUrl: './ops.html',
  styleUrl: './ops.css',
})
export class OpsPage {
  /** ?hub=EFD deep-links a selection. */
  readonly hub = input<string>();

  protected readonly game = inject(GameService);
  protected readonly theme = inject(ThemeService);
  protected readonly logistics = inject(LogisticsService);
  private readonly router = inject(Router);
  private readonly mountEl = viewChild.required<ElementRef<HTMLElement>>('mount');

  protected readonly fmt = fmt;
  protected readonly formatCoins = formatCoins;
  protected readonly maxLevel = MAX_FACILITY_LEVEL;
  protected readonly Math = Math;
  protected readonly webgl = signal(true);
  protected readonly ready = signal(false);
  protected readonly selected = signal<string | null>(null);
  protected readonly hovered = signal<string | null>(null);
  protected readonly speed = signal(1);
  protected readonly paused = signal(false);
  protected readonly clockText = signal('');

  protected readonly snap = this.logistics.snapshot;
  protected readonly facilities = computed(() => {
    const hubs = this.snap().hubs;
    const levels = this.game.state().facilities;
    return FACILITIES.map((f) => {
      const h = hubs.find((x) => x.id === f.id);
      const level = levels[f.id] ?? 1;
      return { ...f, level, occupancy: h?.occupancy ?? 0.5, doors: h?.dockDoors ?? 0, busy: h?.dockDoorsBusy ?? 0, capacity: h?.capacity ?? 0, unit: h?.unit ?? '', icon: KIND_ICON[f.kind], nextCost: level < MAX_FACILITY_LEVEL ? facilityCost(f.id, level) : null };
    });
  });
  protected readonly current = computed(() => this.facilities().find((f) => f.id === this.selected()) ?? null);
  protected readonly departures = computed(() => {
    const id = this.selected();
    return this.snap().departures.filter((d) => !id || d.origin === id).slice(0, 5);
  });
  protected readonly alerts = computed(() => this.snap().alerts.slice(0, 4));
  protected readonly fleet = computed(() => {
    const g = this.game.state().generators;
    return { trucks: g['van'] / 4 + g['ute'] / 2 + g['truck'], planes: g['plane'] + g['drone'] / 6, ships: g['ship'] + g['terminal'] };
  });
  protected readonly rushReady = computed(() => {
    const id = this.selected();
    return !id || (this.game.rushCooldowns()[id] ?? 0) <= this.game.now();
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(this.logistics.attach());
    let island: IslandHandle & { clock?: () => number } | null = null;
    let disposed = false;

    effect(() => {
      const h = this.hub();
      untracked(() => this.selected.set(h && FACILITIES.some((f) => f.id === h) ? h : null));
    });

    effect(() => {
      const props = {
        palette: this.theme.palette(),
        halftone: this.theme.halftone(),
        reducedMotion: this.theme.reducedMotion(),
        facilities: this.facilities().map((f) => ({ id: f.id, level: f.level, occupancy: f.occupancy })),
        fleet: this.fleet(),
        selected: this.selected(),
        focus: this.selected(),
        speed: this.speed(),
        paused: this.paused(),
      };
      island?.update(props);
    });

    afterNextRender(async () => {
      if (!webglAvailable()) {
        this.webgl.set(false);
        return;
      }
      try {
        const mod = await loadIsland('ops');
        if (disposed) return;
        island = mod.mount(this.mountEl().nativeElement, {
          palette: this.theme.palette(),
          halftone: this.theme.halftone(),
          reducedMotion: this.theme.reducedMotion(),
          facilities: this.facilities().map((f) => ({ id: f.id, level: f.level, occupancy: f.occupancy })),
          fleet: this.fleet(),
          selected: this.selected(),
          focus: this.selected(),
          speed: this.speed(),
          onReady: () => this.ready.set(true),
          onSelect: (id: string | null) => this.select(id),
          onHover: (id: string | null) => this.hovered.set(id),
        });
        const io = new IntersectionObserver(([e]) => island?.update({ hidden: !e.isIntersecting }));
        io.observe(this.mountEl().nativeElement);
        const clock = setInterval(() => {
          const c = island?.clock?.() ?? 0;
          const minutes = Math.floor(c * 24 * 60);
          this.clockText.set(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
        }, 500);
        destroyRef.onDestroy(() => {
          io.disconnect();
          clearInterval(clock);
        });
      } catch {
        this.webgl.set(false);
      }
    });

    destroyRef.onDestroy(() => {
      disposed = true;
      island?.unmount();
    });
  }

  protected select(id: string | null): void {
    this.selected.set(id);
    void this.router.navigate([], { queryParams: { hub: id }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setSpeed(s: number): void {
    this.paused.set(false);
    this.speed.set(s);
    this.logistics.speed.set(s * 2);
    this.logistics.paused.set(false);
  }

  protected togglePause(): void {
    this.paused.update((p) => !p);
    this.logistics.paused.set(this.paused());
  }

  protected rush(): void {
    const id = this.selected();
    if (!id) return;
    this.game.rushOrder(id);
  }

  protected occupancyLevel(v: number): string {
    return v > 0.9 ? 'critical' : v > 0.75 ? 'warning' : 'ok';
  }
}
