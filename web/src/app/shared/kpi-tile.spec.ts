import { TestBed } from '@angular/core/testing';
import { KpiTile } from './kpi-tile';

describe('KpiTile', () => {
  it('shows the value, a signed delta and a status with a text label', async () => {
    const fixture = TestBed.createComponent(KpiTile);
    fixture.componentRef.setInput('label', 'On-time delivery');
    fixture.componentRef.setInput('value', '95.3%');
    fixture.componentRef.setInput('change', { value: -0.019, text: '−1.9 pts vs previous 24 h', upIsGood: true });
    fixture.componentRef.setInput('status', 'warning');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('95.3%');
    expect(el.querySelector('.delta.bad')?.textContent).toContain('−1.9 pts');
    // status is never colour-only
    expect(el.querySelector('.badge')?.textContent).toContain('Watch');
  });
});
