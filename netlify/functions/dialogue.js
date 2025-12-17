import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    const { session_token, message } = JSON.parse(event.body || '{}');
    if (!session_token || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing session or message' })
      };
    }

    // 🔐 Verify session
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', session_token)
      .single();

    if (!sessionData) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    const userEmail = sessionData.user_email;

    // 🔎 Get creator settings for this user
    const { data: creatorSettings } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('user_email', userEmail)
      .single();

    const checkResponses = creatorSettings?.check_responses ?? true; // default: true

    // 🔎 Store user message
    const userMessageId = uuidv4();
    await supabase.from('messages').insert({
      id: userMessageId,
      user_email: userEmail,
      content: message,
      role: 'user',
      created_at: new Date()
    });

    // 🤖 Generate bot response
    let botResponse = 'I am not sure how to respond to that.';

    if (checkResponses) {
      // Get creator-defined responses from DB
      const { data: responseRules } = await supabase
        .from('dialogue_responses')
        .select('*')
        .eq('user_email', userEmail);

      // Match user message with creator responses
      const matched = responseRules.find(r =>
        message.toLowerCase().includes(r.trigger.toLowerCase())
      );
      if (matched) botResponse = matched.response_text;
    }

    // 🔎 Store bot response
    const botMessageId = uuidv4();
    await supabase.from('messages').insert({
      id: botMessageId,
      user_email: userEmail,
      content: botResponse,
      role: 'bot',
      created_at: new Date()
    });

    // 🔄 Retrieve recent conversation (last 20 messages)
    const { data: conversation } = await supabase
      .from('messages')
      .select('*')
      .eq('user_email', userEmail)
      .order('created_at', { ascending: true })
      .limit(20);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        botResponse,
        conversation
      })
    };
  } catch (err) {
    console.error('Dialogue function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' })
    };
  }
};
