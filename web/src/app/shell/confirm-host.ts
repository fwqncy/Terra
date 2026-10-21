import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-confirm-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" aria-labelledby="confirm-title" aria-describedby="confirm-body" (close)="confirm.settle(dlg.returnValue === 'ok')">
      @if (confirm.request(); as r) {
        <form method="dialog" class="body">
          <h2 id="confirm-title">{{ r.title }}</h2>
          <p id="confirm-body" class="muted">{{ r.body }}</p>
          <div class="row actions">
            <button class="btn" value="cancel" autofocus>Cancel</button>
            <button class="btn" [class.btn--danger]="r.tone !== 'primary'" [class.btn--primary]="r.tone === 'primary'" value="ok">{{ r.confirmLabel }}</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .body { display: grid; gap: 12px; padding: 22px; }
    h2 { font-size: 22px; }
    .actions { justify-content: flex-end; margin-top: 8px; }
  `,
})
export class ConfirmHost {
  protected readonly confirm = inject(ConfirmService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      if (this.confirm.request() && !d.open) {
        d.returnValue = '';
        d.showModal();
      }
    });
  }
}
