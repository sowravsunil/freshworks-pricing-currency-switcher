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
    AUD: { symbol: 'A$', locale: 'en-AU', key: 'Aud' },
  };

  let pricingTable = [];
  let selectedCurrency = 'USD';
  let currentDisplayCurrency = null;
  let domObserver = null;
  let observerDebounce = null;
  let lastUrl = location.href;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function toNum(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    // Prices come as strings like "2,099" or "19" — strip commas before parsing
    const cleaned = String(val).replace(/,/g, '');
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
  }

  function formatNumber(amount, currency) {
    const num = Number(amount);
    if (isNaN(num)) return String(amount);
    const info = CURRENCIES[currency];
    const locale = info ? info.locale : 'en-US';
    return num.toLocaleString(locale, { maximumFractionDigits: 0 });
  }

  function formatPrice(amount, currency) {
    const num = Number(amount);
    if (isNaN(num)) return String(amount);
    const info = CURRENCIES[currency];
    const symbol = info ? info.symbol : '';
    return `${symbol}${formatNumber(num, currency)}`;
  }

  // ── Data extraction ────────────────────────────────────────────────────────

  // Recursively collect objects that have priceUsd/priceInr/etc fields
  function collectRawPriceObjects(obj, visited = new WeakSet(), results = []) {
    if (!obj || typeof obj !== 'object') return results;
    if (visited.has(obj)) return results;
    visited.add(obj);

    if (Array.isArray(obj)) {
      for (const item of obj) collectRawPriceObjects(item, visited, results);
      return results;
    }

    if (Object.keys(obj).some(k => /^price(Usd|Inr|Eur|Gbp|Aud)/i.test(k))) {
      results.push(obj);
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') collectRawPriceObjects(val, visited, results);
    }

    return results;
  }

  // Collect localePrices arrays — these contain objects with .fields.currency/.fields.monthly/.fields.annual
  function collectLocalePriceGroups(obj, visited = new WeakSet(), groups = []) {
    if (!obj || typeof obj !== 'object') return groups;
    if (visited.has(obj)) return groups;
    visited.add(obj);

    if (Array.isArray(obj)) {
      // Check if this array contains entityItemPrice-style objects (under .fields)
      const isLocaleGroup =
        obj.length >= 2 &&
        obj.every(
          item =>
            item &&
            typeof item === 'object' &&
            item.fields &&
            typeof item.fields.currency === 'string' &&
            (item.fields.monthly !== undefined || item.fields.annual !== undefined)
        );
      if (isLocaleGroup) {
        // Flatten to direct currency/monthly/annual format
        const flat = obj.map(item => ({
          currency: item.fields.currency,
          monthly: item.fields.monthly,
          annual: item.fields.annual,
        }));
        groups.push(flat);
      }

      // Also check for direct format (no .fields wrapper)
      const isDirectGroup =
        obj.length >= 2 &&
        obj.every(
          item =>
            item &&
            typeof item === 'object' &&
            typeof item.currency === 'string' &&
            (item.monthly !== undefined || item.annual !== undefined)
        );
      if (isDirectGroup && !isLocaleGroup) {
        groups.push(obj);
      }

      for (const item of obj) collectLocalePriceGroups(item, visited, groups);
      return groups;
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') collectLocalePriceGroups(val, visited, groups);
    }

    return groups;
  }

  function buildPricingTable(nextData) {
    const seen = new Set();
    const table = [];

    function addEntry(entry) {
      // Must have at least one valid price
      const hasAny = Object.keys(CURRENCIES).some(
        c => entry[c].monthly !== null || entry[c].annual !== null
      );
      if (!hasAny) return;

      const key = Object.keys(CURRENCIES)
        .map(c => `${c}:${entry[c].monthly}:${entry[c].annual}`)
        .join('|');
      if (seen.has(key)) return;
      seen.add(key);
      table.push(entry);
    }

    // From objects with priceUsd / priceInr / ... fields
    const rawObjects = collectRawPriceObjects(nextData);
    log('Raw price objects found:', rawObjects.length);

    for (const obj of rawObjects) {
      const entry = {};
      for (const [code, info] of Object.entries(CURRENCIES)) {
        const k = info.key;
        entry[code] = {
          monthly: toNum(obj[`price${k}`] ?? null),
          annual:  toNum(obj[`price${k}Annual`] ?? null),
        };
      }
      addEntry(entry);
    }

    // From localePrices / entityItemPrice arrays
    const entityGroups = collectLocalePriceGroups(nextData);
    log('Entity/locale price groups found:', entityGroups.length);

    for (const group of entityGroups) {
      const entry = {};
      for (const [code, info] of Object.entries(CURRENCIES)) {
        const item = group.find(
          g =>
            g.currency === info.key ||
            g.currency === info.key.toUpperCase() ||
            g.currency === code
        );
        entry[code] = {
          monthly: item ? toNum(item.monthly) : null,
          annual:  item ? toNum(item.annual)  : null,
        };
      }
      addEntry(entry);
    }

    log('Pricing table built. Unique entries:', table.length);
    if (table.length > 0 && DEBUG) {
      log('First 5 entries:', JSON.stringify(table.slice(0, 5), null, 2));
    }

    return table;
  }

  // ── Currency detection ───────────────────────────────────────────────────��─

  function detectCurrentCurrency() {
    const text = document.body.innerText.slice(0, 15000);
    if (text.includes('₹')) return 'INR';
    if (text.includes('A$')) return 'AUD';
    if (text.includes('€')) return 'EUR';
    if (text.includes('£')) return 'GBP';
    if (text.includes('$')) return 'USD';
    return 'USD';
  }

  // ── Conversion map ───────────────────────────────────────────────────��─────

  function buildConversionMap(fromCurrency, toCurrency) {
    const map = {};

    for (const entry of pricingTable) {
      const pairs = [
        [entry[fromCurrency]?.monthly, entry[toCurrency]?.monthly],
        [entry[fromCurrency]?.annual, entry[toCurrency]?.annual],
      ];

      for (const [fromVal, toVal] of pairs) {
        if (fromVal == null || toVal == null) continue;

        const toFormatted = formatPrice(toVal, toCurrency);
        const toNumberOnly = formatNumber(toVal, toCurrency);

        // Full formatted with symbol: "$19" or "₹1,399"
        map[formatPrice(fromVal, fromCurrency)] = toFormatted;
        // Number with locale formatting: "19" or "1,399"
        const fromNumFormatted = formatNumber(fromVal, fromCurrency);
        if (fromNumFormatted.length >= 2) {
          map[fromNumFormatted] = toNumberOnly;
        }
        // Raw number string without formatting (only if 2+ chars to avoid false matches)
        const rawStr = String(Math.round(fromVal));
        if (rawStr.length >= 2 && !map[rawStr]) {
          map[rawStr] = toNumberOnly;
        }
      }
    }

    return map;
  }

  // ── DOM replacement ────────────────────────────────────────────────────────

  function replaceAllPrices(conversionMap, fromCurrency, toCurrency) {
    const fromSymbol = CURRENCIES[fromCurrency].symbol;
    const toSymbol = CURRENCIES[toCurrency].symbol;
    let replacedCount = 0;
    let symbolCount = 0;

    // Sort map keys by length descending so we try longer matches first
    const sortedKeys = Object.keys(conversionMap).sort((a, b) => b.length - a.length);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      // Skip script/style elements
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT')) {
        continue;
      }
      textNodes.push(node);
    }

    log('Total text nodes scanned:', textNodes.length);

    for (const textNode of textNodes) {
      const originalText = textNode.textContent;
      const trimmed = originalText.trim();
      if (!trimmed) continue;

      // Try exact match first (most common for price spans like "$19")
      if (conversionMap[trimmed] !== undefined) {
        textNode.textContent = originalText.replace(trimmed, conversionMap[trimmed]);
        replacedCount++;
        continue;
      }

      // Check for standalone currency symbol
      if (trimmed === fromSymbol || (fromCurrency === 'AUD' && trimmed === 'A$')) {
        textNode.textContent = originalText.replace(trimmed, toSymbol);
        symbolCount++;
        continue;
      }

      // For text that contains a price within other text (e.g., "Starting at $19/mo")
      let replaced = false;
      for (const key of sortedKeys) {
        if (key.length < 2) continue;
        if (originalText.includes(key)) {
          textNode.textContent = originalText.split(key).join(conversionMap[key]);
          replacedCount++;
          replaced = true;
          break;
        }
      }

      if (!replaced && originalText.includes(fromSymbol)) {
        // Replace standalone symbol occurrences in mixed text
        if (fromSymbol !== '$' || !originalText.includes('A$')) {
          textNode.textContent = originalText.split(fromSymbol).join(toSymbol);
          symbolCount++;
        }
      }
    }

    log(`Replaced ${replacedCount} price nodes, ${symbolCount} symbol nodes`);
    return replacedCount + symbolCount;
  }

  // ── Apply currency ─────────────────────────────────────────────────────────

  function applyCurrency(newCurrency) {
    if (!CURRENCIES[newCurrency]) {
      log('Unknown currency:', newCurrency);
      return;
    }

    const fromCurrency = currentDisplayCurrency || detectCurrentCurrency();
    log('Applying currency switch:', fromCurrency, '→', newCurrency);

    selectedCurrency = newCurrency;

    if (fromCurrency === newCurrency) {
      log('Already showing', newCurrency);
      return;
    }

    if (pricingTable.length === 0) {
      log('Warning: pricing table is empty, attempting re-parse');
      parseNextData();
      if (pricingTable.length === 0) {
        log('Error: still no pricing data');
        return;
      }
    }

    const conversionMap = buildConversionMap(fromCurrency, newCurrency);
    const keyCount = Object.keys(conversionMap).length;
    log('Conversion map keys:', keyCount);

    if (keyCount === 0) {
      log('Warning: empty conversion map');
      return;
    }

    if (DEBUG) {
      const sample = Object.entries(conversionMap).slice(0, 8);
      log('Sample mappings:', sample.map(([k, v]) => `"${k}" → "${v}"`).join(', '));
    }

    const total = replaceAllPrices(conversionMap, fromCurrency, newCurrency);

    if (total > 0) {
      currentDisplayCurrency = newCurrency;
      log('Display currency updated to', newCurrency, `(${total} replacements)`);
    } else {
      log('Warning: 0 replacements made. DOM may not contain expected price text.');
    }
  }

  // ── Parsing __NEXT_DATA__ ─────────────────────���───────────────────────────

  function parseNextData() {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script) {
      log('Warning: No __NEXT_DATA__ found');
      return false;
    }

    try {
      const nextData = JSON.parse(script.textContent);
      pricingTable = buildPricingTable(nextData);
      return pricingTable.length > 0;
    } catch (e) {
      log('Error parsing __NEXT_DATA__:', e);
      return false;
    }
  }

  // ── URL change detection (SPA navigation) ─────────────────────────────────

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      log('URL changed:', lastUrl, '→', location.href);
      lastUrl = location.href;
      // Re-init after a short delay to let new content render
      setTimeout(() => {
        currentDisplayCurrency = null;
        parseNextData();
        currentDisplayCurrency = detectCurrentCurrency();
        if (selectedCurrency !== currentDisplayCurrency) {
          applyCurrency(selectedCurrency);
        }
      }, 800);
    }
  }

  // ── MutationObserver ──────────────────────────────────────────────────────

  function startObserver() {
    if (domObserver) domObserver.disconnect();

    domObserver = new MutationObserver((mutations) => {
      // Check for URL change on every mutation (catches pushState navigation)
      checkUrlChange();

      const hasSignificantChange = mutations.some(
        m => m.addedNodes.length > 3 || (m.type === 'childList' && m.target.querySelectorAll && m.target.querySelectorAll('[class*="pric"]').length > 0)
      );
      if (!hasSignificantChange) return;

      clearTimeout(observerDebounce);
      observerDebounce = setTimeout(() => {
        log('Significant DOM change detected — checking prices');
        // Re-detect because new content was rendered by Next.js
        const freshDetected = detectCurrentCurrency();
        if (freshDetected !== selectedCurrency) {
          currentDisplayCurrency = freshDetected;
          applyCurrency(selectedCurrency);
        }
      }, 600);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

    // Also intercept history pushState/replaceState for SPA navigation
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function (...args) {
      origPushState.apply(this, args);
      setTimeout(checkUrlChange, 100);
    };
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      setTimeout(checkUrlChange, 100);
    };
    window.addEventListener('popstate', () => setTimeout(checkUrlChange, 100));

    log('Observer and navigation hooks started');
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    try {
      if (!parseNextData()) {
        log('Warning: No pricing data found in __NEXT_DATA__');
        return;
      }

      currentDisplayCurrency = detectCurrentCurrency();
      log('Detected page currency:', currentDisplayCurrency);

      chrome.storage.sync.get(['selectedCurrency'], (result) => {
        selectedCurrency = result.selectedCurrency || currentDisplayCurrency;
        log('User preference:', selectedCurrency);

        if (selectedCurrency !== currentDisplayCurrency) {
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
      log('Received SET_CURRENCY:', message.currency);
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
