(() => {
  const navItems = [
    { id: 'feed', icon: '◈', label: 'Home' },
    { id: 'cliques', icon: '◉', label: 'Cliques' },
    { id: 'focus', icon: '◎', label: 'Study capsule' },
    { id: 'timetable', icon: '▦', label: 'Timetable' },
    { id: 'assignments', icon: '✓', label: 'Assignments' },
    { id: 'profile', icon: '♙', label: 'Academic profile' }
  ];
  const shortNav = ['feed', 'cliques', 'focus', 'assignments'];
  const state = {
    route: 'feed',
    posts: [],
    comments: [],
    cliques: [],
    assignments: [],
    courses: [],
    activePost: null,
    activeAssignment: null,
    activeClique: null,
    selectedDay: new Date().getDay(),
    events: [],
    timer: { duration: 25 * 60, remaining: 25 * 60, running: false, interval: null, mode: 'capsule' },
    challengeStartedAt: null,
    modal: null
  };
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let shell;
  let content;
  let toastTimer;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const initials = value => String(value || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  const user = () => window.KlasoraBridge?.user || {};
  const storageKey = suffix => `klasora-ui-${suffix}-${user()._id || 'guest'}`;
  const localRead = suffix => {
    try { return JSON.parse(localStorage.getItem(storageKey(suffix)) || '[]'); }
    catch { return []; }
  };
  const localWrite = (suffix, value) => localStorage.setItem(storageKey(suffix), JSON.stringify(value));
  const api = (...args) => window.KlasoraBridge.api(...args);
  const fmtDate = value => {
    if (!value) return 'No date set';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No date set';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const fmtClock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const pageTitle = id => ({ feed: 'Home', cliques: 'Your cliques', focus: 'Study capsule', timetable: 'Timetable', assignments: 'Assignments', profile: 'Academic profile', post: 'Post detail', assignment: 'Assignment detail', liveStudy: 'Live study room', challenge: 'Focus challenge', results: 'Session results' }[id] || 'Klasora');

  function makeShell() {
    shell = document.createElement('div');
    shell.className = 'refresh-shell';
    shell.innerHTML = `
      <aside class="refresh-sidebar">
        <div class="refresh-brand"><img class="refresh-brand-mark" src="/klasora-icon.png" alt="Klasora"><div><div class="refresh-brand-name">klasora</div><div class="refresh-brand-tag">Your circle. Your campus.</div></div></div>
        <div class="refresh-nav-label">Workspace</div>
        <nav class="refresh-nav" aria-label="Workspace">${navItems.map(item => `<button type="button" data-route="${item.id}"><span class="refresh-nav-icon">${item.icon}</span>${item.label}</button>`).join('')}<button type="button" data-action="legacy"><span class="refresh-nav-icon">▤</span>Messages & courses</button></nav>
        <div class="refresh-sidebar-bottom">
          <div class="refresh-sidebar-cta"><strong>Your study, in one place</strong><span>Stay connected to your people and make room for focused work.</span></div>
          <div class="refresh-profile-link" data-route="profile"><div class="refresh-avatar" data-user-initials></div><div class="refresh-profile-meta"><strong data-user-name></strong><span data-user-email></span></div><span>⌄</span></div>
        </div>
      </aside>
      <main class="refresh-main">
        <header class="refresh-topbar"><div class="refresh-top-title" id="refreshTopTitle">Campus hub</div><div class="refresh-top-actions"><button class="refresh-secondary" type="button" data-route="profile">My profile</button><button class="refresh-icon-btn" type="button" data-action="theme" aria-label="Toggle theme">☼</button></div></header>
        <div class="refresh-content" id="refreshContent"></div>
      </main>
      <nav class="refresh-mobile-menu" aria-label="Main navigation">${shortNav.map(id => { const item = navItems.find(entry => entry.id === id); return `<button type="button" data-route="${id}"><span>${item.icon}</span>${item.label}</button>`; }).join('')}<button type="button" data-action="legacy"><span>▤</span>Messages</button></nav>`;
    content = shell.querySelector('#refreshContent');
    shell.addEventListener('click', onClick);
    shell.addEventListener('submit', onSubmit);
    document.getElementById('appScreen').appendChild(shell);
  }

  function open() {
    if (!shell) makeShell();
    shell.style.display = '';
    document.getElementById('appScreen').classList.add('refresh-enabled');
    paintIdentity();
    render();
  }

  function paintIdentity() {
    const current = user();
    shell.querySelectorAll('[data-user-initials]').forEach(node => { node.textContent = initials(current.name); });
    shell.querySelectorAll('[data-user-name]').forEach(node => { node.textContent = current.name || 'Student'; });
    shell.querySelectorAll('[data-user-email]').forEach(node => { node.textContent = current.email || 'Your account'; });
  }

  function setRoute(route) {
    if (state.timer.running && route !== state.route) pauseTimer();
    state.route = route;
    state.modal = null;
    render();
  }

  function render() {
    if (!content || !shell) return;
    const title = pageTitle(state.route);
    shell.querySelector('#refreshTopTitle').textContent = `Klasora  /  ${title}`;
    shell.querySelectorAll('[data-route]').forEach(button => button.classList.toggle('active', button.dataset.route === state.route || (state.route === 'post' && button.dataset.route === 'feed') || (state.route === 'assignment' && button.dataset.route === 'assignments') || (state.route === 'challenge' && button.dataset.route === 'focus') || (state.route === 'results' && button.dataset.route === 'focus') || (state.route === 'liveStudy' && button.dataset.route === 'cliques')));
    const renderers = {
      feed: renderFeed,
      post: renderPostDetail,
      cliques: renderCliques,
      liveStudy: renderLiveStudy,
      focus: renderFocus,
      challenge: renderChallenge,
      results: renderResults,
      timetable: renderTimetable,
      profile: renderProfile,
      assignments: renderAssignments,
      assignment: renderAssignmentDetail
    };
    (renderers[state.route] || renderFeed)();
    if (state.modal) renderModal();
  }

  function pageHeading(eyebrow, title, copy, action = '') {
    return `<div class="refresh-page-heading"><div><div class="refresh-eyebrow">${escapeHtml(eyebrow)}</div><h1 class="refresh-h1">${escapeHtml(title)}</h1><p class="refresh-heading-copy">${escapeHtml(copy)}</p></div>${action}</div>`;
  }

  function renderFeed() {
    const current = user();
    const posts = localRead('posts');
    const firstName = (current.name || 'there').split(' ')[0];
    content.innerHTML = `
      ${pageHeading('Your campus, closer', `Good to see you, ${firstName}`, 'Ideas, study wins, and campus conversations — shared with your circle.', '<button class="refresh-primary" type="button" data-action="compose">＋ Share a thought</button>')}
      <div class="refresh-grid refresh-feed-layout">
        <section>
          <button class="refresh-composer" type="button" data-action="compose"><div class="refresh-avatar">${initials(current.name)}</div><div class="refresh-composer-copy">What would you like to share with your campus?</div><span class="refresh-primary">Create post</span></button>
          <div class="refresh-composer-hint"><span>✦ Campus moments</span><span>▧ Study resources</span><span>⌁ Questions</span></div>
          <div style="height:16px"></div>
          ${posts.length ? posts.slice().reverse().map(postCard).join('') : `<div class="refresh-empty"><div class="refresh-empty-icon">✦</div><strong>Your campus feed starts here</strong><p>Share a study win, ask a question, or start a conversation. Posts are saved in this browser until community sharing is connected.</p><div style="margin-top:14px"><button class="refresh-primary" type="button" data-action="compose">Write your first post</button></div></div>`}
        </section>
        <aside class="refresh-side-stack">
          <div class="refresh-card refresh-capsule-card"><div class="refresh-capsule-label">A little focus goes far</div><div class="refresh-capsule-title">Start a study capsule</div><div class="refresh-capsule-copy">Choose your pace, settle in, and give your next task a little space.</div><button class="refresh-secondary" type="button" data-route="focus">Open study capsule →</button></div>
          <div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Coming up</h2><button class="refresh-text-btn" data-route="assignments">See tasks</button></div><div class="refresh-mini-row"><div class="refresh-mini-icon">✓</div><div class="refresh-mini-copy"><strong>Keep your tasks in view</strong><span>Assignments and due dates from your courses</span></div></div><div class="refresh-mini-row"><div class="refresh-mini-icon">▦</div><div class="refresh-mini-copy"><strong>Make time for class</strong><span>Your week at a glance in the timetable</span></div><button class="refresh-text-btn" data-route="timetable">Open</button></div></div>
          <div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Study with your clique</h2><button class="refresh-text-btn" data-route="cliques">Browse</button></div><p class="refresh-note" style="margin-top:0">Your group conversations stay connected to the existing Klasora chat experience.</p><button class="refresh-secondary" style="width:100%;margin-top:12px" type="button" data-action="legacy">Open messages & courses</button></div>
        </aside>
      </div>`;
  }

  function postCard(post) {
    return `<article class="refresh-card refresh-post" data-open-post="${escapeHtml(post.id)}"><div class="refresh-post-head"><div class="refresh-avatar">${escapeHtml(post.initials)}</div><div class="refresh-post-user"><strong>${escapeHtml(post.name)}</strong><span>${escapeHtml(post.when || 'Just now')}</span></div><span class="refresh-post-tag">${escapeHtml(post.category || 'Campus')}</span></div><p class="refresh-post-text">${escapeHtml(post.text)}</p><div class="refresh-post-actions"><button type="button" class="refresh-text-btn${post.liked ? ' liked' : ''}" data-action="like" data-id="${escapeHtml(post.id)}">♡ ${post.liked ? 'Liked' : 'Like'}</button><button type="button" class="refresh-text-btn" data-action="open-post" data-id="${escapeHtml(post.id)}">◌ ${post.commentCount || 0} comments</button><span class="refresh-note" style="margin:0 0 0 auto">Saved on this device</span></div></article>`;
  }

  function renderPostDetail() {
    const post = localRead('posts').find(item => item.id === state.activePost);
    if (!post) { content.innerHTML = '<div class="refresh-empty"><strong>Post not found</strong><p>This post may have been removed from this device.</p></div>'; return; }
    const comments = localRead(`comments-${post.id}`);
    content.innerHTML = `<button class="refresh-detail-back" type="button" data-route="feed">← Back to Home</button><article class="refresh-card refresh-post"><div class="refresh-post-head"><div class="refresh-avatar">${escapeHtml(post.initials)}</div><div class="refresh-post-user"><strong>${escapeHtml(post.name)}</strong><span>${escapeHtml(post.when || 'Just now')}</span></div><span class="refresh-post-tag">${escapeHtml(post.category || 'Campus')}</span></div><p class="refresh-post-text">${escapeHtml(post.text)}</p><div class="refresh-post-actions"><button class="refresh-text-btn${post.liked ? ' liked' : ''}" type="button" data-action="like" data-id="${escapeHtml(post.id)}">♡ ${post.liked ? 'Liked' : 'Like'}</button><span class="refresh-note" style="margin:0">Local preview</span></div></article><section class="refresh-card refresh-card-pad" style="margin-top:15px"><div class="refresh-section-head"><h2>Conversation</h2><span>${comments.length} comments · this device</span></div><form class="refresh-modal-form" data-form="comment"><textarea name="comment" placeholder="Add to the conversation…" required maxlength="500"></textarea><div style="display:flex;justify-content:flex-end"><button class="refresh-primary" type="submit">Add comment</button></div></form><div class="refresh-comments">${comments.length ? comments.map(comment => `<div class="refresh-comment"><div class="refresh-avatar">${escapeHtml(comment.initials)}</div><p><strong>${escapeHtml(comment.name)}</strong><br>${escapeHtml(comment.text)}</p></div>`).join('') : '<p class="refresh-note">No comments yet.</p>'}</div></section>`;
  }

  async function renderCliques() {
    content.innerHTML = `${pageHeading('Your people', 'Cliques', 'Small groups for your classes, study sessions, and campus life.', '<button class="refresh-primary" type="button" data-action="create-clique">＋ Create clique</button>')}<div class="refresh-clique-list"><div class="refresh-loading">Loading your cliques…</div></div><div style="margin-top:14px"><button class="refresh-secondary" type="button" data-action="legacy">Open all messages & courses</button></div>`;
    try {
      state.cliques = await api('/api/cliques');
      if (state.route !== 'cliques') return;
      const list = content.querySelector('.refresh-clique-list');
      list.innerHTML = state.cliques.length ? state.cliques.map((clique, index) => `<article class="refresh-clique-row" data-action="clique" data-index="${index}"><div class="refresh-clique-emblem">${escapeHtml(clique.emoji || '◉')}</div><div class="refresh-row-info"><strong>${escapeHtml(clique.name)}</strong><span>${escapeHtml(clique.lastMsg || `${clique.members?.length || 0} members · Start a conversation`)}</span></div><div class="refresh-row-trailing">${clique.lastAt ? fmtDate(clique.lastAt) : 'Open chat →'}</div></article>`).join('') : '<div class="refresh-empty"><div class="refresh-empty-icon">◉</div><strong>No cliques yet</strong><p>Create a group to study together, then open its conversation in Klasora chat.</p></div>';
    } catch (error) {
      if (state.route === 'cliques') content.querySelector('.refresh-clique-list').innerHTML = `<div class="refresh-empty"><strong>Could not load cliques</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-cliques">Try again</button></div>`;
    }
  }

  function renderLiveStudy() {
    const clique = state.activeClique || {};
    const members = clique.members || [];
    content.innerHTML = `${pageHeading('Together, with focus', 'Live study room', `A shared study space for ${clique.name || 'your clique'}.`, '<button class="refresh-secondary" type="button" data-route="cliques">← Back to cliques</button>')}<div class="refresh-grid refresh-timer-layout"><section class="refresh-card refresh-timer-card"><div class="refresh-timer-label">Clique focus session · local preview</div><div class="refresh-timer-ring"><div class="refresh-timer" id="timerDigits">${fmtClock(state.timer.remaining)}</div></div><div class="refresh-note">Your group chat remains available in Messages & courses. Live presence and shared timers are not connected to the server.</div><div class="refresh-timer-actions"><button class="refresh-primary" type="button" data-action="${state.timer.running ? 'pause-timer' : 'start-live'}">${state.timer.running ? 'Ⅱ Pause group session' : 'Start group session'}</button><button class="refresh-secondary" type="button" data-action="clique-chat">Open clique chat</button><button class="refresh-secondary" type="button" data-action="solo">Solo focus</button></div></section><aside class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Study circle</h2><span>${members.length} members</span></div>${members.length ? members.slice(0,8).map(member => `<div class="refresh-mini-row"><div class="refresh-avatar">${initials(member.name)}</div><div class="refresh-mini-copy"><strong>${escapeHtml(member.name || 'Clique member')}</strong><span>Member</span></div></div>`).join('') : '<div class="refresh-empty"><strong>Members appear here</strong><p>Open the clique chat to see its current group details.</p></div>'}</aside></div>`;
  }

  function renderFocus() {
    const presets = [{ label: 'Quick reset', minutes: 15 }, { label: 'Classic', minutes: 25 }, { label: 'Deep work', minutes: 50 }];
    const duration = Math.max(1, state.timer.duration);
    const progress = Math.max(0, Math.min(100, 100 * (1 - state.timer.remaining / duration)));
    content.innerHTML = `${pageHeading('Find your rhythm', 'Study capsule', 'Choose a session length, then focus on one thing at a time.', '<button class="refresh-secondary" type="button" data-action="challenge">⚡ Take a focus challenge</button>')}<div class="refresh-grid refresh-timer-layout"><section class="refresh-card refresh-timer-card"><div class="refresh-timer-label">${state.timer.running ? 'You’re in a focus session' : 'Your next focused session'}</div><div class="refresh-timer-ring"><div class="refresh-timer" id="timerDigits">${fmtClock(state.timer.remaining)}</div></div><div class="refresh-progress"><i id="timerProgress" style="width:${progress}%"></i></div><div class="refresh-presets" style="margin-top:17px">${presets.map(preset => `<button type="button" class="refresh-chip${duration === preset.minutes * 60 && state.timer.mode === 'capsule' ? ' active' : ''}" data-action="preset" data-minutes="${preset.minutes}">${preset.label} · ${preset.minutes}m</button>`).join('')}</div><div class="refresh-timer-actions"><button class="refresh-primary" type="button" data-action="${state.timer.running ? 'pause-timer' : 'start-timer'}">${state.timer.running ? 'Ⅱ Pause' : '▶ Start focus'}</button><button class="refresh-secondary" type="button" data-action="reset-timer">↺ Reset</button></div><p class="refresh-note">Completed focus sessions are recorded with your existing Klasora focus stats. Your timer runs in this browser tab.</p></section><aside class="refresh-side-stack"><div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Make it a challenge</h2><span>25 minutes</span></div><p class="refresh-note" style="margin-top:0">Set one goal and see it through. Your result is personal to this session.</p><button class="refresh-primary" style="width:100%;margin-top:13px" type="button" data-action="challenge">Start challenge →</button></div><div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Study together</h2></div><p class="refresh-note" style="margin-top:0">Choose a clique to open a local shared-study preview. Presence syncing is not available yet.</p><button class="refresh-secondary" style="width:100%;margin-top:13px" type="button" data-route="cliques">Choose a clique</button></div></aside></div>`;
  }

  function renderChallenge() {
    if (state.timer.goal && (state.challengeStartedAt || state.timer.running)) {
      const elapsed = Math.floor((state.timer.duration - state.timer.remaining) / 60);
      const progress = 100 * (1 - state.timer.remaining / state.timer.duration);
      content.innerHTML = `${pageHeading('One thing at a time', 'Challenge in progress', 'Keep going at your own pace. You can pause or reset this browser timer.', '<button class="refresh-secondary" type="button" data-route="focus">Exit challenge</button>')}<div class="refresh-card refresh-timer-card" style="max-width:680px;margin:0 auto"><div class="refresh-timer-label">Your goal · started ${elapsed} minute${elapsed === 1 ? '' : 's'} ago</div><h2 style="margin-top:9px;font:700 18px Outfit,sans-serif">${escapeHtml(state.timer.goal)}</h2><div class="refresh-timer-ring"><div class="refresh-timer" id="timerDigits">${fmtClock(state.timer.remaining)}</div></div><div class="refresh-progress"><i id="timerProgress" style="width:${progress}%"></i></div><div class="refresh-timer-actions"><button class="refresh-primary" type="button" data-action="${state.timer.running ? 'pause-timer' : 'start-timer'}">${state.timer.running ? 'Ⅱ Pause challenge' : '▶ Resume challenge'}</button><button class="refresh-secondary" type="button" data-action="reset-timer">↺ Reset</button></div><p class="refresh-note">Your challenge timer is only visible on this device and will stop when you close the page.</p></div>`;
      return;
    }
    content.innerHTML = `${pageHeading('A small commitment', 'Focus challenge', 'Pick one clear goal, then work on it without distraction.', '<button class="refresh-secondary" type="button" data-route="focus">← Back to capsule</button>')}<div class="refresh-card refresh-card-pad" style="max-width:680px;margin:0 auto"><div class="refresh-eyebrow">25 minute challenge</div><h2 style="margin-top:8px;font:700 21px Outfit,sans-serif">What will you focus on?</h2><p class="refresh-heading-copy">This goal stays in this browser. You can update it before the timer starts.</p><form class="refresh-modal-form" data-form="challenge"><label class="refresh-form-label" for="challengeGoal">Your focus goal</label><textarea id="challengeGoal" name="goal" maxlength="160" placeholder="e.g. Review my lecture notes for biology" required></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="refresh-primary" type="submit">Begin challenge →</button></div></form></div>`;
  }

  function renderResults() {
    const elapsed = Math.floor((state.timer.duration - state.timer.remaining) / 60) || Math.floor(state.timer.duration / 60);
    content.innerHTML = `${pageHeading('Nice work', 'Session complete', 'You made space for focused work. Take a moment before moving on.', '<button class="refresh-secondary" type="button" data-route="focus">Back to study capsule</button>')}<div class="refresh-card refresh-card-pad" style="max-width:720px;margin:0 auto"><div class="refresh-stats"><div class="refresh-stat"><span>Focus time</span><strong>${elapsed || 1}m</strong></div><div class="refresh-stat"><span>Session</span><strong>✓</strong></div><div class="refresh-stat"><span>Mode</span><strong>${state.timer.mode === 'challenge' ? '⚡' : '◎'}</strong></div></div><h2 style="margin-top:22px;font:700 17px Outfit,sans-serif">${state.timer.mode === 'challenge' ? 'Challenge complete' : 'A good session, done.'}</h2><p class="refresh-heading-copy">${state.timer.goal ? escapeHtml(state.timer.goal) : 'Your completed focus session has been recorded.'}</p><div class="refresh-timer-actions" style="justify-content:flex-start"><button class="refresh-primary" type="button" data-action="again">Start another session</button><button class="refresh-secondary" type="button" data-route="feed">Back to Home</button></div></div>`;
  }

  async function renderTimetable() {
    state.events = localRead('events');
    const week = [];
    const today = new Date();
    const mondayOffset = (today.getDay() + 6) % 7;
    for (let index = 0; index < 7; index++) {
      const date = new Date(today);
      date.setDate(today.getDate() - mondayOffset + index);
      week.push(date);
    }
    const selected = week.find(date => date.getDay() === state.selectedDay) || week[(today.getDay() + 6) % 7];
    const events = state.events.filter(event => event.date === dateKey(selected)).sort((a, b) => a.time.localeCompare(b.time));
    const hours = Array.from({ length: 10 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
    content.innerHTML = `${pageHeading('Plan your week', 'Timetable', 'A simple weekly view for classes, study blocks, and campus plans.', '<button class="refresh-primary" type="button" data-action="add-event">＋ Add to timetable</button>')}<div class="refresh-card refresh-card-pad"><div class="refresh-week">${week.map(date => `<button class="refresh-day${date.getDay() === state.selectedDay ? ' active' : ''}" type="button" data-action="select-day" data-day="${date.getDay()}"><strong>${date.toLocaleDateString(undefined,{weekday:'short'})}</strong><span>${date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></button>`).join('')}</div><div class="refresh-timeline"><div class="refresh-times">${hours.map(hour => `<span>${hour}</span>`).join('')}</div><div class="refresh-slots">${events.length ? events.map(event => { const [hour, minute] = event.time.split(':').map(Number); const row = Math.max(1, Math.min(20, (hour - 8) * 2 + Math.floor(minute / 30) + 1)); return `<div class="refresh-event" style="grid-row:${row}/span 2" title="${escapeHtml(event.title)}">${escapeHtml(event.time)} · ${escapeHtml(event.title)}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</div>`; }).join('') : `<div class="refresh-empty" style="align-self:start;margin:35px 10px"><strong>No plans for ${selected.toLocaleDateString(undefined,{weekday:'long'})}</strong><p>Add a class or study block to this browser-only timetable.</p></div>`}</div></div><p class="refresh-note">Timetable entries are saved in this browser only; there is no timetable service connected yet.</p></div>`;
  }

  async function renderProfile() {
    const current = user();
    content.innerHTML = `${pageHeading('Your learning identity', 'Academic profile', 'Your Klasora account and course spaces, together in one place.', '<button class="refresh-primary" type="button" data-action="save-profile">Save profile</button>')}<div class="refresh-grid refresh-profile-grid"><section class="refresh-card"><div class="refresh-profile-hero"><div class="refresh-avatar refresh-avatar-lg">${initials(current.name)}</div><div><h2>${escapeHtml(current.name || 'Student')}</h2><p>${escapeHtml(current.email || '')}</p></div></div><div class="refresh-card-pad"><div class="refresh-field-grid"><div class="refresh-field"><label for="profileName">Display name</label><input id="profileName" value="${escapeHtml(current.name || '')}" maxlength="80"></div><div class="refresh-field"><label for="profileEmail">Account email</label><input id="profileEmail" value="${escapeHtml(current.email || '')}" disabled></div><div class="refresh-field" style="grid-column:1/-1"><label for="profileBio">About you</label><textarea id="profileBio" maxlength="280" placeholder="A short introduction">${escapeHtml(current.bio || '')}</textarea></div></div><p class="refresh-note">Name and bio are saved to your Klasora account. Program and academic-year fields are not available in the current account data.</p></div></section><aside class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Your course spaces</h2><span id="profileCourseCount">Loading…</span></div><div id="profileCourses" class="refresh-clique-list"><div class="refresh-note">Loading courses…</div></div><button class="refresh-secondary" style="width:100%;margin-top:14px" type="button" data-action="legacy-courses">Open courses</button></aside></div>`;
    try {
      state.courses = await api('/api/courses');
      if (state.route !== 'profile') return;
      content.querySelector('#profileCourseCount').textContent = `${state.courses.length} spaces`;
      content.querySelector('#profileCourses').innerHTML = state.courses.length ? state.courses.slice(0, 5).map(course => `<div class="refresh-mini-row"><div class="refresh-mini-icon">🎓</div><div class="refresh-mini-copy"><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(course.code || 'Course space')}</span></div></div>`).join('') : '<div class="refresh-note">No course spaces yet.</div>';
    } catch (error) {
      if (state.route === 'profile') content.querySelector('#profileCourses').innerHTML = `<div class="refresh-note">${escapeHtml(error.message)}</div>`;
    }
  }

  async function renderAssignments() {
    if (!content || !shell || state.route !== 'assignments') return;
    content.innerHTML = `${pageHeading('Keep your momentum', 'Assignments & tasks', 'Your course deadlines and personal tasks, without the last-minute scramble.', '<button class="refresh-primary" type="button" data-action="add-assignment">＋ Add assignment</button>')}<div class="refresh-grid refresh-stats" style="margin-bottom:17px"><div class="refresh-stat"><span>To do</span><strong id="assignmentTodo">—</strong></div><div class="refresh-stat"><span>Completed</span><strong id="assignmentDone">—</strong></div><div class="refresh-stat"><span>Upcoming</span><strong id="assignmentUpcoming">—</strong></div></div><div class="refresh-assignment-list"><div class="refresh-loading">Loading assignments…</div></div>`;
    try {
      const [assignments, courses] = await Promise.all([api('/api/homework'), api('/api/courses')]);
      state.assignments = assignments;
      state.courses = courses;
      if (state.route !== 'assignments') return;
      content.querySelector('#assignmentTodo').textContent = assignments.filter(item => !item.done).length;
      content.querySelector('#assignmentDone').textContent = assignments.filter(item => item.done).length;
      const upcoming = assignments.filter(item => !item.done && item.dueDate && new Date(item.dueDate) >= new Date()).length;
      content.querySelector('#assignmentUpcoming').textContent = upcoming;
      const list = content.querySelector('.refresh-assignment-list');
      list.innerHTML = assignments.length ? assignments.map((item, index) => `<article class="refresh-assignment-row"><button type="button" class="refresh-chip${item.done ? ' active' : ''}" data-action="toggle-assignment" data-id="${escapeHtml(item._id)}" aria-label="${item.done ? 'Mark incomplete' : 'Mark complete'}">${item.done ? '✓' : '○'}</button><div class="refresh-row-info" data-action="open-assignment" data-index="${index}" style="cursor:pointer"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.subject || 'Personal task')} · Due ${escapeHtml(fmtDate(item.dueDate))}</span></div><span class="refresh-post-tag">${escapeHtml(item.priority || 'medium')}</span><button class="refresh-text-btn" type="button" data-action="open-assignment" data-index="${index}">Details →</button></article>`).join('') : '<div class="refresh-empty"><div class="refresh-empty-icon">✓</div><strong>Nothing on your list yet</strong><p>Add an assignment to keep the deadline, course, and next step together.</p></div>';
    } catch (error) {
      if (state.route === 'assignments') content.querySelector('.refresh-assignment-list').innerHTML = `<div class="refresh-empty"><strong>Could not load assignments</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-assignments">Try again</button></div>`;
    }
  }

  function renderAssignmentDetail() {
    const item = state.activeAssignment;
    if (!item) { content.innerHTML = '<div class="refresh-empty"><strong>Assignment not found</strong><p>Return to your assignments list to choose a task.</p><button class="refresh-secondary" data-route="assignments">Assignments</button></div>'; return; }
    content.innerHTML = `<button class="refresh-detail-back" type="button" data-route="assignments">← Back to assignments</button>${pageHeading(escapeHtml(item.subject || 'Personal task'), item.title, 'Assignment details and the next step you can take.', `<button class="refresh-primary" type="button" data-action="toggle-assignment" data-id="${escapeHtml(item._id)}">${item.done ? 'Mark as to do' : '✓ Mark complete'}</button>`)}<div class="refresh-grid refresh-profile-grid"><section class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Task details</h2><span class="refresh-post-tag">${escapeHtml(item.priority || 'medium')} priority</span></div><div class="refresh-mini-row"><div class="refresh-mini-icon">▦</div><div class="refresh-mini-copy"><strong>Due date</strong><span>${escapeHtml(fmtDate(item.dueDate))}</span></div></div><div class="refresh-mini-row"><div class="refresh-mini-icon">🎓</div><div class="refresh-mini-copy"><strong>Course</strong><span>${escapeHtml(item.course?.name || item.subject || 'Personal assignment')}</span></div></div><div class="refresh-mini-row"><div class="refresh-mini-icon">✎</div><div class="refresh-mini-copy"><strong>Notes</strong><span>${escapeHtml(item.notes || 'No notes added yet.')}</span></div></div><button class="refresh-primary" style="margin-top:18px" type="button" data-action="breakdown" data-id="${escapeHtml(item._id)}">✨ Break this down</button><div id="assignmentPlan" class="refresh-note"></div></section><aside class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Make a start</h2></div><p class="refresh-note" style="margin-top:0">A focused session can make a big task feel more manageable.</p><button class="refresh-secondary" style="width:100%;margin-top:13px" type="button" data-route="focus">Start a study capsule</button></aside></div>`;
  }

  function openModal(type, data = {}) {
    state.modal = { type, ...data };
    renderModal();
  }

  function renderModal() {
    const old = shell.querySelector('.refresh-modal-backdrop');
    old?.remove();
    const modal = document.createElement('div');
    modal.className = 'refresh-modal-backdrop';
    modal.innerHTML = modalContents(state.modal);
    modal.addEventListener('click', event => { if (event.target === modal) { state.modal = null; modal.remove(); } });
    shell.appendChild(modal);
    modal.querySelector('[data-close-modal]')?.addEventListener('click', () => { state.modal = null; modal.remove(); });
    modal.querySelector('input,textarea')?.focus();
  }

  function modalContents(modal) {
    const header = (title, copy) => `<div class="refresh-modal-head"><div><h2>${title}</h2><p>${copy}</p></div><button type="button" class="refresh-icon-btn" data-close-modal aria-label="Close">×</button></div>`;
    const footer = submit => `<div class="refresh-modal-footer"><button type="button" class="refresh-secondary" data-close-modal>Cancel</button><button type="submit" class="refresh-primary">${submit}</button></div>`;
    if (modal.type === 'post') return `<section class="refresh-modal">${header('Share with your campus','Posts are stored in this browser for now.')}<form class="refresh-modal-form" data-form="post"><label class="refresh-form-label" for="postCategory">Topic</label><input id="postCategory" name="category" maxlength="32" placeholder="Campus, Study help, Wins…"><label class="refresh-form-label" for="postText">Your post</label><textarea id="postText" name="text" required maxlength="800" placeholder="What’s on your mind?"></textarea>${footer('Share post')}</form></section>`;
    if (modal.type === 'comment') return '';
    if (modal.type === 'clique') return `<section class="refresh-modal">${header('Create a clique','This uses your existing Klasora groups service.')}<form class="refresh-modal-form" data-form="clique"><label class="refresh-form-label" for="cliqueNameNew">Clique name</label><input id="cliqueNameNew" name="name" required maxlength="60" placeholder="e.g. Biology study group"><label class="refresh-form-label" for="cliqueEmojiNew">Choose an emoji</label><input id="cliqueEmojiNew" name="emoji" maxlength="4" value="📚">${footer('Create clique')}</form></section>`;
    if (modal.type === 'event') return `<section class="refresh-modal">${header('Add to timetable','Saved in this browser only.')}<form class="refresh-modal-form" data-form="event"><label class="refresh-form-label" for="eventTitle">Class or study block</label><input id="eventTitle" name="title" required maxlength="80" placeholder="e.g. Chemistry lecture"><label class="refresh-form-label" for="eventDate">Date</label><input id="eventDate" type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required><label class="refresh-form-label" for="eventTime">Start time</label><input id="eventTime" type="time" name="time" value="09:00" required><label class="refresh-form-label" for="eventLocation">Location</label><input id="eventLocation" name="location" maxlength="80" placeholder="Room or campus location">${footer('Add to timetable')}</form></section>`;
    if (modal.type === 'assignment') return `<section class="refresh-modal">${header('Add an assignment','Saved to your Klasora task list.')}<form class="refresh-modal-form" data-form="assignment"><label class="refresh-form-label" for="newAssignmentTitle">Assignment title</label><input id="newAssignmentTitle" name="title" required maxlength="120" placeholder="e.g. Research essay"><label class="refresh-form-label" for="newAssignmentSubject">Subject</label><input id="newAssignmentSubject" name="subject" maxlength="80" placeholder="Course or subject"><label class="refresh-form-label" for="newAssignmentCourse">Course space</label><select class="refresh-field input" id="newAssignmentCourse" name="courseId"><option value="">Personal assignment</option>${(state.courses || []).map(course => `<option value="${escapeHtml(course._id)}">${escapeHtml(course.name)}</option>`).join('')}</select><label class="refresh-form-label" for="newAssignmentDue">Due date</label><input id="newAssignmentDue" type="date" name="dueDate"><label class="refresh-form-label" for="newAssignmentPriority">Priority</label><select id="newAssignmentPriority" name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select><label class="refresh-form-label" for="newAssignmentNotes">Notes</label><textarea id="newAssignmentNotes" name="notes" maxlength="1000" placeholder="Optional details"></textarea>${footer('Add assignment')}</form></section>`;
    return '';
  }

  async function onSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (form.dataset.form === 'post') {
        const posts = localRead('posts');
        posts.push({ id: crypto.randomUUID(), name: user().name || 'Student', initials: initials(user().name), text: data.text.trim(), category: data.category.trim() || 'Campus', when: 'Just now', commentCount: 0 });
        localWrite('posts', posts);
        state.modal = null;
        render();
        toast('Your post was saved on this device.');
      } else if (form.dataset.form === 'comment') {
        const post = localRead('posts').find(item => item.id === state.activePost);
        if (!post) return;
        const comments = localRead(`comments-${post.id}`);
        comments.push({ name: user().name || 'Student', initials: initials(user().name), text: data.comment.trim() });
        localWrite(`comments-${post.id}`, comments);
        post.commentCount = comments.length;
        localWrite('posts', localRead('posts').map(item => item.id === post.id ? post : item));
        render();
      } else if (form.dataset.form === 'event') {
        const events = localRead('events');
        events.push({ id: crypto.randomUUID(), title: data.title.trim(), date: data.date, time: data.time, location: data.location.trim() });
        localWrite('events', events);
        state.selectedDay = new Date(`${data.date}T12:00:00`).getDay();
        state.modal = null;
        render();
        toast('Timetable entry saved in this browser.');
      } else if (form.dataset.form === 'clique') {
        await api('/api/cliques', 'POST', { name: data.name.trim(), emoji: data.emoji.trim() || '📚', memberIds: [] });
        state.modal = null;
        await renderCliques();
        toast('Clique created.');
      } else if (form.dataset.form === 'assignment') {
        await api('/api/homework', 'POST', { title: data.title.trim(), subject: data.subject.trim(), courseId: data.courseId || null, dueDate: data.dueDate || null, priority: data.priority, notes: data.notes.trim() });
        state.modal = null;
        await renderAssignments();
        toast('Assignment added to your tasks.');
      } else if (form.dataset.form === 'challenge') {
        state.timer.goal = data.goal.trim();
        state.timer.mode = 'challenge';
        state.timer.duration = 25 * 60;
        state.timer.remaining = state.timer.duration;
        state.challengeStartedAt = Date.now();
        startTimer();
      }
    } catch (error) {
      toast(`Could not save: ${error.message}`);
    }
  }

  async function onClick(event) {
    const target = event.target.closest('[data-route],[data-action],[data-open-post]');
    if (!target) return;
    if (target.dataset.openPost && !event.target.closest('button')) {
      openPost(target.dataset.openPost);
      return;
    }
    if (target.dataset.route) { setRoute(target.dataset.route); return; }
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (action === 'compose') openModal('post');
    else if (action === 'create-clique') openModal('clique');
    else if (action === 'add-event') openModal('event');
    else if (action === 'add-assignment') {
      try { state.courses = await api('/api/courses'); } catch (error) { toast(`Could not load courses: ${error.message}`); }
      openModal('assignment');
    } else if (action === 'open-post') openPost(id);
    else if (action === 'like') toggleLike(id);
    else if (action === 'legacy' || action === 'legacy-courses') showLegacy(action === 'legacy-courses' ? 'courses' : 'chats');
    else if (action === 'theme') window.KlasoraBridge?.toggleTheme();
    else if (action === 'clique') openClique(state.cliques[Number(target.dataset.index)]);
    else if (action === 'retry-cliques') renderCliques();
    else if (action === 'retry-assignments') renderAssignments();
    else if (action === 'start-live') startLiveSession();
    else if (action === 'clique-chat') {
      showLegacy('chats');
      window.KlasoraBridge?.setChatMode('cliques');
      if (state.activeClique) window.KlasoraBridge?.openChat({ ...state.activeClique, _chatType: 'clique' });
    }
    else if (action === 'solo') setRoute('focus');
    else if (action === 'challenge') {
      state.timer.mode = 'challenge';
      state.timer.goal = '';
      state.timer.duration = 25 * 60;
      state.timer.remaining = state.timer.duration;
      state.challengeStartedAt = null;
      state.timer.running = false;
      setRoute('challenge');
    }
    else if (action === 'preset') setPreset(Number(target.dataset.minutes));
    else if (action === 'start-timer') startTimer();
    else if (action === 'pause-timer') pauseTimer();
    else if (action === 'reset-timer') resetTimer();
    else if (action === 'again') { state.timer.mode = 'capsule'; state.timer.goal = ''; state.timer.remaining = state.timer.duration; setRoute('focus'); }
    else if (action === 'select-day') { state.selectedDay = Number(target.dataset.day); renderTimetable(); }
    else if (action === 'save-profile') await saveProfile();
    else if (action === 'open-assignment') openAssignment(state.assignments[Number(target.dataset.index)]);
    else if (action === 'toggle-assignment') await toggleAssignment(id);
    else if (action === 'breakdown') await breakdownAssignment(id);
  }

  function openPost(id) { state.activePost = id; setRoute('post'); }
  function toggleLike(id) {
    const posts = localRead('posts');
    const post = posts.find(item => item.id === id);
    if (!post) return;
    post.liked = !post.liked;
    localWrite('posts', posts);
    render();
  }
  async function openClique(clique) {
    if (!clique) return;
    state.activeClique = clique;
    try {
      const details = await api('/api/cliques');
      state.activeClique = details.find(item => item._id === clique._id) || clique;
      state.activeClique._chatType = 'clique';
    } catch (error) { toast(`Could not load clique details: ${error.message}`); }
    setRoute('liveStudy');
  }
  function startLiveSession() {
    state.timer.duration = 25 * 60;
    state.timer.remaining = state.timer.duration;
    state.timer.mode = 'live';
    state.challengeStartedAt = Date.now();
    startTimer();
  }
  function setPreset(minutes) {
    if (state.timer.running) return;
    state.timer.mode = 'capsule';
    state.timer.duration = minutes * 60;
    state.timer.remaining = state.timer.duration;
    renderFocus();
  }
  function startTimer() {
    clearInterval(state.timer.interval);
    const route = state.timer.mode === 'challenge' ? 'challenge' : state.timer.mode === 'live' ? 'liveStudy' : 'focus';
    setRoute(route);
    state.timer.running = true;
    render();
    tickTimer();
    state.timer.interval = setInterval(tickTimer, 1000);
  }
  function tickTimer() {
    if (!state.timer.running) return;
    state.timer.remaining = Math.max(0, state.timer.remaining - 1);
    const digits = shell?.querySelector('#timerDigits');
    if (digits) digits.textContent = fmtClock(state.timer.remaining);
    const progress = shell?.querySelector('#timerProgress');
    if (progress) progress.style.width = `${100 * (1 - state.timer.remaining / state.timer.duration)}%`;
    if (state.timer.remaining <= 0) completeTimer();
  }
  function pauseTimer() {
    state.timer.running = false;
    clearInterval(state.timer.interval);
    state.timer.interval = null;
    if (state.route === 'challenge') renderChallenge();
    else if (state.route === 'focus') renderFocus();
    else if (state.route === 'liveStudy') renderLiveStudy();
  }
  function resetTimer() {
    pauseTimer();
    state.timer.remaining = state.timer.duration;
    if (state.route === 'focus') renderFocus();
    else if (state.route === 'liveStudy') renderLiveStudy();
  }
  async function completeTimer() {
    pauseTimer();
    if (state.timer.mode !== 'live') {
      try { await api('/api/pomodoro/complete', 'POST'); }
      catch (error) { toast(`Session complete, but stats could not be saved: ${error.message}`); }
    }
    setRoute('results');
    toast('Focus session complete. Well done!');
  }
  async function toggleAssignment(id) {
    const item = state.assignments.find(assignment => assignment._id === id);
    if (!item) return;
    try {
      await api(`/api/homework/${encodeURIComponent(id)}`, 'PATCH', { done: !item.done });
      if (state.route === 'assignment') state.activeAssignment.done = !item.done;
      await renderAssignments();
      if (state.route === 'assignment') renderAssignmentDetail();
    } catch (error) { toast(`Could not update task: ${error.message}`); }
  }
  function openAssignment(item) { if (!item) return; state.activeAssignment = item; setRoute('assignment'); }
  async function breakdownAssignment(id) {
    const holder = content.querySelector('#assignmentPlan');
    if (!holder) return;
    holder.textContent = 'Creating a study plan…';
    try {
      const plan = await api('/api/ai/homework-plan', 'POST', { homeworkId: id });
      holder.innerHTML = `<strong>${escapeHtml(plan.summary)}</strong><ol>${(plan.steps || []).map(step => `<li>${escapeHtml(step.title)}${step.detail ? ` — ${escapeHtml(step.detail)}` : ''}</li>`).join('')}</ol>${plan.tip ? `<p>${escapeHtml(plan.tip)}</p>` : ''}`;
    } catch (error) { holder.textContent = `Could not create a plan: ${error.message}`; }
  }
  async function saveProfile() {
    const name = content.querySelector('#profileName')?.value.trim();
    const bio = content.querySelector('#profileBio')?.value.trim();
    if (!name || name.length < 2) { toast('Enter a name with at least two characters.'); return; }
    try {
      await window.KlasoraBridge.updateProfile({ name, bio });
      paintIdentity();
      renderProfile();
      toast('Profile saved.');
    } catch (error) { toast(`Could not save profile: ${error.message}`); }
  }
  function showLegacy(tab) {
    shell.style.display = 'none';
    document.getElementById('appScreen').classList.remove('refresh-enabled');
    let back = document.querySelector('.refresh-legacy-back');
    if (!back) {
      back = document.createElement('button');
      back.type = 'button';
      back.className = 'refresh-legacy-back refresh-primary';
      back.textContent = '← Campus hub';
      back.addEventListener('click', () => {
        back.remove();
        open();
      });
      document.body.appendChild(back);
    }
    window.KlasoraBridge?.switchTab2(tab);
    if (tab === 'chats') window.KlasoraBridge?.setChatMode('dms');
  }
  function toast(message) {
    let element = shell?.querySelector('.refresh-toast');
    if (!element) {
      element = document.createElement('div');
      element.className = 'refresh-toast';
      document.body.appendChild(element);
    }
    element.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element?.remove(), 3200);
  }
  function renderModalAfterLogin() {
    if (state.modal) renderModal();
  }

  function close() {
    clearInterval(state.timer.interval);
    state.timer.interval = null;
    state.timer.running = false;
    state.timer.goal = '';
    state.timer.mode = 'capsule';
    state.timer.duration = 25 * 60;
    state.timer.remaining = state.timer.duration;
    state.challengeStartedAt = null;
    state.route = 'feed';
    shell?.classList.remove('refresh-enabled');
    if (shell) shell.style.display = 'none';
    document.querySelector('.refresh-legacy-back')?.remove();
    shell?.querySelector('.refresh-modal-backdrop')?.remove();
    state.modal = null;
  }

  window.KlasoraRefresh = { open, close, renderAssignments, showLegacy, renderModalAfterLogin };
})();
