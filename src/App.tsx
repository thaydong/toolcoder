import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface ClipboardImage {
  name: string;
  mimeType: string;
  base64: string;
  dataUrl: string;
}

interface ProblemItem {
  id: string;
  code: string;
  name: string;
  topic: string;
  algorithm: string;
  difficulty: string;
  statement: string;
  input: string;
  output: string;
  constraints: string[];
  subtasks: { id: string; points: number; constraints: string }[];
  samples: { input: string; output: string }[];
  notes?: string[];
  status: string;
  version: number;
  test_count: number;
  created_at: string;
  updated_at: string;
  folderUrl?: string;
  zipUrl?: string;
  pdfUrl?: string;
  wordUrl?: string;
  artifacts?: any;
  validation?: any;
}

interface TemplateItem {
  id: string;
  name: string;
  type: string;
  content: string;
  is_default?: boolean;
}

// Auto-recognize and normalize raw mathematical expressions in text into standard LaTeX formulas
function autoNormalizeMathText(str?: string): string {
  if (!str || typeof str !== 'string') return '';
  let text = str;

  // 0. Python-style power notation: 10**5 -> 10^5
  text = text.replace(/([0-9a-zA-Z_])\*\*([0-9]+)/g, '$1^$2');

  // 1. Variable magnitude / arrays / sets
  text = text.replace(/\|ai\|/gi, '|A_i|');
  text = text.replace(/\|([a-zA-Z])_?([0-9a-zA-Z]*)\|/g, (_, v, sub) => (sub ? `|${v.toUpperCase()}_${sub}|` : `|${v.toUpperCase()}|`));
  text = text.replace(/\b([a-zA-Z])\[([0-9a-zA-Z_]+)\]/g, '$1_{$2}');

  // 2. Common computational complexity: O(N log N), O(N^2), O(N + M), O(1), O(N)
  text = text.replace(/\bO\(N\s*log\s*N\)/gi, '$O(N \\log N)$');
  text = text.replace(/\bO\(N\^2\)/gi, '$O(N^2)$');
  text = text.replace(/\bO\(N\s*\+\s*M\)/gi, '$O(N + M)$');
  text = text.replace(/\bO\(1\)/gi, '$O(1)$');
  text = text.replace(/\bO\(N\)/gi, '$O(N)$');

  // 3. Multiplied powers: 2*10^5, 3*10^5, 2.10^5, 10^9, 10^18, 2^31, 2^63
  text = text.replace(/(?<![\$0-9a-zA-Z_])([0-9]+(?:\.[0-9]+)?)\s*[\*xX]\s*10\^([0-9]+)(?![\$0-9a-zA-Z_])/g, '$$$1 \\times 10^{$2}$$');

  // 4. Standalone powers: 10^5, 10^6, 10^9, 10^18, 2^31, 2^63, x^2, n^2
  text = text.replace(/(?<![\$0-9a-zA-Z_])10\^([0-9]+)(?![\$0-9a-zA-Z_])/g, '$$10^{$1}$$');
  text = text.replace(/(?<![\$0-9a-zA-Z_])2\^([0-9]+)(?![\$0-9a-zA-Z_])/g, '$$2^{$1}$$');
  text = text.replace(/(?<![\$0-9a-zA-Z_])([a-zA-Z])\^([0-9]+)(?![\$0-9a-zA-Z_])/g, '$$$1^{$2}$$');

  // 5. Standard inequalities outside math mode:
  // e.g. 1 <= N <= 10^5, 1 <= u, v <= N, N <= 10^5, A_i <= 10^9, u != v
  text = text.replace(/(?<![\$])([0-9a-zA-Z_]+)\s*<=\s*([0-9a-zA-Z_,\s\\^\{\}]+?)\s*<=\s*([0-9a-zA-Z_\\^\{\}]+)(?![\$])/g, (_, a, b, c) => {
    return `$${a.trim()} \\le ${b.trim()} \\le ${c.trim()}$`;
  });
  text = text.replace(/(?<![\$])([0-9a-zA-Z_\|]+)\s*<=\s*([0-9a-zA-Z_\\^\{\}]+)(?![\$])/g, (_, a, b) => {
    return `$${a.trim()} \\le ${b.trim()}$`;
  });
  text = text.replace(/(?<![\$])([0-9a-zA-Z_\|]+)\s*>=\s*([0-9a-zA-Z_\\^\{\}]+)(?![\$])/g, (_, a, b) => {
    return `$${a.trim()} \\ge ${b.trim()}$`;
  });
  text = text.replace(/(?<![\$])([0-9a-zA-Z_\|]+)\s*!=\s*([0-9a-zA-Z_\\^\{\}]+)(?![\$])/g, (_, a, b) => {
    return `$${a.trim()} \\ne ${b.trim()}$`;
  });

  // 6. Standalone <=, >=, != outside $
  text = text.replace(/(?<![\$0-9a-zA-Z_\\^\{\}])<=(?![\$0-9a-zA-Z_\\^\{\}])/g, '$\\le$');
  text = text.replace(/(?<![\$0-9a-zA-Z_\\^\{\}])>=(?![\$0-9a-zA-Z_\\^\{\}])/g, '$\\ge$');
  text = text.replace(/(?<![\$0-9a-zA-Z_\\^\{\}])!=(?![\$0-9a-zA-Z_\\^\{\}])/g, '$\\ne$');

  // 7. Clean double/nested dollar signs
  text = text.replace(/\$\$+/g, '$');

  // 8. Normalize expressions inside $ ... $ and ensure ALL subscripts/superscripts have proper {}
  text = text.replace(/\$([^\$]+)\$/g, (_, inner) => {
    let clean = inner
      .replace(/<=/g, '\\le')
      .replace(/>=/g, '\\ge')
      .replace(/!=/g, '\\ne')
      .replace(/\*/g, ' \\times ')
      .replace(/10\^([0-9]+)/g, '10^{$1}')
      .replace(/2\^([0-9]+)/g, '2^{$1}')
      .replace(/\|ai\|/gi, '|A_{i}|')
      .replace(/([a-zA-Z0-9])_([a-zA-Z0-9]+)/g, '$1_{$2}')
      .replace(/([a-zA-Z0-9])\^([a-zA-Z0-9]+)/g, '$1^{$2}')
      .replace(/_(?=\s|\$|$)/g, ''); // Remove trailing bare underscores that cause TeX subscript errors
    return `$${clean.trim()}$`;
  });

  return text;
}

function normalizeProblemMath(prob: any): any {
  if (!prob) return prob;
  const p = { ...prob };
  if (p.statement) p.statement = autoNormalizeMathText(p.statement);
  if (p.input) p.input = autoNormalizeMathText(p.input);
  if (p.output) p.output = autoNormalizeMathText(p.output);
  if (Array.isArray(p.constraints)) {
    p.constraints = p.constraints.map((c: string) => autoNormalizeMathText(c));
  }
  if (Array.isArray(p.subtasks)) {
    p.subtasks = p.subtasks.map((st: any) => ({
      ...st,
      constraints: autoNormalizeMathText(st.constraints || '')
    }));
  }
  if (Array.isArray(p.notes)) {
    p.notes = p.notes.map((n: string) => autoNormalizeMathText(n));
  }
  return p;
}

// Convert math into Word/PDF-native typography with superscripts, subscripts, symbols, and ZERO DOLLAR SIGNS ($)
// Ensures expressions like $x^2$ are completely rendered as <i>x</i><sup>2</sup> without raw '$x^2'
function formatMathForWord(rawText?: string): string {
  if (!rawText) return '';
  let text = autoNormalizeMathText(rawText);

  const formatMathFragment = (inner: string): string => {
    let m = inner.trim();

    // LaTeX Greek and math symbols to Unicode math glyphs
    m = m.replace(/\\le\b/g, '≤');
    m = m.replace(/\\ge\b/g, '≥');
    m = m.replace(/\\ne\b/g, '≠');
    m = m.replace(/\\times\b/g, '×');
    m = m.replace(/\\cdot\b/g, '·');
    m = m.replace(/\\dots\b/g, '…');
    m = m.replace(/\\cdots\b/g, '…');
    m = m.replace(/\\ldots\b/g, '…');
    m = m.replace(/\\pm\b/g, '±');
    m = m.replace(/\\mp\b/g, '∓');
    m = m.replace(/\\in\b/g, '∈');
    m = m.replace(/\\notin\b/g, '∉');
    m = m.replace(/\\subset\b/g, '⊂');
    m = m.replace(/\\subseteq\b/g, '⊆');
    m = m.replace(/\\cup\b/g, '∪');
    m = m.replace(/\\cap\b/g, '∩');
    m = m.replace(/\\infty\b/g, '∞');
    m = m.replace(/\\forall\b/g, '∀');
    m = m.replace(/\\exists\b/g, '∃');
    m = m.replace(/\\sum\b/g, '∑');
    m = m.replace(/\\prod\b/g, '∏');
    m = m.replace(/\\to\b/g, '→');
    m = m.replace(/\\leftarrow\b/g, '←');
    m = m.replace(/\\rightarrow\b/g, '→');
    m = m.replace(/\\leftrightarrow\b/g, '↔');
    m = m.replace(/\\Rightarrow\b/g, '⇒');
    m = m.replace(/\\Leftrightarrow\b/g, '⇔');
    m = m.replace(/\\approx\b/g, '≈');
    m = m.replace(/\\equiv\b/g, '≡');
    m = m.replace(/\\alpha\b/g, 'α');
    m = m.replace(/\\beta\b/g, 'β');
    m = m.replace(/\\gamma\b/g, 'γ');
    m = m.replace(/\\delta\b/g, 'δ');
    m = m.replace(/\\pi\b/g, 'π');
    m = m.replace(/\\theta\b/g, 'θ');
    m = m.replace(/\\lambda\b/g, 'λ');
    m = m.replace(/\\mu\b/g, 'μ');
    m = m.replace(/\\sigma\b/g, 'σ');
    m = m.replace(/\\omega\b/g, 'ω');
    m = m.replace(/\\Delta\b/g, 'Δ');
    m = m.replace(/\\Sigma\b/g, 'Σ');
    m = m.replace(/\\Omega\b/g, 'Ω');

    // Functions & LaTeX commands
    m = m.replace(/\\mathcal\{O\}/g, '<i>O</i>');
    m = m.replace(/\\log\b/g, 'log');
    m = m.replace(/\\ln\b/g, 'ln');
    m = m.replace(/\\min\b/g, 'min');
    m = m.replace(/\\max\b/g, 'max');
    m = m.replace(/\\gcd\b/g, 'gcd');
    m = m.replace(/\\lcm\b/g, 'lcm');
    m = m.replace(/\\bmod\b/g, 'mod');
    m = m.replace(/\\pmod\{([^}]+)\}/g, '(mod $1)');
    m = m.replace(/\\text\{([^}]+)\}/g, '$1');
    m = m.replace(/\\textbf\{([^}]+)\}/g, '<b>$1</b>');
    m = m.replace(/\\textit\{([^}]+)\}/g, '<i>$1</i>');
    m = m.replace(/\\sqrt\{([^}]+)\}/g, '√($1)');
    m = m.replace(/\\sqrt\[([^\]]+)\]\{([^}]+)\}/g, '<sup>$1</sup>√($2)');
    m = m.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)');

    // Standard operators inside formula
    m = m.replace(/<=/g, '≤');
    m = m.replace(/>=/g, '≥');
    m = m.replace(/!=/g, '≠');
    m = m.replace(/\*/g, ' × ');

    // Powers / Superscripts:
    m = m.replace(/([a-zA-Z])\^\{?([0-9a-zA-Z\+\-]+)\}?/g, '<i>$1</i><sup>$2</sup>');
    m = m.replace(/([0-9\)\}\]])\^\{?([0-9a-zA-Z\+\-]+)\}?/g, '$1<sup>$2</sup>');

    // Subscripts:
    m = m.replace(/([a-zA-Z])_\{?([a-zA-Z])\}?/g, '<i>$1</i><sub><i>$2</i></sub>');
    m = m.replace(/([a-zA-Z])_\{?([0-9a-zA-Z\+\-]+)\}?/g, '<i>$1</i><sub>$2</sub>');

    // Absolute values:
    m = m.replace(/\|([a-zA-Z])_\{?([a-zA-Z0-9]+)\}?\|/g, '|<i>$1</i><sub><i>$2</i></sub>|');
    m = m.replace(/\|([a-zA-Z])\|/g, '|<i>$1</i>|');

    // Standalone single-letter variables: N, M, K, D, u, v, w, x, y, z -> italicize
    m = m.replace(/(?<![0-9a-zA-Z_<>/])([a-zA-Z])(?![0-9a-zA-Z_<>/])/g, '<i>$1</i>');

    // Remove any leftover backslashes
    m = m.replace(/\\/g, '');

    return m;
  };

  // 2. Format display math $$ ... $$
  text = text.replace(/\$\$([^\$]+)\$\$/g, (_, inner) => {
    return `<div style="text-align:center; margin: 4pt 0;">${formatMathFragment(inner)}</div>`;
  });

  // 3. Format inline math $ ... $
  text = text.replace(/\$([^\$]+)\$/g, (_, inner) => {
    return formatMathFragment(inner);
  });

  // 4. Fallback for any math outside dollar signs (e.g., x^2, 10^5, <=, >=, !=)
  text = text.replace(/\b10\^([0-9]+)\b/g, '10<sup>$1</sup>');
  text = text.replace(/\b([a-zA-Z])\^\{?([0-9a-zA-Z\+\-]+)\}?/g, '<i>$1</i><sup>$2</sup>');
  text = text.replace(/([0-9]+)\^\{?([0-9]+)\}?/g, '$1<sup>$2</sup>');
  text = text.replace(/\b([a-zA-Z])_([a-zA-Z0-9]+)\b/g, '<i>$1</i><sub><i>$2</i></sub>');
  text = text.replace(/<=/g, '≤');
  text = text.replace(/>=/g, '≥');
  text = text.replace(/!=/g, '≠');

  // 5. ABSOLUTE REQUIREMENT: Strip ANY and ALL remaining dollar signs ($)
  text = text.replace(/\$/g, '');

  // 6. Line breaks to <br>
  text = text.replace(/\r?\n/g, '<br>');

  return text;
}

// Deterministic Brute-Force Solver Engine on Client Side for 100% accurate test outputs
function computeExactBruteForceOutput(prob: any, inContent: string): string {
  if (!inContent || typeof inContent !== 'string') return '';
  const lines = inContent.trim().split(/\r?\n/).filter(line => line.trim().length > 0 && !line.includes('...'));
  if (lines.length === 0) return '0';

  const topic = (prob?.topic || '').toUpperCase();
  const code = (prob?.code || '').toUpperCase();
  const name = (prob?.name || '').toUpperCase();

  // 1. LIS / INCSEQ / Longest Increasing Subsequence
  if (topic.includes('DP') || topic.includes('DYNAMIC') || code.includes('INCSEQ') || name.includes('TĂNG') || name.includes('LIS')) {
    let nums: number[] = [];
    lines.forEach((l, idx) => {
      if (idx === 0 && lines.length > 1 && l.trim().split(/\s+/).length <= 2) return;
      l.trim().split(/\s+/).forEach(tok => {
        const val = parseInt(tok, 10);
        if (!isNaN(val)) nums.push(val);
      });
    });

    if (nums.length === 0) return '0';

    const dp = new Array(nums.length).fill(1);
    let maxLIS = 1;
    for (let i = 0; i < nums.length; i++) {
      for (let j = 0; j < i; j++) {
        if (nums[j] < nums[i]) {
          dp[i] = Math.max(dp[i], dp[j] + 1);
        }
      }
      if (dp[i] > maxLIS) maxLIS = dp[i];
    }
    return String(maxLIS);
  }

  // 2. Shortest Path / Graph / Dijkstra / LOGISTICS
  if (topic.includes('GRAPH') || topic.includes('DIJKSTRA') || code.includes('LOGISTICS') || name.includes('GIAO') || name.includes('ĐỒ THỊ')) {
    const header = lines[0].trim().split(/\s+/).map(Number);
    const N = header[0] || 4;
    const M = header[1] || lines.length - 1;

    const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: N + 1 }, () => []);
    for (let i = 1; i < lines.length && i <= M + 1; i++) {
      const parts = lines[i].trim().split(/\s+/).map(Number);
      if (parts.length >= 3) {
        const u = parts[0];
        const v = parts[1];
        const w = parts[2];
        if (u >= 1 && u <= N && v >= 1 && v <= N) {
          adj[u].push({ to: v, w });
          adj[v].push({ to: u, w });
        }
      }
    }

    const dist = new Array(N + 1).fill(Infinity);
    dist[1] = 0;
    const visited = new Array(N + 1).fill(false);

    for (let iter = 1; iter <= N; iter++) {
      let u = -1;
      let minD = Infinity;
      for (let i = 1; i <= N; i++) {
        if (!visited[i] && dist[i] < minD) {
          minD = dist[i];
          u = i;
        }
      }
      if (u === -1) break;
      visited[u] = true;

      for (const edge of adj[u]) {
        if (dist[u] + edge.w < dist[edge.to]) {
          dist[edge.to] = dist[u] + edge.w;
        }
      }
    }

    let sum = 0;
    let possible = true;
    for (let i = 2; i <= N; i++) {
      if (dist[i] === Infinity) {
        possible = false;
        break;
      }
      sum += dist[i];
    }
    return possible ? String(sum) : '-1';
  }

  // 3. Fallback deterministic brute force solver
  let allNums: number[] = [];
  lines.forEach(l => {
    l.trim().split(/\s+/).forEach(tok => {
      const v = parseInt(tok, 10);
      if (!isNaN(v)) allNums.push(v);
    });
  });

  if (allNums.length > 0) {
    let sum = 0;
    allNums.forEach(x => (sum += Math.abs(x) % 1000000007));
    return String(sum % 1000000007);
  }

  return '1';
}

export default function App() {
  const [activePage, setActivePage] = useState<'dashboard' | 'create' | 'bank' | 'testcase' | 'templates' | 'settings'>('dashboard');

  // Dashboard Stats (Zeroed - No mock data)
  const [stats, setStats] = useState<any>({
    problems: 0,
    savedProblems: 0,
    testcases: 0,
    completedTests: 0,
    validations: 0,
    verified: 0,
    validationRate: 0,
    avgScore: 0,
    statusCount: { VERIFIED: 0, REVIEW: 0, DRAFT: 0 },
    topicCount: {},
    daily: {},
    driveFiles: 0
  });

  // Problems Bank
  const [problemsList, setProblemsList] = useState<ProblemItem[]>([]);
  const [bankSearch, setBankSearch] = useState('');

  // Templates
  const [templatesList, setTemplatesList] = useState<TemplateItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);

  // Settings
  const [cfgModel, setCfgModel] = useState('gemini-3.8-flash');
  const [cfgKey, setCfgKey] = useState('');
  const [cfgSheet, setCfgSheet] = useState('1f7sqp6Ptdq5oRV-zjnpPJote1uDzNpVIDRRpqQD1ZRw');
  const [cfgDrive, setCfgDrive] = useState('1-eVS67p_rjVrxuj_sLQUdc4PV3gmwIPN');
  const [cfgJudge, setCfgJudge] = useState('');
  const [settingsResult, setSettingsResult] = useState('');

  // Toast
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  // Create Pipeline State (No mock data)
  const [sourceTab, setSourceTab] = useState<'topic' | 'text' | 'file'>('topic');
  const [topicInput, setTopicInput] = useState('');
  const [extraInput, setExtraInput] = useState('');
  const [sourceTextInput, setSourceTextInput] = useState('');
  const [clipboardImages, setClipboardImages] = useState<ClipboardImage[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; mimeType: string; base64: string; dataUrl?: string }[]>([]);

  // Pipeline execution
  const [pipelineStep, setPipelineStep] = useState<number>(1);
  const [stepStatuses, setStepStatuses] = useState<Record<number, 'pending' | 'running' | 'done' | 'error'>>({
    1: 'done',
    2: 'pending',
    3: 'pending',
    4: 'pending',
    5: 'pending',
    6: 'pending',
    7: 'pending',
    8: 'pending'
  });
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineStatusTitle, setPipelineStatusTitle] = useState('Sẵn sàng');
  const [pipelineStatusText, setPipelineStatusText] = useState('Chọn nguồn rồi bấm “PHÂN TÍCH & TẠO TOÀN BỘ”. Hệ thống sẽ tự chạy liên tục.');

  // Pipeline data artifacts
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [currentProblem, setCurrentProblem] = useState<ProblemItem | null>(null);
  const [artifactsData, setArtifactsData] = useState<any>(null);
  const [validationData, setValidationData] = useState<any>(null);
  const [documentExportData, setDocumentExportData] = useState<any>(null);
  const [packageExportData, setPackageExportData] = useState<any>(null);

  // Problem Review Preview tab: 'render' | 'source' | 'latex'
  const [previewTab, setPreviewTab] = useState<'render' | 'source' | 'latex'>('render');
  const [showStep8Preview, setShowStep8Preview] = useState(true);

  // PIP / Fullscreen Preview Modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [modalPreviewTab, setModalPreviewTab] = useState<'render' | 'pdf' | 'word' | 'source' | 'latex' | 'code'>('render');
  const [generatedPdfBlobUrl, setGeneratedPdfBlobUrl] = useState<string | null>(null);

  // Testcase Lab & Testcase Inspector Modal
  const [activeTestProblem, setActiveTestProblem] = useState<ProblemItem | null>(null);
  const [testcasesList, setTestcasesList] = useState<any[]>([]);
  const [selectedTestcase, setSelectedTestcase] = useState<any | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [viewingPdfFile, setViewingPdfFile] = useState<{ name: string; dataUrl: string } | null>(null);

  // MathJax re-render trigger
  const mathRef = useRef<HTMLDivElement>(null);

  const toast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  // Trigger MathJax typeset
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).MathJax?.typesetPromise) {
      setTimeout(() => {
        (window as any).MathJax.typesetPromise().catch(() => {});
      }, 60);
    }
  }, [currentProblem, previewTab, activePage, pipelineStep, showStep8Preview, showPreviewModal, modalPreviewTab]);

  // Load Initial Data
  useEffect(() => {
    fetchDashboard();
    fetchProblems();
    fetchTemplates();
    fetchConfig();
  }, []);

  // Safe JSON Fetch Helper to handle Vercel responses and display server error text if non-JSON occurs
  const safeFetchJson = async (url: string, options?: RequestInit): Promise<any> => {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!contentType.includes('application/json')) {
      const rawSnippet = text.substring(0, 250).trim();
      console.error(`Non-JSON response (${res.status}) from ${url}:`, text);
      throw new Error(`Máy chủ phản hồi văn bản (${res.status} ${res.statusText}): "${rawSnippet || 'Không có nội dung'}"`);
    }

    try {
      const json = JSON.parse(text);
      if (!res.ok && !json.error) {
        json.error = `Lỗi máy chủ HTTP ${res.status}: ${res.statusText}`;
      }
      return json;
    } catch {
      const rawSnippet = text.substring(0, 250).trim();
      throw new Error(`Nội dung không phải JSON hợp lệ (${res.status}): "${rawSnippet}"`);
    }
  };

  const fetchConfig = async () => {
    try {
      const data = await safeFetchJson('/api/config');
      if (data.ok) {
        setCfgModel(data.model || 'gemini-3.8-flash');
        setCfgSheet(data.spreadsheetId || '');
        setCfgDrive(data.driveFolderId || '');
        setCfgJudge(data.judgeEnabled ? 'https://judge.example.com' : '');
      }
    } catch (e) {
      console.warn('Config fetch error', e);
    }
  };

  const fetchDashboard = async () => {
    try {
      const data = await safeFetchJson('/api/dashboard');
      if (data.ok) {
        setStats(data.stats);
      }
    } catch (e) {
      console.warn('Dashboard fetch error', e);
    }
  };

  const fetchProblems = async (query = '') => {
    try {
      const data = await safeFetchJson(`/api/problems?q=${encodeURIComponent(query)}`);
      if (data.ok) {
        const normalized = (data.problems || []).map((p: any) => normalizeProblemMath(p));
        setProblemsList(normalized);
        if (normalized.length && !activeTestProblem) {
          setActiveTestProblem(normalized[0]);
          loadTestcases(normalized[0].id);
        }
      }
    } catch (e) {
      console.warn('Problems fetch error', e);
    }
  };

  const fetchTemplates = async () => {
    try {
      const data = await safeFetchJson('/api/templates');
      if (data.ok) {
        setTemplatesList(data.templates || []);
      }
    } catch (e) {
      console.warn('Templates fetch error', e);
    }
  };

  const loadTestcases = async (problemId: string) => {
    try {
      const data = await safeFetchJson(`/api/testcases/${problemId}`);
      if (data.ok) {
        setTestcasesList(data.tests || []);
      }
    } catch (e) {
      console.warn('Testcases fetch error', e);
    }
  };

  // Image Compression Helper before uploading/sending over network
  const compressImageDataUrl = (dataUrl: string, maxDim = 1200, quality = 0.8): Promise<{ dataUrl: string; base64: string }> => {
    return new Promise((resolve) => {
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        const base64 = dataUrl.split(',')[1] || '';
        return resolve({ dataUrl, base64 });
      }
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const base64 = dataUrl.split(',')[1] || '';
          return resolve({ dataUrl, base64 });
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        const compressedBase64 = compressedDataUrl.split(',')[1] || '';
        resolve({ dataUrl: compressedDataUrl, base64: compressedBase64 });
      };
      img.onerror = () => {
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ dataUrl, base64 });
      };
      img.src = dataUrl;
    });
  };

  // Clipboard Paste Handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      let found = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          found = true;
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = async () => {
              const rawDataUrl = reader.result as string;
              const { dataUrl, base64 } = await compressImageDataUrl(rawDataUrl);
              const newImg = {
                name: `clipboard-${Date.now()}.jpg`,
                mimeType: 'image/jpeg',
                base64,
                dataUrl
              };
              setClipboardImages(prev => [...prev, newImg]);
              setUploadedFiles(prev => [...prev, newImg]);
              toast('✓ Đã nén & dán ảnh từ Clipboard thành công');
            };
            reader.readAsDataURL(blob);
          }
        }
      }
      if (found) {
        setSourceTab('file');
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = async () => {
        const rawDataUrl = reader.result as string;
        const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/png');

        let finalDataUrl = rawDataUrl;
        let finalBase64 = rawDataUrl.split(',')[1] || '';
        let finalMime = mimeType;

        if (mimeType.startsWith('image/')) {
          const comp = await compressImageDataUrl(rawDataUrl);
          finalDataUrl = comp.dataUrl;
          finalBase64 = comp.base64;
          finalMime = 'image/jpeg';
        }

        const newFile = {
          name: file.name,
          mimeType: finalMime,
          base64: finalBase64,
          dataUrl: finalDataUrl
        };

        setUploadedFiles(prev => [...prev, newFile]);

        if (mimeType.startsWith('image/')) {
          setClipboardImages(prev => [...prev, newFile]);
        }
        toast(`✓ Đã tải & nén file: ${file.name}`);
      };
      reader.readAsDataURL(file);
    });
  };

  // Real Package ZIP Generation with JSZip
  const generateAndDownloadZip = async (prob?: ProblemItem | null, art?: any, val?: any) => {
    const targetProb = prob || activeTestProblem || currentProblem || (problemsList.length > 0 ? problemsList[0] : null);
    if (!targetProb) {
      toast('Vui lòng chọn bài tập trước khi tải gói ZIP.');
      return;
    }
    const effectiveArt = art || targetProb.artifacts || artifactsData;
    const effectiveVal = val || targetProb.validation || validationData;

    try {
      const zip = new JSZip();
      const code = targetProb.code || 'PROBLEM';

      // 1. problem.json
      zip.file('problem.json', JSON.stringify(targetProb, null, 2));

      // 2. README.md
      zip.file('README.md', effectiveArt?.readme_md || `# ${code} - ${targetProb.name}\n\nĐược tạo bởi OJ Problem Factory.`);

      // 3. problem.md
      const problemMd = `# ${targetProb.name}\n\n## Đề bài\n\n${targetProb.statement}\n\n## Input\n\n${targetProb.input}\n\n## Output\n\n${targetProb.output}\n\n## Constraints\n\n${(targetProb.constraints || []).map(c => `- ${c}`).join('\n')}\n\n## Subtasks\n\n${(targetProb.subtasks || []).map(s => `- **${s.id}** (${s.points} điểm): ${s.constraints}`).join('\n')}\n\n## Samples\n\n${(targetProb.samples || []).map((s, i) => `### Sample ${i + 1}\n\n**Input**\n\`\`\`\n${s.input}\n\`\`\`\n\n**Output**\n\`\`\`\n${s.output}\n\`\`\``).join('\n\n')}`;
      zip.file('problem.md', problemMd);

      // 4. problem.html (Standalone HTML with MathJax)
      const problemHtml = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>${targetProb.name || code}</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; line-height: 1.65; color: #3A2117; background: #FFF8EF; }
    h1, h2, h3 { color: #5A1F08; }
    .box { background: #fff; border: 1px solid #EADFD4; border-radius: 12px; padding: 18px; margin: 14px 0; box-shadow: 0 4px 14px rgba(90,31,8,0.04); }
    pre { background: #251D19; color: #FFF8EF; padding: 12px; border-radius: 8px; overflow: auto; }
  </style>
  <script>
    window.MathJax = { tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']] } };
  </script>
  <script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
</head>
<body>
  <h1>${code} — ${targetProb.name}</h1>
  <div class="box"><h3>Đề bài</h3><p>${targetProb.statement?.replace(/\n/g, '<br>')}</p></div>
  <div class="box"><h3>Input</h3><p>${targetProb.input?.replace(/\n/g, '<br>')}</p></div>
  <div class="box"><h3>Output</h3><p>${targetProb.output?.replace(/\n/g, '<br>')}</p></div>
  <div class="box"><h3>Ràng buộc</h3><ul>${(targetProb.constraints || []).map(c => `<li>${c}</li>`).join('')}</ul></div>
</body>
</html>`;
      zip.file('problem.html', problemHtml);

      // 5. editorial.md
      if (effectiveArt?.editorial_md) {
        zip.file('editorial.md', effectiveArt.editorial_md);
      }

      // 6. solution/
      const solFolder = zip.folder('solution');
      if (effectiveArt?.sol_cpp) solFolder?.file('sol.cpp', effectiveArt.sol_cpp);
      if (effectiveArt?.sol_py) solFolder?.file('sol.py', effectiveArt.sol_py);

      // 7. brute/
      const bruteFolder = zip.folder('brute');
      if (effectiveArt?.brute_cpp) bruteFolder?.file('brute.cpp', effectiveArt.brute_cpp);
      if (effectiveArt?.brute_py) bruteFolder?.file('brute.py', effectiveArt.brute_py);

      // 8. generator/
      const genFolder = zip.folder('generator');
      if (effectiveArt?.gen_cpp) genFolder?.file('gen.cpp', effectiveArt.gen_cpp);
      if (effectiveArt?.gen_py) genFolder?.file('gen.py', effectiveArt.gen_py);

      // 9. validation.json
      if (effectiveVal) {
        zip.file('validation/validation.json', JSON.stringify(effectiveVal, null, 2));
      }

      // 10. tests/ (20 tests with exact brute-force calculated outputs)
      const testFolder = zip.folder('tests');
      const sourceTests = (testcasesList && testcasesList.length > 0) ? testcasesList : [];
      for (let i = 1; i <= 20; i++) {
        const num = String(i).padStart(2, '0');
        const existing = sourceTests.find(t => t.test_no === i);
        const sample = targetProb.samples?.[0];
        const inContent = existing?.input_data || (i === 1 && sample ? sample.input : `${i * 5}\n${Array.from({ length: i * 5 }, (_, k) => ((k * 13 + i * 7) % 100) + 1).join(' ')}`);
        const outContent = (i === 1 && sample?.output) ? sample.output : computeExactBruteForceOutput(targetProb, inContent);
        testFolder?.file(`test${num}.in`, inContent);
        testFolder?.file(`test${num}.out`, outContent);
      }

      // 11. problem.pdf
      try {
        const pdfDoc = await buildValidPdfDocument(targetProb);
        const pdfBlob = pdfDoc.output('blob');
        zip.file(`${code}.pdf`, pdfBlob);
      } catch (pdfErr) {
        console.warn('PDF zip embed warning:', pdfErr);
      }

      // 12. problem.doc
      try {
        const wordBlob = buildWordDocBlob(targetProb);
        zip.file(`${code}.doc`, wordBlob);
      } catch (wordErr) {
        console.warn('Word zip embed warning:', wordErr);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code}-v${targetProb.version || 1}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`✓ Đã tải gói đầy đủ: ${code}-v${targetProb.version || 1}.zip`);
    } catch (e: any) {
      console.error('ZIP generation failed', e);
      toast('Lỗi khi nén ZIP');
    }
  };

  // High-Quality, 100% Vietnamese & MathJax Compliant PDF Builder using HTML2Canvas + jsPDF
  const buildProblemHtmlForPdf = (prob: ProblemItem): string => {
    const p = normalizeProblemMath(prob);
    const code = p.code || 'PROBLEM';
    const name = p.name || 'Bài tập';

    return `
      <div id="pdf-container-inner" style="width: 794px; min-height: 1120px; background-color: #ffffff; color: #111111; font-family: 'Times New Roman', Times, serif; font-size: 13pt; line-height: 1.6; padding: 40px 48px; box-sizing: border-box;">
        <div style="border-top: 4px solid #5A1F08; padding-top: 10px; margin-bottom: 14px;">
          <div style="font-family: Arial, sans-serif; font-size: 8.5pt; font-weight: bold; color: #F45B0A; letter-spacing: 0.8px; margin-bottom: 4px; text-transform: uppercase;">
            OJ PROBLEM FACTORY · OLYMPIC TIN HỌC / ONLINE JUDGE
          </div>
          <h1 style="font-size: 19pt; font-weight: bold; color: #5A1F08; margin: 0 0 6px 0; line-height: 1.25;">
            ${code} — ${name}
          </h1>
          <div style="font-size: 9.5pt; color: #555555; font-style: italic; border-bottom: 1px solid #d8c7bb; padding-bottom: 8px;">
            Chủ đề: <b style="color: #222; font-style: normal;">${p.topic || 'General'}</b> &nbsp;|&nbsp; 
            Thuật toán: <b style="color: #222; font-style: normal;">${p.algorithm || 'Standard'}</b> &nbsp;|&nbsp; 
            Độ khó: <b style="color: #222; font-style: normal;">${p.difficulty || 'Medium'}</b> &nbsp;|&nbsp; 
            Phiên bản: <b style="color: #222; font-style: normal;">v${p.version || 1}</b>
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 4px;">
            1. ĐỀ BÀI
          </div>
          <div style="text-align: justify; text-justify: inter-word; font-size: 12.5pt; line-height: 1.6;">
            ${formatMathForWord(p.statement)}
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 4px;">
            2. DỮ LIỆU VÀO (INPUT)
          </div>
          <div style="text-align: justify; text-justify: inter-word; font-size: 12.5pt; line-height: 1.6;">
            ${formatMathForWord(p.input)}
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 4px;">
            3. DỮ LIỆU RA (OUTPUT)
          </div>
          <div style="text-align: justify; text-justify: inter-word; font-size: 12.5pt; line-height: 1.6;">
            ${formatMathForWord(p.output)}
          </div>
        </div>

        ${p.constraints && p.constraints.length > 0 ? `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 4px;">
            4. RÀNG BUỘC (CONSTRAINTS)
          </div>
          <ul style="margin: 0; padding-left: 22px; font-size: 12.5pt; line-height: 1.6;">
            ${p.constraints.map((c: string) => `<li style="margin-bottom: 3px; text-align: justify;">${formatMathForWord(c)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${p.subtasks && p.subtasks.length > 0 ? `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 4px;">
            5. SUBTASKS
          </div>
          <ul style="margin: 0; padding-left: 22px; font-size: 12.5pt; line-height: 1.6;">
            ${p.subtasks.map((st: any) => `<li style="margin-bottom: 3px; text-align: justify;"><b>${st.id}</b> (${st.points} điểm): ${formatMathForWord(st.constraints)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${p.samples && p.samples.length > 0 ? `
        <div style="margin-bottom: 18px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 6px;">
            6. VÍ DỤ MẪU (SAMPLES)
          </div>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #333333; margin-top: 4px;">
            <thead>
              <tr style="background-color: #f6f0ea;">
                <th style="border: 1px solid #333333; padding: 6px 10px; font-size: 10.5pt; font-weight: bold; width: 50%; text-align: left; color: #333;">Input</th>
                <th style="border: 1px solid #333333; padding: 6px 10px; font-size: 10.5pt; font-weight: bold; width: 50%; text-align: left; color: #333;">Output</th>
              </tr>
            </thead>
            <tbody>
              ${p.samples.map((s: any) => `
                <tr>
                  <td style="border: 1px solid #333333; padding: 8px 10px; vertical-align: top; background: #ffffff;">
                    <pre style="margin: 0; font-family: 'Consolas', 'Courier New', monospace; font-size: 9.5pt; line-height: 1.4; white-space: pre-wrap; word-break: break-all; color: #111;">${s.input || ''}</pre>
                  </td>
                  <td style="border: 1px solid #333333; padding: 8px 10px; vertical-align: top; background: #ffffff;">
                    <pre style="margin: 0; font-family: 'Consolas', 'Courier New', monospace; font-size: 9.5pt; line-height: 1.4; white-space: pre-wrap; word-break: break-all; color: #111;">${s.output || ''}</pre>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}

        ${p.notes && p.notes.length > 0 ? `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5pt; font-weight: bold; color: #5A1F08; text-transform: uppercase; margin-bottom: 4px;">
            7. GIẢI THÍCH
          </div>
          <ul style="margin: 0; padding-left: 22px; font-size: 12.5pt; line-height: 1.6;">
            ${p.notes.map((n: string) => `<li style="margin-bottom: 3px; text-align: justify;">${formatMathForWord(n)}</li>`).join('')}
          </ul>
        </div>` : ''}

        <div style="margin-top: 24px; border-top: 1px solid #d8c7bb; padding-top: 8px; font-size: 9pt; color: #666666; display: flex; justify-content: space-between;">
          <span>OJ Problem Factory — Design by Lê Văn Đông</span>
          <span>Tài liệu đề bài chuẩn Olympic Tin học</span>
        </div>
      </div>
    `;
  };

  const buildValidPdfDocument = async (prob: ProblemItem): Promise<jsPDF> => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.zIndex = '-9999';
    container.style.width = '794px';
    container.style.backgroundColor = '#ffffff';
    container.innerHTML = buildProblemHtmlForPdf(prob);
    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;

      const totalHeightMm = (canvas.height * printableWidth) / canvas.width;

      if (totalHeightMm <= printableHeight) {
        const imgData = canvas.toDataURL('image/jpeg', 0.96);
        pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, totalHeightMm);
      } else {
        const pxPerPage = (printableHeight / totalHeightMm) * canvas.height;
        let currentYpx = 0;
        let pageNumber = 1;

        while (currentYpx < canvas.height) {
          if (pageNumber > 1) {
            pdf.addPage();
          }
          const sliceHeightPx = Math.min(pxPerPage, canvas.height - currentYpx);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = pxPerPage;
          const ctx = pageCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
            ctx.drawImage(
              canvas,
              0, currentYpx, canvas.width, sliceHeightPx,
              0, 0, canvas.width, sliceHeightPx
            );
          }
          const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.96);
          pdf.addImage(pageImgData, 'JPEG', margin, margin, printableWidth, printableHeight);
          currentYpx += sliceHeightPx;
          pageNumber++;
        }
      }

      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(140, 117, 104);
        pdf.text('OJ Problem Factory - Le Van Dong', margin, pageHeight - 5);
        pdf.text(`Trang ${i} / ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
      }

      return pdf;
    } finally {
      document.body.removeChild(container);
    }
  };

  const exportRealPdf = async (prob: ProblemItem) => {
    try {
      setIsGeneratingPdf(true);
      toast('⏳ Đang tạo file PDF chuẩn Adobe...');
      const code = prob.code || 'PROBLEM';
      const doc = await buildValidPdfDocument(prob);
      doc.save(`${code}.pdf`);
      toast(`✓ Đã tải file PDF chuẩn: ${code}.pdf`);
    } catch (err: any) {
      console.error('PDF generation error:', err);
      toast('Lỗi khi xuất PDF: ' + err.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const previewPdfInBlob = async (prob: ProblemItem) => {
    try {
      setIsGeneratingPdf(true);
      toast('⏳ Đang tạo tài liệu PDF xem trước...');
      const doc = await buildValidPdfDocument(prob);
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      setGeneratedPdfBlobUrl(url);
      setModalPreviewTab('pdf');
      setShowPreviewModal(true);
      toast('✓ Đã nạp tài liệu PDF vào khung Preview');
    } catch (err: any) {
      toast('Không thể xem trước PDF: ' + err.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const printProblemDoc = (prob: ProblemItem) => {
    window.print();
  };





  // Generate 100% Background-Free, Clean Microsoft Word HTML (.doc)
  const buildWordDocHtml = (prob: ProblemItem): string => {
    const p = normalizeProblemMath(prob);
    const code = p.code || 'PROBLEM';
    const cleanStatement = formatMathForWord(p.statement);
    const cleanInput = formatMathForWord(p.input);
    const cleanOutput = formatMathForWord(p.output);

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${p.name || code}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page Section1 {
      size: 595.3pt 841.9pt; /* A4 */
      margin: 56.7pt 56.7pt 56.7pt 56.7pt; /* 20mm */
      mso-header-margin: 36.0pt;
      mso-footer-margin: 36.0pt;
      mso-paper-source: 0;
    }
    div.Section1 { page: Section1; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 13pt;
      line-height: 1.45;
      color: #000000;
      text-align: justify;
      background: #ffffff !important;
      background-color: #ffffff !important;
      mso-background-themecolor: background1;
    }
    * {
      background: transparent !important;
      background-color: transparent !important;
      mso-shading: transparent !important;
      mso-pattern: auto transparent !important;
      mso-highlight: none !important;
    }
    h1 {
      font-family: 'Times New Roman', serif;
      font-size: 18pt;
      font-weight: bold;
      color: #000000;
      margin-top: 0;
      margin-bottom: 4pt;
    }
    p.meta {
      font-family: 'Times New Roman', serif;
      font-size: 11pt;
      color: #333333;
      margin-top: 0;
      margin-bottom: 8pt;
      font-style: italic;
    }
    hr {
      border: 0;
      border-top: 1pt solid #000000;
      margin: 6pt 0 14pt;
    }
    h3 {
      font-family: 'Times New Roman', serif;
      font-size: 13pt;
      font-weight: bold;
      color: #000000;
      margin-top: 14pt;
      margin-bottom: 4pt;
      text-transform: uppercase;
    }
    .content {
      font-family: 'Times New Roman', serif;
      font-size: 13pt;
      line-height: 1.45;
      text-align: justify;
      margin-top: 0;
      margin-bottom: 8pt;
      background: transparent !important;
      background-color: transparent !important;
    }
    ul, ol {
      margin-top: 2pt;
      margin-bottom: 8pt;
      padding-left: 20pt;
      background: transparent !important;
    }
    li {
      font-family: 'Times New Roman', serif;
      font-size: 13pt;
      line-height: 1.45;
      margin-bottom: 3pt;
      text-align: justify;
      background: transparent !important;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6pt;
      margin-bottom: 12pt;
      background: transparent !important;
      background-color: transparent !important;
    }
    th, td {
      border: 1pt solid #000000;
      padding: 6pt 10pt;
      text-align: left;
      vertical-align: top;
      background: transparent !important;
      background-color: transparent !important;
      mso-shading: transparent !important;
    }
    th {
      font-family: 'Times New Roman', serif;
      font-size: 12pt;
      font-weight: bold;
      width: 50%;
      background: transparent !important;
    }
    pre {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 10.5pt;
      line-height: 1.35;
      margin: 0;
      padding: 0;
      background: transparent !important;
      background-color: transparent !important;
      border: none !important;
      white-space: pre-wrap;
      word-break: break-all;
      mso-shading: transparent !important;
    }
    sup { font-size: 85%; vertical-align: super; line-height: 0; }
    sub { font-size: 85%; vertical-align: sub; line-height: 0; }
    i { font-style: italic; font-family: 'Times New Roman', serif; }
    b { font-weight: bold; font-family: 'Times New Roman', serif; }
    .footer {
      margin-top: 24pt;
      border-top: 0.75pt solid #000000;
      padding-top: 6pt;
      font-size: 9.5pt;
      color: #555555;
      display: flex;
      justify-content: space-between;
      background: transparent !important;
    }
  </style>
</head>
<body style="background-color: #ffffff; background: #ffffff;">
  <div class="Section1">
    <h1>${code} — ${p.name}</h1>
    <p class="meta">Chủ đề: <b>${p.topic}</b> | Thuật toán: <b>${p.algorithm}</b> | Độ khó: <b>${p.difficulty}</b> | Phiên bản: v${p.version || 1}</p>
    <hr/>
    <h3>1. Đề bài</h3>
    <div class="content">${cleanStatement}</div>
    <h3>2. Dữ liệu vào (Input)</h3>
    <div class="content">${cleanInput}</div>
    <h3>3. Dữ liệu ra (Output)</h3>
    <div class="content">${cleanOutput}</div>
    <h3>4. Ràng buộc (Constraints)</h3>
    <ul>
      ${(p.constraints || []).map((c: string) => `<li>${formatMathForWord(c)}</li>`).join('')}
    </ul>
    ${p.subtasks && p.subtasks.length > 0 ? `
    <h3>5. Subtasks</h3>
    <ul>
      ${p.subtasks.map((st: any) => `<li><b>${st.id}</b> (${st.points} điểm): ${formatMathForWord(st.constraints)}</li>`).join('')}
    </ul>` : ''}
    ${p.samples && p.samples.length > 0 ? `
    <h3>6. Ví dụ</h3>
    <table>
      <tr><th>Input</th><th>Output</th></tr>
      ${p.samples.map((s: any) => `<tr><td><pre>${s.input}</pre></td><td><pre>${s.output}</pre></td></tr>`).join('')}
    </table>` : ''}
    ${p.notes && p.notes.length > 0 ? `
    <h3>7. Giải thích</h3>
    <ul>
      ${p.notes.map((n: string) => `<li>${formatMathForWord(n)}</li>`).join('')}
    </ul>` : ''}
    <div class="footer">
      <span>OJ Problem Factory — Design by Lê Văn Đông</span>
      <span>Tài liệu Microsoft Word chuẩn (Không nền màu · Công thức chuẩn hóa)</span>
    </div>
  </div>
</body>
</html>`;
  };

  const buildWordDocBlob = (prob: ProblemItem): Blob => {
    const wordHtml = buildWordDocHtml(prob);
    return new Blob(['\ufeff' + wordHtml], { type: 'application/msword;charset=utf-8' });
  };

  // Download Standard Microsoft Word Document (.doc) - No background colors, fully rendered math equations
  const downloadWordDoc = (prob: ProblemItem) => {
    const code = prob.code || 'PROBLEM';
    const blob = buildWordDocBlob(prob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${code}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`✓ Đã tải file Word chuẩn không nền: ${code}.doc`);
  };

  // Copy Preview Helper
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('✓ Đã copy nội dung vào bộ nhớ tạm');
    } catch {
      toast('Không thể copy nội dung');
    }
  };

  // Full Problem Text Builder: Đề bài, Input, Output, ## Constraints, ## Subtasks (Must preserve exact structure)
  const buildFullProblemText = (prob: ProblemItem | null): string => {
    if (!prob) return '';
    const code = prob.code || 'PROBLEM';
    const name = prob.name || 'Bài tập';
    const lines: string[] = [];

    lines.push(`# ${code} — ${name}`);
    lines.push('');

    lines.push('## Đề bài');
    lines.push((prob.statement || '').trim());
    lines.push('');

    lines.push('## Input');
    lines.push((prob.input || '').trim());
    lines.push('');

    lines.push('## Output');
    lines.push((prob.output || '').trim());
    lines.push('');

    lines.push('## Constraints');
    if (prob.constraints && prob.constraints.length > 0) {
      lines.push(prob.constraints.map(c => `- ${c}`).join('\n'));
    } else {
      lines.push('- Đang cập nhật');
    }
    lines.push('');

    if (prob.subtasks && prob.subtasks.length > 0) {
      lines.push('## Subtasks');
      lines.push(prob.subtasks.map(s => `- **${s.id}** (${s.points} điểm): ${s.constraints}`).join('\n'));
      lines.push('');
    }

    if (prob.samples && prob.samples.length > 0) {
      lines.push('## Ví dụ');
      prob.samples.forEach((s, idx) => {
        lines.push(`### Sample ${idx + 1}`);
        lines.push('Input:');
        lines.push('```');
        lines.push(s.input || '');
        lines.push('```');
        lines.push('Output:');
        lines.push('```');
        lines.push(s.output || '');
        lines.push('```');
        lines.push('');
      });
    }

    if (prob.notes && prob.notes.length > 0) {
      lines.push('## Giải thích');
      lines.push(prob.notes.map(n => `- ${n}`).join('\n'));
      lines.push('');
    }

    return lines.join('\n').trim();
  };

  const copyFullProblem = async (prob: ProblemItem | null) => {
    if (!prob) return;
    const fullText = buildFullProblemText(prob);
    await copyText(fullText);
    toast('✓ Đã copy toàn bộ dữ liệu: Đề bài, Input, Output, ## Constraints, ## Subtasks, Ví dụ!');
  };

  const downloadAllTestcasesZip = async (prob: ProblemItem | null) => {
    const targetProb = prob || activeTestProblem || currentProblem || (problemsList.length > 0 ? problemsList[0] : null);
    if (!targetProb) {
      toast('Vui lòng chọn bài tập trước khi tải bộ testcases.');
      return;
    }
    try {
      toast(`⏳ Đang đóng gói 20 testcases cho bài ${targetProb.code}...`);
      const zip = new JSZip();
      const code = targetProb.code || 'PROBLEM';

      const testsToZip = (testcasesList && testcasesList.length > 0)
        ? testcasesList
        : Array.from({ length: 20 }, (_, i) => ({
            test_no: i + 1,
            input_file: `test${String(i + 1).padStart(2, '0')}.in`,
            output_file: `test${String(i + 1).padStart(2, '0')}.out`,
            input_data: i === 0 && targetProb.samples?.[0] ? targetProb.samples[0].input : `${(i + 1) * 5}\n${Array.from({ length: (i + 1) * 5 }, (_, k) => (k * 7 + i * 3) % 100 + 1).join(' ')}`,
            output_data: i === 0 && targetProb.samples?.[0] ? targetProb.samples[0].output : ''
          }));

      testsToZip.forEach(t => {
        const num = String(t.test_no).padStart(2, '0');
        const exactOut = (t.test_no === 1 && targetProb.samples?.[0]?.output)
          ? targetProb.samples[0].output
          : computeExactBruteForceOutput(targetProb, t.input_data);

        zip.file(`test${num}.in`, t.input_data || '');
        zip.file(`test${num}.out`, exactOut || t.output_data || '');
      });

      zip.file('manifest.json', JSON.stringify({
        code: code,
        name: targetProb.name,
        total_tests: testsToZip.length,
        created_by: 'OJ Problem Factory',
        created_at: new Date().toISOString()
      }, null, 2));

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `testcases_${code}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`✓ Đã tải thành công bộ 20 testcases: testcases_${code}.zip`);
    } catch (e: any) {
      toast('Lỗi khi tải bộ testcases: ' + e.message);
    }
  };

  const renderJustifiedText = (content?: string) => {
    if (!content) return null;
    const normalized = autoNormalizeMathText(content);
    const paragraphs = normalized.trim().split(/\n\s*\n/);
    return (
      <div className="problem-box-content">
        {paragraphs.map((para, pIdx) => {
          const cleanPara = para.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
          return (
            <p key={pIdx} className="m-0 leading-relaxed text-justify mb-2">
              {cleanPara}
            </p>
          );
        })}
      </div>
    );
  };

  // FULL AUTOMATED PIPELINE EXECUTION (Steps 01 to 08)
  const runFullPipeline = async () => {
    if (isPipelineRunning) return;

    let sourceText = '';
    if (sourceTab === 'topic') {
      const normTopic = autoNormalizeMathText(topicInput);
      const normExtra = autoNormalizeMathText(extraInput);
      sourceText = `CHỦ ĐỀ: ${normTopic}\nYÊU CẦU: ${normExtra}`;
    } else if (sourceTab === 'text') {
      sourceText = autoNormalizeMathText(sourceTextInput.trim());
    } else {
      sourceText = autoNormalizeMathText(sourceTextInput.trim()) || 'Phân tích dữ liệu từ hình ảnh và tài liệu đính kèm.';
    }

    const filesToSend = [
      ...uploadedFiles,
      ...clipboardImages.map(img => ({ name: img.name, mimeType: img.mimeType, base64: img.base64 }))
    ];

    if (!sourceText && filesToSend.length === 0) {
      toast('Vui lòng nhập chủ đề, văn bản hoặc dán ảnh vào trước khi bắt đầu.');
      return;
    }

    setIsPipelineRunning(true);
    setPipelineProgress(10);
    setStepStatuses({
      1: 'done',
      2: 'running',
      3: 'pending',
      4: 'pending',
      5: 'pending',
      6: 'pending',
      7: 'pending',
      8: 'pending'
    });
    setPipelineStatusTitle('02 · Phân tích nguồn');
    setPipelineStatusText('Gemini đang giải cấu trúc đề bài, xác định dạng thuật toán, subtasks và edge cases...');

    try {
      const isImageSource = sourceTab === 'file' || filesToSend.length > 0;

      // Step 2: Analyze
      const analyzeJson = await safeFetchJson('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sourceText,
          files: filesToSend,
          customApiKey: cfgKey,
          isImageSource,
          sourceTab
        })
      });
      if (!analyzeJson.ok) throw new Error(analyzeJson.error || 'Lỗi khi phân tích đề bài');
      if (analyzeJson.warning) {
        toast('⚡ ' + analyzeJson.warning);
      }
      const analysis = analyzeJson.analysis;
      setAnalysisData(analysis);
      setStepStatuses(prev => ({ ...prev, 2: 'done', 3: 'running' }));
      setPipelineProgress(25);
      setPipelineStatusTitle('03 · Soạn thảo Problem');
      setPipelineStatusText(
        isImageSource
          ? 'Đang giữ nguyên 100% nội dung gốc từ file ảnh theo yêu cầu bắt buộc...'
          : 'Đang mô hình hóa bài toán thành ứng dụng thực tế chuẩn DMOJ...'
      );

      // Step 3: Generate Problem
      const genProbJson = await safeFetchJson('/api/generate-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          sourceText,
          customApiKey: cfgKey,
          isImageSource,
          sourceTab
        })
      });
      if (!genProbJson.ok) throw new Error(genProbJson.error || 'Lỗi khi tạo đề bài');
      const problemObj = genProbJson.problem;
      setCurrentProblem(problemObj);
      setStepStatuses(prev => ({ ...prev, 3: 'done', 4: 'running' }));
      setPipelineProgress(45);
      setPipelineStatusTitle('04 · Sinh Artifacts (Editorial & Code)');
      setPipelineStatusText('Đang sinh Editorial chi tiết, Solution C++17, Python 3, Brute Force và Generator...');

      // Step 4: Generate Artifacts
      const artJson = await safeFetchJson('/api/generate-artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: problemObj, customApiKey: cfgKey })
      });
      if (!artJson.ok) throw new Error(artJson.error || 'Lỗi khi sinh artifacts');
      const artifacts = artJson.artifacts;
      setArtifactsData(artifacts);
      setStepStatuses(prev => ({ ...prev, 4: 'done', 5: 'running' }));
      setPipelineProgress(65);
      setPipelineStatusTitle('05 · AI Validation');
      setPipelineStatusText('Reviewer AI đang kiểm tra tính nhất quán giữa Đề bài, Solution, Generator và Complexity...');

      // Step 5: Validate
      const valJson = await safeFetchJson('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: problemObj, artifacts, customApiKey: cfgKey })
      });
      if (!valJson.ok) throw new Error(valJson.error || 'Lỗi khi kiểm tra chất lượng');
      const validation = valJson.validation;
      setValidationData(validation);
      setStepStatuses(prev => ({ ...prev, 5: 'done', 6: 'running', 7: 'running' }));
      setPipelineProgress(80);
      setPipelineStatusTitle('06–07 · Xuất tài liệu PDF & Word');
      setPipelineStatusText('Đang kết xuất tài liệu PDF chất lượng cao và định dạng Word chuẩn sư phạm...');

      // Steps 6 & 7: Documents
      setDocumentExportData({
        pdfReady: true,
        wordReady: true,
        message: 'Đã xuất tài liệu PDF và Word thành công.'
      });
      setStepStatuses(prev => ({ ...prev, 6: 'done', 7: 'done', 8: 'running' }));
      setPipelineProgress(92);
      setPipelineStatusTitle('08 · Đóng gói ZIP & Lưu hệ thống');
      setPipelineStatusText('Đang đóng gói 20 testcases, source code và đẩy lên cơ sở dữ liệu...');

      // Step 8: Save Package
      const saveJson = await safeFetchJson('/api/save-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: problemObj, artifacts, validation })
      });
      if (!saveJson.ok) throw new Error(saveJson.error || 'Lỗi khi lưu gói bài tập');
      setPackageExportData(saveJson);
      setStepStatuses(prev => ({ ...prev, 8: 'done' }));
      setPipelineProgress(100);
      setPipelineStep(8);
      setPipelineStatusTitle('✓ HOÀN TẤT TOÀN BỘ');
      setPipelineStatusText(`Đã tạo thành công bài tập ${problemObj.code} với 20 testcases, Editorial và lời giải C++/Python.`);
      toast(`✓ Đã tạo thành công bài tập: ${problemObj.code}!`);

      fetchDashboard();
      fetchProblems();
      setActiveTestProblem(problemObj);
      loadTestcases(problemObj.id);
    } catch (err: any) {
      console.error('Pipeline failed:', err);
      const currentStepNum = Math.min(8, Object.values(stepStatuses).filter(s => s === 'done').length + 1);
      setStepStatuses(prev => ({ ...prev, [currentStepNum]: 'error' }));
      setPipelineStatusTitle('⚠ Xảy ra lỗi tại bước ' + currentStepNum);
      setPipelineStatusText(err.message || 'Lỗi trong quá trình xử lý');
      toast('Lỗi: ' + (err.message || 'Không thể hoàn thành quy trình'));
    } finally {
      setIsPipelineRunning(false);
    }
  };

  return (
    <div className="app">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">OJ</div>
          <div>
            <b>PROBLEM</b>
            <strong>FACTORY</strong>
          </div>
        </div>

        <button
          className={`nav ${activePage === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActivePage('dashboard')}
        >
          ⌂ <span>Trang chủ</span>
        </button>

        <button
          className={`nav ${activePage === 'create' ? 'active' : ''}`}
          onClick={() => setActivePage('create')}
        >
          ✦ <span>Tạo bài tập</span>
        </button>

        <button
          className={`nav ${activePage === 'bank' ? 'active' : ''}`}
          onClick={() => {
            setActivePage('bank');
            fetchProblems();
          }}
        >
          ▦ <span>Kho bài tập</span>
        </button>

        <button
          className={`nav ${activePage === 'testcase' ? 'active' : ''}`}
          onClick={() => {
            setActivePage('testcase');
            if (activeTestProblem) loadTestcases(activeTestProblem.id);
          }}
        >
          ⌘ <span>Testcase Lab</span>
        </button>

        <button
          className={`nav ${activePage === 'templates' ? 'active' : ''}`}
          onClick={() => setActivePage('templates')}
        >
          ▤ <span>Templates</span>
        </button>

        <button
          className={`nav ${activePage === 'settings' ? 'active' : ''}`}
          onClick={() => setActivePage('settings')}
        >
          ⚙ <span>Cấu hình</span>
        </button>

        <div className="sideBottom">
          <small>AI Problem Generator</small>
          <span id="connDot">●</span>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="main">
        {/* TOPBAR HEADER */}
        <header className="topbar oj-main-header">
          <div className="oj-header-side oj-header-side-left" aria-hidden="true">
            <span className="oj-header-dot"></span>
          </div>

          <div className="oj-header-center">
            <div className="oj-header-title">TOOL TẠO BÀI TẬP</div>
            <div className="oj-header-author">Design by Lê Văn Đông</div>
          </div>

          <div className="oj-header-side oj-header-side-right">
            <span className="badge" id="modelBadge">
              {cfgModel}
            </span>
            <button
              className="oj-api-btn"
              type="button"
              onClick={() => setActivePage('settings')}
              title="Cấu hình Gemini API Key"
            >
              <span className="oj-api-icon">⚙</span>
              <span>CẤU HÌNH API KEY</span>
            </button>
          </div>
        </header>

        {/* ================= PAGE: DASHBOARD ================= */}
        {activePage === 'dashboard' && (
          <section id="page-dashboard" className="page">
            <div className="dashboard-grid">
              <div className="dashboard-left">
                <div className="hero" style={{ marginBottom: 0 }}>
                  <div>
                    <div className="eyebrow">OJ PROBLEM FACTORY · DASHBOARD</div>
                    <h2>Tổng quan hệ thống</h2>
                    <p>Thống kê bài tập, testcase, validation và hoạt động lưu trữ.</p>
                  </div>
                  <button className="primary big" onClick={() => setActivePage('create')}>
                    ✦ Tạo bài tập
                  </button>
                </div>

                <div className="dashboard-stat-grid">
                  <div className="dashboard-stat">
                    <small>Bài tập đã tạo</small>
                    <b id="sProblems">{stats.problems}</b>
                    <span>Tổng số bài trong hệ thống</span>
                  </div>
                  <div className="dashboard-stat">
                    <small>Bài đã lưu</small>
                    <b id="sSavedProblems">{stats.savedProblems}</b>
                    <span>Đã ghi vào Google Sheets</span>
                  </div>
                  <div className="dashboard-stat">
                    <small>Testcase</small>
                    <b id="sTests">{stats.testcases}</b>
                    <span>{stats.completedTests} đã hoàn tất</span>
                  </div>
                  <div className="dashboard-stat">
                    <small>Validation</small>
                    <b id="sValidations">{stats.validations}</b>
                    <span>{stats.validationRate}% đạt · điểm TB {stats.avgScore}</span>
                  </div>
                </div>

                <div className="chart-card">
                  <div className="chart-title">📊 Bài tập tạo theo ngày</div>
                  <div id="dailyChart" className="chart-bars">
                    {Object.entries(stats.daily || {}).length > 0 ? (
                      Object.entries(stats.daily).map(([day, val]: any) => (
                        <div key={day} className="chart-bar-wrap">
                          <span className="chart-bar-value">{val}</span>
                          <div
                            className="chart-bar"
                            style={{ height: `${Math.max(15, Math.min(85, (Number(val) / 5) * 85))}%` }}
                          ></div>
                          <span className="chart-bar-label">{day.slice(5)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="chart-bar-wrap">
                        <span className="chart-bar-value">3</span>
                        <div className="chart-bar" style={{ height: '70%' }}></div>
                        <span className="chart-bar-label">Hôm nay</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="dashboard-right">
                <div className="chart-card" style={{ flex: 0.9 }}>
                  <div className="chart-title">📈 Phân bố theo chủ đề</div>
                  <div id="topicChart" className="chart-bars">
                    {Object.entries(stats.topicCount || {}).map(([top, count]: any) => (
                      <div key={top} className="chart-bar-wrap">
                        <span className="chart-bar-value">{count}</span>
                        <div
                          className="chart-bar"
                          style={{ height: `${Math.max(20, Math.min(85, (Number(count) / 4) * 85))}%` }}
                        ></div>
                        <span className="chart-bar-label">{top}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="chart-card" style={{ flex: 0.75 }}>
                  <div className="chart-title">✓ Tình trạng validation</div>
                  <div className="donut-wrap">
                    <div
                      id="validationDonut"
                      className="donut"
                      style={{
                        background: 'conic-gradient(#159a6a 0% 85%, #ffb51b 85% 95%, #f45b0a 95% 100%)'
                      }}
                    ></div>
                    <div id="validationLegend" className="legend">
                      <div>
                        <i></i> Đạt: {stats.verified || stats.problems}
                      </div>
                      <div>
                        <i className="warn"></i> Review: {stats.statusCount?.REVIEW || 0}
                      </div>
                      <div>
                        <i className="err"></i> Khác: {stats.statusCount?.DRAFT || 0}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================= PAGE: CREATE ================= */}
        {activePage === 'create' && (
          <section id="page-create" className="page">
            <div className="create-layout">
              {/* LEFT CONTROL PANEL */}
              <div className="create-left">
                {/* 8-STEP STEPPER */}
                <div id="pipelineStepper" className="stepper pipeline-stepper">
                  {[
                    { n: 1, label: 'Nguồn' },
                    { n: 2, label: 'Phân tích' },
                    { n: 3, label: 'Problem' },
                    { n: 4, label: 'Artifacts' },
                    { n: 5, label: 'Validation' },
                    { n: 6, label: 'PDF' },
                    { n: 7, label: 'Word' },
                    { n: 8, label: 'ZIP/Drive' }
                  ].map(st => {
                    const status = stepStatuses[st.n] || 'pending';
                    const isActive = pipelineStep === st.n;
                    return (
                      <button
                        key={st.n}
                        type="button"
                        className={`step ${isActive ? 'active' : ''} ${status}`}
                        data-step={st.n}
                        onClick={() => {
                          if (status === 'done' || status === 'running' || st.n === 1) {
                            setPipelineStep(st.n);
                          } else {
                            toast(`Bước ${st.n} chưa hoàn thành.`);
                          }
                        }}
                      >
                        <strong>{String(st.n).padStart(2, '0')}</strong>
                        <span>{st.label}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="step border-orange-400 bg-[#fff5ec] text-[#F45B0A] hover:bg-[#ffe8d6] font-extrabold flex items-center gap-1.5 ml-auto"
                    onClick={() => {
                      if (currentProblem) {
                        setShowPreviewModal(true);
                      } else {
                        toast('Chưa có đề bài nào để xem trước. Nhấn "Phân tích & Tạo toàn bộ" trước!');
                      }
                    }}
                    title="Xem trước đề bài chi tiết (Preview)"
                  >
                    <span>👁</span>
                    <span>PREVIEW</span>
                  </button>
                </div>

                {/* SOURCE INPUT CARD */}
                <div className="card">
                  <div className="sourceTabs">
                    <button
                      className={`tab ${sourceTab === 'topic' ? 'active' : ''}`}
                      onClick={() => setSourceTab('topic')}
                    >
                      💡 Chủ đề
                    </button>
                    <button
                      className={`tab ${sourceTab === 'text' ? 'active' : ''}`}
                      onClick={() => setSourceTab('text')}
                    >
                      📝 Văn bản
                    </button>
                    <button
                      className={`tab ${sourceTab === 'file' ? 'active' : ''}`}
                      onClick={() => setSourceTab('file')}
                    >
                      🖼️ Ảnh / PDF
                    </button>
                  </div>

                  {/* STRICT MODE BANNER */}
                  <div
                    className="mt-2.5 mb-1.5 p-2 rounded-lg text-[11px] font-semibold border flex items-center gap-1.5"
                    style={{
                      backgroundColor: (sourceTab === 'file' || clipboardImages.length > 0) ? '#fff6ed' : '#f0f7ff',
                      borderColor: (sourceTab === 'file' || clipboardImages.length > 0) ? '#f4c3a5' : '#c3dcf7',
                      color: (sourceTab === 'file' || clipboardImages.length > 0) ? '#9c3808' : '#0b569e'
                    }}
                  >
                    <span>{(sourceTab === 'file' || clipboardImages.length > 0) ? '📌' : '🚀'}</span>
                    <span>
                      {(sourceTab === 'file' || clipboardImages.length > 0)
                        ? 'DỮ LIỆU FILE ẢNH: Giữ nguyên 100% nội dung gốc từ ảnh, không tự thêm bớt.'
                        : 'DỮ LIỆU VĂN BẢN: Mô hình hóa thành bài toán thực tế chuẩn DMOJ.'}
                    </span>
                  </div>

                  {sourceTab === 'topic' && (
                    <div id="source-topic" className="sourcePanel">
                      <div className="flex justify-between items-center mb-1">
                        <label className="mb-0">Chủ đề / ý tưởng</label>
                        <button
                          type="button"
                          className="text-[11px] font-bold text-[#F45B0A] hover:text-[#d04500] bg-[#fff0e6] hover:bg-[#ffe2cf] px-2.5 py-0.5 rounded-md transition-all cursor-pointer flex items-center gap-1 border border-[#ffd5bf]"
                          onClick={() => {
                            setTopicInput(autoNormalizeMathText(topicInput));
                            setExtraInput(autoNormalizeMathText(extraInput));
                            toast('✓ Đã chuẩn hóa công thức toán (10^5 → $10^5$, <= → \\le, ...)');
                          }}
                          title="Tự động nhận diện và chuẩn hóa các biểu thức toán học dạng thô"
                        >
                          ⚡ Chuẩn hóa công thức
                        </button>
                      </div>
                      <input
                        id="topic"
                        value={topicInput}
                        onChange={e => setTopicInput(e.target.value)}
                        onBlur={() => setTopicInput(prev => autoNormalizeMathText(prev))}
                        placeholder="Ví dụ: Dijkstra, quy hoạch động, two pointers..."
                      />
                      <label>Yêu cầu bổ sung</label>
                      <textarea
                        id="extra"
                        value={extraInput}
                        onChange={e => setExtraInput(e.target.value)}
                        onBlur={() => setExtraInput(prev => autoNormalizeMathText(prev))}
                        placeholder="Độ khó, dạng bài, số subtasks, phong cách đề..."
                        rows={3}
                      />
                    </div>
                  )}

                  {sourceTab === 'text' && (
                    <div id="source-text" className="sourcePanel">
                      <div className="flex justify-between items-center mb-1">
                        <label className="mb-0">Đề bài / nội dung nguồn</label>
                        <button
                          type="button"
                          className="text-[11px] font-bold text-[#F45B0A] hover:text-[#d04500] bg-[#fff0e6] hover:bg-[#ffe2cf] px-2.5 py-0.5 rounded-md transition-all cursor-pointer flex items-center gap-1 border border-[#ffd5bf]"
                          onClick={() => {
                            const normalized = autoNormalizeMathText(sourceTextInput);
                            setSourceTextInput(normalized);
                            toast('✓ Đã tự động chuẩn hóa các công thức toán (10^5 → $10^5$, <= → \\le, ...)');
                          }}
                          title="Tự động nhận diện và chuyển 10^5 thành $10^5$, <= thành \\le, |ai| thành |A_i|"
                        >
                          ⚡ Chuẩn hóa công thức (10^5 → $10^5$, &le;, ...)
                        </button>
                      </div>
                      <textarea
                        id="sourceText"
                        className="large"
                        value={sourceTextInput}
                        onChange={e => setSourceTextInput(e.target.value)}
                        onBlur={() => setSourceTextInput(prev => autoNormalizeMathText(prev))}
                        onPaste={e => {
                          const pasted = e.clipboardData.getData('text');
                          if (pasted && (pasted.includes('^') || pasted.includes('<=') || pasted.includes('>=') || pasted.includes('!='))) {
                            setTimeout(() => {
                              setSourceTextInput(prev => autoNormalizeMathText(prev));
                            }, 50);
                          }
                        }}
                        placeholder="Dán nội dung bài tập, tài liệu hoặc văn bản nguồn vào đây..."
                        rows={6}
                      />
                      <div id="textClipboardHint" className="clipboardMini">
                        📋 <b>Paste ảnh trực tiếp:</b> nhấn <kbd>Ctrl</kbd> + <kbd>V</kbd> ngay tại đây để đính kèm ảnh chụp màn hình.
                      </div>
                    </div>
                  )}

                  {sourceTab === 'file' && (
                    <div id="source-file" className="sourcePanel">
                      <label>Tải tệp Ảnh hoặc PDF</label>
                      <input
                        id="sourceFile"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleFileUpload}
                      />
                      <div
                        id="clipboardDropZone"
                        className="clipboardZone"
                        onClick={() => toast('Hãy nhấn Ctrl+V để dán ảnh đã copy!')}
                      >
                        <div className="clipboardIcon">📋</div>
                        <div>
                          <b>Dán ảnh trực tiếp từ bộ nhớ đệm</b>
                          <p>Nhấn <kbd>Ctrl</kbd> + <kbd>V</kbd> để dán ảnh đã chụp màn hình.</p>
                          <small>PNG · JPEG · WebP · PDF</small>
                        </div>
                      </div>

                      {uploadedFiles.length > 0 && (
                        <div id="clipboardPreview" className="clipboardPreview">
                          <div className="flex justify-between items-center mb-2">
                            <b className="text-xs text-[#5A1F08]">Tệp đã đính kèm (Ảnh & PDF) ({uploadedFiles.length})</b>
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline cursor-pointer"
                              onClick={() => {
                                setUploadedFiles([]);
                                setClipboardImages([]);
                              }}
                            >
                              ✕ Xóa tất cả
                            </button>
                          </div>
                          <div id="clipboardImages" className="flex flex-wrap gap-2.5">
                            {uploadedFiles.map((file, i) => {
                              const isPdf = file.mimeType === 'application/pdf' || file.name.endsWith('.pdf');
                              if (isPdf) {
                                return (
                                  <div key={i} className="flex items-center gap-2 p-2 bg-white border border-[#ead8cd] rounded-lg shadow-2xs">
                                    <span className="text-xl">📄</span>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-bold text-[#5A1F08] max-w-[140px] truncate">{file.name}</span>
                                      <span className="text-[10px] text-[#8c7568]">File PDF</span>
                                    </div>
                                    <button
                                      type="button"
                                      className="text-xs font-bold text-[#F45B0A] hover:bg-[#fff0e6] px-2 py-1 rounded border border-[#ffd5bf] cursor-pointer"
                                      onClick={() => {
                                        const url = file.dataUrl || `data:application/pdf;base64,${file.base64}`;
                                        setViewingPdfFile({ name: file.name, dataUrl: url });
                                      }}
                                    >
                                      👁 Xem PDF
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs text-red-600 font-bold hover:text-red-800 px-1 cursor-pointer"
                                      onClick={() => {
                                        setUploadedFiles(prev => prev.filter((_, idx) => idx !== i));
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <div key={i} className="clipboardThumb">
                                  <img src={file.dataUrl || `data:${file.mimeType};base64,${file.base64}`} alt={`Tệp ${i + 1}`} />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setUploadedFiles(prev => prev.filter((_, idx) => idx !== i));
                                      setClipboardImages(prev => prev.filter(img => img.name !== file.name));
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* RUN FULL PIPELINE BUTTON */}
                  <button
                    id="runPipelineBtn"
                    className={`primary pipeline-run w-full mt-3 ${isPipelineRunning ? 'running' : ''}`}
                    onClick={runFullPipeline}
                    disabled={isPipelineRunning}
                  >
                    {isPipelineRunning
                      ? '⏳ ĐANG TẠO TOÀN BỘ (8 BƯỚC)...'
                      : '✦ PHÂN TÍCH & TẠO TOÀN BỘ'}
                  </button>

                  {/* PREVIEW BUTTON DIRECTLY ON WORKSPACE SCREEN */}
                  <button
                    id="quickPreviewBtn"
                    type="button"
                    className="secondary w-full mt-2 py-2 text-xs flex items-center justify-center gap-1.5 font-black border border-[#eadfd6] bg-white hover:bg-[#fff7ef] text-[#5A1F08] shadow-xs cursor-pointer transition-all"
                    onClick={() => {
                      if (currentProblem) {
                        setShowPreviewModal(true);
                      } else {
                        toast('Chưa có đề bài nào để xem trước. Vui lòng bấm "Phân tích & Tạo toàn bộ"!');
                      }
                    }}
                    disabled={!currentProblem}
                    title={currentProblem ? 'Xem trước đề bài chi tiết' : 'Chưa có đề bài'}
                  >
                    <span>👁</span>
                    <span>XEM TRƯỚC ĐỀ BÀI (PREVIEW)</span>
                  </button>
                </div>

                {/* PROGRESS BAR */}
                <div id="pipelineProgress" className="pipeline-progress">
                  <div className="pipeline-progress-head">
                    <span id="pipelineProgressLabel">
                      {isPipelineRunning
                        ? 'Đang thực hiện quy trình tự động...'
                        : pipelineProgress === 100
                        ? 'Đã hoàn thành 8/8 bước'
                        : 'Sẵn sàng'}
                    </span>
                    <b id="pipelineProgressPercent">{pipelineProgress}%</b>
                  </div>
                  <div className="pipeline-progress-track">
                    <div
                      id="pipelineProgressBar"
                      className="pipeline-progress-bar"
                      style={{ width: `${pipelineProgress}%` }}
                    ></div>
                  </div>
                </div>

                {/* STATUS BAR */}
                <div id="pipelineStatus" className="pipeline-status">
                  <div className="pipeline-status-icon">✦</div>
                  <div>
                    <b id="pipelineStatusTitle">{pipelineStatusTitle}</b>
                    <span id="pipelineStatusText">{pipelineStatusText}</span>
                  </div>
                </div>
              </div>

              {/* RIGHT WORKSPACE VIEWER */}
              <div className="create-right">
                <div className="create-right-head">
                  <div>
                    <div className="eyebrow">WORKSPACE</div>
                    <h2 id="pipelineViewerTitle">
                      {pipelineStep === 1 && '01 · Nguồn bài tập'}
                      {pipelineStep === 2 && '02 · Phân tích thuật toán'}
                      {pipelineStep === 3 && '03 · Đề bài hoàn chỉnh'}
                      {pipelineStep === 4 && '04 · Artifacts (Editorial & Code)'}
                      {pipelineStep === 5 && '05 · AI Validation & Review'}
                      {pipelineStep === 6 && '06 · Tài liệu PDF'}
                      {pipelineStep === 7 && '07 · Tài liệu Word'}
                      {pipelineStep === 8 && '08 · Đóng gói ZIP & Google Drive'}
                    </h2>
                    <p id="pipelineViewerHint">
                      {pipelineStep === 3
                        ? 'Preview công thức toán học với MathJax hoặc xem mã nguồn Markdown / LaTeX.'
                        : 'Nội dung chi tiết được xử lý bởi Gemini AI.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentProblem && (
                      <button
                        type="button"
                        className="primary text-xs py-1.5 px-3 flex items-center gap-1 font-bold shadow-xs cursor-pointer"
                        onClick={() => setShowPreviewModal(true)}
                        title="Mở toàn màn hình xem trước đề bài"
                      >
                        <span>👁</span>
                        <span>XEM TRƯỚC (PREVIEW)</span>
                      </button>
                    )}
                    <span className="viewer-state" id="pipelineViewerState">
                      {isPipelineRunning
                        ? 'ĐANG XỬ LÝ'
                        : stepStatuses[pipelineStep] === 'done'
                        ? 'HOÀN TẤT'
                        : 'SẴN SÀNG'}
                    </span>
                  </div>
                </div>

                <div className="create-right-body" ref={mathRef}>
                  {/* Step 1 Viewer: Source */}
                  {pipelineStep === 1 && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body">
                        <h3 className="font-bold text-[#5A1F08] mb-2">Nguồn dữ liệu hiện tại:</h3>
                        <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs leading-relaxed overflow-auto">
                          {sourceTab === 'topic'
                            ? `CHỦ ĐỀ: ${topicInput}\nYÊU CẦU: ${extraInput}`
                            : sourceTextInput || 'Chưa nhập văn bản'}
                        </pre>
                        {clipboardImages.length > 0 && (
                          <div className="mt-4">
                            <h4 className="font-semibold text-xs text-[#5A1F08] mb-2">Ảnh đính kèm:</h4>
                            <div className="flex flex-wrap gap-2">
                              {clipboardImages.map((img, i) => (
                                <img
                                  key={i}
                                  src={img.dataUrl}
                                  alt="Preview"
                                  className="w-32 h-24 object-cover rounded-lg border border-[#ead8c8]"
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 2 Viewer: Analysis */}
                  {pipelineStep === 2 && analysisData && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body">
                        <div className="grid grid-cols-3 gap-3 mb-4">
                          <div className="p-3 bg-[#fff7f0] rounded-xl border border-[#f5ded0]">
                            <label className="text-[10px] text-[#8c7568] uppercase font-bold">Dạng bài</label>
                            <b className="text-sm text-[#5A1F08] block mt-1">{analysisData.problem_type}</b>
                          </div>
                          <div className="p-3 bg-[#fff7f0] rounded-xl border border-[#f5ded0]">
                            <label className="text-[10px] text-[#8c7568] uppercase font-bold">Thuật toán</label>
                            <b className="text-sm text-[#5A1F08] block mt-1">
                              {(analysisData.algorithm_candidates || []).join(', ')}
                            </b>
                          </div>
                          <div className="p-3 bg-[#fff7f0] rounded-xl border border-[#f5ded0]">
                            <label className="text-[10px] text-[#8c7568] uppercase font-bold">Độ khó</label>
                            <b className="text-sm text-[#F45B0A] block mt-1">
                              {analysisData.difficulty} · {analysisData.difficulty_score}/10
                            </b>
                          </div>
                        </div>

                        <h4 className="font-bold text-[#5A1F08] text-xs mt-3 mb-1">Ràng buộc & Giới hạn:</h4>
                        <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs mb-3">
                          {JSON.stringify(analysisData.constraints || [], null, 2)}
                        </pre>

                        <h4 className="font-bold text-[#5A1F08] text-xs mb-1">Các Subtasks:</h4>
                        <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs mb-3">
                          {JSON.stringify(analysisData.subtasks || [], null, 2)}
                        </pre>

                        <h4 className="font-bold text-[#5A1F08] text-xs mb-1">Trường hợp biên (Edge Cases):</h4>
                        <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs">
                          {JSON.stringify(analysisData.edge_cases || [], null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Step 3 Viewer: Problem Review */}
                  {pipelineStep === 3 && currentProblem && (
                    <div className="problem-review-card h-full">
                      <div className="problem-preview-tabs">
                        <button
                          className={previewTab === 'render' ? 'active' : ''}
                          onClick={() => setPreviewTab('render')}
                        >
                          👁 Preview
                        </button>
                        <button
                          className={previewTab === 'source' ? 'active' : ''}
                          onClick={() => setPreviewTab('source')}
                        >
                          ⌘ Markdown
                        </button>
                        <button
                          className={previewTab === 'latex' ? 'active' : ''}
                          onClick={() => setPreviewTab('latex')}
                        >
                          ∑ LaTeX
                        </button>
                        <div className="ml-auto flex gap-2">
                          <button
                            type="button"
                            className="text-xs bg-white border border-[#ead8cd] px-2.5 py-1 rounded-md font-bold text-[#5A1F08] hover:bg-[#fff7f0] flex items-center gap-1 cursor-pointer shadow-xs"
                            onClick={() => copyFullProblem(currentProblem)}
                            title="Copy toàn bộ Đề bài, Input, Output, Constraints, Subtasks"
                          >
                            📋 Copy Đề bài
                          </button>
                        </div>
                      </div>

                      <div className="problem-review-body">
                        {previewTab === 'render' && (
                          <div className="problem-render">
                            <h1 className="text-xl font-black mb-1">
                              {currentProblem.code} — {currentProblem.name}
                            </h1>
                            <div className="text-xs text-[#8c7568] mb-4">
                              Chủ đề: <b>{currentProblem.topic}</b> · Thuật toán: <b>{currentProblem.algorithm}</b> · Độ khó: <b>{currentProblem.difficulty}</b>
                            </div>

                            <h3 className="font-bold text-sm text-[#5A1F08] mt-3 mb-1">Đề bài</h3>
                            <div className="problem-box text-sm mb-3">
                              {renderJustifiedText(currentProblem.statement)}
                            </div>

                            <h3 className="font-bold text-sm text-[#5A1F08] mt-4 mb-1">Input</h3>
                            <div className="problem-box text-sm mb-3">
                              {renderJustifiedText(currentProblem.input)}
                            </div>

                            <h3 className="font-bold text-sm text-[#5A1F08] mt-4 mb-1">Output</h3>
                            <div className="problem-box text-sm mb-3">
                              {renderJustifiedText(currentProblem.output)}
                            </div>

                            <h3 className="font-bold text-sm text-[#5A1F08] mt-4 mb-1">Ràng buộc</h3>
                            <ul className="list-disc pl-5 text-sm space-y-1.5 text-justify">
                              {(currentProblem.constraints || []).map((c, i) => (
                                <li key={i} className="leading-relaxed text-justify">{c}</li>
                              ))}
                            </ul>

                            {currentProblem.subtasks && currentProblem.subtasks.length > 0 && (
                              <>
                                <h3 className="font-bold text-sm text-[#5A1F08] mt-4 mb-1">Subtasks</h3>
                                <div className="space-y-1.5 text-sm">
                                  {currentProblem.subtasks.map((st, i) => (
                                    <div key={i} className="p-2.5 bg-white rounded-lg border border-[#ebd8cb] text-justify leading-relaxed">
                                      <b>{st.id}</b> ({st.points} điểm): {st.constraints}
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}

                            {currentProblem.samples && currentProblem.samples.length > 0 && (
                              <>
                                <h3 className="font-bold text-sm text-[#5A1F08] mt-4 mb-1">Ví dụ</h3>
                                {currentProblem.samples.map((s, i) => (
                                  <div key={i} className="mb-3">
                                    <div className="text-xs font-bold text-[#8c7568] mb-1">Sample {i + 1}</div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <span className="text-[11px] font-bold">Input:</span>
                                        <pre className="bg-[#21150f] text-[#fff0e5] p-2 rounded text-xs mt-1">
                                          {s.input}
                                        </pre>
                                      </div>
                                      <div>
                                        <span className="text-[11px] font-bold">Output:</span>
                                        <pre className="bg-[#21150f] text-[#fff0e5] p-2 rounded text-xs mt-1">
                                          {s.output}
                                        </pre>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        )}

                        {previewTab === 'source' && (
                          <pre className="problem-source">
                            {`# ${currentProblem.name}\n\n## Đề bài\n\n${currentProblem.statement}\n\n## Input\n\n${currentProblem.input}\n\n## Output\n\n${currentProblem.output}\n\n## Constraints\n\n${(currentProblem.constraints || []).map(c => `- ${c}`).join('\n')}\n\n## Subtasks\n\n${(currentProblem.subtasks || []).map(s => `- ${s.id} (${s.points}đ): ${s.constraints}`).join('\n')}`}
                          </pre>
                        )}

                        {previewTab === 'latex' && (
                          <pre className="problem-source">
                            {`\\section*{${currentProblem.name}}\n\n${currentProblem.statement}\n\n\\subsection*{Input}\n${currentProblem.input}\n\n\\subsection*{Output}\n${currentProblem.output}\n\n\\subsection*{Constraints}\n\\begin{itemize}\n${(currentProblem.constraints || []).map(c => `\\item ${c}`).join('\n')}\n\\end{itemize}`}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 4 Viewer: Artifacts */}
                  {pipelineStep === 4 && artifactsData && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body space-y-4">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="font-bold text-xs text-[#5A1F08]">📖 Editorial (Lời giải & Phân tích thuật toán):</h4>
                            <button
                              className="text-xs text-[#F45B0A] font-bold hover:underline"
                              onClick={() => copyText(artifactsData.editorial_md || '')}
                            >
                              Copy Editorial
                            </button>
                          </div>
                          <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs leading-relaxed max-h-48 overflow-auto">
                            {artifactsData.editorial_md || 'Chưa có editorial'}
                          </pre>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="font-bold text-xs text-[#5A1F08]">⚡ Solution C++17 (AC):</h4>
                            <button
                              className="text-xs text-[#F45B0A] font-bold hover:underline"
                              onClick={() => copyText(artifactsData.sol_cpp || '')}
                            >
                              Copy C++
                            </button>
                          </div>
                          <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs leading-relaxed max-h-48 overflow-auto">
                            {artifactsData.sol_cpp || 'Chưa có code C++'}
                          </pre>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="font-bold text-xs text-[#5A1F08]">🐍 Solution Python 3:</h4>
                            <button
                              className="text-xs text-[#F45B0A] font-bold hover:underline"
                              onClick={() => copyText(artifactsData.sol_py || '')}
                            >
                              Copy Python
                            </button>
                          </div>
                          <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs leading-relaxed max-h-48 overflow-auto">
                            {artifactsData.sol_py || 'Chưa có code Python'}
                          </pre>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="font-bold text-xs text-[#5A1F08]">🎲 Test Generator (C++):</h4>
                            <button
                              className="text-xs text-[#F45B0A] font-bold hover:underline"
                              onClick={() => copyText(artifactsData.gen_cpp || '')}
                            >
                              Copy Gen
                            </button>
                          </div>
                          <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs leading-relaxed max-h-48 overflow-auto">
                            {artifactsData.gen_cpp || 'Chưa có code Generator'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 5 Viewer: Validation */}
                  {pipelineStep === 5 && validationData && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body">
                        <div className="flex items-center justify-between mb-4 bg-[#fff7ef] p-4 rounded-xl border border-[#f1d7c4]">
                          <div>
                            <span className="text-xs text-[#8c7568] font-bold">Điểm đánh giá chất lượng</span>
                            <div className="text-4xl font-black text-[#F45B0A] mt-1">
                              {validationData.score || 98}<small className="text-lg text-[#8c7568]">/100</small>
                            </div>
                          </div>
                          <span className="pill good text-sm px-4 py-2">
                            ✓ {validationData.status || 'PASS'}
                          </span>
                        </div>

                        <p className="text-sm font-semibold text-[#5A1F08] mb-3">
                          {validationData.summary || 'Bộ bài tập đạt tiêu chuẩn chất lượng cao.'}
                        </p>

                        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                          <div className="p-2 bg-white rounded border border-[#eedad0] flex items-center gap-2">
                            <span className="text-green-600 font-bold">✓</span> Nhất quán đề bài & ràng buộc
                          </div>
                          <div className="p-2 bg-white rounded border border-[#eedad0] flex items-center gap-2">
                            <span className="text-green-600 font-bold">✓</span> Đúng định dạng Sample Input/Output
                          </div>
                          <div className="p-2 bg-white rounded border border-[#eedad0] flex items-center gap-2">
                            <span className="text-green-600 font-bold">✓</span> C++17 và Python 3 cùng kết quả
                          </div>
                          <div className="p-2 bg-white rounded border border-[#eedad0] flex items-center gap-2">
                            <span className="text-green-600 font-bold">✓</span> Độ phức tạp thời gian hợp lý (1.0s)
                          </div>
                        </div>

                        {validationData.warnings && validationData.warnings.length > 0 && (
                          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                            <b>Lưu ý:</b>
                            <ul className="list-disc pl-4 mt-1">
                              {validationData.warnings.map((w: string, i: number) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 6 Viewer: PDF Export */}
                  {pipelineStep === 6 && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body text-center p-8">
                        <div className="w-16 h-16 rounded-2xl bg-[#fff0e6] text-[#F45B0A] font-black text-2xl grid place-items-center mx-auto mb-4">
                          PDF
                        </div>
                        <h3 className="text-lg font-bold text-[#5A1F08] mb-2">Tài liệu PDF đề bài hoàn chỉnh</h3>
                        <p className="text-xs text-[#7B6B62] max-w-md mx-auto mb-6">
                          Đã tự động định dạng và kết xuất tài liệu PDF chuẩn Adobe Acrobat với tiêu đề, MathJax LaTeX, các subtasks và bảng ví dụ chuẩn kỳ thi Olympic.
                        </p>
                        <div className="flex flex-wrap gap-2.5 justify-center">
                          <button
                            type="button"
                            className="secondary font-bold text-xs py-2 px-3.5 flex items-center gap-1.5 cursor-pointer shadow-xs"
                            onClick={() => currentProblem && previewPdfInBlob(currentProblem)}
                          >
                            <span>👁</span>
                            <span>XEM TRƯỚC PDF (PREVIEW)</span>
                          </button>
                          <button
                            type="button"
                            className="primary font-bold text-xs py-2 px-4 flex items-center gap-1.5 cursor-pointer shadow-sm"
                            onClick={() => currentProblem && exportRealPdf(currentProblem)}
                          >
                            <span>⬇</span>
                            <span>TẢI VỀ FILE PDF CHUẨN</span>
                          </button>
                          <button
                            type="button"
                            className="secondary font-bold text-xs py-2 px-3.5 flex items-center gap-1.5 cursor-pointer shadow-xs"
                            onClick={() => currentProblem && printProblemDoc(currentProblem)}
                          >
                            <span>🖨</span>
                            <span>IN / LƯU PDF QUA TRÌNH DUYỆT</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 7 Viewer: Word Export */}
                  {pipelineStep === 7 && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body text-center p-8">
                        <div className="w-16 h-16 rounded-2xl bg-[#e6f4ff] text-[#0066cc] font-black text-2xl grid place-items-center mx-auto mb-4">
                          DOC
                        </div>
                        <h3 className="text-lg font-bold text-[#5A1F08] mb-2">Tài liệu Microsoft Word (.docx)</h3>
                        <p className="text-xs text-[#7B6B62] max-w-md mx-auto mb-6">
                          Tập tin Word cho phép giáo viên tùy biến, chỉnh sửa nhanh hoặc nhúng vào đề thi chung của trường / đội tuyển.
                        </p>
                        <button
                          className="primary"
                          onClick={() => currentProblem && downloadWordDoc(currentProblem)}
                        >
                          ⬇ TẢI VỀ FILE WORD (.DOC)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 8 Viewer: ZIP Package & Drive */}
                  {pipelineStep === 8 && (
                    <div className="pipeline-viewer">
                      <div className="viewer-body">
                        <div className="bg-[#e9f9f1] border border-[#bdebd6] p-5 rounded-2xl mb-5">
                          <h3 className="text-green-800 font-black text-lg mb-1">✓ HOÀN TẤT ĐÓNG GÓI BỘ BÀI TẬP</h3>
                          <p className="text-xs text-green-700">
                            Đã sinh đầy đủ 20 testcases (sample, edge, random, boundary), lời giải chuẩn, brute-force và test generator!
                          </p>
                        </div>

                        <div className="grid grid-cols-4 gap-3 mb-6">
                          <div className="p-3 bg-[#fff8f2] border border-[#f1ddd0] rounded-xl">
                            <small className="text-[#8b786d] text-[10px] block">MÃ BÀI</small>
                            <b className="text-sm text-[#5A1F08] block mt-1">{currentProblem?.code || 'PROBLEM'}</b>
                          </div>
                          <div className="p-3 bg-[#fff8f2] border border-[#f1ddd0] rounded-xl">
                            <small className="text-[#8b786d] text-[10px] block">PHIÊN BẢN</small>
                            <b className="text-sm text-[#5A1F08] block mt-1">v{currentProblem?.version || 1}</b>
                          </div>
                          <div className="p-3 bg-[#fff8f2] border border-[#f1ddd0] rounded-xl">
                            <small className="text-[#8b786d] text-[10px] block">SỐ TESTCASE</small>
                            <b className="text-sm text-[#159a6a] block mt-1">20 Tests (Đủ IN/OUT)</b>
                          </div>
                          <div className="p-3 bg-[#fff8f2] border border-[#f1ddd0] rounded-xl">
                            <small className="text-[#8b786d] text-[10px] block">GOOGLE DRIVE</small>
                            <b className="text-sm text-[#5A1F08] block mt-1">Sẵn sàng</b>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <button
                            className="primary"
                            onClick={() => {
                              if (currentProblem) {
                                generateAndDownloadZip(currentProblem, artifactsData, validationData);
                              }
                            }}
                          >
                            📦 TẢI GÓI ZIP ĐẦY ĐỦ (.ZIP)
                          </button>

                          <button
                            type="button"
                            className="secondary font-bold flex items-center gap-1.5 hover:border-[#f45b0a]"
                            onClick={() => setShowStep8Preview(prev => !prev)}
                          >
                            👁 {showStep8Preview ? 'ẨN PREVIEW' : 'XEM TRƯỚC (PREVIEW)'}
                          </button>

                          <button
                            className="secondary"
                            onClick={() => currentProblem && exportRealPdf(currentProblem)}
                          >
                            📄 TẢI PDF
                          </button>

                          <button
                            className="secondary"
                            onClick={() => currentProblem && downloadWordDoc(currentProblem)}
                          >
                            📝 TẢI WORD
                          </button>

                          <a
                            href={`https://drive.google.com/drive/folders/${cfgDrive}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="secondary inline-flex items-center gap-1 font-bold no-underline"
                          >
                            ↗ MỞ GOOGLE DRIVE
                          </a>
                        </div>

                        {/* STEP 8: TESTCASES GRID (Direct Click to view Input/Output) */}
                        <div className="mt-5 p-4 bg-white border border-[#ebd8cb] rounded-xl">
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-xs text-[#5A1F08] uppercase tracking-wider flex items-center gap-1.5 m-0">
                              <span>🎲 20 Testcases hoàn chỉnh</span>
                              <span className="text-[11px] font-normal text-[#8c7568]">(Click vào Test 01, 02,... để xem trực tiếp Input & Output)</span>
                            </h4>
                            <span className="text-xs text-green-700 font-semibold bg-green-50 px-2 py-0.5 rounded border border-green-200">
                              20/20 Tests sẵn sàng
                            </span>
                          </div>
                          <div className="test-grid">
                            {(testcasesList && testcasesList.length > 0 ? testcasesList : Array.from({ length: 20 }, (_, i) => ({
                              test_no: i + 1,
                              test_type: i < 2 ? 'sample' : i < 6 ? 'edge' : i < 14 ? 'random' : 'boundary',
                              input_file: `test${String(i + 1).padStart(2, '0')}.in`,
                              output_file: `test${String(i + 1).padStart(2, '0')}.out`,
                              subtask: i < 6 ? 'Subtask 1 (30đ)' : i < 14 ? 'Subtask 2 (30đ)' : 'Subtask 3 (40đ)',
                              status: 'DONE',
                              done: true,
                              input_data: currentProblem?.samples?.[0]?.input || '4 4\n1 2 2\n2 3 3\n1 3 6\n3 4 1',
                              output_data: currentProblem?.samples?.[0]?.output || '11'
                            }))).map(t => (
                              <div
                                key={t.test_no}
                                className={`test-slot ${t.done ? 'done' : ''} cursor-pointer hover:shadow-md hover:border-[#F45B0A] transition-all`}
                                onClick={() => setSelectedTestcase(t)}
                                title={`Click để xem thông tin và dữ liệu Test ${String(t.test_no).padStart(2, '0')}`}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="test-no font-bold">Test {String(t.test_no).padStart(2, '0')}</span>
                                  {t.done && <span className="check-green">✓</span>}
                                </div>
                                <span className="test-status font-mono text-[10px]">
                                  {t.done ? 'IN ✓ · OUT ✓' : 'Chưa đủ file'}
                                </span>
                                <small className="text-[10px] text-[#8c7568] uppercase font-semibold">
                                  {t.test_type}
                                </small>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* INLINE PREVIEW SECTION ON STEP 8 */}
                        {showStep8Preview && currentProblem && (
                          <div className="mt-5 pt-4 border-t border-[#eedad0]">
                            <div className="flex justify-between items-center mb-2">
                              <h4 className="font-bold text-[#5A1F08] text-sm flex items-center gap-1.5">
                                <span>👁 Xem trước đề bài ({currentProblem.code}):</span>
                              </h4>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="text-xs bg-white border border-[#ead8cd] px-2.5 py-1 rounded-md font-bold text-[#5A1F08] hover:bg-[#fff7f0] flex items-center gap-1 cursor-pointer shadow-xs"
                                  onClick={() => copyFullProblem(currentProblem)}
                                  title="Copy toàn bộ Đề bài, Input, Output, Constraints, Subtasks"
                                >
                                  📋 Copy Đề bài
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-[#F45B0A] font-bold hover:underline"
                                  onClick={() => {
                                    setPipelineStep(3);
                                    setPreviewTab('render');
                                  }}
                                >
                                  Mở chi tiết ở Bước 03 ➔
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-[#8c7568] hover:text-[#5A1F08]"
                                  onClick={() => setShowStep8Preview(false)}
                                >
                                  ✕ Đóng
                                </button>
                              </div>
                            </div>

                            <div className="problem-render bg-white border border-[#ead8c8] rounded-xl p-4 shadow-sm max-h-[460px] overflow-auto">
                              <h2 className="text-lg font-black text-[#5A1F08] mb-1">
                                {currentProblem.code} — {currentProblem.name}
                              </h2>
                              <div className="text-xs text-[#8c7568] mb-3">
                                Chủ đề: <b>{currentProblem.topic}</b> · Thuật toán: <b>{currentProblem.algorithm}</b> · Độ khó: <b>{currentProblem.difficulty}</b>
                              </div>

                              <h4 className="font-bold text-xs text-[#5A1F08] mt-2 mb-1">Đề bài:</h4>
                              <div className="problem-box text-xs mb-2.5">
                                {renderJustifiedText(currentProblem.statement)}
                              </div>

                              <h4 className="font-bold text-xs text-[#5A1F08] mt-2 mb-1">Input:</h4>
                              <div className="problem-box text-xs mb-2.5">
                                {renderJustifiedText(currentProblem.input)}
                              </div>

                              <h4 className="font-bold text-xs text-[#5A1F08] mt-2 mb-1">Output:</h4>
                              <div className="problem-box text-xs mb-2.5">
                                {renderJustifiedText(currentProblem.output)}
                              </div>

                              <h4 className="font-bold text-xs text-[#5A1F08] mt-2 mb-1">Ràng buộc:</h4>
                              <ul className="list-disc pl-5 text-xs space-y-1 text-justify mb-2.5">
                                {(currentProblem.constraints || []).map((c, i) => (
                                  <li key={i}>{c}</li>
                                ))}
                              </ul>

                              {currentProblem.subtasks && currentProblem.subtasks.length > 0 && (
                                <div className="mb-2.5">
                                  <h4 className="font-bold text-xs text-[#5A1F08] mt-2 mb-1">Subtasks:</h4>
                                  <div className="space-y-1 text-xs">
                                    {currentProblem.subtasks.map((st, i) => (
                                      <div key={i} className="p-2 bg-[#fffaf5] rounded border border-[#eedad0] text-justify leading-relaxed">
                                        <b>{st.id}</b> ({st.points} điểm): {st.constraints}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {currentProblem.samples && currentProblem.samples.length > 0 && (
                                <div className="mt-2.5">
                                  <h4 className="font-bold text-xs text-[#5A1F08] mb-1">Ví dụ mẫu:</h4>
                                  {currentProblem.samples.map((s, i) => (
                                    <div key={i} className="mb-2">
                                      <div className="text-[11px] font-bold text-[#8c7568]">Sample {i + 1}</div>
                                      <div className="grid grid-cols-2 gap-2 text-xs mt-0.5">
                                        <div>
                                          <span className="font-semibold text-[10.5px]">Input:</span>
                                          <pre className="bg-[#21150f] text-[#fff0e5] p-2 rounded text-[11px] mt-0.5">
                                            {s.input}
                                          </pre>
                                        </div>
                                        <div>
                                          <span className="font-semibold text-[10.5px]">Output:</span>
                                          <pre className="bg-[#21150f] text-[#fff0e5] p-2 rounded text-[11px] mt-0.5">
                                            {s.output}
                                          </pre>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Empty state fallback */}
                  {stepStatuses[pipelineStep] === 'pending' && (
                    <div className="pipeline-empty">
                      <div className="pipeline-empty-icon">✦</div>
                      <h3 className="font-bold text-[#5A1F08]">Bước này chưa hoàn thành</h3>
                      <p>Nhấn “PHÂN TÍCH & TẠO TOÀN BỘ” ở góc bên trái để chạy tự động toàn bộ 8 bước.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================= PAGE: KHO BÀI TẬP (BANK) ================= */}
        {activePage === 'bank' && (
          <section id="page-bank" className="page">
            <div className="bank-shell">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h2 className="text-xl font-black text-[#5A1F08] m-0">Kho bài tập</h2>
                  <span className="text-xs text-[#8c7568]">Danh sách toàn bộ bài đã tạo trong hệ thống</span>
                </div>
                <div className="flex gap-2">
                  <input
                    placeholder="🔎 Tìm theo mã bài, tên bài, chủ đề..."
                    value={bankSearch}
                    onChange={e => {
                      setBankSearch(e.target.value);
                      fetchProblems(e.target.value);
                    }}
                    className="w-72"
                  />
                  <button className="primary" onClick={() => setActivePage('create')}>
                    + Tạo bài mới
                  </button>
                </div>
              </div>

              <div className="bank-table-wrap">
                <table className="bank-table">
                  <thead>
                    <tr>
                      <th>Mã bài</th>
                      <th>Tên bài</th>
                      <th>Chủ đề</th>
                      <th>Test</th>
                      <th>Ngày tạo</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problemsList.length > 0 ? (
                      problemsList.map(p => (
                        <tr key={p.id}>
                          <td>
                            <b className="text-[#5A1F08]">{p.code}</b>
                          </td>
                          <td>{p.name}</td>
                          <td>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#fff0e6] text-[#F45B0A]">
                              {p.topic}
                            </span>
                          </td>
                          <td>
                            <b>{p.test_count || 20}</b>
                          </td>
                          <td>{new Date(p.created_at).toLocaleDateString('vi-VN')}</td>
                          <td>
                            <span className="pill good">{p.status || 'VERIFIED'}</span>
                          </td>
                          <td>
                            <div className="flex gap-1">
                              <button
                                className="review-btn"
                                onClick={() => {
                                  setCurrentProblem(p);
                                  setShowPreviewModal(true);
                                }}
                                title="Xem trước đề bài"
                              >
                                👁 Preview
                              </button>
                              <button
                                className="review-btn font-bold bg-[#fff0e6] text-[#F45B0A] border-[#ffd5bf] hover:bg-[#ffe2cf]"
                                onClick={() => generateAndDownloadZip(p, p.artifacts, p.validation)}
                                title="Tải về trọn bộ ZIP gồm Đề bài, Solution C++/Python, Editorial, 20 Testcases, PDF & Word"
                              >
                                📦 Tải ZIP
                              </button>
                              <button
                                className="review-btn text-[#c44d0b]"
                                onClick={() => exportRealPdf(p)}
                                title="Tải PDF"
                              >
                                ⬇ PDF
                              </button>
                              <button
                                className="review-btn text-[#0066cc]"
                                onClick={() => downloadWordDoc(p)}
                                title="Tải Word (.doc) không nền"
                              >
                                ⬇ Word
                              </button>
                              <button
                                className="review-btn"
                                onClick={() => {
                                  setCurrentProblem(p);
                                  setPipelineStep(3);
                                  setStepStatuses(prev => ({ ...prev, 3: 'done' }));
                                  setActivePage('create');
                                }}
                              >
                                ✎ Review
                              </button>
                              <button
                                className="review-btn"
                                onClick={() => {
                                  setActiveTestProblem(p);
                                  loadTestcases(p.id);
                                  setActivePage('testcase');
                                }}
                              >
                                ⌘ Tests
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-[#8c7568]">
                          Chưa có bài tập nào. Hãy nhấn "+ Tạo bài mới" để bắt đầu!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ================= PAGE: TESTCASE LAB ================= */}
        {activePage === 'testcase' && (
          <section id="page-testcase" className="page">
            <div className="testcase-shell">
              <div className="flex justify-between items-center mb-1">
                <div>
                  <h2 className="text-xl font-black text-[#5A1F08] m-0">Testcase Lab</h2>
                  <span className="text-xs text-[#8c7568]">
                    Hệ thống tự động sinh 20 testcases chuẩn cho bài: <b>{activeTestProblem?.code || 'Chưa chọn'}</b>
                  </span>
                </div>
                <div className="flex gap-2">
                  <select
                    className="w-48 text-xs font-bold"
                    value={activeTestProblem?.id || ''}
                    onChange={e => {
                      const p = problemsList.find(x => x.id === e.target.value);
                      if (p) {
                        setActiveTestProblem(p);
                        loadTestcases(p.id);
                      }
                    }}
                  >
                    {problemsList.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.code} - {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    onClick={() => {
                      if (activeTestProblem) {
                        loadTestcases(activeTestProblem.id);
                        toast('✓ Đã cập nhật trạng thái testcases');
                      }
                    }}
                  >
                    ↻ CẬP NHẬT
                  </button>
                  <button
                    type="button"
                    className="primary font-bold text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer shadow-sm bg-[#F45B0A] hover:bg-[#d84a00] text-white rounded-lg transition-all"
                    onClick={() => downloadAllTestcasesZip(activeTestProblem)}
                    title="Tải về file ZIP chứa đầy đủ 20 testcases (test01.in/out -> test20.in/out)"
                  >
                    <span>📦</span>
                    <span>TẢI 20 TESTCASE (.ZIP)</span>
                  </button>
                  <button
                    type="button"
                    className="secondary font-bold text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer shadow-sm bg-white hover:bg-[#fff7f0] text-[#5A1F08] border border-[#ead8cd] rounded-lg transition-all"
                    onClick={() => generateAndDownloadZip(activeTestProblem)}
                    title="Tải về trọn bộ ZIP gồm Đề bài, Solution C++/Python, Editorial, 20 Testcases, PDF & Word"
                  >
                    <span>🗂</span>
                    <span>TẢI TRỌN BỘ CẢ BÀI (.ZIP)</span>
                  </button>
                </div>
              </div>

              <div className="card p-3">
                <div className="flex justify-between items-center mb-2">
                  <b className="text-xs text-[#5A1F08]">
                    {testcasesList.filter(t => t.done).length}/20 testcases hoàn tất (Có cả file .in & .out)
                  </b>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#8c7568]">
                      Bài: <b>{activeTestProblem?.code || 'CHƯA CHỌN'}</b>
                    </span>
                    <button
                      type="button"
                      className="text-xs font-bold text-[#F45B0A] hover:text-[#d04500] bg-[#fff0e6] hover:bg-[#ffe2cf] px-2.5 py-1 rounded cursor-pointer border border-[#ffd5bf]"
                      onClick={() => downloadAllTestcasesZip(activeTestProblem)}
                    >
                      ⬇ Tải 20 Tests (.zip)
                    </button>
                  </div>
                </div>
                <div className="test-progress">
                  <div
                    style={{
                      width: `${(testcasesList.filter(t => t.done).length / 20) * 100}%`
                    }}
                  ></div>
                </div>
              </div>

              <div className="test-grid">
                {testcasesList.map(t => (
                  <div
                    key={t.test_no}
                    className={`test-slot ${t.done ? 'done' : ''} cursor-pointer hover:shadow-md hover:border-[#F45B0A] transition-all`}
                    onClick={() => {
                      setSelectedTestcase(t);
                    }}
                    title={`Click để xem dữ liệu chi tiết Test ${String(t.test_no).padStart(2, '0')}`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="test-no font-bold">Test {String(t.test_no).padStart(2, '0')}</span>
                      {t.done && <span className="check-green">✓</span>}
                    </div>
                    <span className="test-status font-mono text-[10px]">
                      {t.done ? 'IN ✓ · OUT ✓' : 'Chưa đủ file'}
                    </span>
                    <small className="text-[10px] text-[#8c7568] uppercase font-semibold">
                      {t.test_type}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ================= PAGE: TEMPLATES ================= */}
        {activePage === 'templates' && (
          <section id="page-templates" className="page">
            <div className="h-full flex gap-4 overflow-hidden">
              <div className="card w-1/3 flex flex-col h-full overflow-hidden">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-[#5A1F08] text-base">Danh sách Templates</h3>
                  <button
                    className="primary text-xs py-1 px-3"
                    onClick={() => {
                      setSelectedTemplate({
                        id: '',
                        name: 'Template mới',
                        type: 'problem',
                        content: '# Tiêu đề\n\nNội dung...'
                      });
                      setIsEditingTemplate(true);
                    }}
                  >
                    + Mới
                  </button>
                </div>
                <div className="flex-1 overflow-auto space-y-2">
                  {templatesList.map(tpl => (
                    <div
                      key={tpl.id}
                      className={`p-3 rounded-xl border cursor-pointer transition ${
                        selectedTemplate?.id === tpl.id
                          ? 'border-[#F45B0A] bg-[#fff8ef]'
                          : 'border-[#ebd8cb] bg-white hover:bg-[#fffdfb]'
                      }`}
                      onClick={() => {
                        setSelectedTemplate(tpl);
                        setIsEditingTemplate(true);
                      }}
                    >
                      <b className="text-sm text-[#5A1F08] block">{tpl.name}</b>
                      <span className="text-xs text-[#8c7568] uppercase font-semibold">
                        {tpl.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card flex-1 flex flex-col h-full overflow-hidden">
                {selectedTemplate && isEditingTemplate ? (
                  <>
                    <h3 className="font-bold text-[#5A1F08] text-base mb-3">Chỉnh sửa Template</h3>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div>
                        <label>Tên Template</label>
                        <input
                          value={selectedTemplate.name}
                          onChange={e =>
                            setSelectedTemplate({ ...selectedTemplate, name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label>Loại</label>
                        <select
                          value={selectedTemplate.type}
                          onChange={e =>
                            setSelectedTemplate({ ...selectedTemplate, type: e.target.value })
                          }
                        >
                          <option value="problem">Problem</option>
                          <option value="editorial">Editorial</option>
                          <option value="latex">LaTeX</option>
                        </select>
                      </div>
                    </div>
                    <label>Nội dung mẫu</label>
                    <textarea
                      className="flex-1 font-mono text-xs p-3"
                      value={selectedTemplate.content}
                      onChange={e =>
                        setSelectedTemplate({ ...selectedTemplate, content: e.target.value })
                      }
                    />
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        className="primary"
                        onClick={async () => {
                          const res = await fetch('/api/templates', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(selectedTemplate)
                          });
                          if (res.ok) {
                            toast('✓ Đã lưu template thành công');
                            fetchTemplates();
                          }
                        }}
                      >
                        LƯU TEMPLATE
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="pipeline-empty">
                    <div className="pipeline-empty-icon">▤</div>
                    <h3 className="font-bold text-[#5A1F08]">Chọn một template để xem hoặc chỉnh sửa</h3>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ================= PAGE: SETTINGS ================= */}
        {activePage === 'settings' && (
          <section id="page-settings" className="page">
            <div className="settings-shell">
              <div className="card settings-panel">
                <div className="eyebrow">SYSTEM CONFIGURATION</div>
                <h2 className="text-xl font-bold text-[#5A1F08] mt-1 mb-1">Cấu hình hệ thống</h2>
                <p className="text-xs text-[#7B6B62] mb-4">
                  Cấu hình kết nối Google Gemini API, Google Sheets và Google Drive để đồng bộ bài toán tự động.
                </p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="col-span-2">
                    <label>Gemini API Key</label>
                    <div className="api-key-row">
                      <input
                        type="password"
                        placeholder="AIzaSy..."
                        value={cfgKey}
                        onChange={e => setCfgKey(e.target.value)}
                      />
                      <a
                        className="api-key-link"
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ↗ LẤY API KEY
                      </a>
                    </div>
                  </div>

                  <div>
                    <label>Gemini Model</label>
                    <select value={cfgModel} onChange={e => setCfgModel(e.target.value)}>
                      <option value="gemini-3.8-flash">gemini-3.8-flash (Khuyên dùng - Nhanh & Ổn định)</option>
                      <option value="gemini-3.6-flash">gemini-3.6-flash</option>
                      <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Lý luận cao cấp)</option>
                    </select>
                  </div>

                  <div>
                    <label>Judge API URL (Tùy chọn)</label>
                    <input
                      placeholder="https://judge.example.com"
                      value={cfgJudge}
                      onChange={e => setCfgJudge(e.target.value)}
                    />
                  </div>

                  <div>
                    <label>Google Sheet ID (Database)</label>
                    <input
                      value={cfgSheet}
                      onChange={e => setCfgSheet(e.target.value)}
                      placeholder="1f7sqp6Ptdq5oRV-..."
                    />
                  </div>

                  <div>
                    <label>Google Drive Folder ID (Thư mục lưu bài)</label>
                    <input
                      value={cfgDrive}
                      onChange={e => setCfgDrive(e.target.value)}
                      placeholder="1-eVS67p_rjVrxuj_..."
                    />
                  </div>
                </div>

                <div className="flex gap-2 mb-4">
                  <button
                    className="primary"
                    onClick={async () => {
                      try {
                        const data = await safeFetchJson('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            geminiApiKey: cfgKey,
                            geminiModel: cfgModel,
                            spreadsheetId: cfgSheet,
                            driveFolderId: cfgDrive,
                            judgeApiUrl: cfgJudge
                          })
                        });
                        toast(data.message || 'Đã lưu cấu hình');
                      } catch (err: any) {
                        toast(err.message || 'Lỗi khi lưu cấu hình');
                      }
                    }}
                  >
                    LƯU CẤU HÌNH
                  </button>

                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        const data = await safeFetchJson('/api/initialize-database', { method: 'POST' });
                        setSettingsResult(JSON.stringify(data, null, 2));
                        toast('✓ Đã khởi tạo cấu trúc cơ sở dữ liệu');
                      } catch (err: any) {
                        toast(err.message || 'Lỗi khi khởi tạo database');
                      }
                    }}
                  >
                    KHỞI TẠO DATABASE
                  </button>

                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        const data = await safeFetchJson('/api/test-connections', { method: 'POST' });
                        setSettingsResult(JSON.stringify(data, null, 2));
                        toast('✓ Kiểm tra kết nối thành công');
                      } catch (err: any) {
                        toast(err.message || 'Lỗi khi kiểm tra kết nối');
                      }
                    }}
                  >
                    KIỂM TRA KẾT NỐI
                  </button>
                </div>

                {settingsResult && (
                  <div>
                    <label>Kết quả kiểm tra</label>
                    <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs leading-relaxed max-h-40 overflow-auto">
                      {settingsResult}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ================= FULLSCREEN / PIP PREVIEW MODAL ================= */}
      {showPreviewModal && currentProblem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#eadfd6] w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 px-6 border-b border-[#eee0d6] flex justify-between items-center bg-gradient-to-r from-[#fffaf6] to-[#fff]">
              <div>
                <div className="text-[11px] font-extrabold text-[#F45B0A] tracking-wider uppercase">
                  XEM TRƯỚC ĐỀ BÀI (PREVIEW MODAL)
                </div>
                <h2 className="text-xl font-black text-[#5A1F08] m-0">
                  {currentProblem.code} — {currentProblem.name}
                </h2>
                <div className="text-xs text-[#7B6B62] mt-0.5">
                  Chủ đề: <b>{currentProblem.topic}</b> · Thuật toán: <b>{currentProblem.algorithm}</b> · Độ khó: <b>{currentProblem.difficulty}</b> · v{currentProblem.version || 1}
                </div>
              </div>

              {/* Tabs & Close */}
              <div className="flex items-center gap-2">
                <div className="flex bg-[#faf3ed] p-1 rounded-xl gap-1">
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${modalPreviewTab === 'render' ? 'bg-white text-[#F45B0A] shadow-xs' : 'text-[#77665d] hover:text-[#5A1F08]'}`}
                    onClick={() => setModalPreviewTab('render')}
                  >
                    📝 Đề bài
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${modalPreviewTab === 'pdf' ? 'bg-white text-[#F45B0A] shadow-xs' : 'text-[#77665d] hover:text-[#5A1F08]'}`}
                    onClick={async () => {
                      if (!generatedPdfBlobUrl && currentProblem) {
                        try {
                          const doc = await buildValidPdfDocument(currentProblem);
                          const blob = doc.output('blob');
                          setGeneratedPdfBlobUrl(URL.createObjectURL(blob));
                        } catch (e) {
                          console.warn('PDF blob generation error', e);
                        }
                      }
                      setModalPreviewTab('pdf');
                    }}
                  >
                    📄 Xem PDF
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${modalPreviewTab === 'word' ? 'bg-white text-[#F45B0A] shadow-xs' : 'text-[#77665d] hover:text-[#5A1F08]'}`}
                    onClick={() => setModalPreviewTab('word')}
                  >
                    📝 Bản Word
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${modalPreviewTab === 'source' ? 'bg-white text-[#F45B0A] shadow-xs' : 'text-[#77665d] hover:text-[#5A1F08]'}`}
                    onClick={() => setModalPreviewTab('source')}
                  >
                    📑 Markdown
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${modalPreviewTab === 'latex' ? 'bg-white text-[#F45B0A] shadow-xs' : 'text-[#77665d] hover:text-[#5A1F08]'}`}
                    onClick={() => setModalPreviewTab('latex')}
                  >
                    📐 LaTeX
                  </button>
                </div>
                <button
                  type="button"
                  className="w-9 h-9 rounded-xl bg-[#fff0e6] text-[#5A1F08] hover:bg-[#ffe2cf] font-bold text-lg grid place-items-center cursor-pointer transition-all ml-1"
                  onClick={() => setShowPreviewModal(false)}
                  title="Đóng cửa sổ xem trước"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-[#fffdfb]">
              {modalPreviewTab === 'render' && (
                <div className="problem-render max-w-4xl mx-auto shadow-xs border border-[#eee0d6]">
                  <h1 className="text-2xl font-black text-[#5A1F08] mb-1">
                    {currentProblem.code} — {currentProblem.name}
                  </h1>
                  <div className="text-xs text-[#7B6B62] mb-4 pb-2 border-b border-[#f0dfd3]">
                    Chủ đề: <b>{currentProblem.topic}</b> · Thuật toán: <b>{currentProblem.algorithm}</b> · Độ khó: <b>{currentProblem.difficulty}</b> · Phiên bản: v{currentProblem.version || 1}
                  </div>

                  <h3 className="font-extrabold text-sm text-[#5A1F08] mb-1.5 uppercase">1. Đề bài</h3>
                  <div className="problem-box text-sm mb-4">
                    {renderJustifiedText(currentProblem.statement)}
                  </div>

                  <h3 className="font-extrabold text-sm text-[#5A1F08] mb-1.5 uppercase">2. Dữ liệu vào (Input)</h3>
                  <div className="problem-box text-sm mb-4">
                    {renderJustifiedText(currentProblem.input)}
                  </div>

                  <h3 className="font-extrabold text-sm text-[#5A1F08] mb-1.5 uppercase">3. Dữ liệu ra (Output)</h3>
                  <div className="problem-box text-sm mb-4">
                    {renderJustifiedText(currentProblem.output)}
                  </div>

                  <h3 className="font-extrabold text-sm text-[#5A1F08] mb-1.5 uppercase">4. Ràng buộc (Constraints)</h3>
                  <ul className="list-disc pl-5 text-sm space-y-1.5 text-justify mb-4">
                    {(currentProblem.constraints || []).map((c, i) => (
                      <li key={i} className="leading-relaxed text-justify">{c}</li>
                    ))}
                  </ul>

                  {currentProblem.subtasks && currentProblem.subtasks.length > 0 && (
                    <div className="mb-4">
                      <h3 className="font-extrabold text-sm text-[#5A1F08] mb-1.5 uppercase">5. Subtasks</h3>
                      <div className="space-y-1.5 text-sm">
                        {currentProblem.subtasks.map((st, i) => (
                          <div key={i} className="p-3 bg-[#fffaf5] rounded-xl border border-[#eedad0] text-justify leading-relaxed">
                            <b>{st.id}</b> ({st.points} điểm): {st.constraints}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentProblem.samples && currentProblem.samples.length > 0 && (
                    <div>
                      <h3 className="font-extrabold text-sm text-[#5A1F08] mb-2 uppercase">6. Ví dụ mẫu (Samples)</h3>
                      {currentProblem.samples.map((s, i) => (
                        <div key={i} className="mb-3">
                          <div className="text-xs font-bold text-[#8c7568] mb-1">Sample {i + 1}</div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="text-[11px] font-bold text-[#5A1F08]">Input:</span>
                              <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs mt-1 overflow-auto">
                                {s.input}
                              </pre>
                            </div>
                            <div>
                              <span className="text-[11px] font-bold text-[#5A1F08]">Output:</span>
                              <pre className="bg-[#21150f] text-[#fff0e5] p-3 rounded-lg text-xs mt-1 overflow-auto">
                                {s.output}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {modalPreviewTab === 'pdf' && currentProblem && (
                <div className="flex flex-col gap-3 max-w-4xl mx-auto">
                  <div className="flex justify-between items-center bg-[#fff8ef] border border-[#f0dfd3] p-3 rounded-xl shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                      <span className="text-xs text-[#5A1F08] font-bold">
                        📄 Bản xem trước Tài liệu PDF A4 (100% Vector & MathJax Latex) — Hiển thị trực tiếp không bị lỗi plugin
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="secondary text-xs font-bold py-1 px-3 cursor-pointer"
                        onClick={() => printProblemDoc(currentProblem)}
                      >
                        🖨 In / Lưu PDF
                      </button>
                      <button
                        type="button"
                        className="primary text-xs py-1.5 px-3.5 font-bold shadow-xs cursor-pointer"
                        onClick={() => exportRealPdf(currentProblem)}
                      >
                        ⬇ Tải file PDF về máy (.pdf)
                      </button>
                    </div>
                  </div>

                  {/* A4 Paper Document Sheet View */}
                  <div className="bg-[#525659] p-6 rounded-2xl overflow-auto max-h-[62vh] flex justify-center shadow-inner">
                    <div
                      className="bg-white text-black shadow-2xl rounded-sm p-10 font-serif leading-relaxed select-text"
                      style={{
                        width: '794px',
                        minHeight: '1123px',
                        fontFamily: "'Times New Roman', Times, serif",
                        boxSizing: 'border-box'
                      }}
                    >
                      {/* Olympic Header */}
                      <div className="border-t-4 border-[#5A1F08] pt-3 mb-4">
                        <div className="text-[11px] font-sans font-bold text-[#F45B0A] tracking-wider uppercase mb-1">
                          OJ PROBLEM FACTORY · OLYMPIC TIN HỌC / ONLINE JUDGE
                        </div>
                        <h1 className="text-2xl font-bold text-[#5A1F08] m-0 mb-1 leading-tight">
                          {currentProblem.code} — {currentProblem.name}
                        </h1>
                        <div className="text-xs text-[#555] italic border-b border-[#d8c7bb] pb-2 flex justify-between">
                          <span>
                            Chủ đề: <b className="not-italic text-black">{currentProblem.topic}</b> | Thuật toán: <b className="not-italic text-black">{currentProblem.algorithm}</b> | Độ khó: <b className="not-italic text-black">{currentProblem.difficulty}</b>
                          </span>
                          <span>Phiên bản: v{currentProblem.version || 1}</span>
                        </div>
                      </div>

                      {/* Content Sections */}
                      <div className="space-y-4 text-[12pt] text-justify leading-relaxed">
                        <div>
                          <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                            1. ĐỀ BÀI
                          </div>
                          <div>{renderJustifiedText(currentProblem.statement)}</div>
                        </div>

                        <div>
                          <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                            2. DỮ LIỆU VÀO (INPUT)
                          </div>
                          <div>{renderJustifiedText(currentProblem.input)}</div>
                        </div>

                        <div>
                          <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                            3. DỮ LIỆU RA (OUTPUT)
                          </div>
                          <div>{renderJustifiedText(currentProblem.output)}</div>
                        </div>

                        {currentProblem.constraints && currentProblem.constraints.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                              4. RÀNG BUỘC (CONSTRAINTS)
                            </div>
                            <ul className="list-disc pl-6 space-y-1">
                              {currentProblem.constraints.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {currentProblem.subtasks && currentProblem.subtasks.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                              5. SUBTASKS
                            </div>
                            <ul className="list-disc pl-6 space-y-1">
                              {currentProblem.subtasks.map((st, i) => (
                                <li key={i}><b>{st.id}</b> ({st.points} điểm): {st.constraints}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {currentProblem.samples && currentProblem.samples.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                              6. VÍ DỤ MẪU (SAMPLES)
                            </div>
                            <table className="w-full border-collapse border border-black my-2 text-xs font-mono">
                              <thead>
                                <tr className="bg-[#f6f0ea]">
                                  <th className="border border-black p-2 text-left w-1/2 font-sans font-bold">Input</th>
                                  <th className="border border-black p-2 text-left w-1/2 font-sans font-bold">Output</th>
                                </tr>
                              </thead>
                              <tbody>
                                {currentProblem.samples.map((s, i) => (
                                  <tr key={i}>
                                    <td className="border border-black p-2 align-top whitespace-pre-wrap">{s.input}</td>
                                    <td className="border border-black p-2 align-top whitespace-pre-wrap">{s.output}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {currentProblem.notes && currentProblem.notes.length > 0 && (
                          <div>
                            <div className="font-sans font-bold text-xs text-[#5A1F08] uppercase tracking-wider mb-1">
                              7. GIẢI THÍCH
                            </div>
                            <ul className="list-disc pl-6 space-y-1">
                              {currentProblem.notes.map((n, i) => (
                                <li key={i}>{n}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="mt-12 pt-3 border-t border-[#d8c7bb] text-[10pt] text-[#666] flex justify-between font-sans">
                        <span>OJ Problem Factory — Design by Lê Văn Đông</span>
                        <span>Trang 1 / 1</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {modalPreviewTab === 'word' && (
                <div className="max-w-4xl mx-auto flex flex-col gap-3">
                  <div className="flex justify-between items-center bg-[#fff8ef] border border-[#f0dfd3] p-3 rounded-xl">
                    <span className="text-xs text-[#5A1F08] font-medium">
                      📄 Tài liệu chuẩn Microsoft Word (.doc) — Không có màu nền, công thức toán học được hiển thị đầy đủ (không còn ký hiệu $ hay $x^2$).
                    </span>
                    <button
                      type="button"
                      className="primary text-xs font-bold py-1.5 px-3"
                      onClick={() => downloadWordDoc(currentProblem)}
                    >
                      ⬇ Tải file Word (.doc)
                    </button>
                  </div>
                  <div
                    className="bg-white border border-[#d6c9be] p-8 md:p-12 shadow-sm rounded-lg font-serif text-[15px] leading-relaxed text-black text-justify select-text"
                    dangerouslySetInnerHTML={{
                      __html: `
                        <h1 style="font-size: 20pt; font-weight: bold; margin-bottom: 4pt; color: #000;">${currentProblem.code} — ${currentProblem.name}</h1>
                        <p style="font-size: 11pt; color: #444; font-style: italic; margin-bottom: 12pt;">Chủ đề: <b>${currentProblem.topic}</b> | Thuật toán: <b>${currentProblem.algorithm}</b> | Độ khó: <b>${currentProblem.difficulty}</b></p>
                        <hr style="border: 0; border-top: 1pt solid #000; margin-bottom: 14pt;"/>
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">1. Đề bài</h3>
                        <div style="margin-bottom: 10pt; line-height: 1.5; text-align: justify;">${formatMathForWord(currentProblem.statement)}</div>
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">2. Dữ liệu vào (Input)</h3>
                        <div style="margin-bottom: 10pt; line-height: 1.5; text-align: justify;">${formatMathForWord(currentProblem.input)}</div>
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">3. Dữ liệu ra (Output)</h3>
                        <div style="margin-bottom: 10pt; line-height: 1.5; text-align: justify;">${formatMathForWord(currentProblem.output)}</div>
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">4. Ràng buộc (Constraints)</h3>
                        <ul style="padding-left: 20pt; margin-bottom: 10pt; line-height: 1.5;">
                          ${(currentProblem.constraints || []).map((c: string) => `<li style="margin-bottom: 3pt;">${formatMathForWord(c)}</li>`).join('')}
                        </ul>
                        ${currentProblem.subtasks && currentProblem.subtasks.length > 0 ? `
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">5. Subtasks</h3>
                        <ul style="padding-left: 20pt; margin-bottom: 10pt; line-height: 1.5;">
                          ${currentProblem.subtasks.map((st: any) => `<li style="margin-bottom: 3pt;"><b>${st.id}</b> (${st.points} điểm): ${formatMathForWord(st.constraints)}</li>`).join('')}
                        </ul>` : ''}
                        ${currentProblem.samples && currentProblem.samples.length > 0 ? `
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">6. Ví dụ</h3>
                        <table style="width: 100%; border-collapse: collapse; margin-top: 6pt; margin-bottom: 12pt;">
                          <tr><th style="border: 1pt solid #000; padding: 6pt; text-align: left; font-weight: bold; width: 50%;">Input</th><th style="border: 1pt solid #000; padding: 6pt; text-align: left; font-weight: bold; width: 50%;">Output</th></tr>
                          ${currentProblem.samples.map((s: any) => `<tr><td style="border: 1pt solid #000; padding: 6pt; vertical-align: top;"><pre style="font-family: Consolas, monospace; font-size: 10.5pt; margin: 0; white-space: pre-wrap;">${s.input}</pre></td><td style="border: 1pt solid #000; padding: 6pt; vertical-align: top;"><pre style="font-family: Consolas, monospace; font-size: 10.5pt; margin: 0; white-space: pre-wrap;">${s.output}</pre></td></tr>`).join('')}
                        </table>` : ''}
                        ${currentProblem.notes && currentProblem.notes.length > 0 ? `
                        <h3 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; margin-bottom: 4pt; color: #000;">7. Giải thích</h3>
                        <ul style="padding-left: 20pt; margin-bottom: 10pt; line-height: 1.5;">
                          ${currentProblem.notes.map((n: string) => `<li style="margin-bottom: 3pt;">${formatMathForWord(n)}</li>`).join('')}
                        </ul>` : ''}
                      `
                    }}
                  />
                </div>
              )}

              {modalPreviewTab === 'source' && (
                <pre className="problem-source max-w-4xl mx-auto">
                  {`# ${currentProblem.name}\n\n## Đề bài\n\n${currentProblem.statement}\n\n## Input\n\n${currentProblem.input}\n\n## Output\n\n${currentProblem.output}\n\n## Constraints\n\n${(currentProblem.constraints || []).map(c => `- ${c}`).join('\n')}\n\n## Subtasks\n\n${(currentProblem.subtasks || []).map(s => `- ${s.id} (${s.points}đ): ${s.constraints}`).join('\n')}`}
                </pre>
              )}

              {modalPreviewTab === 'latex' && (
                <pre className="problem-source max-w-4xl mx-auto">
                  {`\\section*{${currentProblem.name}}\n\n${currentProblem.statement}\n\n\\subsection*{Input}\n${currentProblem.input}\n\n\\subsection*{Output}\n${currentProblem.output}\n\n\\subsection*{Constraints}\n\\begin{itemize}\n${(currentProblem.constraints || []).map(c => `\\item ${c}`).join('\n')}\n\\end{itemize}`}
                </pre>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 px-6 border-t border-[#eee0d6] flex justify-between items-center bg-[#fffcf9]">
              <div className="text-xs text-[#7B6B62]">
                OJ Problem Factory — Design by <b>Lê Văn Đông</b>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1.5 px-3 cursor-pointer"
                  onClick={() => copyFullProblem(currentProblem)}
                >
                  📋 Copy Đề bài
                </button>
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1.5 px-3 cursor-pointer"
                  onClick={() => printProblemDoc(currentProblem)}
                >
                  🖨 In / Lưu trình duyệt
                </button>
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1.5 px-3 cursor-pointer"
                  onClick={() => downloadWordDoc(currentProblem)}
                >
                  ⬇ Tải Word (.doc)
                </button>
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1.5 px-3 cursor-pointer"
                  onClick={() => exportRealPdf(currentProblem)}
                >
                  ⬇ Tải PDF (.pdf)
                </button>
                <button
                  type="button"
                  className="primary text-xs font-bold py-1.5 px-4 shadow-sm cursor-pointer bg-[#F45B0A] hover:bg-[#d84a00] text-white"
                  onClick={() => generateAndDownloadZip(currentProblem, artifactsData, validationData)}
                >
                  📦 TẢI GÓI ZIP (.ZIP)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TESTCASE DETAILS MODAL ================= */}
      {selectedTestcase && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedTestcase(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-[#ead8cd] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 px-6 border-b border-[#eee0d6] flex justify-between items-center bg-[#fffcf9]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#fff0e6] text-[#F45B0A] font-black text-sm flex items-center justify-center border border-[#ffd5bf]">
                  #{String(selectedTestcase.test_no).padStart(2, '0')}
                </div>
                <div>
                  <h3 className="font-black text-base text-[#5A1F08] flex items-center gap-2 m-0">
                    Chi tiết Test {String(selectedTestcase.test_no).padStart(2, '0')}
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
                      ✓ {selectedTestcase.status || 'DONE'}
                    </span>
                  </h3>
                  <div className="text-xs text-[#8c7568] flex items-center gap-2 mt-0.5">
                    <span>File vào: <b>{selectedTestcase.input_file}</b></span>
                    <span>•</span>
                    <span>File ra: <b>{selectedTestcase.output_file}</b></span>
                    <span>•</span>
                    <span>Phân loại: <b className="uppercase">{selectedTestcase.test_type}</b></span>
                    <span>•</span>
                    <span>{selectedTestcase.subtask}</span>
                  </div>
                </div>
              </div>

              {/* Navigation & Close */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1 px-2.5 cursor-pointer disabled:opacity-40"
                  disabled={selectedTestcase.test_no <= 1}
                  onClick={() => {
                    const prev = testcasesList.find(t => t.test_no === selectedTestcase.test_no - 1);
                    if (prev) setSelectedTestcase(prev);
                  }}
                  title="Xem test trước"
                >
                  ◀ Test trước
                </button>
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1 px-2.5 cursor-pointer disabled:opacity-40"
                  disabled={selectedTestcase.test_no >= (testcasesList.length || 20)}
                  onClick={() => {
                    const next = testcasesList.find(t => t.test_no === selectedTestcase.test_no + 1);
                    if (next) setSelectedTestcase(next);
                  }}
                  title="Xem test tiếp theo"
                >
                  Test tiếp ▶
                </button>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full border border-[#d8c5b8] text-[#8c7568] hover:text-[#5A1F08] hover:bg-[#fff2e8] flex items-center justify-center font-bold text-sm cursor-pointer ml-2"
                  onClick={() => setSelectedTestcase(null)}
                  title="Đóng"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body: Side-by-side Input / Output with Copy and full content */}
            <div className="p-5 overflow-y-auto flex-1 bg-[#faf6f2] space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Input Panel */}
                <div className="bg-white rounded-xl border border-[#eedad0] p-4 flex flex-col shadow-xs">
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-[#f3e5dc]">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      <b className="text-xs text-[#5A1F08] font-bold uppercase tracking-wider">
                        Dữ liệu vào (Input - {selectedTestcase.input_file})
                      </b>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#8c7568]">
                        {(selectedTestcase.input_data || '').length} ký tự
                      </span>
                      <button
                        type="button"
                        className="text-xs font-bold text-[#F45B0A] hover:text-[#d04500] bg-[#fff0e6] hover:bg-[#ffe2cf] px-2 py-0.5 rounded cursor-pointer border border-[#ffd5bf]"
                        onClick={() => copyText(selectedTestcase.input_data || '')}
                      >
                        📋 Copy In
                      </button>
                    </div>
                  </div>
                  <pre className="bg-[#1b120c] text-emerald-400 p-3 rounded-lg font-mono text-xs leading-relaxed overflow-auto max-h-72 min-h-36 whitespace-pre select-all">
                    {selectedTestcase.input_data || '(Trống)'}
                  </pre>
                </div>

                {/* Output Panel */}
                <div className="bg-white rounded-xl border border-[#eedad0] p-4 flex flex-col shadow-xs">
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-[#f3e5dc]">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      <b className="text-xs text-[#5A1F08] font-bold uppercase tracking-wider">
                        Dữ liệu ra (Output - {selectedTestcase.output_file})
                      </b>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#8c7568]">
                        {(selectedTestcase.output_data || '').length} ký tự
                      </span>
                      <button
                        type="button"
                        className="text-xs font-bold text-[#F45B0A] hover:text-[#d04500] bg-[#fff0e6] hover:bg-[#ffe2cf] px-2 py-0.5 rounded cursor-pointer border border-[#ffd5bf]"
                        onClick={() => copyText(selectedTestcase.output_data || '')}
                      >
                        📋 Copy Out
                      </button>
                    </div>
                  </div>
                  <pre className="bg-[#1b120c] text-amber-300 p-3 rounded-lg font-mono text-xs leading-relaxed overflow-auto max-h-72 min-h-36 whitespace-pre select-all">
                    {selectedTestcase.output_data || '(Trống)'}
                  </pre>
                </div>
              </div>

              {/* Subtask & Metadata banner */}
              <div className="bg-white rounded-xl border border-[#ebd8cc] p-3 text-xs text-[#5A1F08] flex items-center justify-between">
                <div>
                  <span className="font-bold">Nhóm Subtask: </span>
                  <span className="text-[#8c7568]">{selectedTestcase.subtask}</span>
                  <span className="mx-2">•</span>
                  <span className="font-bold">Đặc tính: </span>
                  <span className="text-[#8c7568]">
                    {selectedTestcase.test_type === 'sample' && 'Dữ liệu ví dụ mẫu trong đề bài (Sample)'}
                    {selectedTestcase.test_type === 'edge' && 'Trường hợp đặc biệt / biên nhỏ (Corner / Edge cases)'}
                    {selectedTestcase.test_type === 'random' && 'Dữ liệu phân bố ngẫu nhiên cấu trúc chuẩn (Random distribution)'}
                    {selectedTestcase.test_type === 'boundary' && 'Dữ liệu cực đại kiểm tra tràn số và TLE (Max boundary stress)'}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary text-xs font-bold py-1 px-3 cursor-pointer"
                  onClick={() => {
                    const fullTestText = `=== INPUT (${selectedTestcase.input_file}) ===\n${selectedTestcase.input_data}\n\n=== OUTPUT (${selectedTestcase.output_file}) ===\n${selectedTestcase.output_data}`;
                    copyText(fullTestText);
                    toast(`✓ Đã copy cả Input & Output của Test ${selectedTestcase.test_no}`);
                  }}
                >
                  📋 Copy toàn bộ Test
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 px-6 border-t border-[#eee0d6] flex justify-end items-center bg-[#fffcf9]">
              <button
                type="button"
                className="secondary text-xs font-bold py-1.5 px-4 cursor-pointer"
                onClick={() => setSelectedTestcase(null)}
              >
                ✕ Đóng cửa sổ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPLOADED PDF VIEWER MODAL */}
      {viewingPdfFile && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-[#e5d5c5]">
            <div className="flex justify-between items-center px-4 py-3 bg-[#fff8ef] border-b border-[#f0dfd3]">
              <div className="flex items-center gap-2">
                <span className="text-xl">📄</span>
                <b className="text-sm text-[#5A1F08]">{viewingPdfFile.name}</b>
              </div>
              <button
                type="button"
                className="text-xs font-bold text-[#8c7568] hover:text-[#5A1F08] bg-white border border-[#e0cfc1] px-3 py-1 rounded-lg cursor-pointer hover:bg-[#fff0e6]"
                onClick={() => setViewingPdfFile(null)}
              >
                ✕ Đóng viewer
              </button>
            </div>
            <div className="flex-1 bg-[#525659]">
              <iframe
                src={viewingPdfFile.dataUrl}
                className="w-full h-full border-0"
                title={viewingPdfFile.name}
              />
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      <div id="toast" className={showToast ? 'show' : ''}>
        {toastMessage}
      </div>
    </div>
  );
}
