# Freshworks Pricing Currency Switcher

> **Disclaimer:** This is an unofficial, community-built Chrome extension. It is not affiliated with, endorsed by, or created by Freshworks Inc. Freshworks is a trademark of Freshworks Inc.

A Chrome extension (Manifest V3) that lets Freshworks Account Managers instantly switch between **USD, INR, EUR, GBP, and AUD** on any Freshworks pricing page — without reloading or changing geo-settings.

---

## How It Works

Freshworks pricing pages are built with Next.js and embed pricing data for **all 5 currencies** in a `<script id="__NEXT_DATA__">` tag on every page load — regardless of which currency the page displays by default. This extension reads that embedded data and surfaces it in a clean floating overlay.

- **No external API calls** — everything is read from data already on the page.
- **No currency conversion** — prices are the actual Freshworks prices for each region.
- **Non-destructive** — the existing page layout is never modified.

---

## Features

- Floating badge (bottom-right corner) showing your active currency
- Click the badge to open a pricing panel with all plans in the selected currency
- Switch currencies with one click — selection persists across sessions
- Click any plan row to compare it across all 5 currencies in a modal
- Popup currency switcher from the extension toolbar icon
- Graceful error handling if pricing data isn't available on the page

---

## Supported Currencies

| Code | Symbol | Name |
|------|--------|------|
| USD | $ | US Dollar |
| INR | ₹ | Indian Rupee |
| EUR | € | Euro |
| GBP | £ | British Pound |
| AUD | A$ | Australian Dollar |

---

## Supported Products

The extension activates on all URLs matching `https://www.freshworks.com/*/pricing/*`, including:

- Freshservice (`/freshservice/pricing/`)
- Freshdesk (`/freshdesk/pricing/`)
- Freshdesk Omni (`/freshdesk/omni/pricing/`)
- Freshchat (`/live-chat-software/pricing/`)
- Freshcaller (`/freshcaller/pricing/`)
- Freshsales CRM (`/crm/pricing/`)
- Any future Freshworks pricing pages

---

## Installation

### From the Chrome Web Store

*(Coming soon — link will be added when published.)*

### Manual Installation (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/sowravsunil/freshworks-pricing-currency-switcher.git
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the cloned repository folder.
5. Navigate to any Freshworks pricing page — the 💱 badge will appear in the bottom-right corner.

---

## Usage

1. Go to any Freshworks pricing page (e.g., `https://www.freshworks.com/freshservice/pricing/`).
2. Click the **💱 USD** badge in the bottom-right corner to open the pricing panel.
3. Select a currency to instantly view all plan prices in that currency.
4. Click a plan row to compare it across all 5 currencies in a modal popup.
5. Alternatively, click the extension icon in the Chrome toolbar to switch currency from the popup.

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch and open a Pull Request

---

## Privacy

This extension collects no data. See [PRIVACY.md](PRIVACY.md) for full details.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
