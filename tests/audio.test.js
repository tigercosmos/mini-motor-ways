import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioFeedback, DestinationAnnouncements } from '../src/audio.js';

function fixture() {
  const oscillators = [];
  let resumes = 0;
  const context = {
    currentTime: 10, state: 'suspended', destination: {},
    resume() { resumes++; this.state = 'running'; return Promise.resolve(); },
    createOscillator() {
      const oscillator = { frequency: { setValueAtTime(value, time) { oscillator.frequencyValue = value; oscillator.frequencyTime = time; } }, connect() {}, disconnect() {}, start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } };
      oscillators.push(oscillator); return oscillator;
    },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
  };
  const sounds = new AudioFeedback({ createContext: () => context });
  return { sounds, oscillators, resumes: () => resumes };
}

test('new destinations use a scheduled three-note chime and mute stops pending notes', () => {
  const { sounds, oscillators, resumes } = fixture();
  assert.equal(sounds.unlock(), true); assert.equal(resumes(), 1);
  sounds.destinationOpened();
  assert.deepEqual(oscillators.map(osc => osc.frequencyValue), [523.25, 659.25, 783.99]);
  assert.deepEqual(oscillators.map(osc => osc.startTime), [10, 10.14, 10.28]);
  sounds.setEnabled(false);
  assert.ok(oscillators.every(osc => osc.stopTime === undefined));
  sounds.destinationOpened(); assert.equal(oscillators.length, 3);
  sounds.setEnabled(true); sounds.destinationOpened(); assert.equal(oscillators.length, 6);
});

test('announcements track new destination IDs, including repeated colors and shared lots', () => {
  const calls = [], tracker = new DestinationAnnouncements(added => calls.push(added.map(item => item.id)));
  const buildings = [{ id: 'd1', type: 'destination', color: 'teal' }];
  tracker.reset(buildings); tracker.update(buildings); assert.equal(calls.length, 0);
  buildings.push({ id: 'h1', type: 'home' }); tracker.update(buildings); assert.equal(calls.length, 0);
  buildings.push({ id: 'd2', type: 'destination', color: 'teal' }); tracker.update(buildings);
  buildings.push({ id: 'd3', type: 'destination', color: 'gold', parkingId: 'd2' }); tracker.update(buildings);
  tracker.update(buildings);
  assert.deepEqual(calls, [['d2'], ['d3']]);
  tracker.reset([{ id: 'd1', type: 'destination' }]); tracker.update([{ id: 'd1', type: 'destination' }]);
  assert.equal(calls.length, 2);
});

test('unsupported or blocked audio does not stop destination notifications', () => {
  const sound = new AudioFeedback({ createContext: () => { throw new Error('No audio'); } });
  assert.doesNotThrow(() => sound.destinationOpened());
});
