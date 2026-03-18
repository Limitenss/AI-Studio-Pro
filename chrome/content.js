/**
 * Studio Pro - Content Engine
 */

// Global Configuration & Selectors
const CONFIG = {
  SELECTORS: {
    GEMINI: {
      INPUT: '.ql-editor, div[contenteditable="true"]',
      PROMPT: ['user-query', '.query-text', '[data-message-author-role="user"]'],
      AI_MESSAGE: 'model-response, .cl-message--assistant',
      STOP_BTN: 'button[aria-label="Stop generating"], .stop-button'
    },
    CHATGPT: {
      INPUT: '#prompt-textarea, textarea, div[contenteditable="true"]',
      PROMPT: ['[data-message-author-role="user"]', '[data-testid="user-message"]'],
      AI_MESSAGE: '[data-message-author-role="assistant"], [data-testid="bot-message"]',
      STOP_BTN: '[data-testid="stop-button"], .generating'
    },
    GLOBAL: {
      CODE_BLOCKS: 'pre:not(.ai-suite-processed)',
      HEADERS: '.code-block-header, .header-content, .bg-gray-800, [class*="header"]'
    }
  },
  EXT_MAP: {
    'python': 'py', 'py': 'py',
    'javascript': 'js', 'js': 'js', 'typescript': 'ts', 'ts': 'ts',
    'html': 'html', 'css': 'css', 'json': 'json',
    'rust': 'rs', 'rs': 'rs',
    'golang': 'go', 'go': 'go',
    'ruby': 'rb', 'php': 'php',
    'java': 'java', 'kotlin': 'kt',
    'cpp': 'cpp', 'c++': 'cpp', 'c#': 'cs', 'csharp': 'cs', 'c': 'c',
    'bash': 'sh', 'shell': 'sh', 'sql': 'sql',
    'yaml': 'yaml', 'yml': 'yaml', 'toml': 'toml',
    'markdown': 'md', 'md': 'md',
    'svg': 'svg', 'xml': 'xml',
    'jsx': 'jsx',
    'tsx': 'tsx',
    'vue': 'vue',
    'svelte': 'svelte',
    'sass': 'sass', 'scss': 'scss', 'less': 'less',
    'docker': 'docker', 'dockerfile': 'dockerfile', 'docker-compose': 'docker-compose', 'docker-compose.yml': 'docker-compose.yml', 'docker-compose.yaml': 'docker-compose.yaml'
  }
};

let autocopyEnabled = false;
let workspaces = [{ id: 'default', name: 'My Prompts', prompts: [] }];
let currentWorkspaceId = 'default';
let lastCopiedBlock = null;

// Initialize Storage
try {
  chrome.storage.local.get(['autocopy', 'workspaces', 'currentWorkspaceId'], (res) => {
    if (chrome.runtime.lastError) return;
    autocopyEnabled = !!res.autocopy;
    workspaces = res.workspaces || [{ id: 'default', name: 'My Prompts', prompts: [] }];
    currentWorkspaceId = res.currentWorkspaceId || 'default';
  });
} catch (e) {
  // Graceful fallback if storage fails
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.autocopy) autocopyEnabled = changes.autocopy.newValue;
  if (changes.workspaces) workspaces = changes.workspaces.newValue;
});

/**
 * Injects control buttons (Save As, Preview) into detected code blocks.
 */
function injectCodeButtons() {
  const codeBlocks = document.querySelectorAll(CONFIG.SELECTORS.GLOBAL.CODE_BLOCKS);

  codeBlocks.forEach(block => {
    block.classList.add('ai-suite-processed');
    const container = document.createElement('div');
    container.className = 'ai-suite-button-group';

    // Save-As Button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'ai-suite-button save-as-btn';
    saveBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      <span>Save As</span>
    `;
    saveBtn.onclick = (e) => { e.stopPropagation(); saveCodeBlock(block); };
    container.appendChild(saveBtn);

    // Live Preview Button (If HTML/CSS/SVG)
    const lang = detectLanguage(block);
    if (['html', 'css', 'svg'].includes(lang)) {
      const previewBtn = document.createElement('button');
      previewBtn.className = 'ai-suite-button preview-btn';
      previewBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>Preview</span>
      `;
      previewBtn.onclick = (e) => { e.stopPropagation(); openLivePreview(block); };
      container.appendChild(previewBtn);
    }

    // Platform-specific mounting
    const isGemini = window.location.hostname.includes('gemini');
    const header = block.closest('.code-block, .code-container, .bg-black, [class*="message"]')?.querySelector(CONFIG.SELECTORS.GLOBAL.HEADERS);

    if (header) {
      if (isGemini) {
        const nativeCopy = header.querySelector('button[aria-label*="Copy"], .copy-button');
        if (nativeCopy && !nativeCopy.closest('.ai-suite-button-group')) {
          container.prepend(nativeCopy);
        }
        header.appendChild(container);
        container.classList.add('gemini-header-mount');
      } else {
        header.appendChild(container);
        container.classList.add('header-mount');
      }
    } else {
      block.parentElement.style.position = 'relative';
      block.parentElement.appendChild(container);
    }
  });
}

/**
 * Detects the programming language of a code block.
 * @param {HTMLElement} element - The pre or container element.
 * @returns {string} The detected file extension.
 */
function detectLanguage(element) {
  const header = element.closest('.code-block, .code-container, .bg-black, [class*="message"]')?.querySelector(CONFIG.SELECTORS.GLOBAL.HEADERS);
  if (header) {
    const label = header.textContent.trim().toLowerCase();
    const words = label.split(/\s+/);
    for (const word of words) {
      if (CONFIG.EXT_MAP[word]) return CONFIG.EXT_MAP[word];
    }
    for (const [key, ext] of Object.entries(CONFIG.EXT_MAP)) {
      if (label.includes(key)) return ext;
    }
  }

  const codeTag = element.querySelector('code');
  if (codeTag) {
    const classes = Array.from(codeTag.classList);
    for (const cls of classes) {
      if (cls.startsWith('language-')) {
        const discovered = cls.replace('language-', '').toLowerCase();
        return CONFIG.EXT_MAP[discovered] || discovered;
      }
    }
  }

  const text = element.textContent;
  if (text.includes('import ') || text.includes('def ') || text.includes('print(')) return 'py';
  if (text.includes('fn main()') || text.includes('let mut ')) return 'rs';
  if (text.includes('package main') && text.includes('func ')) return 'go';
  if (text.includes('<!DOCTYPE html>') || text.includes('</html>')) return 'html';
  if (text.includes('<svg') && text.includes('</svg>')) return 'svg';

  return 'txt';
}

/**
 * Trigger file download for a code block.
 */
function saveCodeBlock(block) {
  try {
    const code = block.querySelector('code')?.textContent || block.textContent;
    const lang = detectLanguage(block);
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const filename = `code-${Date.now()}.${lang}`;
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    // Silent fail for download issues
  }
}

/**
 * Handles Live Web Preview rendering in a draggable iframe.
 */
function openLivePreview(block) {
  let previewWindow = document.getElementById('ai-studio-preview-window');
  if (!previewWindow) {
    previewWindow = document.createElement('div');
    previewWindow.id = 'ai-studio-preview-window';
    previewWindow.innerHTML = `
      <div id="ai-studio-preview-header">
        <span>Studio Preview</span>
        <button id="ai-studio-preview-close">×</button>
      </div>
      <iframe id="ai-studio-preview-frame"></iframe>
    `;
    document.body.appendChild(previewWindow);
    document.getElementById('ai-studio-preview-close').onclick = () => previewWindow.style.display = 'none';

    // Draggable Implementation
    let isDragging = false, offsetX, offsetY;
    const header = document.getElementById('ai-studio-preview-header');
    header.onmousedown = (e) => {
      isDragging = true;
      offsetX = e.clientX - previewWindow.offsetLeft;
      offsetY = e.clientY - previewWindow.offsetTop;
    };
    document.onmousemove = (e) => {
      if (isDragging) {
        previewWindow.style.left = (e.clientX - offsetX) + 'px';
        previewWindow.style.top = (e.clientY - offsetY) + 'px';
      }
    };
    document.onmouseup = () => isDragging = false;
  }

  const code = block.querySelector('code')?.textContent || block.textContent;
  const frame = document.getElementById('ai-studio-preview-frame');
  const blob = new Blob([code], { type: 'text/html' });
  frame.src = URL.createObjectURL(blob);
  previewWindow.style.display = 'flex';
}

/**
 * Monitors AI generation to trigger autocopy on completion.
 */
function monitorGeneration() {
  if (!autocopyEnabled) return;
  const isGemini = window.location.hostname.includes('gemini');
  const stopBtnSelector = isGemini ? CONFIG.SELECTORS.GEMINI.STOP_BTN : CONFIG.SELECTORS.CHATGPT.STOP_BTN;
  const isGenerating = document.querySelector(stopBtnSelector);

  if (!isGenerating) {
    const blocks = document.querySelectorAll('pre');
    if (blocks.length > 0) {
      const latest = blocks[blocks.length - 1];
      if (latest !== lastCopiedBlock) {
        lastCopiedBlock = latest;
        const text = latest.querySelector('code')?.textContent || latest.textContent;
        try {
          navigator.clipboard.writeText(text);
        } catch (e) {
          // Clipboard access might be blocked in some contexts
        }
      }
    }
  }
}

/**
 * Injects the global Refine Prompt button.
 */
function injectRefineGlobal() {
  if (document.getElementById('global-refine-btn')) return;
  const isGemini = window.location.hostname.includes('gemini');
  const selector = isGemini ? CONFIG.SELECTORS.GEMINI.INPUT : CONFIG.SELECTORS.CHATGPT.INPUT;
  const input = document.querySelector(selector);
  if (!input) return;

  const target = input.closest('form, fieldset, .input-area-container, .relative.flex.h-full.flex-1') || input.parentElement;
  if (!target) return;

  const container = document.createElement('div');
  container.id = 'global-refine-container';
  if (isGemini) container.className = 'gemini-style';

  const refineBtn = document.createElement('button');
  refineBtn.id = 'global-refine-btn';
  refineBtn.className = 'ai-suite-button';
  refineBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    <span>Refine Last Prompt <small>(Ctrl+Shift+R)</small></span>
  `;

  refineBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const lastPrompt = findLastUserPrompt();
    if (lastPrompt) refinePrompt(lastPrompt);
  };

  container.appendChild(refineBtn);
  if (target.parentElement) target.parentElement.insertBefore(container, target);
}

/**
 * Scrapes the last user prompt from the DOM.
 */

const findVariables = (text) => {
  const regex = /{{(.*?)}}/g;
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

function findLastUserPrompt() {
  const isGemini = window.location.hostname.includes('gemini');
  const selectors = isGemini ? CONFIG.SELECTORS.GEMINI.PROMPT : CONFIG.SELECTORS.CHATGPT.PROMPT;

  let candidates = [];
  selectors.forEach(sel => {
    const el = document.querySelectorAll(sel);
    if (el.length > 0) candidates.push(el[el.length - 1]);
  });

  if (candidates.length === 0) return "";

  const lastEl = candidates.sort((a, b) => b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1)[0];
  if (!lastEl) return "";

  let clone = lastEl.cloneNode(true);
  clone.querySelectorAll('button, svg, .ai-suite-button, .user-name, .time, .avatar').forEach(e => e.remove());

  return clone.innerText.trim().replace(/^(You said|You|Me|User|Assistant)[:\s\n\r]*/i, '').trim();
}

/**
 * Injects text into the AI platform's input field.
 */
function refinePrompt(text) {
  const isGemini = window.location.hostname.includes('gemini');
  const isChatGPT = window.location.hostname.includes('chatgpt');
  const selector = isGemini ? CONFIG.SELECTORS.GEMINI.INPUT : CONFIG.SELECTORS.CHATGPT.INPUT;
  const input = document.querySelector(selector);

  if (input) {
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = text;
    } else {
      input.innerHTML = '';
      if (isGemini) {
        const p = document.createElement('p');
        p.innerText = text;
        input.appendChild(p);
      } else {
        document.execCommand('insertText', false, text);
      }
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    if (isChatGPT && input.tagName === 'TEXTAREA') {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    }
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * GLOBAL HOTKEYS
 */
/**
 * PROMPT LIBRARY SIDEBAR
 */


function injectPromptLibrary() {
  if (document.getElementById('ai-studio-sidebar')) return;

  const sidebar = document.createElement('div');
  sidebar.id = 'ai-studio-sidebar';
  sidebar.innerHTML = `
    <div class="ai-studio-header">
      <span>AI Studio Library</span>
      <button id="ai-studio-sidebar-close">×</button>
    </div>
    <div class="ai-studio-content">
      <div class="ai-studio-section">
        <div class="ai-studio-section-header">
          <div class="workspace-selector-container">
            <select id="ai-workspace-select"></select>
            <button id="ai-studio-add-workspace" class="ai-studio-small-btn" title="New Workspace">+</button>
          </div>
          <button id="ai-studio-add-prompt" class="ai-studio-small-btn">+ New Prompt</button>
        </div>
        <div id="ai-studio-custom-list"></div>
        
        <div id="ai-studio-add-form" class="ai-studio-card hidden">
          <input type="text" id="ai-prompt-name" placeholder="Prompt Name...">
          <textarea id="ai-prompt-text" placeholder="Prompt content..."></textarea>
          <div class="ai-studio-form-actions">
             <button id="ai-save-prompt" class="ai-suite-button primary">Save</button>
             <button id="ai-cancel-prompt" class="ai-suite-button">Cancel</button>
          </div>
        </div>
      </div>

      <div class="ai-studio-section">
        <h3>AI Studio Defaults</h3>
        <div class="ai-studio-grid">
          <div class="ai-studio-prompt-item" data-prompt="Please review this code for bugs, security issues, and performance improvements.">
            <strong>🔍 Code Review</strong>
          </div>
          <div class="ai-studio-prompt-item" data-prompt="Rewrite the following text to be more professional, concise, and clear.">
            <strong>👔 Professional Polish</strong>
          </div>
          <div class="ai-studio-prompt-item" data-prompt="Explain this concept as if I am 5 years old, using simple analogies.">
            <strong>👶 ELI5</strong>
          </div>
        </div>
      </div>

      <div class="ai-studio-section">
        <h3>Export Session</h3>
        <button id="ai-studio-export-btn" class="ai-suite-button ai-studio-export-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          <span>Export Markdown</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(sidebar);

  document.getElementById('ai-studio-sidebar-close').onclick = toggleSidebar;
  document.getElementById('ai-studio-export-btn').onclick = exportSession;
  document.getElementById('ai-studio-add-prompt').onclick = () => document.getElementById('ai-studio-add-form').classList.toggle('hidden');
  document.getElementById('ai-cancel-prompt').onclick = () => document.getElementById('ai-studio-add-form').classList.add('hidden');
  document.getElementById('ai-save-prompt').onclick = saveNewPrompt;
  document.getElementById('ai-studio-add-workspace').onclick = createWorkspace;

  const wsSelect = document.getElementById('ai-workspace-select');
  wsSelect.onchange = (e) => {
    currentWorkspaceId = e.target.value;
    chrome.storage.local.set({ currentWorkspaceId });
    renderSidebarItems();
  };

  sidebar.querySelectorAll('.ai-studio-prompt-item').forEach(item => {
    item.onclick = () => {
      refinePrompt(item.getAttribute('data-prompt'));
      toggleSidebar();
    };
  });

  renderSidebarItems();
}

function showVariableForm(template, variables) {
  const overlay = document.createElement('div');
  overlay.className = 'variable-form-overlay';

  let formHTML = '<h3>Fill Variables</h3>'
  formHTML += '<div class="var-inputs-container">';
  variables.forEach(v => {
    formHTML += `<input type="text" placeholder="${v}" data-var="${v}" class="var-input">`;
  });
  formHTML += '</div>';
  formHTML += `
    <div class="form-actions">
      <button id="inject-var-btn" class="ai-suite-button primary">Inject</button>
      <button id="cancel-var-btn" class="ai-suite-button">Cancel</button>
    </div>`;
  overlay.innerHTML = formHTML;
  document.body.appendChild(overlay);

  // Draggable Implementation
  let isDragging = false, offsetX, offsetY;
  overlay.onmousedown = (e) => {
    // Only drag if the user clicks exactly on the background (the "black part")
    if (e.target !== overlay) return;

    isDragging = true;
    overlay.style.cursor = 'grabbing';

    // Get actual current position accounting for transforms
    const rect = overlay.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  };
  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      overlay.style.left = (e.clientX - offsetX) + 'px';
      overlay.style.top = (e.clientY - offsetY) + 'px';
      overlay.style.transform = 'none'; // Remove centering transform
      overlay.style.margin = '0';      // Reset margins if any
    }
  });
  document.addEventListener('mouseup', () => {
    isDragging = false;
    if (overlay.isConnected) overlay.style.cursor = 'grab';
  });

  document.getElementById('inject-var-btn').onclick = () => {
    let finalPrompt = template;
    overlay.querySelectorAll('.var-input').forEach(input => {
      const varName = input.dataset.var;
      const varValue = input.value;
      finalPrompt = finalPrompt.replace(`{{${varName}}}`, varValue);
    });
    refinePrompt(finalPrompt);
    overlay.remove();
    toggleSidebar();
  };

  document.getElementById('cancel-var-btn').onclick = () => overlay.remove();
}

function renderSidebarItems() {
  const container = document.getElementById('ai-studio-custom-list');
  const wsSelect = document.getElementById('ai-workspace-select');
  if (!container || !wsSelect) return;

  // Update Select Options
  wsSelect.innerHTML = workspaces.map(ws =>
    `<option value="${ws.id}" ${ws.id === currentWorkspaceId ? 'selected' : ''}>${ws.name}</option>`
  ).join('');

  container.innerHTML = '';
  const currentWS = workspaces.find(ws => ws.id === currentWorkspaceId) || workspaces[0];

  currentWS.prompts.forEach((p, index) => {
    const item = document.createElement('div');
    item.className = 'ai-studio-prompt-item custom';
    item.innerHTML = `
      <div class="prompt-info">
        <strong>${p.name}</strong>
      </div>
      <div class="prompt-actions">
        <button class="ai-studio-move-btn" title="Move to Workspace">📦</button>
        <button class="ai-studio-delete-btn" data-index="${index}">×</button>
      </div>
    `;
    item.onclick = (e) => {
      if (e.target.closest('.ai-studio-delete-btn') || e.target.closest('.ai-studio-move-btn')) return;

      const variables = findVariables(p.text);
      if (variables.length > 0) {
        showVariableForm(p.text, variables);
      } else {
        refinePrompt(p.text);
        toggleSidebar();
      }
    };

    item.querySelector('.ai-studio-delete-btn').onclick = (e) => {
      e.stopPropagation();
      deletePrompt(index);
    };

    item.querySelector('.ai-studio-move-btn').onclick = (e) => {
      e.stopPropagation();
      movePrompt(index);
    };
    container.appendChild(item);
  });
}

function saveNewPrompt() {
  const name = document.getElementById('ai-prompt-name').value;
  const text = document.getElementById('ai-prompt-text').value;
  if (!name || !text) return;

  const currentWS = workspaces.find(ws => ws.id === currentWorkspaceId) || workspaces[0];
  currentWS.prompts.push({ name, text });

  chrome.storage.local.set({ workspaces }, () => {
    document.getElementById('ai-prompt-name').value = '';
    document.getElementById('ai-prompt-text').value = '';
    document.getElementById('ai-studio-add-form').classList.add('hidden');
    renderSidebarItems();
  });
}

function deletePrompt(index) {
  const currentWS = workspaces.find(ws => ws.id === currentWorkspaceId) || workspaces[0];
  currentWS.prompts.splice(index, 1);
  chrome.storage.local.set({ workspaces }, renderSidebarItems);
}

function createWorkspace() {
  const name = prompt("Enter Workspace Name:");
  if (!name) return;

  const id = 'ws-' + Date.now();
  workspaces.push({ id, name, prompts: [] });
  currentWorkspaceId = id;

  chrome.storage.local.set({ workspaces, currentWorkspaceId }, () => {
    renderSidebarItems();
  });
}

function movePrompt(index) {
  const otherWS = workspaces.filter(ws => ws.id !== currentWorkspaceId);
  if (otherWS.length === 0) {
    alert("Create another workspace first to move prompts!");
    return;
  }

  const wsList = otherWS.map((ws, i) => `${i + 1}. ${ws.name}`).join('\n');
  const choice = prompt(`Move prompt to:\n${wsList}\n(Enter number)`);

  if (choice && otherWS[choice - 1]) {
    const currentWS = workspaces.find(ws => ws.id === currentWorkspaceId);
    const targetWS = otherWS[choice - 1];

    const [promptObj] = currentWS.prompts.splice(index, 1);
    targetWS.prompts.push(promptObj);

    chrome.storage.local.set({ workspaces }, renderSidebarItems);
  }
}

function exportSession() {
  console.log("AI Studio: Exporting session...");
  const userMessages = document.querySelectorAll('[data-message-author-role="user"], [data-testid="user-message"], user-query, .cl-user-message');
  const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"], [data-testid="bot-message"], model-response, .cl-message--assistant');

  let markdown = "# AI Studio Session Export\n\n";
  const count = Math.max(userMessages.length, assistantMessages.length);

  for (let i = 0; i < count; i++) {
    if (userMessages[i]) {
      let uText = userMessages[i].cloneNode(true);
      uText.querySelectorAll('.ai-suite-button, .user-name, .time, .avatar').forEach(e => e.remove());
      markdown += `### YOU:\n${uText.innerText.trim()}\n\n`;
    }
    if (assistantMessages[i]) {
      let aText = assistantMessages[i].cloneNode(true);
      aText.querySelectorAll('.ai-suite-button, button, svg').forEach(e => e.remove());
      markdown += `### AI:\n${aText.innerText.trim()}\n\n---\n\n`;
    }
  }

  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-session-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function toggleSidebar() {
  let sidebar = document.getElementById('ai-studio-sidebar');
  if (!sidebar) {
    injectPromptLibrary();
    sidebar = document.getElementById('ai-studio-sidebar');
  }
  
  if (sidebar) {
    sidebar.classList.toggle('active');
  }
}

/**
 * GLOBAL HOTKEYS (Updated)
 */
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey) {
    const key = e.key.toUpperCase();
    const code = e.code;

    // Detect R (Refine), S (Save), L/Space (Library/Sidebar)
    const isR = (key === 'R' || code === 'KeyR');
    const isS = (key === 'S' || code === 'KeyS');
    const isL = (key === 'L' || code === 'KeyL' || key === ' ' || code === 'Space');

    if (isR || isS || isL) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (isR) {
        const lp = findLastUserPrompt();
        if (lp) refinePrompt(lp);
      } else if (isS) {
        const blocks = document.querySelectorAll('pre');
        if (blocks.length > 0) saveCodeBlock(blocks[blocks.length - 1]);
      } else if (isL) {
        toggleSidebar();
      }
    }
  }
}, true);

/**
 * CODE COMMENTING FEATURE (MULTI-COMMENT SUPPORT WITH VISUAL HIGHLIGHTS)
 */
let currentSelection = { text: '', range: null, block: null };
let pendingComments = [];
let activeTooltip = null;

function handleSelectionChange(e) {
  if (e.target.closest('#ai-comment-trigger') ||
    e.target.closest('.ai-studio-comment-box') ||
    e.target.closest('.ai-studio-comment-tooltip')) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    removeCommentTrigger();
    return;
  }

  const range = selection.getRangeAt(0);
  const block = range.commonAncestorContainer.parentElement?.closest('pre');

  if (block) {
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      currentSelection = { text: selection.toString(), range: range, block: block };
      showCommentTrigger(rect);
    }
  } else {
    removeCommentTrigger();
  }
}

function showCommentTrigger(rect) {
  let trigger = document.getElementById('ai-comment-trigger');
  if (!trigger) {
    trigger = document.createElement('div');
    trigger.id = 'ai-comment-trigger';
    trigger.className = 'ai-studio-comment-trigger';
    trigger.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Comment`;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCommentBox();
    });

    document.body.appendChild(trigger);
  }

  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  trigger.style.left = `${scrollX + rect.left + (rect.width / 2) - (trigger.offsetWidth / 2)}px`;
  trigger.style.top = `${scrollY + rect.top - trigger.offsetHeight - 10}px`;
}

function removeCommentTrigger() {
  const trigger = document.getElementById('ai-comment-trigger');
  if (trigger) trigger.remove();
}

function showCommentBox() {
  const selectedText = currentSelection.text;
  const fullContent = currentSelection.block.textContent;
  const range = currentSelection.range;
  removeCommentTrigger();

  const box = document.createElement('div');
  box.className = 'ai-studio-comment-box';

  const rect = range.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  box.style.left = `${scrollX + rect.left}px`;
  box.style.top = `${scrollY + rect.bottom + 5}px`;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Comment on this snippet...';
  box.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'ai-suite-button-group';

  const addComment = () => {
    const commentText = input.value.trim();
    if (commentText) {
      // Create Highlight
      const highlight = document.createElement('span');
      highlight.className = 'ai-studio-comment-highlight';
      highlight.dataset.comment = commentText;
      highlight.dataset.snippet = selectedText;

      try {
        range.surroundContents(highlight);
      } catch (e) {
        console.warn("Could not surround contents, using fallback highlight");
      }

      // Add to pending
      let lineContext = "";
      const index = fullContent.indexOf(selectedText);
      if (index !== -1) {
        const startOfLine = fullContent.lastIndexOf('\n', index) + 1;
        let endOfLine = fullContent.indexOf('\n', index + selectedText.length);
        if (endOfLine === -1) endOfLine = fullContent.length;
        lineContext = fullContent.substring(startOfLine, endOfLine).trim();
      }

      pendingComments.push({
        snippet: selectedText,
        line: lineContext,
        comment: commentText
      });

      // Fixed Hover bridge logic
      highlight.onmouseenter = (e) => showCommentTooltip(e, highlight);
      highlight.onmouseleave = (e) => {
        setTimeout(() => {
          if (activeTooltip && !activeTooltip.matches(':hover') && !highlight.matches(':hover')) {
            activeTooltip.remove();
            activeTooltip = null;
          }
        }, 100);
      };

      box.remove();
      window.getSelection().removeAllRanges();
    }
  };

  const sendAll = () => {
    // Correctly process current input then send
    const currentText = input.value.trim();
    if (currentText) {
      let lineContext = "";
      const index = fullContent.indexOf(selectedText);
      if (index !== -1) {
        const startOfLine = fullContent.lastIndexOf('\n', index) + 1;
        let endOfLine = fullContent.indexOf('\n', index + selectedText.length);
        if (endOfLine === -1) endOfLine = fullContent.length;
        lineContext = fullContent.substring(startOfLine, endOfLine).trim();
      }
      pendingComments.push({ snippet: selectedText, line: lineContext, comment: currentText });

      // Visual feedback: also add highlight for the last one if sending
      const highlight = document.createElement('span');
      highlight.className = 'ai-studio-comment-highlight';
      try { range.surroundContents(highlight); } catch (e) { }
    }

    if (pendingComments.length === 0) return;

    let finalPrompt = "I have several comments regarding the code snippets below:\n\n";
    pendingComments.forEach((item, i) => {
      finalPrompt += `### 📝 Snippet #${i + 1}\n**Code:** \`${item.snippet}\`\n${item.line ? `**Line Context:** \`${item.line}\`\n` : ""}**💡 Comment:** ${item.comment}\n\n`;
    });

    refinePrompt(finalPrompt);
    pendingComments = [];
    box.remove();
    window.getSelection().removeAllRanges();
  };

  const addBtn = document.createElement('button');
  addBtn.className = 'ai-suite-button primary';
  addBtn.textContent = 'Add';
  addBtn.onclick = addComment;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'ai-suite-button';
  sendBtn.style.backgroundColor = 'var(--accent)';
  sendBtn.style.color = 'white';
  sendBtn.textContent = pendingComments.length > 0 ? `Send All (${pendingComments.length + 1})` : 'Send';

  input.oninput = () => {
    const count = pendingComments.length + (input.value.trim() ? 1 : 0);
    sendBtn.textContent = count > 1 ? `Send All (${count})` : 'Send';
  };

  sendBtn.onclick = sendAll;

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) sendAll();
      else addComment();
    }
    if (e.key === 'Escape') box.remove();
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-suite-button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => box.remove();

  actions.appendChild(addBtn);
  actions.appendChild(sendBtn);
  actions.appendChild(cancelBtn);
  box.appendChild(actions);

  document.body.appendChild(box);
  input.focus();
}

function showCommentTooltip(e, highlight) {
  if (activeTooltip) activeTooltip.remove();

  const tooltip = document.createElement('div');
  tooltip.className = 'ai-studio-comment-tooltip';

  const text = document.createElement('div');
  text.className = 'tooltip-text';
  text.innerHTML = `<strong>Comment:</strong><br>${highlight.dataset.comment}`;
  tooltip.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'tooltip-actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'ai-suite-button';
  deleteBtn.style.color = '#ff4b4b !important';
  deleteBtn.style.borderColor = 'rgba(255, 75, 75, 0.2) !important';
  deleteBtn.textContent = 'Delete';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    // Remove from pendingComments
    pendingComments = pendingComments.filter(c =>
      c.comment !== highlight.dataset.comment || c.snippet !== highlight.dataset.snippet
    );
    // Unwrap highlight
    const parent = highlight.parentNode;
    while (highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
    parent.removeChild(highlight);

    tooltip.remove();
    activeTooltip = null;
  };

  const sendBtn = document.createElement('button');
  sendBtn.className = 'ai-suite-button primary';
  sendBtn.textContent = 'Send';
  sendBtn.onclick = (e) => {
    e.stopPropagation();
    const generatedPrompt = `### 📝 Code Context\n**Snippet:** \`${highlight.dataset.snippet}\`\n\n### 💡 Instruction\n${highlight.dataset.comment}`;
    refinePrompt(generatedPrompt);
    tooltip.remove();
    activeTooltip = null;
  };

  actions.appendChild(deleteBtn);
  actions.appendChild(sendBtn);
  tooltip.appendChild(actions);

  document.body.appendChild(tooltip);
  activeTooltip = tooltip;

  const rect = highlight.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  tooltip.style.left = `${scrollX + rect.left}px`;
  tooltip.style.top = `${scrollY + rect.bottom + 2}px`;

  tooltip.onmouseleave = (e) => {
    setTimeout(() => {
      if (activeTooltip && !activeTooltip.matches(':hover') && !highlight.matches(':hover')) {
        tooltip.remove();
        activeTooltip = null;
      }
    }, 100);
  };
}

document.addEventListener('mouseup', handleSelectionChange);

setInterval(() => {
  injectCodeButtons();
  injectRefineGlobal();
  injectPromptLibrary();
  monitorGeneration();
}, 1000);

