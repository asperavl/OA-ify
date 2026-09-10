/**
 * OA-ify API Client (Bring Your Own Key Model)
 * Connects directly to Groq's high-speed inference engine.
 * No middleman or proxy server needed.
 */
(function (global) {
  'use strict';

  const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const DEFAULT_MODEL = 'openai/gpt-oss-20b';

  const SYSTEM_PROMPT = `You are a Staff Engineer at a tier-1 technology company writing an Online Assessment (OA) problem for engineering candidates.
Your task is to transform the provided LeetCode problem description into a full, production-flavored engineering problem specification in the style of real-world corporate coding assessments (HackerRank, CodeSignal).

CRITICAL CONSTRAINTS — YOU MUST FOLLOW THESE EXACTLY:
1. PRESERVE THE EXACT FUNCTION SIGNATURE, PARAMETER NAMES, RETURN TYPE, AND DATA STRUCTURES from the original problem. The candidate will write code against the original LeetCode function signature.
2. PRESERVE ALL ORIGINAL CONSTRAINTS (input array lengths, value ranges, time/memory limits). Convert them into verbatim math notation.
3. PRESERVE ALL ORIGINAL TEST CASES (Sample Inputs and Outputs). The numeric/string values must be 100% identical to the original problem.
4. REFRAME THE NARRATIVE into a real engineering context: distributed caching, rate limiting, packet routing, database transactions, order matching, log analysis, resource allocation, etc.
5. DO NOT mention LeetCode, algorithms by name (e.g. do not say "use binary search" or "this is a graph problem"), or difficulty level.
6. Use clean Markdown formatting matching the template below.

Template:

**Problem Statement**

[2-4 paragraphs describing the engineering context, the business problem, and what the system needs to compute. Be clear, technical, and domain-appropriate.]

**Function Description**

Complete the function \`[exact original function name]\` in the editor.

[exact original function signature as a code block]

**Parameters**
[bulleted list of parameter names, their types, and what they represent in the engineering story]

**Returns**
[return type and what it represents in the engineering story]

---

**Constraints**

[One constraint per line, verbatim from the original problem, using math notation. No bullets, no prose — just the raw inequalities, e.g.: 1 <= n <= 10^5]

---

**Note**

[1-3 sentences of production clarifications that mirror real OA edge-case notes. Examples: "It is guaranteed that the input array will never be empty.", "The result will always fit within a standard 32-bit signed integer.", "All IDs in the input are guaranteed to be unique." Make these feel appropriate to the engineering domain chosen. Do NOT introduce new algorithmic constraints not implied by the original.]

---

**Output Format**

[One or two sentences describing exactly what value the function must return, framed in the engineering context.]

---

**Sample Input 0**
\`\`\`
[raw sample input from original, verbatim — use the exact same values]
\`\`\`
**Sample Output 0**
\`\`\`
[raw sample output from original, verbatim]
\`\`\`

**Explanation 0**

[1-2 sentences explaining why this input produces this output, framed in the engineering domain.]

[Repeat Sample Input 1 / Sample Output 1 / Explanation 1 blocks for each additional original example, incrementing the number from 0.]
`;

  /**
   * Transforms raw LeetCode problem text into an OA narrative using the user's Groq key
   * @param {Object} params
   * @param {string} params.title - LeetCode problem title
   * @param {string} params.content - Cleaned problem description and constraints
   * @param {string} params.apiKey - User's private Groq API key
   * @returns {Promise<{ success: boolean, story?: string, error?: string, message?: string }>}
   */
  async function generateOANarrative({ title, content, apiKey }) {
    if (!apiKey || !apiKey.trim()) {
      return {
        success: false,
        error: 'missing_key',
        message: 'Groq API key required. Click the OA-ify extension icon in your toolbar to add your free key.'
      };
    }

    if (!title || !content) {
      return {
        success: false,
        error: 'invalid_input',
        message: 'Problem title or description is missing.'
      };
    }

    const userPrompt = `Transform the following problem into a real-world corporate OA specification:\n\n` +
      `Problem Title: ${title.trim()}\n\n` +
      `Original Description and Constraints:\n${content.trim().substring(0, 5000)}`;

    const payload = {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
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
          message: 'Invalid Groq API key. Please check your key in the OA-ify extension popup.'
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'rate_limited',
          message: 'High assessment traffic. Please try again in a moment.'
        };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData?.error?.message || `Groq API returned status ${response.status}`;
        return {
          success: false,
          error: 'api_error',
          message: msg
        };
      }

      const data = await response.json();
      const story = data?.choices?.[0]?.message?.content;

      if (!story) {
        return {
          success: false,
          error: 'empty_response',
          message: 'The model returned an empty narrative. Please try again.'
        };
      }

      return {
        success: true,
        story: story
      };
    } catch (err) {
      return {
        success: false,
        error: 'network_error',
        message: 'Could not connect to Groq API. Please check your internet connection.'
      };
    }
  }

  global.OA_API = {
    generateOANarrative: generateOANarrative
  };
})(typeof window !== 'undefined' ? window : this);
