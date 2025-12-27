import { simpleParser } from 'mailparser';
import Imap from 'imap';
import cookie from 'cookie';

const IMAP_CONFIG = {
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASS,
  host: 'imap.gmail.com', // or the provider's IMAP server
  port: 993,
  tls: true,
};

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 min
const RATE_LIMIT_MAX = 30;

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    // Rate limiting
    const ip = event.headers['x-forwarded-for'] || event.headers['remote_addr'] || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
    const timestamps = rateLimitMap.get(ip).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= RATE_LIMIT_MAX) return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Too many requests' }) };
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);

    // Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'];
    if (!session_token) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };

    // You can still verify session from Supabase if you want
    // ...

    // Connect to IMAP
    const imap = new Imap(IMAP_CONFIG);

    const openInbox = () => new Promise((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) reject(err);
          else resolve(box);
        });
      });
      imap.once('error', reject);
      imap.connect();
    });

    const fetchEmails = () => new Promise((resolve, reject) => {
      imap.search(['ALL'], (err, results) => {
        if (err) return reject(err);
        if (!results || !results.length) return resolve([]);

        const f = imap.fetch(results.slice(-20), { // fetch last 20 emails
          bodies: '',
          markSeen: false,
        });

        const emails = [];
        f.on('message', msg => {
          let emailBuffer = '';
          msg.on('body', stream => {
            stream.on('data', chunk => { emailBuffer += chunk.toString('utf8'); });
          });
          msg.once('end', async () => {
            const parsed = await simpleParser(emailBuffer);
            emails.push({
              id: parsed.messageId,
              from: parsed.from?.text || 'Unknown',
              subject: parsed.subject || '',
              body: parsed.text || '',
              date: parsed.date || new Date(),
            });
          });
        });

        f.once('error', reject);
        f.once('end', () => {
          imap.end();
          resolve(emails.reverse());
        });
      });
    });

    await openInbox();
    const inbox = await fetchEmails();

    return { statusCode: 200, body: JSON.stringify({ success: true, emails: inbox }) };

  } catch (err) {
    console.error('Inbox error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
