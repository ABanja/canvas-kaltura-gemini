# Privacy

Kaltura Gemini Assistant for Canvas runs entirely in your browser. It has no server, analytics or telemetry, and it sends no data to its authors.

## What is stored, and where

- **Settings**, including your Gemini API key, are stored in `chrome.storage.local` on your device. They are not synced to other devices. Removing the extension deletes them.
- **The list of detected videos** for each tab is kept in `chrome.storage.session`. Chrome clears it when the browser closes, and the extension clears a tab's entry when the tab navigates or closes.
- **Conversations and transcripts** exist only in the open side panel's memory. They are gone when the panel closes.

## What is sent, and to whom

| Data | Sent to | When |
| --- | --- | --- |
| Requests for caption files, entry details and (optionally) video renditions, using the Kaltura session the player already has | Kaltura (your institution's Kaltura service) | When you select a video, and when you choose to send a video file |
| The video transcript, video title/description, your questions and the conversation so far | Google Gemini API, under your API key | Each time you ask a question or use a quick action |
| The video file | Google Gemini File API, under your API key | Only if you click **Send the video itself to Gemini** and confirm. Google deletes uploaded files after 48 hours. |

Google's handling of data sent to the Gemini API is governed by the [Gemini API Terms](https://ai.google.dev/gemini-api/terms) and Google's privacy policy. On the free tier, Google may use the content you send to improve its products. Check the terms that apply to your key.

## Your responsibility

Course videos may contain copyrighted material and other students' voices or images. Before sending course content to a third-party AI service, follow your institution's policies and your instructor's rules on AI use.
