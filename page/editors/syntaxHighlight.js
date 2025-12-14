// syntaxHighlight.js
// Apply syntax highlighting in the editor for JS, HTML, and JSON files

// Basic regex patterns for JS, HTML, JSON
const patterns = {
  js: [
    { regex: /\b(const|let|var|function|if|else|return|for|while|switch|case|break|continue)\b/g, className: 'keyword' },
    { regex: /\/\/.*/g, className: 'comment' },
    { regex: /(["'`])(?:(?=(\\?))\2.)*?\1/g, className: 'string' },
    { regex: /\b(true|false|null|undefined)\b/g, className: 'boolean' },
    { regex: /\b\d+(\.\d+)?\b/g, className: 'number' }
  ],
  html: [
    { regex: /(&lt;!--[\s\S]*?--&gt;)/g, className: 'comment' },
    { regex: /(&lt;\/?[a-zA-Z]+[\s\S]*?&gt;)/g, className: 'tag' },
    { regex: /(["'])(?:(?=(\\?))\2.)*?\1/g, className: 'attribute' }
  ],
  json: [
    { regex: /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*?"\s*:)/g, className: 'key' },
    { regex: /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*?")/g, className: 'string' },
    { regex: /\b(true|false|null)\b/g, className: 'boolean' },
    { regex: /\b\d+(\.\d+)?\b/g, className: 'number' }
  ]
};

// Determine file type from extension
function getFileType(fileName) {
  if (fileName.endsWith('.js')) return 'js';
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return 'html';
  if (fileName.endsWith('.json')) return 'json';
  return 'plain';
}

// Apply syntax highlighting
function highlightCode(fileName, code) {
  const type = getFileType(fileName);
  if (!patterns[type]) return code;

  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  patterns[type].forEach(p => {
    highlighted = highlighted.replace(p.regex, match => `<span class="${p.className}">${match}</span>`);
  });

  return highlighted;
}

// Update code preview (optional for live preview)
function updateEditorHighlight(fileName, editorEl, previewEl) {
  editorEl.addEventListener('input', () => {
    previewEl.innerHTML = highlightCode(fileName, editorEl.value);
  });
}

// Example usage:
// updateEditorHighlight('script.js', codeArea, previewDiv);

