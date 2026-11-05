# Kaltura Gemini Assistant for Canvas

A browser extension (Chrome, Edge, Brave and other Chromium browsers) that connects **your own Google Gemini API key** to the **Kaltura videos embedded in Instructure Canvas**. Open the side panel next to a lecture video and you can:

- **Chat with the video.** Ask questions and get answers grounded in what was said.
- **Use one-click study tools:** Summarize, Chapters, Study guide, Quiz me, and *Explain this moment*, which explains the part playing right now.
- **Jump to any moment.** Every timestamp in an answer or the transcript is a link that moves the Kaltura player there.
- **Handle videos without captions.** You can send the video file itself to Gemini for multimodal analysis, but only after you confirm.

> **Unofficial project.** It is not affiliated with or endorsed by Instructure, Kaltura or Google. Before you send course material to a third-party AI service, check your institution's policies on AI use, privacy and academic integrity.

---

## How it works

```
Canvas page (*.instructure.com or your school's Canvas domain)
└── LTI iframe → Kaltura KAF / MediaSpace
    └── Kaltura player iframe (*.kaltura.com)
        ├── kaltura-bridge.js   (page world)  reads the player: entry ID, partner ID, KS, caption tracks; seeks
        └── kaltura-content.js  (isolated)    relays to the extension
                     │
          background.js (service worker): per-tab registry of detected players
                     │
          Side panel ──► Kaltura API: download caption file (SRT / WebVTT / DFXP) using the player's own session
                     └─► Gemini API: streamGenerateContent with the transcript as context
                         (or the File API, if you choose to send the video file)
```

- The extension reads the **Kaltura player inside the Canvas iframe** directly. It supports Kaltura Player v7 (PlayKit), the legacy HTML5 player (html5lib/v2), and a plain `<video>` fallback.
- Captions are fetched with the **Kaltura Session (KS) the player already has**. The extension can only reach what you are already allowed to watch. If the player has no KS, it starts an anonymous widget session, which works for publicly viewable videos.
- Gemini is called **directly from your browser** with your key. The extension has no server.

## Install (developer mode)

1. Get the code. Either clone this repository or download the latest `canvas-kaltura-gemini-vX.Y.Z.zip` from [Releases](../../releases) and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`extension/`** folder.
4. Pin the extension, then click its icon to open the side panel.

## Set up your Gemini API key

1. Create a key at **[Google AI Studio → API keys](https://aistudio.google.com/apikey)**.
2. Open the extension's **Settings** (the ⚙ icon in the side panel, or right-click the toolbar icon → *Options*).
3. Paste the key and click **Test key & load models**. Then pick a model. The default is `gemini-3.8-flash`. Any model that supports `generateContent` works, and newer models appear in the list automatically. If Google retires the model you picked, the assistant switches to a current one and tells you.
4. Click **Save**.

The key is stored in `chrome.storage.local` on this device only. It is not synced, and it is sent only to `generativelanguage.googleapis.com`.

## Use it

1. Open a Canvas page (course page, module item, Kaltura "Media Gallery", etc.) that contains a Kaltura video.
2. Click the extension icon. The side panel lists the detected videos. If several videos are embedded, pick one.
3. The transcript loads automatically from the captions, in your preferred language when available. Expand **View transcript** to read it.
4. Pick a quick action or type a question. Click any timestamp to jump the video there.

**Videos with no captions:** click **Send the video itself to Gemini**. The extension finds the smallest MP4 rendition and shows its size, then asks you to confirm. After you confirm, it downloads that rendition from Kaltura and uploads it to the Gemini File API. Google deletes uploaded files after 48 hours. You can set an upload size limit in Settings (default: 300 MB).

### Schools with their own Kaltura domain

Players served from `*.kaltura.com` work out of the box. Some schools serve KAF or MediaSpace from their own hostname, such as `mediaspace.myschool.edu`. Add those hosts under **Settings → Extra Kaltura domains**. Chrome will ask you to grant access, and the extension then registers its scripts for those hosts.

## Troubleshooting

| Symptom | Try |
| --- | --- |
| "No Kaltura player detected" | Wait for the player to load, press play once, then click **Rescan**. If the page was open before you installed the extension, reload it. If your school uses its own Kaltura domain, add it in Settings. |
| "No captions found" | The video has no caption asset, or your session can't list captions. Use **Send the video itself to Gemini**, or ask your instructor to enable Kaltura REACH captions. |
| "Kaltura refused access…" | The entry is restricted. Reload the Canvas page so the player gets a fresh session, then Rescan. |
| "Gemini rejected your API key" | Re-check the key in Settings → **Test key & load models**. |
| Rate limit / quota | Free-tier keys have per-minute limits. Wait and retry, or check usage in AI Studio. |
| Video download fails | Some schools serve video from a CDN domain the extension has no access to. Add that domain under Extra Kaltura domains. |

To debug, use `chrome://extensions` → *Inspect views: service worker*, or right-click the side panel → *Inspect*.

## Project layout

```
extension/
  manifest.json              Manifest V3
  background.js              player registry, side-panel behaviour, custom-domain scripts
  content/kaltura-bridge.js  page-world access to the Kaltura player (detect, seek, current time)
  content/kaltura-content.js isolated-world relay between the bridge and the extension
  lib/gemini.js              Gemini REST client: streaming, model list, File API upload
  lib/kaltura.js             Kaltura API v3: sessions, caption assets, flavors
  lib/captions.js            SRT / WebVTT / DFXP parsing, transcript formatting
  lib/markdown.js            safe Markdown renderer with clickable timestamps
  lib/settings.js            settings defaults and storage
  sidepanel/                 the assistant UI
  options/                   settings page
  shared/base.css            shared styles (light and dark)
  icons/
scripts/check.js             manifest / file-reference / syntax checks
scripts/make-icons.ps1       regenerates the icons
tests/                       unit tests (node:test)
```

## Development

There are no runtime dependencies and no build step. Edit the files, then click **Reload** on `chrome://extensions`.

```bash
npm run check   # validate manifest, referenced files and JS syntax (Node 20+)
npm test        # unit tests for caption parsing and Markdown rendering
```

CI runs both on every push and pull request. When you push a tag such as `v0.1.0`, CI also packages `extension/` and attaches the zip to a GitHub release. The tag must match `version` in `manifest.json`.

## Permissions

| Permission | Why |
| --- | --- |
| `https://*.kaltura.com/*` | Detect and control the player inside Kaltura iframes. Download caption files and (optionally) the video. |
| `https://generativelanguage.googleapis.com/*` | Call the Gemini API. |
| `storage` | Save settings, and keep the per-tab list of detected players. |
| `sidePanel` | Show the assistant next to the page. |
| `scripting` | Register scripts for extra Kaltura domains you add. Re-inject on **Rescan**. |
| optional `https://*/*` | Requested only for the specific extra domains you list in Settings. |

The extension has no access to Canvas pages themselves, your Canvas account, grades or other course data.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
