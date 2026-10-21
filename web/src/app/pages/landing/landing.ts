import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, CmsPost } from '../../core/api.service';
import { IslandHandle, loadGsap, loadIsland, webglAvailable } from '../../core/cdn';
import { fmt, formatCoins } from '../../core/format';
import { GameService } from '../../core/game.service';
import { LogisticsService } from '../../core/logistics.service';
import { ThemeService } from '../../core/theme.service';
import { Icon } from '../../shared/icon';
import { MiniMotorway } from '../../shared/mini-motorway';

const FALLBACK_POSTS: CmsPost[] = [
  { id: 'f1', issue: 3, title: 'Ships learn the North-West Channel', excerpt: 'Container ships now leave Moreton Bay without kissing Bribie Island. Mostly.', date: '2026-10-14', link: '/routes?domain=sea' },
  { id: 'f2', issue: 2, title: 'Storm cells added to the Coral Sea', excerpt: 'Freighters to Nadi and Honiara have to fly around drifting cyclones now.', date: '2026-10-07', link: '/routes?domain=air' },
  { id: 'f3', issue: 1, title: 'The Brisbane CBD is open for traffic', excerpt: 'Real streets from OpenStreetMap, ready for your self-driving utes to learn.', date: '2026-09-30', link: '/city' },
];

const STACK = [
  { name: 'Angular 22', role: 'App shell, signals, zoneless change detection' },
  { name: 'Plain JavaScript engine', role: 'Road graphs, neural nets, genetic training' },
  { name: 'three.js + React Three Fiber', role: '3D hero & ops islands via CDN import map' },
  { name: 'GSAP + ScrollTrigger', role: 'Scroll-driven camera and reveals' },
  { name: 'C# / .NET 8 API', role: 'Minimal APIs, OpenAPI, background simulation' },
  { name: 'SQL Server', role: 'Players, saves, shipments, leaderboard (EF Core)' },
  { name: 'NoSQL (Cosmos DB · MongoDB)', role: 'Trained brains, worlds, telemetry documents' },
  { name: 'PHP + WordPress', role: 'Headless CMS for Dispatches + leaderboard plugin' },
  { name: 'Azure Functions', role: 'Serverless offline settlement & telemetry ingest' },
  { name: 'Power Platform', role: 'Custom connector + Power Automate delay alerts' },
  { name: 'Docker', role: 'One-command local stack with Compose' },
  { name: 'GitHub Actions', role: 'Test → build → deploy pipeline' },
  { name: 'Terraform', role: 'Azure infrastructure as code' },
  { name: 'Playwright', role: 'End-to-end and accessibility checks' },
];

const FAQ = [
  { q: 'Do the cars actually learn, or is it scripted?', a: 'They learn. Each car has a small neural network fed by ray sensors and a route bearing. The best driver of every generation is copied and mutated. Nothing is hard-coded about where the roads go.' },
  { q: 'Is that really Brisbane?', a: 'Yes. Street networks come from OpenStreetMap, and the coastline from Natural Earth. The Brisbane CBD, Moreton Bay and the islands to the Pacific are real geography, simplified for speed.' },
  { q: 'What happens when I close the tab?', a: 'Your fleet keeps earning offline, at half rate for two hours by default. Upgrades in the Depot raise both. Saves live in your browser and sync to the API when it is running.' },
  { q: 'Do I need the backend?', a: 'No. Everything runs in your browser. Start the .NET API (or the Docker stack) to add SQL Server saves, a NoSQL brain library, a leaderboard and the WordPress Dispatches.' },
];

@Component({
  selector: 'app-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, MiniMotorway],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class LandingPage {
  protected readonly theme = inject(ThemeService);
  protected readonly game = inject(GameService);
  private readonly api = inject(ApiService);
  private readonly logistics = inject(LogisticsService);

  private readonly heroStage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly heroCanvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly heroSection = viewChild.required<ElementRef<HTMLElement>>('heroSection');

  protected readonly webgl = signal(true);
  protected readonly ready = signal(false);
  protected readonly chapter = signal(0);
  protected readonly tickerPaused = signal(false);
  protected readonly posts = signal<CmsPost[]>(FALLBACK_POSTS);
  protected readonly postsSource = signal<'local' | 'wordpress'>('local');
  protected readonly stack = STACK;
  protected readonly faq = FAQ;
  protected readonly fmt = fmt;

  protected readonly snap = this.logistics.snapshot;
  protected readonly ticker = computed(() => {
    const k = this.snap().kpis;
    return [
      { label: 'On-time delivery', value: fmt.pct(k.otd) },
      { label: 'In transit', value: fmt.whole(k.inTransit) },
      { label: 'Delivered (24 h)', value: fmt.whole(k.delivered24h) },
      { label: 'Delayed', value: fmt.whole(k.delayed) },
      { label: 'CO₂ (24 h)', value: fmt.kg(k.co2Kg24h) },
      { label: 'Revenue (24 h)', value: fmt.aud(k.revenue24h) },
      { label: 'Your coins', value: formatCoins(this.game.state().coins) },
    ];
  });

  protected readonly chapters = [
    { n: 'Ch. 1', title: 'The City', body: 'Draw roads over real Brisbane streets, drop a Start and a Target, and release eighty utes with brand-new brains. Most crash. The best one teaches the rest.' },
    { n: 'Ch. 2', title: 'The Bay', body: 'Chart sea lanes out of Moreton Bay. Container ships learn the North-West Channel, then sail on to Nouméa, Suva and Auckland.' },
    { n: 'Ch. 3', title: 'The Skies', body: 'Freighters leave BNE for Port Vila, Honiara and Nadi, dodging drifting storm cells and the odd cyclone.' },
    { n: 'Ch. 4', title: 'The Map', body: 'Step back and run the network: live dashboards, a 3D ops floor and a depot that keeps earning while you sleep.' },
  ];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const detach = this.logistics.attach();
    destroyRef.onDestroy(detach);
    void this.loadPosts();

    let island: IslandHandle | null = null;
    let disposed = false;
    effect(() => {
      // re-theme the 3D scene live
      island?.update({ palette: this.theme.palette(), reducedMotion: this.theme.reducedMotion(), halftone: this.theme.halftone() });
    });

    afterNextRender(async () => {
      if (!webglAvailable()) {
        this.webgl.set(false);
        return;
      }
      const section = this.heroSection().nativeElement;
      const onPointer = (e: PointerEvent) => {
        island?.update({ pointer: { x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 } });
      };
      try {
        const mod = await loadIsland('hero');
        if (disposed) return;
        island = mod.mount(this.heroCanvas().nativeElement, {
          palette: this.theme.palette(),
          reducedMotion: this.theme.reducedMotion(),
          halftone: this.theme.halftone(),
          progress: 0,
          onReady: () => this.ready.set(true),
        });
        window.addEventListener('pointermove', onPointer, { passive: true });
        const io = new IntersectionObserver(([e]) => island?.update({ paused: !e.isIntersecting }));
        io.observe(this.heroStage().nativeElement);
        destroyRef.onDestroy(() => io.disconnect());
      } catch {
        this.webgl.set(false);
      }

      try {
        const { gsap, ScrollTrigger } = await loadGsap();
        if (disposed) return;
        const ctx = gsap.context(() => {
          ScrollTrigger.create({
            trigger: section,
            start: 'top top',
            end: 'bottom bottom',
            scrub: this.theme.reducedMotion() ? false : 0.6,
            onUpdate: (self: { progress: number }) => {
              const reduced = this.theme.reducedMotion();
              // Reduced motion cuts between shots like comic panels instead of flying.
              const p = reduced ? Math.round(self.progress * 4) / 4 : self.progress;
              island?.update({ progress: p });
              this.chapter.set(Math.min(3, Math.floor(self.progress * 4.2)));
            },
          });
          if (!this.theme.reducedMotion()) {
            gsap.from('.hero-copy .word', { yPercent: 110, opacity: 0, rotate: 4, duration: 0.9, ease: 'power4.out', stagger: 0.06, delay: 0.1 });
            gsap.from('.hero-copy .fade', { y: 18, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08, delay: 0.5 });
            for (const el of gsap.utils.toArray('.reveal') as HTMLElement[]) {
              gsap.from(el, { y: 36, opacity: 0, rotate: el.dataset['tilt'] ? Number(el.dataset['tilt']) : 0, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
            }
          }
        });
        destroyRef.onDestroy(() => ctx.revert());
      } catch {
        /* CDN blocked: the page is fully readable without motion */
      }
      destroyRef.onDestroy(() => window.removeEventListener('pointermove', onPointer));
    });

    destroyRef.onDestroy(() => {
      disposed = true;
      island?.unmount();
    });
  }

  private async loadPosts(): Promise<void> {
    try {
      const posts = await this.api.get<CmsPost[]>('/cms/posts', 3000);
      if (Array.isArray(posts) && posts.length) {
        this.posts.set(posts.slice(0, 3));
        this.postsSource.set('wordpress');
      }
    } catch {
      /* keep the built-in dispatches */
    }
  }

  protected isInternal(link: string): boolean {
    return link.startsWith('/');
  }
}
