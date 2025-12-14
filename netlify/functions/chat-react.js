import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
    const { session_token, message_id, reaction } = JSON.parse(event.body);
    const user_id = await verifySession(session_token);

    // Insert or update reaction
    await supabase
        .from('message_reactions')
        .upsert({
            message_id,
            user_id,
            reaction,
            created_at: new Date()
        }, { onConflict: ['message_id', 'user_id'] });

    return { statusCode: 200, body: 'Reaction added/updated' };
}
