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
Your task is to transform the provided LeetCode problem description into an authentic corporate engineering problem specification in the style of HackerRank or CodeSignal.

CRITICAL RULES:
1. Provide a realistic engineering narrative (distributed systems, caching, network routing, database indexing, telemetry pipelines, etc.).
2. Do NOT mention "LeetCode", algorithm names (e.g. "binary search", "dynamic programming", "two pointers"), or difficulty levels.
3. Keep the parameter names consistent with the problem.
4. Output MUST be a valid JSON object matching the required schema below. Do NOT output markdown code fences or any text outside the JSON object.

REQUIRED JSON SCHEMA:
{
  "scenario": "2-4 paragraphs describing the engineering system, business context, and what the function must compute.",
  "functionDescription": "A concise sentence or two describing what the function computes in this context.",
  "parameters": [
    { "name": "paramName", "type": "paramType", "description": "What this represents in the engineering scenario." }
  ],
  "returns": {
    "type": "returnType",
    "description": "What the returned value represents in this engineering scenario."
  },
  "notes": "1-3 sentences of edge-case engineering notes mirroring real OA assessments (e.g., uniqueness, non-empty guarantees)."
}`;

  /**
   * Sanitizes error messages by stripping any instance of the user's API key
   * or general Groq key patterns to prevent credentials from ever leaking.
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
   * Validates structured response fields
   */
  function validateProblemData(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Response is not a valid JSON object.' };
    }
    if (!data.scenario || typeof data.scenario !== 'string' || data.scenario.trim().length < 30) {
      return { valid: false, error: 'Generated problem scenario is missing or too short.' };
    }
    if (!Array.isArray(data.parameters)) {
      data.parameters = [];
    }
    if (!data.returns || typeof data.returns !== 'object') {
      data.returns = { type: '', description: '' };
    }
    return { valid: true, data: data };
  }

  /**
   * Parses and validates raw LLM output
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
      // Tolerate responses wrapped in markdown ```json ... ``` blocks
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
   * Transforms raw LeetCode problem text into an OA narrative using the user's Groq key
   * @param {Object} params
   * @param {string} params.title - LeetCode problem title
   * @param {string} params.content - Cleaned problem description and constraints
   * @param {string} params.apiKey - User's private Groq API key
   * @returns {Promise<{ success: boolean, storyData?: Object, error?: string, message?: string }>}
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
        const rawMsg = errorData?.error?.message || `Groq API returned status ${response.status}`;
        return {
          success: false,
          error: 'api_error',
          message: sanitizeError(rawMsg, apiKey)
        };
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content;

      if (!rawContent) {
        return {
          success: false,
          error: 'empty_response',
          message: 'The model returned an empty response. Please try again.'
        };
      }

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
    generateOANarrative,
    buildUserPrompt,
    parseAndValidateResponse,
    validateProblemData,
    sanitizeError,
    DEFAULT_MODEL
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = apiModule;
  }
  global.OA_API = apiModule;
})(typeof window !== 'undefined' ? window : globalThis);
