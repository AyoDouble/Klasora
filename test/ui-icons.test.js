const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBrowserScript(filename, extra = {}) {
  const window = { ...(extra.window || {}) };
  const globals = { ...extra, window };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', filename), 'utf8'), globals);
  return window;
}

test('Iconify markup maps legacy glyphs and safely handles unknown names', () => {
  const { KlasoraIcons } = loadBrowserScript('icons.js');

  assert.equal(KlasoraIcons.resolve('🌙'), 'moon');
  assert.equal(KlasoraIcons.resolve('📚'), 'book-open');
  assert.equal(KlasoraIcons.resolve('👏'), 'hand');
  assert.equal(KlasoraIcons.resolve('🏀'), 'circle-dot');
  assert.match(KlasoraIcons.markup('sun', 'theme-sun'), /icon="lucide:sun"/);
  assert.match(KlasoraIcons.markup('bad name'), /icon="lucide:circle-help"/);
  assert.doesNotMatch(KlasoraIcons.markup('sun', 'theme-sun" onload="bad'), /onload=/);
});

test('timer sound prepares audio and schedules a short two-tone completion beep', async () => {
  const starts = [];
  const frequencies = [];
  const audioContext = {
    state: 'suspended',
    currentTime: 2,
    destination: {},
    async resume() { this.state = 'running'; },
    createOscillator() {
      const oscillator = {
        frequency: { set value(value) { frequencies.push(value); } },
        connect() {},
        start(time) { starts.push(time); },
        stop() {}
      };
      return oscillator;
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  };
  class MockAudioContext {
    constructor() { return audioContext; }
  }
  const { KlasoraTimerSound } = loadBrowserScript('timer-sound.js', { window: { AudioContext: MockAudioContext } });

  assert.equal(await KlasoraTimerSound.prepare(), true);
  assert.equal(await KlasoraTimerSound.beep(), true);
  assert.deepEqual(starts, [2, 2.24]);
  assert.deepEqual(frequencies, [660, 880]);
});

test('timer sound reports unsupported browsers without throwing', async () => {
  const { KlasoraTimerSound } = loadBrowserScript('timer-sound.js');
  assert.equal(await KlasoraTimerSound.prepare(), false);
  assert.equal(await KlasoraTimerSound.beep(), false);
});
