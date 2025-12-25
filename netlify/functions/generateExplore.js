import { createClient } from '@supabase/supabase-js';
import { voices } from './voices.js'; // your pre-defined voices array

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function generateExploreHTML(cookies = {}) {
  const session_token = cookies['__Host-session_secure'] || cookies['session_token'];
  const { data: bots, error } = await supabase.from('bots').select('*');
  if (error) return `<h1 style="color:red;">Error: ${error.message}</h1>`;

  let botHTML = '';
  bots.forEach((bot, index) => {
    const voice = bot.voice_id || 'en_us_general';
    const fbx = bot.fbx_model_id || 'N/A';
    const paidLink = bot.paid_link
      ? `<a href="${bot.paid_link}" target="_blank" style="background:#28a745;color:white;padding:5px 10px;border-radius:5px;text-decoration:none;">Buy on Gumroad</a>`
      : '';

    const personality = bot.personality ? JSON.stringify(bot.personality) : '{}';
    const emotional_state = bot.emotional_state ? JSON.stringify(bot.emotional_state) : '{}';
    const goals = bot.goals ? JSON.stringify(bot.goals) : '[]';
    const expressions = bot.expressions ? JSON.stringify(bot.expressions) : '[]';
    const memories = bot.memories ? JSON.stringify(bot.memories) : '[]';
    const dialogue_state = bot.dialogue_state ? JSON.stringify(bot.dialogue_state) : '{}';
    const dialogue = bot.dialogue || '';
    const editable = session_token && session_token === bot.api_key; // simple check for creator

    botHTML += `
      <div class="bot" 
           data-voice="${voice}" 
           data-dialogue="${dialogue.replace(/"/g,'&quot;')}"
           data-expressions='${expressions}'
           data-memories='${memories}'
           data-dialogue-state='${dialogue_state}'
           data-personality='${personality}'
           data-emotional-state='${emotional_state}'
           id="bot-${index}">
        <h2>${bot.name}${editable ? ' (Editable)' : ''}</h2>
        <p>${bot.description}</p>
        <p><strong>Voice:</strong> ${voice} | <strong>FBX:</strong> ${fbx}</p>
        <div class="fbx-preview">${fbx}</div>
        ${paidLink}
        <br><br>
        <input type="text" id="input-${index}" placeholder="Say something..." ${editable ? '' : 'disabled'} />
        <button onclick="sendMessage(${index})" ${editable ? '' : 'disabled'}>Send</button>
        <div id="chat-${index}" style="margin-top:5px; background:#eee; padding:5px; border-radius:5px; min-height:30px;"></div>
      </div>
    `;
  });

  const voicesJSON = JSON.stringify(voices);

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Explore Bots</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; background: #f0f0f0; }
      .bot { background: #fff; padding: 10px; margin-bottom: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
      input { padding:5px; width:70%; margin-right:5px; }
      button { padding:5px 10px; margin-right:5px; }
      .fbx-preview { width:100px; height:100px; background:#ddd; display:inline-block; margin-right:5px; text-align:center; line-height:100px; }
      p { margin: 5px 0; word-break: break-word; }
    </style>
  </head>
  <body>
    <h1>Explore Bots</h1>
    ${botHTML || '<p>No bots found yet.</p>'}

    <script type="module">
      const voices = ${voicesJSON};
      let tts;
      let availableVoices = [];

      document.addEventListener('DOMContentLoaded', async () => {
        if (typeof eSpeakNG !== 'undefined') {
          tts = new eSpeakNG('/espeakng-worker.js', () => console.log('eSpeakNG ready'));
        }
        availableVoices = window.speechSynthesis.getVoices();
        if (!availableVoices.length) {
          window.speechSynthesis.onvoiceschanged = () => {
            availableVoices = window.speechSynthesis.getVoices();
          };
        }
      });

      function mapVoice(botVoiceId) {
        const voiceData = voices.find(v => v.id === botVoiceId);
        if (!voiceData) return null;
        return availableVoices.find(v => v.lang === voiceData.lang && v.name.includes(voiceData.name)) || null;
      }

      async function speak(text, botVoiceId) {
        const browserVoice = mapVoice(botVoiceId);
        if (browserVoice) {
          const utter = new SpeechSynthesisUtterance(text);
          utter.voice = browserVoice;
          utter.rate = 1;
          utter.pitch = 1;
          utter.volume = 1;
          window.speechSynthesis.speak(utter);
          return;
        }
        if (tts) {
          try {
            await tts.speak(text, { voice: botVoiceId });
          } catch(err) {
            console.error('eSpeakNG TTS error:', err);
          }
        } else {
          console.warn('No TTS available for voice:', botVoiceId);
        }
      }

      function sendMessage(index) {
        const botDiv = document.getElementById(\`bot-\${index}\`);
        const input = document.getElementById(\`input-\${index}\`);
        const chat = document.getElementById(\`chat-\${index}\`);
        const msg = input.value.trim();
        if (!msg) return;

        let dialogue = botDiv.dataset.dialogue || "Hello!";
        let expressions = JSON.parse(botDiv.dataset.expressions || '[]');
        let memories = JSON.parse(botDiv.dataset.memories || '[]');
        let dialogue_state = JSON.parse(botDiv.dataset.dialogueState || '{}');

        // Add user input to memories
        memories.push({ user: "You", fact: msg, importance: 0.5 });
        memories = memories.slice(-100);

        // Generate bot reply: start with dialogue + simple expressions
        let reply = dialogue;
        if (expressions.length) reply += " [" + expressions.join(", ") + "]";
        reply += " You said: '" + msg + "'";

        chat.innerHTML += \`<div><strong>You:</strong> \${msg}</div>\`;
        chat.innerHTML += \`<div><strong>Bot:</strong> \${reply}</div>\`;

        speak(reply, botDiv.dataset.voice);
        input.value = '';

        // Update botDiv dataset for session memory (optional)
        botDiv.dataset.memories = JSON.stringify(memories);
      }
    </script>
  </body>
  </html>
  `;
}

export async function handler(event, context) {
  const cookies = {};
  if (event.headers.cookie) {
    event.headers.cookie.split(';').forEach(c => {
      const [k,v] = c.trim().split('=');
      cookies[k] = v;
    });
  }

  try {
    const html = await generateExploreHTML(cookies);
    return { statusCode: 200, headers:{ "Content-Type":"text/html"}, body: html };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers:{ "Content-Type":"text/plain"}, body: "Error generating explore page." };
  }
}
