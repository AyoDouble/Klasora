(() => {
  let audioContext;

  function getAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioContext) audioContext = new AudioContext();
    return audioContext;
  }

  async function prepare() {
    const context = getAudioContext();
    if (context?.state === 'suspended') await context.resume();
    return Boolean(context);
  }

  async function beep() {
    const context = getAudioContext();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();

    [660, 880].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.24;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    });
    return true;
  }

  window.KlasoraTimerSound = Object.freeze({ prepare, beep });
})();
