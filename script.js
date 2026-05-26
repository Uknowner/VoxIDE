// Browser IDE - script.js

// ============================================================
// ELEMENT REFS
// ============================================================
const els = {
  openProjectBtn:   document.getElementById("openProjectBtn"),
  saveFileBtn:      document.getElementById("saveFileBtn"),
  saveAllBtn:       document.getElementById("saveAllBtn"),
  newFileBtn:       document.getElementById("newFileBtn"),
  newFolderBtn:     document.getElementById("newFolderBtn"),
  renameItemBtn:    document.getElementById("renameItemBtn"),
  deleteItemBtn:    document.getElementById("deleteItemBtn"),
  exportProjectBtn: document.getElementById("exportProjectBtn"),
  fileSearch:       document.getElementById("fileSearch"),
  projectName:      document.getElementById("projectName"),
  projectPath:      document.getElementById("projectPath"),
  fileTree:         document.getElementById("fileTree"),
  currentFile:      document.getElementById("currentFile"),
  tabsBar:          document.getElementById("tabsBar"),
  editorHost:       document.getElementById("editor"),
  statusText:       document.getElementById("statusText"),
  cursorText:       document.getElementById("cursorText"),
  encodingText:     document.getElementById("encodingText"),
  langText:         document.getElementById("langText"),
  toggleTreeBtn:    document.getElementById("toggleTreeBtn"),
  wordWrapBtn:      document.getElementById("wordWrapBtn"),
  fontIncBtn:       document.getElementById("fontIncBtn"),
  fontDecBtn:       document.getElementById("fontDecBtn"),
  autoSaveBtn:      document.getElementById("autoSaveBtn"),
  saveAccessBanner: document.getElementById("saveAccessBanner"),
  grantAccessBtn:   document.getElementById("grantAccessBtn"),
  dismissBannerBtn: document.getElementById("dismissBannerBtn"),
  contextMenu:      document.getElementById("contextMenu"),
  sidebar:          document.querySelector(".sidebar"),
};

// ============================================================
// STATE
// ============================================================
const state = {
  projectHandle:       null,
  projectEntries:      new Map(), // path -> { handle, file, kind, parentHandle, parentPath, path, name }
  selectedPath:        null,
  selectedKind:        null,
  currentFilePath:     null,
  editor:              null,
  currentModel:        null,
  treeVisible:         true,
  wordWrap:            true,
  fontSize:            14,
  autoSave:            false,
  openFiles:           new Map(), // path -> { handle, file, model, language, dirty, tabEl, labelEl, closeEl, path }
  searchQuery:         "",
  suppressModelChange: false,
  saveDebounce:        null,
  autoSaveTimer:       null,
  fallbackMode:        false,
  folderInput:         null,
  contextTarget:       null,
};

// ============================================================
// LANGUAGE MAP
// ============================================================
const SUPPORTED_EXTENSIONS = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript",
  jsx: "javascript", tsx: "typescript",
  html: "html", htm: "html",
  css: "css",
  json: "json",
  md: "markdown",
  py: "python",
  java: "java",
  cpp: "cpp", c: "c",
  cs: "csharp",
  go: "go",
  php: "php",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  xml: "xml",
  yml: "yaml", yaml: "yaml",
  txt: "plaintext",
};

const LANG_DISPLAY = {
  javascript: "JavaScript", typescript: "TypeScript",
  html: "HTML", css: "CSS", json: "JSON",
  markdown: "Markdown", python: "Python",
  java: "Java", cpp: "C++", c: "C",
  csharp: "C#", go: "Go", php: "PHP",
  rust: "Rust", shell: "Shell", sql: "SQL",
  xml: "XML", yaml: "YAML", plaintext: "Plain Text",
};

// ============================================================
// INIT
// ============================================================
init();

function init() {
  createFolderInput();
  bindUI();
  initMonaco();
  setStatus("Ready — open a folder to start");
  updateProjectMeta();
  updateEncoding("UTF-8");
  updateLangText();
  if (!("showDirectoryPicker" in window)) {
    setStatus("Note: File System API not supported — saving will be limited.");
  }
}

// ============================================================
// FOLDER INPUT (fallback)
// ============================================================
function createFolderInput() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.webkitdirectory = true;
  input.hidden = true;
  input.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    await openProjectFromFileList(files);
    input.value = "";
  });
  document.body.appendChild(input);
  state.folderInput = input;
}

// ============================================================
// OPEN DIR VIA DRAG-AND-DROP ENTRIES
// ============================================================
async function openDirectoryEntries(entries) {
  const files = [];

  async function walk(entry, path = "") {
    if (entry.isFile) {
      await new Promise((resolve) => {
        entry.file((file) => {
          file.fullPath = path + file.name;
          files.push(file);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readEntries = async () => {
        const results = await new Promise((resolve) => reader.readEntries(resolve));
        if (!results.length) return;
        for (const child of results) await walk(child, path + entry.name + "/");
        await readEntries();
      };
      await readEntries();
    }
  }

  for (const entry of entries) await walk(entry, "");
  await openProjectFromFileList(files);
}

// ============================================================
// BIND UI
// ============================================================
function bindUI() {
  // Prevent browser default drag-and-drop navigation
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop",     (e) => e.preventDefault());

  // Drop zone
  const dropZone   = document.getElementById("dropZone");
  const folderInput = document.getElementById("folderInput");

  if (dropZone) {
    dropZone.addEventListener("click", () => {
      if ("showDirectoryPicker" in window) {
        openProject();
      } else {
        folderInput?.click();
      }
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");

      // Use webkitGetAsEntry for full folder traversal
      const items   = Array.from(e.dataTransfer.items || []);
      const entries = items
        .filter((i) => i.kind === "file")
        .map((i) => i.webkitGetAsEntry?.())
        .filter(Boolean);

      if (entries.length) {
        await openDirectoryEntries(entries);
        return;
      }

      // Fallback: raw files
      const files = Array.from(e.dataTransfer.files);
      if (files.length) await openProjectFromFileList(files);
    });
  }

  if (folderInput) {
    folderInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      await openProjectFromFileList(files);
      folderInput.value = "";
    });
  }

  // Toolbar buttons
  els.openProjectBtn.addEventListener("click",    openProject);
  els.saveFileBtn.addEventListener("click",       saveCurrentFile);
  els.saveAllBtn.addEventListener("click",        saveAllFiles);
  els.newFileBtn.addEventListener("click",        createNewFile);
  els.newFolderBtn.addEventListener("click",      createNewFolder);
  els.renameItemBtn.addEventListener("click",     renameSelectedItem);
  els.deleteItemBtn.addEventListener("click",     deleteSelectedItem);
  els.exportProjectBtn.addEventListener("click",  exportProject);
  els.toggleTreeBtn.addEventListener("click",     toggleTree);
  els.wordWrapBtn.addEventListener("click",       toggleWordWrap);
  els.fontIncBtn.addEventListener("click",        () => adjustFontSize(1));
  els.fontDecBtn.addEventListener("click",        () => adjustFontSize(-1));
  els.autoSaveBtn.addEventListener("click",       toggleAutoSave);
  els.grantAccessBtn.addEventListener("click",    grantSaveAccess);
  els.dismissBannerBtn.addEventListener("click",  hideSaveAccessBanner);

  // File search
  els.fileSearch.addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    applySearchFilter();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveCurrentFile();
    }
  });

  // Context menu: hide on outside click
  document.addEventListener("click", () => hideContextMenu());
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".file-tree")) hideContextMenu();
  });

  // Context menu items
  document.getElementById("ctxOpen").addEventListener("click",          ctxOpenFile);
  document.getElementById("ctxNewFileHere").addEventListener("click",   ctxNewFileHere);
  document.getElementById("ctxNewFolderHere").addEventListener("click", ctxNewFolderHere);
  document.getElementById("ctxRename").addEventListener("click",        ctxRenameItem);
  document.getElementById("ctxDelete").addEventListener("click",        ctxDeleteItem);

  // Unsaved changes warning
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ""; }
  });
}

// ============================================================
// MONACO INIT
// ============================================================
function initMonaco() {
  if (typeof require === "undefined") {
    setStatus("Monaco loader failed to load.");
    return;
  }

  require.config({
    paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs" },
  });

  require(["vs/editor/editor.main"], () => {
    state.editor = monaco.editor.create(els.editorHost, {
      value:            "",
      language:         "plaintext",
      theme:            "vs-dark",
      automaticLayout:  true,
      minimap:          { enabled: true, scale: 1 },
      fontSize:         state.fontSize,
      tabSize:          2,
      insertSpaces:     true,
      wordWrap:         "on",
      scrollBeyondLastLine: false,
      smoothScrolling:  true,
      cursorBlinking:   "smooth",
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      suggest:          { showWords: true },
    });

    // Cursor position → status bar
    state.editor.onDidChangeCursorPosition((e) => {
      els.cursorText.textContent =
        `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

    // Content change → dirty flag + optional auto-save
    state.editor.onDidChangeModelContent(() => {
      if (state.suppressModelChange) return;
      const file = getCurrentOpenFile();
      if (!file) return;

      file.dirty = true;
      updateTabState(file);
      updateCurrentFileLabel();
      setStatus(`Modified: ${shortName(file.path)}`);

      if (state.autoSave) {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = setTimeout(() => {
          saveCurrentFile(true); // silent
        }, 1500);
      }
    });

    // Ctrl+S inside Monaco
    state.editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => saveCurrentFile()
    );
  });
}

// ============================================================
// OPEN PROJECT
// ============================================================
async function openProject() {
  if (!("showDirectoryPicker" in window)) {
    state.folderInput?.click();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const ok = await verifyPermission(handle, true);
    if (!ok) { alert("Permission denied."); return; }
    await openProjectFromDirectoryHandle(handle);
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.warn("Directory picker failed, falling back.", err);
      state.folderInput?.click();
    }
  }
}

async function openProjectFromDirectoryHandle(handle) {
  state.projectHandle  = handle;
  state.fallbackMode   = false;
  state.selectedPath   = null;
  state.selectedKind   = null;
  state.currentFilePath = null;
  els.tabsBar.innerHTML = "";
  state.openFiles.clear();

  state.projectEntries.clear();
  await indexDirectory(handle, "");
  renderTree();
  updateProjectMeta();
  hideSaveAccessBanner();
  hideDropZone();
  setStatus(`Opened: ${handle.name}`);
}

async function openProjectFromFileList(files) {
  state.projectHandle = { name: deriveRootName(files), fallback: true };
  state.fallbackMode  = true;
  state.selectedPath  = null;
  state.selectedKind  = null;
  state.currentFilePath = null;
  els.tabsBar.innerHTML = "";
  state.openFiles.clear();

  state.projectEntries.clear();
  for (const file of files) {
    const fullPath     = file.webkitRelativePath || file.name;
    const relativePath = stripRootFolder(fullPath);
    if (!relativePath) continue;
    addFallbackFileEntry(relativePath, file);
  }

  renderTree();
  updateProjectMeta();
  showSaveAccessBanner();
  hideDropZone();
  setStatus(`Opened: ${state.projectHandle.name} (read-only — grant access to save)`);
}

// ============================================================
// GRANT SAVE ACCESS
// ============================================================
async function grantSaveAccess() {
  if (!("showDirectoryPicker" in window)) {
    alert("File System Access API is not supported in this browser (use Chrome or Edge).");
    return;
  }

  try {
    setStatus("Requesting folder access...");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const ok     = await verifyPermission(handle, true);
    if (!ok) { alert("Permission denied."); return; }

    if (handle.name !== state.projectHandle?.name) {
      const proceed = confirm(
        `Selected folder "${handle.name}" doesn't match current project "${state.projectHandle?.name}".\n\nOpen it anyway?`
      );
      if (!proceed) return;
    }

    await openProjectFromDirectoryHandle(handle);
    setStatus(`Save access granted for: ${handle.name}`);
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error(err);
      alert("Could not grant access.");
    }
  }
}

function showSaveAccessBanner() {
  els.saveAccessBanner?.classList.remove("hidden");
}

function hideSaveAccessBanner() {
  els.saveAccessBanner?.classList.add("hidden");
}

function hideDropZone() {
  document.getElementById("dropZone")?.classList.add("hidden");
}

// ============================================================
// EDITOR FEATURE TOGGLES
// ============================================================
function toggleWordWrap() {
  state.wordWrap = !state.wordWrap;
  state.editor?.updateOptions({ wordWrap: state.wordWrap ? "on" : "off" });
  els.wordWrapBtn?.classList.toggle("btn-on", state.wordWrap);
  setStatus(`Word wrap: ${state.wordWrap ? "on" : "off"}`);
}

function adjustFontSize(delta) {
  state.fontSize = Math.max(10, Math.min(28, state.fontSize + delta));
  state.editor?.updateOptions({ fontSize: state.fontSize });
  setStatus(`Font size: ${state.fontSize}px`);
}

function toggleAutoSave() {
  state.autoSave = !state.autoSave;
  els.autoSaveBtn?.classList.toggle("btn-on", state.autoSave);
  setStatus(`Auto-save: ${state.autoSave ? "on (1.5s delay)" : "off"}`);
}

function updateLangText() {
  const file = getCurrentOpenFile();
  const lang = file?.language || "plaintext";
  els.langText.textContent = LANG_DISPLAY[lang] || lang;
}

// ============================================================
// CONTEXT MENU
// ============================================================
function showContextMenu(x, y, path, kind) {
  state.contextTarget = { path, kind };
  const menu = els.contextMenu;

  // Show/hide items based on kind
  document.getElementById("ctxOpen").classList.toggle("disabled", kind !== "file");

  menu.style.left = x + "px";
  menu.style.top  = y + "px";
  menu.classList.remove("hidden");

  // Keep menu on screen
  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width)  + "px";
  if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + "px";
}

function hideContextMenu() {
  els.contextMenu?.classList.add("hidden");
  state.contextTarget = null;
}

function ctxOpenFile() {
  if (state.contextTarget?.kind === "file") openFile(state.contextTarget.path);
  hideContextMenu();
}

async function ctxNewFileHere() {
  hideContextMenu();
  await createNewFile();
}

async function ctxNewFolderHere() {
  hideContextMenu();
  await createNewFolder();
}

function ctxRenameItem() {
  if (state.contextTarget) {
    state.selectedPath = state.contextTarget.path;
    state.selectedKind = state.contextTarget.kind;
  }
  hideContextMenu();
  renameSelectedItem();
}

function ctxDeleteItem() {
  if (state.contextTarget) {
    state.selectedPath = state.contextTarget.path;
    state.selectedKind = state.contextTarget.kind;
  }
  hideContextMenu();
  deleteSelectedItem();
}

// ============================================================
// FILE SYSTEM HELPERS
// ============================================================
function deriveRootName(files) {
  const first = files.find(Boolean);
  if (!first) return "Project";
  const rel = first.webkitRelativePath || first.name;
  return rel.split("/").filter(Boolean)[0] || "Project";
}

function stripRootFolder(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(1).join("/");
}

function addFallbackFileEntry(relativePath, file) {
  const parts    = relativePath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1];

  let parentPath = "";
  for (let i = 0; i < parts.length - 1; i++) {
    const folderPath = parts.slice(0, i + 1).join("/");
    if (!state.projectEntries.has(folderPath)) {
      state.projectEntries.set(folderPath, {
        kind: "directory", name: parts[i], path: folderPath,
        parentPath: i === 0 ? "" : parts.slice(0, i).join("/"),
        handle: null,
      });
    }
    parentPath = folderPath;
  }

  state.projectEntries.set(relativePath, {
    kind: "file", name: fileName, path: relativePath,
    parentPath, handle: null, file,
  });
}

async function verifyPermission(handle, readWrite = false) {
  const options = readWrite ? { mode: "readwrite" } : {};
  if ((await handle.queryPermission(options)) === "granted") return true;
  if ((await handle.requestPermission(options)) === "granted") return true;
  return false;
}

async function indexDirectory(dirHandle, parentPath) {
  for await (const entry of dirHandle.values()) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    state.projectEntries.set(path, {
      handle: entry, kind: entry.kind,
      parentHandle: dirHandle, parentPath, path, name: entry.name,
    });
    if (entry.kind === "directory") await indexDirectory(entry, path);
  }
}

// ============================================================
// RENDER FILE TREE
// ============================================================
function renderTree() {
  els.fileTree.innerHTML = "";

  if (!state.projectHandle) {
    els.fileTree.innerHTML =
      `<div style="padding:12px;color:#8b949e;font-size:12px;">Open a folder to begin.</div>`;
    return;
  }

  const root = createFolderNode(state.projectHandle.name, "");
  els.fileTree.appendChild(root);
  applySearchFilter();
}

function createFolderNode(folderName, folderPath) {
  const wrapper  = document.createElement("div");
  wrapper.className = "folder";
  wrapper.dataset.path = folderPath;
  wrapper.dataset.kind = "directory";

  const title = document.createElement("div");
  title.className = "folder-title";
  title.textContent = `📁 ${folderName}`;
  title.dataset.path = folderPath;
  title.dataset.kind = "directory";

  const children = document.createElement("div");
  children.className = "folder-children";

  title.addEventListener("click", (e) => {
    e.stopPropagation();
    selectTreeItem(folderPath, "directory", title);
    children.classList.toggle("hidden");
  });

  title.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectTreeItem(folderPath, "directory", title);
    showContextMenu(e.clientX, e.clientY, folderPath, "directory");
  });

  wrapper.appendChild(title);
  wrapper.appendChild(children);

  const entries = getChildrenForPath(folderPath).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (entry.kind === "directory") {
      children.appendChild(createFolderNode(entry.name, entry.path));
    } else {
      children.appendChild(createFileNode(entry.name, entry.path));
    }
  }

  return wrapper;
}

function createFileNode(fileName, filePath) {
  const el = document.createElement("div");
  el.className = "file";
  el.textContent = `📄 ${fileName}`;
  el.dataset.path = filePath;
  el.dataset.kind = "file";

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectTreeItem(filePath, "file", el);
    openFile(filePath);
  });

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectTreeItem(filePath, "file", el);
    showContextMenu(e.clientX, e.clientY, filePath, "file");
  });

  return el;
}

function getChildrenForPath(folderPath) {
  const results = [];
  for (const entry of state.projectEntries.values()) {
    const parentPath = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : "";
    if (parentPath === folderPath) results.push(entry);
  }
  return results;
}

function selectTreeItem(path, kind, el) {
  state.selectedPath = path;
  state.selectedKind = kind;

  document.querySelectorAll(".file.active-file")
    .forEach((n) => n.classList.remove("active-file"));
  document.querySelectorAll(".folder-title.active-folder")
    .forEach((n) => n.classList.remove("active-folder"));

  if (el.classList.contains("file")) {
    el.classList.add("active-file");
  } else {
    el.classList.add("active-folder");
  }
}

// ============================================================
// OPEN FILE / TABS
// ============================================================
async function openFile(filePath) {
  const entry = state.projectEntries.get(filePath);
  if (!entry || entry.kind !== "file") return;

  if (state.openFiles.has(filePath)) {
    activateTab(filePath);
    return;
  }

  const content  = await readEntryText(entry);
  const language = detectLanguage(filePath);
  const model    = monaco.editor.createModel(content, language);

  const fileState = {
    handle: entry.handle || null,
    file:   entry.file   || null,
    model, language,
    dirty: false,
    tabEl: null, labelEl: null, closeEl: null,
    path:  filePath,
  };

  fileState.tabEl = createTab(fileState);
  state.openFiles.set(filePath, fileState);
  activateTab(filePath);
  setStatus(`Opened: ${shortName(filePath)}`);
}

async function readEntryText(entry) {
  if (entry.handle && typeof entry.handle.getFile === "function") {
    const file = await entry.handle.getFile();
    return await file.text();
  }
  if (entry.file) return await entry.file.text();
  return "";
}

function createTab(fileState) {
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.title = fileState.path;

  const label = document.createElement("span");
  label.textContent = shortName(fileState.path);

  const close = document.createElement("span");
  close.className  = "tab-close";
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeFileTab(fileState.path);
  });

  tab.addEventListener("click", () => activateTab(fileState.path));
  tab.appendChild(label);
  tab.appendChild(close);

  fileState.labelEl = label;
  fileState.closeEl = close;

  els.tabsBar.appendChild(tab);
  return tab;
}

function activateTab(filePath) {
  const fileState = state.openFiles.get(filePath);
  if (!fileState || !state.editor) return;

  if (state.currentModel !== fileState.model) {
    state.currentModel       = fileState.model;
    state.suppressModelChange = true;
    state.editor.setModel(fileState.model);
    state.suppressModelChange = false;
  }

  state.currentFilePath = filePath;
  updateCurrentFileLabel();
  updateAllTabs();
  updateStatusForCurrentFile();
  updateLangText();
}

function closeFileTab(filePath) {
  const fileState = state.openFiles.get(filePath);
  if (!fileState) return;

  if (fileState.dirty) {
    const save = confirm(`"${shortName(filePath)}" has unsaved changes. Save before closing?`);
    if (save) {
      saveFileState(fileState).then(() => closeTabNow(filePath));
      return;
    }
  }

  closeTabNow(filePath);
}

function closeTabNow(filePath) {
  const fileState = state.openFiles.get(filePath);
  if (!fileState) return;

  if (state.currentModel === fileState.model && state.editor) {
    state.editor.setModel(null);
    state.currentModel    = null;
    state.currentFilePath = null;
  }

  fileState.model.dispose();
  fileState.tabEl.remove();
  state.openFiles.delete(filePath);

  const remaining = [...state.openFiles.keys()];
  if (remaining.length) {
    activateTab(remaining[remaining.length - 1]);
  } else {
    els.currentFile.textContent = "No file open";
    els.cursorText.textContent  = "Ln 1, Col 1";
    updateLangText();
    setEditorEmpty();
  }

  updateAllTabs();
}

function setEditorEmpty() {
  if (!state.editor) return;
  const m = monaco.editor.createModel("", "plaintext");
  state.editor.setModel(m);
  state.currentModel = m;
}

function getCurrentOpenFile() {
  if (!state.currentFilePath) return null;
  return state.openFiles.get(state.currentFilePath) || null;
}

function updateAllTabs() {
  for (const fs of state.openFiles.values()) updateTabState(fs);
}

function updateTabState(fileState) {
  if (!fileState?.tabEl || !fileState?.labelEl) return;
  fileState.tabEl.classList.toggle("active", fileState.path === state.currentFilePath);
  fileState.labelEl.textContent =
    `${shortName(fileState.path)}${fileState.dirty ? " ●" : ""}`;
}

function updateCurrentFileLabel() {
  const fs = getCurrentOpenFile();
  els.currentFile.textContent = fs
    ? `${shortName(fs.path)}${fs.dirty ? " *" : ""}`
    : "No file open";
}

function updateStatusForCurrentFile() {
  const fs = getCurrentOpenFile();
  setStatus(fs
    ? (fs.dirty ? `Editing: ${shortName(fs.path)}` : `Viewing: ${shortName(fs.path)}`)
    : "Ready");
}

function detectLanguage(filePath) {
  const name = filePath.split("/").pop() || filePath;
  const ext  = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return SUPPORTED_EXTENSIONS[ext] || "plaintext";
}

// ============================================================
// SAVE
// ============================================================
async function saveCurrentFile(silent = false) {
  const fileState = getCurrentOpenFile();
  if (!fileState) {
    if (!silent) alert("No file is open.");
    return;
  }
  await saveFileState(fileState, silent);
  if (!silent) setStatus(`Saved: ${shortName(fileState.path)}`);
}

async function saveFileState(fileState, silent = false) {
  if (!fileState) return;

  if (!fileState.handle || typeof fileState.handle.createWritable !== "function") {
    if (!silent) {
      const grant = confirm(
        "This project was opened via drag-and-drop (read-only).\n\nClick OK to grant folder access and enable saving."
      );
      if (grant) await grantSaveAccess();
    }
    return;
  }

  try {
    const writable = await fileState.handle.createWritable();
    await writable.write(fileState.model.getValue());
    await writable.close();

    fileState.dirty = false;
    updateTabState(fileState);
    updateCurrentFileLabel();
    if (!silent) setStatus(`Saved: ${shortName(fileState.path)}`);
  } catch (err) {
    console.error("Save failed:", err);
    if (!silent) alert(`Save failed: ${err.message}`);
  }
}

async function saveAllFiles() {
  const saves = [];
  for (const fs of state.openFiles.values()) {
    if (fs.dirty) saves.push(saveFileState(fs));
  }
  if (!saves.length) { setStatus("Nothing to save."); return; }
  await Promise.all(saves);
  setStatus("All files saved.");
}

// ============================================================
// NEW FILE / FOLDER
// ============================================================
async function createNewFile() {
  if (state.fallbackMode) {
    alert("Grant folder access first to create files on disk.");
    await grantSaveAccess();
    return;
  }

  const dirHandle = await getTargetDirectoryHandle();
  if (!dirHandle) return;

  const relPath = prompt("New file name (or path relative to selected folder):", "untitled.js");
  if (!relPath) return;

  try {
    const { parentHandle, fileHandle, path } = await createPathInDirectory(dirHandle, relPath, false);
    const writable = await fileHandle.createWritable();
    await writable.write("");
    await writable.close();

    state.projectEntries.set(path, {
      handle: fileHandle, kind: "file",
      parentHandle, parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      path, name: path.split("/").pop(),
    });

    renderTree();
    setStatus(`Created: ${path}`);
    await openFile(path);
  } catch (err) {
    console.error(err);
    alert("Could not create file: " + err.message);
  }
}

async function createNewFolder() {
  if (state.fallbackMode) {
    alert("Grant folder access first to create folders on disk.");
    await grantSaveAccess();
    return;
  }

  const dirHandle = await getTargetDirectoryHandle();
  if (!dirHandle) return;

  const relPath = prompt("New folder name:", "new-folder");
  if (!relPath) return;

  try {
    const { dirHandle: created, path } = await createPathInDirectory(dirHandle, relPath, true);
    state.projectEntries.set(path, {
      handle: created, kind: "directory",
      parentHandle: null, parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      path, name: path.split("/").pop(),
    });
    renderTree();
    setStatus(`Created folder: ${path}`);
  } catch (err) {
    console.error(err);
    alert("Could not create folder: " + err.message);
  }
}

async function getTargetDirectoryHandle() {
  if (!state.projectHandle) { alert("Open a project folder first."); return null; }
  if (!state.selectedPath)   return state.projectHandle;

  const selected = state.projectEntries.get(state.selectedPath);
  if (!selected) return state.projectHandle;

  if (selected.kind === "directory") return selected.handle;
  return selected.parentHandle || state.projectHandle;
}

async function createPathInDirectory(baseDirHandle, relPath, asFolder) {
  const parts = relPath.split("/").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Invalid path.");

  let currentDir  = baseDirHandle;
  let currentPath = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const part  = parts[i];
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const next  = await currentDir.getDirectoryHandle(part, { create: true });
    if (!state.projectEntries.has(currentPath)) {
      state.projectEntries.set(currentPath, {
        handle: next, kind: "directory", parentHandle: currentDir,
        parentPath: currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "",
        path: currentPath, name: part,
      });
    }
    currentDir = next;
  }

  const finalName = parts[parts.length - 1];
  const finalPath = currentPath ? `${currentPath}/${finalName}` : finalName;

  if (asFolder) {
    const d = await currentDir.getDirectoryHandle(finalName, { create: true });
    return { dirHandle: d, path: finalPath };
  }

  const f = await currentDir.getFileHandle(finalName, { create: true });
  return { parentHandle: currentDir, fileHandle: f, path: finalPath };
}

// ============================================================
// RENAME / DELETE
// ============================================================
async function renameSelectedItem() {
  if (state.fallbackMode) {
    alert("Grant folder access to rename items."); return;
  }
  if (!state.selectedPath) { alert("Select a file or folder first."); return; }

  const entry  = state.projectEntries.get(state.selectedPath);
  if (!entry) return;

  const newName = prompt(`Rename "${entry.name}" to:`, entry.name);
  if (!newName || newName === entry.name) return;

  try {
    await renameEntry(entry, newName.trim());
    setStatus(`Renamed to: ${newName}`);
    await rebuildProjectIndex();
  } catch (err) {
    console.error(err);
    alert("Rename failed: " + err.message);
  }
}

async function renameEntry(entry, newName) {
  const parentHandle = entry.parentHandle || state.projectHandle;
  if (!parentHandle) throw new Error("No parent directory.");

  if (entry.kind === "file") {
    const file = await entry.handle.getFile();
    const text = await file.text();
    const newHandle = await parentHandle.getFileHandle(newName, { create: true });
    const writable  = await newHandle.createWritable();
    await writable.write(text);
    await writable.close();
    await parentHandle.removeEntry(entry.name);
    return;
  }

  const newDir = await parentHandle.getDirectoryHandle(newName, { create: true });
  await copyDirectory(entry.handle, newDir);
  await parentHandle.removeEntry(entry.name, { recursive: true });

  for (const path of [...state.openFiles.keys()]) {
    if (path === entry.path || path.startsWith(`${entry.path}/`)) {
      closeTabSilently(path);
    }
  }
}

async function copyDirectory(srcDir, destDir) {
  for await (const entry of srcDir.values()) {
    if (entry.kind === "file") {
      const srcFile = await entry.getFile();
      const text    = await srcFile.text();
      const dest    = await destDir.getFileHandle(entry.name, { create: true });
      const w       = await dest.createWritable();
      await w.write(text);
      await w.close();
    } else {
      const child = await destDir.getDirectoryHandle(entry.name, { create: true });
      await copyDirectory(entry, child);
    }
  }
}

async function deleteSelectedItem() {
  if (state.fallbackMode) {
    alert("Grant folder access to delete items."); return;
  }
  if (!state.selectedPath) { alert("Select a file or folder first."); return; }

  const entry = state.projectEntries.get(state.selectedPath);
  if (!entry) return;

  if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;

  try {
    const parentHandle = entry.parentHandle || state.projectHandle;
    if (!parentHandle) throw new Error("No parent.");
    await parentHandle.removeEntry(entry.name, { recursive: entry.kind === "directory" });

    for (const path of [...state.openFiles.keys()]) {
      if (path === entry.path || path.startsWith(`${entry.path}/`)) {
        closeTabSilently(path);
      }
    }

    await rebuildProjectIndex();
    setStatus(`Deleted: ${entry.name}`);
  } catch (err) {
    console.error(err);
    alert("Delete failed: " + err.message);
  }
}

function closeTabSilently(filePath) {
  const fs = state.openFiles.get(filePath);
  if (!fs) return;

  if (state.currentModel === fs.model && state.editor) {
    state.editor.setModel(null);
    state.currentModel    = null;
    state.currentFilePath = null;
  }

  fs.model.dispose();
  fs.tabEl?.remove();
  state.openFiles.delete(filePath);
}

async function rebuildProjectIndex() {
  if (!state.projectHandle) return;
  state.projectEntries.clear();
  await indexDirectory(state.projectHandle, "");
  renderTree();
  updateProjectMeta();
}

// ============================================================
// EXPORT
// ============================================================
async function exportProject() {
  if (!state.projectHandle) { alert("Open a project first."); return; }

  try {
    const JSZipLib = await loadJSZip();
    const zip      = new JSZipLib();

    if (state.fallbackMode) {
      await addFallbackEntriesToZip(zip);
    } else {
      await addDirectoryToZip(state.projectHandle, zip, "");
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${state.projectHandle.name || "project"}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Exported as ZIP.");
  } catch (err) {
    console.error(err);
    alert("Export failed: " + err.message);
  }
}

async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const s   = document.createElement("script");
    s.src     = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.JSZip;
}

async function addDirectoryToZip(dirHandle, zipFolder, pathPrefix) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      const file = await entry.getFile();
      zipFolder.file(pathPrefix + entry.name, await file.arrayBuffer());
    } else {
      const child = zipFolder.folder(entry.name);
      await addDirectoryToZip(entry, child, "");
    }
  }
}

async function addFallbackEntriesToZip(zip) {
  for (const entry of state.projectEntries.values()) {
    if (entry.kind === "file") {
      const data = await entry.file.arrayBuffer();
      zip.file(entry.path, data);
    }
  }
}

// ============================================================
// TOGGLE TREE
// ============================================================
function toggleTree() {
  state.treeVisible = !state.treeVisible;
  els.sidebar?.classList.toggle("hidden", !state.treeVisible);
  setStatus(state.treeVisible ? "Sidebar shown." : "Sidebar hidden.");
}

// ============================================================
// SEARCH FILTER
// ============================================================
function applySearchFilter() {
  const query = state.searchQuery;
  if (!query) {
    els.fileTree.querySelectorAll(".folder, .file")
      .forEach((n) => (n.style.display = ""));
    return;
  }

  for (const folder of els.fileTree.querySelectorAll(".folder")) {
    const title    = folder.querySelector(".folder-title");
    const children = folder.querySelector(".folder-children");
    const match    = title?.textContent.toLowerCase().includes(query) || false;

    let childMatch = false;
    for (const child of Array.from(children?.children || [])) {
      if (child.classList.contains("file")) {
        const fm = child.textContent.toLowerCase().includes(query);
        child.style.display = fm ? "" : "none";
        childMatch = childMatch || fm;
      } else if (child.classList.contains("folder")) {
        const v = filterFolderRecursively(child, query);
        child.style.display = v ? "" : "none";
        childMatch = childMatch || v;
      }
    }

    const visible = match || childMatch;
    folder.style.display = visible ? "" : "none";
    if (children) children.style.display = visible ? "" : "none";
  }

  for (const file of Array.from(els.fileTree.children).filter(
    (n) => n.classList?.contains("file")
  )) {
    file.style.display = file.textContent.toLowerCase().includes(query) ? "" : "none";
  }
}

function filterFolderRecursively(folderEl, query) {
  const title    = folderEl.querySelector(".folder-title");
  const children = folderEl.querySelector(".folder-children");
  const match    = title?.textContent.toLowerCase().includes(query) || false;

  let childMatch = false;
  if (children) {
    for (const child of Array.from(children.children)) {
      if (child.classList.contains("file")) {
        const fm = child.textContent.toLowerCase().includes(query);
        child.style.display = fm ? "" : "none";
        childMatch = childMatch || fm;
      } else if (child.classList.contains("folder")) {
        const v = filterFolderRecursively(child, query);
        child.style.display = v ? "" : "none";
        childMatch = childMatch || v;
      }
    }
  }

  const visible = match || childMatch;
  if (children) children.style.display = visible ? "" : "none";
  return visible;
}

// ============================================================
// PROJECT META / STATUS
// ============================================================
function updateProjectMeta() {
  if (!state.projectHandle) {
    els.projectName.textContent = "No project opened";
    els.projectPath.textContent = "Drop a folder or click Open";
    return;
  }
  els.projectName.textContent = state.projectHandle.name;
  els.projectPath.textContent = state.fallbackMode
    ? "⚠ Read-only (grant access to save)"
    : "✓ Full access — saving enabled";
}

function setStatus(msg) {
  els.statusText.textContent = msg;
}

function updateEncoding(text) {
  els.encodingText.textContent = text;
}

function shortName(path) {
  return path.split("/").pop() || path;
}

function hasUnsavedChanges() {
  for (const fs of state.openFiles.values()) {
    if (fs.dirty) return true;
  }
  return false;
}