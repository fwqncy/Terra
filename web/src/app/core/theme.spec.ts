import { apca } from './color';
import { PRESETS, deriveTokens, harmonize } from './theme.service';

const TARGETS: [string, string, number][] = [
  ['--text', '--bg', 75],
  ['--text-2', '--bg', 60],
  ['--text-3', '--bg', 45],
  ['--link', '--bg', 60],
  ['--on-brand', '--brand', 60],
  ['--on-highlight', '--highlight', 60],
];

describe('theme tokens', () => {
  for (const preset of PRESETS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${preset.name} (${mode}) meets APCA targets`, () => {
        const t = deriveTokens(preset.swatches, mode);
        for (const [fg, bg, min] of TARGETS) {
          expect(Math.abs(apca(t[fg], t[bg])), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
        }
      });
    }
  }

  it('keeps Nightshift as the default palette from the brief', () => {
    expect(PRESETS[0].swatches).toEqual({ ink: '#24201A', deep: '#3F2548', primary: '#35369C', accent: '#7C679E', light: '#C8C793' });
  });

  it('generates readable themes from any single colour', () => {
    for (const base of ['#FF0000', '#00FF88', '#123456', '#FFFF00']) {
      for (const harmony of ['duotone', 'analogous', 'triadic', 'mono'] as const) {
        const t = deriveTokens(harmonize(base, harmony), 'dark');
        expect(Math.abs(apca(t['--text'], t['--bg']))).toBeGreaterThanOrEqual(75);
      }
    }
  });

  it('uses the validated chart series, not theme colours', () => {
    expect(deriveTokens(PRESETS[1].swatches, 'dark')['--series-road']).toBe('#3987E5');
    expect(deriveTokens(PRESETS[2].swatches, 'light')['--series-sea']).toBe('#1BAF7A');
  });
});
