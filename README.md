# OA-ify

A lightweight Chrome extension that transforms LeetCode problems into Online Assessment (OA) style scenarios while hiding hints, topic tags, and difficulty ratings.

## How It Works

1. **Problem Reframing**: Rewrites textbook LeetCode problem descriptions into engineering scenarios (e.g., distributed cache invalidation, telemetry batching, rate limiting).
2. **Invariant Preservation**: Numerical constraints and sample test cases are extracted directly from the LeetCode DOM as ground truth. The LLM only generates the narrative context and parameter descriptions, eliminating constraint hallucination risks.
3. **Crutch Blinder**: Conceals difficulty badges, topic tags, editorial links, and hints during practice.
4. **Instant Toggle**: Switch between the OA Scenario and original LeetCode description at any time.
5. **Local Caching**: Generated scenarios are validated and cached in `chrome.storage.local` by problem slug, avoiding redundant API calls.

## Security & API Key Model

OA-ify uses a **Bring Your Own Key (BYOK)** architecture:

- **Direct Connections**: All requests are sent directly from your browser to `https://api.groq.com/openai/v1/chat/completions` over HTTPS. There are no intermediary servers or telemetry.
- **Minimal Permissions**: The extension requests only `storage` and host access to `leetcode.com` and `api.groq.com`.
- **Browser Storage**: Your Groq API key is stored locally in `chrome.storage.sync`. Note that browser extension storage is not an encrypted hardware vault—anyone with physical access to your browser profile or dev tools can inspect stored extension data. We recommend using a dedicated, restricted Groq API key.
- **Error Sanitization**: API keys are scrubbed from all error messages and debug outputs.

## Getting Started

1. Clone or download this repository.
2. In Chrome, open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select this directory.
4. Click the OA-ify icon in your toolbar, paste your free Groq API key ([console.groq.com/keys](https://console.groq.com/keys)), and save.
5. Navigate to any problem on `leetcode.com/problems/*`.

## Running Tests

Tests use Node.js's built-in test runner with zero external dependencies:

```bash
npm test
# or: node --test test.js
```

The test suite validates:
- Prompt formatting and length guards
- Structured JSON response parsing and schema validation
- Malformed and missing field error handling
- API key error sanitization
- Problem-page URL detection and cache integrity

## License

MIT
