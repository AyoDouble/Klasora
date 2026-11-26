(() => {
  const maxDate = 8.64e15;
  const deadlineAfter = (seconds, startedAt = Date.now()) => startedAt + Math.max(0, seconds) * 1000;
  const remainingSeconds = (deadline, now = Date.now()) => Math.max(0, Math.ceil((deadline - now) / 1000));
  const formatClock = totalSeconds => {
    const remaining = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    const pad = value => String(value).padStart(2, '0');
    return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  };
  function durationSeconds(parts, now = Date.now()) {
    if (!parts || typeof parts !== 'object') return null;
    const { hours, minutes, seconds } = parts;
    if (![hours, minutes, seconds].every(Number.isSafeInteger) ||
        hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
    const total = hours * 3600 + minutes * 60 + seconds;
    if (!Number.isSafeInteger(total) || total <= 0 || now + total * 1000 > maxDate) return null;
    return total;
  }

  window.KlasoraTimerClock = Object.freeze({ deadlineAfter, remainingSeconds, formatClock, durationSeconds });
})();
