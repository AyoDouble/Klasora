const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const port = 3100 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret-that-is-at-least-32-characters-long';
let child;

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

async function request(route, options = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), JWT_SECRET: jwtSecret },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 10000);
    child.stdout.on('data', data => {
      if (data.toString().includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', reject);
    child.stderr.on('data', data => process.stderr.write(data));
  });
});

after(() => child?.kill());

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
});

test('rejects protected routes without a token', async () => {
  const cliqueId = 'c647a93b-60d0-4fc7-a89c-62bd97b58f22';
  for (const route of [
    '/api/me', '/api/dms', '/api/courses', '/api/status',
    '/api/cliques/discover', '/api/cliques/join-requests',
    `/api/cliques/${cliqueId}/invite`, `/api/cliques/${cliqueId}/members`, `/api/cliques/${cliqueId}/pins`
  ]) {
    const response = await request(route);
    assert.equal(response.status, 401, route);
  }
  const join = await request(`/api/cliques/${cliqueId}/join`, { method: 'POST' });
  assert.equal(join.status, 401);
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
  assert.equal(response.status, 400);
  assert.match(await response.text(), /No file uploaded/);
});
