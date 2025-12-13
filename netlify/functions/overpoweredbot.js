import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import readline from 'readline';

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

function generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey }) {
  return {
    "bot.js": `// Auto-generated bot
const API_KEY = "${apiKey}";
const BOT_NAME = "${name}";
const DESCRIPTION = "${description}";
const VOICE_ID = "${voice_id}";
const FBX_MODEL = "${fbx_model_id}";

function respond(message) {
  return "You said: '" + message + "'. " + DESCRIPTION;
}

process.stdin.on('data', (data) => {
  const msg = data.toString().trim();
  console.log("[Bot Reply]: " + respond(msg));
});

console.log("Bot is ready with voice [" + VOICE_ID + "] and FBX [" + FBX_MODEL + "]");`
  };
}

// ---------------------- Bot Actions ----------------------
async function createBot({ name, description, voice_id, fbx_model_id, paid_link }) {
  if (!name || !description || !voice_id || !fbx_model_id) {
    return { error: "Missing required fields: name, description, voice_id, fbx_model_id" };
  }

  const hash = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const apiKey = generateAPIKey();
  const files = generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey });

  if (moderateContent(files)) {
    return { error: "Harmful content detected" };
  }

  const newBot = {
    name,
    description,
    files,
    hash,
    api_key: apiKey,
    voice_id,
    fbx_model_id,
    paid_link: paid_link || null,
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('bots').insert(newBot);
    if (error) return { error: error.message, details: error.details, hint: error.hint };
    return { hash, apiKey };
  } catch (err) {
    return { error: err.message || "Unknown error" };
  }
}

async function listBots(limit = 10) {
  const { data: bots, error } = await supabase.from('bots').select('*').limit(limit);
  if (error) return [];
  return bots || [];
}

// ---------------------- CLI Interface ----------------------
if (process.env.CLI_MODE === "true") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("🤖 Overpowered Bot CLI running...");
  console.log("Commands: !ping, !createbot <description> <voice_id> <fbx_model_id>, !listbots");

  rl.on('line', async (input) => {
    const [cmd, ...args] = input.split(' ');
    if (cmd === '!ping') console.log('Pong!');
    else if (cmd === '!createbot') {
      const [desc, voice, fbx] = args;
      console.log(await createBot({ name: `CLI_Bot_${Date.now()}`, description: desc, voice_id: voice, fbx_model_id: fbx }));
    }
    else if (cmd === '!listbots') console.log(await listBots());
    else console.log('Unknown command.');
  });
}

// ---------------------- Netlify Function Handler ----------------------
export async function handler(event) {
  try {
    const method = event.httpMethod || 'GET';
    const query = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const description = query.description || body.description;
    const name = query.name || body.name;
    const voice_id = query.voice_id || body.voice_id;
    const fbx_model_id = query.fbx_model_id || body.fbx_model_id;
    const paid_link = query.paid_link || body.paid_link;
    const action = query.action || body.action || null;
    const id = query.id || body.id || null;

    if (action === 'listbots') {
      const bots = await listBots();
      return { statusCode: 200, body: JSON.stringify(bots) };
    }

    if (action === 'getbot' && id) {
      const { data: bot, error } = await supabase.from('bots').select('*').eq('hash', id).single();
      if (error || !bot) return { statusCode: 404, body: JSON.stringify({ error: "Bot not found" }) };
      return { statusCode: 200, body: JSON.stringify(bot) };
    }

    if (method === 'POST') {
      const result = await createBot({ name, description, voice_id, fbx_model_id, paid_link });
      if (result.error) return { statusCode: 400, body: JSON.stringify(result) };
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Invalid action or missing parameters" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Unknown server error" }) };
  }
}
