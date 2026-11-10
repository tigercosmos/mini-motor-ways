/** Audio is unlocked by a user gesture before simulation-driven notifications. */
export class AudioFeedback {
  constructor({ enabled = true, createContext = () => new (window.AudioContext || window.webkitAudioContext)() } = {}) {
    this.enabled = enabled;
    this.createContext = createContext;
    this.context = null;
    this.active = new Set();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.unlock();
    else {
      for (const oscillator of this.active) { try { oscillator.stop(); } catch { /* Already stopped. */ } }
      this.active.clear();
    }
  }

  unlock() {
    if (!this.enabled) return false;
    try {
      this.context ||= this.createContext();
      if (this.context.state === 'suspended') this.context.resume()?.catch(() => {});
      return true;
    } catch { return false; }
  }

  tone(frequency = 440, delay = 0, duration = 0.13) {
    if (!this.unlock()) return;
    const context = this.context;
    const oscillator = context.createOscillator(), gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.035, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => { this.active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    this.active.add(oscillator);
    oscillator.start(start); oscillator.stop(start + duration + 0.02);
  }

  destinationOpened() {
    for (const [index, frequency] of [523.25, 659.25, 783.99].entries()) this.tone(frequency, index * 0.14, 0.24);
  }
}

/** Track identities, not toast text: successive shops can have identical messages. */
export class DestinationAnnouncements {
  constructor(notify) { this.notify = notify; this.seen = new Set(); }
  reset(buildings) { this.seen = new Set(buildings.filter(item => item.type === 'destination').map(item => item.id)); }
  update(buildings) {
    const added = buildings.filter(item => item.type === 'destination' && !this.seen.has(item.id));
    this.reset(buildings);
    if (added.length) this.notify(added);
  }
}
