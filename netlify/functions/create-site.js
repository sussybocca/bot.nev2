import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { user_id, site_name } = JSON.parse(event.body || '{}');

    // Validate inputs
    if (!user_id || !site_name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing user_id or site_name' }) };
    }

    if (!/^[a-z0-9-]{3,30}$/.test(site_name)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid site name. Only lowercase letters, numbers, and - allowed.' }) };
    }

    // Check for duplicate subdomain
    const { data: existing, error: selectError } = await supabase
      .from('sites')
      .select('subdomain')
      .eq('subdomain', site_name)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // Supabase returns 116 for no rows
      throw selectError;
    }

    if (existing) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Subdomain already exists' }) };
    }

    // Set expiration one month from now
    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + 1);

    // Insert new site
    const { error: insertError } = await supabase
      .from('sites')
      .insert({
        user_id,
        subdomain: site_name,
        expires_at,
        created_at: new Date()
      });

    if (insertError) throw insertError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Site created successfully',
        url: `https://${site_name}.botnet2.netlify.app`
      })
    };

  } catch (err) {
    console.error('create-site error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error', details: err.message }) };
  }
};
