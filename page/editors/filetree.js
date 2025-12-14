const fileTreeEl = document.getElementById('fileTree');

function renderFileTree(treeData, parentEl = fileTreeEl) {
  parentEl.innerHTML = '';
  Object.keys(treeData).forEach(key => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.textContent = key;
    if (treeData[key].type === 'folder') {
      item.classList.add('folder');
      const childrenEl = document.createElement('div');
      childrenEl.className = 'folder-children';
      item.appendChild(childrenEl);
      item.addEventListener('click', e => {
        e.stopPropagation();
        childrenEl.style.display = childrenEl.style.display === 'none' ? 'block' : 'none';
      });
      renderFileTree(treeData[key].children, childrenEl);
    } else {
      item.addEventListener('click', () => {
        currentFile = treeData[key].path;
        openFile(currentFile);
      });
    }
    parentEl.appendChild(item);
  });
}

// Fetch file tree from Netlify function
async function loadFileTree(userEmail) {
  try {
    const res = await fetch('/.netlify/functions/getEditorItem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: userEmail })
    });
    const data = await res.json();
    if (data.success && data.fileTree) {
      fileTreeData = data.fileTree;
      renderFileTree(fileTreeData);
    } else {
      console.error('Failed to load file tree:', data.error);
    }
  } catch (err) {
    console.error('Error fetching file tree:', err);
  }
}

// Example initial structure (fallback if function fails)
fileTreeData = {
  "example.boteo": { type: "file", path: "example.boteo", content: "// Sample content" },
  "scripts": { type: "folder", children: {
    "init.js": { type: "file", path: "scripts/init.js", content: "// Init script" }
  }}
};

renderFileTree(fileTreeData);

// Call this with the logged-in user's email to fetch their files
loadFileTree('test@example.com');
