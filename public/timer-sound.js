(() => {
  let audioContext;
  let alarmInterval = null;
  let alarmStartPromise = null;
  let alarmToken = 0;
  const alarmOscillators = new Set();

  function getAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioContext) audioContext = new AudioContext();
    return audioContext;
  }

  async function prepare() {
    const context = getAudioContext();
    if (context?.state === 'suspended') await context.resume();
    return context?.state === 'running';
  }

  function playAlarmPattern(context) {
    [660, 880].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.24;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.21);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => alarmOscillators.delete(oscillator);
      alarmOscillators.add(oscillator);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    });
  }

  async function startAlarm() {
    if (alarmInterval !== null) return true;
    if (alarmStartPromise) return alarmStartPromise;

    const token = ++alarmToken;
    const attempt = (async () => {
      const context = getAudioContext();
      if (!context) return false;
      if (context.state === 'suspended') await context.resume();
      if (token !== alarmToken || context.state !== 'running') return false;

      const ring = () => {
        if (token === alarmToken && alarmInterval !== null) playAlarmPattern(context);
      };
      alarmInterval = setInterval(ring, 750);
      ring();
      return true;
    })();
    alarmStartPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (alarmStartPromise === attempt) alarmStartPromise = null;
    }
  }

  function stopAlarm() {
    alarmToken += 1;
    if (alarmInterval !== null) clearInterval(alarmInterval);
    alarmInterval = null;
    alarmStartPromise = null;
    alarmOscillators.forEach(oscillator => {
      try {
        oscillator.stop();
      } catch (error) {
        console.warn('Could not stop a timer alarm tone:', error);
      }
    });
    alarmOscillators.clear();
  }

  window.KlasoraTimerSound = Object.freeze({ prepare, startAlarm, stopAlarm, isAlarmActive: () => alarmInterval !== null });
})();
