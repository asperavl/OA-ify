/**
 * OA-ify Content Script
 * Injected into leetcode.com/problems/*
 * Blinds crutches, transforms problem statements, and handles SPA navigation.
 */
(function () {
  'use strict';

  let currentSlug = null;
  let isOaEnabled = true;
  let isAutoLoadEnabled = true;
  let currentView = 'oa'; // 'oa' or 'original'
  let isGenerating = false;
  let userApiKey = '';

  // Original DOM references
  let cachedOriginalNodes = [];
  let originalContainerEl = null;
  let hudElement = null;
  let narrativeContainerEl = null;

  // Track SPA URL changes
  let lastUrl = location.href;

  /**
   * Extract current LeetCode problem slug
   */
  function getProblemSlug() {
    const match = location.pathname.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Locate the problem description content container in LeetCode's DOM
   */
  function findDescriptionContainer() {
    // Try multiple selectors across LeetCode layout variations
    const selectors = [
      '[data-track-load="description_content"]',
      'div[data-key="description-content"]',
      '.elfjS',
      'div[class*="content__u3I1"]',
      'div[class*="question-content"]',
      'div[class*="description__"]',
      '.question-description'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 30) {
        return el;
      }
    }

    return null;
  }

  /**
   * Extract problem title
   */
  function getProblemTitle() {
    const titleEl = document.querySelector('[data-cy="question-title"]') ||
                    document.querySelector('.text-title-large') ||
                    document.querySelector('div[class*="title__"]') ||
                    document.querySelector('h4');
    if (titleEl && titleEl.textContent) {
      return titleEl.textContent.trim();
    }
    const slug = getProblemSlug();
    return slug ? slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') : 'Assessment Problem';
  }

  /**
   * Apply or remove crutch-blinder styles on the page
   */
  function updateCrutchBlinder(blind) {
    if (blind && isOaEnabled && currentView === 'oa') {
      document.body.classList.add('oa-blind-crutches');
      scanAndHideByText();
    } else {
      document.body.classList.remove('oa-blind-crutches');
      restoreHiddenElements();
    }
  }

  // Keywords for top-tab hiding (checked with .includes() — each tab has text duplicated)
  const HIDDEN_TAB_KEYWORDS = ['editorial', 'solutions'];
  // Keywords for bottom-accordion hiding
  const HIDDEN_ACCORDION_KEYWORDS = ['similar questions', 'discussion', 'hints', 'hint', 'topics'];

  /**
   * Hides Editorial/Solutions tabs and Similar Questions/Discussion accordions.
   *
   * Based on real LeetCode DOM inspection:
   * - Tabs are `div.flexlayout__tab_button` elements (FlexLayout React library).
   *   Each tab's textContent is duplicated (e.g. "EditorialEditorial") due to an
   *   animation trick — so we use .includes(), not === or a Set.
   * - Accordions are `div.group.flex.cursor-pointer.items-center.transition-colors`
   *   elements whose textContent starts with the label. We hide both the clickable
   *   row AND its parent flex-col wrapper (which holds expanded content).
   */
  function scanAndHideByText() {
    // ── Top nav tabs ──────────────────────────────────────────────────────────
    document.querySelectorAll('div.flexlayout__tab_button').forEach(tab => {
      if (tab.dataset.oaNavHidden) return;
      const txt = tab.textContent?.trim().toLowerCase() || '';
      if (HIDDEN_TAB_KEYWORDS.some(kw => txt.includes(kw))) {
        tab.dataset.oaNavHidden = 'true';
        tab.style.setProperty('display', 'none', 'important');
      }
    });

    // ── Bottom accordions & header crutch buttons ─────────────────────────────
    // The clickable header row has class `group flex cursor-pointer items-center transition-colors`
    // We walk them and check their text content.
    document.querySelectorAll('div.group.cursor-pointer').forEach(row => {
      if (row.closest('#oa-hud') || row.dataset.oaHidden) return;
      const txt = row.textContent?.trim().toLowerCase() || '';
      // Match keyword rows AND rows with no meaningful text (e.g. lock-icon-only rows)
      if (HIDDEN_ACCORDION_KEYWORDS.some(kw => txt.includes(kw)) || txt.length < 4) {
        // Hide the clickable row itself
        row.dataset.oaHidden = 'true';
        row.style.setProperty('display', 'none', 'important');
        // Also hide the parent wrapper (flex-col) which holds expanded content + divider
        const wrapper = row.parentElement;
        if (wrapper && !wrapper.closest('#oa-hud')) {
          wrapper.dataset.oaHidden = 'true';
          wrapper.style.setProperty('display', 'none', 'important');
        }
      }
    });



    // ── Acceptance stats bar (Accepted N / Acceptance Rate N%) ─────────────────
    // This is a non-clickable div containing acceptance data — find by text content
    const allDivs = document.querySelectorAll(
      '[data-track-load="description_content"] > div, [data-track-load="description_content"] > *'
    );
    allDivs.forEach(el => {
      if (el.closest('#oa-hud') || el.classList.contains('oa-narrative-container') || el.dataset.oaHidden) return;
      const txt = el.textContent?.trim().toLowerCase() || '';
      if (txt.includes('accepted') && txt.includes('acceptance rate')) {
        el.dataset.oaHidden = 'true';
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }

  /** Restores all elements hidden by scanAndHideByText */
  function restoreHiddenElements() {
    document.querySelectorAll('[data-oa-nav-hidden="true"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.oaNavHidden;
    });
    document.querySelectorAll('[data-oa-hidden="true"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.oaHidden;
    });
  }

  /**
   * Build the Injected OA HUD
   */
  function createHudElement() {
    const hud = document.createElement('div');
    hud.className = 'oa-hud-wrapper';
    hud.id = 'oa-hud';

    hud.innerHTML = `
      <div class="oa-hud-header">
        <div class="oa-hud-left">
          <div class="oa-hud-badge">
            <span class="oa-hud-badge-dot"></span>
            <span>OA Mode Active</span>
          </div>
          <div class="oa-segmented-switch" role="tablist" aria-label="Problem presentation mode">
            <button type="button" class="oa-switch-btn active" id="oaViewBtn" role="tab" aria-selected="true" title="View corporate engineering scenario">
              <span>OA Scenario</span>
            </button>
            <button type="button" class="oa-switch-btn" id="originalViewBtn" role="tab" aria-selected="false" title="View original LeetCode text and tags">
              <span>Original</span>
            </button>
          </div>
        </div>
        <div class="oa-hud-right">
          <button type="button" class="oa-hud-action-btn" id="oaRerollBtn" title="Re-roll engineering scenario">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            <span>Re-roll</span>
          </button>
        </div>
      </div>
      <div class="oa-hud-alert" id="oaAlertBar">
        <div class="oa-alert-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span id="oaAlertMsg">High assessment traffic. Please try again in a moment.</span>
        </div>
        <button type="button" class="oa-alert-dismiss" id="oaAlertDismiss" aria-label="Dismiss alert">&times;</button>
      </div>
    `;

    // Hook up segmented toggle
    const oaBtn = hud.querySelector('#oaViewBtn');
    const origBtn = hud.querySelector('#originalViewBtn');
    const rerollBtn = hud.querySelector('#oaRerollBtn');
    const alertDismiss = hud.querySelector('#oaAlertDismiss');

    oaBtn.addEventListener('click', () => switchView('oa'));
    origBtn.addEventListener('click', () => switchView('original'));
    rerollBtn.addEventListener('click', () => rerollStory());
    alertDismiss.addEventListener('click', () => hideAlert());

    return hud;
  }

  function showAlert(msg) {
    const alertBar = document.getElementById('oaAlertBar');
    const alertMsg = document.getElementById('oaAlertMsg');
    if (alertBar && alertMsg) {
      alertMsg.textContent = msg || 'High assessment traffic. Please try again in a moment.';
      alertBar.classList.add('visible');
    }
  }

  function hideAlert() {
    const alertBar = document.getElementById('oaAlertBar');
    if (alertBar) {
      alertBar.classList.remove('visible');
    }
  }

  /**
   * Switch between "OA Scenario" and "Original" LeetCode view
   */
  function switchView(view) {
    currentView = view;
    const oaBtn = document.getElementById('oaViewBtn');
    const origBtn = document.getElementById('originalViewBtn');

    if (view === 'oa') {
      if (oaBtn) {
        oaBtn.classList.add('active');
        oaBtn.setAttribute('aria-selected', 'true');
      }
      if (origBtn) {
        origBtn.classList.remove('active');
        origBtn.setAttribute('aria-selected', 'false');
      }
      updateCrutchBlinder(true);

      if (narrativeContainerEl) {
        narrativeContainerEl.style.display = 'block';
      }
      hideOriginalNodes();
    } else {
      if (oaBtn) {
        oaBtn.classList.remove('active');
        oaBtn.setAttribute('aria-selected', 'false');
      }
      if (origBtn) {
        origBtn.classList.add('active');
        origBtn.setAttribute('aria-selected', 'true');
      }
      updateCrutchBlinder(false);

      if (narrativeContainerEl) {
        narrativeContainerEl.style.display = 'none';
      }
      showOriginalNodes();
    }
  }

  function hideOriginalNodes() {
    cachedOriginalNodes.forEach(node => {
      if (node && node.style) {
        node.style.display = 'none';
      }
    });

    // Also blank out direct Text nodes in originalContainerEl to prevent unstyled text leakage
    if (originalContainerEl) {
      Array.from(originalContainerEl.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          node._oaOriginalText = node.textContent;
          node.textContent = '';
        }
      });
    }
  }

  function showOriginalNodes() {
    cachedOriginalNodes.forEach(node => {
      if (node && node.style) {
        node.style.display = '';
      }
    });

    // Restore blanked text nodes
    if (originalContainerEl) {
      Array.from(originalContainerEl.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && typeof node._oaOriginalText === 'string') {
          node.textContent = node._oaOriginalText;
          delete node._oaOriginalText;
        }
      });
    }
  }

  /**
   * Re-roll the narrative (force fresh generation)
   */
  async function rerollStory() {
    if (isGenerating || !currentSlug) return;
    const rerollBtn = document.getElementById('oaRerollBtn');
    if (rerollBtn) {
      rerollBtn.disabled = true;
      rerollBtn.classList.add('spinning');
    }

    hideAlert();
    await generateAndRenderStory(true);

    // Cooldown
    setTimeout(() => {
      if (rerollBtn) {
        rerollBtn.disabled = false;
        rerollBtn.classList.remove('spinning');
      }
    }, 4000);
  }

  /**
   * Generate story via API and render into DOM
   */
  async function generateAndRenderStory(forceRefresh = false) {
    if (!originalContainerEl || !currentSlug) return;
    isGenerating = true;

    // Show skeleton loader
    if (!narrativeContainerEl) {
      narrativeContainerEl = document.createElement('div');
      narrativeContainerEl.className = 'oa-narrative-container';
      originalContainerEl.appendChild(narrativeContainerEl);
    }

    narrativeContainerEl.innerHTML = `
      <div class="oa-skeleton-wrapper">
        <div class="oa-skeleton-line oa-skeleton-title"></div>
        <div class="oa-skeleton-line"></div>
        <div class="oa-skeleton-line"></div>
        <div class="oa-skeleton-line" style="width: 80%"></div>
        <div class="oa-skeleton-line oa-skeleton-sub"></div>
        <div class="oa-skeleton-line" style="width: 90%"></div>
        <div class="oa-skeleton-line" style="width: 70%"></div>
      </div>
    `;

    // Check local storage cache first with reliable validation
    const cacheKey = `lc_oa_${currentSlug}`;
    if (!forceRefresh && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const cached = await new Promise(resolve => chrome.storage.local.get([cacheKey], resolve));
      const entry = cached ? cached[cacheKey] : null;

      if (entry) {
        // Validate cached entry before rendering
        if (typeof entry === 'object' && entry.slug === currentSlug && typeof entry.story === 'string' && entry.story.length > 50) {
          renderStoryMarkdown(entry.story);
          isGenerating = false;
          return;
        } else if (typeof entry === 'string' && entry.length > 50) {
          // Backward compatibility for existing simple string caches
          renderStoryMarkdown(entry);
          isGenerating = false;
          return;
        } else {
          // Discard corrupt cache entry
          chrome.storage.local.remove([cacheKey]);
        }
      }
    }

    // Extract content from original nodes — use innerHTML to preserve sub/sup tags,
    // then strip all other HTML tags, keeping only safe math-relevant ones.
    const rawContent = extractCleanContent(cachedOriginalNodes);
    const originalConstraints = extractOriginalConstraints(cachedOriginalNodes);
    const originalSamples = extractOriginalSampleCases(cachedOriginalNodes);
    const title = getProblemTitle();

    // If user hasn't configured an API key yet, show friendly onboarding callout
    if (!userApiKey) {
      isGenerating = false;
      narrativeContainerEl.innerHTML = `
        <div style="padding: 32px 16px; color: #d4d4d8; text-align: center; background: rgba(24, 24, 27, 0.6); border: 1px solid #3f3f46; border-radius: 8px; margin: 16px 0;">
          <div style="font-size: 17px; font-weight: 600; color: #fbbf24; margin-bottom: 8px;">⚡ Free Groq API Key Required</div>
          <p style="font-size: 13.5px; color: #a1a1aa; max-width: 460px; margin: 0 auto 14px; line-height: 1.5;">
            OA-ify needs a free Groq API key to generate corporate OA scenarios. It takes 30 seconds to get one, with no credit card required.
          </p>
          <div style="font-size: 12.5px; color: #71717a;">
            👉 Click the <strong>OA-ify icon</strong> in your browser extensions toolbar to paste your key.
          </div>
        </div>
      `;
      return;
    }

    // Call API with structured output
    const result = await OA_API.generateOANarrative({
      title: title,
      content: rawContent,
      apiKey: userApiKey
    });

    isGenerating = false;

    if (result.success && result.storyData) {
      // Assemble structured LLM narrative with verbatim original constraints and test cases
      const assembledMarkdown = assembleProblemMarkdown(
        result.storyData,
        originalConstraints,
        originalSamples
      );

      // Cache locally with metadata
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const update = {};
        update[cacheKey] = {
          version: 2,
          slug: currentSlug,
          timestamp: Date.now(),
          story: assembledMarkdown
        };
        chrome.storage.local.set(update);
      }
      renderStoryMarkdown(assembledMarkdown);
    } else {
      // Revert skeleton and show graceful fallback with View Original option
      const safeMsg = OAMarkdown.escape(result.message || 'Unable to generate OA narrative.');
      narrativeContainerEl.innerHTML = `
        <div style="padding: 24px 16px; color: #a1a1aa; text-align: center; background: rgba(24, 24, 27, 0.4); border: 1px solid #3f3f46; border-radius: 8px; margin: 16px 0;">
          <p style="margin-bottom: 12px; color: #f87171;">${safeMsg}</p>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button type="button" class="oa-hud-action-btn" id="oaRetryBtn">Try Again</button>
            <button type="button" class="oa-hud-action-btn" id="oaFallbackViewBtn">View Original Problem</button>
          </div>
        </div>
      `;
      const retryBtn = document.getElementById('oaRetryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => generateAndRenderStory(true));
      }
      const fallbackBtn = document.getElementById('oaFallbackViewBtn');
      if (fallbackBtn) {
        fallbackBtn.addEventListener('click', () => switchView('original'));
      }
      showAlert(result.message);
    }
  }

  /**
   * Helper to convert HTML to text while preserving superscripts and subscripts
   */
  function htmlWithPowers(html) {
    if (!html) return '';
    return html
      .replace(/<sup>(.*?)<\/sup>/gi, '^$1')
      .replace(/<sub>(.*?)<\/sub>/gi, '_$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&le;/g, '<=')
      .replace(/&ge;/g, '>=')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  /**
   * Extracts constraints verbatim from original DOM nodes, preserving powers and stripping follow-ups
   */
  function extractOriginalConstraints(nodes) {
    if (!nodes || !nodes.length) return '';
    const items = [];

    for (const node of nodes) {
      const uls = node.querySelectorAll ? node.querySelectorAll('ul') : [];
      for (const ul of uls) {
        const prev = ul.previousElementSibling;
        if (prev && /constraints/i.test(prev.textContent || '')) {
          const lis = Array.from(ul.querySelectorAll('li'));
          for (const li of lis) {
            const text = htmlWithPowers(li.innerHTML || li.textContent || '');
            // Stop immediately if a Follow-up or Related Topics line is reached
            if (/\bFollow[- ]up\b/i.test(text) || /\bRelated Topics\b/i.test(text)) {
              break;
            }
            if (text) items.push(text);
          }
          if (items.length > 0) return items.join('\n');
        }
      }
    }

    // Fallback: search text across nodes, strictly stopping before Follow-up or Related Topics
    const combinedHtml = nodes.map(n => n.innerHTML || n.textContent || '').join('\n');
    const cleanedText = htmlWithPowers(combinedHtml);
    const match = cleanedText.match(/Constraints:\s*([\s\S]*?)(?=(?:\bFollow[- ]up\b|\bRelated Topics\b|Example|\n\n\n|$))/i);
    if (match && match[1].trim()) {
      return match[1].trim()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !/\bFollow[- ]up\b/i.test(line) && !/\bRelated Topics\b/i.test(line))
        .join('\n');
    }

    return '';
  }

  /**
   * Extracts original sample test cases verbatim from <pre> tags
   */
  function extractOriginalSampleCases(nodes) {
    if (!nodes || !nodes.length) return '';
    const samples = [];
    let idx = 0;

    nodes.forEach(node => {
      const pres = node.querySelectorAll ? node.querySelectorAll('pre') : [];
      pres.forEach(pre => {
        const text = htmlWithPowers(pre.innerHTML || pre.textContent || '');
        if (/Input:/i.test(text) && /Output:/i.test(text)) {
          const inputMatch = text.match(/Input:\s*([\s\S]*?)(?=(?:Output:|$))/i);
          const outputMatch = text.match(/Output:\s*([\s\S]*?)(?=(?:Explanation:|$))/i);
          const explMatch = text.match(/Explanation:\s*([\s\S]*?)$/i);

          const inputVal = inputMatch ? inputMatch[1].trim() : '';
          const outputVal = outputMatch ? outputMatch[1].trim() : '';
          const explVal = explMatch ? explMatch[1].trim() : '';

          samples.push(
            `**Sample Input ${idx}**\n\`\`\`\n${inputVal}\n\`\`\`\n` +
            `**Sample Output ${idx}**\n\`\`\`\n${outputVal}\n\`\`\`` +
            (explVal ? `\n\n**Explanation ${idx}**\n\n${explVal}` : '')
          );
          idx++;
        }
      });
    });

    return samples.join('\n\n---\n\n');
  }

  /**
   * Assembles final markdown by combining LLM narrative with verbatim original constraints and test cases
   */
  function assembleProblemMarkdown(storyData, constraints, samples) {
    let md = `**Problem Statement**\n\n${storyData.scenario || ''}\n\n`;

    if (storyData.functionDescription) {
      md += `---\n\n**Function Description**\n\n${storyData.functionDescription}\n\n`;
    }

    if (Array.isArray(storyData.parameters) && storyData.parameters.length > 0) {
      md += `**Parameters**\n\n`;
      storyData.parameters.forEach(p => {
        md += `- \`${p.name || 'param'}\`${p.type ? ` (${p.type})` : ''}: ${p.description || ''}\n`;
      });
      md += `\n`;
    }

    if (storyData.returns && (storyData.returns.type || storyData.returns.description)) {
      md += `**Returns**\n\n- \`${storyData.returns.type || 'result'}\`: ${storyData.returns.description || ''}\n\n`;
    }

    md += `---\n\n**Constraints**\n\n`;
    if (constraints && constraints.trim()) {
      md += constraints.split('\n')
        .map(c => c.trim())
        .filter(c => c && !/\bFollow[- ]up\b/i.test(c) && !/\bRelated Topics\b/i.test(c))
        .map(c => /^[-*•]\s+/.test(c) ? c : `- ${c}`)
        .join('\n') + `\n\n`;
    } else {
      md += `(Preserved from original LeetCode specification)\n\n`;
    }

    if (storyData.notes) {
      md += `---\n\n**Note**\n\n${storyData.notes}\n\n`;
    }

    if (samples && samples.trim()) {
      md += `---\n\n${samples}\n`;
    }

    return md;
  }

  /**
   * Render markdown into narrative container
   */
  function renderStoryMarkdown(md) {
    if (!narrativeContainerEl) return;
    const html = OAMarkdown.render(md);
    narrativeContainerEl.innerHTML = html;

    // Attach copy button handlers
    narrativeContainerEl.querySelectorAll('.oa-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const rawCode = decodeURIComponent(btn.getAttribute('data-code') || '');
        navigator.clipboard.writeText(rawCode).then(() => {
          const span = btn.querySelector('span');
          if (span) {
            span.textContent = 'Copied!';
            setTimeout(() => { span.textContent = 'Copy'; }, 1500);
          }
        });
      });
    });
  }

  /**
   * Extracts clean text from the original description nodes.
   * Uses innerHTML to preserve <sup>/<sub>, then strips remaining tags,
   * and cuts off any Follow-up / Note / Related Topics boilerplate.
   */
  function extractCleanContent(nodes) {
    const combined = nodes.map(n => {
      // Get inner HTML to preserve <sup>, <sub>
      let html = n.innerHTML || n.textContent || '';
      // Keep <sup> and <sub> tags; strip everything else
      html = html
        .replace(/<sup>/gi, '{SUP}')
        .replace(/<\/sup>/gi, '{/SUP}')
        .replace(/<sub>/gi, '{SUB}')
        .replace(/<\/sub>/gi, '{/SUB}')
        .replace(/<[^>]+>/g, '') // strip all other HTML
        .replace(/\{SUP\}/g, '<sup>')
        .replace(/\{\/SUP\}/g, '</sup>')
        .replace(/\{SUB\}/g, '<sub>')
        .replace(/\{\/SUB\}/g, '</sub>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      return html;
    }).join('\n').trim();

    // Cut off anything after "Follow up", "Follow-up", or "Related Topics"
    // These are LeetCode-specific artifacts not relevant to the core problem
    const cutPatterns = [
      /\bFollow[- ]up:?\b/i,
      /\bRelated Topics\b/i
    ];
    let cutIndex = combined.length;
    for (const pattern of cutPatterns) {
      const match = pattern.exec(combined);
      if (match && match.index < cutIndex) {
        cutIndex = match.index;
      }
    }

    return combined.slice(0, cutIndex).trim();
  }

  /**
   * Initialize OA-ify on current problem page
   */
  async function initProblemPage() {
    const slug = getProblemSlug();
    if (!slug) return;

    // Bail early only if this exact slug is already fully mounted
    // (guard against double-fire from MutationObserver bursts)
    if (slug === currentSlug && document.getElementById('oa-hud')) return;

    currentSlug = slug;
    currentView = 'oa';
    narrativeContainerEl = null; // force fresh narrative node for new problem

    // Retry finding the description container — React may not have mounted it yet
    const container = await waitForDescriptionContainer(8, 350);
    if (!container) {
      console.warn('[OA-ify] Description container not found after retries, skipping.');
      return;
    }

    originalContainerEl = container;

    // Cache original children nodes (exclude any OA elements we injected)
    cachedOriginalNodes = Array.from(container.children).filter(
      c => !c.classList.contains('oa-hud-wrapper') && !c.classList.contains('oa-narrative-container')
    );

    // Inject HUD bar at the top if not present
    if (!document.getElementById('oa-hud')) {
      hudElement = createHudElement();
      container.insertBefore(hudElement, container.firstChild);
    }

    updateCrutchBlinder(true);
    hideOriginalNodes();

    // Check if auto load enabled
    if (isAutoLoadEnabled) {
      await generateAndRenderStory(false);
    } else {
      switchView('original');
    }
  }

  /**
   * Polls for the description container up to `maxRetries` times,
   * waiting `delayMs` between attempts. Returns the element or null.
   */
  function waitForDescriptionContainer(maxRetries, delayMs) {
    return new Promise(resolve => {
      let attempts = 0;
      function attempt() {
        const el = findDescriptionContainer();
        if (el) return resolve(el);
        attempts++;
        if (attempts >= maxRetries) return resolve(null);
        setTimeout(attempt, delayMs);
      }
      attempt();
    });
  }

  /**
   * Tears down all OA-ify state for the current problem.
   * Called when the URL changes before a new problem mounts.
   */
  function resetState() {
    // Remove injected HUD from DOM if it's still attached
    const existingHud = document.getElementById('oa-hud');
    if (existingHud) existingHud.remove();

    // Remove injected narrative container
    if (narrativeContainerEl && narrativeContainerEl.parentNode) {
      narrativeContainerEl.remove();
    }

    // Restore any hidden original nodes
    restoreHiddenElements();
    document.body.classList.remove('oa-blind-crutches');

    // Clear all state references
    hudElement = null;
    narrativeContainerEl = null;
    originalContainerEl = null;
    cachedOriginalNodes = [];
    currentSlug = null;
    isGenerating = false;
  }

  /**
   * Load user preferences from storage
   */
  function loadPreferences(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const storage = chrome.storage.sync || chrome.storage.local;
      storage.get(['oa_enabled', 'oa_auto_load', 'oa_api_key'], (res) => {
        isOaEnabled = res.oa_enabled !== false;
        isAutoLoadEnabled = res.oa_auto_load !== false;
        userApiKey = res.oa_api_key || '';
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  // Listen for messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'OA_STATE_CHANGED') {
        isOaEnabled = msg.enabled;
        if (!isOaEnabled) {
          switchView('original');
          if (hudElement) hudElement.style.display = 'none';
        } else {
          if (hudElement) hudElement.style.display = '';
          switchView('oa');
        }
      } else if (msg.type === 'OA_AUTO_LOAD_CHANGED') {
        isAutoLoadEnabled = msg.autoLoad;
      } else if (msg.type === 'OA_CACHE_CLEARED') {
        if (currentSlug && isOaEnabled) {
          generateAndRenderStory(true);
        }
      } else if (msg.type === 'OA_API_KEY_UPDATED') {
        userApiKey = msg.apiKey || '';
        if (currentSlug && isOaEnabled) {
          generateAndRenderStory(true);
        }
      }
      sendResponse({ status: 'ok' });
    });
  }

  // ── SPA Navigation Detection ─────────────────────────────────────────────
  // Intercept pushState/replaceState (used by React Router for SPA navigation)
  // so we get an immediate signal when LeetCode navigates to a new problem.
  (function patchHistory() {
    const wrap = (original) => function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('oa-locationchange'));
      return result;
    };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', () =>
      window.dispatchEvent(new Event('oa-locationchange'))
    );
  })();

  window.addEventListener('oa-locationchange', () => {
    const newHref = location.href;
    if (newHref === lastUrl) return;
    lastUrl = newHref;

    if (!location.pathname.startsWith('/problems/') || !isOaEnabled) return;

    // Tear down old problem state immediately
    resetState();

    // Delay init to give React time to mount the new problem's DOM
    setTimeout(() => {
      if (location.pathname.startsWith('/problems/') && isOaEnabled) {
        initProblemPage();
      }
    }, 1000);
  });

  // MutationObserver as a secondary fallback for initial page loads and
  // edge cases where pushState isn't intercepted in time
  const observer = new MutationObserver(() => {
    if (!location.pathname.startsWith('/problems/') || !isOaEnabled) return;
    if (!document.getElementById('oa-hud') && getProblemSlug() && getProblemSlug() !== currentSlug) {
      // Debounce: use a short timeout to let DOM settle
      clearTimeout(observer._debounce);
      observer._debounce = setTimeout(initProblemPage, 600);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial load
  loadPreferences(() => {
    if (location.pathname.startsWith('/problems/') && isOaEnabled) {
      setTimeout(initProblemPage, 900);
    }
  });
})();
