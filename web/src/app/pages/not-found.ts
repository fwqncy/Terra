import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="page wrap">
      <span class="burst" aria-hidden="true">WRONG TURN!</span>
      <h1 class="display">Lost in transit.</h1>
      <p class="lede">This page took a detour off the M1. The depot is still where you left it.</p>
      <div class="row">
        <a class="btn btn--primary" routerLink="/">Back to the Map</a>
        <a class="btn" routerLink="/dashboard">Open the Dashboard</a>
      </div>
    </section>
  `,
  styles: `
    .wrap { display: grid; justify-items: start; gap: 18px; padding-block: 12vh; }
    h1 { font-size: clamp(48px, 9vw, 120px); }
  `,
})
export class NotFoundPage {}
