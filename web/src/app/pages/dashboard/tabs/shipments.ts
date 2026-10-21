import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { fmt } from '../../../core/format';
import { LogisticsService, Shipment, ShipmentPage } from '../../../core/logistics.service';
import { ThemeService } from '../../../core/theme.service';
import { ToastService } from '../../../core/toast.service';
import { Icon } from '../../../shared/icon';

const STATUS_OPTIONS = ['Active', 'Booked', 'In Transit', 'At Hub', 'Delayed', 'Exception', 'Delivered'];
const COLUMNS: { key: string; label: string; num?: boolean }[] = [
  { key: 'id', label: 'Shipment' },
  { key: 'customer', label: 'Customer' },
  { key: 'mode', label: 'Mode' },
  { key: 'destinationName', label: 'Route' },
  { key: 'status', label: 'Status' },
  { key: 'etaAt', label: 'ETA' },
  { key: 'weightKg', label: 'Weight', num: true },
  { key: 'costAud', label: 'Charge', num: true },
];

@Component({
  selector: 'app-shipments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="toolbar row">
      <div class="field search">
        <label class="sr-only" for="ship-q">Search shipments</label>
        <input
          id="ship-q"
          class="input"
          type="search"
          name="q"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search ID, customer, destination or carrier…"
          [value]="q()"
          (input)="onSearch($any($event.target).value)"
        />
      </div>
      <label class="sr-only" for="ship-status">Status</label>
      <select id="ship-status" class="select auto" (change)="paramChange.emit({ status: $any($event.target).value === 'Active' ? null : $any($event.target).value })">
        <option value="all" [selected]="status() === 'all'">All statuses</option>
        @for (s of statuses; track s) {
          <option [value]="s" [selected]="status() === s">{{ s === 'Active' ? 'Active (not delivered)' : s }}</option>
        }
      </select>
      <label class="sr-only" for="ship-mode">Mode</label>
      <select id="ship-mode" class="select auto" (change)="paramChange.emit({ mode: $any($event.target).value })">
        <option value="" [selected]="!mode()">All modes</option>
        <option value="road" [selected]="mode() === 'road'">Road</option>
        <option value="air" [selected]="mode() === 'air'">Air</option>
        <option value="sea" [selected]="mode() === 'sea'">Sea</option>
      </select>
      <span class="spacer"></span>
      <button class="btn btn--sm" type="button" (click)="exportCsv()"><app-icon name="download" [size]="16" />Export CSV</button>
    </div>

    <div class="table-wrap" tabindex="0" role="region" aria-label="Shipments table" [class.is-stale]="loading()">
      <table class="table">
        <caption class="sr-only">Shipments, {{ data()?.total ?? 0 }} results, sorted by {{ sortLabel() }} {{ dir() === 'asc' ? 'ascending' : 'descending' }}</caption>
        <thead>
          <tr>
            @for (c of columns; track c.key) {
              <th scope="col" [class.num]="c.num" [attr.aria-sort]="sort() === c.key ? (dir() === 'asc' ? 'ascending' : 'descending') : 'none'">
                <button class="sort" type="button" (click)="toggleSort(c.key)">
                  {{ c.label }}
                  <span class="arrow" aria-hidden="true">{{ sort() === c.key ? (dir() === 'asc' ? '▲' : '▼') : '↕' }}</span>
                </button>
              </th>
            }
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @if (!data()) {
            @for (i of [1, 2, 3, 4, 5, 6]; track i) {
              <tr aria-hidden="true">
                @for (c of columns; track c.key) {
                  <td><span class="skeleton" style="display: block; height: 14px"></span></td>
                }
                <td></td>
              </tr>
            }
          } @else {
            @for (s of data()!.items; track s.id) {
              <tr>
                <td><button class="link mono" type="button" (click)="open(s)">{{ s.id }}</button></td>
                <td class="clip">{{ s.customer }}</td>
                <td><span class="mode"><span class="dot" [style.color]="modeColor(s.mode)"></span>{{ modeLabel(s.mode) }}</span></td>
                <td class="clip">{{ s.origin }} → {{ s.destinationName }}</td>
                <td><span class="badge" [class]="'badge ' + statusClass(s)"><app-icon [name]="statusIcon(s)" />{{ s.status }}</span></td>
                <td class="tabular nowrap">{{ fmt.dateTime(s.etaAt) }}@if (atRisk(s)) {<span class="risk" title="ETA is past the SLA">SLA risk</span>}</td>
                <td class="num">{{ fmt.kg(s.weightKg) }}</td>
                <td class="num">{{ fmt.aud(s.costAud) }}</td>
                <td>
                  @if (s.status !== 'Delivered') {
                    <button class="btn btn--sm" type="button" [disabled]="s.expedited" (click)="expedite(s)">{{ s.expedited ? 'Expedited' : 'Expedite' }}</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="columns.length + 1">
                  <div class="empty">
                    <strong>No shipments match those filters.</strong>
                    <button class="btn btn--sm" type="button" (click)="clearFilters()">Clear Filters</button>
                  </div>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>

    @if (data(); as d) {
      <nav class="pager row" aria-label="Pagination">
        <span class="subtle tabular">{{ fmt.whole(d.total) }} shipments · page {{ page() }} of {{ pages() }}</span>
        <span class="spacer"></span>
        <button class="btn btn--sm" type="button" [disabled]="page() <= 1" (click)="paramChange.emit({ page: String(page() - 1) })">Previous</button>
        <button class="btn btn--sm" type="button" [disabled]="page() >= pages()" (click)="paramChange.emit({ page: String(page() + 1) })">Next</button>
      </nav>
    }

    <dialog #detail class="modal" aria-labelledby="ship-title" (close)="selected.set(null)">
      @if (selected(); as s) {
        <div class="detail">
          <div class="row">
            <span class="caption-box">{{ modeLabel(s.mode) }} · {{ s.priority }}</span>
            <span class="spacer"></span>
            <button class="btn btn--ghost btn--icon btn--sm" type="button" aria-label="Close" (click)="detail.close()"><app-icon name="x" [size]="16" /></button>
          </div>
          <h2 id="ship-title" class="mono">{{ s.id }}</h2>
          <p class="muted">{{ s.customer }} · {{ s.origin }} → {{ s.destinationName }} · {{ s.carrier }}</p>
          <ol class="timeline">
            @for (step of timeline(s); track step.label) {
              <li [class.done]="step.done" [class.current]="step.current">
                <span class="node" aria-hidden="true"></span>
                <strong>{{ step.label }}</strong>
                <span class="subtle tabular">{{ step.when }}</span>
              </li>
            }
          </ol>
          @if (s.delayReason) {
            <p class="badge badge--warning"><app-icon name="alert" />{{ s.delayReason }}</p>
          }
          <dl class="facts tabular">
            <div><dt>Weight</dt><dd>{{ fmt.kg(s.weightKg) }} · {{ s.units }} {{ s.unitType }}</dd></div>
            <div><dt>Distance</dt><dd>{{ fmt.km(s.distanceKm) }}</dd></div>
            <div><dt>Charge</dt><dd>{{ fmt.aud(s.costAud) }}</dd></div>
            <div><dt>CO₂</dt><dd>{{ fmt.kg(s.co2Kg) }}</dd></div>
            <div><dt>SLA</dt><dd>{{ fmt.dateTime(s.slaAt) }}</dd></div>
            <div><dt>Progress</dt><dd>{{ fmt.pct(s.progress) }}</dd></div>
          </dl>
        </div>
      }
    </dialog>
  `,
  styleUrl: './tab.css',
  styles: `
    .toolbar { gap: 10px; margin-bottom: 12px; }
    .search { flex: 1 1 280px; }
    .auto { width: auto; }
    .table-wrap { max-height: min(70dvh, 760px); transition: opacity 160ms ease; }
    .table-wrap.is-stale { opacity: 0.6; }
    .sort { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
    .arrow { font-size: 10px; opacity: 0.7; }
    .link { padding: 0; border: 0; background: none; color: var(--link); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; font-size: 13px; }
    .clip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nowrap { white-space: nowrap; }
    .mode { display: inline-flex; align-items: center; gap: 6px; }
    .risk { margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 11px; font-weight: 800; background: color-mix(in srgb, var(--status-serious) 20%, transparent); color: var(--text); }
    .pager { margin-top: 12px; }
    .detail { display: grid; gap: 12px; padding: 20px; }
    .detail h2 { font-size: 26px; }
    .timeline { display: grid; gap: 0; margin: 4px 0; padding: 0; list-style: none; }
    .timeline li { position: relative; display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 10px; padding: 8px 0; }
    .timeline li::before { content: ''; position: absolute; left: 9px; top: -50%; bottom: 50%; width: 2px; background: var(--border-strong); }
    .timeline li:first-child::before { display: none; }
    .node { width: 14px; height: 14px; margin-left: 3px; border-radius: 50%; border: 2px solid var(--border-strong); background: var(--surface); z-index: 1; }
    .timeline li.done .node { background: var(--status-good); border-color: var(--status-good); }
    .timeline li.current .node { background: var(--highlight); border-color: var(--ink-line); }
    .timeline li:not(.done):not(.current) strong { color: var(--text-3); }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0; }
    .facts dt { font-size: 12px; color: var(--text-3); font-weight: 700; }
    .facts dd { margin: 0; font-weight: 750; }
  `,
})
export class ShipmentsTab {
  readonly status = input('');
  readonly mode = input('');
  readonly q = input('');
  readonly page = input(1);
  readonly sort = input('etaAt');
  readonly dir = input<'asc' | 'desc'>('asc');
  /** One batched URL update (several keys at once avoids racing navigations). */
  readonly paramChange = output<Record<string, string | null>>();

  private readonly logistics = inject(LogisticsService);
  private readonly theme = inject(ThemeService);
  private readonly toasts = inject(ToastService);
  private readonly detail = viewChild.required<ElementRef<HTMLDialogElement>>('detail');
  protected readonly fmt = fmt;
  protected readonly String = String;
  protected readonly statuses = STATUS_OPTIONS;
  protected readonly columns = COLUMNS;
  protected readonly data = signal<ShipmentPage | null>(null);
  protected readonly loading = signal(false);
  protected readonly selected = signal<Shipment | null>(null);
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / 25)));
  /** 'all' in the URL means no status filter; no param means Active (the ops default). */
  private readonly queryStatus = computed(() => (this.status() === 'all' ? '' : this.status()));
  protected readonly sortLabel = computed(() => COLUMNS.find((c) => c.key === this.sort())?.label ?? 'ETA');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = '';

  constructor() {
    effect(() => {
      const params = { status: this.queryStatus(), mode: this.mode(), q: this.q(), page: this.page(), sort: this.sort(), dir: this.dir(), pageSize: 25 };
      this.logistics.snapshot(); // refresh as the simulation advances
      untracked(() => void this.load(params));
    });
  }

  private async load(params: Parameters<LogisticsService['query']>[0]): Promise<void> {
    const key = JSON.stringify(params);
    const changed = key !== this.lastKey;
    this.lastKey = key;
    // Keep the previous rows visible (dimmed) while a new filter loads — no layout jump.
    if (changed) this.loading.set(true);
    try {
      const page = await this.logistics.query(params);
      if (key === this.lastKey) this.data.set(page);
    } catch {
      this.toasts.push({ title: 'Couldn’t load shipments', body: 'The API didn’t answer. Switch the source back to the in-browser sim.', tone: 'warning' });
    } finally {
      if (key === this.lastKey) this.loading.set(false);
    }
  }

  protected onSearch(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.paramChange.emit({ q: value.trim() || null }), 250);
  }

  protected toggleSort(key: string): void {
    if (this.sort() === key) this.paramChange.emit({ dir: this.dir() === 'asc' ? 'desc' : null });
    else this.paramChange.emit({ sort: key === 'etaAt' ? null : key, dir: null });
  }

  protected clearFilters(): void {
    this.paramChange.emit({ q: null, status: 'all', mode: null, page: null });
  }

  protected async expedite(s: Shipment): Promise<void> {
    const before = s.etaAt;
    const updated = await this.logistics.expedite(s.id);
    if (updated) {
      this.toasts.push({ title: `${s.id} expedited`, body: `New ETA ${fmt.dateTime(updated.etaAt)} (was ${fmt.dateTime(before)}). Charge +25%.`, tone: 'good' });
      this.lastKey = '';
      void this.load({ status: this.queryStatus(), mode: this.mode(), q: this.q(), page: this.page(), sort: this.sort(), dir: this.dir(), pageSize: 25 });
    }
  }

  protected open(s: Shipment): void {
    this.selected.set(s);
    this.detail().nativeElement.showModal();
  }

  protected timeline(s: Shipment): { label: string; when: string; done: boolean; current: boolean }[] {
    const now = this.logistics.snapshot().now;
    const order = ['Booked', 'In Transit', 'At Hub', 'Delivered'];
    const idx = s.status === 'Delayed' || s.status === 'Exception' ? 1 : order.indexOf(s.status);
    return [
      { label: 'Booked', when: fmt.dateTime(s.createdAt), done: idx > 0, current: idx === 0 },
      { label: s.status === 'Delayed' ? 'In transit · delayed' : s.status === 'Exception' ? 'In transit · exception' : 'In transit', when: fmt.dateTime(s.departAt), done: idx > 1, current: idx === 1 },
      ...(s.mode === 'road' ? [] : [{ label: s.mode === 'sea' ? 'At port · customs' : 'At airport · customs', when: '', done: idx > 2, current: idx === 2 }]),
      { label: 'Delivered', when: s.deliveredAt ? fmt.dateTime(s.deliveredAt) : `ETA ${fmt.dateTime(s.etaAt)}${s.etaAt < now ? ' (overdue)' : ''}`, done: idx === 3, current: false },
    ];
  }

  protected async exportCsv(): Promise<void> {
    const all = await this.logistics.query({ status: this.queryStatus(), mode: this.mode(), q: this.q(), sort: this.sort(), dir: this.dir(), page: 1, pageSize: 100_000 });
    const head = ['id', 'mode', 'origin', 'destination', 'carrier', 'customer', 'priority', 'status', 'weightKg', 'distanceKm', 'costAud', 'co2Kg', 'departAt', 'etaAt', 'slaAt', 'deliveredAt'];
    const esc = (v: unknown) => {
      const t = v == null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const iso = (n: number | null) => (n ? new Date(n).toISOString() : '');
    const rows = all.items.map((s) =>
      [s.id, s.mode, s.origin, s.destinationName, s.carrier, s.customer, s.priority, s.status, s.weightKg, s.distanceKm, s.costAud, s.co2Kg, iso(s.departAt), iso(s.etaAt), iso(s.slaAt), iso(s.deliveredAt)].map(esc).join(','),
    );
    const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `terra-shipments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toasts.push({ title: 'CSV exported', body: `${fmt.whole(all.total)} shipments.`, tone: 'good' });
  }

  protected modeColor(m: string): string {
    return this.theme.series()[m as 'road' | 'air' | 'sea'] ?? 'currentColor';
  }

  protected modeLabel(m: string): string {
    return m === 'road' ? 'Road' : m === 'air' ? 'Air' : 'Sea';
  }

  protected statusClass(s: Shipment): string {
    return s.status === 'Delivered' ? (s.onTime ? 'badge--good' : 'badge--serious') : s.status === 'Exception' ? 'badge--critical' : s.status === 'Delayed' ? 'badge--warning' : '';
  }

  protected statusIcon(s: Shipment): string {
    return s.status === 'Delivered' ? 'check' : s.status === 'Exception' || s.status === 'Delayed' ? 'alert' : s.status === 'Booked' ? 'clock' : 'truck';
  }

  protected atRisk(s: Shipment): boolean {
    return s.status !== 'Delivered' && s.etaAt > s.slaAt;
  }
}
