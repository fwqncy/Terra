import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import * as E from '../../../engine/idle/economy.js';
import { ApiService } from '../../core/api.service';
import { fmt, formatCoins } from '../../core/format';
import { GameService } from '../../core/game.service';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/confirm.service';
import { Icon } from '../../shared/icon';
import { ItemPreview } from '../../shared/item-preview';

const TABS = [
  { id: 'fleet', label: 'Fleet', icon: 'truck' },
  { id: 'upgrades', label: 'Upgrades', icon: 'bolt' },
  { id: 'garage', label: 'Garage', icon: 'palette' },
  { id: 'maps', label: 'Cities', icon: 'map' },
  { id: 'trophies', label: 'Trophies', icon: 'trophy' },
  { id: 'franchise', label: 'Franchise', icon: 'sparkle' },
] as const;

const GEN_ICON: Record<string, string> = { bike: 'bike', van: 'van', ute: 'truck', truck: 'truck', drone: 'drone', plane: 'plane', ship: 'ship', terminal: 'crane', hyperloop: 'fast' };
const POW_WORDS = ['POW!', 'BAM!', 'ZAP!', 'THWACK!', 'KA-CHUNK!', 'WHUMP!'];

@Component({
  selector: 'app-depot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, ItemPreview],
  templateUrl: './depot.html',
  styleUrl: './depot.css',
})
export class DepotPage {
  readonly tab = input<string>();

  protected readonly game = inject(GameService);
  protected readonly theme = inject(ThemeService);
  protected readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly tabs = TABS;
  protected readonly fmt = fmt;
  protected readonly formatCoins = formatCoins;
  protected readonly genIcon = GEN_ICON;
  protected readonly cosmetics = E.COSMETICS;
  protected readonly achievements = E.ACHIEVEMENTS;
  protected readonly qty = signal<1 | 10 | 'max'>(1);
  protected readonly pops = signal<{ id: number; x: number; y: number; text: string; word: string }[]>([]);
  private popSeq = 0;

  protected readonly active = computed(() => (TABS.some((t) => t.id === this.tab()) ? this.tab()! : 'fleet'));
  protected readonly st = this.game.state;
  protected readonly coins = computed(() => formatCoins(this.st().coins));

  protected readonly generators = computed(() => {
    const s = this.st();
    const q = this.qty();
    const mult = E.globalMultiplier(s, this.game.now());
    return E.GENERATORS.map((g, i) => {
      const owned = s.generators[g.id] ?? 0;
      const n = q === 'max' ? Math.max(1, E.maxAffordable(s, g.id)) : q;
      const cost = E.generatorCost(g.id, owned, n);
      // Reveal the next locked vehicle as a silhouette, like a comic teaser panel
      const prevOwned = i === 0 || (s.generators[E.GENERATORS[i - 1].id] ?? 0) > 0 || owned > 0;
      return { ...g, owned, n, cost, affordable: cost <= s.coins, each: g.cps * mult, total: E.generatorCps(s, g.id) * mult, revealed: prevOwned || s.lifetime >= g.baseCost / 2 };
    });
  });

  protected readonly upgrades = computed(() => {
    const s = this.st();
    return E.UPGRADES.map((u) => ({ ...u, owned: s.upgrades.includes(u.id), available: u.req(s), affordable: u.cost <= s.coins })).sort(
      (a, b) => Number(a.owned) - Number(b.owned) || Number(b.available) - Number(a.available) || a.cost - b.cost,
    );
  });

  protected readonly offline = computed(() => ({ hours: E.offlineCapHours(this.st()), rate: E.offlineRate(this.st()) }));
  protected readonly tokensNext = computed(() => E.franchiseTokens(this.st()));
  protected readonly canFranchise = computed(() => E.canFranchise(this.st()));
  protected readonly franchiseMin = E.FRANCHISE_MIN;
  protected readonly Math = Math;
  protected readonly mapTitles: Record<string, string> = { brisbane: 'Queen St & the Story Bridge', sandbox: 'An empty paddock', goldcoast: 'Cavill Ave to the Esplanade', sydney: 'George St to Circular Quay', melbourne: 'The Hoddle Grid' };

  protected dispatch(e: MouseEvent | KeyboardEvent): void {
    const gained = this.game.click();
    const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e instanceof MouseEvent && e.clientX ? e.clientX - target.left : target.width / 2;
    const y = e instanceof MouseEvent && e.clientY ? e.clientY - target.top : target.height / 2;
    const id = ++this.popSeq;
    const word = this.popSeq % 7 === 0 ? POW_WORDS[this.popSeq % POW_WORDS.length] : '';
    this.pops.update((p) => [...p.slice(-14), { id, x, y, text: `+${formatCoins(gained)}`, word }]);
    setTimeout(() => this.pops.update((p) => p.filter((x) => x.id !== id)), 900);
  }

  protected buy(id: string, n: number, affordable: boolean, cost: number): void {
    if (!affordable) {
      this.toasts.push({ title: 'Not enough coins', body: `You need ${formatCoins(cost - this.st().coins)} more. Click Dispatch or run a fleet.`, tone: 'info' });
      return;
    }
    this.game.buyGenerator(id, n);
  }

  protected cosmeticAction(kind: 'skins' | 'homes' | 'maps', id: string): void {
    const slot = kind === 'skins' ? 'skin' : kind === 'homes' ? 'home' : 'map';
    if (this.game.owns(kind, id)) this.game.equip(slot, id);
    else this.game.buyCosmetic(kind, id);
  }

  protected equipped(kind: 'skins' | 'homes' | 'maps', id: string): boolean {
    const e = this.st().equipped;
    return (kind === 'skins' ? e.skin : kind === 'homes' ? e.home : e.map) === id;
  }

  protected async doFranchise(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Sign the franchise?',
      body: `Coins, vehicles, upgrades and facility levels reset. You keep cosmetics, cities, trophies and stats, and hold ${this.tokensNext()} franchise tokens (+${this.tokensNext() * 2}% on everything, forever).`,
      confirmLabel: 'Franchise My Depot',
      tone: 'primary',
    });
    if (ok) this.game.franchise();
  }

  protected exportSave(): void {
    const blob = new Blob([this.game.exportSave()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `terra-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  protected async importSave(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 500_000) {
      this.toasts.push({ title: 'That file is too large to be a Terra save.', tone: 'critical' });
      return;
    }
    const ok = await this.confirm.ask({ title: 'Replace your current save?', body: 'Your current progress will be overwritten by the imported file.', confirmLabel: 'Import Save' });
    if (!ok) return;
    const imported = this.game.importSave(await file.text());
    this.toasts.push(imported ? { title: 'Save imported', tone: 'good' } : { title: 'Import failed', body: 'That file isn’t a Terra save.', tone: 'critical' });
  }

  protected async reset(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Reset all Depot progress?', body: 'Coins, vehicles, upgrades, cosmetics and trophies will be erased. Export a save first if you might want them back.', confirmLabel: 'Reset Everything' });
    if (ok) {
      this.game.reset();
      this.toasts.push({ title: 'Depot reset', body: 'A fresh start. The first bike costs 15 coins.', tone: 'info' });
    }
  }

  protected forceSync(btn: HTMLButtonElement): void {
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    const started = Date.now();
    void this.game.sync().finally(() => {
      // keep the loading state visible long enough to read (no flicker)
      setTimeout(() => {
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
        this.toasts.push({ title: 'Save synced to the API', body: 'Stored in SQL Server; the server re-checked your offline earnings.', tone: 'good' });
      }, Math.max(0, 400 - (Date.now() - started)));
    });
  }
}
