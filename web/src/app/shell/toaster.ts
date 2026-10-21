import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-toaster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <section class="region" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [attr.data-tone]="t.tone" role="status" (pointerenter)="toasts.pause(t.id)" (pointerleave)="toasts.resume(t.id)" (focusin)="toasts.pause(t.id)" (focusout)="toasts.resume(t.id)">
          <span class="glyph"><app-icon [name]="icon(t.tone)" [size]="18" /></span>
          <div class="text">
            <strong>{{ t.title }}</strong>
            @if (t.body) {
              <p>{{ t.body }}</p>
            }
          </div>
          @if (t.action) {
            <button class="btn btn--sm" type="button" (click)="t.action.run(); toasts.dismiss(t.id)">{{ t.action.label }}</button>
          }
          <button class="btn btn--ghost btn--icon btn--sm close" type="button" aria-label="Dismiss notification" (click)="toasts.dismiss(t.id)">
            <app-icon name="x" [size]="16" />
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    .region {
      position: fixed;
      z-index: 900;
      right: max(16px, env(safe-area-inset-right));
      bottom: max(16px, env(safe-area-inset-bottom));
      display: grid;
      gap: 10px;
      width: min(380px, calc(100vw - 32px));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: start;
      gap: 10px;
      padding: 12px 10px 12px 12px;
      border-radius: var(--r-3);
      background: var(--surface);
      border: 2px solid var(--ink-line);
      box-shadow: var(--comic-shadow), var(--elev-2);
      animation: toast-in 260ms var(--ease-spring);
    }
    .glyph {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: var(--surface-3);
      color: var(--text);
    }
    [data-tone='good'] .glyph { background: color-mix(in srgb, var(--status-good) 28%, var(--surface)); }
    [data-tone='warning'] .glyph { background: color-mix(in srgb, var(--status-warning) 35%, var(--surface)); }
    [data-tone='critical'] .glyph { background: color-mix(in srgb, var(--status-critical) 35%, var(--surface)); }
    [data-tone='coin'] .glyph { background: var(--highlight); color: var(--on-highlight); }
    strong { display: block; font-size: 14px; line-height: 1.3; }
    p { font-size: 13px; color: var(--text-2); margin-top: 2px; }
    .close { margin-top: -4px; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(10px) scale(0.96); } }
  `,
})
export class Toaster {
  protected readonly toasts = inject(ToastService);

  protected icon(tone: string): string {
    return tone === 'good' ? 'check' : tone === 'warning' || tone === 'critical' ? 'alert' : tone === 'coin' ? 'coin' : 'info';
  }
}
