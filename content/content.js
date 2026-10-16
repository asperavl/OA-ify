/**
 * OA-ify Content Script
 * Injected into leetcode.com/problems/*
 * - Uses LeetCode GraphQL API for clean problem data (zero DOM scraping).
 * - Mounts HUD and narrative container strictly inside the left description panel.
 * - Leaves the right-hand code editor, language selector, and toolbars 100% untouched.
 * - The HUD remains pinned at the top so the user can freely toggle between "OA Scenario" and "Original".
 * - Zero FOUC: Injects .oa-active at document_start to block raw text before the first paint.
 * - Blinds trailing clues: Hides acceptance stats, Topics, Companies, Similar Questions, and Discussion.
 */
(function () {
  'use strict';

  // ── Immediate Zero-FOUC Guard at document_start ────────────────────────────
  // Attach blinder classes synchronously so the CSS engine hides raw problem
  // text and trailing clues before the browser paints the first frame.
  if (location.pathname.startsWith('/problems/')) {
    document.documentElement.classList.add('oa-active', 'oa-blind-crutches');
  }

  let currentSlug = null;
  let isOaEnabled = true;
  let isAutoLoadEnabled = true;
  let currentView = 'oa'; // 'oa' or 'original'
  let isGenerating = false;
  let userApiKey = '';
  let lastUrl = location.href;

  // DOM references within the left description container
  let containerEl = null;
  let hudElement = null;
  let narrativeContainerEl = null;
  let cachedOriginalNodes = [];

  /**
   * Extract current LeetCode problem slug from URL
   */
  function getProblemSlug() {
    const match = location.pathname.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Locate the problem description content container in LeetCode's DOM.
   * Uses textContent or child count so it NEVER breaks when elements are styled.
   */
  function findDescriptionContainer() {
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
      if (el && (el.children.length > 0 || (el.textContent && el.textContent.trim().length > 20))) {
        return el;
      }
    }
    return null;
  }

  /**
   * Polls for the description container until React mounts it
   */
  function waitForDescriptionContainer(maxRetries = 40, delayMs = 50) {
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
   * Helper to locate the left pane container in LeetCode's DOM
   */
  function getLeftPane() {
    if (containerEl) {
      return containerEl.closest('.flexlayout__tab') ||
             containerEl.closest('#qd-content > div') ||
             containerEl.parentElement?.parentElement?.parentElement ||
             containerEl.parentElement;
    }
    const content = findDescriptionContainer();
    if (content) {
      return content.closest('.flexlayout__tab') ||
             content.closest('#qd-content > div') ||
             content.parentElement?.parentElement?.parentElement ||
             content.parentElement;
    }
    return null;
  }

  /**
   * Hide trailing clue elements directly after the description container
   */
  function hideTrailingClues() {
    if (!containerEl) return;
    let sibling = containerEl.nextElementSibling;
    while (sibling) {
      if (!sibling.classList.contains('oa-hud-wrapper') && !sibling.classList.contains('oa-narrative-container')) {
        sibling.style.setProperty('display', 'none', 'important');
        sibling.dataset.oaClueHidden = 'true';
      }
      sibling = sibling.nextElementSibling;
    }
    scanAndHideClues();
  }

  /**
   * Scans the left pane for known clue accordions and cards
   * (Topics, Companies, Similar Questions, Discussion, Hints, Acceptance stats).
   * STRICT GUARD: NEVER hides any container that contains the HUD or problem container.
   */
  function scanAndHideClues() {
    if (!isOaEnabled || currentView !== 'oa') return;
    const leftPane = getLeftPane();
    if (!leftPane) return;

    // A. Direct Attribute Selectors for known LeetCode clue containers
    const clueSelectors = [
      '[data-key="hints-wrapper"]',
      '[data-track-load*="similar"]',
      '[data-e2e-locator="topic-tag"]',
      '[class*="topic-tag"]',
      'a[href*="/tag/"]',
      'a[href*="/company/"]'
    ];

    leftPane.querySelectorAll(clueSelectors.join(',')).forEach(el => {
      let card = el.closest('.group') || el.parentElement?.parentElement || el.parentElement;
      if (!card || card.contains(containerEl) || (hudElement && card.contains(hudElement)) || card === leftPane) {
        return;
      }
      if (!card.dataset.oaClueHidden) {
        card.dataset.oaClueHidden = 'true';
        card.style.setProperty('display', 'none', 'important');
      }
    });

    // B. Text-Based Header Matching (Topics, Companies, Similar Questions, Discussion, Hints, Acceptance Rate)
    const clueKeywords = ['topics', 'companies', 'similar questions', 'discussion', 'hint', 'acceptance rate', 'accepted '];

    leftPane.querySelectorAll('div, span, p, a, button, h4, h5').forEach(el => {
      if (el.closest('.oa-hud-wrapper') || el.closest('.oa-narrative-container')) return;
      if (el.children.length > 2) return;
      const rawText = el.textContent ? el.textContent.trim().toLowerCase() : '';
      if (!rawText || rawText.length > 50) return;

      const matches = clueKeywords.some(kw => {
        if (kw === 'discussion') return rawText.startsWith('discussion');
        if (kw === 'hint') return rawText.startsWith('hint');
        if (kw === 'accepted ') return rawText.startsWith('accepted ');
        if (kw === 'acceptance rate') return rawText.includes('acceptance rate');
        return rawText === kw;
      });

      if (matches) {
        let card = el.closest('.group') || el.parentElement?.parentElement || el.parentElement;

        // STRICT INVARIANT: NEVER hide anything that contains our HUD or problem container
        if (!card || card.contains(containerEl) || (hudElement && card.contains(hudElement)) || card === leftPane) {
          return;
        }

        card.dataset.oaClueHidden = 'true';
        card.style.setProperty('display', 'none', 'important');
      }
    });

    // C. Copyright notice & feedback row
    leftPane.querySelectorAll('div, p, span').forEach(el => {
      if (el.closest('.oa-hud-wrapper') || el.closest('.oa-narrative-container')) return;
      if (el.textContent && el.textContent.includes('Copyright ©') && el.textContent.includes('LeetCode')) {
        let footer = el.parentElement || el;
        if (!footer.contains(containerEl) && (!hudElement || !footer.contains(hudElement))) {
          footer.dataset.oaClueHidden = 'true';
          footer.style.setProperty('display', 'none', 'important');
        }
      }
    });
  }

  /**
   * Restore all trailing clue elements when the user toggles back to "Original"
   */
  function restoreTrailingClues() {
    document.querySelectorAll('[data-oa-clue-hidden="true"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.oaClueHidden;
    });
  }

  /**
   * Apply or remove crutch-blinder styles and trailing clues
   */
  function updateCrutchBlinder(blind) {
    if (blind && isOaEnabled && currentView === 'oa') {
      document.documentElement.classList.add('oa-active', 'oa-blind-crutches');
      if (document.body) document.body.classList.add('oa-active', 'oa-blind-crutches');
      hideTrailingClues();
      scanAndHideTabs();
    } else {
      document.documentElement.classList.remove('oa-active', 'oa-blind-crutches');
      if (document.body) document.body.classList.remove('oa-active', 'oa-blind-crutches');
      restoreTrailingClues();
      restoreHiddenTabs();
    }
  }

  const HIDDEN_TAB_KEYWORDS = ['editorial', 'solutions'];

  function scanAndHideTabs() {
    document.querySelectorAll('div.flexlayout__tab_button').forEach(tab => {
      if (tab.dataset.oaNavHidden) return;
      const txt = tab.textContent?.trim().toLowerCase() || '';
      if (HIDDEN_TAB_KEYWORDS.some(kw => txt.includes(kw))) {
        tab.dataset.oaNavHidden = 'true';
        tab.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function restoreHiddenTabs() {
    document.querySelectorAll('[data-oa-nav-hidden="true"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.oaNavHidden;
    });
  }

  /**
   * Builds the HUD toolbar header
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
            <button type="button" class="oa-switch-btn ${currentView === 'oa' ? 'active' : ''}" id="oaViewBtn" role="tab" aria-selected="${currentView === 'oa'}">
              <span>OA Scenario</span>
            </button>
            <button type="button" class="oa-switch-btn ${currentView === 'original' ? 'active' : ''}" id="originalViewBtn" role="tab" aria-selected="${currentView === 'original'}">
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
          <span id="oaAlertMsg"></span>
        </div>
        <button type="button" class="oa-alert-dismiss" id="oaAlertDismiss" aria-label="Dismiss alert">&times;</button>
      </div>
    `;

    hud.querySelector('#oaViewBtn').addEventListener('click', () => switchView('oa'));
    hud.querySelector('#originalViewBtn').addEventListener('click', () => switchView('original'));
    hud.querySelector('#oaRerollBtn').addEventListener('click', () => rerollStory());
    hud.querySelector('#oaAlertDismiss').addEventListener('click', () => hideAlert());

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
    if (alertBar) alertBar.classList.remove('visible');
  }

  /**
   * Switch between "OA Scenario" and "Original" view without removing the HUD
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
      if (narrativeContainerEl) {
        narrativeContainerEl.style.display = 'block';
      }
      hideOriginalNodes();
      updateCrutchBlinder(true);
    } else {
      if (oaBtn) {
        oaBtn.classList.remove('active');
        oaBtn.setAttribute('aria-selected', 'false');
      }
      if (origBtn) {
        origBtn.classList.add('active');
        origBtn.setAttribute('aria-selected', 'true');
      }
      if (narrativeContainerEl) {
        narrativeContainerEl.style.display = 'none';
      }
      showOriginalNodes();
      updateCrutchBlinder(false);
    }
  }

  function hideOriginalNodes() {
    cachedOriginalNodes.forEach(node => {
      if (node && node.style) {
        node.style.display = 'none';
      }
    });
  }

  function showOriginalNodes() {
    cachedOriginalNodes.forEach(node => {
      if (node && node.style) {
        node.style.display = '';
      }
    });
  }

  /**
   * Render loading skeleton into narrative container
   */
  function renderSkeleton() {
    if (!narrativeContainerEl) return;
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
  }

  /**
   * Render free API key onboarding callout
   */
  function renderOnboardingCallout() {
    if (!narrativeContainerEl) return;
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
  }

  /**
   * Render error state with graceful retry and switch-to-original options
   */
  function renderError(msg) {
    if (!narrativeContainerEl) return;
    const safeMsg = OAMarkdown.escape(msg || 'Unable to generate OA narrative.');
    narrativeContainerEl.innerHTML = `
      <div style="padding: 24px 16px; color: #a1a1aa; text-align: center; background: rgba(24, 24, 27, 0.4); border: 1px solid #3f3f46; border-radius: 8px; margin: 16px 0;">
        <p style="margin-bottom: 12px; color: #f87171;">${safeMsg}</p>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button type="button" class="oa-hud-action-btn" id="oaRetryBtn">Try Again</button>
          <button type="button" class="oa-hud-action-btn" id="oaFallbackViewBtn">View Original Problem</button>
        </div>
      </div>
    `;

    const retryBtn = narrativeContainerEl.querySelector('#oaRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => generateAndRenderStory(true));

    const fallbackBtn = narrativeContainerEl.querySelector('#oaFallbackViewBtn');
    if (fallbackBtn) fallbackBtn.addEventListener('click', () => switchView('original'));

    showAlert(msg);
  }

  /**
   * Renders the generated markdown content inside the narrative container
   */
  function renderMarkdownContent(markdownText) {
    if (!narrativeContainerEl) return;
    narrativeContainerEl.innerHTML = OAMarkdown.render(markdownText);

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
   * Re-roll the narrative (force fresh generation from API)
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

    setTimeout(() => {
      if (rerollBtn) {
        rerollBtn.disabled = false;
        rerollBtn.classList.remove('spinning');
      }
    }, 3000);
  }

  const CACHE_SCHEMA_VERSION = 3;

  /**
   * Validates cached story against schema version and corruption heuristics.
   */
  function isCacheValid(entry, slug) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.version !== CACHE_SCHEMA_VERSION) return false;
    if (entry.slug !== slug) return false;
    if (!entry.story || typeof entry.story !== 'string' || entry.story.length < 50) return false;
    // Discard any historical corrupted entries with unescaped \n\n, broken powers, or int[] types
    if (entry.story.includes('\\n\\n') || /\b104\b/.test(entry.story) || /\b-109\b/.test(entry.story) || /\(int\[\]\)/.test(entry.story)) {
      return false;
    }
    return true;
  }

  /**
   * Fetches problem via GraphQL, calls Groq, and renders the OA scenario
   */
  async function generateAndRenderStory(forceRefresh = false) {
    if (!containerEl || !currentSlug) return;
    const cacheKey = `lc_oa_${currentSlug}`;

    // 1. Check local storage cache first
    if (!forceRefresh && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const cached = await new Promise(r => chrome.storage.local.get([cacheKey], r));
      const entry = cached ? cached[cacheKey] : null;

      if (entry) {
        if (isCacheValid(entry, currentSlug)) {
          renderMarkdownContent(entry.story);
          return;
        } else {
          chrome.storage.local.remove([cacheKey]);
        }
      }
    }

    // 2. Show skeleton while generating
    renderSkeleton();

    // 3. Verify user API key
    if (!userApiKey) {
      renderOnboardingCallout();
      return;
    }

    isGenerating = true;

    // 4. Fetch clean problem data directly from LeetCode GraphQL API
    const problem = await OA_API.fetchLeetCodeProblem(currentSlug);
    if (!problem || !problem.content) {
      isGenerating = false;
      renderError('Could not retrieve problem details from LeetCode. Please check your network.');
      return;
    }

    // 5. Extract verbatim invariants directly from GraphQL HTML
    const originalConstraints = OA_API.extractConstraintsFromHtml(problem.content);
    const originalSamples = OA_API.extractSampleCasesFromHtml(problem.content);
    const cleanContent = OA_API.cleanProblemHtml(problem.content);

    // 6. Call Groq AI to generate corporate engineering narrative
    const result = await OA_API.generateOANarrative({
      title: problem.title,
      content: cleanContent,
      apiKey: userApiKey
    });

    isGenerating = false;

    if (result.success && result.storyData) {
      const assembledMarkdown = OA_API.assembleProblemMarkdown(
        result.storyData,
        originalConstraints,
        originalSamples
      );

      // Save to local cache
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          [cacheKey]: {
            version: CACHE_SCHEMA_VERSION,
            slug: currentSlug,
            timestamp: Date.now(),
            story: assembledMarkdown
          }
        });
      }

      renderMarkdownContent(assembledMarkdown);
    } else {
    }
  }

  /**
   * Main page initialization entry point
   */
  async function initProblemPage() {
    const slug = getProblemSlug();
    if (!slug) return;

    // Wait for the description container to appear in the DOM
    const container = await waitForDescriptionContainer(40, 50);
    if (!container) {
      console.warn('[OA-ify] Description container not found after retries.');
      return;
    }

    // If already mounted for this slug, return early
    if (slug === currentSlug && document.getElementById('oa-hud')) return;

    currentSlug = slug;
    containerEl = container;
    currentView = 'oa';

    // Cache original children nodes
    cachedOriginalNodes = Array.from(container.children).filter(
      c => !c.classList.contains('oa-hud-wrapper') && !c.classList.contains('oa-narrative-container')
    );

    // Inject HUD toolbar at the top of the description container (if not present)
    if (!document.getElementById('oa-hud')) {
      hudElement = createHudElement();
      container.insertBefore(hudElement, container.firstChild);
    } else {
      hudElement = document.getElementById('oa-hud');
    }

    // Inject narrative container right after HUD (if not present)
    if (!container.querySelector('.oa-narrative-container')) {
      narrativeContainerEl = document.createElement('div');
      narrativeContainerEl.className = 'oa-narrative-container';
      container.appendChild(narrativeContainerEl);
    } else {
      narrativeContainerEl = container.querySelector('.oa-narrative-container');
    }

    // Handle view state
    if (!isOaEnabled) {
      switchView('original');
      if (hudElement) hudElement.style.display = 'none';
      return;
    }

    if (hudElement) hudElement.style.display = '';
    switchView('oa');

    if (isAutoLoadEnabled) {
      await generateAndRenderStory(false);
    } else {
      switchView('original');
    }
  }

  /**
   * Tears down problem-specific state on navigation
   */
  function resetState() {
    const existingHud = document.getElementById('oa-hud');
    if (existingHud) existingHud.remove();

    if (narrativeContainerEl && narrativeContainerEl.parentNode) {
      narrativeContainerEl.remove();
    }

    // Only restore native view if OA mode was actually turned off by the user
    if (!isOaEnabled) {
      showOriginalNodes();
      restoreTrailingClues();
      restoreHiddenTabs();
      document.documentElement.classList.remove('oa-active', 'oa-blind-crutches');
      if (document.body) document.body.classList.remove('oa-active', 'oa-blind-crutches');
    }

    hudElement = null;
    narrativeContainerEl = null;
    containerEl = null;
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
        if (!isOaEnabled) {
          document.documentElement.classList.remove('oa-active', 'oa-blind-crutches');
          if (document.body) document.body.classList.remove('oa-active', 'oa-blind-crutches');
        }
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
          if (narrativeContainerEl && (!narrativeContainerEl.innerHTML || narrativeContainerEl.innerHTML.trim() === '')) {
            generateAndRenderStory(false);
          }
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

    const newSlug = getProblemSlug();
    if (!newSlug) {
      resetState();
      return;
    }

    if (newSlug !== currentSlug) {
      resetState();
      initProblemPage();
    }
  });

  // Observer to detect container when navigating and continuously hide lazily-loaded clues
  const observer = new MutationObserver(() => {
    if (!location.pathname.startsWith('/problems/') || !isOaEnabled) return;
    const slug = getProblemSlug();
    if (slug && !document.getElementById('oa-hud') && findDescriptionContainer()) {
      clearTimeout(observer._debounce);
      observer._debounce = setTimeout(initProblemPage, 40);
    }
    if (currentView === 'oa') {
      clearTimeout(observer._clueDebounce);
      observer._clueDebounce = setTimeout(() => {
        scanAndHideClues();
        scanAndHideTabs();
      }, 100);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial load
  loadPreferences(() => {
    if (location.pathname.startsWith('/problems/') && isOaEnabled) {
      initProblemPage();
    }
  });
})();
