import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------- Helpers ----------------------
function generateSecureToken() { return crypto.randomBytes(48).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function generateAPIKey() { return crypto.randomBytes(32).toString('base64url'); }
function isValidInput(str) { return typeof str === 'string' && str.length > 0 && str.length < 500; }

const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const record = rateMap.get(ip) || { count: 0, time: now };
  if (now - record.time > 60000) { rateMap.set(ip, { count: 1, time: now }); return true; }
  if (record.count > 30) return false;
  record.count++; rateMap.set(ip, record); return true;
}

// ---------------------- Moderation ----------------------
function moderateContent(files) {
  const harmfulPatterns = ["<script", "eval(", "malicious"];
  return Object.values(files).some(file =>
    harmfulPatterns.some(pattern => file.includes(pattern))
  );
}

// ---------------------- Advanced Emotion ----------------------
function updateEmotion(state, message, history = []) {
  history.push({ message, timestamp: Date.now() });
  if (message.toLowerCase().includes("thank")) state.trust += 0.05;
  if (message.toLowerCase().includes("hate")) state.stress += 0.1;
  const decayRate = 0.00005;
  state.trust = Math.min(1, Math.max(0, state.trust - decayRate * history.length));
  state.stress = Math.min(1, Math.max(0, state.stress - decayRate * history.length));
  return state;
}

// ---------------------- Advanced Memory ----------------------
function storeMemory(memories, user, fact, importance = 0.5) {
  const timestamp = Date.now();
  memories.push({ user, fact, importance, timestamp });
  if (memories.length > 500) memories = memories.slice(-500);
  return memories;
}

function retrieveMemory(memories, query, topN = 10) {
  return memories
    .map(mem => ({ ...mem, score: query.split(" ").reduce((acc, word) => acc + (mem.fact.toLowerCase().includes(word.toLowerCase()) ? 1 : 0), 0) }))
    .sort((a,b) => b.score - a.score)
    .slice(0, topN);
}

// ---------------------- Goals ----------------------
function updateGoals(goals, outcome) {
  return goals.map(goal => { if (outcome.includes(goal.goal)) goal.completed = true; return goal; });
}

function getActiveGoals(goals) {
  return goals.filter(g => !g.completed).sort((a,b) => b.priority - a.priority);
}

// ---------------------- Free AI ----------------------
async function freeAI(prompt, persona, memories = [], emotional_state = {}, goals = []) {
  const memoryText = retrieveMemory(memories, prompt).map(m => `Memory: ${m.fact}`).join("\n");
  const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      inputs: `Personality: ${JSON.stringify(persona)}
EmotionalState: ${JSON.stringify(emotional_state)}
Goals: ${JSON.stringify(goals)}
Memory: ${memoryText}
User: ${prompt}
Bot:`
    })
  });
  const data = await response.json();
  return data[0]?.generated_text || "...";
}

// ---------------------- Advanced Reasoning ----------------------
async function performAdvancedReasoning(bot) {
  if(!bot.advancedFeatures) return;

  const reflectionPrompt = `Review bot state:
Dialogue: ${bot.dialogue}
Memories: ${bot.memories.map(m => m.fact).join("\n")}
Goals: ${bot.goals.map(g => g.goal + " (completed: " + g.completed + ")").join(", ")}
Personality: ${JSON.stringify(bot.personality)}
Emotional state: ${JSON.stringify(bot.emotional_state)}
Suggest improvements, plans, or sub-goals.`;

  const plan = await freeAI(reflectionPrompt, bot.personality, bot.memories, bot.emotional_state, bot.goals);

  bot.dialogue += `\n[Planning Step]: ${plan}`;
  bot.goals = updateGoals(bot.goals, plan);
  bot.memories = storeMemory(bot.memories, "system", `Generated plan: ${plan}`, 0.7);

  await supabase.from('bots').update({
    dialogue: bot.dialogue,
    goals: bot.goals,
    memories: bot.memories
  }).eq('api_key', bot.api_key);
}

// ---------------------- Bot Generator ----------------------
function generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey, customization }) {
  return {
    "bot.js": `const API_KEY="${apiKey}"; const VOICE="${voice_id}"; const MODEL="${fbx_model_id}"; const CUSTOMIZATION=${JSON.stringify(customization)};`
  };
}

// ---------------------- Create Bot ----------------------
async function createBot(data, ip) {
  if (!rateLimit(ip)) return { error:"Too many requests" };
  if (![data.name,data.description,data.voice_id,data.fbx_model_id].every(isValidInput)) return { error:"Invalid input" };

  const apiKey = generateAPIKey();
  const rawToken = generateSecureToken();
  const hashedToken = hashToken(rawToken);

  const files = generateUserFiles({ ...data, apiKey });
  if (moderateContent(files)) return { error:"Harmful content detected" };

  const bot = {
    name: data.name,
    description: data.description,
    files,
    api_key: apiKey,
    voice_id: data.voice_id,
    fbx_model_id: data.fbx_model_id,
    paid_link: data.paid_link||null,
    created_at: new Date().toISOString(),
    personality: data.personality || { tone:"friendly", traits:["curious"], values:["honesty"], boundaries:["no violence"] },
    emotional_state: data.emotional_state || { mood:"curious", trust:0.5, stress:0.2 },
    goals: (Array.isArray(data.goals) && data.goals.length ? data.goals : [{goal:"Help user", priority:1, completed:false}]).map(g=>({...g, completed:false})),
    expressions: data.expressions||[],
    dialogue: data.dialogue||"",
    memories: data.memories||[],
    customization: data.customization||{},
    advancedFeatures: true,
    token_hash: hashedToken,
    token_expiry: Date.now()+15*60*1000
  };

  const { error } = await supabase.from('bots').insert(bot);
  if (error) return { error:error.message || "Database error" };

  // Immediate reasoning step
  await performAdvancedReasoning(bot);

  return { message:"Bot created.", bot_token:rawToken, api_key:apiKey, expires_in_minutes:15 };
}

// ---------------------- Netlify Handler ----------------------
export async function handler(event) {
  const ip = event.headers['x-forwarded-for'] || 'unknown';
  const body = event.body ? JSON.parse(event.body) : {};

  if (body.action==="createbot") {
    const result = await createBot(body, ip);
    return { statusCode:200, body:JSON.stringify(result) };
  }

  return { statusCode:400, body:"Invalid request" };
}
