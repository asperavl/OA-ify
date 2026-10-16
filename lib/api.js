/**
 * OA-ify API Client & LeetCode GraphQL Data Client
 * 1. Fetches clean problem data directly from LeetCode's public GraphQL API (zero DOM scraping).
 * 2. Connects directly to Groq's inference engine using the user's BYOK key.
 * 3. Enforces language-agnostic types, multi-paragraph array schemas, and strict invariant validation.
 */
(function (global) {
  'use strict';

  const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';
  const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const DEFAULT_MODEL = 'openai/gpt-oss-20b';

  const SYSTEM_PROMPT = `You are a Principal Assessment Engineer writing an Online Assessment (OA) problem for software engineering candidates in the style of HackerRank and CodeSignal.
Your task is to transform the provided LeetCode problem into an authentic corporate engineering problem specification.

CRITICAL INVARIANTS:
1. SCENARIO AS PARAGRAPH ARRAY: Output "scenario" as a JSON array of 2-3 clean paragraph strings. Do NOT use literal "\\n" escapes.
2. NO LEETCODE LEAKS & NO FOLLOW-UPS: NEVER mention "LeetCode", algorithm names (e.g. "two pointers", "dynamic programming", "binary search"), difficulty badges, or follow-up questions (e.g. NEVER write "Can you come up with...").
3. CLOSED-VOCABULARY TYPES: Use ONLY canonical language-agnostic types:
   - "integer", "float", "string", "boolean", "character"
   - "integer array", "string array", "boolean array"
   - "2D integer array", "2D string array"
   - "key-value map"
   NEVER use language-specific syntax like 'int[]', 'vector<int>', 'List[int]', 'bool', etc.
4. FUNCTION DESCRIPTION: State clearly what the function computes. Do NOT include code signatures.
5. NOTES POLICY: Only include "notes" if there is a domain uniqueness or integrity guarantee (e.g. "Each input will have exactly one valid combination."). NEVER repeat numerical constraints or array lengths in notes. If no domain note is needed, set "notes": "".

FEW-SHOT EXAMPLES:

Example 1:
Problem: Two Sum
Output:
{
  "scenario": [
    "Your team maintains a distributed key-value storage system with an automated eviction policy.",
    "When memory usage reaches high watermark, the eviction coordinator identifies two cache blocks whose combined payload size exactly matches a target quota to free memory without fragmentation.",
    "Given an array of block sizes and a target quota, determine the zero-based indices of the two blocks that sum to the target."
  ],
  "functionDescription": "Identify the indices of two cache blocks whose combined size equals the target eviction quota.",
  "parameters": [
    { "name": "nums", "type": "integer array", "description": "Array of block payload sizes." },
    { "name": "target", "type": "integer", "description": "The exact combined target quota." }
  ],
  "returns": {
    "type": "integer array",
    "description": "Zero-based indices of the two selected blocks."
  },
  "notes": "Assume exactly one valid combination exists. The same block may not be used twice."
}

Example 2:
Problem: Number of Islands
Output:
{
  "scenario": [
    "You are developing a telemetry analysis service that processes satellite radar scans of maritime supply routes.",
    "The radar scan is represented as a 2D binary grid where 1 represents detected sea terrain and 0 represents open water.",
    "An island is formed by connecting adjacent land cells horizontally or vertically. You must count the total number of distinct landmasses in the scanned area."
  ],
  "functionDescription": "Calculate the total number of distinct landmasses in the radar grid.",
  "parameters": [
    { "name": "grid", "type": "2D integer array", "description": "2D grid representing radar terrain elevation data." }
  ],
  "returns": {
    "type": "integer",
    "description": "Total count of isolated landmasses."
  },
  "notes": "Assume all four edges of the grid are completely surrounded by water."
}`;

  /**
   * Fetches problem metadata directly from LeetCode's public GraphQL API.
   * Completely bypasses DOM scraping, CSS selector fragility, and timing issues.
   * @param {string} titleSlug - LeetCode problem slug (e.g. 'two-sum')
   * @returns {Promise<{ title: string, content: string, difficulty: string, questionId: string } | null>}
   */
  async function fetchLeetCodeProblem(titleSlug) {
    if (!titleSlug || typeof titleSlug !== 'string') return null;

    const query = `query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        title
        content
        difficulty
        topicTags { name }
      }
    }`;

    try {
      const response = await fetch(LEETCODE_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          operationName: 'questionData',
          variables: { titleSlug: titleSlug.trim() },
          query: query
        })
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json?.data?.question || null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Converts HTML text while preserving superscripts (^4) and subscripts (_i),
   * stripping other HTML tags and unescaping entities.
   */
  function htmlWithPowers(html) {
    if (!html || typeof html !== 'string') return '';
    return html
      // Extract LaTeX annotations if KaTeX is used
      .replace(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/gi, '$1')
      // HTML Superscripts & Subscripts
      .replace(/<sup>(.*?)<\/sup>/gi, '^$1')
      .replace(/<sub>(.*?)<\/sub>/gi, '_$1')
      // Unicode superscripts to ^num
      .replace(/([0-9a-zA-Z])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)/g, (match, base, sup) => {
        const map = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁺':'+','⁻':'-' };
        const converted = Array.from(sup).map(ch => map[ch] || ch).join('');
        return `${base}^${converted}`;
      })
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
   * Extracts verbatim numerical constraints from LeetCode problem HTML.
   * Preserves mathematical superscripts and strictly discards Follow-up questions.
   */
  function extractConstraintsFromHtml(html) {
    if (!html || typeof html !== 'string') return '';

    // Strategy 1: Look for <ul> following Constraints header
    const matchUl = html.match(/<strong[^>]*>Constraints:<\/strong>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (matchUl && matchUl[1]) {
      const liMatches = matchUl[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
      if (liMatches && liMatches.length > 0) {
        const items = [];
        for (const li of liMatches) {
          const text = htmlWithPowers(li);
          if (/\bFollow[- ]up\b/i.test(text) || /\bRelated Topics\b/i.test(text) || /\bCan you come up with\b/i.test(text)) break;
          if (text) items.push(text);
        }
        if (items.length > 0) return items.join('\n');
      }
    }

    // Strategy 2: Plain text boundary extraction stopping strictly before Follow-up
    const plain = htmlWithPowers(html);
    const matchPlain = plain.match(/Constraints:\s*([\s\S]*?)(?=(?:\bFollow[- ]up\b|\bRelated Topics\b|\bCan you come up with\b|Example|\n\n\n|$))/i);
    if (matchPlain && matchPlain[1].trim()) {
      return matchPlain[1].trim()
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !/\bFollow[- ]up\b/i.test(l) && !/\bRelated Topics\b/i.test(l) && !/\bCan you come up with\b/i.test(l))
        .join('\n');
    }

    return '';
  }

  /**
   * Extracts sample test cases from LeetCode problem HTML (<pre> blocks)
   */
  function extractSampleCasesFromHtml(html) {
    if (!html || typeof html !== 'string') return '';
    const preMatches = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/gi);
    if (!preMatches || preMatches.length === 0) return '';

    const samples = [];
    let idx = 0;

    for (const pre of preMatches) {
      const text = htmlWithPowers(pre);
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
    }

    return samples.join('\n\n---\n\n');
  }

  /**
   * Cleans problem HTML by stripping tags and truncating any follow-up sections.
   */
  function cleanProblemHtml(html) {
    if (!html || typeof html !== 'string') return '';
    let text = htmlWithPowers(html);

    const cutPatterns = [
      /\bFollow[- ]up:?\b/i,
      /\bRelated Topics\b/i,
      /\bCan you come up with\b/i
    ];
    let cutIndex = text.length;
    for (const pattern of cutPatterns) {
      const m = pattern.exec(text);
      if (m && m.index < cutIndex) cutIndex = m.index;
    }

    return text.slice(0, cutIndex).trim();
  }

  /**
   * Normalizes language-specific syntax into language-agnostic OA types.
   */
  function normalizeType(typeStr) {
    if (!typeStr || typeof typeStr !== 'string') return '';
    let t = typeStr.trim().replace(/^\(|\)$/g, '').trim();

    // 2D arrays / matrices
    if (/(?:vector<\s*vector<\s*int\s*>>|int\[\]\[\]|List<\s*List<\s*Integer\s*>>|List\[List\[int\]\]|Array<Array<number>>)/i.test(t)) {
      return '2D integer array';
    }
    if (/(?:vector<\s*vector<\s*string\s*>>|String\[\]\[\]|string\[\]\[\]|List<\s*List<\s*String\s*>>)/i.test(t)) {
      return '2D string array';
    }

    // 1D arrays
    if (/(?:vector<\s*int\s*>|int\[\]|List<\s*Integer\s*>|List\[int\]|Array<number>|number\[\])/i.test(t)) {
      return 'integer array';
    }
    if (/(?:vector<\s*string\s*>|String\[\]|string\[\]|List<\s*String\s*>|List\[str\]|Array<string>)/i.test(t)) {
      return 'string array';
    }
    if (/(?:vector<\s*bool\s*>|boolean\[\]|bool\[\]|List<\s*Boolean\s*>|List\[bool\])/i.test(t)) {
      return 'boolean array';
    }

    // Scalars / Primitives
    if (/^(?:int|long|Integer|i32|i64|number)$/i.test(t)) {
      return 'integer';
    }
    if (/^(?:float|double|f32|f64)$/i.test(t)) {
      return 'float';
    }
    if (/^(?:String|std::string|str|char\*)$/i.test(t)) {
      return 'string';
    }
    if (/^(?:bool|Boolean)$/i.test(t)) {
      return 'boolean';
    }
    if (/^(?:char)$/i.test(t)) {
      return 'character';
    }

    // Maps / Key-Value
    if (/(?:unordered_map|map|HashMap|dict|Record)/i.test(t)) {
      return 'key-value map';
    }

    return t.toLowerCase();
  }

  /**
   * Unescapes raw escape characters that models occasionally double-escape.
   */
  function unescapeString(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(/\\"/g, '"')
      .trim();
  }

  /**
   * Sanitizes error messages by stripping any user API keys or Groq key patterns.
   */
  function sanitizeError(msg, apiKey) {
    if (!msg || typeof msg !== 'string') return 'An unexpected error occurred.';
    let sanitized = msg;
    if (apiKey && apiKey.trim()) {
      sanitized = sanitized.split(apiKey.trim()).join('[REDACTED]');
    }
    return sanitized.replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
  }

  /**
   * Builds the user prompt payload.
   */
  function buildUserPrompt({ title, content }) {
    const cleanTitle = (title || 'Assessment Problem').trim();
    const cleanContent = (content || '').trim().substring(0, 5000);
    return `Transform the following problem into a real-world corporate OA specification as a JSON object:\n\n` +
      `Problem Title: ${cleanTitle}\n\n` +
      `Original Description:\n${cleanContent}`;
  }

  /**
   * Validates structured response fields, unescapes strings, and normalizes types.
   */
  function validateProblemData(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Response is not a valid JSON object.' };
    }

    // 1. Scenario normalization: handles array of paragraphs or string
    if (Array.isArray(data.scenario)) {
      data.scenario = data.scenario
        .map(unescapeString)
        .filter(s => s.length > 0)
        .join('\n\n');
    } else if (typeof data.scenario === 'string') {
      data.scenario = unescapeString(data.scenario);
    }

    if (!data.scenario || typeof data.scenario !== 'string' || data.scenario.trim().length < 30) {
      return { valid: false, error: 'Generated problem scenario is missing or too short.' };
    }

    // Strip any stray rhetorical follow-up questions from the start of scenario
    data.scenario = data.scenario
      .replace(/^(?:can you come up with[^\n]*\n*|follow[- ]up:[^\n]*\n*)/i, '')
      .trim();

    // 2. Function Description
    data.functionDescription = unescapeString(data.functionDescription || '');

    // 3. Parameters
    if (Array.isArray(data.parameters)) {
      data.parameters = data.parameters.map(p => ({
        name: unescapeString(p.name || 'param'),
        type: normalizeType(p.type),
        description: unescapeString(p.description || '')
      }));
    } else {
      data.parameters = [];
    }

    // 4. Returns
    if (data.returns && typeof data.returns === 'object') {
      data.returns = {
        type: normalizeType(data.returns.type),
        description: unescapeString(data.returns.description || '')
      };
    } else {
      data.returns = { type: '', description: '' };
    }

    // 5. Notes: prune redundant notes that repeat numerical bounds
    if (typeof data.notes === 'string') {
      data.notes = unescapeString(data.notes);
      if (/\b(?:10\^4|104|10\^9|109|1e9|10,000|\d+\s*<=\s*[a-zA-Z])\b/i.test(data.notes)) {
        data.notes = '';
      }
    } else {
      data.notes = '';
    }

    return { valid: true, data: data };
  }

  /**
   * Parses and validates raw LLM output.
   */
  function parseAndValidateResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { valid: false, error: 'Empty response received from model.' };
    }

    let parsed = null;
    const trimmed = rawText.trim();

    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          parsed = JSON.parse(match[1].trim());
        } catch (innerErr) {
          return { valid: false, error: 'Model returned malformed JSON.' };
        }
      } else {
        return { valid: false, error: 'Model did not return valid JSON.' };
      }
    }

    return validateProblemData(parsed);
  }

  /**
   * Assembles final markdown by combining LLM narrative with verbatim original constraints and test cases.
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
        .filter(c => c && !/\bFollow[- ]up\b/i.test(c) && !/\bRelated Topics\b/i.test(c) && !/\bCan you come up with\b/i.test(c))
        .map(c => /^[-*•]\s+/.test(c) ? c : `- ${c}`)
        .join('\n') + `\n\n`;
    } else {
      md += `(Preserved from original LeetCode specification)\n\n`;
    }

    if (storyData.notes && storyData.notes.trim()) {
      md += `---\n\n**Note**\n\n${storyData.notes.trim()}\n\n`;
    }

    if (samples && samples.trim()) {
      md += `---\n\n${samples}\n`;
    }

    return md;
  }

  /**
   * Transforms problem text into an OA narrative using Groq's high-speed inference engine.
   * @param {Object} params
   * @param {string} params.title - LeetCode problem title
   * @param {string} params.content - Problem description
   * @param {string} params.apiKey - User's private Groq API key
   * @returns {Promise<{ success: boolean, storyData?: Object, error?: string, message?: string }>}
   */
  async function generateOANarrative({ title, content, apiKey }) {
    if (!apiKey || !apiKey.trim()) {
      return {
        success: false,
        error: 'missing_key',
        message: 'Groq API key required. Click the OA-ify icon in your toolbar to add your free key.'
      };
    }

    if (!title || !content) {
      return {
        success: false,
        error: 'invalid_input',
        message: 'Problem title or description is missing.'
      };
    }

    const userPrompt = buildUserPrompt({ title, content });

    const payload = {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1500
    };

    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        return {
          success: false,
          error: 'invalid_key',
          message: 'Invalid Groq API key. Please check your key in the OA-ify popup.'
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'rate_limited',
          message: 'Groq rate limit reached. Please wait a moment and try again.'
        };
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const rawMsg = errJson?.error?.message || `Groq request failed with HTTP ${response.status}`;
        return {
          success: false,
          error: 'api_error',
          message: sanitizeError(rawMsg, apiKey)
        };
      }

      const resData = await response.json();
      const rawContent = resData?.choices?.[0]?.message?.content;

      const validation = parseAndValidateResponse(rawContent);
      if (!validation.valid) {
        return {
          success: false,
          error: 'validation_error',
          message: validation.error || 'Generated problem failed validation.'
        };
      }

      return {
        success: true,
        storyData: validation.data
      };
    } catch (err) {
      return {
        success: false,
        error: 'network_error',
        message: sanitizeError(err.message || 'Could not connect to Groq API.', apiKey)
      };
    }
  }

  const apiModule = {
    fetchLeetCodeProblem,
    generateOANarrative,
    buildUserPrompt,
    parseAndValidateResponse,
    validateProblemData,
    sanitizeError,
    normalizeType,
    unescapeString,
    htmlWithPowers,
    extractConstraintsFromHtml,
    extractSampleCasesFromHtml,
    cleanProblemHtml,
    assembleProblemMarkdown,
    DEFAULT_MODEL
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = apiModule;
  }
  global.OA_API = apiModule;
})(typeof window !== 'undefined' ? window : globalThis);
