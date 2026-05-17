(function () {
  'use strict';

  if (window.__fwCurrencySwitcherLoaded) return;
  window.__fwCurrencySwitcherLoaded = true;

  const CURRENCIES = {
    USD: { symbol: '$', locale: 'en-US', key: 'Usd', label: 'USD' },
    INR: { symbol: '₹', locale: 'en-IN', key: 'Inr', label: 'INR' },
    EUR: { symbol: '€', locale: 'de-DE', key: 'Eur', label: 'EUR' },
    GBP: { symbol: '£', locale: 'en-GB', key: 'Gbp', label: 'GBP' },
    AUD: { symbol: 'A$', locale: 'en-AU', key: 'Aud', label: 'AUD' },
  };

  let plans = [];
  let activeCurrency = 'USD';
  let overlayEl = null;

  // ── Data extraction ────────────────────────────────────────────────────────

  function parseNextData() {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      console.warn('[FW Currency] Failed to parse __NEXT_DATA__:', e);
      return null;
    }
  }

  function collectPlanObjects(obj, visited = new WeakSet(), results = []) {
    if (!obj || typeof obj !== 'object') return results;
    if (visited.has(obj)) return results;
    visited.add(obj);

    if (Array.isArray(obj)) {
      for (const item of obj) collectPlanObjects(item, visited, results);
      return results;
    }

    const keys = Object.keys(obj);
    const hasPriceField = keys.some((k) => /^price(Usd|Inr|Eur|Gbp|Aud)/i.test(k));
    if (hasPriceField) results.push(obj);

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') collectPlanObjects(val, visited, results);
    }

    return results;
  }

  function extractName(obj) {
    for (const field of ['name', 'planName', 'title', 'displayName', 'planTitle', 'heading']) {
      if (typeof obj[field] === 'string' && obj[field].trim()) return obj[field].trim();
    }
    return null;
  }

  function toNumber(val) {
    if (val === null || val === undefined) return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
  }

  function buildPlans(rawObjects) {
    const seen = new Map();

    for (const obj of rawObjects) {
      const name = extractName(obj) || 'Unnamed Plan';
      const prices = {};

      for (const [currency, info] of Object.entries(CURRENCIES)) {
        const k = info.key;
        const monthly = toNumber(obj[`price${k}`] ?? obj[`price${k.toLowerCase()}`]);
        const annual = toNumber(obj[`price${k}Annual`] ?? obj[`price${k.toLowerCase()}Annual`]);
        prices[currency] = { monthly, annual };
      }

      // Dedup by USD monthly + name
      const dedupKey = `${name}|${prices.USD.monthly}|${prices.USD.annual}`;
      if (!seen.has(dedupKey)) {
        seen.set(dedupKey, { name, prices });
      }
    }

    return Array.from(seen.values());
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  function formatPrice(amount, currency) {
    if (amount === null || amount === undefined) return '—';
    if (amount === 0) return 'Free';
    try {
      return new Intl.NumberFormat(CURRENCIES[currency].locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${CURRENCIES[currency].symbol}${amount}`;
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── Currency detection ─────────────────────────────────────────────────────

  function detectCurrentCurrency() {
    const text = document.body.innerText.slice(0, 5000);
    if (text.includes('₹')) return 'INR';
    if (text.includes('A$')) return 'AUD';
    if (text.includes('€')) return 'EUR';
    if (text.includes('£')) return 'GBP';
    return 'USD';
  }

  // ── Overlay UI ─────────────────────────────────────────────────────────────

  function renderPricingContent() {
    const content = document.getElementById('fw-cs-content');
    if (!content) return;

    if (!plans.length) {
      content.innerHTML =
        '<p class="fw-cs-empty">No pricing data found on this page.</p>';
      return;
    }

    content.innerHTML = plans
      .map((plan) => {
        const p = plan.prices[activeCurrency];
        const monthly = formatPrice(p?.monthly, activeCurrency);
        const annual = formatPrice(p?.annual, activeCurrency);
        return `
          <div class="fw-cs-plan">
            <div class="fw-cs-plan-name">${escapeHtml(plan.name)}</div>
            <div class="fw-cs-plan-prices">
              <div class="fw-cs-price-item">
                <span class="fw-cs-price-label">Monthly</span>
                <span class="fw-cs-price-value">${escapeHtml(monthly)}</span>
              </div>
              <div class="fw-cs-price-item">
                <span class="fw-cs-price-label">Annual</span>
                <span class="fw-cs-price-value">${escapeHtml(annual)}</span>
              </div>
            </div>
          </div>`;
      })
      .join('');
  }

  function renderAllCurrenciesForPlan(plan) {
    return Object.entries(CURRENCIES)
      .map(([code]) => {
        const p = plan.prices[code];
        return `
          <tr class="${code === activeCurrency ? 'fw-cs-tr-active' : ''}">
            <td class="fw-cs-td-cur">${CURRENCIES[code].symbol} ${code}</td>
            <td>${escapeHtml(formatPrice(p?.monthly, code))}</td>
            <td>${escapeHtml(formatPrice(p?.annual, code))}</td>
          </tr>`;
      })
      .join('');
  }

  function showComparePanelFor(plan) {
    let modal = document.getElementById('fw-cs-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fw-cs-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="fw-cs-modal-backdrop" id="fw-cs-modal-backdrop"></div>
      <div class="fw-cs-modal-box">
        <div class="fw-cs-modal-header">
          <span>${escapeHtml(plan.name)} — All Currencies</span>
          <button class="fw-cs-modal-close" id="fw-cs-modal-close">✕</button>
        </div>
        <table class="fw-cs-modal-table">
          <thead>
            <tr>
              <th>Currency</th>
              <th>Monthly / agent</th>
              <th>Annual / agent</th>
            </tr>
          </thead>
          <tbody>
            ${renderAllCurrenciesForPlan(plan)}
          </tbody>
        </table>
      </div>`;

    modal.classList.add('visible');

    modal.querySelector('#fw-cs-modal-backdrop').addEventListener('click', () =>
      modal.classList.remove('visible')
    );
    modal.querySelector('#fw-cs-modal-close').addEventListener('click', () =>
      modal.classList.remove('visible')
    );
  }

  function applyActiveCurrency(currency) {
    activeCurrency = currency;
    const label = document.getElementById('fw-cs-badge-label');
    if (label) label.textContent = currency;

    overlayEl?.querySelectorAll('.fw-cs-cur-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.currency === currency);
    });

    renderPricingContent();
  }

  function createOverlay() {
    const el = document.createElement('div');
    el.id = 'fw-cs-overlay';

    el.innerHTML = `
      <div class="fw-cs-badge" id="fw-cs-badge" title="Freshworks Currency Switcher">
        <span class="fw-cs-badge-icon">💱</span>
        <span id="fw-cs-badge-label">${activeCurrency}</span>
      </div>
      <div class="fw-cs-panel" id="fw-cs-panel">
        <div class="fw-cs-panel-header">
          <span class="fw-cs-panel-title">💱 Freshworks Pricing</span>
          <button class="fw-cs-panel-close" id="fw-cs-panel-close" title="Close">✕</button>
        </div>
        <div class="fw-cs-cur-row">
          ${Object.entries(CURRENCIES)
            .map(
              ([code, info]) => `
            <button class="fw-cs-cur-btn${code === activeCurrency ? ' active' : ''}" data-currency="${code}" title="${info.label}">
              ${info.symbol}&nbsp;${code}
            </button>`
            )
            .join('')}
        </div>
        <div class="fw-cs-content" id="fw-cs-content"></div>
        <div class="fw-cs-panel-footer">
          Click a plan row to compare all currencies
        </div>
      </div>`;

    document.body.appendChild(el);

    const badge = el.querySelector('#fw-cs-badge');
    const panel = el.querySelector('#fw-cs-panel');

    badge.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('visible');
      if (isOpen) renderPricingContent();
    });

    el.querySelector('#fw-cs-panel-close').addEventListener('click', () =>
      panel.classList.remove('visible')
    );

    el.querySelectorAll('.fw-cs-cur-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const currency = btn.dataset.currency;
        applyActiveCurrency(currency);
        chrome.storage.sync.set({ selectedCurrency: currency });
      });
    });

    el.querySelector('#fw-cs-content').addEventListener('click', (e) => {
      const row = e.target.closest('.fw-cs-plan');
      if (!row) return;
      const index = Array.from(el.querySelectorAll('.fw-cs-plan')).indexOf(row);
      if (plans[index]) showComparePanelFor(plans[index]);
    });

    return el;
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const nextData = parseNextData();
    if (nextData) {
      const rawObjects = collectPlanObjects(nextData);
      plans = buildPlans(rawObjects);
      if (!plans.length) {
        console.warn('[FW Currency] No plan pricing objects found in __NEXT_DATA__');
      }
    } else {
      console.warn('[FW Currency] __NEXT_DATA__ not found on this page');
    }

    activeCurrency = detectCurrentCurrency();

    chrome.storage.sync.get(['selectedCurrency'], (result) => {
      if (result.selectedCurrency && CURRENCIES[result.selectedCurrency]) {
        activeCurrency = result.selectedCurrency;
      }
      overlayEl = createOverlay();
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'PING') {
        sendResponse({ pong: true, currency: activeCurrency });
        return true;
      }
      if (message.type === 'SET_CURRENCY' && CURRENCIES[message.currency]) {
        applyActiveCurrency(message.currency);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
