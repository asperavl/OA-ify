const assert = require('node:assert');
const test = require('node:test');
const {
  buildUserPrompt,
  parseAndValidateResponse,
  validateProblemData,
  sanitizeError
} = require('./lib/api.js');

test('Prompt Construction: builds valid prompt with title and content', () => {
  const prompt = buildUserPrompt({
    title: 'Two Sum',
    content: 'Given an array of integers nums and an integer target, return indices of the two numbers.'
  });

  assert.ok(prompt.includes('Problem Title: Two Sum'));
  assert.ok(prompt.includes('Given an array of integers nums'));
  assert.ok(prompt.includes('JSON object'));
});

test('Prompt Construction: truncates content exceeding 5000 chars without breaking', () => {
  const longContent = 'A'.repeat(8000);
  const prompt = buildUserPrompt({
    title: 'Huge Problem',
    content: longContent
  });

  assert.ok(prompt.length < 5500);
  assert.ok(prompt.includes('Problem Title: Huge Problem'));
});

test('Response Parsing: valid JSON passes validation', () => {
  const validJson = JSON.stringify({
    scenario: 'You are an engineer designing a latency-critical matching engine for order execution.',
    functionDescription: 'Find two indices that sum to the desired batch value.',
    parameters: [{ name: 'orders', type: 'int[]', description: 'Transaction sizes' }],
    returns: { type: 'int[]', description: 'Pair of matching order indices' },
    notes: 'Input is guaranteed to have exactly one valid pair.'
  });

  const res = parseAndValidateResponse(validJson);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.data.scenario.startsWith('You are an engineer'), true);
  assert.strictEqual(res.data.parameters.length, 1);
});

test('Response Parsing: handles JSON wrapped in markdown code fences', () => {
  const wrapped = '```json\n{"scenario":"A distributed rate limiter tracking window sizes over streaming logs.","parameters":[],"returns":{}}\n```';
  const res = parseAndValidateResponse(wrapped);
  assert.strictEqual(res.valid, true);
  assert.ok(res.data.scenario.includes('distributed rate limiter'));
});

test('Response Parsing: rejects malformed JSON gracefully', () => {
  const malformed = '{"scenario": "Unclosed string...';
  const res = parseAndValidateResponse(malformed);
  assert.strictEqual(res.valid, false);
  assert.ok(res.error.toLowerCase().includes('json'));
});

test('Response Parsing: rejects missing or empty scenario', () => {
  const missingScenario = JSON.stringify({
    scenario: '',
    parameters: []
  });
  const res = parseAndValidateResponse(missingScenario);
  assert.strictEqual(res.valid, false);
  assert.ok(res.error.includes('scenario'));
});

test('Response Parsing: handles null or non-object payload', () => {
  assert.strictEqual(parseAndValidateResponse('').valid, false);
  assert.strictEqual(parseAndValidateResponse('null').valid, false);
  assert.strictEqual(parseAndValidateResponse('12345').valid, false);
  assert.strictEqual(validateProblemData(null).valid, false);
  assert.strictEqual(validateProblemData('not-an-object').valid, false);
});

test('Security & API-Key: sanitizeError redacts secret keys from error messages', () => {
  const secretKey = 'gsk_1234567890abcdef1234567890abcdef123456';
  const rawError = `Failed to authenticate with key ${secretKey}: upstream rejected request`;
  const sanitized = sanitizeError(rawError, secretKey);

  assert.strictEqual(sanitized.includes(secretKey), false);
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('Security & API-Key: sanitizeError redacts arbitrary gsk_ patterns', () => {
  const errorMsg = 'Error at https://api.groq.com?auth=gsk_randomleak_99999 failed';
  const sanitized = sanitizeError(errorMsg, '');

  assert.strictEqual(sanitized.includes('gsk_randomleak_99999'), false);
  assert.ok(sanitized.includes('[REDACTED_KEY]'));
});

test('Cache Behavior: validates valid cache entry with matching slug', () => {
  function isValidCacheEntry(entry, expectedSlug) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.slug !== expectedSlug) return false;
    if (typeof entry.story !== 'string' || entry.story.length < 50) return false;
    return true;
  }

  const validEntry = {
    version: 2,
    slug: 'two-sum',
    timestamp: Date.now(),
    story: '**Problem Statement**\n\nA full narrative describing the problem with sufficient length.'
  };

  assert.strictEqual(isValidCacheEntry(validEntry, 'two-sum'), true);
  assert.strictEqual(isValidCacheEntry(validEntry, 'three-sum'), false, 'Mismatched slug must be rejected');
});

test('Cache Behavior: detects corrupt or invalid cache entries', () => {
  function isValidCacheEntry(entry, expectedSlug) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.slug !== expectedSlug) return false;
    if (typeof entry.story !== 'string' || entry.story.length < 50) return false;
    return true;
  }

  assert.strictEqual(isValidCacheEntry(null, 'two-sum'), false);
  assert.strictEqual(isValidCacheEntry({}, 'two-sum'), false);
  assert.strictEqual(isValidCacheEntry({ slug: 'two-sum', story: '' }, 'two-sum'), false);
  assert.strictEqual(isValidCacheEntry({ slug: 'two-sum', story: 12345 }, 'two-sum'), false);
});

test('Problem Page Detection: extracts problem slug from URL variations', () => {
  function getSlugFromPath(pathname) {
    const match = pathname.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  assert.strictEqual(getSlugFromPath('/problems/two-sum'), 'two-sum');
  assert.strictEqual(getSlugFromPath('/problems/two-sum/'), 'two-sum');
  assert.strictEqual(getSlugFromPath('/problems/two-sum/description/'), 'two-sum');
  assert.strictEqual(getSlugFromPath('/problems/trapping-rain-water/solutions/'), 'trapping-rain-water');
  assert.strictEqual(getSlugFromPath('/problemset/all/'), null);
  assert.strictEqual(getSlugFromPath('/contest/weekly-contest-300'), null);
});

test('Constraints Extraction: preserves powers and superscripts as ^', () => {
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

  const rawConstraint1 = '<code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code>';
  const rawConstraint2 = '<code>-10<sup>9</sup> &lt;= nums[i] &lt;= 10<sup>9</sup></code>';

  assert.strictEqual(htmlWithPowers(rawConstraint1), '2 <= nums.length <= 10^4');
  assert.strictEqual(htmlWithPowers(rawConstraint2), '-10^9 <= nums[i] <= 10^9');
});

test('Constraints Extraction: strictly strips Follow-up questions', () => {
  const lines = [
    '2 <= nums.length <= 10^4',
    '-10^9 <= nums[i] <= 10^9',
    'Only one valid answer exists.',
    'Follow-up: Can you come up with an algorithm that is less than O(n^2)?'
  ];

  const cleaned = lines.filter(l => !/\bFollow[- ]up\b/i.test(l) && !/\bRelated Topics\b/i.test(l));
  assert.strictEqual(cleaned.length, 3);
  assert.strictEqual(cleaned.some(l => l.includes('Follow-up')), false);
  assert.strictEqual(cleaned.some(l => l.includes('O(n')), false);
});

test('Constraints Formatting: ensures negative bounds receive bullet points', () => {
  const constraints = [
    '2 <= nums.length <= 10^4',
    '-10^9 <= nums[i] <= 10^9',
    '-10^9 <= target <= 10^9'
  ];

  const formatted = constraints
    .map(c => /^[-*•]\s+/.test(c) ? c : `- ${c}`)
    .join('\n');

  assert.ok(formatted.includes('- 2 <= nums.length <= 10^4'));
  assert.ok(formatted.includes('- -10^9 <= nums[i] <= 10^9'));
  assert.ok(formatted.includes('- -10^9 <= target <= 10^9'));
});

