/**
 * OA-ify Lightweight Safe Markdown Formatter
 * Zero-dependency parser converting LLM Markdown into clean, accessible HTML.
 * Supports HackerRank-style Sample Input/Output terminal blocks.
 */
(function (global) {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Returns true if this bold label is a Sample Input/Output header
  function isSampleLabel(text) {
    return /^Sample (Input|Output)\s*\d*$/i.test(text.trim());
  }

  function getSampleLabelInfo(text) {
    const m = text.trim().match(/^Sample (Input|Output)\s*(\d*)$/i);
    if (!m) return null;
    return {
      type: m[1].toLowerCase(),
      num: m[2] || ''
    };
  }

  function renderMarkdown(md) {
    if (!md || typeof md !== 'string') return '';

    const text = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n');

    let html = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeBuffer = [];
    let inList = false;
    let listType = '';
    let pendingSampleLabel = null;
    let currentCase = null;

    function closeList() {
      if (inList) {
        html.push(`</${listType}>`);
        inList = false;
        listType = '';
      }
    }

    function flushCurrentCase() {
      if (!currentCase) return;
      const numStr = currentCase.id ? ` ${currentCase.id}` : '';
      let out = `<div class="oa-sample-case">`;
      out += `<div class="oa-sample-case-header">Sample Case${escapeHtml(numStr)}</div>`;

      if (currentCase.input !== null) {
        out += `<div class="oa-sample-section">` +
                 `<div class="oa-sample-label">Sample Input</div>` +
                 `<pre class="oa-sample-pre">${currentCase.input}</pre>` +
               `</div>`;
      }
      if (currentCase.output !== null) {
        out += `<div class="oa-sample-section">` +
                 `<div class="oa-sample-label">Sample Output</div>` +
                 `<pre class="oa-sample-pre">${currentCase.output}</pre>` +
               `</div>`;
      }
      if (currentCase.explanation && currentCase.explanation.length > 0) {
        out += `<div class="oa-sample-explanation">` +
                 `<div class="oa-sample-label">Explanation</div>` +
                 `<div class="oa-sample-explanation-text">${currentCase.explanation.join('')}</div>` +
               `</div>`;
      }
      out += `</div>`;
      html.push(out);
      currentCase = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ── Code blocks ─────────────────────────────────────────────────────────
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          closeList();
          inCodeBlock = true;
          codeLanguage = line.trim().substring(3).trim();
          codeBuffer = [];
        } else {
          inCodeBlock = false;
          const rawCode = codeBuffer.join('\n');
          const escapedCode = escapeHtml(rawCode);

          if (pendingSampleLabel) {
            const labelInfo = getSampleLabelInfo(pendingSampleLabel);
            pendingSampleLabel = null;
            if (labelInfo) {
              if (!currentCase || (labelInfo.type === 'input' && currentCase.input !== null)) {
                flushCurrentCase();
                currentCase = { id: labelInfo.num, input: null, output: null, explanation: [], inExplanation: false };
              }
              if (labelInfo.type === 'input') {
                currentCase.input = escapedCode;
              } else {
                if (!currentCase) {
                  currentCase = { id: labelInfo.num, input: null, output: null, explanation: [], inExplanation: false };
                }
                currentCase.output = escapedCode;
              }
            }
          } else {
            flushCurrentCase();
            const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
            html.push(
              `<div class="oa-code-block">` +
                `<div class="oa-code-header">` +
                  `<span class="oa-code-lang">${escapeHtml(codeLanguage || 'code')}</span>` +
                  `<button type="button" class="oa-copy-btn" data-code="${encodeURIComponent(rawCode)}">` +
                    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>` +
                    `<span>Copy</span>` +
                  `</button>` +
                `</div>` +
                `<pre><code${langClass}>${escapedCode}</code></pre>` +
              `</div>`
            );
          }
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      const trimmed = line.trim();

      // ── Empty lines ─────────────────────────────────────────────────────────
      if (trimmed === '') {
        closeList();
        continue;
      }

      // ── Horizontal rules ────────────────────────────────────────────────────
      if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        closeList();
        flushCurrentCase();
        html.push('<hr class="oa-divider" />');
        continue;
      }

      // ── Headings ────────────────────────────────────────────────────────────
      if (trimmed.startsWith('#')) {
        closeList();
        flushCurrentCase();
        const levelMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (levelMatch) {
          const level = levelMatch[1].length;
          const headingText = formatInline(levelMatch[2]);
          html.push(`<h${level} class="oa-heading oa-h${level}">${headingText}</h${level}>`);
          continue;
        }
      }

      // ── Blockquotes ─────────────────────────────────────────────────────────
      if (trimmed.startsWith('>')) {
        closeList();
        flushCurrentCase();
        const quoteText = formatInline(trimmed.replace(/^>\s?/, ''));
        html.push(`<blockquote class="oa-blockquote">${quoteText}</blockquote>`);
        continue;
      }

      // ── Unordered lists ─────────────────────────────────────────────────────
      const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          closeList();
          html.push('<ul class="oa-list">');
          inList = true;
          listType = 'ul';
        }
        html.push(`<li class="oa-list-item">${formatInline(ulMatch[1])}</li>`);
        continue;
      }

      // ── Ordered lists ────────────────────────────────────────────────────────
      const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          closeList();
          html.push('<ol class="oa-list oa-ordered-list">');
          inList = true;
          listType = 'ol';
        }
        html.push(`<li class="oa-list-item">${formatInline(olMatch[2])}</li>`);
        continue;
      }

      // ── Section divider label: **Bold Line** used as a standalone heading ──
      const boldLineMatch = trimmed.match(/^\*\*(.+?)\*\*\s*$/);
      if (boldLineMatch) {
        closeList();
        const labelInner = boldLineMatch[1].trim();

        if (isSampleLabel(labelInner)) {
          const info = getSampleLabelInfo(labelInner);
          if (info && info.type === 'input' && currentCase && currentCase.input !== null) {
            flushCurrentCase();
          }
          pendingSampleLabel = labelInner;
          if (currentCase) currentCase.inExplanation = false;
          continue;
        }

        if (/^Explanation\s*\d*$/i.test(labelInner)) {
          if (currentCase) {
            currentCase.inExplanation = true;
            continue;
          }
          flushCurrentCase();
          html.push(`<p class="oa-section-label">${escapeHtml(labelInner)}</p>`);
          continue;
        }

        flushCurrentCase();
        html.push(`<h3 class="oa-section-heading">${escapeHtml(labelInner)}</h3>`);
        continue;
      }

      // ── Constraint lines ────────────────────────────────────────────────────
      if (/[≤≥<>^]/.test(trimmed) && trimmed.length < 120 && !trimmed.startsWith('<')) {
        closeList();
        flushCurrentCase();
        html.push(`<p class="oa-constraint">${formatInline(trimmed)}</p>`);
        continue;
      }

      // ── Plain paragraphs ────────────────────────────────────────────────────
      closeList();
      if (pendingSampleLabel && !trimmed.startsWith('```')) {
        pendingSampleLabel = null;
      }

      if (currentCase && currentCase.inExplanation) {
        currentCase.explanation.push(`<p class="oa-paragraph">${formatInline(trimmed)}</p>`);
      } else {
        if (currentCase && currentCase.input !== null && currentCase.output !== null) {
          flushCurrentCase();
        }
        html.push(`<p class="oa-paragraph">${formatInline(trimmed)}</p>`);
      }
    }

    closeList();
    flushCurrentCase();
    return html.join('\n');
  }

  function formatInline(text) {
    if (!text) return '';

    // Restore safe HTML tags BEFORE escaping — pull them out, escape the rest, put them back
    // This lets <sup>, <sub> from the LLM pass through intact
    const SAFE_TAGS = /(<\/?(?:sup|sub)>)/g;
    const parts = text.split(SAFE_TAGS);
    let res = parts.map((part, i) => {
      // Even indices are plain text segments — escape them
      // Odd indices are the captured tag tokens — keep as-is
      return i % 2 === 0 ? escapeHtml(part) : part;
    }).join('');

    // Bold + Italic (must run before Bold/Italic individually)
    res = res.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    res = res.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
    // Bold
    res = res.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    res = res.replace(/__(.*?)__/g, '<strong>$1</strong>');
    // Italic
    res = res.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Note: single _word_ italic deliberately skipped here to avoid clashing with subscript
    // Inline code
    res = res.replace(/`([^`]+)`/g, '<code class="oa-inline-code">$1</code>');

    // Superscript: convert 10^5, n^2, x^k notation (digit or letter after ^)
    // Only match when ^ is between a word char and a word char/digit sequence
    res = res.replace(/(\w)\^(\w+)/g, '$1<sup>$2</sup>');

    // Subscript: convert x_1, a_i, arr_k (single letter/digit subscript after _)
    // Narrow match to avoid breaking general underscores in identifiers
    res = res.replace(/([a-zA-Z])\{([^}]+)\}/g, '$1<sub>$2</sub>'); // x{i} → x<sub>i</sub>
    res = res.replace(/([a-zA-Z])_([0-9a-zA-Z])\b/g, '$1<sub>$2</sub>'); // x_1 → x<sub>1</sub>

    return res;
  }

  global.OAMarkdown = {
    render: renderMarkdown,
    escape: escapeHtml
  };
})(typeof window !== 'undefined' ? window : this);
