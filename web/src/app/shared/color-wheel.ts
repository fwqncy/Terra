import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, input, output, signal, viewChild,
} from '@angular/core';
import { hexToRgb, hsvToRgb, isHex, normalizeHex, rgbToHex, rgbToHsv } from '../core/color';

/**
 * HSV colour wheel: hue around the ring, saturation from the centre out, brightness on a slider.
 * Pointer drag or keyboard (←/→ hue, ↑/↓ saturation, Shift for bigger steps). Hex input accepts paste.
 */
@Component({
  selector: 'app-color-wheel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wheel-wrap">
      <canvas
        #wheel
        class="wheel"
        width="440"
        height="440"
        role="slider"
        tabindex="0"
        [attr.aria-label]="label() + ' hue and saturation'"
        aria-valuemin="0"
        aria-valuemax="359"
        [attr.aria-valuenow]="Math.round(h())"
        [attr.aria-valuetext]="'Hue ' + Math.round(h()) + ' degrees, saturation ' + Math.round(s() * 100) + ' percent'"
        (pointerdown)="onDown($event)"
        (keydown)="onKey($event)"
      ></canvas>
      <span class="knob" [style.left.%]="knob().x" [style.top.%]="knob().y" [style.background]="hex()" aria-hidden="true"></span>
    </div>
    <div class="field">
      <label [for]="id + '-v'">Brightness <output class="tabular">{{ Math.round(v() * 100) }}%</output></label>
      <input [id]="id + '-v'" type="range" min="0" max="100" [value]="Math.round(v() * 100)" (input)="setV(+$any($event.target).value / 100)" [style.--track]="trackGradient()" class="v-slider" />
    </div>
    <div class="field">
      <label [for]="id + '-hex'">Hex</label>
      <div class="hex-row">
        <span class="chip" [style.background]="hex()" aria-hidden="true"></span>
        <input
          [id]="id + '-hex'"
          class="input mono"
          type="text"
          inputmode="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="#35369C"
          [value]="draft()"
          (input)="onHexInput($any($event.target).value)"
          (blur)="draft.set(hex())"
          [attr.aria-invalid]="hexError() ? 'true' : null"
          [attr.aria-describedby]="hexError() ? id + '-err' : null"
        />
      </div>
      @if (hexError()) {
        <p class="error" [id]="id + '-err'" role="status">Use 3 or 6 hex digits, like #35369C.</p>
      }
    </div>
  `,
  styles: `
    :host { display: grid; gap: 14px; }
    .wheel-wrap { position: relative; width: min(100%, 260px); aspect-ratio: 1; justify-self: center; }
    .wheel { width: 100%; height: 100%; border-radius: 50%; cursor: crosshair; touch-action: none; box-shadow: 0 0 0 3px var(--ink-line), var(--comic-shadow); }
    .wheel:focus-visible { outline: 3px solid var(--focus); outline-offset: 6px; }
    .knob { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 2px #0c0a08, 0 2px 6px rgba(0,0,0,0.4); pointer-events: none; }
    .v-slider { appearance: none; height: 14px; border-radius: 999px; background: var(--track); border: 2px solid var(--ink-line); }
    .v-slider::-webkit-slider-thumb { appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 3px solid #0c0a08; }
    .v-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid #0c0a08; }
    .hex-row { display: flex; gap: 8px; align-items: center; }
    .chip { width: 40px; height: 40px; flex: none; border-radius: var(--r-2); border: 2px solid var(--ink-line); }
    .error { font-size: 13px; color: var(--status-critical); }
  `,
})
export class ColorWheel {
  readonly color = input('#35369C');
  readonly label = input('Colour');
  readonly colorChange = output<string>();
  protected readonly Math = Math;
  protected readonly id = `cw-${Math.random().toString(36).slice(2, 8)}`;
  private readonly wheel = viewChild.required<ElementRef<HTMLCanvasElement>>('wheel');

  protected readonly h = signal(240);
  protected readonly s = signal(0.5);
  protected readonly v = signal(0.6);
  protected readonly draft = signal('#35369C');
  protected readonly hexError = signal(false);
  protected readonly hex = computed(() => rgbToHex(hsvToRgb(this.h(), this.s(), this.v())));
  protected readonly knob = computed(() => {
    const a = (this.h() * Math.PI) / 180;
    return { x: 50 + Math.cos(a) * this.s() * 50, y: 50 + Math.sin(a) * this.s() * 50 };
  });
  protected readonly trackGradient = computed(() => `linear-gradient(90deg, #000, ${rgbToHex(hsvToRgb(this.h(), this.s(), 1))})`);
  private lastEmitted = '';
  private painted = false;

  constructor() {
    // external colour → internal HSV (ignore echoes of our own emissions)
    effect(() => {
      const c = this.color();
      if (!isHex(c) || normalizeHex(c) === this.lastEmitted) return;
      const [h, s, v] = rgbToHsv(hexToRgb(c));
      if (s > 0.001) this.h.set(h);
      this.s.set(s);
      this.v.set(v);
      this.draft.set(normalizeHex(c));
      this.hexError.set(false);
    });
    effect(() => {
      this.v();
      if (this.painted) this.paint();
    });
    afterNextRender(() => {
      this.painted = true;
      this.paint();
    });
  }

  private paint(): void {
    const canvas = this.wheel().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const r = size / 2;
    const img = ctx.createImageData(size, size);
    const v = this.v();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - r;
        const dy = y - r;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * size + x) * 4;
        if (d > 1) {
          img.data[i + 3] = 0;
          continue;
        }
        let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (hue < 0) hue += 360;
        const [R, G, B] = hsvToRgb(hue, d, v);
        img.data[i] = R;
        img.data[i + 1] = G;
        img.data[i + 2] = B;
        img.data[i + 3] = d > 0.985 ? Math.round(255 * (1 - d) / 0.015) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  protected onDown(e: PointerEvent): void {
    const canvas = this.wheel().nativeElement;
    canvas.setPointerCapture(e.pointerId);
    const pick = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dx = ev.clientX - rect.left - rect.width / 2;
      const dy = ev.clientY - rect.top - rect.height / 2;
      let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (hue < 0) hue += 360;
      this.h.set(hue);
      this.s.set(Math.min(1, Math.hypot(dx, dy) / (rect.width / 2)));
      if (this.v() < 0.08) this.v.set(0.5);
      this.emit();
    };
    pick(e);
    const move = (ev: PointerEvent) => pick(ev);
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  protected onKey(e: KeyboardEvent): void {
    const big = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') this.h.update((h) => (h + 3 * big) % 360);
    else if (e.key === 'ArrowLeft') this.h.update((h) => (h - 3 * big + 360) % 360);
    else if (e.key === 'ArrowUp') this.s.update((s) => Math.min(1, s + 0.02 * big));
    else if (e.key === 'ArrowDown') this.s.update((s) => Math.max(0, s - 0.02 * big));
    else return;
    e.preventDefault();
    this.emit();
  }

  protected setV(v: number): void {
    this.v.set(v);
    this.emit();
  }

  protected onHexInput(value: string): void {
    this.draft.set(value);
    if (!isHex(value)) {
      this.hexError.set(value.trim().length >= 4);
      return;
    }
    this.hexError.set(false);
    const [h, s, v] = rgbToHsv(hexToRgb(normalizeHex(value)));
    if (s > 0.001) this.h.set(h);
    this.s.set(s);
    this.v.set(v);
    this.emit(normalizeHex(value));
  }

  private emit(hex = this.hex()): void {
    this.lastEmitted = hex;
    if (document.activeElement?.id !== `${this.id}-hex`) this.draft.set(hex);
    this.colorChange.emit(hex);
  }
}
