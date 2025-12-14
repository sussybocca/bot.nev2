// uploadHandler.js
const uploadInput = document.getElementById('uploadFolder');

uploadInput.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files.length) return;

  const folderData = {};
  for (const file of files) {
    const text = await file.text();
    folderData[file.webkitRelativePath] = text;
  }

  try {
    const response = await fetch('/.netlify/functions/uploadFolder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_data: folderData })
    });
    const result = await response.json();
    alert(result.success ? 'Folder uploaded!' : 'Upload failed.');
  } catch (err) {
    console.error('Upload error:', err);
    alert('Upload failed.');
  }
});
