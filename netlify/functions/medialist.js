const fetch = require('node-fetch');  // To make API requests

exports.handler = async function(event, context) {
  const apiUrl = 'https://api.github.com/repos/sussybocca/bot.nev2/contents/assets';

  try {
    // Fetch the contents of the 'assets' folder from your GitHub repo
    const response = await fetch(apiUrl);

    if (!response.ok) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Failed to fetch data from GitHub API' }),
      };
    }

    const files = await response.json();

    // Separate media files and PNG cover arts
    const mediaFiles = files.filter(file => 
      file.name.toLowerCase().endsWith('.mp3') || file.name.toLowerCase().endsWith('.mp4')
    ).map(file => ({
      name: file.name,
      download_url: file.download_url,
      baseName: file.name.replace(/\.[^/.]+$/, "") // strip extension
    }));

    const pngFiles = files.filter(file =>
      file.name.toLowerCase().endsWith('.png')
    ).reduce((acc, file) => {
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      acc[baseName] = file.download_url;
      return acc;
    }, {});

    // Assign matching cover art to media files
    const mediaWithCovers = mediaFiles.map(file => ({
      ...file,
      cover_url: pngFiles[file.baseName] || null
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ mediaFiles: mediaWithCovers }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Error: ${error.message}` }),
    };
  }
};
