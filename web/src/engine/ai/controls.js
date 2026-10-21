/**
 * Control sources: KEYS (human), AI (network outputs), DUMMY (cruise forward).
 * KEYS listeners attach to a target and must be disposed when a view unmounts.
 */
export class Controls {
  /** @param {'KEYS'|'AI'|'DUMMY'} type */
  constructor(type, target = typeof window !== 'undefined' ? window : null) {
    this.type = type;
    this.forward = false;
    this.left = false;
    this.right = false;
    this.reverse = false;
    this.target = target;
    if (type === 'DUMMY') this.forward = true;
    if (type === 'KEYS' && target) {
      this.onDown = (e) => this.#set(e, true);
      this.onUp = (e) => this.#set(e, false);
      target.addEventListener('keydown', this.onDown);
      target.addEventListener('keyup', this.onUp);
    }
  }

  #set(event, value) {
    const el = event.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    // event.code is layout-independent, so WASD works on AZERTY/Dvorak via physical keys.
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.left = value;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.right = value;
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.forward = value;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.reverse = value;
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  dispose() {
    if (this.onDown && this.target) {
      this.target.removeEventListener('keydown', this.onDown);
      this.target.removeEventListener('keyup', this.onUp);
    }
  }
}
