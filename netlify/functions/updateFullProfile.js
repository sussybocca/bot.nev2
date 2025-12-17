import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    const { email, updates } = JSON.parse(event.body || '{}');

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "Email is required" }) };
    }

    // Fetch the full user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) return { statusCode: 404, body: JSON.stringify({ success: false, error: "User not found" }) };

    const updateData = { ...updates };

    // Handle password hashing if updated
    if (updateData.password && updateData.password !== user.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    // Update all fields present in updates
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('email', email)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Profile updated successfully!", user: updatedUser })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Failed to update profile", details: err.message })
    };
  }
};
