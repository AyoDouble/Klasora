const REACTION_TYPES = new Set(['like', 'love', 'celebrate', 'insightful']);
const POST_CATEGORIES = new Set(['Campus', 'Study resources', 'Questions', 'Wins']);
const POST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMUNITY_SCHEMA_TABLES = ['community_posts', 'community_post_comments', 'community_post_reactions'];
const MISSING_SCHEMA_CODES = new Set(['PGRST205', '42P01']);

const getValue = (row, snakeKey, camelKey) => row?.[snakeKey] ?? row?.[camelKey];
const getInitials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
const getTimestamp = row => getValue(row, 'created_at', 'createdAt');

const inspectCommunityPostSchema = async supabase => {
  const checks = await Promise.all(COMMUNITY_SCHEMA_TABLES.map(async table => {
    const { error } = await supabase.from(table).select('id').limit(0);
    return { table, error };
  }));
  return {
    missingTables: checks.filter(({ error }) => MISSING_SCHEMA_CODES.has(error?.code)).map(({ table }) => table),
    errorCodes: checks.filter(({ error }) => error && !MISSING_SCHEMA_CODES.has(error.code)).map(({ error }) => error.code || 'unknown')
  };
};

const createCommunityPostHandlers = ({ supabase, io }) => {
  const unavailable = res => res.status(503).json({ error: 'Community feed storage is unavailable because Supabase is not configured on the backend.' });
  const withSchemaErrors = handler => async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      if (['PGRST205', '42P01'].includes(error?.code)) {
        return res.status(503).json({ error: 'Community feed tables are missing or unavailable.' });
      }
      throw error;
    }
  };

  const getUsers = async ids => {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) return new Map();
    const { data, error } = await supabase.from('users').select('id,name,color').in('id', uniqueIds);
    if (error) throw error;
    return new Map((data || []).map(user => [user.id, user]));
  };

  const getPost = async id => {
    const { data, error } = await supabase.from('community_posts').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  };

  const getPostSummaries = async (rows, userId) => {
    if (!rows.length) return [];
    const postIds = rows.map(row => row.id);
    const [usersResult, commentsResult, reactionsResult] = await Promise.all([
      getUsers(rows.map(row => getValue(row, 'user_id', 'userId'))),
      supabase.from('community_post_comments').select('post_id').in('post_id', postIds),
      supabase.from('community_post_reactions').select('post_id,user_id,reaction').in('post_id', postIds)
    ]);
    if (commentsResult.error) throw commentsResult.error;
    if (reactionsResult.error) throw reactionsResult.error;

    const commentCounts = new Map();
    for (const comment of commentsResult.data || []) {
      commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) || 0) + 1);
    }
    const reactionsByPost = new Map();
    for (const reaction of reactionsResult.data || []) {
      const reactions = reactionsByPost.get(reaction.post_id) || [];
      reactions.push(reaction);
      reactionsByPost.set(reaction.post_id, reactions);
    }

    return rows.map(row => {
      const author = usersResult.get(getValue(row, 'user_id', 'userId'));
      const reactions = reactionsByPost.get(row.id) || [];
      const reactionCounts = {};
      for (const reaction of reactions) {
        reactionCounts[reaction.reaction] = (reactionCounts[reaction.reaction] || 0) + 1;
      }
      const createdAt = getTimestamp(row);
      return {
        id: row.id,
        userId: getValue(row, 'user_id', 'userId'),
        name: author?.name || 'Klasora member',
        initials: getInitials(author?.name),
        color: author?.color || '#087e7b',
        text: row.text,
        category: row.category,
        createdAt,
        when: createdAt ? new Date(createdAt).toLocaleString() : '',
        commentCount: commentCounts.get(row.id) || 0,
        reactionCounts,
        myReaction: reactions.find(reaction => reaction.user_id === userId)?.reaction || ''
      };
    });
  };

  const list = async (req, res) => {
    if (!supabase) return unavailable(res);
    const { data, error } = await supabase.from('community_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json(await getPostSummaries(data || [], req.userId));
  };

  const create = async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const category = req.body?.category || 'Campus';
    if (!text || text.length > 800) return res.status(400).json({ error: 'Post text must be between 1 and 800 characters' });
    if (!POST_CATEGORIES.has(category)) return res.status(400).json({ error: 'Choose a valid post category' });
    if (!supabase) return unavailable(res);
    const { data, error } = await supabase.from('community_posts')
      .insert([{ user_id: req.userId, text, category }])
      .select('*')
      .single();
    if (error) throw error;
    const [post] = await getPostSummaries([data], req.userId);
    io.emit('post_created', post);
    res.status(201).json(post);
  };

  const listComments = async (req, res) => {
    const postId = req.params.postId;
    if (!POST_ID_PATTERN.test(postId)) return res.status(400).json({ error: 'A valid post ID is required' });
    if (!supabase) return unavailable(res);
    if (!await getPost(postId)) return res.status(404).json({ error: 'Post not found' });
    const { data, error } = await supabase.from('community_post_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const users = await getUsers((data || []).map(comment => getValue(comment, 'user_id', 'userId')));
    res.set('Cache-Control', 'no-store');
    res.json((data || []).map(comment => {
      const author = users.get(getValue(comment, 'user_id', 'userId'));
      return {
        id: comment.id,
        userId: getValue(comment, 'user_id', 'userId'),
        name: author?.name || 'Klasora member',
        initials: getInitials(author?.name),
        text: comment.text,
        createdAt: getTimestamp(comment)
      };
    }));
  };

  const createComment = async (req, res) => {
    const postId = req.params.postId;
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!POST_ID_PATTERN.test(postId)) return res.status(400).json({ error: 'A valid post ID is required' });
    if (!text || text.length > 500) return res.status(400).json({ error: 'Reply must be between 1 and 500 characters' });
    if (!supabase) return unavailable(res);
    if (!await getPost(postId)) return res.status(404).json({ error: 'Post not found' });
    const { data, error } = await supabase.from('community_post_comments')
      .insert([{ post_id: postId, user_id: req.userId, text }])
      .select('*')
      .single();
    if (error) throw error;
    const users = await getUsers([req.userId]);
    const author = users.get(req.userId);
    const comment = {
      id: data.id,
      userId: req.userId,
      name: author?.name || 'Klasora member',
      initials: getInitials(author?.name),
      text: data.text,
      createdAt: getTimestamp(data)
    };
    io.emit('post_comment_created', { postId, comment });
    res.status(201).json(comment);
  };

  const setReaction = async (req, res) => {
    const postId = req.params.postId;
    const reaction = req.body?.reaction;
    if (!POST_ID_PATTERN.test(postId)) return res.status(400).json({ error: 'A valid post ID is required' });
    if (reaction !== null && reaction !== '' && !REACTION_TYPES.has(reaction)) {
      return res.status(400).json({ error: 'Choose a valid reaction or clear it' });
    }
    if (!supabase) return unavailable(res);
    if (!await getPost(postId)) return res.status(404).json({ error: 'Post not found' });

    const { data: existing, error: existingError } = await supabase.from('community_post_reactions')
      .select('id,reaction')
      .eq('post_id', postId)
      .eq('user_id', req.userId)
      .maybeSingle();
    if (existingError) throw existingError;

    let nextReaction = reaction || '';
    if (existing && (!nextReaction || existing.reaction === nextReaction)) {
      const { error } = await supabase.from('community_post_reactions').delete().eq('id', existing.id);
      if (error) throw error;
      nextReaction = '';
    } else if (existing) {
      const { error } = await supabase.from('community_post_reactions')
        .update({ reaction: nextReaction })
        .eq('id', existing.id);
      if (error) throw error;
    } else if (nextReaction) {
      const { error } = await supabase.from('community_post_reactions')
        .insert([{ post_id: postId, user_id: req.userId, reaction: nextReaction }]);
      if (error) throw error;
    }

    const { data: reactions, error } = await supabase.from('community_post_reactions')
      .select('user_id,reaction')
      .eq('post_id', postId);
    if (error) throw error;
    const reactionCounts = {};
    for (const item of reactions || []) {
      reactionCounts[item.reaction] = (reactionCounts[item.reaction] || 0) + 1;
    }
    const result = { postId, userId: req.userId, reaction: nextReaction, reactionCounts };
    io.emit('post_reaction_changed', result);
    res.json(result);
  };

  return {
    list: withSchemaErrors(list),
    create: withSchemaErrors(create),
    listComments: withSchemaErrors(listComments),
    createComment: withSchemaErrors(createComment),
    setReaction: withSchemaErrors(setReaction)
  };
};

module.exports = { createCommunityPostHandlers, inspectCommunityPostSchema };
