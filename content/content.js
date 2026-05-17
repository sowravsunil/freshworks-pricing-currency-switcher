(function () {
  'use strict';

  if (window.__fwCurrencyDomSwitcherLoaded) return;
  window.__fwCurrencyDomSwitcherLoaded = true;

  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[FW Currency]', ...args);
  }

  const CURRENCIES = {
    USD: { symbol: '$',  locale: 'en-US', key: 'Usd' },
    INR: { symbol: '₹', locale: 'en-IN', key: 'Inr' },
    EUR: { symbol: '€', locale: 'de-DE', key: 'Eur' },
    GBP: { symbol: '£', locale: 'en-GB', key: 'Gbp' },
    AUD: { symbol: 'A$',locale: 'en-AU', key: 'Aud' },
  };

  let pricingTable = [];      // [{ USD:{monthly,annual}, INR:{...}, ... }, ...]
  let selectedCurrency = 'USD'; // user's last chosen currency
  let activeConversionMap = {}; // current from→to map (kept for observer re-apply)
  let domObserver = null;
  let observerDebounce = null;

  // ── Price formatting ────────────────────────────────────────────────────────

  function formatPrice(amount, currency) {
    const num = Number(amount);
    if (isNaN(num)) return String(amount);
    const info = CURRENCIES[currency];
    const symbol = info ? info.symbol : '';
    const locale = info ? info.locale : 'en-US';
    const formatted = num.toLocaleString(locale, { maximumFractionDigits: 0 });
    return `${symbol}${formatted}`;
  }

  // ── Data extraction ────────────────────────────────────────────────────────

  function toNum(val) {
    if (val === null || val === undefined) return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
  }

  // Recursively collect objects that have a priceUsd field.
  function collectRawPriceObjects(obj, visited = new WeakSet(), results = []) {
    if (!obj || typeof obj !== 'object') return results;
    if (visited.has(obj)) return results;
    visited.add(obj);

    if (Array.isArray(obj)) {
      for (const item of obj) collectRawPriceObjects(item, visited, results);
      return results;
    }

    if (Object.keys(obj).some(k => /^priceUsd/i.test(k))) {
      results.push(obj);
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') collectRawPriceObjects(val, visited, results);
    }

    return results;
  }

  // Recursively collect arrays of entityItemPrice objects:
  // [{ currency: "Usd", monthly: 35, annual: 29 }, ...]
  function collectEntityItemGroups(obj, visited = new WeakSet(), groups = []) {
    if (!obj || typeof obj !== 'object') return groups;
    if (visited.has(obj)) return groups;
    visited.add(obj);

    if (Array.isArray(obj)) {
      const isEntityGroup =
        obj.length >= 2 &&
        obj.every(
          item =>
            item &&
            typeof item === 'object' &&
            typeof item.currency === 'string' &&
            (item.monthly !== undefined || item.annual !== undefined)
        );
      if (isEntityGroup) groups.push(obj);
      for (const item of obj) collectEntityItemGroups(item, visited, groups);
      return groups;
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') collectEntityItemGroups(val, visited, groups);
    }

    return groups;
  }

  function buildPricingTable(nextData) {
    const seen = new Set();
    const table = [];

    function addEntry(entry) {
      if (entry.USD.monthly === null && entry.USD.annual === null) return;
      const key = Object.keys(CURRENCIES)
        .map(c => `${c}:${entry[c].monthly}:${entry[c].annual}`)
        .join('|');
      if (seen.has(key)) return;
      seen.add(key);
      table.push(entry);
    }

    // From objects with priceUsd / priceInr / ... fields
    const rawObjects = collectRawPriceObjects(nextData);
    for (const obj of rawObjects) {
      const entry = {};
      for (const [code, info] of Object.entries(CURRENCIES)) {
        const k = info.key; // e.g. "Usd"
        entry[code] = {
          monthly: toNum(obj[`price${k}`] ?? null),
          annual:  toNum(obj[`price${k}Annual`] ?? null),
        };
      }
      addEntry(entry);
    }

    // From entityItemPrice arrays: [{ currency: "Usd", monthly: 35, annual: 29 }, ...]
    const entityGroups = collectEntityItemGroups(nextData);
    for (const group of entityGroups) {
      const entry = {};
      for (const [code, info] of Object.entries(CURRENCIES)) {
        const item = group.find(
          g =>
            g.currency === info.key ||           // "Usd"
            g.currency === info.key.toUpperCase() || // "USD"
            g.currency === code                  // "USD"
        );
        entry[code] = {
          monthly: item ? toNum(item.monthly) : null,
          annual:  item ? toNum(item.annual)  : null,
        };
      }
      addEntry(entry);
    }

    return table;
  }

  // ── Currency detection ─────────────────────────────────────────────────────

  function detectCurrentCurrency() {
    const text = document.body.innerText.slice(0, 10000);
    if (text.includes('₹')) return 'INR';
    if (text.includes('A$')) return 'AUD'; // check before $ to avoid false match
    if (text.includes('€')) return 'EUR';
    if (text.includes('£')) return 'GBP';
    if (text.includes('$')) return 'USD';
    return 'USD';
  }

  // ── Conversion map ─────────────────────────────────────────────────────────

  function buildConversionMap(fromCurrency, toCurrency) {
    const map = {};

    for (const entry of pricingTable) {
      const fromMonthly = entry[fromCurrency]?.monthly;
      const toMonthly   = entry[toCurrency]?.monthly;
      const fromAnnual  = entry[fromCurrency]?.annual;
      const toAnnual    = entry[toCurrency]?.annual;

      if (fromMonthly != null && toMonthly != null) {
        map[String(fromMonthly)]              = formatPrice(toMonthly, toCurrency);
        map[formatPrice(fromMonthly, fromCurrency)] = formatPrice(toMonthly, toCurrency);
      }

      if (fromAnnual != null && toAnnual != null) {
        map[String(fromAnnual)]              = formatPrice(toAnnual, toCurrency);
        map[formatPrice(fromAnnual, fromCurrency)] = formatPrice(toAnnual, toCurrency);
      }
    }

    return map;
  }

  // ── DOM scanning & replacement ─────────────────────────────────────────────

  function findPriceElements(conversionMap) {
    const knownPrices = new Set(Object.keys(conversionMap));
    const found = [];

    document.querySelectorAll('*').forEach(el => {
      if (el.children.length === 0) {
        const text = el.textContent.trim();
        if (text && knownPrices.has(text)) {
          found.push({ element: el, originalText: text });
        }
      }
    });

    return found;
  }

  function replacePrices(priceElements, conversionMap) {
    let replaced = 0;
    for (const { element, originalText } of priceElements) {
      const newPrice = conversionMap[originalText];
      if (newPrice && document.contains(element)) {
        element.textContent = newPrice;
        replaced++;
      }
    }
    log(`Replaced ${replaced} of ${priceElements.length} price elements`);
    return replaced;
  }

  // ── Apply currency ─────────────────────────────────────────────────────────

  function applyCurrency(newCurrency) {
    if (!CURRENCIES[newCurrency]) {
      log('Unknown currency:', newCurrency);
      return;
    }

    log('Switching to:', newCurrency);

    const fromCurrency = detectCurrentCurrency();
    log('Current currency detected:', fromCurrency);

    selectedCurrency = newCurrency;

    if (fromCurrency === newCurrency) {
      log('Already showing', newCurrency, '— no change needed');
      return;
    }

    const conversionMap = buildConversionMap(fromCurrency, newCurrency);
    log('Conversion map built. Keys:', Object.keys(conversionMap).length);

    if (Object.keys(conversionMap).length === 0) {
      log('Warning: empty conversion map — no pricing data for', fromCurrency, '→', newCurrency);
      return;
    }

    const elements = findPriceElements(conversionMap);
    log('Price elements found in DOM:', elements.length);

    if (elements.length === 0) {
      const sample = document.body.innerText.slice(0, 300);
      log('Warning: 0 price elements found. Page text sample:', sample);
    }

    replacePrices(elements, conversionMap);
    activeConversionMap = conversionMap;
  }

  // ── MutationObserver for SPA navigation ───────────────────────────────────

  function startObserver() {
    if (domObserver) domObserver.disconnect();

    domObserver = new MutationObserver((mutations) => {
      const hasSignificantChange = mutations.some(m => m.addedNodes.length > 5);
      if (!hasSignificantChange) return;

      clearTimeout(observerDebounce);
      observerDebounce = setTimeout(() => {
        log('DOM changed — re-scanning for price elements');
        applyCurrency(selectedCurrency);
      }, 300);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
    log('MutationObserver started');
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    try {
      const script = document.getElementById('__NEXT_DATA__');
      if (!script) {
        log('Warning: No __NEXT_DATA__ found on this page');
        return;
      }

      const nextData = JSON.parse(script.textContent);
      pricingTable = buildPricingTable(nextData);
      log('__NEXT_DATA__ parsed. Pricing entries found:', pricingTable.length);

      if (!pricingTable.length) {
        log('Warning: No pricing data found in __NEXT_DATA__');
      }

      chrome.storage.sync.get(['selectedCurrency'], (result) => {
        const detectedCurrency = detectCurrentCurrency();
        log('Current currency detected:', detectedCurrency);

        selectedCurrency = result.selectedCurrency || detectedCurrency;
        log('Selected currency (persisted or detected):', selectedCurrency);

        if (selectedCurrency !== detectedCurrency) {
          applyCurrency(selectedCurrency);
        }

        startObserver();
      });
    } catch (e) {
      console.warn('[FW Currency] Error during init:', e);
    }
  }

  // ── Message listener ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ pong: true, currency: selectedCurrency });
      return true;
    }
    if (message.type === 'SET_CURRENCY' && CURRENCIES[message.currency]) {
      try {
        applyCurrency(message.currency);
        chrome.storage.sync.set({ selectedCurrency: message.currency });
        sendResponse({ success: true });
      } catch (e) {
        console.warn('[FW Currency] Error applying currency:', e);
        sendResponse({ success: false, error: e.message });
      }
    }
    return true;
  });

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
