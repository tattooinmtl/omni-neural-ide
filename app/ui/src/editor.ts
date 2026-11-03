import * as monaco from 'monaco-editor';
import { langFromPath } from './api';

// CDN workers — avoids Vite/?worker resolution issues
const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
self.MonacoEnvironment = {
  getWorkerUrl: function (_moduleId: string, label: string) {
    let path = `${MONACO_CDN}/vs/editor/editor.worker.js`;
    if (label === 'json') path = `${MONACO_CDN}/vs/language/json/json.worker.js`;
    else if (label === 'css' || label === 'scss' || label === 'less') path = `${MONACO_CDN}/vs/language/css/css.worker.js`;
    else if (label === 'html' || label === 'handlebars' || label === 'razor') path = `${MONACO_CDN}/vs/language/html/html.worker.js`;
    else if (label === 'typescript' || label === 'javascript') path = `${MONACO_CDN}/vs/language/typescript/ts.worker.js`;
    const blob = new Blob([`self.MonacoEnvironment={baseUrl:'${MONACO_CDN}/'};importScripts('${path}');`], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  },
};

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  dirty: boolean;
}

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let tabs: OpenTab[] = [];
let activePath: string | null = null;
let onChange: ((tabs: OpenTab[], active: string | null) => void) | null = null;
let cursorCb: ((line: number, col: number) => void) | null = null;

function themeForMode(mode: 'plain' | 'ultra') {
  // Match mockup token colours: keywords purple/pink, strings orange/yellow
  const base = mode === 'ultra' ? {
    bg: '#010a15', gutter: '#010a15', line: '#5f7388', sel: '#123048',
    fg: '#e6eef6', kw: '#e090e0', str: '#e6b35a', num: '#f0a070', comment: '#5c7a6a',
    type: '#7fdbca', fn: '#82aaff', ident: '#e6eef6',
  } : {
    bg: '#0f1620', gutter: '#0f1620', line: '#6a727a', sel: '#264f78',
    fg: '#d4d7db', kw: '#e06cbf', str: '#d9a06a', num: '#b5cea8', comment: '#6a9955',
    type: '#4ec9b0', fn: '#dcdcaa', ident: '#d4d7db',
  };
  monaco.editor.defineTheme('omni', {
    base: 'vs-dark',
    inherit: false,
    rules: [
      { token: '', foreground: base.fg.replace('#','') },
      { token: 'comment', foreground: base.comment.replace('#','') },
      { token: 'keyword', foreground: base.kw.replace('#','') },
      { token: 'keyword.flow', foreground: base.kw.replace('#','') },
      { token: 'string', foreground: base.str.replace('#','') },
      { token: 'string.escape', foreground: base.str.replace('#','') },
      { token: 'number', foreground: base.num.replace('#','') },
      { token: 'type', foreground: base.type.replace('#','') },
      { token: 'type.identifier', foreground: base.type.replace('#','') },
      { token: 'identifier', foreground: base.ident.replace('#','') },
      { token: 'delimiter', foreground: base.fg.replace('#','') },
      { token: 'delimiter.parenthesis', foreground: base.fg.replace('#','') },
      { token: 'delimiter.bracket', foreground: base.fg.replace('#','') },
      { token: 'delimiter.square', foreground: base.fg.replace('#','') },
      { token: 'operator', foreground: base.fg.replace('#','') },
    ],
    colors: {
      'editor.background': base.bg,
      'editor.foreground': base.fg,
      'editorLineNumber.foreground': base.line,
      'editorLineNumber.activeForeground': base.fg,
      'editor.selectionBackground': base.sel,
      'editorGutter.background': base.gutter,
      'editorCursor.foreground': mode === 'ultra' ? '#22d3ee' : '#ffffff',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorIndentGuide.background': '#ffffff18',
      'editorIndentGuide.activeBackground': '#ffffff30',
      'editorIndentGuide.background1': '#ffffff18',
      'editorIndentGuide.activeBackground1': '#ffffff30',
    },
  });
  monaco.editor.setTheme('omni');
}

export function initEditor(host: HTMLElement, mode: 'plain' | 'ultra') {
  themeForMode(mode);
  editor = monaco.editor.create(host, {
    value: '',
    language: 'plaintext',
    theme: 'omni',
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
    fontLigatures: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    tabSize: mode === 'ultra' ? 2 : 4,
    padding: { top: 6 },
    lineNumbersMinChars: 3,
    guides: { indentation: true, highlightActiveIndentation: true, bracketPairs: false },
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  });
  editor.onDidChangeModelContent(() => {
    if (!activePath || !editor) return;
    const t = tabs.find(x => x.path === activePath);
    if (!t) return;
    t.content = editor.getValue();
    t.dirty = true;
    onChange?.(tabs, activePath);
  });
  editor.onDidChangeCursorPosition(e => {
    cursorCb?.(e.position.lineNumber, e.position.column);
  });
}

export function setModeTheme(mode: 'plain' | 'ultra') {
  themeForMode(mode);
  editor?.updateOptions({ tabSize: mode === 'ultra' ? 2 : 4 });
}

export function setEditorCallbacks(opts: {
  onTabs?: (tabs: OpenTab[], active: string | null) => void;
  onCursor?: (line: number, col: number) => void;
}) {
  onChange = opts.onTabs || null;
  cursorCb = opts.onCursor || null;
}

export function openTab(path: string, content: string) {
  const name = path.split(/[/\\]/).pop() || path;
  const language = langFromPath(path);
  let t = tabs.find(x => x.path === path);
  if (!t) {
    t = { path, name, content, language, dirty: false };
    tabs.push(t);
  } else {
    t.content = content;
    t.dirty = false;
  }
  activate(path);
}

export function activate(path: string) {
  const t = tabs.find(x => x.path === path);
  if (!t || !editor) return;
  activePath = path;
  const model = monaco.editor.createModel(t.content, t.language);
  const old = editor.getModel();
  editor.setModel(model);
  old?.dispose();
  onChange?.(tabs, activePath);
}

export function closeTab(path: string) {
  const i = tabs.findIndex(x => x.path === path);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (activePath === path) {
    const next = tabs[i] || tabs[i - 1] || null;
    if (next) activate(next.path);
    else {
      activePath = null;
      editor?.setValue('');
      onChange?.(tabs, null);
    }
  } else onChange?.(tabs, activePath);
}

export function getActive(): OpenTab | null {
  return tabs.find(x => x.path === activePath) || null;
}

export function getTabs() { return tabs; }

export function getValue(): string {
  return editor?.getValue() || '';
}
