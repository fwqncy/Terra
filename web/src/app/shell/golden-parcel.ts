import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameService } from '../core/game.service';
import { ThemeService } from '../core/theme.service';

/** The "golden cookie": a priority parcel drone that crosses the screen now and then. */
@Component({
  selector: 'app-golden-parcel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (game.golden(); as g) {
      <button
        type="button"
        class="parcel"
        [class.static]="theme.reducedMotion()"
        [style.top.%]="g.top"
        (click)="game.catchGolden()"
        aria-label="Catch the priority parcel for a bonus"
        aria-describedby="parcel-tip"
      >
        <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">
          <g stroke="#0c0a08" stroke-width="2.5" stroke-linejoin="round">
            <path d="M8 10h48" />
            <circle cx="12" cy="10" r="5" fill="#fff" />
            <circle cx="52" cy="10" r="5" fill="#fff" />
            <path d="M32 10v8" />
            <path d="M18 18h28l4 8v18H14V26l4-8Z" fill="#F2C14E" />
            <path d="M14 26h36M32 18v26" />
          </g>
        </svg>
        <span class="tag">Priority!</span>
      </button>
      <span id="parcel-tip" class="sr-only">Gives a seven-times earnings surge or a lucky lump sum.</span>
    }
  `,
  styles: `
    .parcel {
      position: fixed;
      left: -90px;
      z-index: 800;
      display: grid;
      justify-items: center;
      padding: 6px;
      border: 0;
      background: none;
      cursor: pointer;
      animation: fly 13s linear forwards, bob 0.8s ease-in-out infinite alternate;
    }
    .parcel.static { left: 20px; top: auto !important; bottom: 90px; animation: none; }
    .tag {
      margin-top: -2px;
      padding: 2px 8px;
      border: 2px solid #0c0a08;
      border-radius: 6px;
      background: #fff;
      color: #111;
      font-family: var(--font-comic);
      font-size: 15px;
      letter-spacing: 0.05em;
    }
    .parcel:hover svg, .parcel:focus-visible svg { transform: scale(1.12) rotate(-6deg); }
    svg { transition: transform 160ms var(--ease-spring); }
    @keyframes fly { to { left: calc(100vw + 90px); } }
    @keyframes bob { to { translate: 0 -10px; } }
  `,
})
export class GoldenParcel {
  protected readonly game = inject(GameService);
  protected readonly theme = inject(ThemeService);
}
