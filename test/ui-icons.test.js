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
  assert.equal(KlasoraIcons.resolve('⚠️'), 'triangle-alert');
  assert.equal(KlasoraIcons.resolve('✅'), 'circle-check');
  assert.equal(KlasoraIcons.resolve('❌'), 'circle-x');
  assert.equal(KlasoraIcons.resolve('📵'), 'phone-off');
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
  assert.equal(audioContext.state, 'running');
  assert.equal(await KlasoraTimerSound.beep(), true);
  assert.deepEqual(starts, [2, 2.24]);
  assert.deepEqual(frequencies, [660, 880]);
});

test('timer sound reports unsupported browsers without throwing', async () => {
  const { KlasoraTimerSound } = loadBrowserScript('timer-sound.js');
  assert.equal(await KlasoraTimerSound.prepare(), false);
  assert.equal(await KlasoraTimerSound.beep(), false);
});

test('deadline-based timer stays accurate when interval ticks are delayed', () => {
  const { KlasoraTimerClock } = loadBrowserScript('timer-clock.js');
  const startedAt = 1_000_000;
  const deadline = KlasoraTimerClock.deadlineAfter(25, startedAt);

  assert.equal(KlasoraTimerClock.remainingSeconds(deadline, startedAt), 25);
  assert.equal(KlasoraTimerClock.remainingSeconds(deadline, startedAt + 1_001), 24);
  assert.equal(KlasoraTimerClock.remainingSeconds(deadline, startedAt + 2_001), 23);
  assert.equal(KlasoraTimerClock.remainingSeconds(deadline, startedAt + 24_999), 1);
  assert.equal(KlasoraTimerClock.remainingSeconds(deadline, startedAt + 25_000), 0);
  assert.equal(KlasoraTimerClock.formatClock(3600), '01:00:00');
  assert.equal(KlasoraTimerClock.formatClock(5), '00:05');
});

test('manual timer accepts seconds and hour-long durations and rejects invalid values', () => {
  const { KlasoraTimerClock } = loadBrowserScript('timer-clock.js');
  const now = 1_000_000;

  assert.equal(KlasoraTimerClock.durationSeconds({ hours: 0, minutes: 0, seconds: 5 }, now), 5);
  assert.equal(KlasoraTimerClock.durationSeconds({ hours: 1, minutes: 0, seconds: 0 }, now), 3600);
  assert.equal(KlasoraTimerClock.durationSeconds({ hours: 0, minutes: 0, seconds: 0 }, now), null);
  assert.equal(KlasoraTimerClock.durationSeconds({ hours: 0, minutes: 60, seconds: 0 }, now), null);
  assert.equal(KlasoraTimerClock.durationSeconds({ hours: 0, minutes: 0, seconds: -1 }, now), null);
  assert.equal(KlasoraTimerClock.durationSeconds({ hours: 0, minutes: 1.5, seconds: 0 }, now), null);
  assert.equal(KlasoraTimerClock.durationSeconds({ hours: Number.MAX_SAFE_INTEGER, minutes: 0, seconds: 0 }, now), null);
});

test('all refreshed navigation uses Klasora icons and the focus timer survives navigation', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'ui-refresh.js'), 'utf8');
  const legacy = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const setRoute = ui.match(/function setRoute\(route\)\s*\{[\s\S]*?\n  \}/)?.[0];
  const tickTimer = ui.match(/function tickTimer\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  const completeTimer = ui.match(/async function completeTimer\(\)\s*\{[\s\S]*?\n  \}/)?.[0];

  assert.match(ui, /<nav class="refresh-mobile-menu"[\s\S]*?iconMarkup\(item\.icon\)/);
  assert.match(ui, /function manualTimerControls\(\)/);
  assert.match(ui, /data-action="set-manual-timer"/);
  assert.match(ui, /durationSeconds\(\{/);
  assert.ok(setRoute, 'setRoute must remain available in the refreshed app');
  assert.doesNotMatch(setRoute, /pauseTimer\(/);
  assert.ok(tickTimer, 'tickTimer must remain available in the refreshed app');
  assert.match(ui, /remainingSeconds\(state\.timer\.endAt\)/);
  assert.doesNotMatch(tickTimer, /\.beep/);
  assert.match(ui, /document\.addEventListener\('visibilitychange'/);
  assert.ok(completeTimer, 'completeTimer must remain available in the refreshed app');
  assert.match(completeTimer, /completionStarted/);
  assert.match(completeTimer, /KlasoraTimerSound\?\.beep/);
  assert.match(legacy, /remainingSeconds\(pomState\.endAt\)/);
  assert.match(legacy, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(pomState\.running\)tickPom\(\);\}\)/);
  assert.match(legacy, /deadlineAfter\(pomState\.secs\)/);
});
