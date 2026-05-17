# Privacy Policy

**Freshworks Pricing Currency Switcher** is an unofficial community-built Chrome extension.

## Data Collection

This extension collects **no data** of any kind.

- It does **not** collect, store, or transmit any personal information.
- It does **not** use analytics, telemetry, or tracking of any sort.
- It does **not** make any external network requests.

## How It Works

The extension reads pricing data that is already embedded in Freshworks pricing pages (specifically the `__NEXT_DATA__` script tag rendered by Next.js). This data is read locally in your browser and is never sent anywhere.

## Storage

The extension uses `chrome.storage.sync` solely to remember your selected currency preference (e.g., "USD"). This preference is synced across your Chrome profile via your Google account if Chrome Sync is enabled — it is never transmitted to any third-party server.

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read pricing data from the current Freshworks tab when you interact with the extension |
| `storage` | Save your currency preference so it persists between sessions |

No other permissions are requested.

## Contact

This is an unofficial, open-source project. For questions or concerns, open an issue on GitHub.
