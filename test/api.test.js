const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getAuthRedirectUrl } = require('../auth-redirect');
const { createCommunityPostHandlers } = require('../community-posts');

const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret-that-is-at-least-32-characters-long';
let baseUrl;
let server;

const createFakeSupabase = seed => {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  class Query {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.filters = [];
      this.orderBy = null;
      this.rowLimit = null;
      this.payload = null;
    }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    order(key, { ascending }) { this.orderBy = { key, ascending }; return this; }
    limit(value) { this.rowLimit = value; return this; }
    insert(rows) { this.action = 'insert'; this.payload = rows; return this; }
    update(values) { this.action = 'update'; this.payload = values; return this; }
    delete() { this.action = 'delete'; return this; }
    matchingRows() { return (tables[this.table] || []).filter(row => this.filters.every(matches => matches(row))); }
    async execute() {
      const rows = tables[this.table] || (tables[this.table] = []);
      if (this.action === 'insert') {
        const inserted = this.payload.map(row => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      const matching = this.matchingRows();
      if (this.action === 'update') {
        matching.forEach(row => Object.assign(row, this.payload));
        return { data: matching, error: null };
      }
      if (this.action === 'delete') {
        tables[this.table] = rows.filter(row => !matching.includes(row));
        return { data: matching, error: null };
      }
      const result = [...matching];
      if (this.orderBy) {
        result.sort((left, right) => (left[this.orderBy.key] > right[this.orderBy.key] ? 1 : -1) * (this.orderBy.ascending ? 1 : -1));
      }
      return { data: this.rowLimit === null ? result : result.slice(0, this.rowLimit), error: null };
    }
    async single() {
      const result = await this.execute();
      return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data };
    }
    async maybeSingle() { return this.single(); }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }
  return { tables, from: table => new Query(table) };
};

const invokeHandler = async (handler, request) => {
  const response = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler(request, response);
  return response;
};

test('uses a matching configured request origin for production auth links', () => {
  const req = { get: name => name === 'origin' ? 'https://klasora.vercel.app' : undefined };
  const env = {
    NODE_ENV: 'production',
    APP_URL: 'https://klasora.vercel.app'
  };

  assert.equal(getAuthRedirectUrl(req, '/', env), 'https://klasora.vercel.app/');
});

test('ignores untrusted request origins and uses the configured app URL', () => {
  const req = { headers: { origin: 'https://attacker.example' } };
  const env = {
    NODE_ENV: 'production',
    APP_URL: 'https://klasora.vercel.app'
  };

  assert.equal(getAuthRedirectUrl(req, '/?reset=1', env), 'https://klasora.vercel.app/?reset=1');
});

test('accepts a configured Vercel preview origin without trusting arbitrary hosts', () => {
  const req = { headers: { host: 'klasora-git-feature-team.vercel.app' } };
  const env = {
    NODE_ENV: 'production',
    VERCEL_URL: 'klasora-git-feature-team.vercel.app'
  };

  assert.equal(getAuthRedirectUrl(req, '/', env), 'https://klasora-git-feature-team.vercel.app/');
  assert.equal(getAuthRedirectUrl({ headers: { host: 'attacker.example' } }, '/', env), 'https://klasora-git-feature-team.vercel.app/');
});

test('uses the Vercel production URL as the fallback when no app URL is configured', () => {
  const env = {
    NODE_ENV: 'production',
    VERCEL_URL: 'klasora-deployment.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'klasora.vercel.app'
  };

  assert.equal(getAuthRedirectUrl(null, '/', env), 'https://klasora.vercel.app/');
});

test('never uses a localhost app URL in production when Vercel provides its public origin', () => {
  const env = {
    NODE_ENV: 'production',
    APP_URL: 'http://localhost:3000',
    VERCEL_PROJECT_PRODUCTION_URL: 'klasora.vercel.app'
  };

  assert.equal(getAuthRedirectUrl(null, '/', env), 'https://klasora.vercel.app/');
});

test('keeps localhost defaults for development and never uses an untrusted forwarded host', () => {
  assert.equal(getAuthRedirectUrl({
    headers: {
      origin: 'https://attacker.example',
      'x-forwarded-host': 'attacker.example'
    }
  }, '/', { NODE_ENV: 'development' }), 'http://localhost:3000/');
});

test('rejects invalid configured app URLs', () => {
  assert.throws(() => getAuthRedirectUrl(null, '/', { NODE_ENV: 'production', APP_URL: 'javascript:alert(1)' }), /APP_URL must be an HTTP\(S\) URL/);
});

test('exports the Express app as the Vercel handler', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = jwtSecret;
  let exportedApp;
  try {
    exportedApp = require('../server');
  } finally {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }

  assert.equal(typeof exportedApp, 'function');
  assert.equal(exportedApp, exportedApp.app);
  assert.equal(typeof exportedApp.listen, 'function');
  assert.equal(typeof exportedApp.server.listen, 'function');
});

test('keeps post-login startup working when the Socket.IO client is unavailable', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const socketFunction = html.match(/async function connectSocket\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  const appFunction = html.match(/function showApp\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(socketFunction, 'connectSocket must remain available in the application shell');
  assert.ok(appFunction, 'showApp must remain available in the application shell');

  const notices = [];
  const visibleClasses = new Set();
  let refreshedShellOpened = false;
  const context = {
    window: { KlasoraRefresh: { open: () => { refreshedShellOpened = true; } } },
    console: { error() {} },
    document: {
      getElementById(id) {
        return id === 'authScreen'
          ? { style: {} }
          : { classList: { add: className => visibleClasses.add(className) } };
      }
    },
    loadSocketClient: () => Promise.reject(new Error('client unavailable')),
    localStorage: { getItem: () => '1' },
    myUser: { _id: 'test-user', name: 'Test User', email: 'test@example.com', theme: 'dark' },
    socket: null,
    showToast: (...notice) => notices.push(notice),
    applyTheme() {},
    renderMyProfile() {},
    buildEp() {},
    buildCliqueEmojiGrid() {},
    loadList() {},
    setupPushNotifications() {},
    api() {},
    openModal() {},
    editProfile() {},
    switchTab2() {},
    setChatMode() {},
    openChat() {},
    renderWorkspaceDetails() {},
    toggleTheme() {},
    updateNotificationPreference() {},
    doLogout() {},
    persistAuthUser() {}
  };

  assert.doesNotThrow(() => vm.runInNewContext(`${socketFunction}\n${appFunction}\nshowApp();`, context));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(visibleClasses.has('show'), true);
  assert.equal(context.socket, null);
  assert.ok(context.window.KlasoraBridge);
  assert.equal(refreshedShellOpened, true);
  assert.equal(notices.length, 1);
  assert.match(notices[0][1], /Live chat unavailable/);
});

test('does not clear a message when the realtime socket is disconnected', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sendFunction = html.match(/function sendMsg\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(sendFunction, 'sendMsg must remain available in the application shell');

  const input = { value: 'Keep this message', style: {} };
  const notices = [];
  const context = {
    pendingAttachment: null,
    pendingVoiceBlob: null,
    activeRoomId: 'test-room',
    socket: { connected: false, emit() { assert.fail('must not emit while disconnected'); } },
    document: { getElementById: () => input },
    showToast: (...notice) => notices.push(notice)
  };

  vm.runInNewContext(`${sendFunction}\nsendMsg();`, context);
  assert.equal(input.value, 'Keep this message');
  assert.match(notices[0][1], /Live chat unavailable/);
});

test('loads the Socket.IO client from the configured backend', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const loaderFunction = html.match(/function loadSocketClient\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(loaderFunction, 'loadSocketClient must remain available in the application shell');

  const script = {};
  const context = {
    io: undefined,
    socketClientPromise: null,
    apiUrl: path => `https://chat-api.example${path}`,
    document: {
      createElement: () => script,
      head: {
        appendChild() {
          context.io = () => {};
          script.onload();
        }
      }
    }
  };

  await vm.runInNewContext(`${loaderFunction}\nloadSocketClient();`, context);
  assert.equal(script.src, 'https://chat-api.example/socket.io/socket.io.js');
});

test('notifies once when the realtime connection fails and clears the warning on recovery', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const socketFunction = html.match(/async function connectSocket\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(socketFunction, 'connectSocket must remain available in the application shell');

  const handlers = new Map();
  const notices = [];
  const testSocket = {
    on: (event, handler) => { handlers.set(event, handler); },
    disconnect() {}
  };
  const postEvents = [];
  const context = {
    io: () => testSocket,
    loadSocketClient: () => Promise.resolve(),
    window: { KlasoraRefresh: { handlePostEvent: (...event) => postEvents.push(event) } },
    socket: null,
    SERVER_URL: 'https://chat-api.example',
    token: 'test-token',
    socketConnectionNoticeShown: false,
    console: { error() {} },
    showToast: (...notice) => notices.push(notice)
  };

  await vm.runInNewContext(`${socketFunction}\nconnectSocket();`, context);
  handlers.get('connect_error')(new Error('connection refused'));
  handlers.get('connect_error')(new Error('connection refused'));
  assert.equal(notices.length, 1);
  assert.match(notices[0][1], /Live chat unavailable/);

  handlers.get('connect')();
  assert.equal(notices.length, 2);
  assert.match(notices[1][1], /Chat connection restored/);
  assert.equal(context.socketConnectionNoticeShown, false);

  handlers.get('post_created')({ id: 'post-1' });
  assert.deepEqual(postEvents, [['post_created', { id: 'post-1' }]]);
});

async function request(route, options = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

before(async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalPublicBackendUrl = process.env.PUBLIC_BACKEND_URL;
  process.env.JWT_SECRET = jwtSecret;
  process.env.PUBLIC_BACKEND_URL = 'https://chat-api.example';
  let app;
  try {
    app = require('../server');
  } finally {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalPublicBackendUrl === undefined) delete process.env.PUBLIC_BACKEND_URL;
    else process.env.PUBLIC_BACKEND_URL = originalPublicBackendUrl;
  }
  server = app.server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

test('serves the application shell', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Klasora/);
  const logo = await request('/klasora-logo.png');
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type') || '', /image\/png/);
  const serviceWorker = await request('/sw.js');
  assert.equal(serviceWorker.status, 200);
  assert.match(await serviceWorker.text(), /Klasora/);
  const socketClient = await request('/socket.io/socket.io.js');
  assert.equal(socketClient.status, 200);
  assert.match(socketClient.headers.get('content-type') || '', /javascript/);
});

test('returns the configured public backend origin without caching', async () => {
  const response = await request('/api/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { backendUrl: 'https://chat-api.example' });
});

test('rejects protected routes without a token', async () => {
  const cliqueId = 'c647a93b-60d0-4fc7-a89c-62bd97b58f22';
  for (const route of [
    '/api/me', '/api/dms', '/api/courses', '/api/status', '/api/posts',
    '/api/cliques/discover', '/api/cliques/join-requests',
    `/api/cliques/${cliqueId}/invite`, `/api/cliques/${cliqueId}/members`, `/api/cliques/${cliqueId}/pins`
  ]) {
    const response = await request(route);
    assert.equal(response.status, 401, route);
  }
  const join = await request(`/api/cliques/${cliqueId}/join`, { method: 'POST' });
  assert.equal(join.status, 401);
});

test('validates community post inputs before database access', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const emptyPost = await request('/api/posts', {
    method: 'POST', headers, body: JSON.stringify({ text: '   ', category: 'Campus' })
  });
  assert.equal(emptyPost.status, 400);
  assert.match(await emptyPost.text(), /post text must be between/i);

  const invalidCategory = await request('/api/posts', {
    method: 'POST', headers, body: JSON.stringify({ text: 'Hello campus', category: 'Private' })
  });
  assert.equal(invalidCategory.status, 400);
  assert.match(await invalidCategory.text(), /valid post category/i);

  const invalidComment = await request('/api/posts/not-a-uuid/comments', {
    method: 'POST', headers, body: JSON.stringify({ text: 'A reply' })
  });
  assert.equal(invalidComment.status, 400);

  const unavailableFeed = await request('/api/posts', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(unavailableFeed.status, 503);
  assert.match(await unavailableFeed.text(), /apply supabase\/schema\.sql/i);
});

test('serves shared posts with author, reply count, and per-user reactions', async () => {
  const authorId = 'c647a93b-60d0-4fc7-a89c-62bd97b58f22';
  const memberId = '718b8b32-0ed5-46ce-a621-8947886a0011';
  const postId = 'fa0632b7-8eba-4a2d-b799-cfe66ac4247a';
  const supabase = createFakeSupabase({
    users: [{ id: authorId, name: 'Ada Student', color: '#123456' }],
    community_posts: [{ id: postId, user_id: authorId, text: 'Shared study notes', category: 'Study resources', created_at: '2026-11-16T10:00:00.000Z' }],
    community_post_comments: [{ id: crypto.randomUUID(), post_id: postId, user_id: memberId, text: 'Thanks!', created_at: '2026-11-16T10:01:00.000Z' }],
    community_post_reactions: [{ id: crypto.randomUUID(), post_id: postId, user_id: memberId, reaction: 'like' }]
  });
  const handlers = createCommunityPostHandlers({ supabase, io: { emit() {} } });

  const response = await invokeHandler(handlers.list, { userId: memberId });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].name, 'Ada Student');
  assert.equal(response.body[0].initials, 'AS');
  assert.equal(response.body[0].commentCount, 1);
  assert.deepEqual(response.body[0].reactionCounts, { like: 1 });
  assert.equal(response.body[0].myReaction, 'like');
});

test('creates shared posts, replies, and toggleable reactions with realtime events', async () => {
  const authorId = 'c647a93b-60d0-4fc7-a89c-62bd97b58f22';
  const memberId = '718b8b32-0ed5-46ce-a621-8947886a0011';
  const supabase = createFakeSupabase({
    users: [{ id: authorId, name: 'Ada Student', color: '#123456' }, { id: memberId, name: 'Sam Learner', color: '#654321' }],
    community_posts: [],
    community_post_comments: [],
    community_post_reactions: []
  });
  const events = [];
  const handlers = createCommunityPostHandlers({ supabase, io: { emit: (...event) => events.push(event) } });

  const created = await invokeHandler(handlers.create, {
    userId: authorId,
    body: { text: '  Study group at noon  ', category: 'Campus' }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.text, 'Study group at noon');
  assert.equal(created.body.name, 'Ada Student');
  assert.equal(supabase.tables.community_posts.length, 1);
  assert.equal(events[0][0], 'post_created');

  const postId = created.body.id;
  const reply = await invokeHandler(handlers.createComment, {
    userId: memberId,
    params: { postId },
    body: { text: '  I will join!  ' }
  });
  assert.equal(reply.statusCode, 201);
  assert.equal(reply.body.text, 'I will join!');
  assert.equal(events[1][0], 'post_comment_created');

  const listedReplies = await invokeHandler(handlers.listComments, { userId: authorId, params: { postId } });
  assert.equal(listedReplies.body.length, 1);
  assert.equal(listedReplies.body[0].name, 'Sam Learner');

  const reacted = await invokeHandler(handlers.setReaction, {
    userId: memberId, params: { postId }, body: { reaction: 'love' }
  });
  assert.deepEqual(reacted.body.reactionCounts, { love: 1 });
  assert.equal(events[2][0], 'post_reaction_changed');
  const removed = await invokeHandler(handlers.setReaction, {
    userId: memberId, params: { postId }, body: { reaction: 'love' }
  });
  assert.deepEqual(removed.body.reactionCounts, {});
  assert.equal(supabase.tables.community_post_reactions.length, 0);
});

test('applies realtime post, reply, and reaction events to the shared feed state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'ui-refresh.js'), 'utf8');
  const eventHandler = source.match(/function handlePostEvent\(event, payload\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(eventHandler, 'the refreshed feed must expose a realtime post event handler');
  const renderedPosts = [];
  const context = {
    state: {
      route: 'feed',
      posts: [],
      comments: [],
      seenCommentIds: new Set(),
      activePost: null
    },
    user: () => ({ _id: 'member-1' }),
    renderFeedPosts: posts => renderedPosts.push(posts)
  };
  vm.runInNewContext(`${eventHandler}\nhandlePostEvent('post_created',{id:'post-1',userId:'author-1',text:'Campus update',createdAt:'2026-11-16T10:00:00.000Z'});`, context);
  assert.equal(context.state.posts.length, 1);
  assert.equal(context.state.posts[0].text, 'Campus update');
  assert.equal(renderedPosts.length, 1);

  vm.runInNewContext(`handlePostEvent('post_comment_created',{postId:'post-1',comment:{id:'comment-1',text:'Thanks'}});`, context);
  assert.equal(context.state.posts[0].commentCount, 1);
  vm.runInNewContext(`handlePostEvent('post_comment_created',{postId:'post-1',comment:{id:'comment-1',text:'Thanks'}});`, context);
  assert.equal(context.state.posts[0].commentCount, 1);

  vm.runInNewContext(`handlePostEvent('post_reaction_changed',{postId:'post-1',userId:'member-1',reaction:'love',reactionCounts:{love:1}});`, context);
  assert.equal(context.state.posts[0].myReaction, 'love');
  assert.equal(context.state.posts[0].reactionCounts.love, 1);
});

test('returns a safe JSON error when an async API handler fails', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const response = await request('/api/me', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Request failed. Please try again.' });
});

test('validates clique visibility, name, and invited members before database access', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const invalidVisibility = await request('/api/cliques', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Study group', visibility: 'unlisted' })
  });
  assert.equal(invalidVisibility.status, 400);
  assert.match(await invalidVisibility.text(), /visibility must be private or public/i);

  const invalidMembers = await request('/api/cliques', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Study group', visibility: 'private', memberIds: ['not-a-user-id'] })
  });
  assert.equal(invalidMembers.status, 400);
  assert.match(await invalidMembers.text(), /valid user IDs/i);
});

test('validates clique moderation action and identifiers before database access', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const cliqueId = 'c647a93b-60d0-4fc7-a89c-62bd97b58f22';
  const userId = '718b8b32-0ed5-46ce-a621-8947886a0011';
  const response = await request(`/api/cliques/${cliqueId}/join-requests/${userId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'remove' })
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /approve or decline/i);

  const invalidPin = await request('/api/cliques/not-a-clique/pins/not-a-message', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(invalidPin.status, 400);
  assert.match(await invalidPin.text(), /Invalid clique or message ID/);
});

test('validates registration input before database access', async () => {
  const response = await request('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A', email: 'not-an-email', password: 'short' })
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /valid email|between 2 and 80/i);
});

test('validates profile updates for authenticated users', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const response = await request('/api/me/profile', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A', bio: 'x'.repeat(241) })
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Name must be between 2 and 80/);
});

test('validates academic profile fields before storage access', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const response = await request('/api/me/profile', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', bio: '', courseOfStudy: 'x'.repeat(121) })
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /courseOfStudy must be 120 characters or less/);
});

test('rejects unsupported profile image formats', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const response = await request('/api/me/profile', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', bio: '', profileImage: 'data:image/png;base64,Zm9v' })
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /compressed WebP/);
});

test('requires a file for authenticated uploads', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const response = await request('/api/upload', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /No file uploaded/);
});

test('validates status updates before database access', async () => {
  const token = jwt.sign({ id: 'test-user', email: 'test@example.com' }, jwtSecret);
  const response = await request('/api/status', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '' })
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Status must be between 1 and 500/);
});
