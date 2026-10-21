import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fmt, formatCoins } from '../core/format';
import { GameService } from '../core/game.service';

@Component({
  selector: 'app-offline-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <dialog #dlg class="modal" aria-labelledby="away-title" (close)="game.dismissOffline()">
      @if (game.offlineReport(); as r) {
        <div class="body">
          <span class="caption-box">Meanwhile, back at the depot…</span>
          <h2 id="away-title" class="display">Your fleet kept<br />delivering.</h2>
          <div class="speech">
            You were away {{ away() }}. The fleet earned <strong class="tabular">{{ earned() }}</strong> coins.
          </div>
          <p class="subtle small">
            Offline pay runs at {{ pct(r.rate) }} for up to {{ r.capHours }}&nbsp;h. Upgrade Night Shift and the Warehouse Mezzanine in the Depot to earn more while you’re away.
          </p>
          <form method="dialog" class="row actions">
            <a class="btn" routerLink="/depot" (click)="dlg.close()">Open the Depot</a>
            <button class="btn btn--highlight" value="ok" autofocus>Collect {{ earned() }}</button>
          </form>
        </div>
      }
    </dialog>
  `,
  styles: `
    .body { display: grid; gap: 16px; padding: 24px; }
    h2 { font-size: clamp(34px, 6vw, 48px); }
    .speech { font-size: 17px; }
    .small { font-size: 13px; margin-top: 6px; }
    .actions { justify-content: flex-end; }
  `,
})
export class OfflineModal {
  protected readonly game = inject(GameService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly earned = computed(() => formatCoins(this.game.offlineReport()?.earned ?? 0));
  protected readonly away = computed(() => fmt.duration(this.game.offlineReport()?.seconds ?? 0));
  protected readonly pct = fmt.pct;

  constructor() {
    afterNextRender(() => {
      if (this.game.offlineReport()) setTimeout(() => this.dlg().nativeElement.showModal(), 600);
    });
  }
}
