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
  let originalPageCurrency = null;
  let activeConversionMap = null;
  let activeFromCurrency = null;
  let activeToCurrency = null;
  let domObserver = null;
  let observerDebounce = null;
  let lastUrl = location.href;
  let pendingAddedNodes = [];

  // ── Utilities ──────────────────────────────────────────────────────────────

  function toNum(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    // Strip commas, then extract leading number (handles "399/pass", "2399/agent/month")
    const cleaned = String(val).replace(/,/g, '');
    const match = cleaned.match(/^(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const n = Number(match[1]);
    return isNaN(n) ? null : n;
  }

  function formatNumber(amount, currency) {
    const num = Number(amount);
    if (isNaN(num)) return String(amount);
    const info = CURRENCIES[currency];
    const locale = info ? info.locale : 'en-US';
    if (num !== Math.floor(num)) {
      return num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
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

  function collectLocalePriceGroups(obj, visited = new WeakSet(), groups = []) {
    if (!obj || typeof obj !== 'object') return groups;
    if (visited.has(obj)) return groups;
    visited.add(obj);

    if (Array.isArray(obj)) {
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
        const flat = obj.map(item => ({
          currency: item.fields.currency,
          monthly: item.fields.monthly,
          annual: item.fields.annual,
        }));
        groups.push(flat);
      }

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

  // ── Currency detection ─────────────────────────────────────────────────────

  function detectCurrentCurrency() {
    const text = document.body.innerText.slice(0, 15000);
    if (text.includes('₹')) return 'INR';
    if (text.includes('A$')) return 'AUD';
    if (text.includes('€')) return 'EUR';
    if (text.includes('£')) return 'GBP';
    if (text.includes('$')) return 'USD';
    return 'USD';
  }

  // ── Conversion map ─────────────────────────────────────────────────────────

  function buildConversionMap(fromCurrency, toCurrency) {
    const map = {};
    const frozen = new Set();

    function setOnce(key, value) {
      if (frozen.has(key)) {
        if (map[key] !== value) {
          log('Collision on "' + key + '": keeping "' + map[key] + '", skipping "' + value + '"');
        }
        return;
      }
      map[key] = value;
      frozen.add(key);
    }

    for (const entry of pricingTable) {
      const pairs = [
        [entry[fromCurrency]?.monthly, entry[toCurrency]?.monthly],
        [entry[fromCurrency]?.annual, entry[toCurrency]?.annual],
      ];

      for (const [fromVal, toVal] of pairs) {
        if (fromVal == null || toVal == null) continue;

        const toFormatted = formatPrice(toVal, toCurrency);
        const toNumberOnly = formatNumber(toVal, toCurrency);

        setOnce(formatPrice(fromVal, fromCurrency), toFormatted);

        const fromNumFormatted = formatNumber(fromVal, fromCurrency);
        if (fromNumFormatted.length >= 2) {
          setOnce(fromNumFormatted, toNumberOnly);
        }

        const rawStr = String(Math.round(fromVal));
        if (rawStr.length >= 2) {
          setOnce(rawStr, toNumberOnly);
        }

        if (fromVal !== Math.floor(fromVal)) {
          const fromInfo = CURRENCIES[fromCurrency];
          const minForm = fromVal.toLocaleString(fromInfo.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          if (minForm !== fromNumFormatted && minForm.length >= 2) {
            setOnce(minForm, toNumberOnly);
            setOnce(fromInfo.symbol + minForm, toFormatted);
          }
        }
      }
    }

    return map;
  }

  // ── DOM replacement ────────────────────────────────────────────────────────

  function replaceAllPrices(conversionMap, fromCurrency, toCurrency, root = document.body) {
    const fromSymbol = CURRENCIES[fromCurrency].symbol;
    const toSymbol = CURRENCIES[toCurrency].symbol;
    let replacedCount = 0;
    let symbolCount = 0;
    const replacedSymbolNodes = [];

    const sortedKeys = Object.keys(conversionMap).sort((a, b) => b.length - a.length);

    // Pre-compile boundary-aware patterns so "42" won't match inside "1,42,399".
    // Exclude pure-digit keys — they cause false positives on non-price numbers
    // like "500" in "First 500 sessions included" or "100" in "per 100 sessions".
    const partialPatterns = sortedKeys
      .filter(k => k.length >= 2 && /\D/.test(k))
      .map(key => {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const src = `(?<![\\d,])${escaped}(?![\\d,])`;
        return { key, test: new RegExp(src), replace: new RegExp(src, 'g') };
      });

    const textNodes = [];

    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if (!parent || (parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE' && parent.tagName !== 'NOSCRIPT')) {
        textNodes.push(root);
      }
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT')) {
          continue;
        }
        textNodes.push(node);
      }
    }

    log('Total text nodes scanned:', textNodes.length);

    for (const textNode of textNodes) {
      const originalText = textNode.textContent;
      const trimmed = originalText.trim();
      if (!trimmed) continue;

      // Exact match (most common for price spans like "$19" or "4,299")
      if (conversionMap[trimmed] !== undefined) {
        textNode.textContent = originalText.replace(trimmed, conversionMap[trimmed]);
        replacedCount++;
        continue;
      }

      // Standalone currency symbol
      if (trimmed === fromSymbol || (fromCurrency === 'AUD' && trimmed === 'A$')) {
        textNode.textContent = originalText.replace(trimmed, toSymbol);
        symbolCount++;
        replacedSymbolNodes.push(textNode);
        continue;
      }

      // Partial match: price within longer text (e.g., "₹399/pass", "$49 per 100 sessions")
      // Boundary regex prevents "42" from matching inside "1,42,399".
      let replaced = false;
      for (const { key, test, replace } of partialPatterns) {
        if (test.test(originalText)) {
          textNode.textContent = originalText.replace(replace, conversionMap[key]);
          replacedCount++;
          replaced = true;
          break;
        }
      }

      if (!replaced && originalText.includes(fromSymbol)) {
        if (fromSymbol !== '$' || !originalText.includes('A$')) {
          textNode.textContent = originalText.split(fromSymbol).join(toSymbol);
          symbolCount++;
          replacedSymbolNodes.push(textNode);
        }
      }
    }

    // Second pass: handle React-split nodes where symbol and number are adjacent text nodes
    // e.g., <!-- -->$<!-- -->5<!-- -->/pass creates "$" + "5" + "/pass" as separate text nodes
    for (const symNode of replacedSymbolNodes) {
      let next = symNode.nextSibling;
      while (next && next.nodeType === Node.COMMENT_NODE) next = next.nextSibling;
      if (!next || next.nodeType !== Node.TEXT_NODE) continue;
      const nextText = next.textContent;
      const nextTrimmed = nextText.trim();
      if (!nextTrimmed) continue;
      if (conversionMap[nextTrimmed] !== undefined) continue;
      const numMatch = nextTrimmed.match(/^(\d[\d,]*(?:\.\d+)?)/);
      if (!numMatch) continue;
      const numPart = numMatch[1];
      const fullKey = fromSymbol + numPart;
      if (conversionMap[fullKey]) {
        const toVal = conversionMap[fullKey];
        const numOnly = toVal.startsWith(toSymbol) ? toVal.slice(toSymbol.length) : toVal;
        next.textContent = nextText.replace(numPart, numOnly);
        replacedCount++;
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

    // Save the conversion map for the observer to reuse on lazy-loaded content
    activeConversionMap = conversionMap;
    activeFromCurrency = fromCurrency;
    activeToCurrency = newCurrency;

    if (total > 0) {
      currentDisplayCurrency = newCurrency;
      log('Display currency updated to', newCurrency, `(${total} replacements)`);
    } else {
      log('Warning: 0 replacements made. DOM may not contain expected price text.');
      currentDisplayCurrency = newCurrency;
    }
  }

  // ── Reapply on lazy-loaded content ─────────────────────────────────────────

  function reapplyOnNewContent(addedNodes) {
    if (!activeConversionMap || !activeFromCurrency || !activeToCurrency) return;
    if (selectedCurrency === originalPageCurrency) return;

    // Build from the ORIGINAL page currency so newly-added nodes (which arrive
    // in the original currency) get converted. Already-converted nodes are not
    // in addedNodes, so they are never re-processed.
    const freshMap = buildConversionMap(originalPageCurrency, selectedCurrency);
    if (Object.keys(freshMap).length === 0) return;

    log('Re-applying conversion for lazy-loaded content:', originalPageCurrency, '→', selectedCurrency);
    let total = 0;
    for (const root of addedNodes) {
      total += replaceAllPrices(freshMap, originalPageCurrency, selectedCurrency, root);
    }
    if (total > 0) {
      log('Lazy-loaded content: replaced', total, 'nodes');
    }
  }

  // ── Parsing __NEXT_DATA__ ──────────────────────────────────────────────────

  function parseNextData() {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script) {
      log('Warning: No __NEXT_DATA__ found');
      return false;
    }

    try {
      const nextData = JSON.parse(script.textContent);
      const pageProps = nextData?.props?.pageProps;
      if (pageProps) {
        const scopedTable = buildPricingTable(pageProps);
        if (scopedTable.length >= 2) {
          pricingTable = scopedTable;
          log('Using pageProps-scoped pricing data:', pricingTable.length, 'entries');
          return true;
        }
      }
      pricingTable = buildPricingTable(nextData);
      return pricingTable.length > 0;
    } catch (e) {
      log('Error parsing __NEXT_DATA__:', e);
      return false;
    }
  }

  // ── URL change detection (SPA navigation) ─────────────────────────────────

  function requestFreshPageData(pathname) {
    const handler = (e) => {
      window.removeEventListener('__fw_page_data_response', handler);
      try {
        const data = JSON.parse(e.detail);
        if (data && data.pageProps) {
          log('Received fresh page data for', pathname);
          const scopedTable = buildPricingTable(data.pageProps);
          pricingTable = scopedTable.length >= 2 ? scopedTable : buildPricingTable(data);
          originalPageCurrency = detectCurrentCurrency();
          currentDisplayCurrency = originalPageCurrency;
          if (selectedCurrency !== currentDisplayCurrency) {
            applyCurrency(selectedCurrency);
          }
        }
      } catch (err) {
        log('Error processing fresh page data:', err);
      }
    };
    window.addEventListener('__fw_page_data_response', handler);
    window.dispatchEvent(new CustomEvent('__fw_request_page_data', { detail: pathname }));
    setTimeout(() => window.removeEventListener('__fw_page_data_response', handler), 5000);
  }

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      log('URL changed:', lastUrl, '→', location.href);
      lastUrl = location.href;
      setTimeout(() => {
        originalPageCurrency = null;
        currentDisplayCurrency = null;
        activeConversionMap = null;
        pendingAddedNodes = [];

        const oldTableSize = pricingTable.length;
        parseNextData();

        if (pricingTable.length <= oldTableSize) {
          log('__NEXT_DATA__ may be stale, requesting fresh data via bridge');
          requestFreshPageData(location.pathname);
        } else {
          originalPageCurrency = detectCurrentCurrency();
          currentDisplayCurrency = originalPageCurrency;
          if (selectedCurrency !== currentDisplayCurrency) {
            applyCurrency(selectedCurrency);
          }
        }
      }, 800);
    }
  }

  // ── MutationObserver ──────────────────────────────────────────────────────

  function startObserver() {
    if (domObserver) domObserver.disconnect();

    const observerOpts = { childList: true, subtree: true, characterData: true };

    domObserver = new MutationObserver((mutations) => {
      checkUrlChange();

      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            pendingAddedNodes.push(node);
          }
        } else if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
          pendingAddedNodes.push(m.target);
        }
      }

      if (pendingAddedNodes.length === 0) return;

      clearTimeout(observerDebounce);
      observerDebounce = setTimeout(() => {
        const nodesToProcess = pendingAddedNodes.splice(0);
        if (selectedCurrency !== originalPageCurrency) {
          domObserver.disconnect();
          reapplyOnNewContent(nodesToProcess);
          domObserver.observe(document.body, observerOpts);
        }
      }, 200);
    });

    domObserver.observe(document.body, observerOpts);

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

      originalPageCurrency = detectCurrentCurrency();
      currentDisplayCurrency = originalPageCurrency;
      log('Detected page currency:', originalPageCurrency);

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
