import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';
import { GameService } from './core/game.service';
import { ThemeService } from './core/theme.service';
import { CommandPalette } from './shell/command-palette';
import { ConfirmHost } from './shell/confirm-host';
import { GoldenParcel } from './shell/golden-parcel';
import { OfflineModal } from './shell/offline-modal';
import { Toaster } from './shell/toaster';
import { TopBar } from './shell/top-bar';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, TopBar, Toaster, CommandPalette, OfflineModal, GoldenParcel, ConfirmHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Constructing these here starts theming, the idle loop and the API health check at boot.
  protected readonly theme = inject(ThemeService);
  protected readonly game = inject(GameService);
  protected readonly api = inject(ApiService);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  constructor() {
    const router = inject(Router);
    let lastPath = '';
    const sub = router.events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const path = e.urlAfterRedirects.split(/[?#]/)[0];
      // Move focus to the new page for keyboard and screen-reader users (not on tab/filter changes).
      if (lastPath && path !== lastPath) this.main().nativeElement.focus({ preventScroll: true });
      lastPath = path;
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  protected skipToContent(event: Event): void {
    event.preventDefault();
    const main = this.main().nativeElement;
    main.focus();
    main.scrollIntoView();
  }
}
