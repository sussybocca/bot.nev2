import fetch from 'node-fetch';

export async function verifyCaptcha(token, ip) {
  if (!token) return false;

  const secret = process.env.CAPTCHA_SECRET_KEY;

  const response = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${secret}&response=${token}&remoteip=${ip}`
  });

  const data = await response.json();
  return data.success === true;
}
