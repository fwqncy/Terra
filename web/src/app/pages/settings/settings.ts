import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { fmt, isMac } from '../../core/format';
import { Harmony, PRESETS, SWATCH_LABELS, SwatchKey, ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { ColorWheel } from '../../shared/color-wheel';
import { ConfirmService } from '../../shared/confirm.service';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, ColorWheel],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly presets = PRESETS;
  protected readonly swatchKeys = Object.keys(SWATCH_LABELS) as SwatchKey[];
  protected readonly swatchLabels = SWATCH_LABELS;
  protected readonly fmt = fmt;
  protected readonly mod = isMac() ? '⌘' : 'Ctrl';
  protected readonly slot = signal<SwatchKey>('primary');
  protected readonly harmony = signal<Harmony>('duotone');
  protected readonly testing = signal(false);
  protected readonly apiDraft = signal(this.api.base());

  protected readonly current = computed(() => this.theme.swatches()[this.slot()]);
  protected readonly harmonies: { id: Harmony; label: string }[] = [
    { id: 'duotone', label: 'Duotone (like Nightshift)' },
    { id: 'analogous', label: 'Analogous' },
    { id: 'triadic', label: 'Triadic' },
    { id: 'mono', label: 'Monochrome' },
  ];
  protected readonly shortcuts = [
    { keys: [this.mod, 'K'], what: 'Command palette' },
    { keys: ['R'], what: 'Roads tool (City Lab)' },
    { keys: ['S', 'T'], what: 'Start / Target markings' },
    { keys: ['H'], what: 'Pan tool' },
    { keys: ['Space'], what: 'Hold and drag to pan any map' },
    { keys: ['+', '−'], what: 'Zoom (map focused)' },
    { keys: ['0'], what: 'Fit the route in view' },
    { keys: ['Esc'], what: 'Stop connecting roads / close dialogs' },
    { keys: ['Delete'], what: 'Remove the selected intersection' },
    { keys: ['←', '→'], what: 'Step through chart points' },
  ];

  protected onWheel(hex: string): void {
    this.theme.setSwatch(this.slot(), hex);
  }

  protected generate(): void {
    this.theme.generate(this.current(), this.harmony());
    this.toasts.push({ title: 'Palette generated', body: `A ${this.harmony()} palette built around ${this.current()}.`, tone: 'good' });
  }

  protected async resetTheme(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Reset appearance?', body: 'Back to the Nightshift preset in dark mode, with halftone dots on.', confirmLabel: 'Reset Appearance', tone: 'primary' });
    if (!ok) return;
    this.theme.setPreset('nightshift');
    this.theme.modePref.set('dark');
    this.theme.halftone.set(true);
    this.theme.motionPref.set('system');
  }

  protected async testApi(): Promise<void> {
    this.testing.set(true);
    const started = Date.now();
    this.api.setBase(this.apiDraft());
    const ok = await this.api.ping();
    // minimum visible loading time avoids a flash
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
    this.testing.set(false);
    this.toasts.push(
      ok
        ? { title: 'API connected', body: `SQL ${this.api.health()?.sql ? 'online' : 'offline'} · NoSQL ${this.api.health()?.nosql ? 'online' : 'offline'}`, tone: 'good' }
        : { title: 'Couldn’t reach the API', body: `Check that it’s running at ${this.api.base()} (try “npm run api” or docker compose up).`, tone: 'warning' },
    );
  }
}
