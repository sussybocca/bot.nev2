import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch'; // Ensure this is installed in your environment

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper: split large string into chunks
function chunkString(str, maxChunkSize = 50000) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    chunks.push(str.slice(start, start + maxChunkSize));
    start += maxChunkSize;
  }
  return chunks;
}

// Exchange GitHub code for access token
async function getGitHubAccessToken(code) {
  const GITHUB_CLIENT_ID = process.env.CLIENT_ID;
  const GITHUB_CLIENT_SECRET = process.env.CLIENT_SECRET;

  const response = await fetch(`https://github.com/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  return data.access_token;
}

// Push site files to a GitHub repo
async function pushSiteToGitHub(userToken, owner, repoName, files) {
  const fileEntries = Object.entries(files);
  for (const [filename, content] of fileEntries) {
    const url = `https://api.github.com/repos/${owner}/${repoName}/contents/${filename}`;
    const body = {
      message: `Add ${filename} via Fire-USA site builder`,
      content: Buffer.from(content).toString('base64')
    };

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(`GitHub API error for file ${filename}: ${errData.message}`);
    }
  }

  return { success: true, repoUrl: `https://github.com/${owner}/${repoName}` };
}

// Lambda / API handler
export const handler = async (event) => {
  try {
    // NEW: Handle GET requests for login redirect
    if (event.httpMethod === 'GET' && event.queryStringParameters?.action === 'login') {
      const clientId = process.env.CLIENT_ID;
      const redirectUri = event.headers.origin || 'https://your-site.com'; // adjust your domain
      const scope = 'repo';
      return {
        statusCode: 302,
        headers: {
          Location: `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}`
        },
        body: ''
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body', details: parseError.message })
      };
    }

    const { site_name, files, github_code, github_repo_owner, github_repo_name } = body;

    if (!site_name) return { statusCode: 400, body: JSON.stringify({ error: 'Missing site_name' }) };
    if (!/^[a-z0-9-]{3,30}$/.test(site_name)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid site name' }) };
    if (!files || typeof files !== 'object') return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid files object' }) };
    if (!github_code) return { statusCode: 400, body: JSON.stringify({ error: 'Missing GitHub OAuth code' }) };
    if (!github_repo_owner || !github_repo_name) return { statusCode: 400, body: JSON.stringify({ error: 'Missing GitHub repo info' }) };

    // Exchange code for a token
    const githubToken = await getGitHubAccessToken(github_code);

    // Track site metadata in Supabase
    const chunkedFiles = {};
    for (const [filename, content] of Object.entries(files)) {
      chunkedFiles[filename] = chunkString(content, 50000);
    }

    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + 1);

    const { data: insertedData, error: insertError } = await supabase
      .from('sites')
      .insert({
        name: site_name,
        subdomain: site_name,
        files: chunkedFiles,
        expires_at,
        created_at: new Date()
      });

    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase insert error', details: insertError }) };
    }

    // Push files to the user's GitHub repo
    const githubResult = await pushSiteToGitHub(githubToken, github_repo_owner, github_repo_name, files);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Site created successfully under your domain using GitHub',
        githubUrl: githubResult.repoUrl,
        insertedData
      })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Unhandled error', details: err.message }) };
  }
};
