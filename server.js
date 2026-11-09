require('dotenv').config();
const express    = require('express');
const http       = require('http');
const crypto     = require('crypto');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const path       = require('path');
const multer     = require('multer');
const webpush    = require('web-push');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 10e6 });
app.disable('x-powered-by');

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── FILE UPLOADS ──────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const courseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const CHAT_FILE_BUCKET = 'chat-files';

// ── WEB PUSH ──────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:meno@app.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── SUPABASE ──────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const supabaseAuth = supabaseUrl && process.env.SUPABASE_ANON_KEY
  ? createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

if (!supabase) {
  console.warn('⚠️ Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
}

const snakeify = key => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const camelize = key => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const normalizeRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const cleanedKey = key === 'id' ? 'id' : camelize(key);
    normalized[cleanedKey] = value;
  }
  if (normalized.id && !normalized._id) normalized._id = normalized.id;
  return normalized;
};

const normalizeUser = user => user ? ({ ...normalizeRow(user), _id: user.id || user._id }) : user;

const hydrateMembers = async (memberIds = []) => {
  if (!supabase || !Array.isArray(memberIds) || !memberIds.length) return [];
  const { data, error } = await supabase.from('users').select('*').in('id', memberIds);
  if (error) throw error;
  return (data || []).map(normalizeUser);
};

const toDbPayload = (obj = {}) => {
  if (!obj || typeof obj !== 'object') return obj;
  const payload = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_id') payload.id = value;
    else if (key === '$inc') continue;
    else if (key === '$set') Object.assign(payload, toDbPayload(value));
    else payload[snakeify(key)] = value;
  }
  return payload;
};

const makeTableAdapter = (tableName, { defaultOrder = null, defaultAscending = false } = {}) => ({
  async find(filter = {}) {
    if (!supabase) throw new Error('Supabase is not configured. Restart the server after adding SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
    let query = supabase.from(tableName).select('*');
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      if (key === '_id') query = query.eq('id', value);
      else if (key === 'userId') query = query.eq('user_id', value);
      else if (key === 'roomId') query = query.eq('room_id', value);
      else if (key === 'senderId') query = query.eq('sender_id', value);
      else if (key === 'createdBy') query = query.eq('created_by', value);
      else if (key === 'dueDate') query = query.eq('due_date', value);
      else if (key === 'members') query = query.contains('members', Array.isArray(value) ? value : [value]);
      else query = query.eq(snakeify(key), value);
    }
    if (defaultOrder) query = query.order(defaultOrder, { ascending: defaultAscending });
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []).map(normalizeRow);
    if (tableName === 'dms' || tableName === 'cliques' || tableName === 'courses') {
      for (const row of rows) {
        row.members = await hydrateMembers(row.members || []);
      }
    }
    return rows;
  },

  async findOne(filter = {}) {
    if (!supabase) throw new Error('Supabase is not configured. Restart the server after adding SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
    let query = supabase.from(tableName).select('*');
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      if (key === '_id') query = query.eq('id', value);
      else if (key === 'userId') query = query.eq('user_id', value);
      else if (key === 'roomId') query = query.eq('room_id', value);
      else if (key === 'senderId') query = query.eq('sender_id', value);
      else if (key === 'createdBy') query = query.eq('created_by', value);
      else if (key === 'dueDate') query = query.eq('due_date', value);
      else if (key === 'members') query = query.contains('members', Array.isArray(value) ? value : [value]);
      else query = query.eq(snakeify(key), value);
    }
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    const row = normalizeRow(data);
    if (tableName === 'dms' || tableName === 'cliques' || tableName === 'courses') {
      row.members = await hydrateMembers(row.members || []);
    }
    return row;
  },

  async create(payload) {
    if (!supabase) throw new Error('Supabase is not configured. Restart the server after adding SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
    const { data, error } = await supabase.from(tableName).insert([toDbPayload(payload)]).select('*').single();
    if (error) throw error;
    return normalizeRow(data);
  },

  async findById(id) {
    if (!supabase) throw new Error('Supabase is not configured. Restart the server after adding SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
    const { data, error } = await supabase.from(tableName).select('*').eq('id', id).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return data ? normalizeRow(data) : null;
  },

  async findByIdAndUpdate(id, update, options = {}) {
    if (!supabase) return null;
    let updatePayload = toDbPayload(update);
    if (update && update.$addToSet && update.$addToSet.members) {
      const row = await this.findById(id);
      const memberIds = (row?.members || []).map(member => typeof member === 'string' ? member : (member.id || member._id)).filter(Boolean);
      const members = Array.from(new Set([...memberIds, update.$addToSet.members]));
      updatePayload = { members };
    }
    if (update && update.$inc) {
      const row = await this.findById(id);
      if (!row) return null;
      const key = Object.keys(update.$inc)[0].replace(/^reactions\./, 'reactions.');
      const reactions = { ...(row.reactions || {}) };
      const reactionName = key.split('.').pop();
      reactions[reactionName] = Number(reactions[reactionName] || 0) + Number(update.$inc[key] || 0);
      updatePayload = { reactions };
    }
    const { data, error } = await supabase.from(tableName).update(updatePayload).eq('id', id).select('*').single();
    if (error) {
      if (options.upsert && error.code === 'PGRST116') {
        return this.create({ id, ...toDbPayload(update) });
      }
      throw error;
    }
    const result = normalizeRow(data);
    if (tableName === 'dms' || tableName === 'cliques' || tableName === 'courses') {
      result.members = await hydrateMembers(result.members || []);
    }
    return result;
  },

  async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    if (!supabase) return null;
    const item = await this.findOne(filter);
    if (!item && options.upsert) {
      const insertPayload = { ...filter };
      if (update && typeof update === 'object') {
        for (const [key, value] of Object.entries(update)) {
          if (key === '$inc' || key === '$addToSet') continue;
          insertPayload[key] = value;
        }
        if (update.$inc) {
          for (const [key, value] of Object.entries(update.$inc)) {
            insertPayload[key.replace(/^reactions\./, '')] = Number(value || 0);
          }
        }
      }
      return this.create(insertPayload);
    }
    if (!item) return null;

    let updatePayload = toDbPayload(update);
    if (update && update.$addToSet && update.$addToSet.members) {
      const memberIds = (item.members || []).map(member => typeof member === 'string' ? member : (member.id || member._id)).filter(Boolean);
      const members = Array.from(new Set([...memberIds, update.$addToSet.members]));
      updatePayload = { members };
    }
    if (update && update.$inc) {
      const reactions = { ...(item.reactions || {}) };
      for (const [key, value] of Object.entries(update.$inc)) {
        const reactionKey = key.replace(/^reactions\./, '');
        reactions[reactionKey] = Number(reactions[reactionKey] || 0) + Number(value || 0);
      }
      updatePayload = { reactions };
    }

    const { data, error } = await supabase.from(tableName).update(updatePayload).eq('id', item.id).select('*').single();
    if (error) throw error;
    const result = normalizeRow(data);
    if (tableName === 'dms' || tableName === 'cliques' || tableName === 'courses') {
      result.members = await hydrateMembers(result.members || []);
    }
    return result;
  },

  async findOneAndDelete(filter = {}) {
    if (!supabase) return null;
    const item = await this.findOne(filter);
    if (!item) return null;
    const { error } = await supabase.from(tableName).delete().eq('id', item.id);
    if (error) throw error;
    return item;
  },

  async aggregate(pipeline = []) {
    if (!supabase) return [];
    const match = pipeline.find(step => step && step.$match);
    const matchValues = match && match.$match ? match.$match : {};
    const userId = matchValues.userId;
    let query = supabase.from(tableName).select('*');
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw error;
    const total = (data || []).reduce((sum, row) => sum + Number(row.sessions_today || 0), 0);
    return [{ _id: null, total }];
  }
});

const User = makeTableAdapter('users');
const Message = makeTableAdapter('messages', { defaultOrder: 'created_at', defaultAscending: true });
const StatusUpdate = makeTableAdapter('status_updates', { defaultOrder: 'created_at', defaultAscending: false });
const DM = makeTableAdapter('dms', { defaultOrder: 'last_at', defaultAscending: false });
const Clique = makeTableAdapter('cliques', { defaultOrder: 'last_at', defaultAscending: false });
const Homework = makeTableAdapter('homework', { defaultOrder: 'due_date', defaultAscending: true });
const Pomodoro = makeTableAdapter('pomodoros');
const Course = makeTableAdapter('courses', { defaultOrder: 'updated_at', defaultAscending: false });
const Note = makeTableAdapter('course_notes', { defaultOrder: 'updated_at', defaultAscending: false });
const CourseFile = makeTableAdapter('course_files', { defaultOrder: 'created_at', defaultAscending: false });
const CourseFileFolder = makeTableAdapter('course_file_folders', { defaultOrder: 'name', defaultAscending: true });

const courseHasMember = (course, userId) => (course?.members || [])
  .some(member => (typeof member === 'string' ? member : (member.id || member._id)) === userId);
const isCourseMember = async (courseId, userId) => {
  const course = await Course.findById(courseId);
  return courseHasMember(course, userId);
};

// ── JWT ───────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
}
const signToken  = u => jwt.sign({ id: u._id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
const verifyToken = t => { try { return jwt.verify(t, JWT_SECRET); } catch { return null; } };
const auth = (req, res, next) => {
  const decoded = verifyToken(req.headers.authorization?.split(' ')[1]);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  req.userId = decoded.id; next();
};
const safeUser = u => u ? ({ _id: u._id, name: u.name, email: u.email, color: u.color, bio: u.bio, online: u.online, theme: u.theme }) : null;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateCredentials = ({ name, email, password }, includeName = false) => {
  if (includeName && (!name || name.trim().length < 2 || name.trim().length > 80)) {
    return 'Name must be between 2 and 80 characters';
  }
  if (!email || email.trim().length > 254 || !emailPattern.test(email.trim())) {
    return 'Enter a valid email address';
  }
  if (!password || password.length < 8 || password.length > 128) {
    return 'Password must be between 8 and 128 characters';
  }
  return null;
};

// ── AUTH ROUTES ───────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, color } = req.body;
    const validationError = validateCredentials({ name, email, password }, true);
    if (validationError) return res.status(400).json({ error: validationError });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.findOne({ email: normalizedEmail })) return res.status(400).json({ error: 'Email already registered' });
    if (!supabaseAuth || !supabase) throw new Error('Supabase Auth is not configured. Set SUPABASE_ANON_KEY and restart the server.');
    const { data, error } = await supabaseAuth.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { name: name.trim(), color: color || '#6c63ff' },
        emailRedirectTo: process.env.APP_URL || 'http://localhost:3000'
      }
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase did not create the account');
    const user = await User.create({
      id: data.user.id,
      name: name.trim(),
      email: normalizedEmail,
      color: color || '#6c63ff'
    });
    if (!data.session) {
      return res.status(201).json({ needsVerification: true, message: 'Check your email to verify your Klasora account before signing in.' });
    }
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('Registration failed:', e);
    res.status(500).json({ error: 'Registration failed. Check the server configuration and try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const validationError = validateCredentials({ email, password });
    if (validationError) return res.status(400).json({ error: validationError });
    if (!supabaseAuth) throw new Error('Supabase Auth is not configured. Set SUPABASE_ANON_KEY and restart the server.');
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });
    let user = data.user ? await User.findById(data.user.id) : null;
    if (!user && supabase) {
      const emailUser = await User.findOne({ email: email.trim().toLowerCase() });
      if (data.user && emailUser) {
        user = emailUser;
      } else if (data.user?.email) {
        const metadata = data.user.user_metadata || {};
        const displayName = metadata.name || metadata.full_name || data.user.email.split('@')[0];
        user = await User.create({
          id: data.user.id,
          name: displayName.trim().length >= 2 ? displayName.trim().slice(0, 80) : 'Student',
          email: data.user.email.toLowerCase(),
          color: metadata.color || '#6c63ff'
        });
      } else if (emailUser?.password && await bcrypt.compare(password, emailUser.password)) {
        user = emailUser;
      }
    }
    if (!user) {
      return res.status(400).json({ error: error?.message || 'Incorrect email or password' });
    }
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('Login failed:', e);
    res.status(500).json({ error: 'Login failed. Check the server configuration and try again.' });
  }
});

app.get('/api/auth/google', async (req, res) => {
  try {
    if (!supabaseAuth) throw new Error('Supabase Auth is not configured');
    const { data, error } = await supabaseAuth.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: process.env.APP_URL || 'http://localhost:3000'
      }
    });
    if (error || !data?.url) throw error || new Error('Google sign-in is not configured in Supabase');
    res.json({ url: data.url });
  } catch (e) {
    console.error('Google sign-in request failed:', e);
    res.status(500).json({ error: 'Google sign-in is not configured yet. Enable it in Supabase Authentication → Providers → Google.' });
  }
});

app.post('/api/auth/sync', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken || !supabase) return res.status(401).json({ error: 'Google sign-in session is invalid' });
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user?.email) return res.status(401).json({ error: 'Google sign-in session is invalid or expired' });

    const authUser = authData.user;
    const metadata = authUser.user_metadata || {};
    let user = await User.findById(authUser.id);
    if (!user) {
      user = await User.findOne({ email: authUser.email.toLowerCase() });
    }
    if (!user) {
      user = await User.create({
        id: authUser.id,
        name: metadata.full_name || metadata.name || authUser.email.split('@')[0],
        email: authUser.email.toLowerCase(),
        color: metadata.color || '#6c63ff'
      });
    }
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('Google profile sync failed:', e);
    res.status(500).json({ error: 'Google sign-in succeeded, but the Klasora profile could not be created.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!supabaseAuth) throw new Error('Supabase Auth is not configured');
    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}?reset=1`
    });
    if (error) throw error;
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (e) {
    console.error('Password reset request failed:', e);
    const message = String(e?.message || '');
    if (/redirect|url|email/i.test(message)) {
      return res.status(400).json({ error: 'Supabase rejected the reset link URL. Add http://localhost:3000 under Authentication → URL Configuration → Redirect URLs, then restart the server.' });
    }
    if (/rate limit|smtp|email/i.test(message)) {
      return res.status(502).json({ error: 'Supabase could not send the reset email. Check the Auth email provider and try again later.' });
    }
    res.status(500).json({ error: 'Unable to request a password reset right now. Check the server terminal for details.' });
  }
});

app.post('/api/auth/update-password', async (req, res) => {
  try {
    const { accessToken, password } = req.body;
    if (!accessToken || !password || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
    }
    if (!supabase) throw new Error('Supabase is not configured');
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) return res.status(401).json({ error: 'Reset link is invalid or expired' });
    const { error } = await supabase.auth.admin.updateUserById(authData.user.id, { password });
    if (error) throw error;
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (e) {
    console.error('Password update failed:', e);
    res.status(500).json({ error: 'Unable to update your password right now' });
  }
});

app.get('/api/me',             auth, async (req, res) => { const u = await User.findById(req.userId); res.json(safeUser(u)); });
app.get('/api/users/search',   auth, async (req, res) => { const u = await User.findOne({ email: req.query.email?.toLowerCase() }); if (!u) return res.status(404).json({ error: 'No Klasora user with that email' }); res.json(safeUser(u)); });

app.patch('/api/me/theme', auth, async (req, res) => {
  const u = await User.findByIdAndUpdate(req.userId, { theme: req.body.theme }, { new: true });
  res.json(safeUser(u));
});

app.patch('/api/me/bio', auth, async (req, res) => {
  const u = await User.findByIdAndUpdate(req.userId, { bio: req.body.bio }, { new: true });
  res.json(safeUser(u));
});

app.patch('/api/me/profile', auth, async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be between 2 and 80 characters' });
  if (bio.length > 240) return res.status(400).json({ error: 'Bio must be 240 characters or less' });
  const u = await User.findByIdAndUpdate(req.userId, { name, bio }, { new: true });
  res.json(safeUser(u));
});

app.get('/api/status', auth, async (req, res) => {
  const updates = await StatusUpdate.find({});
  const active = updates.filter(update => new Date(update.expiresAt) > new Date());
  const users = await User.find({});
  const byId = new Map(users.map(user => [user._id, safeUser(user)]));
  res.json(active.map(update => ({ ...update, user: byId.get(update.userId) || null })).filter(update => update.user));
});

app.post('/api/status', auth, async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 500) return res.status(400).json({ error: 'Status must be between 1 and 500 characters' });
  const update = await StatusUpdate.create({ userId: req.userId, text, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
  const user = await User.findById(req.userId);
  res.status(201).json({ ...update, user: safeUser(user) });
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

app.post('/api/push/subscribe', auth, async (req, res) => {
  await User.findByIdAndUpdate(req.userId, { pushSub: req.body.subscription });
  res.json({ ok: true });
});

async function sendPush(userId, title, body, data = {}) {
  try {
    const user = await User.findById(userId);
    if (!user?.pushSub || !process.env.VAPID_PRIVATE_KEY) return;
    await webpush.sendNotification(user.pushSub, JSON.stringify({ title, body, data }));
  } catch (e) { if (e.statusCode === 410) await User.findByIdAndUpdate(userId, { pushSub: null }); }
}

// ── DM ROUTES ─────────────────────────────────────────────────
app.get('/api/dms', auth, async (req, res) => {
  const dms = await DM.find({ members: req.userId });
  res.json(dms.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)));
});

app.post('/api/dms', auth, async (req, res) => {
  try {
    const ids = [req.userId.toString(), req.body.otherUserId.toString()].sort();
    const roomId = ids.join('_');
    let dm = await DM.findOne({ roomId });
    if (!dm) dm = await DM.create({ members: ids, roomId });
    dm.members = await hydrateMembers(dm.members || []);
    res.json(dm);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CLIQUE ROUTES ─────────────────────────────────────────────
app.get('/api/cliques', auth, async (req, res) => {
  const cliques = await Clique.find({ members: req.userId });
  res.json(cliques.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)));
});

app.post('/api/cliques', auth, async (req, res) => {
  try {
    const { name, emoji, color, memberIds } = req.body;
    const members = [...new Set([req.userId.toString(), ...(memberIds || [])])];
    const clique = await Clique.create({ name, emoji: emoji||'🔗', color: color||'#6c63ff', members, createdBy: req.userId });
    clique.members = await hydrateMembers(clique.members || []);
    res.json(clique);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cliques/:id/members', auth, async (req, res) => {
  try {
    const clique = await Clique.findByIdAndUpdate(req.params.id, { $addToSet: { members: req.body.userId } }, { new: true });
    clique.members = await hydrateMembers(clique.members || []);
    res.json(clique);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COURSE SPACE ROUTES ──────────────────────────────────────
app.get('/api/courses', auth, async (req, res) => {
  const courses = await Course.find({ members: req.userId });
  res.json(courses);
});

app.post('/api/courses', auth, async (req, res) => {
  try {
    const { name, code, description, memberIds = [] } = req.body;
    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length > 100) return res.status(400).json({ error: 'Course name is required and must be under 100 characters' });
    const members = [...new Set([req.userId, ...memberIds].filter(Boolean))];
    const course = await Course.create({
      name: trimmedName,
      code: code?.trim().slice(0, 30) || '',
      description: description?.trim().slice(0, 500) || '',
      ownerId: req.userId,
      members,
      roomId: `course_${crypto.randomUUID()}`
    });
    res.json(course);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/courses/:id/invite', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course || course.ownerId !== req.userId) return res.status(403).json({ error: 'Only the course owner can invite members' });
    const email = req.body.email?.trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const member = await User.findOne({ email });
    if (!member) return res.status(404).json({ error: 'No Klasora user found with that email' });
    const updated = await Course.findByIdAndUpdate(course._id, { $addToSet: { members: member._id } }, { new: true });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/courses/:id', auth, async (req, res) => {
  if (!await isCourseMember(req.params.id, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
  res.json(await Course.findById(req.params.id));
});

app.get('/api/courses/:id/files', auth, async (req, res) => {
  if (!await isCourseMember(req.params.id, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
  const files = await CourseFile.find({ courseId: req.params.id });
  const query = req.query.q?.trim().toLowerCase();
  const folderId = req.query.folderId?.trim();
  res.json(files.filter(file => (!folderId || (folderId === 'none' ? !file.folderId : file.folderId === folderId)) &&
    (!query || file.name.toLowerCase().includes(query))));
});

app.get('/api/courses/:id/file-folders', auth, async (req, res) => {
  if (!await isCourseMember(req.params.id, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
  res.json(await CourseFileFolder.find({ courseId: req.params.id }));
});

app.post('/api/courses/:id/file-folders', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course || course.ownerId !== req.userId) return res.status(403).json({ error: 'Only the course owner can create folders' });
    const name = req.body.name?.trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Folder name must be between 1 and 80 characters' });
    res.json(await CourseFileFolder.create({ courseId: req.params.id, name, createdBy: req.userId }));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That folder already exists' });
    res.status(500).json({ error: 'Unable to create folder' });
  }
});

app.post('/api/courses/:id/files', auth, courseUpload.single('file'), async (req, res) => {
  try {
    if (!await isCourseMember(req.params.id, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
    if (!supabase) throw new Error('Supabase is not configured');
    const safeName = req.file.originalname.replace(/[^a-z0-9._-]/gi, '_');
    const storagePath = `${req.params.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('course-files').upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    if (uploadError) throw uploadError;
    const folderId = req.body.folderId?.trim() || null;
    if (folderId) {
      const folder = await CourseFileFolder.findById(folderId);
      if (!folder || folder.courseId !== req.params.id) return res.status(400).json({ error: 'Invalid course folder' });
    }
    const file = await CourseFile.create({
      courseId: req.params.id,
      uploadedBy: req.userId,
      name: req.file.originalname.slice(0, 255),
      storagePath,
      mimeType: req.file.mimetype,
      size: req.file.size,
      folderId
    });
    res.json(file);
  } catch (e) {
    console.error('Course file upload failed:', e);
    res.status(500).json({ error: 'Unable to upload this course file' });
  }
});

app.get('/api/courses/:id/files/:fileId', auth, async (req, res) => {
  try {
    if (!await isCourseMember(req.params.id, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
    const file = await CourseFile.findById(req.params.fileId);
    if (!file || file.courseId !== req.params.id) return res.status(404).json({ error: 'File not found' });
    const { data, error } = await supabase.storage.from('course-files').createSignedUrl(file.storagePath, 60 * 10);
    if (error) throw error;
    res.json({ url: data.signedUrl });
  } catch (e) {
    console.error('Course file URL failed:', e);
    res.status(500).json({ error: 'Unable to open this course file' });
  }
});

app.delete('/api/courses/:id/files/:fileId', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course || course.ownerId !== req.userId) return res.status(403).json({ error: 'Only the course owner can delete files' });
    const file = await CourseFile.findById(req.params.fileId);
    if (!file || file.courseId !== req.params.id) return res.status(404).json({ error: 'File not found' });
    const { error } = await supabase.storage.from('course-files').remove([file.storagePath]);
    if (error) throw error;
    await CourseFile.findOneAndDelete({ _id: file._id });
    res.json({ ok: true });
  } catch (e) {
    console.error('Course file delete failed:', e);
    res.status(500).json({ error: 'Unable to delete this course file' });
  }
});

// ── MESSAGE ROUTES ────────────────────────────────────────────
app.get('/api/messages/search', auth, async (req, res) => {
  try {
    const query = req.query.q?.trim().toLowerCase();
    if (!query || query.length < 2) return res.json([]);
    const [dms, cliques, courses] = await Promise.all([
      DM.find({ members: req.userId }),
      Clique.find({ members: req.userId }),
      Course.find({ members: req.userId })
    ]);
    const rooms = [
      ...dms.map(room => ({ roomId: room.roomId, roomType: 'dm', roomName: room.members?.find(member => member._id !== req.userId)?.name || 'Direct message' })),
      ...cliques.map(room => ({ roomId: room._id, roomType: 'clique', roomName: room.name })),
      ...courses.map(room => ({ roomId: room.roomId, roomType: 'course', roomName: room.name }))
    ];
    const results = (await Promise.all(rooms.map(async room => {
      const messages = await Message.find({ roomId: room.roomId });
      return messages
        .filter(message => [message.text, message.fileName, message.senderName].some(value => String(value || '').toLowerCase().includes(query)))
        .map(message => ({
          messageId: message._id,
          roomId: room.roomId,
          roomType: room.roomType,
          roomName: room.roomName,
          senderName: message.senderName,
          text: message.text,
          fileName: message.fileName,
          type: message.type,
          createdAt: message.createdAt
        }));
    }))).flat()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    res.json(results);
  } catch (e) {
    console.error('Message search failed:', e);
    res.status(500).json({ error: 'Unable to search messages' });
  }
});

app.get('/api/messages/:roomId', auth, async (req, res) => {
  const course = await Course.findOne({ roomId: req.params.roomId });
  if (course && !courseHasMember(course, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
  const msgs = await Message.find({ roomId: req.params.roomId });
  res.json(msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, 100));
});

// ── FILE UPLOAD ───────────────────────────────────────────────
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!supabase) return res.status(503).json({ error: 'File storage is not configured' });
    const safeName = req.file.originalname.replace(/[^a-z0-9._-]/gi, '_').slice(0, 120);
    const storagePath = `${req.userId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(CHAT_FILE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false
    });
    if (uploadError) throw uploadError;
    const { data, error: urlError } = await supabase.storage.from(CHAT_FILE_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 365);
    if (urlError) throw urlError;
    const isImage = req.file.mimetype.startsWith('image/');
    res.json({
      url: data.signedUrl,
      name: req.file.originalname,
      size: req.file.size,
      isImage,
      isAudio: req.file.mimetype.startsWith('audio/')
    });
  } catch (e) {
    console.error('Chat file upload failed:', e);
    res.status(500).json({ error: 'Unable to upload this file' });
  }
});

// ── AI STUDY ASSISTANT ────────────────────────────────────────
app.post('/api/ai/ask', auth, async (req, res) => {
  try {
    const { question, context } = req.body;
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'AI not configured. Add GROQ_API_KEY to .env' });

    const prompt = context ? `Context: ${context}\n\nQuestion: ${question}` : question;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: 'You are Klasora AI, a friendly study assistant for students. Be directly relevant to the question and use the supplied course context when present. Never claim to have read file contents unless their text is included in the context. If the context does not contain the answer, say so briefly and answer from general knowledge only when appropriate. Answer in 2-4 short sentences or up to 5 concise bullet points. Give only the essential explanation; do not add an introduction, conclusion, repeated question, or unrelated tips. Use simple language and an occasional emoji only when natural.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 256
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Groq request failed');
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('Groq returned an empty response');
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/study-tools', auth, async (req, res) => {
  try {
    const { type, courseId, context } = req.body;
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'AI not configured. Add GROQ_API_KEY to .env' });
    if (!['flashcards', 'quiz'].includes(type)) return res.status(400).json({ error: 'Choose flashcards or quiz' });
    if (courseId && !await isCourseMember(courseId, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
    if (!context?.trim()) return res.status(400).json({ error: 'Add some course notes first' });
    const instructions = type === 'flashcards'
      ? 'Return JSON only in this shape: {"items":[{"question":"...","answer":"..."}]}. Create 5 concise flashcards from the notes.'
      : 'Return JSON only in this shape: {"items":[{"question":"...","options":["...","...","...","..."],"answer":"..."}]}. Create 5 concise multiple-choice questions from the notes. The answer must exactly match one option.';
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: `You create practical study materials. ${instructions} Do not include markdown or commentary.` },
          { role: 'user', content: context.trim().slice(0, 12000) }
        ],
        max_tokens: 768
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Groq request failed');
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('Groq returned empty study materials');
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    const result = JSON.parse(cleaned);
    if (!Array.isArray(result.items) || !result.items.length) throw new Error('No study materials were generated');
    res.json({ type, items: result.items.slice(0, 5) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/homework-plan', auth, async (req, res) => {
  try {
    const { homeworkId } = req.body;
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'AI not configured. Add GROQ_API_KEY to .env' });
    const homework = await Homework.findOne({ _id: homeworkId, userId: req.userId });
    if (!homework) return res.status(404).json({ error: 'Assignment not found' });
    const prompt = `Assignment: ${homework.title}
Subject: ${homework.subject || 'Not specified'}
Due date: ${homework.dueDate || 'Not specified'}
Priority: ${homework.priority || 'medium'}
Notes: ${homework.notes || 'None'}`;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: 'Create a realistic, concise homework plan. Return JSON only in this shape: {"summary":"...","steps":[{"title":"...","detail":"..."}],"tip":"..."}. Create 3-5 actionable steps. Keep each detail to one short sentence. Do not invent requirements.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 768
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Groq request failed');
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('Groq returned an empty homework plan');
    const plan = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
    if (!plan.summary || !Array.isArray(plan.steps) || !plan.steps.length) throw new Error('No homework plan was generated');
    res.json({ summary: plan.summary, steps: plan.steps.slice(0, 5), tip: plan.tip || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HOMEWORK ROUTES ───────────────────────────────────────────
app.get('/api/homework', auth, async (req, res) => {
  const filter = { userId: req.userId };
  if (req.query.courseId) filter.courseId = req.query.courseId;
  const hw = await Homework.find(filter);
  res.json(hw.sort((a, b) => {
    const dueCompare = new Date(a.dueDate || 0) - new Date(b.dueDate || 0);
    if (dueCompare !== 0) return dueCompare;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  }));
});

app.post('/api/homework', auth, async (req, res) => {
  try {
    const { title, subject, dueDate, priority, notes, courseId } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    if (courseId && !await isCourseMember(courseId, req.userId)) return res.status(403).json({ error: 'You are not a member of this course' });
    const hw = await Homework.create({ userId: req.userId, courseId: courseId || null, title, subject, dueDate, priority: priority||'medium', notes });
    res.json(hw);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/homework/:id', auth, async (req, res) => {
  if (req.body.courseId && !await isCourseMember(req.body.courseId, req.userId)) {
    return res.status(403).json({ error: 'You are not a member of this course' });
  }
  const hw = await Homework.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, { new: true });
  if (!hw) return res.status(404).json({ error: 'Assignment not found' });
  res.json(hw);
});

app.delete('/api/homework/:id', auth, async (req, res) => {
  await Homework.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

// ── COURSE NOTES ──────────────────────────────────────────────
app.get('/api/notes', auth, async (req, res) => {
  const courseId = req.query.courseId;
  if (!courseId || !await isCourseMember(courseId, req.userId)) return res.status(403).json({ error: 'Choose a course you belong to' });
  res.json(await Note.find({ courseId }));
});

app.post('/api/notes', auth, async (req, res) => {
  try {
    const { courseId, title, content } = req.body;
    if (!courseId || !await isCourseMember(courseId, req.userId)) return res.status(403).json({ error: 'Choose a course you belong to' });
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Title and content are required' });
    const note = await Note.create({ courseId, userId: req.userId, title: title.trim().slice(0, 160), content: content.trim().slice(0, 20000) });
    res.json(note);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/notes/:id', auth, async (req, res) => {
  const note = await Note.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, {
    title: req.body.title?.trim().slice(0, 160),
    content: req.body.content?.trim().slice(0, 20000)
  }, { new: true });
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.json(note);
});

app.delete('/api/notes/:id', auth, async (req, res) => {
  await Note.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

// ── POMODORO ROUTES ───────────────────────────────────────────
app.get('/api/pomodoro/stats', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  let stats = await Pomodoro.findOne({ userId: req.userId, date: today });
  if (!stats) stats = { sessionsToday: 0, totalSessions: 0 };
  const allTime = await Pomodoro.aggregate([{ $match: { userId: req.userId } }]);
  res.json({ sessionsToday: stats.sessionsToday, totalSessions: allTime[0]?.total || 0 });
});

app.post('/api/pomodoro/complete', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const stats = await Pomodoro.findOneAndUpdate(
    { userId: req.userId, date: today },
    { $inc: { sessionsToday: 1 } },
    { upsert: true, new: true }
  );
  res.json(stats);
});

// ── SOCKET.IO ─────────────────────────────────────────────────
const onlineUsers = new Map();

io.use((socket, next) => {
  const decoded = verifyToken(socket.handshake.auth.token);
  if (!decoded) return next(new Error('Unauthorized'));
  socket.userId = decoded.id; next();
});

io.on('connection', async (socket) => {
  const uid = socket.userId;
  onlineUsers.set(uid, socket.id);
  await User.findByIdAndUpdate(uid, { online: true });
  io.emit('presence', { userId: uid, online: true });

  // Auto-join rooms
  const [dms, cliques, courses] = await Promise.all([DM.find({ members: uid }), Clique.find({ members: uid }), Course.find({ members: uid })]);
  dms.forEach(d => socket.join(d.roomId));
  cliques.forEach(c => socket.join(c._id.toString()));
  courses.forEach(c => socket.join(c.roomId));

  socket.on('join_room', roomId => socket.join(roomId));

  socket.on('send_message', async (data) => {
    try {
      const { roomId, text, senderName, senderColor, type, fileUrl, fileName, fileSize } = data;
      const course = await Course.findOne({ roomId });
      if (course && !courseHasMember(course, uid)) return socket.emit('error', 'You are not a member of this course');
      const msg = await Message.create({ roomId, senderId: uid, senderName, senderColor, text: text||'', type: type||'text', fileUrl, fileName, fileSize, readBy: [] });
      await Promise.all([
        DM.findOneAndUpdate({ roomId }, { lastMsg: text||fileName||'File', lastAt: new Date() }),
        Clique.findByIdAndUpdate(roomId, { lastMsg: text||fileName||'File', lastAt: new Date() })
      ]);
      io.to(roomId).emit('new_message', msg);

      // Push notification to offline members
      const [dm, clique, courseRoom] = await Promise.all([DM.findOne({ roomId }), Clique.findById(roomId), Course.findOne({ roomId })]);
      const members = dm?.members || clique?.members || courseRoom?.members || [];
      const hasOnlineRecipient = members.some(memberId => memberId.toString() !== uid && onlineUsers.has(memberId.toString()));
      if (hasOnlineRecipient) {
        const delivered = await Message.findByIdAndUpdate(msg._id, { deliveredAt: new Date() });
        io.to(roomId).emit('message_status', { msgId: msg._id, status: 'delivered', deliveredAt: delivered.deliveredAt });
      }
      for (const memberId of members) {
        if (memberId.toString() !== uid) {
          const memberSocket = onlineUsers.get(memberId.toString());
          if (!memberSocket) await sendPush(memberId, `New message from ${senderName}`, text||'Sent a file', { roomId });
        }
      }
    } catch (e) { socket.emit('error', e.message); }
  });

  socket.on('mark_room_read', async ({ roomId }) => {
    try {
      const messages = await Message.find({ roomId });
      for (const msg of messages) {
        if (msg.senderId === uid || (msg.readBy || []).includes(uid)) continue;
        const readBy = [...new Set([...(msg.readBy || []), uid])];
        const updated = await Message.findByIdAndUpdate(msg._id, { readBy });
        io.to(roomId).emit('message_status', { msgId: msg._id, status: 'read', readBy: updated.readBy });
      }
    } catch (e) { socket.emit('error', e.message); }
  });

  socket.on('react', async ({ msgId, emoji }) => {
    try {
      const msg = await Message.findByIdAndUpdate(msgId, { $inc: { [`reactions.${emoji}`]: 1 } }, { new: true });
      if (!msg) return socket.emit('error', 'Message not found');
      io.to(msg.roomId).emit('message_updated', msg);
    } catch (e) { socket.emit('error', e.message); }
  });

  socket.on('delete_message', async ({ msgId }) => {
    try {
      const msg = await Message.findById(msgId);
      if (!msg) return socket.emit('error', 'Message not found');
      if (msg.senderId !== uid) return socket.emit('error', 'You can only delete your own messages');
      await Message.findOneAndDelete({ _id: msgId, senderId: uid });
      io.to(msg.roomId).emit('message_deleted', { msgId, roomId: msg.roomId });
    } catch (e) { socket.emit('error', e.message); }
  });

  socket.on('typing', async ({ roomId, isTyping }) => {
    try {
      const [dm, clique, course] = await Promise.all([
        DM.findOne({ roomId }),
        Clique.findById(roomId),
        Course.findOne({ roomId })
      ]);
      const room = dm || clique || course;
      if (!room || !courseHasMember(room, uid)) return;
      socket.to(roomId).emit('typing', { roomId, userId: uid, isTyping });
    } catch (e) {
      socket.emit('error', e.message);
    }
  });
  socket.on('call_offer',   (data) => socket.to(data.to).emit('call_offer',   { ...data, from: uid }));
  socket.on('call_answer',  (data) => socket.to(data.to).emit('call_answer',  { ...data, from: uid }));
  socket.on('call_ice',     (data) => socket.to(data.to).emit('call_ice',     { ...data, from: uid }));
  socket.on('call_end',     (data) => socket.to(data.to).emit('call_end',     { from: uid }));
  socket.on('call_reject',  (data) => socket.to(data.to).emit('call_reject',  { from: uid }));

  socket.on('disconnect', async () => {
    onlineUsers.delete(uid);
    await User.findByIdAndUpdate(uid, { online: false, lastSeen: new Date() });
    io.emit('presence', { userId: uid, online: false });
  });
});

// ── SERVE FRONTEND ────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`🚀 Klasora v2 running on http://localhost:${PORT}`));
}

module.exports = { app, server };
