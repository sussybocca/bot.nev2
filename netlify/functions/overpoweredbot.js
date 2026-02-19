import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import natural from 'natural';          // For TF‑IDF and sentiment
import { removeStopwords } from 'stopword';

const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Helpers ----------
function generateSecureToken() { return crypto.randomBytes(48).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function generateAPIKey() { return crypto.randomBytes(32).toString('base64url'); }

// Rate limiting (per IP)
const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const record = rateMap.get(ip) || { count: 0, time: now };
  if (now - record.time > 60000) {
    rateMap.set(ip, { count: 1, time: now });
    return true;
  }
  if (record.count > 30) return false;
  record.count++;
  rateMap.set(ip, record);
  return true;
}

// Content moderation (keyword blacklist)
const BLACKLIST = ['<script', 'eval(', 'malicious', 'hack', 'exploit', 'porn', 'violence'];
function moderateContent(text) {
  const lower = text.toLowerCase();
  return BLACKLIST.some(word => lower.includes(word));
}

// ---------- TF‑IDF Memory System ----------
class MemorySystem {
  constructor() {
    this.tfidf = new natural.TfIdf();
    this.memories = []; // { id, fact, importance, timestamp, docIndex }
  }

  addMemory(fact, importance = 0.5) {
    const id = crypto.randomBytes(8).toString('hex');
    const tokens = this.tokenize(fact);
    this.tfidf.addDocument(tokens);
    const docIndex = this.tfidf.documents.length - 1;
    this.memories.push({ id, fact, importance, timestamp: Date.now(), docIndex });
    return id;
  }

  searchMemories(query, topN = 5) {
    const queryTokens = this.tokenize(query);
    const scores = this.memories.map(m => {
      const sim = this.cosineSimilarity(queryTokens, m.docIndex);
      return { ...m, score: sim * m.importance }; // weight by importance
    });
    return scores.sort((a,b) => b.score - a.score).slice(0, topN);
  }

  tokenize(text) {
    return removeStopwords(text.toLowerCase().split(/\W+/));
  }

  cosineSimilarity(queryTokens, docIndex) {
    const doc = this.tfidf.documents[docIndex];
    if (!doc) return 0;
    let dot = 0, normQ = 0, normD = 0;
    const queryVec = {};
    queryTokens.forEach(t => { queryVec[t] = (queryVec[t] || 0) + 1; });
    for (const [term, freq] of Object.entries(queryVec)) {
      const tfidf = this.tfidf.tfidf(term, docIndex);
      if (tfidf) dot += freq * tfidf;
      normQ += freq * freq;
    }
    for (const term in doc) {
      if (term !== '__key') {
        const tfidf = this.tfidf.tfidf(term, docIndex);
        normD += tfidf * tfidf;
      }
    }
    if (normQ === 0 || normD === 0) return 0;
    return dot / (Math.sqrt(normQ) * Math.sqrt(normD));
  }

  // Decay old memories (called during reflection)
  decayMemories() {
    const now = Date.now();
    this.memories = this.memories.filter(m => {
      const age = now - m.timestamp;
      const decay = Math.exp(-age / (30 * 24 * 60 * 60 * 1000)); // 30-day half‑life
      return (m.importance * decay) > 0.1; // keep if still relevant
    });
    // Rebuild TF‑IDF (simplified: just reindex)
    this.tfidf = new natural.TfIdf();
    this.memories.forEach(m => {
      const tokens = this.tokenize(m.fact);
      this.tfidf.addDocument(tokens);
      m.docIndex = this.tfidf.documents.length - 1;
    });
  }
}

// ---------- Emotional State (OCC Model) ----------
class EmotionalState {
  constructor(initial = { mood: 'curious', pleasure: 0.5, arousal: 0.5, dominance: 0.5 }) {
    this.pleasure = initial.pleasure ?? 0.5;   // P
    this.arousal = initial.arousal ?? 0.5;     // A
    this.dominance = initial.dominance ?? 0.5; // D
    this.mood = initial.mood || 'curious';
  }

  // Update based on sentiment of a message
  updateFromMessage(text) {
    const sentiment = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
    const score = sentiment.getSentiment(text.split(/\W+/));
    // AFINN score ranges roughly -5 to +5
    this.pleasure = Math.min(1, Math.max(0, this.pleasure + score * 0.02));
    this.arousal = Math.min(1, Math.max(0, this.arousal + (Math.abs(score) * 0.01)));
    // Dominance: positive messages increase, negative decrease
    this.dominance = Math.min(1, Math.max(0, this.dominance + score * 0.01));

    // Map PAD to a mood label (simplified)
    if (this.pleasure > 0.7 && this.arousal > 0.6) this.mood = 'excited';
    else if (this.pleasure < 0.3 && this.arousal > 0.6) this.mood = 'anxious';
    else if (this.pleasure > 0.7 && this.arousal < 0.4) this.mood = 'calm';
    else if (this.pleasure < 0.3 && this.arousal < 0.4) this.mood = 'sad';
    else this.mood = 'neutral';
  }

  toJSON() {
    return { mood: this.mood, pleasure: this.pleasure, arousal: this.arousal, dominance: this.dominance };
  }
}

// ---------- Goal Management ----------
class GoalSystem {
  constructor(goals = []) {
    this.goals = goals.map(g => ({ ...g, completed: false, subgoals: [] }));
  }

  // Decompose a goal into sub‑goals using templates
  decomposeGoal(goal) {
    const templates = {
      'help': ['understand user need', 'find solution', 'explain clearly'],
      'learn': ['gather information', 'practice', 'test knowledge'],
      'entertain': ['tell a joke', 'share a story', 'play a game']
    };
    for (const [key, steps] of Object.entries(templates)) {
      if (goal.toLowerCase().includes(key)) {
        return steps.map((text, i) => ({
          id: crypto.randomBytes(4).toString('hex'),
          goal: text,
          priority: goal.priority - i * 0.1, // lower priority for deeper subgoals
          completed: false
        }));
      }
    }
    return []; // no decomposition
  }

  // Called during reflection: check progress, generate new subgoals
  reflect(memories) {
    // Mark goals as completed if recent memories mention them
    const recentFacts = memories.slice(0, 5).map(m => m.fact.toLowerCase());
    this.goals = this.goals.map(g => {
      if (!g.completed && recentFacts.some(f => f.includes(g.goal.toLowerCase()))) {
        return { ...g, completed: true };
      }
      return g;
    });

    // For incomplete high‑priority goals, generate subgoals if none exist
    this.goals.forEach(g => {
      if (!g.completed && g.priority > 5 && (!g.subgoals || g.subgoals.length === 0)) {
        g.subgoals = this.decomposeGoal(g);
      }
    });

    // If all goals completed, generate a new high‑level goal
    if (this.goals.every(g => g.completed)) {
      const newGoal = {
        id: crypto.randomBytes(4).toString('hex'),
        goal: 'explore new topic',
        priority: 5,
        completed: false,
        subgoals: []
      };
      this.goals.push(newGoal);
    }
  }
}

// ---------- Advanced Reasoning Engine (No AI) ----------
async function performAdvancedReasoning(bot) {
  if (!bot.advancedFeatures) return;

  // Reconstruct memory system from stored data
  const memorySys = new MemorySystem();
  bot.memories.forEach(m => memorySys.addMemory(m.fact, m.importance));

  // Reconstruct emotional state
  const emotion = new EmotionalState(bot.emotional_state);

  // Reconstruct goals
  const goalSys = new GoalSystem(bot.goals);

  // 1. Retrieve recent memories (last 10)
  const recentMemories = bot.memories.slice(-10).map(m => m.fact).join(' ');

  // 2. Update emotional state from recent memories (using sentiment)
  emotion.updateFromMessage(recentMemories);

  // 3. Reflect on goals
  goalSys.reflect(memorySys.searchMemories('progress', 5));

  // 4. Decay old memories
  memorySys.decayMemories();

  // 5. Store a reflection memory
  const reflectionText = `[Reflection at ${new Date().toISOString()}] Mood: ${emotion.mood}, Goals: ${goalSys.goals.length}`;
  memorySys.addMemory(reflectionText, 0.7);

  // 6. Save back to bot object
  bot.emotional_state = emotion.toJSON();
  bot.goals = goalSys.goals;
  bot.memories = memorySys.memories.map(m => ({
    fact: m.fact,
    importance: m.importance,
    timestamp: m.timestamp
  }));

  // Update database
  await supabase
    .from('bots')
    .update({
      emotional_state: bot.emotional_state,
      goals: bot.goals,
      memories: bot.memories,
      dialogue: bot.dialogue + `\n[Reflection]: ${reflectionText}`
    })
    .eq('id', bot.id);
}

// ---------- Bot Creation ----------
async function createBot(data, ip) {
  if (!rateLimit(ip)) return { error: 'Too many requests. Please wait.' };

  // Validate required fields
  if (!data.name || !data.description || !data.voice_id || !data.fbx_model_id) {
    return { error: 'Missing required fields.' };
  }

  // Content moderation
  if (moderateContent(JSON.stringify(data))) {
    return { error: 'Content violates policy.' };
  }

  const apiKey = generateAPIKey();
  const rawToken = generateSecureToken();
  const hashedToken = hashToken(rawToken);

  // Initialise memory system with provided memories
  const memorySys = new MemorySystem();
  (data.memories || []).forEach(m => memorySys.addMemory(m.fact, m.importance));

  // Initialise emotional state
  const emotion = new EmotionalState(data.emotional_state || {});

  // Initialise goals
  const goalSys = new GoalSystem((data.goals || []).map(g => ({ ...g, completed: false })));

  const bot = {
    name: data.name,
    description: data.description,
    api_key: apiKey,
    token_hash: hashedToken,
    token_expiry: Date.now() + 15 * 60 * 1000,
    voice_id: data.voice_id,
    fbx_model_id: data.fbx_model_id,
    paid_link: data.paid_link || null,
    personality: data.personality || { tone: 'friendly', traits: [], values: [], boundaries: [] },
    emotional_state: emotion.toJSON(),
    goals: goalSys.goals,
    expressions: data.expressions || [],
    dialogue: data.dialogue || '',
    memories: memorySys.memories,
    customization: data.customization || {},
    advancedFeatures: data.advancedFeatures !== false,
    reflection_count: 0,
    created_at: new Date()
  };

  const { data: inserted, error } = await supabase.from('bots').insert(bot).select().single();
  if (error) return { error: 'Database error: ' + error.message };

  // Trigger first reasoning step asynchronously (don't await)
  performAdvancedReasoning(inserted).catch(console.error);

  return {
    message: 'Bot created successfully.',
    bot_token: rawToken,
    api_key: apiKey,
    expires_in_minutes: 15
  };
}

// ---------- Netlify Handler ----------
export async function handler(event) {
  const ip = event.headers['x-forwarded-for'] || 'unknown';
  const body = event.body ? JSON.parse(event.body) : {};

  if (body.action === 'createbot') {
    const result = await createBot(body, ip);
    return { statusCode: 200, body: JSON.stringify(result) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
}
