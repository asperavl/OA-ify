# OA-ify

A Chrome extension that turns LeetCode problems into Online Assessment style engineering specifications and hides problem crutches.

## Features

- **Problem Rewriting**: Turns standard LeetCode problem descriptions into real-world engineering problem statements while keeping the original function signatures, parameter types, and constraints intact.
- **Crutch Blinder**: Hides difficulty ratings, topic tags, and hints so you can practice solving problems without hints or spoilers.
- **Instant Toggle**: Switch between the OA Scenario and Original LeetCode view at any time.
- **BYOK (Bring Your Own Key)**: Uses your own free Groq API key with direct API calls from your browser. No middleman backend.
- **Local Cache**: Generated problem descriptions are cached in local browser storage so revisiting a problem is instant and uses no extra API calls.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `OA-ify` folder.
5. Click the extension icon in your browser toolbar, enter your free Groq API key ([console.groq.com/keys](https://console.groq.com/keys)), and click **Save API Key**.
6. Open any LeetCode problem.

## Privacy

- **Direct Calls**: All inference calls go straight from your browser to `api.groq.com`.
- **Local Storage**: Your API key and cached problem texts are stored locally in your browser via `chrome.storage`.
- **No Code Access**: OA-ify does not touch your code editor or interfere with submissions.

## License

MIT
