const assert = require('node:assert');
const test = require('node:test');
const {
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
  assembleProblemMarkdown
} = require('./lib/api.js');

test('Prompt Construction: builds valid prompt requiring JSON schema', () => {
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

test('Type Normalizer: converts language-specific keywords to language-agnostic types', () => {
  // 1D Arrays
  assert.strictEqual(normalizeType('int[]'), 'integer array');
  assert.strictEqual(normalizeType('(int[])'), 'integer array');
  assert.strictEqual(normalizeType('vector<int>'), 'integer array');
  assert.strictEqual(normalizeType('List<Integer>'), 'integer array');
  assert.strictEqual(normalizeType('List[int]'), 'integer array');
  assert.strictEqual(normalizeType('Array<number>'), 'integer array');

  // 2D Arrays / Matrices
  assert.strictEqual(normalizeType('int[][]'), '2D integer array');
  assert.strictEqual(normalizeType('vector<vector<int>>'), '2D integer array');
  assert.strictEqual(normalizeType('List<List<Integer>>'), '2D integer array');
  assert.strictEqual(normalizeType('List[List[int]]'), '2D integer array');

  // Strings
  assert.strictEqual(normalizeType('String'), 'string');
  assert.strictEqual(normalizeType('std::string'), 'string');
  assert.strictEqual(normalizeType('str'), 'string');
  assert.strictEqual(normalizeType('String[]'), 'string array');

  // Booleans
  assert.strictEqual(normalizeType('bool'), 'boolean');
  assert.strictEqual(normalizeType('Boolean'), 'boolean');
  assert.strictEqual(normalizeType('boolean[]'), 'boolean array');

  // Maps
  assert.strictEqual(normalizeType('unordered_map<string, int>'), 'key-value map');
  assert.strictEqual(normalizeType('HashMap<String, Integer>'), 'key-value map');
});

test('String Unescaping: converts double-escaped newlines and tabs to real whitespace', () => {
  const input = 'First paragraph.\\n\\nSecond paragraph with \\"quotes\\".\\tIndented.';
  const res = unescapeString(input);
  assert.strictEqual(res.includes('\\n'), false);
  assert.ok(res.includes('\n\n'));
  assert.ok(res.includes('"quotes"'));
});

test('HTML Powers & Subscripts: converts <sup> to ^ and <sub> to _ and Unicode superscripts', () => {
  const html = '<p>10<sup>4</sup> and -10<sup>9</sup> and nums[i] with target<sub>j</sub> and 2³¹ - 1</p>';
  const res = htmlWithPowers(html);
  assert.strictEqual(res, '10^4 and -10^9 and nums[i] with target_j and 2^31 - 1');
});

test('HTML Invariant Extraction: extracts constraints and strips Follow-up questions', () => {
  const mockProblemHtml = `
    <p>Given an array of integers <code>nums</code>.</p>
    <p><strong class="example">Example 1:</strong></p>
    <pre>Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]\nExplanation: Because nums[0] + nums[1] == 9, we return [0, 1].</pre>
    <p><strong>Constraints:</strong></p>
    <ul>
      <li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>
      <li><code>-10<sup>9</sup> &lt;= nums[i] &lt;= 10<sup>9</sup></code></li>
      <li><code>-10<sup>9</sup> &lt;= target &lt;= 10<sup>9</sup></code></li>
      <li><strong>Only one valid answer exists.</strong></li>
    </ul>
    <p><strong>Follow-up: </strong>Can you come up with an algorithm that is less than O(n<sup>2</sup>) time complexity?</p>
  `;

  const constraints = extractConstraintsFromHtml(mockProblemHtml);
  assert.ok(constraints.includes('2 <= nums.length <= 10^4'));
  assert.ok(constraints.includes('-10^9 <= nums[i] <= 10^9'));
  assert.ok(constraints.includes('Only one valid answer exists.'));
  assert.strictEqual(constraints.includes('Follow-up'), false);
  assert.strictEqual(constraints.includes('O(n'), false);

  const samples = extractSampleCasesFromHtml(mockProblemHtml);
  assert.ok(samples.includes('Sample Input 0'));
  assert.ok(samples.includes('[2,7,11,15]'));
  assert.ok(samples.includes('Sample Output 0'));
  assert.ok(samples.includes('[0,1]'));

  const clean = cleanProblemHtml(mockProblemHtml);
  assert.strictEqual(clean.includes('Follow-up'), false);
  assert.strictEqual(clean.includes('Can you come up with'), false);
});

test('Markdown Assembly: formats negative bounds with proper bullets', () => {
  const storyData = {
    scenario: 'You are an engineer designing a latency-critical distributed order matching engine.',
    functionDescription: 'Complete the function `twoSum` in the editor below.',
    parameters: [{ name: 'nums', type: 'integer array', description: 'Batch transaction sizes' }],
    returns: { type: 'integer array', description: 'Matching order indices' },
    notes: 'Input is guaranteed to have unique solutions.'
  };

  const constraints = '2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9';
  const md = assembleProblemMarkdown(storyData, constraints, '');

  assert.ok(md.includes('**Problem Statement**'));
  assert.ok(md.includes('- `nums` (integer array): Batch transaction sizes'));
  assert.ok(md.includes('- 2 <= nums.length <= 10^4'));
  assert.ok(md.includes('- -10^9 <= nums[i] <= 10^9'));
  assert.ok(md.includes('- -10^9 <= target <= 10^9'));
  assert.ok(md.includes('**Note**\n\nInput is guaranteed to have unique solutions.'));
});

test('Response Parsing: handles multi-paragraph array scenario cleanly', () => {
  const arrayPayload = JSON.stringify({
    scenario: [
      'Your company maintains a high-throughput key-value store that supports a custom eviction policy.',
      'When the cache exceeds its capacity, the system selects two entries whose combined size equals a target threshold.'
    ],
    functionDescription: 'Return the indices of two cache entries.',
    parameters: [{ name: 'nums', type: 'int[]', description: 'Entry sizes' }],
    returns: { type: 'int[]', description: 'Selected indices' },
    notes: 'Assume exactly one valid pair exists.'
  });

  const res = parseAndValidateResponse(arrayPayload);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.data.scenario.includes('\\n'), false);
  assert.ok(res.data.scenario.includes('\n\n'));
  assert.strictEqual(res.data.parameters[0].type, 'integer array');
  assert.strictEqual(res.data.returns.type, 'integer array');
});

test('Response Parsing: unescapes literal \\n in single-string scenarios', () => {
  const escapedStringPayload = JSON.stringify({
    scenario: 'Paragraph one.\\n\\nParagraph two.\\n\\nParagraph three.',
    functionDescription: 'Process cache blocks.',
    parameters: [],
    returns: {}
  });

  const res = parseAndValidateResponse(escapedStringPayload);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.data.scenario.includes('\\n'), false);
  assert.ok(res.data.scenario.includes('\n\n'));
});

test('Response Parsing: prunes stray leading follow-up question if echoed by model', () => {
  const echoedPayload = JSON.stringify({
    scenario: 'Can you come up with an algorithm that is less than time complexity?\n\nYour company maintains a high-throughput key-value store.',
    functionDescription: 'Evict cache blocks.',
    parameters: [],
    returns: {}
  });

  const res = parseAndValidateResponse(echoedPayload);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.data.scenario.includes('Can you come up with'), false);
  assert.ok(res.data.scenario.startsWith('Your company maintains'));
});

test('Response Parsing: prunes redundant numerical notes', () => {
  const redundantNotesPayload = JSON.stringify({
    scenario: 'A distributed queue with strict order guarantees.',
    parameters: [],
    returns: {},
    notes: 'Input array length is between 2 and 10,000, and sizes lie within [-1e9, 1e9].'
  });

  const res = parseAndValidateResponse(redundantNotesPayload);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.data.notes, '');
});

test('Response Parsing: handles JSON wrapped in markdown code fences', () => {
  const wrapped = '```json\n{"scenario":["A distributed rate limiter tracking window sizes over streaming logs."],"parameters":[],"returns":{}}\n```';
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

test('Cache Schema v3: validates valid v3 cache entry and rejects legacy or corrupt entries', () => {
  const CACHE_SCHEMA_VERSION = 3;

  function isCacheValid(entry, slug) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.version !== CACHE_SCHEMA_VERSION) return false;
    if (entry.slug !== slug) return false;
    if (!entry.story || typeof entry.story !== 'string' || entry.story.length < 50) return false;
    if (entry.story.includes('\\n\\n') || /\b104\b/.test(entry.story) || /\b-109\b/.test(entry.story) || /\(int\[\]\)/.test(entry.story)) {
      return false;
    }
    return true;
  }

  // Valid v3 entry
  const validV3 = {
    version: 3,
    slug: 'two-sum',
    timestamp: Date.now(),
    story: '**Problem Statement**\n\nClean narrative without any corrupt tokens or escape bugs.'
  };
  assert.strictEqual(isCacheValid(validV3, 'two-sum'), true);
  assert.strictEqual(isCacheValid(validV3, 'other-slug'), false);

  // Reject legacy v1 and v2 entries
  const legacyV2 = { ...validV3, version: 2 };
  assert.strictEqual(isCacheValid(legacyV2, 'two-sum'), false);

  // Reject entries containing unescaped \\n\\n
  const corruptEscaped = {
    version: 3,
    slug: 'two-sum',
    story: '**Problem Statement**\\n\\nYour company maintains a high-throughput key-value store.'
  };
  assert.strictEqual(isCacheValid(corruptEscaped, 'two-sum'), false);

  // Reject entries containing mangled powers (104, -109)
  const corruptPowers = {
    version: 3,
    slug: 'two-sum',
    story: '**Problem Statement**\n\nConstraints: 2 <= nums.length <= 104 and -109 <= nums[i] <= 109.'
  };
  assert.strictEqual(isCacheValid(corruptPowers, 'two-sum'), false);

  // Reject entries with language types in parameters
  const corruptType = {
    version: 3,
    slug: 'two-sum',
    story: '**Problem Statement**\n\nParameters:\n- `nums` (int[]): Array of cache entry sizes.'
  };
  assert.strictEqual(isCacheValid(corruptType, 'two-sum'), false);
});

test('Problem Page Detection: extracts problem slug from URL variations', () => {
  function getSlugFromPath(pathname) {
    const match = pathname.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  assert.strictEqual(getSlugFromPath('/problems/two-sum'), 'two-sum');
  assert.strictEqual(getSlugFromPath('/problems/two-sum/'), 'two-sum');
  assert.strictEqual(getSlugFromPath('/problems/two-sum/description/'), 'two-sum');
  assert.strictEqual(getSlugFromPath('/problems/add-two-numbers/solutions/'), 'add-two-numbers');
  assert.strictEqual(getSlugFromPath('/problemset/all/'), null);
  assert.strictEqual(getSlugFromPath('/contest/weekly-contest-300'), null);
});
