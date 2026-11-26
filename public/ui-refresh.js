(() => {
  const navItems = [
    { id: 'feed', icon: 'layout-dashboard', label: 'Home' },
    { id: 'cliques', icon: 'users-round', label: 'Cliques' },
    { id: 'focus', icon: 'timer', label: 'Study capsule' },
    { id: 'timetable', icon: 'calendar-days', label: 'Timetable' },
    { id: 'assignments', icon: 'list-checks', label: 'Assignments & tasks' },
    { id: 'courses', icon: 'book-open', label: 'Courses' }
  ];
  const shortNav = navItems.map(item => item.id);
  const postReactions = [
    { id: 'like', icon: 'thumbs-up', label: 'Like' },
    { id: 'love', icon: 'heart', label: 'Love' },
    { id: 'celebrate', icon: 'party-popper', label: 'Celebrate' },
    { id: 'insightful', icon: 'lightbulb', label: 'Helpful' }
  ];
  const cliqueIcons = [
    { id: 'book-open', label: 'Books' }, { id: 'gamepad-2', label: 'Games' },
    { id: 'basketball', label: 'Sports' }, { id: 'music-2', label: 'Music' },
    { id: 'laptop', label: 'Technology' }, { id: 'palette', label: 'Art' },
    { id: 'circle-dot', label: 'Activities' }, { id: 'pizza', label: 'Food' },
    { id: 'plane', label: 'Travel' }, { id: 'drama', label: 'Performing arts' },
    { id: 'microscope', label: 'Science' }, { id: 'camera', label: 'Photography' },
    { id: 'dumbbell', label: 'Fitness' }, { id: 'target', label: 'Goals' },
    { id: 'lightbulb', label: 'Ideas' }
  ];
  const state = {
    route: 'feed',
    posts: [],
    localPosts: [],
    comments: [],
    seenCommentIds: new Set(),
    feedRequestId: 0,
    cliques: [],
    dms: [],
    handledCliqueInvite: false,
    assignments: [],
    courses: [],
    activePost: null,
    activeAssignment: null,
    activeClique: null,
    activeConversation: null,
    universityDirectory: null,
    profileImageDraft: null,
    messageView: 'groups',
    callFilter: 'all',
    callSearch: '',
    returnToCalls: false,
    selectedDay: new Date().getDay(),
    events: [],
    timer: { duration: 25 * 60, remaining: 25 * 60, running: false, interval: null, endAt: null, completionStarted: false, alarmActive: false, alarmAudioFailed: false, mode: 'capsule' },
    challengeStartedAt: null,
    modal: null
  };
  let pendingRoomId = null;
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let shell;
  let content;
  let toastTimer;
  let timerAlarmGeneration = 0;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const iconMarkup = (name, className = '') => window.KlasoraIcons.markup(name, className);
  const themeIconMarkup = theme => iconMarkup(theme === 'light' ? 'sun' : 'moon', theme === 'light' ? 'theme-sun-icon' : '');
  const initials = value => String(value || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  const user = () => window.KlasoraBridge?.user || {};
  const pictureMarkup = (image, name) => image
    ? `<img src="${escapeHtml(image)}" alt="">`
    : escapeHtml(initials(name));
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
  const fmtConversationTime = value => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    if (sameDay) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const daysAgo = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    return daysAgo < 7
      ? date.toLocaleDateString(undefined, { weekday: 'short' })
      : date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  };
  const fmtClock = seconds => window.KlasoraTimerClock.formatClock(seconds);
  const pageTitle = id => ({ feed: 'Home', cliques: 'Cliques', cliqueChat: 'Clique conversations', calls: 'Calls', courses: 'Courses', courseChat: 'Course conversations', settings: 'Settings & more', preferences: 'Preferences & notifications', focus: 'Study capsule', timetable: 'Timetable', assignments: 'Assignments & tasks', profile: 'Academic profile', post: 'Post detail', assignment: 'Assignment detail', liveStudy: 'Live study room', challenge: 'Focus challenge', results: 'Session results' }[id] || 'Klasora');

  function makeShell() {
    shell = document.createElement('div');
    shell.className = 'refresh-shell';
    shell.innerHTML = `
      <aside class="refresh-sidebar">
        <div class="refresh-brand"><img class="refresh-brand-mark" src="/klasora-icon.png" alt="Klasora"><div><div class="refresh-brand-name">klasora</div><div class="refresh-brand-tag">Your circle. Your campus.</div></div></div>
        <div class="refresh-nav-label">Workspace</div>
        <nav class="refresh-nav" aria-label="Workspace">${navItems.map(item => `<button type="button" data-route="${item.id}"><span class="refresh-nav-icon">${iconMarkup(item.icon)}</span>${item.label}</button>`).join('')}</nav>
        <div class="refresh-sidebar-bottom">
          <div class="refresh-sidebar-cta"><strong>Your study, in one place</strong><span>Stay connected to your people and make room for focused work.</span></div>
          <button class="refresh-settings-link" type="button" data-route="settings">${iconMarkup('settings')} <span>Settings & more</span><b>${iconMarkup('arrow-right')}</b></button>
          <div class="refresh-profile-link" data-route="settings"><div class="refresh-avatar" data-user-initials></div><div class="refresh-profile-meta"><strong data-user-name></strong><span data-user-email></span></div><span>${iconMarkup('chevron-down')}</span></div>
        </div>
      </aside>
      <main class="refresh-main">
        <header class="refresh-topbar"><div class="refresh-top-title" id="refreshTopTitle">Campus hub</div><div class="refresh-top-actions"><button class="refresh-icon-btn" type="button" data-route="settings" aria-label="Settings & more" title="Settings & more">${iconMarkup('settings')}</button><button class="refresh-icon-btn" type="button" data-action="theme" aria-label="Toggle theme" title="Toggle theme">${themeIconMarkup(window.KlasoraBridge?.theme || 'dark')}</button></div></header>
        <div class="refresh-content" id="refreshContent"></div>
      </main>
      <nav class="refresh-mobile-menu" aria-label="Main navigation">${shortNav.map(id => { const item = navItems.find(entry => entry.id === id); return `<button type="button" data-route="${id}"><span>${iconMarkup(item.icon)}</span>${item.label}</button>`; }).join('')}</nav>`;
    content = shell.querySelector('#refreshContent');
    shell.addEventListener('click', onClick);
    shell.addEventListener('submit', onSubmit);
    shell.addEventListener('change', onChange);
    document.getElementById('appScreen').appendChild(shell);
  }

  function open() {
    if (!shell) makeShell();
    shell.style.display = '';
    document.getElementById('appScreen').classList.add('refresh-enabled');
    paintIdentity();
    const params = new URLSearchParams(window.location.search);
    pendingRoomId = params.get('roomId');
    if (params.get('calls') === '1') state.messageView = 'calls';
    if (pendingRoomId || params.has('calls')) {
      state.route = 'cliques';
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('roomId');
      cleanUrl.searchParams.delete('calls');
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }
    render();
    const inviteId = new URLSearchParams(window.location.search).get('joinClique');
    if (inviteId && !state.handledCliqueInvite) {
      state.handledCliqueInvite = true;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('joinClique');
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
      openCliqueInvite(inviteId);
    }
  }

  function navigate(route) {
    const app = document.getElementById('appScreen');
    if (shell?.style.display === 'none' || !app.classList.contains('refresh-enabled')) {
      app.classList.remove('refresh-legacy-mode');
      open();
    }
    if (route !== state.route) setRoute(route);
  }

  function paintIdentity() {
    const current = user();
    shell.querySelectorAll('[data-user-initials]').forEach(node => {
      node.innerHTML = pictureMarkup(current.profileImage, current.name);
    });
    shell.querySelectorAll('[data-user-name]').forEach(node => { node.textContent = current.name || 'Student'; });
    shell.querySelectorAll('[data-user-email]').forEach(node => { node.textContent = current.email || 'Your account'; });
  }

  function setRoute(route) {
    if (route === 'calls') {
      state.messageView = 'calls';
      route = 'cliques';
    }
    const conversationRoutes = ['cliqueChat', 'courseChat'];
    if (state.route !== route && (!conversationRoutes.includes(state.route) || !conversationRoutes.includes(route))) restoreCliqueChatSurface();
    state.route = route;
    state.modal = null;
    render();
  }

  function render() {
    if (!content || !shell) return;
    updateThemeIcon(window.KlasoraBridge?.theme || 'dark');
    updateTimerAlarm();
    const title = pageTitle(state.route);
    shell.querySelector('#refreshTopTitle').textContent = `Klasora  /  ${title}`;
    shell.querySelectorAll('[data-route]').forEach(button => button.classList.toggle('active', button.dataset.route === state.route || (state.route === 'post' && button.dataset.route === 'feed') || (state.route === 'assignment' && button.dataset.route === 'assignments') || (state.route === 'challenge' && button.dataset.route === 'focus') || (state.route === 'results' && button.dataset.route === 'focus') || (state.route === 'liveStudy' && button.dataset.route === 'cliques') || (state.route === 'cliqueChat' && button.dataset.route === 'cliques') || (state.route === 'courseChat' && button.dataset.route === 'courses') || (state.route === 'profile' && button.dataset.route === 'settings') || (state.route === 'preferences' && button.dataset.route === 'settings')));
    const renderers = {
      feed: renderFeed,
      post: renderPostDetail,
      cliques: renderCliques,
      cliqueChat: renderCliqueChat,
      courses: renderCourses,
      courseChat: renderCourseChat,
      settings: renderSettings,
      preferences: renderPreferences,
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

  function updateThemeIcon(theme = window.KlasoraBridge?.theme || 'dark') {
    const button = shell?.querySelector('.refresh-top-actions [data-action="theme"]');
    if (button) button.innerHTML = themeIconMarkup(theme);
    const appearance = content?.querySelector('.refresh-preference-icon');
    if (appearance) appearance.innerHTML = themeIconMarkup(theme);
  }

  function pageHeading(eyebrow, title, copy, action = '') {
    return `<div class="refresh-page-heading"><div><div class="refresh-eyebrow">${escapeHtml(eyebrow)}</div><h1 class="refresh-h1">${escapeHtml(title)}</h1><p class="refresh-heading-copy">${escapeHtml(copy)}</p></div>${action}</div>`;
  }

  function renderFeed() {
    const current = user();
    const firstName = (current.name || 'there').split(' ')[0];
    const requestId = ++state.feedRequestId;
    const savedPosts = localRead('posts');
    state.localPosts = (Array.isArray(savedPosts) ? savedPosts : []).map(post => ({ ...post, localOnly: true }));
    content.innerHTML = `
      ${pageHeading('Your campus, closer', `Good to see you, ${firstName}`, 'Ideas, study wins, and campus conversations — shared with your circle.', `<button class="refresh-primary" type="button" data-action="compose">${iconMarkup('plus')} Share a thought</button>`)}
      <div class="refresh-grid refresh-feed-layout">
        <section>
          <button class="refresh-composer" type="button" data-action="compose"><div class="refresh-avatar">${initials(current.name)}</div><div class="refresh-composer-copy">What would you like to share with your campus?</div><span class="refresh-primary">Create post</span></button>
          <div class="refresh-composer-hint"><span>${iconMarkup('sparkles')} Campus moments</span><span>${iconMarkup('images')} Study resources</span><span>${iconMarkup('message-circle')} Questions</span></div>
          <div style="height:16px"></div>
          <div class="refresh-loading">Loading campus posts…</div>
        </section>
        <aside class="refresh-side-stack">
          <div class="refresh-card refresh-capsule-card"><div class="refresh-capsule-label">A little focus goes far</div><div class="refresh-capsule-title">Start a study capsule</div><div class="refresh-capsule-copy">Choose your pace, settle in, and give your next task a little space.</div><button class="refresh-secondary" type="button" data-route="focus">Open study capsule ${iconMarkup('arrow-right')}</button></div>
          <div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Coming up</h2><button class="refresh-text-btn" data-route="assignments">See tasks</button></div><div class="refresh-mini-row"><div class="refresh-mini-icon">${iconMarkup('list-checks')}</div><div class="refresh-mini-copy"><strong>Keep your tasks in view</strong><span>Assignments and due dates from your courses</span></div></div><div class="refresh-mini-row"><div class="refresh-mini-icon">${iconMarkup('calendar-days')}</div><div class="refresh-mini-copy"><strong>Make time for class</strong><span>Your week at a glance in the timetable</span></div><button class="refresh-text-btn" data-route="timetable">Open</button></div></div>
          <div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Stay connected</h2><button class="refresh-text-btn" data-route="cliques">Open Cliques</button></div><p class="refresh-note" style="margin-top:0">Keep group conversations and direct messages together in your Cliques space.</p><button class="refresh-secondary" style="width:100%;margin-top:12px" type="button" data-route="courses">Browse courses</button></div>
        </aside>
      </div>`;
    api('/api/posts').then(posts => {
      if (requestId !== state.feedRequestId || state.route !== 'feed') return;
      state.posts = posts;
      renderFeedPosts(posts);
    }).catch(error => {
      if (requestId !== state.feedRequestId || state.route !== 'feed') return;
      const schemaRecovery = /community feed/i.test(error.message) && !/not configured/i.test(error.message)
        ? `<p>In the Supabase project connected to this backend, open <strong>Dashboard → SQL Editor → New query</strong>, run the current full <code>supabase/schema.sql</code> from GitHub, then select Try again.</p><a class="refresh-secondary" style="display:inline-flex;margin:0 0 10px" href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Open Supabase dashboard</a>`
        : '';
      content.querySelector('.refresh-feed-layout section').innerHTML = `<div class="refresh-empty"><strong>Could not load campus posts</strong><p>${escapeHtml(error.message)}</p>${schemaRecovery}<button class="refresh-secondary" type="button" data-action="retry-feed">Try again</button></div>${state.localPosts.length ? `<div class="refresh-section-head" style="margin:22px 0 12px"><h2>Older posts saved on this browser</h2></div><p class="refresh-note">These posts are visible only to you and have not been shared with campus.</p>${state.localPosts.map(post => postCard(post)).join('')}` : ''}`;
    });
  }

  function renderFeedPosts(posts) {
    const section = content?.querySelector('.refresh-feed-layout section');
    if (!section || state.route !== 'feed') return;
    section.innerHTML = `
      <button class="refresh-composer" type="button" data-action="compose"><div class="refresh-avatar">${initials(user().name)}</div><div class="refresh-composer-copy">What would you like to share with your campus?</div><span class="refresh-primary">Create post</span></button>
      <div class="refresh-composer-hint"><span>${iconMarkup('sparkles')} Campus moments</span><span>${iconMarkup('images')} Study resources</span><span>${iconMarkup('message-circle')} Questions</span></div>
      <div style="height:16px"></div>
      ${posts.length ? posts.map(postCard).join('') : `<div class="refresh-empty"><div class="refresh-empty-icon">${iconMarkup('sparkles')}</div><strong>Your campus feed starts here</strong><p>Share a study win, ask a question, or start a conversation with your campus.</p><div style="margin-top:14px"><button class="refresh-primary" type="button" data-action="compose">Write your first post</button></div></div>`}
      ${state.localPosts.length ? `<div class="refresh-section-head" style="margin:22px 0 12px"><h2>Older posts saved on this browser</h2></div><p class="refresh-note">These posts are visible only to you and have not been shared with campus.</p>${state.localPosts.map(post => postCard(post)).join('')}` : ''}`;
  }

  function postCard(post) {
    return `<article class="refresh-card refresh-post" data-open-post="${escapeHtml(post.id)}"><div class="refresh-post-head"><div class="refresh-avatar">${escapeHtml(post.initials)}</div><div class="refresh-post-user"><strong>${escapeHtml(post.name)}</strong><span>${escapeHtml(post.localOnly ? post.when || 'Saved on this browser' : fmtConversationTime(post.createdAt) || 'Just now')}</span></div><span class="refresh-post-tag">${escapeHtml(post.category || 'Campus')}</span></div><p class="refresh-post-text">${escapeHtml(post.text)}</p>${postMedia(post)}${postReactionBar(post)}<div class="refresh-post-actions"><button type="button" class="refresh-text-btn" data-action="open-post" data-id="${escapeHtml(post.id)}">${iconMarkup('message-circle')} ${post.commentCount || 0} ${post.category === 'Questions' ? 'answers' : 'replies'}</button><span class="refresh-note" style="margin:0 0 0 auto">${post.localOnly ? 'Only on this browser' : 'Shared with campus'}</span></div></article>`;
  }

  function postMedia(post) {
    const images = Array.isArray(post.images) ? post.images.filter(image => image && /^data:image\/(?:webp|jpeg|png);base64,/.test(image.src || '')) : [];
    if (!images.length) return '';
    return `<div class="refresh-post-media">${images.map((image, index) => `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `Photo ${index + 1} shared by ${post.name}`)}" loading="lazy">`).join('')}</div>`;
  }

  function postReactionBar(post) {
    const activeReaction = post.myReaction || (post.liked ? 'like' : '');
    return `<div class="refresh-reactions" aria-label="Reactions">${postReactions.map(reaction => {
      const count = Number(post.reactionCounts?.[reaction.id] ?? (reaction.id === 'like' && post.liked ? 1 : 0));
      const active = activeReaction === reaction.id;
      return `<button type="button" class="refresh-reaction${active ? ' active' : ''}" data-action="react" data-id="${escapeHtml(post.id)}" data-reaction="${reaction.id}" aria-pressed="${active}" aria-label="${reaction.label}${count ? `, ${count}` : ''}">${iconMarkup(reaction.icon)}<span>${count || reaction.label}</span></button>`;
    }).join('')}</div>`;
  }

  async function renderPostDetail() {
    const post = state.posts.find(item => item.id === state.activePost) || state.localPosts.find(item => item.id === state.activePost);
    if (!post) { content.innerHTML = '<div class="refresh-empty"><strong>Post not found</strong><p>This post is not available in the campus feed.</p><button class="refresh-secondary" type="button" data-route="feed">Back to Home</button></div>'; return; }
    const postId = state.activePost;
    if (post.localOnly) {
      const savedComments = localRead(`comments-${post.id}`);
      state.comments = Array.isArray(savedComments) ? savedComments : [];
      content.innerHTML = renderPostDetailContent(post, state.comments);
      return;
    }
    content.innerHTML = '<div class="refresh-loading">Loading conversation…</div>';
    let comments;
    try {
      comments = await api(`/api/posts/${encodeURIComponent(postId)}/comments`);
    } catch (error) {
      if (state.route !== 'post' || state.activePost !== postId) return;
      content.innerHTML = `<button class="refresh-detail-back" type="button" data-route="feed">${iconMarkup('arrow-left')} Back to Home</button><div class="refresh-empty"><strong>Could not load replies</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-post">Try again</button></div>`;
      return;
    }
    if (state.route !== 'post' || state.activePost !== postId) return;
    state.comments = comments;
    content.innerHTML = renderPostDetailContent(post, comments);
  }

  function renderPostDetailContent(post, comments) {
    const answerMode = post.category === 'Questions';
    return `<button class="refresh-detail-back" type="button" data-route="feed">${iconMarkup('arrow-left')} Back to Home</button><article class="refresh-card refresh-post"><div class="refresh-post-head"><div class="refresh-avatar">${escapeHtml(post.initials)}</div><div class="refresh-post-user"><strong>${escapeHtml(post.name)}</strong><span>${escapeHtml(post.localOnly ? post.when || 'Saved on this browser' : fmtConversationTime(post.createdAt) || 'Just now')}</span></div><span class="refresh-post-tag">${escapeHtml(post.category || 'Campus')}</span></div><p class="refresh-post-text">${escapeHtml(post.text)}</p>${postMedia(post)}${postReactionBar(post)}<div class="refresh-post-actions"><span class="refresh-note" style="margin:0">${answerMode ? 'Question for the community' : 'Campus conversation'}</span><span class="refresh-note" style="margin:0 0 0 auto">${post.localOnly ? 'Only on this browser' : 'Shared with campus'}</span></div></article><section class="refresh-card refresh-card-pad" style="margin-top:15px"><div class="refresh-section-head"><h2>${answerMode ? 'Answers' : 'Conversation'}</h2><span>${comments.length} ${answerMode ? 'answers' : 'replies'}${post.localOnly ? ' · this browser' : ''}</span></div><form class="refresh-modal-form" data-form="comment"><textarea name="comment" placeholder="${answerMode ? 'Share an answer…' : 'Add to the conversation…'}" required maxlength="500"></textarea><div style="display:flex;justify-content:flex-end"><button class="refresh-primary" type="submit">${answerMode ? 'Post answer' : 'Add reply'}</button></div></form><div class="refresh-comments">${comments.length ? comments.map(comment => `<div class="refresh-comment"><div class="refresh-avatar">${escapeHtml(comment.initials)}</div><p><strong>${escapeHtml(comment.name)}</strong><br>${escapeHtml(comment.text)}</p></div>`).join('') : `<p class="refresh-note">No ${answerMode ? 'answers' : 'replies' } yet. Be the first to respond.</p>`}</div></section>`;
  }

  async function renderCliques() {
    const view = state.messageView;
    const isGroups = view === 'groups';
    const isCalls = view === 'calls';
    if (isCalls) {
      renderCalls();
      return;
    }
    const action = isGroups
      ? `<div class="refresh-inline-actions"><button class="refresh-secondary" type="button" data-action="discover-cliques">${iconMarkup('search')} Discover</button><button class="refresh-secondary" type="button" data-action="clique-requests">Requests</button><button class="refresh-primary" type="button" data-action="create-clique">${iconMarkup('plus')} Create clique</button></div>`
      : `<button class="refresh-primary" type="button" data-action="new-dm">${iconMarkup('plus')} New message</button>`;
    const viewTitle = isGroups ? 'Your groups' : 'Direct messages';
    const viewCopy = isGroups ? 'Study and chat together' : 'One-to-one conversations';
    content.innerHTML = `${pageHeading('Your people', 'Cliques', 'Keep group conversations and direct messages together, like one familiar chat space.', action)}${messageTabs()}<div class="refresh-card refresh-chat-directory"><div class="refresh-chat-directory-heading"><div><strong>${viewTitle}</strong><span>${viewCopy}</span></div></div><div class="refresh-chat-directory-list"><div class="refresh-loading">Loading conversations…</div></div></div>`;
    try {
      const [cliques, dms] = await Promise.all([api('/api/cliques'), api('/api/dms')]);
      state.cliques = cliques;
      state.dms = dms.map(item => ({ ...item, _chatType: 'dm' }));
      if (state.route !== 'cliques' || state.messageView !== view) return;
      content.querySelector('.refresh-chat-directory-list').innerHTML = renderMessageRows(isGroups ? state.cliques : state.dms, isGroups ? 'clique' : 'dm');
      if (pendingRoomId) {
        const roomId = pendingRoomId;
        pendingRoomId = null;
        const conversation = [...state.cliques, ...state.dms].find(item => item._id === roomId);
        if (conversation) openConversationChat(conversation, state.cliques.some(item => item._id === roomId) ? 'clique' : 'dm');
        else toast('That conversation is no longer available.');
      }
    } catch (error) {
      if (state.route === 'cliques' && state.messageView === view) content.querySelector('.refresh-chat-directory-list').innerHTML = `<div class="refresh-empty"><strong>Could not load conversations</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-cliques">Try again</button></div>`;
    }
  }

  function messageTabs() {
    return `<div class="refresh-segmented refresh-message-tabs" role="tablist" aria-label="Clique area"><button type="button" role="tab" aria-selected="${state.messageView === 'groups'}" class="${state.messageView === 'groups' ? 'active' : ''}" data-action="message-view" data-view="groups">Groups</button><button type="button" role="tab" aria-selected="${state.messageView === 'direct'}" class="${state.messageView === 'direct' ? 'active' : ''}" data-action="message-view" data-view="direct">Direct</button><button type="button" role="tab" aria-selected="${state.messageView === 'calls'}" class="${state.messageView === 'calls' ? 'active' : ''}" data-action="message-view" data-view="calls">Calls</button></div>`;
  }

  async function renderCalls() {
    content.innerHTML = `${pageHeading('Your people', 'Cliques', 'Keep group conversations, direct messages, and calls together in one place.', `<button class="refresh-primary" type="button" data-action="call-people">${iconMarkup('plus')} New call</button>`)}${messageTabs()}<div class="refresh-calls-toolbar"><label class="refresh-call-search"><span aria-hidden="true">${iconMarkup('search')}</span><input type="search" data-call-search placeholder="Search calls and people" value="${escapeHtml(state.callSearch)}" aria-label="Search calls and people"></label><div class="refresh-segmented" role="tablist" aria-label="Filter calls"><button type="button" role="tab" aria-selected="${state.callFilter === 'all'}" class="${state.callFilter === 'all' ? 'active' : ''}" data-action="call-filter" data-filter="all">All</button><button type="button" role="tab" aria-selected="${state.callFilter === 'missed'}" class="${state.callFilter === 'missed' ? 'active' : ''}" data-action="call-filter" data-filter="missed">Missed</button></div></div><div class="refresh-call-layout"><section class="refresh-card refresh-call-list"><div class="refresh-chat-directory-heading"><div><strong>${state.callFilter === 'missed' ? 'Missed calls' : 'Recent calls'}</strong><span>Call activity is saved on this device</span></div></div><div id="refreshCallRows"><div class="refresh-loading">Loading your conversations…</div></div></section><aside class="refresh-card refresh-call-details"><div class="refresh-preference-icon">${iconMarkup('phone')}</div><h2>Call someone</h2><p>Choose a person from your direct conversations to start a voice or video call.</p><button class="refresh-secondary" type="button" data-action="call-people">Open Direct messages</button></aside></div>`;
    try {
      state.dms = (await api('/api/dms')).map(item => ({ ...item, _chatType: 'dm' }));
      if (state.route !== 'cliques' || state.messageView !== 'calls') return;
      renderCallRows();
    } catch (error) {
      if (state.route === 'cliques' && state.messageView === 'calls') content.querySelector('#refreshCallRows').innerHTML = `<div class="refresh-empty"><strong>Could not load conversations</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-calls">Try again</button></div>`;
    }
  }

  function renderCallRows() {
    const savedHistory = localRead('call-history');
    const history = Array.isArray(savedHistory) ? savedHistory : [];
    const matchingHistory = history.filter(entry => (state.callFilter !== 'missed' || entry.status === 'missed') && String(entry.name || '').toLowerCase().includes(state.callSearch.toLowerCase()));
    const matchedDms = state.dms.filter(dm => {
      const person = dm.members?.find(member => member._id !== user()._id) || dm.members?.[0];
      return person?.name?.toLowerCase().includes(state.callSearch.toLowerCase());
    });
    const logs = matchingHistory.map(entry => {
      const stateLabel = ({ missed: 'Missed', declined: 'Declined', failed: 'Failed', cancelled: 'Cancelled' })[entry.status] || (entry.mode === 'video' ? 'Video call' : 'Voice call');
      const duration = entry.duration ? ` · ${String(Math.floor(entry.duration / 60)).padStart(2, '0')}:${String(entry.duration % 60).padStart(2, '0')}` : '';
      const person = state.dms.flatMap(dm => dm.members || []).find(member => String(member._id) === String(entry.userId));
      return `<article class="refresh-call-row"><div class="refresh-avatar refresh-dm-emblem">${pictureMarkup(person?.profileImage, entry.name)}</div><div class="refresh-call-person"><strong>${escapeHtml(entry.name)}</strong><span class="refresh-call-meta ${entry.status === 'missed' ? 'missed' : ''}">${entry.direction === 'incoming' ? `${iconMarkup('arrow-down-left')} Incoming` : `${iconMarkup('arrow-up-right')} Outgoing`} · ${escapeHtml(stateLabel)}${escapeHtml(duration)} · ${escapeHtml(new Date(entry.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span></div><div class="refresh-call-actions"><button type="button" class="refresh-call-action" data-action="call-dm" data-user-id="${escapeHtml(entry.userId)}" data-call-type="voice" aria-label="Voice call ${escapeHtml(entry.name)}">${iconMarkup('phone')}</button><button type="button" class="refresh-call-action" data-action="call-dm" data-user-id="${escapeHtml(entry.userId)}" data-call-type="video" aria-label="Video call ${escapeHtml(entry.name)}">${iconMarkup('video')}</button></div></article>`;
    }).join('');
    const contacts = state.callFilter === 'missed' ? '' : matchedDms.filter(dm => !matchingHistory.some(entry => entry.userId === (dm.members?.find(member => member._id !== user()._id) || dm.members?.[0])?._id)).map(dm => {
      const person = dm.members?.find(member => member._id !== user()._id) || dm.members?.[0];
      return `<article class="refresh-call-row"><div class="refresh-avatar refresh-dm-emblem">${pictureMarkup(person?.profileImage, person?.name)}</div><div class="refresh-call-person"><strong>${escapeHtml(person?.name || 'Klasora member')}</strong><span class="refresh-call-meta">${person?.online ? `${iconMarkup('circle')} Online · ` : ''}Available from Direct messages</span></div><div class="refresh-call-actions"><button type="button" class="refresh-call-action" data-action="call-dm" data-user-id="${escapeHtml(person?._id || '')}" data-call-type="voice" aria-label="Voice call ${escapeHtml(person?.name)}">${iconMarkup('phone')}</button><button type="button" class="refresh-call-action" data-action="call-dm" data-user-id="${escapeHtml(person?._id || '')}" data-call-type="video" aria-label="Video call ${escapeHtml(person?.name)}">${iconMarkup('video')}</button></div></article>`;
    }).join('');
    const empty = state.callFilter === 'missed' ? 'No missed calls match this search.' : 'No calls or direct conversations match this search.';
    content.querySelector('#refreshCallRows').innerHTML = `${logs}${contacts}${logs || contacts ? '' : `<div class="refresh-empty"><strong>${empty}</strong><p>Open your direct messages to start a conversation.</p><button class="refresh-primary" type="button" data-action="call-people">Open Direct messages</button></div>`}`;
  }

  function renderMessageRows(items, type) {
    if (!items.length) {
      return `<div class="refresh-empty"><div class="refresh-empty-icon">${iconMarkup(type === 'clique' ? 'users-round' : 'mail')}</div><strong>${type === 'clique' ? 'No cliques yet' : 'No direct messages yet'}</strong><p>${type === 'clique' ? 'Create a group to study and talk together.' : 'Start a direct conversation with someone at Klasora.'}</p><button class="refresh-primary" type="button" data-action="${type === 'clique' ? 'create-clique' : 'new-dm'}">${iconMarkup('plus')} ${type === 'clique' ? 'Create clique' : 'New message'}</button></div>`;
    }
    return items.map((item, index) => {
      const other = type === 'dm' ? item.members?.find(member => member._id !== user()._id) || item.members?.[0] : null;
      const title = type === 'dm' ? other?.name || 'Direct message' : item.name;
      const preview = item.lastMsg || 'No messages yet';
      const mark = type === 'dm' ? pictureMarkup(other?.profileImage, title) : iconMarkup(item.emoji || 'users-round');
      const unread = unreadCount(item._id);
      const row = `<button type="button" class="refresh-clique-chat-row${item._id === state.activeConversation?._id ? ' active' : ''}" data-action="open-conversation" data-type="${type}" data-index="${index}" data-room-id="${escapeHtml(item._id)}"><span class="refresh-clique-emblem${type === 'dm' ? ' refresh-dm-emblem' : ''}">${mark}</span><span class="refresh-row-info"><span class="refresh-row-heading"><strong>${escapeHtml(title)}</strong><time class="refresh-row-time">${escapeHtml(fmtConversationTime(item.lastAt))}</time></span><span class="refresh-row-preview" title="${escapeHtml(preview)}">${escapeHtml(preview)}</span></span>${unread ? `<span class="refresh-unread-badge" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</span>` : ''}</button>`;
      return row;
    }).join('');
  }

  function renderCliqueChat() {
    const isGroups = state.messageView === 'groups';
    const items = isGroups ? state.cliques : state.dms;
    const type = isGroups ? 'clique' : 'dm';
    const heading = state.activeConversation ? (isGroups ? 'Group conversation' : 'Direct conversation') : 'Conversations';
    content.innerHTML = `${pageHeading('Your people', heading, 'Chat with a clique or message someone directly.', `<button class="refresh-secondary" type="button" data-action="back-conversations">${iconMarkup('arrow-left')} Back to Cliques</button>`)}${messageTabs()}<div class="refresh-clique-chat-layout"><section class="refresh-card refresh-clique-chat-list"><div class="refresh-chat-directory-heading"><div><strong>${isGroups ? 'Your groups' : 'Direct messages'}</strong><span>${items.length} conversations</span></div><button class="refresh-icon-btn" type="button" data-action="${isGroups ? 'create-clique' : 'new-dm'}" aria-label="${isGroups ? 'Create clique' : 'New message'}">${iconMarkup('plus')}</button></div>${renderMessageRows(items, type)}</section>${state.activeConversation ? '<div class="refresh-clique-chat-mount" id="refreshCliqueChatMount"></div><aside class="refresh-clique-chat-details" id="refreshCliqueChatDetails"></aside>' : '<div class="refresh-card refresh-chat-placeholder"><strong>Select a conversation</strong><span>Open a group or direct chat to see its messages and details.</span></div>'}</div>`;
    if (!state.activeConversation) return;
    mountConversationSurface();
  }

  function renderCourses() {
    content.innerHTML = `${pageHeading('Your classes', 'Courses', 'Keep class conversations, classmates, files, and assignments together.', `<button class="refresh-primary" type="button" data-action="create-course">${iconMarkup('plus')} Create course</button>`)}<div class="refresh-course-list"><div class="refresh-loading">Loading your courses…</div></div>`;
    api('/api/courses').then(courses => {
      state.courses = courses;
      if (state.route !== 'courses') return;
      content.querySelector('.refresh-course-list').innerHTML = courses.length ? courses.map((course, index) => `<article class="refresh-card refresh-course-row"><div class="refresh-course-mark">${iconMarkup('book-open')}</div><div class="refresh-row-info"><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(course.code || course.description || 'Course space')} · ${course.members?.length || 0} classmates</span>${course.description ? `<p>${escapeHtml(course.description)}</p>` : ''}</div><button class="refresh-primary" type="button" data-action="open-course" data-index="${index}">Open course ${iconMarkup('arrow-right')}</button></article>`).join('') : `<div class="refresh-empty"><div class="refresh-empty-icon">${iconMarkup('book-open')}</div><strong>No courses yet</strong><p>Create a course space to bring classmates, course chat, files, notes, and assignments together.</p><button class="refresh-primary" type="button" data-action="create-course">${iconMarkup('plus')} Create course</button></div>`;
    }).catch(error => {
      if (state.route === 'courses') content.querySelector('.refresh-course-list').innerHTML = `<div class="refresh-empty"><strong>Could not load courses</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-courses">Try again</button></div>`;
    });
  }

  function renderCourseChat() {
    const activeId = state.activeConversation?._id;
    content.innerHTML = `${pageHeading('Your classes', state.activeConversation?.name || 'Course spaces', 'Course conversations, classmates, shared files, and assignment shortcuts.', `<div class="refresh-inline-actions"><button class="refresh-secondary" type="button" data-route="assignments">Assignments & tasks</button><button class="refresh-secondary" type="button" data-route="courses">${iconMarkup('arrow-left')} Back to Courses</button></div>`)}<div class="refresh-course-chat-layout"><section class="refresh-card refresh-clique-chat-list"><div class="refresh-chat-directory-heading"><div><strong>Your courses</strong><span>${state.courses.length} spaces</span></div><button class="refresh-icon-btn" type="button" data-action="create-course" aria-label="Create course">${iconMarkup('plus')}</button></div>${state.courses.length ? state.courses.map((course, index) => `<button type="button" class="refresh-clique-chat-row${course._id === activeId ? ' active' : ''}" data-action="open-course" data-type="course" data-index="${index}"><span class="refresh-clique-emblem refresh-course-emblem">${iconMarkup('book-open')}</span><span class="refresh-row-info"><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(course.code || course.description || 'Course space')}</span></span></button>`).join('') : `<div class="refresh-empty"><strong>No courses yet</strong><p>Create a course space to begin.</p><button class="refresh-primary" type="button" data-action="create-course">${iconMarkup('plus')} Create course</button></div>`}</section>${state.activeConversation ? '<div class="refresh-clique-chat-mount" id="refreshCliqueChatMount"></div><aside class="refresh-clique-chat-details" id="refreshCliqueChatDetails"></aside>' : '<div class="refresh-card refresh-chat-placeholder"><strong>Select a course</strong><span>Course chat and details will appear here.</span></div>'}</div>`;
    if (state.activeConversation) mountConversationSurface();
  }

  function mountConversationSurface() {
    const app = document.getElementById('appScreen');
    const chatArea = app.querySelector(':scope > .chat-area');
    const details = app.querySelector(':scope > .workspace-details');
    const modalIds = ['membersModal', 'courseFilesModal'];
    content.querySelector('#refreshCliqueChatMount').appendChild(chatArea);
    content.querySelector('#refreshCliqueChatDetails').appendChild(details);
    modalIds.forEach(id => {
      const modal = document.getElementById(id);
      if (modal) document.body.appendChild(modal);
    });
    window.KlasoraBridge?.renderWorkspaceDetails?.(state.activeConversation);
  }

  function restoreCliqueChatSurface() {
    const app = document.getElementById('appScreen');
    if (!app || !shell) return;
    const chatArea = app.querySelector('.chat-area');
    const details = app.querySelector('.workspace-details');
    if (chatArea && chatArea.parentElement !== app) app.insertBefore(chatArea, shell);
    if (details && details.parentElement !== app) app.insertBefore(details, shell);
    app.classList.remove('clique-chat-active', 'refresh-conversation-active', 'mobile-chat-active');
  }

  function openCliqueChat(clique, cliques) {
    if (!clique) return;
    if (Array.isArray(cliques)) state.cliques = cliques;
    if (!state.cliques.some(item => item._id === clique._id)) state.cliques.push(clique);
    state.messageView = 'groups';
    openConversationChat(state.cliques.find(item => item._id === clique._id) || clique, 'clique');
  }

  function openConversationChat(item, type) {
    if (!item) return;
    const route = type === 'course' ? 'courseChat' : 'cliqueChat';
    const collection = type === 'course' ? state.courses : type === 'dm' ? state.dms : state.cliques;
    const currentItem = collection.find(entry => entry._id === item._id) || item;
    state.activeConversation = { ...currentItem, _chatType: type };
    clearUnread(currentItem._id);
    if (type === 'clique') {
      state.activeClique = state.activeConversation;
      state.messageView = 'groups';
    } else if (type === 'dm') {
      state.messageView = 'direct';
    }
    const app = document.getElementById('appScreen');
    if (shell.style.display === 'none' || !app.classList.contains('refresh-enabled')) {
      app.classList.remove('refresh-legacy-mode');
      open();
    }
    app.classList.add('refresh-conversation-active');
    if (state.route !== route) setRoute(route);
    else {
      content.querySelectorAll('.refresh-clique-chat-row').forEach(button => {
        const active = button.dataset.type === type && button.dataset.index === String(collection.indexOf(currentItem));
        button.classList.toggle('active', active);
        if (active) button.querySelector('.refresh-unread-badge')?.remove();
      });
      window.KlasoraBridge?.renderWorkspaceDetails?.(state.activeConversation);
    }
    const items = type === 'course' ? state.courses : type === 'dm' ? state.dms : state.cliques;
    window.KlasoraBridge?.openRefreshedChat?.(state.activeConversation, items);
  }

  function backToConversations() {
    if (state.route === 'cliqueChat') {
      if (state.returnToCalls) state.messageView = 'calls';
      state.returnToCalls = false;
      setRoute('cliques');
    }
    else if (state.route === 'courseChat') setRoute('courses');
  }

  function openCourseChat(course) {
    if (!course) return;
    openConversationChat(course, 'course');
  }

  function renderSettings() {
    content.innerHTML = `${pageHeading('Your account', 'Settings & more', 'Manage your academic profile and the controls around your Klasora experience.')}<div class="refresh-settings-grid"><button class="refresh-card refresh-settings-card" type="button" data-route="profile"><span class="refresh-settings-icon">${iconMarkup('user-round')}</span><span><strong>Academic profile</strong><small>Add your course, level, institution, and profile photo.</small></span><b>${iconMarkup('arrow-right')}</b></button><button class="refresh-card refresh-settings-card" type="button" data-route="preferences"><span class="refresh-settings-icon">${iconMarkup('settings')}</span><span><strong>Preferences & notifications</strong><small>Choose your theme and manage message notifications.</small></span><b>${iconMarkup('arrow-right')}</b></button><button class="refresh-card refresh-settings-card" type="button" data-action="logout"><span class="refresh-settings-icon">${iconMarkup('log-out')}</span><span><strong>Sign out</strong><small>Sign out of this Klasora account.</small></span><b>${iconMarkup('arrow-right')}</b></button></div>`;
  }

  function renderPreferences() {
    const theme = window.KlasoraBridge?.theme || 'dark';
    const notificationsEnabled = window.KlasoraBridge?.notificationsEnabled ?? true;
    content.innerHTML = `${pageHeading('Make Klasora yours', 'Preferences & notifications', 'Your appearance and chat and call alerts, clearly organized.', `<button class="refresh-secondary" type="button" data-route="settings">${iconMarkup('arrow-left')} Settings & more</button>`)}<div class="refresh-preferences-grid"><section class="refresh-card refresh-preference-card"><div class="refresh-preference-icon">${themeIconMarkup(theme)}</div><div class="refresh-preference-copy"><h2>Appearance</h2><p>Choose the Klasora color theme that feels right for you.</p><span class="refresh-preference-current">Current theme · ${theme === 'dark' ? 'Dark' : 'Light'}</span></div><button class="refresh-secondary" type="button" data-action="theme">Switch to ${theme === 'dark' ? 'light' : 'dark'} theme</button></section><section class="refresh-card refresh-preference-card"><div class="refresh-preference-icon">${iconMarkup('bell')}</div><div class="refresh-preference-copy"><h2>Chat & call notifications</h2><p>Get alerts for new messages and missed calls. Browser permission may also be required.</p><span class="refresh-preference-current">${notificationsEnabled ? 'Notifications are on' : 'Notifications are paused'}</span></div><label class="refresh-toggle"><input type="checkbox" data-action="notifications" ${notificationsEnabled ? 'checked' : ''}><span aria-hidden="true"></span><b>${notificationsEnabled ? 'On' : 'Off'}</b></label></section></div>`;
  }

  function renderLiveStudy() {
    const clique = state.activeClique || {};
    const members = clique.members || [];
    content.innerHTML = `${pageHeading('Together, with focus', 'Live study room', `A shared study space for ${clique.name || 'your clique'}.`, `<button class="refresh-secondary" type="button" data-route="cliques">${iconMarkup('arrow-left')} Back to cliques</button>`)}<div class="refresh-grid refresh-timer-layout"><section class="refresh-card refresh-timer-card"><div class="refresh-timer-label">Clique focus session · local preview</div><div class="refresh-timer-ring"><div class="refresh-timer" id="timerDigits">${fmtClock(state.timer.remaining)}</div></div><div class="refresh-note">Your group conversation is part of the Clique space. Live presence and shared timers are not connected to the server.</div><div class="refresh-timer-actions"><button class="refresh-primary" type="button" data-action="${state.timer.running ? 'pause-timer' : 'start-live'}">${state.timer.running ? `${iconMarkup('pause')} Pause group session` : 'Start group session'}</button><button class="refresh-secondary" type="button" data-action="clique-chat">Open clique chat</button><button class="refresh-secondary" type="button" data-action="solo">Solo focus</button></div></section><aside class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Study circle</h2><span>${members.length} members</span></div>${members.length ? members.slice(0,8).map(member => `<div class="refresh-mini-row"><div class="refresh-avatar">${pictureMarkup(member.profileImage, member.name)}</div><div class="refresh-mini-copy"><strong>${escapeHtml(member.name || 'Clique member')}</strong><span>Member</span></div></div>`).join('') : '<div class="refresh-empty"><strong>Members appear here</strong><p>Open the clique chat to see its current group details.</p></div>'}</aside></div>`;
  }

  function renderFocus() {
    const presets = [{ label: 'Quick reset', minutes: 15 }, { label: 'Classic', minutes: 25 }, { label: 'Deep work', minutes: 50 }];
    const duration = Math.max(1, state.timer.duration);
    const progress = Math.max(0, Math.min(100, 100 * (1 - state.timer.remaining / duration)));
    content.innerHTML = `${pageHeading('Find your rhythm', 'Study capsule', 'Choose a session length, then focus on one thing at a time.', `<button class="refresh-secondary" type="button" data-action="challenge">${iconMarkup('zap')} Take a focus challenge</button>`)}<div class="refresh-grid refresh-timer-layout"><section class="refresh-card refresh-timer-card"><div class="refresh-timer-label">${state.timer.running ? 'You’re in a focus session' : 'Your next focused session'}</div><div class="refresh-timer-ring"><div class="refresh-timer" id="timerDigits">${fmtClock(state.timer.remaining)}</div></div><div class="refresh-progress"><i id="timerProgress" style="width:${progress}%"></i></div>${manualTimerControls()}<div class="refresh-presets">${presets.map(preset => `<button type="button" class="refresh-chip${duration === preset.minutes * 60 && state.timer.mode === 'capsule' ? ' active' : ''}" data-action="preset" data-minutes="${preset.minutes}">${preset.label} · ${preset.minutes}m</button>`).join('')}</div><div class="refresh-timer-actions"><button class="refresh-primary" type="button" data-action="${state.timer.running ? 'pause-timer' : 'start-timer'}">${state.timer.running ? `${iconMarkup('pause')} Pause` : `${iconMarkup('play')} Start focus`}</button><button class="refresh-secondary" type="button" data-action="reset-timer">${iconMarkup('rotate-ccw')} Reset</button></div><p class="refresh-note">Completed focus sessions are recorded with your Klasora focus stats. The timer continues while you navigate away or switch tabs, but stops when you close this page.</p></section><aside class="refresh-side-stack"><div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Make it a challenge</h2><span>25 minutes</span></div><p class="refresh-note" style="margin-top:0">Set one goal and see it through. Your result is personal to this session.</p><button class="refresh-primary" style="width:100%;margin-top:13px" type="button" data-action="challenge">Start challenge ${iconMarkup('arrow-right')}</button></div><div class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Study together</h2></div><p class="refresh-note" style="margin-top:0">Choose a clique to open a local shared-study preview. Presence syncing is not available yet.</p><button class="refresh-secondary" style="width:100%;margin-top:13px" type="button" data-route="cliques">Choose a clique</button></div></aside></div>`;
  }

  function manualTimerControls() {
    const hours = Math.floor(state.timer.duration / 3600);
    const minutes = Math.floor((state.timer.duration % 3600) / 60);
    const seconds = state.timer.duration % 60;
    const disabled = state.timer.running ? ' disabled' : '';
    return `<div class="refresh-manual-timer"><span>Set your own time</span><div class="refresh-manual-timer-fields"><label for="timerHours">Hours<input id="timerHours" type="number" min="0" step="1" value="${hours}"${disabled}></label><label for="timerMinutes">Minutes<input id="timerMinutes" type="number" min="0" max="59" step="1" value="${minutes}"${disabled}></label><label for="timerSeconds">Seconds<input id="timerSeconds" type="number" min="0" max="59" step="1" value="${seconds}"${disabled}></label><button class="refresh-secondary" type="button" data-action="set-manual-timer"${disabled}>Set time</button></div></div>`;
  }

  function renderChallenge() {
    if (state.timer.goal && (state.challengeStartedAt || state.timer.running)) {
      const elapsed = Math.floor((state.timer.duration - state.timer.remaining) / 60);
      const progress = 100 * (1 - state.timer.remaining / state.timer.duration);
      content.innerHTML = `${pageHeading('One thing at a time', 'Challenge in progress', 'Keep going at your own pace. You can pause or reset this browser timer.', '<button class="refresh-secondary" type="button" data-route="focus">Exit challenge</button>')}<div class="refresh-card refresh-timer-card" style="max-width:680px;margin:0 auto"><div class="refresh-timer-label">Your goal · started ${elapsed} minute${elapsed === 1 ? '' : 's'} ago</div><h2 style="margin-top:9px;font:700 18px Outfit,sans-serif">${escapeHtml(state.timer.goal)}</h2><div class="refresh-timer-ring"><div class="refresh-timer" id="timerDigits">${fmtClock(state.timer.remaining)}</div></div><div class="refresh-progress"><i id="timerProgress" style="width:${progress}%"></i></div><div class="refresh-timer-actions"><button class="refresh-primary" type="button" data-action="${state.timer.running ? 'pause-timer' : 'start-timer'}">${state.timer.running ? `${iconMarkup('pause')} Pause challenge` : `${iconMarkup('play')} Resume challenge`}</button><button class="refresh-secondary" type="button" data-action="reset-timer">${iconMarkup('rotate-ccw')} Reset</button></div><p class="refresh-note">Your timer continues while you navigate away or switch tabs, but stops when you close this page.</p></div>`;
      return;
    }
    content.innerHTML = `${pageHeading('A small commitment', 'Focus challenge', 'Pick one clear goal, then work on it without distraction.', `<button class="refresh-secondary" type="button" data-route="focus">${iconMarkup('arrow-left')} Back to capsule</button>`)}<div class="refresh-card refresh-card-pad" style="max-width:680px;margin:0 auto"><div class="refresh-eyebrow">25 minute challenge</div><h2 style="margin-top:8px;font:700 21px Outfit,sans-serif">What will you focus on?</h2><p class="refresh-heading-copy">This goal stays in this browser. You can update it before the timer starts.</p><form class="refresh-modal-form" data-form="challenge"><label class="refresh-form-label" for="challengeGoal">Your focus goal</label><textarea id="challengeGoal" name="goal" maxlength="160" placeholder="e.g. Review my lecture notes for biology" required></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="refresh-primary" type="submit">Begin challenge ${iconMarkup('arrow-right')}</button></div></form></div>`;
  }

  function renderResults() {
    const elapsed = Math.floor((state.timer.duration - state.timer.remaining) / 60) || Math.floor(state.timer.duration / 60);
    content.innerHTML = `${pageHeading('Nice work', 'Session complete', 'You made space for focused work. Take a moment before moving on.', '<button class="refresh-secondary" type="button" data-route="focus">Back to study capsule</button>')}<div class="refresh-card refresh-card-pad" style="max-width:720px;margin:0 auto"><div class="refresh-stats"><div class="refresh-stat"><span>Focus time</span><strong>${elapsed || 1}m</strong></div><div class="refresh-stat"><span>Session</span><strong>${iconMarkup('check')}</strong></div><div class="refresh-stat"><span>Mode</span><strong>${iconMarkup(state.timer.mode === 'challenge' ? 'zap' : 'circle-dot')}</strong></div></div><h2 style="margin-top:22px;font:700 17px Outfit,sans-serif">${state.timer.mode === 'challenge' ? 'Challenge complete' : 'A good session, done.'}</h2><p class="refresh-heading-copy">${state.timer.goal ? escapeHtml(state.timer.goal) : 'Your completed focus session has been recorded.'}</p><div class="refresh-timer-actions" style="justify-content:flex-start"><button class="refresh-primary" type="button" data-action="again">Start another session</button><button class="refresh-secondary" type="button" data-route="feed">Back to Home</button></div></div>`;
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
    content.innerHTML = `${pageHeading('Plan your week', 'Timetable', 'A simple weekly view for classes, study blocks, and campus plans.', `<button class="refresh-primary" type="button" data-action="add-event">${iconMarkup('plus')} Add to timetable</button>`)}<div class="refresh-card refresh-card-pad"><div class="refresh-week">${week.map(date => `<button class="refresh-day${date.getDay() === state.selectedDay ? ' active' : ''}" type="button" data-action="select-day" data-day="${date.getDay()}"><strong>${date.toLocaleDateString(undefined,{weekday:'short'})}</strong><span>${date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></button>`).join('')}</div><div class="refresh-timeline"><div class="refresh-times">${hours.map(hour => `<span>${hour}</span>`).join('')}</div><div class="refresh-slots">${events.length ? events.map(event => { const [hour, minute] = event.time.split(':').map(Number); const row = Math.max(1, Math.min(20, (hour - 8) * 2 + Math.floor(minute / 30) + 1)); return `<div class="refresh-event" style="grid-row:${row}/span 2" title="${escapeHtml(event.title)}">${escapeHtml(event.time)} · ${escapeHtml(event.title)}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</div>`; }).join('') : `<div class="refresh-empty" style="align-self:start;margin:35px 10px"><strong>No plans for ${selected.toLocaleDateString(undefined,{weekday:'long'})}</strong><p>Add a class or study block to this browser-only timetable.</p></div>`}</div></div><p class="refresh-note">Timetable entries are saved in this browser only; there is no timetable service connected yet.</p></div>`;
  }

  async function renderProfile() {
    const currentUser = user();
    content.innerHTML = `
      ${pageHeading('Your learning identity', 'Academic profile', 'A home for the details and campus activity you choose to share.', `<div class="refresh-inline-actions"><button class="refresh-secondary" type="button" data-route="settings">${iconMarkup('arrow-left')} Settings & more</button></div>`)}
      <section class="refresh-card refresh-profile-banner">
        <div class="refresh-avatar refresh-avatar-lg refresh-profile-photo" id="profilePhotoPreview">${pictureMarkup(currentUser.profileImage, currentUser.name)}</div>
        <div class="refresh-profile-banner-copy">
          <span class="refresh-profile-eyebrow">${iconMarkup('graduation-cap')} Academic identity</span>
          <h2 id="profileHeadingName">${escapeHtml(currentUser.name || 'Student')}</h2>
          <p id="profileAcademicSummary">Add your course and institution to complete your learning identity.</p>
          <div class="refresh-profile-trust"><span>${iconMarkup('user-round')} Self-reported details</span><span id="profileInstitutionSummary"></span></div>
        </div>
        <div class="refresh-profile-banner-action">
          <label class="refresh-secondary refresh-photo-upload" for="profilePicture">${iconMarkup('camera')} Change photo</label>
          <input id="profilePicture" type="file" accept="image/*" hidden>
          <small>Image file · up to 10 MB</small>
        </div>
      </section>
      <div class="refresh-grid refresh-stats refresh-profile-stats">
        <div class="refresh-stat"><span>Course spaces</span><strong id="profileCourseStat">—</strong><small>Joined courses</small></div>
        <div class="refresh-stat"><span>Recent posts</span><strong id="profilePostStat">—</strong><small>Among the latest 100 feed posts</small></div>
        <div class="refresh-stat"><span>Focus sessions</span><strong id="profileFocusStat">—</strong><small>Completed on this account</small></div>
        <div class="refresh-stat"><span>Today</span><strong id="profileTodayStat">—</strong><small>Completed focus sessions</small></div>
      </div>
      <p class="refresh-note refresh-profile-stats-note">Study streaks, mentors, and followers aren't tracked yet.</p>
      <div class="refresh-grid refresh-profile-grid">
        <section class="refresh-card refresh-profile-edit-card">
          <div class="refresh-card-pad">
            <div class="refresh-section-head"><div><h2>Academic details</h2><p>Institution, faculty, department, programme, level, and student number stay private.</p></div><span class="refresh-post-tag">Self-reported</span></div>
            <div class="refresh-field-grid">
              <div class="refresh-field"><label for="profileName">Full name</label><input id="profileName" maxlength="80" autocomplete="name" placeholder="Your full name"></div>
              <div class="refresh-field"><label for="profileEmail">Account email</label><input id="profileEmail" value="${escapeHtml(currentUser.email || '')}" disabled></div>
              <div class="refresh-field"><label for="profileInstitution">University / institution</label><input id="profileInstitution" list="nigerianUniversityOptions" maxlength="180" autocomplete="organization" placeholder="Search or type your university"><datalist id="nigerianUniversityOptions"></datalist><small class="refresh-field-hint" id="universityDirectoryStatus">Loading NUC university directory…</small><small class="refresh-field-hint">If your university isn't listed, type its name.</small></div>
              <div class="refresh-field"><label for="profileFaculty">Faculty / college</label><input id="profileFaculty" maxlength="120" placeholder="Enter your faculty or college" disabled><small class="refresh-field-hint">No verified university-specific list is available yet.</small></div>
              <div class="refresh-field"><label for="profileDepartment">Department</label><input id="profileDepartment" maxlength="120" placeholder="Enter your department" disabled><small class="refresh-field-hint">Enter the department under your selected faculty or college.</small></div>
              <div class="refresh-field"><label for="profileCourseOfStudy">Course of study / programme</label><input id="profileCourseOfStudy" maxlength="120" placeholder="Enter your course or programme" disabled></div>
              <div class="refresh-field"><label for="profileLevel">Level</label><input id="profileLevel" maxlength="60" placeholder="e.g., 300 Level"></div>
              <div class="refresh-field"><label for="profileMatriculationNumber">Matriculation number</label><input id="profileMatriculationNumber" maxlength="80" autocomplete="off"></div>
              <div class="refresh-field refresh-profile-bio"><label for="profileBio">About you (optional)</label><textarea id="profileBio" maxlength="240" placeholder="A short introduction"></textarea></div>
            </div>
            <p class="refresh-note">The university list is a snapshot from the NUC directory. The NUC does not publish a unified faculty, department, or programme catalog, so enter the exact names used by your school. Klasora does not verify enrollment or awards; these details are private to your account. Save profile to approve and store your changes.</p>
          </div>
          <div class="refresh-profile-save-row"><span id="profileSaveStatus" role="status" aria-live="polite"></span><button class="refresh-primary" type="button" data-action="save-profile">Save academic details</button></div>
        </section>
        <aside class="refresh-profile-side">
          <section class="refresh-card refresh-card-pad">
            <div class="refresh-section-head"><div><h2>Your course spaces</h2><p>Study spaces you belong to.</p></div><span id="profileCourseCount">Loading…</span></div>
            <div id="profileCourses" class="refresh-clique-list"><div class="refresh-note">Loading courses…</div></div>
            <button class="refresh-secondary refresh-profile-open-courses" type="button" data-route="courses">Open courses</button>
          </section>
          <section class="refresh-card refresh-card-pad">
            <div class="refresh-section-head"><div><h2>Recent contributions</h2><p>Your latest posts in the campus feed.</p></div><span id="profileRecentCount">—</span></div>
            <div id="profilePosts" class="refresh-profile-posts"><div class="refresh-note">Loading posts…</div></div>
          </section>
        </aside>
      </div>`;
    try {
      const current = await window.KlasoraBridge.getProfile();
      if (state.route !== 'profile') return;
      currentUser.profileImage = current.profileImage || null;
      paintIdentity();
      window.KlasoraBridge.refreshProfileIdentity?.();
      const photo = state.profileImageDraft !== null ? state.profileImageDraft : current.profileImage;
      content.querySelector('#profileHeadingName').textContent = current.name || 'Student';
      content.querySelector('#profilePhotoPreview').innerHTML = pictureMarkup(photo, current.name);
      content.querySelector('#profileAcademicSummary').textContent = [current.courseOfStudy, current.department, current.faculty, current.level].filter(Boolean).join(' · ') || 'Add your course and institution to complete your learning identity.';
      content.querySelector('#profileInstitutionSummary').textContent = current.institution || '';
      content.querySelector('#profileName').value = current.name || '';
      content.querySelector('#profileCourseOfStudy').value = current.courseOfStudy || '';
      content.querySelector('#profileLevel').value = current.level || '';
      content.querySelector('#profileMatriculationNumber').value = current.matriculationNumber || '';
      content.querySelector('#profileInstitution').value = current.institution || '';
      content.querySelector('#profileFaculty').value = current.faculty || '';
      content.querySelector('#profileDepartment').value = current.department || '';
      content.querySelector('#profileBio').value = current.bio || '';
      syncAcademicProfileFields();
      loadUniversityDirectory().catch(error => {
        const status = content.querySelector('#universityDirectoryStatus');
        if (state.route === 'profile' && status) status.textContent = `University list unavailable: ${error.message}. You can still type your institution.`;
      });
    } catch (error) {
      if (state.route === 'profile') {
        content.innerHTML += `<p class="refresh-note">Could not load profile details: ${escapeHtml(error.message)}</p>`;
        return;
      }
    }
    try {
      state.courses = await api('/api/courses');
      if (state.route !== 'profile') return;
      content.querySelector('#profileCourseCount').textContent = `${state.courses.length} spaces`;
      content.querySelector('#profileCourseStat').textContent = state.courses.length;
      content.querySelector('#profileCourses').innerHTML = state.courses.length ? state.courses.slice(0, 5).map(course => `<div class="refresh-mini-row"><div class="refresh-mini-icon">${iconMarkup('graduation-cap')}</div><div class="refresh-mini-copy"><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(course.code || 'Course space')}</span></div></div>`).join('') : '<div class="refresh-note">No course spaces yet.</div>';
    } catch (error) {
      if (state.route === 'profile') {
        content.querySelector('#profileCourseCount').textContent = 'Unavailable';
        content.querySelector('#profileCourseStat').textContent = '—';
        content.querySelector('#profileCourses').innerHTML = `<div class="refresh-note">Could not load courses: ${escapeHtml(error.message)}</div>`;
      }
    }
    try {
      const posts = await api('/api/posts');
      if (state.route !== 'profile') return;
      const recentPosts = posts.filter(post => post.userId === currentUser._id).slice(0, 3);
      const recentPostCount = posts.filter(post => post.userId === currentUser._id).length;
      content.querySelector('#profilePostStat').textContent = recentPostCount;
      content.querySelector('#profileRecentCount').textContent = `${recentPosts.length} shown`;
      content.querySelector('#profilePosts').innerHTML = recentPosts.length
        ? recentPosts.map(post => `<article class="refresh-profile-post"><span>${escapeHtml(post.category || 'Campus')} · ${escapeHtml(fmtConversationTime(post.createdAt) || 'Recently')}</span><p>${escapeHtml(post.text)}</p></article>`).join('')
        : '<div class="refresh-note">No recent posts in the campus feed.</div>';
    } catch (error) {
      if (state.route === 'profile') {
        content.querySelector('#profilePostStat').textContent = '—';
        content.querySelector('#profileRecentCount').textContent = 'Unavailable';
        content.querySelector('#profilePosts').innerHTML = `<div class="refresh-note">Could not load recent posts: ${escapeHtml(error.message)}</div>`;
      }
    }
    try {
      const stats = await api('/api/pomodoro/stats');
      if (state.route !== 'profile') return;
      const totalSessions = Number(stats.totalSessions);
      const sessionsToday = Number(stats.sessionsToday);
      content.querySelector('#profileFocusStat').textContent = stats.totalSessions != null && Number.isFinite(totalSessions) && totalSessions >= 0 ? totalSessions : '—';
      content.querySelector('#profileTodayStat').textContent = stats.sessionsToday != null && Number.isFinite(sessionsToday) && sessionsToday >= 0 ? sessionsToday : '—';
    } catch (error) {
      if (state.route === 'profile') {
        content.querySelector('#profileFocusStat').textContent = '—';
        content.querySelector('#profileTodayStat').textContent = '—';
        content.querySelector('#profileFocusStat').title = error.message;
      }
    }
  }

  async function renderAssignments() {
    if (!content || !shell || state.route !== 'assignments') return;
    content.innerHTML = `${pageHeading('Keep your momentum', 'Assignments & tasks', 'Your course deadlines and personal tasks, without the last-minute scramble.', `<button class="refresh-primary" type="button" data-action="add-assignment">${iconMarkup('plus')} Add assignment</button>`)}<div class="refresh-grid refresh-stats" style="margin-bottom:17px"><div class="refresh-stat"><span>To do</span><strong id="assignmentTodo">—</strong></div><div class="refresh-stat"><span>Completed</span><strong id="assignmentDone">—</strong></div><div class="refresh-stat"><span>Upcoming</span><strong id="assignmentUpcoming">—</strong></div></div><div class="refresh-assignment-list"><div class="refresh-loading">Loading assignments…</div></div>`;
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
      list.innerHTML = assignments.length ? assignments.map((item, index) => `<article class="refresh-assignment-row"><button type="button" class="refresh-chip${item.done ? ' active' : ''}" data-action="toggle-assignment" data-id="${escapeHtml(item._id)}" aria-label="${item.done ? 'Mark incomplete' : 'Mark complete'}">${iconMarkup(item.done ? 'check' : 'circle')}</button><div class="refresh-row-info" data-action="open-assignment" data-index="${index}" style="cursor:pointer"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.subject || 'Personal task')} · Due ${escapeHtml(fmtDate(item.dueDate))}</span></div><span class="refresh-post-tag">${escapeHtml(item.priority || 'medium')}</span><button class="refresh-text-btn" type="button" data-action="open-assignment" data-index="${index}">Details ${iconMarkup('arrow-right')}</button></article>`).join('') : `<div class="refresh-empty"><div class="refresh-empty-icon">${iconMarkup('check')}</div><strong>Nothing on your list yet</strong><p>Add an assignment to keep the deadline, course, and next step together.</p></div>`;
    } catch (error) {
      if (state.route === 'assignments') content.querySelector('.refresh-assignment-list').innerHTML = `<div class="refresh-empty"><strong>Could not load assignments</strong><p>${escapeHtml(error.message)}</p><button class="refresh-secondary" type="button" data-action="retry-assignments">Try again</button></div>`;
    }
  }

  function renderAssignmentDetail() {
    const item = state.activeAssignment;
    if (!item) { content.innerHTML = '<div class="refresh-empty"><strong>Assignment not found</strong><p>Return to your assignments list to choose a task.</p><button class="refresh-secondary" data-route="assignments">Assignments</button></div>'; return; }
    content.innerHTML = `<button class="refresh-detail-back" type="button" data-route="assignments">${iconMarkup('arrow-left')} Back to assignments</button>${pageHeading(escapeHtml(item.subject || 'Personal task'), item.title, 'Assignment details and the next step you can take.', `<button class="refresh-primary" type="button" data-action="toggle-assignment" data-id="${escapeHtml(item._id)}">${item.done ? 'Mark as to do' : `${iconMarkup('check')} Mark complete`}</button>`)}<div class="refresh-grid refresh-profile-grid"><section class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Task details</h2><span class="refresh-post-tag">${escapeHtml(item.priority || 'medium')} priority</span></div><div class="refresh-mini-row"><div class="refresh-mini-icon">${iconMarkup('calendar-days')}</div><div class="refresh-mini-copy"><strong>Due date</strong><span>${escapeHtml(fmtDate(item.dueDate))}</span></div></div><div class="refresh-mini-row"><div class="refresh-mini-icon">${iconMarkup('graduation-cap')}</div><div class="refresh-mini-copy"><strong>Course</strong><span>${escapeHtml(item.course?.name || item.subject || 'Personal assignment')}</span></div></div><div class="refresh-mini-row"><div class="refresh-mini-icon">${iconMarkup('pencil')}</div><div class="refresh-mini-copy"><strong>Notes</strong><span>${escapeHtml(item.notes || 'No notes added yet.')}</span></div></div><button class="refresh-primary" style="margin-top:18px" type="button" data-action="breakdown" data-id="${escapeHtml(item._id)}">${iconMarkup('sparkles')} Break this down</button><div id="assignmentPlan" class="refresh-note"></div></section><aside class="refresh-card refresh-card-pad"><div class="refresh-section-head"><h2>Make a start</h2></div><p class="refresh-note" style="margin-top:0">A focused session can make a big task feel more manageable.</p><button class="refresh-secondary" style="width:100%;margin-top:13px" type="button" data-route="focus">Start a study capsule</button></aside></div>`;
  }

  function openModal(type, data = {}) {
    state.modal = { type, images: [], ...data };
    renderModal();
  }

  async function loadCliqueDiscovery(query = '') {
    if (state.modal?.type !== 'clique-discover') return;
    state.modal.loading = true;
    state.modal.query = query;
    state.modal.error = null;
    renderModal();
    try {
      const cliques = await api(`/api/cliques/discover${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (state.modal?.type !== 'clique-discover') return;
      state.modal.cliques = cliques;
      state.modal.loading = false;
      renderModal();
    } catch (error) {
      if (state.modal?.type !== 'clique-discover') return;
      state.modal.loading = false;
      state.modal.error = error.message;
      renderModal();
    }
  }

  function renderDiscoveredCliques(cliques) {
    if (state.modal?.error) return `<div class="refresh-empty"><strong>Could not load cliques</strong><p>${escapeHtml(state.modal.error)}</p><button class="refresh-secondary" type="button" data-action="discover-cliques">Try again</button></div>`;
    if (!cliques.length) return '<div class="refresh-empty"><strong>No public cliques found</strong><p>Try another search, or create a clique and choose Public so others can discover it.</p></div>';
    return cliques.map(clique => {
      const requestStatus = clique.myRequestStatus;
      const button = requestStatus === 'pending'
        ? '<button class="refresh-secondary" type="button" disabled>Request sent</button>'
        : `<button class="refresh-primary" type="button" data-action="join-clique" data-id="${escapeHtml(clique._id)}">${requestStatus === 'declined' ? 'Request again' : 'Join clique'}</button>`;
      return `<article class="refresh-discovery-card"><div class="refresh-clique-emblem">${iconMarkup(clique.emoji || 'users-round')}</div><div class="refresh-discovery-copy"><strong>${escapeHtml(clique.name)}</strong><p>${escapeHtml(clique.description || 'A public Klasora clique.')}</p><small>${clique.memberCount} ${clique.memberCount === 1 ? 'member' : 'members'} · Public</small></div>${button}</article>`;
    }).join('');
  }

  function renderCliqueRequests(requests) {
    if (state.modal?.error) return `<div class="refresh-empty"><strong>Could not load requests</strong><p>${escapeHtml(state.modal.error)}</p><button class="refresh-secondary" type="button" data-action="clique-requests">Try again</button></div>`;
    if (!requests.length) return '<div class="refresh-empty"><strong>No pending join requests</strong><p>Requests for private cliques you created will appear here.</p></div>';
    return requests.map(request => `<article class="refresh-discovery-card"><div class="refresh-avatar">${escapeHtml(initials(request.user?.name))}</div><div class="refresh-discovery-copy"><strong>${escapeHtml(request.user?.name || 'Klasora member')}</strong><p>Wants to join <b>${escapeHtml(request.cliqueName)}</b></p><small>Requested ${escapeHtml(fmtDate(request.createdAt))}</small></div><div class="refresh-inline-actions"><button class="refresh-secondary" type="button" data-action="decline-clique-request" data-clique-id="${escapeHtml(request.cliqueId)}" data-user-id="${escapeHtml(request.user?._id)}">Decline</button><button class="refresh-primary" type="button" data-action="approve-clique-request" data-clique-id="${escapeHtml(request.cliqueId)}" data-user-id="${escapeHtml(request.user?._id)}">Approve</button></div></article>`).join('');
  }

  function renderCliquePins(pins) {
    if (state.modal?.error) return `<div class="refresh-empty"><strong>Could not load pinned messages</strong><p>${escapeHtml(state.modal.error)}</p><button class="refresh-secondary" type="button" data-action="clique-pins">Try again</button></div>`;
    if (!pins.length) return '<div class="refresh-empty"><strong>No pinned messages yet</strong><p>Admins can pin useful messages from the message menu.</p></div>';
    const canManage = isCliqueAdmin();
    return pins.map(pin => `<article class="refresh-discovery-card"><div class="refresh-pin-mark">${iconMarkup('locate-fixed')}</div><div class="refresh-discovery-copy"><strong>${escapeHtml(pin.message?.senderName || 'Clique member')}</strong><p>${escapeHtml(pin.message?.text || pin.message?.fileName || 'Attachment')}</p><small>Pinned ${escapeHtml(fmtDate(pin.createdAt))}</small></div>${canManage ? `<button class="refresh-secondary" type="button" data-action="unpin-clique-message" data-message-id="${escapeHtml(pin.messageId)}">Unpin</button>` : ''}</article>`).join('');
  }

  async function openCliqueInvite(inviteId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inviteId)) {
      toast('This clique invite link is invalid.');
      return;
    }
    try {
      const clique = await api(`/api/cliques/${encodeURIComponent(inviteId)}/invite`);
      openModal('clique-invite', { clique });
    } catch (error) {
      toast(`Could not open clique invite: ${error.message}`);
    }
  }

  function isCliqueAdmin() {
    const clique = state.activeConversation?._chatType === 'clique'
      ? state.activeConversation
      : state.cliques.find(item => item._id === state.activeConversation?._id);
    return String(clique?.createdBy || '') === String(user()._id || '');
  }

  async function openCliquePins() {
    const clique = state.activeConversation;
    if (!clique || clique._chatType !== 'clique') return;
    openModal('clique-pins', { loading: true, pins: [] });
    try {
      const pins = await api(`/api/cliques/${encodeURIComponent(clique._id)}/pins`);
      if (state.modal?.type !== 'clique-pins') return;
      state.modal.pins = pins;
      state.modal.loading = false;
      renderModal();
    } catch (error) {
      if (state.modal?.type !== 'clique-pins') return;
      state.modal.loading = false;
      state.modal.error = error.message;
      renderModal();
    }
  }

  async function pinCliqueMessage(messageId) {
    const clique = state.activeConversation;
    if (!clique || clique._chatType !== 'clique' || !isCliqueAdmin()) return;
    try {
      await api(`/api/cliques/${encodeURIComponent(clique._id)}/pins/${encodeURIComponent(messageId)}`, 'POST');
      toast('Message pinned for this clique.');
    } catch (error) {
      toast(`Could not pin message: ${error.message}`);
    }
  }

  async function loadCliqueRequests() {
    openModal('clique-requests', { loading: true, requests: [] });
    try {
      const requests = await api('/api/cliques/join-requests');
      if (state.modal?.type !== 'clique-requests') return;
      state.modal.requests = requests;
      state.modal.loading = false;
      renderModal();
    } catch (error) {
      if (state.modal?.type !== 'clique-requests') return;
      state.modal.loading = false;
      state.modal.error = error.message;
      renderModal();
    }
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
    const header = (title, copy) => `<div class="refresh-modal-head"><div><h2>${title}</h2><p>${copy}</p></div><button type="button" class="refresh-icon-btn" data-close-modal aria-label="Close">${iconMarkup('x')}</button></div>`;
    const footer = submit => `<div class="refresh-modal-footer"><button type="button" class="refresh-secondary" data-close-modal>Cancel</button><button type="submit" class="refresh-primary">${submit}</button></div>`;
    if (modal.type === 'post') return `<section class="refresh-modal refresh-post-modal">${header('Share with your campus','Text posts are shared with all Klasora members. Photos are coming later.')}<form class="refresh-modal-form" data-form="post"><label class="refresh-form-label" for="postCategory">Post type</label><select id="postCategory" name="category"><option value="Campus">Campus moment</option><option value="Study resources">Study resource</option><option value="Questions">Question</option><option value="Wins">Study win</option></select><label class="refresh-form-label" for="postText">Your post</label><textarea id="postText" name="text" maxlength="800" required placeholder="What’s on your mind?"></textarea>${footer('Share post')}</form></section>`;
    if (modal.type === 'comment') return '';
    if (modal.type === 'clique') return `<section class="refresh-modal">${header('Create a clique','Choose who can discover and join your group.')}<form class="refresh-modal-form" data-form="clique"><label class="refresh-form-label" for="cliqueNameNew">Clique name</label><input id="cliqueNameNew" name="name" required maxlength="60" placeholder="e.g. Biology study group"><label class="refresh-form-label" for="cliqueDescriptionNew">About this clique</label><textarea id="cliqueDescriptionNew" name="description" maxlength="300" placeholder="What will your clique study or discuss?"></textarea><label class="refresh-form-label" for="cliqueVisibilityNew">Who can join?</label><select id="cliqueVisibilityNew" name="visibility"><option value="private" selected>Private · request approval or use an invite link</option><option value="public">Public · anyone can discover and join</option></select><fieldset class="refresh-icon-picker"><legend class="refresh-form-label">Choose an icon</legend><div class="refresh-clique-icon-grid">${cliqueIcons.map((icon, index) => `<label class="refresh-clique-icon-option"><input type="radio" name="emoji" value="${icon.id}" ${index === 0 ? 'checked' : ''}><span>${iconMarkup(icon.id)}<small>${icon.label}</small></span></label>`).join('')}</div></fieldset><label class="refresh-form-label" for="cliqueMembersNew">Invite by email <span class="refresh-note">(optional, comma separated)</span></label><input id="cliqueMembersNew" name="emails" type="text" placeholder="classmate@example.com">${footer('Create clique')}</form></section>`;
    if (modal.type === 'clique-discover') return `<section class="refresh-modal">${header('Discover public cliques','Find a study group or campus community to join.')}<form class="refresh-modal-form" data-form="clique-search"><label class="refresh-form-label" for="cliqueSearch">Search cliques</label><div class="refresh-inline-actions"><input id="cliqueSearch" name="query" maxlength="80" placeholder="Search name or topic" value="${escapeHtml(modal.query || '')}"><button type="submit" class="refresh-secondary">Search</button></div></form><div class="refresh-clique-modal-list">${modal.loading ? '<div class="refresh-loading">Looking for public cliques…</div>' : renderDiscoveredCliques(modal.cliques || [])}</div></section>`;
    if (modal.type === 'clique-requests') return `<section class="refresh-modal">${header('Join requests','Review people asking to join your private cliques.')}<div class="refresh-clique-modal-list">${modal.loading ? '<div class="refresh-loading">Loading requests…</div>' : renderCliqueRequests(modal.requests || [])}</div></section>`;
    if (modal.type === 'clique-invite') return `<section class="refresh-modal">${header('Join a clique', 'You were invited to connect with this group.')}<div class="refresh-discovery-card"><div class="refresh-clique-emblem">${iconMarkup(modal.clique?.emoji || 'users-round')}</div><div><strong>${escapeHtml(modal.clique?.name || 'Clique invite')}</strong><p>${escapeHtml(modal.clique?.description || 'Join the conversation with this clique.')}</p><small>${modal.clique?.visibility === 'public' ? 'Public clique · join now' : 'Private clique · your request will need approval'}</small></div></div><div class="refresh-modal-footer"><button type="button" class="refresh-secondary" data-close-modal>Not now</button><button type="button" class="refresh-primary" data-action="confirm-clique-invite">Continue</button></div></section>`;
    if (modal.type === 'clique-pins') return `<section class="refresh-modal">${header('Pinned messages','Important messages saved for everyone in this clique.')}<div class="refresh-clique-modal-list">${modal.loading ? '<div class="refresh-loading">Loading pinned messages…</div>' : renderCliquePins(modal.pins || [])}</div></section>`;
    if (modal.type === 'dm') return `<section class="refresh-modal">${header('New direct message','Enter the email address of the person you want to message.')}<form class="refresh-modal-form" data-form="dm"><label class="refresh-form-label" for="newDmEmail">Email address</label><input id="newDmEmail" name="email" type="email" required autocomplete="email" placeholder="classmate@example.com">${footer('Open conversation')}</form></section>`;
    if (modal.type === 'course') return `<section class="refresh-modal">${header('Create a course space','Bring course conversations, classmates, files, notes, and assignments together.')}<form class="refresh-modal-form" data-form="course"><label class="refresh-form-label" for="newCourseName">Course name</label><input id="newCourseName" name="name" required maxlength="100" placeholder="e.g. Biology 101"><label class="refresh-form-label" for="newCourseCode">Course code</label><input id="newCourseCode" name="code" maxlength="30" placeholder="e.g. BIO 101"><label class="refresh-form-label" for="newCourseDescription">Description</label><textarea id="newCourseDescription" name="description" maxlength="500" placeholder="Optional course details"></textarea>${footer('Create course')}</form></section>`;
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
        const post = await api('/api/posts', 'POST', { text: data.text.trim(), category: data.category || 'Campus' });
        handlePostEvent('post_created', post);
        shell.querySelector('.refresh-modal-backdrop')?.remove();
        state.modal = null;
        render();
        toast('Your post was shared with campus.');
      } else if (form.dataset.form === 'comment') {
        const postId = state.activePost;
        const localPost = state.localPosts.find(item => item.id === postId);
        if (localPost) {
          const savedComments = localRead(`comments-${postId}`);
          const comments = Array.isArray(savedComments) ? savedComments : [];
          comments.push({ id: crypto.randomUUID(), name: user().name || 'Student', initials: initials(user().name), text: data.comment.trim(), when: new Date().toISOString() });
          localWrite(`comments-${postId}`, comments);
          localPost.commentCount = comments.length;
          localWrite('posts', state.localPosts.map(({ localOnly, ...post }) => post));
          state.comments = comments;
          renderPostDetail();
          toast('Your reply was saved on this browser.');
          return;
        }
        const comment = await api(`/api/posts/${encodeURIComponent(postId)}/comments`, 'POST', { text: data.comment.trim() });
        handlePostEvent('post_comment_created', { postId, comment });
        toast('Your reply was shared.');
      } else if (form.dataset.form === 'event') {
        const events = localRead('events');
        events.push({ id: crypto.randomUUID(), title: data.title.trim(), date: data.date, time: data.time, location: data.location.trim() });
        localWrite('events', events);
        state.selectedDay = new Date(`${data.date}T12:00:00`).getDay();
        state.modal = null;
        render();
        toast('Timetable entry saved in this browser.');
      } else if (form.dataset.form === 'clique') {
        const emails = [...new Set(data.emails.split(',').map(email => email.trim().toLowerCase()).filter(Boolean))];
        const members = await Promise.all(emails.map(email => api(`/api/users/search?email=${encodeURIComponent(email)}`)));
        const clique = await api('/api/cliques', 'POST', {
          name: data.name.trim(),
          description: data.description.trim(),
          visibility: data.visibility,
          emoji: data.emoji || 'book-open',
          memberIds: members.map(member => member._id)
        });
        state.cliques = [clique, ...state.cliques.filter(item => item._id !== clique._id)];
        state.modal = null;
        toast('Clique created.');
        openConversationChat(state.cliques.find(item => item._id === clique._id) || clique, 'clique');
      } else if (form.dataset.form === 'clique-search') {
        state.modal.error = null;
        await loadCliqueDiscovery(data.query.trim());
      } else if (form.dataset.form === 'dm') {
        const email = data.email.trim().toLowerCase();
        if (email === String(user().email || '').toLowerCase()) throw new Error("You can't start a direct message with yourself.");
        const person = await api(`/api/users/search?email=${encodeURIComponent(email)}`);
        const conversation = await api('/api/dms', 'POST', { otherUserId: person._id });
        const dm = { ...conversation, _chatType: 'dm' };
        state.dms = [dm, ...state.dms.filter(item => item._id !== dm._id)];
        state.modal = null;
        openConversationChat(dm, 'dm');
      } else if (form.dataset.form === 'course') {
        const course = await api('/api/courses', 'POST', { name: data.name.trim(), code: data.code.trim(), description: data.description.trim() });
        state.courses = [course, ...state.courses.filter(item => item._id !== course._id)];
        state.modal = null;
        openCourseChat(state.courses.find(item => item._id === course._id) || course);
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
    else if (action === 'retry-feed') renderFeed();
    else if (action === 'retry-post') renderPostDetail();
    else if (action === 'create-clique') openModal('clique');
    else if (action === 'discover-cliques') {
      if (state.modal?.type === 'clique-discover') loadCliqueDiscovery(state.modal.query || '');
      else {
        openModal('clique-discover');
        loadCliqueDiscovery();
      }
    }
    else if (action === 'clique-requests') loadCliqueRequests();
    else if (action === 'join-clique') {
      const clique = state.modal?.cliques?.find(item => item._id === id);
      if (!clique) return;
      try {
        const result = await api(`/api/cliques/${encodeURIComponent(id)}/join`, 'POST', {});
        clique.myRequestStatus = result.status === 'pending' ? 'pending' : null;
        if (result.status === 'joined') {
          state.cliques = await api('/api/cliques');
          toast(`You joined ${clique.name}.`);
        } else if (result.status === 'pending') toast('Your request was sent to the clique admin.');
        else toast('You are already a member of this clique.');
        renderModal();
      } catch (error) { toast(`Could not join clique: ${error.message}`); }
    }
    else if (action === 'approve-clique-request' || action === 'decline-clique-request') {
      const decision = action === 'approve-clique-request' ? 'approve' : 'decline';
      try {
        await api(`/api/cliques/${encodeURIComponent(target.dataset.cliqueId)}/join-requests/${encodeURIComponent(target.dataset.userId)}`, 'POST', { action: decision });
        await loadCliqueRequests();
        toast(decision === 'approve' ? 'Join request approved.' : 'Join request declined.');
      } catch (error) { toast(`Could not ${decision} request: ${error.message}`); }
    }
    else if (action === 'confirm-clique-invite') {
      const clique = state.modal?.clique;
      if (!clique) return;
      try {
        const result = await api(`/api/cliques/${encodeURIComponent(clique._id)}/join`, 'POST', {});
        state.modal = null;
        shell.querySelector('.refresh-modal-backdrop')?.remove();
        if (result.status === 'joined' || result.status === 'member') {
          state.cliques = await api('/api/cliques');
          const joined = state.cliques.find(item => item._id === clique._id);
          if (joined) openConversationChat(joined, 'clique');
          toast(result.status === 'member' ? 'You are already in this clique.' : `You joined ${clique.name}.`);
        } else toast('Your request was sent to the clique admin.');
      } catch (error) { toast(`Could not join clique: ${error.message}`); }
    }
    else if (action === 'clique-pins') openCliquePins();
    else if (action === 'unpin-clique-message') {
      const clique = state.activeConversation;
      if (!clique || !isCliqueAdmin()) return;
      try {
        await api(`/api/cliques/${encodeURIComponent(clique._id)}/pins/${encodeURIComponent(target.dataset.messageId)}`, 'DELETE');
        await openCliquePins();
        toast('Pinned message removed.');
      } catch (error) { toast(`Could not unpin message: ${error.message}`); }
    }
    else if (action === 'new-dm') openModal('dm');
    else if (action === 'create-course') openModal('course');
    else if (action === 'message-view') {
      state.messageView = target.dataset.view;
      state.returnToCalls = false;
      state.activeConversation = null;
      setRoute('cliques');
    }
    else if (action === 'call-people') {
      state.messageView = 'direct';
      state.returnToCalls = false;
      setRoute('cliques');
    }
    else if (action === 'open-conversation') {
      const type = target.dataset.type;
      const collection = type === 'dm' ? state.dms : state.cliques;
      openConversationChat(collection[Number(target.dataset.index)], type);
    }
    else if (action === 'call-dm') {
      const dm = target.dataset.userId
        ? state.dms.find(item => (item.members?.find(member => member._id !== user()._id) || item.members?.[0])?._id === target.dataset.userId)
        : state.dms[Number(target.dataset.index)];
      const returnToCalls = state.messageView === 'calls';
      state.returnToCalls = false;
      try {
        if (!dm) throw new Error('The direct conversation is no longer available.');
        if (typeof window.KlasoraBridge?.startRefreshedCall !== 'function') throw new Error('Call controls are unavailable.');
        state.returnToCalls = returnToCalls;
        await window.KlasoraBridge.startRefreshedCall(dm, state.dms, target.dataset.callType);
      } catch (error) {
        state.returnToCalls = false;
        if (returnToCalls) {
          state.messageView = 'calls';
          setRoute('cliques');
        }
        toast(`Could not start call: ${error.message}`);
      }
    }
    else if (action === 'open-study') openClique(state.cliques[Number(target.dataset.index)]);
    else if (action === 'open-course') openCourseChat(state.courses[Number(target.dataset.index)]);
    else if (action === 'back-conversations') backToConversations();
    else if (action === 'logout') window.KlasoraBridge?.logout?.();
    else if (action === 'add-event') openModal('event');
    else if (action === 'add-assignment') {
      try { state.courses = await api('/api/courses'); } catch (error) { toast(`Could not load courses: ${error.message}`); }
      openModal('assignment');
    } else if (action === 'open-post') openPost(id);
    else if (action === 'react') toggleReaction(id, target.dataset.reaction);
    else if (action === 'theme') { window.KlasoraBridge?.toggleTheme(); if (state.route === 'preferences') renderPreferences(); }
    else if (action === 'retry-cliques') renderCliques();
    else if (action === 'retry-calls') renderCalls();
    else if (action === 'call-filter') {
      state.callFilter = target.dataset.filter;
      renderCalls();
    }
    else if (action === 'retry-courses') renderCourses();
    else if (action === 'retry-assignments') renderAssignments();
    else if (action === 'start-live') startLiveSession();
    else if (action === 'clique-chat') {
      openCliqueChat(state.activeClique);
    }
    else if (action === 'solo') setRoute('focus');
    else if (action === 'challenge') {
      if (state.timer.running) {
        toast('Pause or finish your current session before starting a challenge.');
        return;
      }
      state.timer.mode = 'challenge';
      state.timer.goal = '';
      state.timer.duration = 25 * 60;
      state.timer.remaining = state.timer.duration;
      state.timer.completionStarted = false;
      state.challengeStartedAt = null;
      state.timer.running = false;
      setRoute('challenge');
    }
    else if (action === 'preset') setPreset(Number(target.dataset.minutes));
    else if (action === 'set-manual-timer') {
      const duration = window.KlasoraTimerClock.durationSeconds({
        hours: content.querySelector('#timerHours')?.valueAsNumber,
        minutes: content.querySelector('#timerMinutes')?.valueAsNumber,
        seconds: content.querySelector('#timerSeconds')?.valueAsNumber
      });
      if (duration === null) {
        toast('Enter a positive duration with whole hours and minutes or seconds below 60.');
        return;
      }
      state.timer.mode = 'capsule';
      state.timer.duration = duration;
      state.timer.remaining = duration;
      state.timer.completionStarted = false;
      renderFocus();
    }
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

  async function onChange(event) {
    const target = event.target;
    if (['profileInstitution', 'profileFaculty', 'profileDepartment'].includes(target.id)) {
      const changedField = {
        profileInstitution: 'institution',
        profileFaculty: 'faculty',
        profileDepartment: 'department'
      }[target.id];
      window.KlasoraAcademicProfileFields.resetAfterEdit(getAcademicProfileFields(), changedField);
    } else if (target.matches('[data-call-search]')) {
      state.callSearch = target.value;
      renderCallRows();
    } else if (target.matches('[data-action="notifications"]')) {
      target.disabled = true;
      try {
        await window.KlasoraBridge.setNotificationPreference(target.checked);
        renderPreferences();
      } catch (error) {
        target.checked = !target.checked;
        target.disabled = false;
        toast(`Could not update notifications: ${error.message}`);
      }
    } else if (target.matches('#profilePicture')) {
      const file = target.files?.[0];
      if (!file) return;
      try {
        state.profileImageDraft = await compressProfileImage(file);
        const preview = content.querySelector('#profilePhotoPreview');
        if (preview) preview.innerHTML = `<img src="${state.profileImageDraft}" alt="Profile photo preview">`;
      } catch (error) {
        target.value = '';
        toast(`Could not use that photo: ${error.message}`);
      }
    }
  }

  function getAcademicProfileFields() {
    return {
      institution: content.querySelector('#profileInstitution'),
      faculty: content.querySelector('#profileFaculty'),
      department: content.querySelector('#profileDepartment'),
      courseOfStudy: content.querySelector('#profileCourseOfStudy')
    };
  }

  function syncAcademicProfileFields() {
    window.KlasoraAcademicProfileFields.sync(getAcademicProfileFields());
  }

  async function loadUniversityDirectory() {
    if (!state.universityDirectory) {
      const response = await fetch('/data/nigerian-universities.json');
      if (!response.ok) throw new Error('Could not load the saved university list');
      const directory = await response.json();
      state.universityDirectory = Object.entries(directory.universities)
        .flatMap(([type, names]) => names.map(name => ({ name, type })));
    }
    if (state.route !== 'profile') return;
    const list = content.querySelector('#nigerianUniversityOptions');
    const status = content.querySelector('#universityDirectoryStatus');
    if (!list || !status) return;
    window.KlasoraAcademicProfileFields.populateUniversityOptions(list, state.universityDirectory);
    status.textContent = `${state.universityDirectory.length} universities listed by the NUC · choose one or type another.`;
  }

  async function compressProfileImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > 10 * 1024 * 1024) throw new Error('The original image must be under 10 MB.');
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close?.();
    for (const quality of [0.82, 0.68, 0.54]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot prepare a WebP profile photo.');
      if (blob.size > 400 * 1024) continue;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the selected photo.'));
        reader.readAsDataURL(blob);
      });
    }
    throw new Error('The compressed photo is too large. Choose a smaller image.');
  }

  function openPost(id) { state.activePost = id; setRoute('post'); }
  async function toggleReaction(id, reaction) {
    if (!postReactions.some(item => item.id === reaction)) return;
    const localPost = state.localPosts.find(item => item.id === id);
    if (localPost) {
      localPost.reactionCounts ||= {};
      const current = localPost.myReaction || (localPost.liked ? 'like' : '');
      if (current) localPost.reactionCounts[current] = Math.max(0, Number(localPost.reactionCounts[current] || 0) - 1);
      localPost.myReaction = current === reaction ? '' : reaction;
      if (localPost.myReaction) localPost.reactionCounts[reaction] = Number(localPost.reactionCounts[reaction] || 0) + 1;
      localPost.liked = localPost.myReaction === 'like';
      localWrite('posts', state.localPosts.map(({ localOnly, ...post }) => post));
      if (state.route === 'post') renderPostDetail();
      else if (state.route === 'feed') renderFeedPosts(state.posts);
      return;
    }
    const post = state.posts.find(item => item.id === id);
    if (!post) return;
    const current = post.myReaction || '';
    try {
      const result = await api(`/api/posts/${encodeURIComponent(id)}/reaction`, 'PUT', {
        reaction: current === reaction ? '' : reaction
      });
      handlePostEvent('post_reaction_changed', result);
    } catch (error) {
      toast(`Could not save reaction: ${error.message}`);
    }
  }

  function handlePostEvent(event, payload) {
    if (event === 'post_created' && payload?.id) {
      state.posts = [payload, ...state.posts.filter(post => post.id !== payload.id)]
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .slice(0, 100);
      if (state.route === 'feed') renderFeedPosts(state.posts);
      return;
    }
    if (event === 'post_comment_created' && payload?.postId && payload.comment?.id) {
      const post = state.posts.find(item => item.id === payload.postId);
      if (!post) return;
      state.seenCommentIds ||= new Set();
      const exists = state.comments.some(comment => comment.id === payload.comment.id) || state.seenCommentIds.has(payload.comment.id);
      state.seenCommentIds.add(payload.comment.id);
      if (!exists) post.commentCount = Number(post.commentCount || 0) + 1;
      if (state.activePost === payload.postId && !exists) state.comments.push(payload.comment);
      if (state.route === 'post' && state.activePost === payload.postId) renderPostDetail();
      else if (state.route === 'feed') renderFeedPosts(state.posts);
      return;
    }
    if (event === 'post_reaction_changed' && payload?.postId) {
      const post = state.posts.find(item => item.id === payload.postId);
      if (!post) return;
      post.reactionCounts = payload.reactionCounts || {};
      if (payload.userId === user()._id) post.myReaction = payload.reaction || '';
      if (state.route === 'post' && state.activePost === payload.postId) renderPostDetail();
      else if (state.route === 'feed') renderFeedPosts(state.posts);
    }
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
    if (state.timer.running) {
      setRoute('liveStudy');
      return;
    }
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
    if (state.timer.running) return;
    stopTimerAlarm();
    clearInterval(state.timer.interval);
    const route = state.timer.mode === 'challenge' ? 'challenge' : state.timer.mode === 'live' ? 'liveStudy' : 'focus';
    setRoute(route);
    state.timer.running = true;
    state.timer.endAt = window.KlasoraTimerClock.deadlineAfter(state.timer.remaining);
    state.timer.completionStarted = false;
    render();
    window.KlasoraTimerSound?.prepare().then(supported => {
      if (!supported) toast('Timer sound is not supported by this browser.');
    }).catch(error => {
      console.warn('Timer sound could not be prepared:', error);
      toast('Timer sound could not be prepared. Check your browser sound settings.');
    });
    tickTimer();
    if (state.timer.running) state.timer.interval = setInterval(tickTimer, 1000);
  }
  function tickTimer() {
    if (!state.timer.running) return;
    state.timer.remaining = window.KlasoraTimerClock.remainingSeconds(state.timer.endAt);
    const digits = shell?.querySelector('#timerDigits');
    if (digits) digits.textContent = fmtClock(state.timer.remaining);
    const progress = shell?.querySelector('#timerProgress');
    if (progress) progress.style.width = `${100 * (1 - state.timer.remaining / state.timer.duration)}%`;
    if (state.timer.remaining <= 0) completeTimer();
  }
  function pauseTimer() {
    if (state.timer.running) {
      state.timer.remaining = window.KlasoraTimerClock.remainingSeconds(state.timer.endAt);
    }
    state.timer.running = false;
    state.timer.endAt = null;
    clearInterval(state.timer.interval);
    state.timer.interval = null;
    if (state.route === 'challenge') renderChallenge();
    else if (state.route === 'focus') renderFocus();
    else if (state.route === 'liveStudy') renderLiveStudy();
  }
  function resetTimer() {
    stopTimerAlarm();
    pauseTimer();
    state.timer.remaining = state.timer.duration;
    state.timer.completionStarted = false;
    if (state.route === 'focus') renderFocus();
    else if (state.route === 'liveStudy') renderLiveStudy();
    else if (state.route === 'challenge') renderChallenge();
  }
  async function completeTimer() {
    if (!state.timer.running || state.timer.completionStarted) return;
    state.timer.completionStarted = true;
    state.timer.remaining = 0;
    pauseTimer();
    triggerAlarm();
    if (state.timer.mode !== 'live') {
      try { await api('/api/pomodoro/complete', 'POST'); }
      catch (error) { toast(`Session complete, but stats could not be saved: ${error.message}`); }
    }
    setRoute('results');
    toast('Focus session complete. Well done!');
  }
  function updateTimerAlarm() {
    const banner = document.getElementById('timerAlarmBanner');
    if (!banner) return;
    banner.hidden = !state.timer.alarmActive;
    const message = document.getElementById('timerAlarmMessage');
    if (message) message.textContent = state.timer.alarmAudioFailed
      ? 'Audio could not play. Check browser sound settings, then stop this alarm to dismiss it.'
      : 'The alarm will keep ringing until you stop it.';
  }
  function triggerAlarm() {
    if (state.timer.alarmActive) return;
    const generation = ++timerAlarmGeneration;
    state.timer.alarmActive = true;
    state.timer.alarmAudioFailed = false;
    updateTimerAlarm();
    Promise.resolve(window.KlasoraTimerSound?.startAlarm()).then(playing => {
      if (generation !== timerAlarmGeneration || !state.timer.alarmActive) return;
      state.timer.alarmAudioFailed = !playing;
      updateTimerAlarm();
      if (!playing) toast('Timer ended, but alarm audio could not play. Stop the visible alarm to dismiss it.');
    }).catch(error => {
      console.warn('Timer alarm could not be started:', error);
      if (generation !== timerAlarmGeneration || !state.timer.alarmActive) return;
      state.timer.alarmAudioFailed = true;
      updateTimerAlarm();
      toast('Timer ended, but alarm audio could not play. Stop the visible alarm to dismiss it.');
    });
  }
  function stopTimerAlarm() {
    timerAlarmGeneration += 1;
    state.timer.alarmActive = false;
    state.timer.alarmAudioFailed = false;
    window.KlasoraTimerSound?.stopAlarm();
    updateTimerAlarm();
  }
  function returnToTimer() {
    const route = state.timer.completionStarted
      ? 'results'
      : state.timer.mode === 'challenge' ? 'challenge' : state.timer.mode === 'live' ? 'liveStudy' : 'focus';
    navigate(route);
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
    const saveButton = content.querySelector('[data-action="save-profile"]');
    const saveStatus = content.querySelector('#profileSaveStatus');
    if (saveButton?.disabled) return;
    const academicFields = window.KlasoraAcademicProfileFields.values(getAcademicProfileFields());
    const changes = {
      name,
      bio,
      ...academicFields,
      level: content.querySelector('#profileLevel')?.value.trim() || '',
      matriculationNumber: content.querySelector('#profileMatriculationNumber')?.value.trim() || '',
    };
    if (state.profileImageDraft !== null) changes.profileImage = state.profileImageDraft;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
    }
    if (saveStatus) saveStatus.textContent = 'Saving your academic details…';
    try {
      await window.KlasoraBridge.updateProfile(changes);
      state.profileImageDraft = null;
      paintIdentity();
      renderProfile();
      toast('Profile saved.');
    } catch (error) {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Save academic details';
      }
      if (saveStatus) saveStatus.textContent = `Could not save: ${error.message}`;
      toast(`Could not save profile: ${error.message}`);
    }
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
  function unreadMessages() {
    const saved = localRead('unread-chats');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  function unreadCount(roomId) {
    return Number(unreadMessages()[roomId]) || 0;
  }
  function clearUnread(roomId) {
    if (!roomId) return;
    const unread = unreadMessages();
    delete unread[roomId];
    localWrite('unread-chats', unread);
  }
  function notifyChat(roomId, senderName) {
    if (!roomId || roomId === state.activeConversation?._id) return;
    const unread = unreadMessages();
    unread[roomId] = (Number(unread[roomId]) || 0) + 1;
    localWrite('unread-chats', unread);
    const row = [...(content?.querySelectorAll('.refresh-clique-chat-row') || [])].find(item => item.dataset.roomId === roomId);
    if (row) {
      let badge = row.querySelector('.refresh-unread-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'refresh-unread-badge';
        row.querySelector('.refresh-row-trailing')?.appendChild(badge);
      }
      const count = unread[roomId];
      badge.textContent = count > 99 ? '99+' : String(count);
    }
    toast(`New message from ${senderName || 'someone'}.`);
  }
  function notifyMissedCall(name) {
    toast(`Missed call from ${name || 'a Klasora member'}.`);
    if (state.route === 'cliques' && state.messageView === 'calls') renderCalls();
  }
  function renderModalAfterLogin() {
    if (state.modal) renderModal();
  }

  function close() {
    restoreCliqueChatSurface();
    stopTimerAlarm();
    clearInterval(state.timer.interval);
    state.timer.interval = null;
    state.timer.running = false;
    state.timer.endAt = null;
    state.timer.goal = '';
    state.timer.mode = 'capsule';
    state.timer.duration = 25 * 60;
    state.timer.remaining = state.timer.duration;
    state.timer.completionStarted = false;
    state.challengeStartedAt = null;
    state.route = 'feed';
    shell?.classList.remove('refresh-enabled');
    document.getElementById('appScreen')?.classList.remove('refresh-legacy-mode');
    if (shell) shell.style.display = 'none';
    shell?.querySelector('.refresh-modal-backdrop')?.remove();
    state.modal = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (state.timer.running) tickTimer();
  });

  window.KlasoraRefresh = {
    open, close, navigate, updateThemeIcon, triggerAlarm, dismissAlarm: stopTimerAlarm, returnToTimer, openCalls: () => { state.messageView = 'calls'; state.returnToCalls = false; if (state.route === 'cliques') render(); else navigate('cliques'); }, renderAssignments, renderModalAfterLogin, openCliqueChat, backToConversations,
    openCliquePins, openCliqueRequests: loadCliqueRequests, shareCliqueInvite: async () => {
      const clique = state.activeConversation;
      if (!clique || clique._chatType !== 'clique') return;
      const inviteUrl = new URL(window.location.pathname, window.location.origin);
      inviteUrl.searchParams.set('joinClique', clique._id);
      try {
        await navigator.clipboard.writeText(inviteUrl.toString());
        toast('Clique invite link copied.');
      } catch (error) { toast(`Could not copy invite link: ${error.message}`); }
    },
    isCliqueAdmin,
    pinMessage: pinCliqueMessage,
    recordCall(entry) {
    const savedHistory = localRead('call-history');
    const history = Array.isArray(savedHistory) ? savedHistory : [];
      const call = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), status: 'calling', ...entry };
      localWrite('call-history', [call, ...history].slice(0, 50));
      return call.id;
    },
    updateCall(id, changes) {
      if (!id) return;
      const savedHistory = localRead('call-history');
      const history = Array.isArray(savedHistory) ? savedHistory : [];
      localWrite('call-history', history.map(entry => entry.id === id ? { ...entry, ...changes } : entry));
    },
    handlePostEvent,
    notifyChat,
    notifyMissedCall
  };
})();
