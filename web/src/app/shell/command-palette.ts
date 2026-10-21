import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { isMac } from '../core/format';
import { GameService } from '../core/game.service';
import { PRESETS, ThemeService } from '../core/theme.service';
import { Icon } from '../shared/icon';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: string;
  hint?: string;
  run: () => void;
}

/** ⌘K / Ctrl+K palette — an ARIA combobox over every navigation and quick action. */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <dialog #dlg class="modal palette" aria-label="Command palette" (close)="query.set('')" (click)="$event.target === dlg && dlg.close()">
      <div class="search">
        <app-icon name="command" />
        <input
          #input
          class="input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-autocomplete="list"
          [attr.aria-activedescendant]="results().length ? 'cmd-' + results()[active()].id : null"
          placeholder="Type a command or page…"
          autocomplete="off"
          spellcheck="false"
          [value]="query()"
          (input)="query.set(input.value); active.set(0)"
          (keydown)="onKey($event)"
        />
        <kbd>Esc</kbd>
      </div>
      <ul id="cmd-list" role="listbox" aria-label="Commands">
        @for (c of results(); track c.id; let i = $index) {
          @if (i === 0 || results()[i - 1].group !== c.group) {
            <li class="group" role="presentation">{{ c.group }}</li>
          }
          <li [id]="'cmd-' + c.id" role="option" [attr.aria-selected]="i === active()" (pointermove)="active.set(i)" (click)="run(c)">
            <app-icon [name]="c.icon" />
            <span>{{ c.label }}</span>
            @if (c.hint) {
              <span class="hint">{{ c.hint }}</span>
            }
          </li>
        } @empty {
          <li class="none" role="presentation">No commands match “{{ query() }}”. Try “city”, “dark” or “dashboard”.</li>
        }
      </ul>
      <footer class="foot"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>↵</kbd> to run · {{ shortcut }} to toggle</footer>
    </dialog>
  `,
  styles: `
    .palette { width: min(620px, calc(100vw - 24px)); margin-top: 12vh; }
    .search { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 2px solid var(--border); }
    .search .input { border: 0; background: transparent; box-shadow: none; padding: 6px 0; font-size: 17px; }
    ul { list-style: none; margin: 0; padding: 8px; max-height: min(420px, 55dvh); overflow: auto; overscroll-behavior: contain; }
    li[role='option'] { display: flex; align-items: center; gap: 12px; min-height: 42px; padding: 0 12px; border-radius: var(--r-2); cursor: pointer; font-weight: 650; }
    li[aria-selected='true'] { background: var(--highlight); color: var(--on-highlight); }
    .group { padding: 10px 12px 4px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
    .hint { margin-left: auto; font-size: 12px; opacity: 0.7; }
    .none { padding: 18px 12px; color: var(--text-2); }
    .foot { display: flex; gap: 6px; align-items: center; padding: 10px 14px; border-top: 2px solid var(--border); font-size: 12px; color: var(--text-3); }
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly game = inject(GameService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly shortcut = isMac() ? '⌘K' : 'Ctrl+K';

  private readonly commands: Command[] = [
    { id: 'home', label: 'Home', group: 'Go to', icon: 'globe', run: () => this.go('/') },
    { id: 'city', label: 'City Lab: build roads & train cars', group: 'Go to', icon: 'road', run: () => this.go('/city') },
    { id: 'motorway', label: 'M1 Motorway trainer', group: 'Go to', icon: 'fast', run: () => this.go('/city', { mode: 'motorway' }) },
    { id: 'sea', label: 'Sea routes: Moreton Bay & the Pacific', group: 'Go to', icon: 'ship', run: () => this.go('/routes', { domain: 'sea' }) },
    { id: 'air', label: 'Air routes: Brisbane to the islands', group: 'Go to', icon: 'plane', run: () => this.go('/routes', { domain: 'air' }) },
    { id: 'ops', label: '3D Ops: warehouse, airport & seaport', group: 'Go to', icon: 'ops', run: () => this.go('/ops') },
    { id: 'dash', label: 'Logistics dashboard', group: 'Go to', icon: 'chart', run: () => this.go('/dashboard') },
    { id: 'shipments', label: 'Shipments table', group: 'Go to', icon: 'table', run: () => this.go('/dashboard', { tab: 'shipments' }) },
    { id: 'ai', label: 'AI Lab metrics', group: 'Go to', icon: 'brain', run: () => this.go('/dashboard', { tab: 'ai' }) },
    { id: 'depot', label: 'Depot: upgrades & cosmetics', group: 'Go to', icon: 'depot', run: () => this.go('/depot') },
    { id: 'settings', label: 'Settings & colour wheel', group: 'Go to', icon: 'settings', run: () => this.go('/settings') },
    { id: 'mode', label: 'Toggle light / dark mode', group: 'Appearance', icon: 'moon', run: () => this.theme.toggleMode() },
    { id: 'halftone', label: 'Toggle halftone dots', group: 'Appearance', icon: 'sparkle', run: () => this.theme.halftone.update((v) => !v) },
    ...PRESETS.map((p) => ({ id: `preset-${p.id}`, label: `Theme: ${p.name}`, group: 'Appearance', icon: 'palette', run: () => this.theme.setPreset(p.id) })),
    { id: 'dispatch', label: 'Dispatch a parcel (+coins)', group: 'Depot', icon: 'coin', hint: 'click', run: () => this.game.click() },
    { id: 'buy-van', label: 'Buy a Delivery Van', group: 'Depot', icon: 'truck', run: () => this.game.buyGenerator('van') },
  ];

  protected readonly results = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.commands;
    const words = q.split(/\s+/);
    return this.commands.filter((c) => words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w)));
  });

  open(): void {
    const d = this.dlg().nativeElement;
    if (!d.open) {
      d.showModal();
      queueMicrotask(() => this.input().nativeElement.focus());
    }
  }

  protected onGlobalKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const d = this.dlg().nativeElement;
      if (d.open) d.close();
      else this.open();
    }
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.update((i) => (n ? (i + 1) % n : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.update((i) => (n ? (i - 1 + n) % n : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = this.results()[this.active()];
      if (c) this.run(c);
    }
  }

  protected run(c: Command): void {
    this.dlg().nativeElement.close();
    c.run();
  }

  private go(path: string, queryParams?: Record<string, string>): void {
    void this.router.navigate([path], { queryParams });
  }
}
