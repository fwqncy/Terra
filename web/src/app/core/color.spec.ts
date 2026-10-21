import { apca, contrast, ensureApca, ensureContrast, fillForText, hexToRgb, hsvToRgb, isHex, mix, normalizeHex, rgbToHex, rgbToHsv } from './color';

describe('colour maths', () => {
  it('round-trips hex ⇄ rgb ⇄ hsv', () => {
    expect(rgbToHex(hexToRgb('#35369c'))).toBe('#35369C');
    const [h, s, v] = rgbToHsv(hexToRgb('#35369C'));
    expect(rgbToHex(hsvToRgb(h, s, v))).toBe('#35369C');
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(isHex('#12345')).toBe(false);
  });

  it('mixes colours linearly', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('computes WCAG contrast and APCA Lc like the references', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(apca('#000000', '#FFFFFF')).toBeCloseTo(106, 0);
    expect(apca('#FFFFFF', '#000000')).toBeCloseTo(-107.9, 0);
    expect(apca('#888888', '#FFFFFF')).toBeCloseTo(63.1, 0);
  });

  it('nudges colours until they are readable', () => {
    expect(contrast(ensureContrast('#777777', '#808080', 4.5), '#808080')).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(apca(ensureApca('#C8C793', '#C8C793', 60), '#C8C793'))).toBeGreaterThanOrEqual(60);
    // when a target is unreachable, the best possible extreme is returned
    expect(ensureApca('#C8C793', '#C8C793', 75)).toBe('#000000');
    expect(Math.abs(apca('#FFFFFF', fillForText('#E0569B', '#FFFFFF', 60)))).toBeGreaterThanOrEqual(60);
  });
});
