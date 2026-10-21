import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, Routes, TitleStrategy } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing/landing').then((m) => m.LandingPage), title: 'Build the roads. Teach the cars.' },
  { path: 'city', loadComponent: () => import('./pages/city/city').then((m) => m.CityPage), title: 'City Lab' },
  { path: 'routes', loadComponent: () => import('./pages/routes/routes').then((m) => m.RoutesPage), title: 'Sea & Air Routes' },
  { path: 'ops', loadComponent: () => import('./pages/ops/ops').then((m) => m.OpsPage), title: '3D Ops' },
  { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage), title: 'Logistics Dashboard' },
  { path: 'depot', loadComponent: () => import('./pages/depot/depot').then((m) => m.DepotPage), title: 'The Depot' },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage), title: 'Settings' },
  { path: '**', loadComponent: () => import('./pages/not-found').then((m) => m.NotFoundPage), title: 'Lost in Transit' },
];

/** "City Lab · Terra" — accurate page titles for tabs, history and screen readers. */
@Injectable({ providedIn: 'root' })
export class TerraTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const t = this.buildTitle(snapshot);
    const home = snapshot.url === '/' || snapshot.url.startsWith('/?') || snapshot.url.startsWith('/#');
    this.title.setTitle(home ? `Terra — ${t ?? 'Logistics Sim'}` : `${t ?? 'Terra'} · Terra`);
  }
}
