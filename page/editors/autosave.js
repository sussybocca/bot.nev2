// autosave.js
setInterval(() => {
  if (!currentFile) return;
  console.log('Autosaving', currentFile);
  fileTreeData[currentFile].content = codeArea.value;
}, 15000); // every 15 seconds
