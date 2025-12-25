import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import readline from 'readline';
import fetch from 'node-fetch';

// ---------------------- Supabase Client ----------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------- Helpers ----------------------
function generateAPIKey() {
  const randomBytes = crypto.randomBytes(32);
  const timestamp = Date.now().toString(36);
  return `${randomBytes.toString('base64url')}_${timestamp}`;
}

function moderateContent(files) {
  const harmfulPatterns = ["<script>alert", "eval(", "malicious"];
  for (let file of Object.values(files)) {
    for (let pattern of harmfulPatterns) {
      if (file.includes(pattern)) return true;
    }
  }
  return false;
}

// 🧠 Emotion & Memory Engines
function updateEmotion(state, message) {
  if (message.toLowerCase().includes("thank")) state.trust += 0.05;
  if (message.toLowerCase().includes("hate")) state.stress += 0.1;
  state.trust = Math.min(1, Math.max(0, state.trust));
  state.stress = Math.min(1, Math.max(0, state.stress));
  return state;
}

function storeMemory(memories, user, fact, importance = 0.5) {
  memories.push({ user, fact, importance });
  return memories.slice(-100);
}

// 🧠 Free AI (No keys, no server)
async function freeAI(prompt, persona) {
  const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: `
You are a character with this personality:
${JSON.stringify(persona)}

Respond naturally and in-character.

User: ${prompt}
Bot:
`
    })
  });
  const data = await response.json();
  return data[0]?.generated_text || "…";
}

// 🌳 Dialogue Tree
const dialogueTree = {
  greeting: ["hello", "hi", "hey"],
  help: ["help", "how", "what"]
};

function treeReply(msg) {
  msg = msg.toLowerCase();
  if (dialogueTree.greeting.some(k => msg.includes(k)))
    return "Hey there! 😊 What’s on your mind?";
  if (dialogueTree.help.some(k => msg.includes(k)))
    return "Of course — what do you need help with?";
  return null;
}

// ---------------------- Bot File Generator ----------------------
function generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey }) {
  return {
    "bot.js": `// Auto-generated AI Bot

const API_KEY = "${apiKey}";
const BOT_NAME = "${name}";
const DESCRIPTION = "${description}";
const VOICE_ID = "${voice_id}";
const FBX_MODEL = "${fbx_model_id}";

let BOT_MEMORY = {
  personality: {
    tone: "friendly",
    traits: ["curious", "humorous"],
    values: ["honesty", "loyalty"],
    boundaries: ["no violence", "no hate"]
  },
  emotional_state: { mood: "curious", trust: 0.5, stress: 0.2 },
  goals: [
    { goal: "Keep conversation engaging", priority: 1 },
    { goal: "Help the user", priority: 2 }
  ],
  memories: []
};

function speak(text) {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = VOICE_ID.replace('_','-');
    window.speechSynthesis.speak(utter);
  }
}

async function respond(message, user="guest") {
  let reply = treeReply(message) || "Thinking...";

  if (!reply) reply = await freeAI(message, BOT_MEMORY.personality);

  BOT_MEMORY.emotional_state = updateEmotion(BOT_MEMORY.emotional_state, message);
  BOT_MEMORY.memories = storeMemory(BOT_MEMORY.memories, user, message);

  speak(reply);
  return reply;
}

console.log("🤖 AI Bot Ready:", BOT_NAME);
`
  };
}

// ---------------------- Bot Actions ----------------------
async function createBot({ name, description, voice_id, fbx_model_id, paid_link }) {
  const hash = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const apiKey = generateAPIKey();
  const files = generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey });

  if (moderateContent(files)) return { error: "Harmful content detected" };

  const newBot = {
    name, description, files, hash,
    api_key: apiKey, voice_id, fbx_model_id,
    paid_link: paid_link || null,
    created_at: new Date().toISOString(),

    personality: { tone: "friendly", traits: ["curious","humorous"], values: ["honesty","loyalty"], boundaries: ["no violence","no hate"] },
    emotional_state: { mood: "curious", trust: 0.5, stress: 0.2 },
    goals: [{ goal: "Keep conversation engaging", priority: 1 },{ goal: "Help the user", priority: 2 }],
    memories: [],
    dialogue_state: {}
  };

  const { error } = await supabase.from('bots').insert(newBot);
  if (error) return { error: error.message };
  return { hash, apiKey };
}

// ---------------------- List Bots ----------------------
async function listBots(limit=10) {
  const { data } = await supabase.from('bots').select('*').limit(limit);
  return data || [];
}

// ---------------------- CLI ----------------------
if (process.env.CLI_MODE === "true") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("🤖 Overpowered AI Bot Platform running...");

  rl.on('line', async (input) => {
    const [cmd, ...args] = input.split(' ');
    if (cmd === '!createbot') {
      const [desc, voice, fbx] = args;
      console.log(await createBot({ name:`CLI_Bot_${Date.now()}`, description: desc, voice_id: voice, fbx_model_id: fbx }));
    }
    if (cmd === '!listbots') console.log(await listBots());
  });
}

// ---------------------- Netlify Handler ----------------------
export async function handler(event) {
  const body = event.body ? JSON.parse(event.body) : {};
  const action = body.action;

  if (action === "listbots") return { statusCode: 200, body: JSON.stringify(await listBots()) };
  if (action === "createbot") return { statusCode: 200, body: JSON.stringify(await createBot(body)) };

  return { statusCode: 400, body: "Invalid request" };
}
