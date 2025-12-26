import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function validateSession(session_token) {
  if (!session_token) return null;
  const { data: session } = await supabase
    .from('sessions')
    .select('user_email, expires_at')
    .eq('session_token', session_token)
    .maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;
  return session.user_email;
}

export async function handler(event) {
  try {
    const { botId, dialogue, expressions, voice } = JSON.parse(event.body);
    const cookies = {};
    if (event.headers.cookie) {
      event.headers.cookie.split(';').forEach(c => {
        const [k,v] = c.trim().split('=');
        cookies[k] = v;
      });
    }
    const user_email = await validateSession(cookies['__Host-session_secure'] || cookies['session_token']);
    if (!user_email) return { statusCode: 401, body: 'Unauthorized' };

    // Get the bot
    const { data: bot } = await supabase.from('bots').select('*').eq('id', botId).maybeSingle();
    if (!bot) return { statusCode: 404, body: 'Bot not found' };
    if (bot.owner_email !== user_email) return { statusCode: 403, body: 'Forbidden' };

    // Update the bot
    const { error } = await supabase.from('bots')
      .update({ dialogue, expressions, voice_id: voice })
      .eq('id', botId);

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: 'Bot updated successfully' };
  } catch(err) {
    return { statusCode: 500, body: err.message };
  }
}
