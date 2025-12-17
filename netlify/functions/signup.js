import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Password validation
function validatePassword(password) {
  if (password.length < 30) return false;
  if (!/[A-Z]/.test(password[0])) return false;
  if (!/[0-9]/.test(password.slice(-1))) return false;
  if ((password.match(/[^A-Za-z0-9]/g) || []).length < 2) return false;
  return true;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    const { email, username, password } = JSON.parse(event.body || '{}');

    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email and password required.' }) };
    }

    // Check if email exists
    const { data: existing } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email already registered.' }) };
    }

    // Validate password
    if (!validatePassword(password)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Password does not meet requirements.' }) };
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);
    const verificationCode = uuidv4().split('-')[0];
    const finalUsername = (username || email.split('@')[0]).trim();

    // Insert user
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        email,
        username: finalUsername,
        password: hashed,
        verified: false,
        verification_code: verificationCode
      });

    if (insertError) throw insertError;

    // Always send email if secrets exist
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("EMAIL_USER or EMAIL_PASS missing. Code logged instead:");
      console.log(`Verification code for ${email}: ${verificationCode}`);
    } else {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });

      await transporter.sendMail({
        from: `"Botnev Team" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your Botnev Verification Code",
        text: `Hello ${finalUsername},\n\nYour verification code is: ${verificationCode}\nUse this code to verify your account.`
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Signup successful! Verification code sent.' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to signup.', details: err.message }) };
  }
};
