// editor.js
const codeArea = document.getElementById('codeArea');
const saveBtn = document.getElementById('saveBtn');
const backupBtn = document.getElementById('backupBtn');

let currentFile = null;
let fileTreeData = {}; // Structure will be loaded from fileTree.js or Netlify function

// Load a file into the editor
function openFile(filePath) {
  if (!fileTreeData[filePath]) return;
  currentFile = filePath;
  codeArea.value = fileTreeData[filePath].content;
}

// Save the current file
async function saveFile() {
  if (!currentFile) return alert('Select a file first!');
  fileTreeData[currentFile].content = codeArea.value;

  try {
    const response = await fetch('/.netlify/functions/manageItem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        filePath: currentFile,
        content: codeArea.value
      })
    });
    const result = await response.json();
    alert(result.success ? 'Saved successfully!' : 'Save failed.');
  } catch (err) {
    console.error('Save error:', err);
    alert('Save failed.');
  }
}

// Backup current editor content
async function backupEditor() {
  try {
    const response = await fetch('/.netlify/functions/backupItem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: fileTreeData })
    });
    const result = await response.json();
    alert(result.success ? 'Backup created!' : 'Backup failed.');
  } catch (err) {
    console.error('Backup error:', err);
    alert('Backup failed.');
  }
}

saveBtn.addEventListener('click', saveFile);
backupBtn.addEventListener('click', backupEditor);
