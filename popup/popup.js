'use strict';

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
];

const main = document.getElementById('main');

function renderNotOnPage() {
  main.innerHTML = `
    <div class="not-on-page">
      <div class="not-on-page-icon">🔍</div>
      <div>Navigate to a Freshworks pricing page to use the currency switcher.</div>
    </div>`;
}

function renderCurrencies(tabId, activeCurrency) {
  main.innerHTML = `
    <div class="currencies">
      ${CURRENCIES.map(
        (c) => `
        <button class="currency-btn${c.code === activeCurrency ? ' active' : ''}" data-currency="${c.code}" data-tab="${tabId}">
          <span class="currency-symbol">${c.symbol}</span>
          <span class="currency-info">
            <div class="currency-code">${c.code}</div>
            <div class="currency-name">${c.name}</div>
          </span>
        </button>`
      ).join('')}
    </div>`;

  document.querySelectorAll('.currency-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const currency = btn.dataset.currency;
      const tid = parseInt(btn.dataset.tab, 10);

      await chrome.storage.sync.set({ selectedCurrency: currency });

      document.querySelectorAll('.currency-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      try {
        await chrome.tabs.sendMessage(tid, { type: 'SET_CURRENCY', currency });
      } catch {
        // Content script may not be ready; storage update is still persisted.
      }
    });
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    renderNotOnPage();
    return;
  }

  // Ping the content script to confirm we're on a supported page.
  let activeCurrency = 'USD';
  let onPage = false;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    if (response?.pong) {
      onPage = true;
      if (response.currency) activeCurrency = response.currency;
    }
  } catch {
    onPage = false;
  }

  if (!onPage) {
    renderNotOnPage();
    return;
  }

  // Prefer persisted selection over detected.
  const stored = await chrome.storage.sync.get(['selectedCurrency']);
  if (stored.selectedCurrency) activeCurrency = stored.selectedCurrency;

  renderCurrencies(tab.id, activeCurrency);
}

init();
