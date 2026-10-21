import { TestBed } from '@angular/core/testing';
import { BarChart } from './bar-chart';

describe('BarChart', () => {
  it('renders a legend for multiple series and a table view on request', async () => {
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('categories', ['09:00', '10:00']);
    fixture.componentRef.setInput('series', [
      { id: 'road', label: 'Road', color: '#2A78D6', values: [3, 5] },
      { id: 'air', label: 'Air', color: '#EB6834', values: [1, 0] },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.legend li').length).toBe(2);
    expect(el.querySelectorAll('g.col').length).toBe(2);
    (el.querySelector('.table-toggle') as HTMLButtonElement).click();
    await fixture.whenStable();
    const cells = [...el.querySelectorAll('tbody td')].map((td) => td.textContent?.trim());
    expect(cells).toEqual(['3', '1', '5', '0']);
  });
});
