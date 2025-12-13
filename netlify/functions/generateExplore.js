import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function generateExploreHTML() {
  const { data: bots, error } = await supabase.from('bots').select('*');
  if (error) return `<h1 style="color:red;">Error: ${error.message}</h1>`;

  let botHTML = '';
  bots.forEach((bot, index) => {
    const safeDesc = bot.description.replace(/"/g, '&quot;');
    const voice = bot.voice_id || 'Unknown';
    const fbx = bot.fbx_model_id || 'N/A';
    const paidLink = bot.paid_link ? `<a href="${bot.paid_link}" target="_blank" style="background:#28a745;color:white;padding:5px 10px;border-radius:5px;text-decoration:none;">Buy on Gumroad</a>` : '';

    botHTML += `
      <div class="bot" data-description="${safeDesc}" id="bot-${index}">
        <h2>${bot.name}</h2>
        <p>${bot.description}</p>
        <p><strong>Voice:</strong> ${voice} | <strong>FBX:</strong> ${fbx}</p>
        <div class="fbx-preview">${fbx}</div>
        ${paidLink}
        <br><br>
        <input type="text" id="input-${index}" placeholder="Say something..." />
        <button onclick="sendMessage(${index})">Send</button>
        <div id="chat-${index}" style="margin-top:5px; background:#eee; padding:5px; border-radius:5px; min-height:30px;"></div>
      </div>
    `;
  });

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
    </style>
  </head>
  <body>
    <h1>Explore Bots</h1>
    ${botHTML || '<p>No bots found yet.</p>'}

    <script>
      function sendMessage(index) {
        const botDiv = document.getElementById('bot-' + index);
        const input = document.getElementById('input-' + index);
        const chat = document.getElementById('chat-' + index);
        const msg = input.value.trim();
        if(!msg) return;
        const description = botDiv.getAttribute('data-description');
        const reply = "You said: '" + msg + "'. " + description;
        chat.innerHTML += "<div><strong>You:</strong> " + msg + "</div>";
        chat.innerHTML += "<div><strong>Bot:</strong> " + reply + "</div>";
        input.value = "";
      }
    </script>
  </body>
  </html>
  `;
}

export async function handler(event, context) {
  try {
    const html = await generateExploreHTML();
    return { statusCode: 200, headers:{ "Content-Type":"text/html"}, body: html };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers:{ "Content-Type":"text/plain"}, body: "Error generating explore page." };
  }
}
