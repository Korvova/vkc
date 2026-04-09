(function () {
  const BTN_ID = 'vkc-join-link-helper-btn';
  const URL_PATTERN = /(?:https?:\/\/)?(?:my\.)?mts-link\.ru\/j\/[\w-]+\/[\w-]+(?:\/[\w-]+\/[\w-]+)?/i;

  function normalizeUrl(raw) {
    if (!raw) return null;
    const trimmed = String(raw).trim().replace(/[),.;!?]+$/, '');
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^(?:my\.)?mts-link\.ru\//i.test(trimmed)) return 'https://' + trimmed;
    return null;
  }

  function extractLinkFromDom() {
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(URL_PATTERN);
      if (m) return normalizeUrl(m[0]);
    }

    const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    const m = String(bodyText).match(URL_PATTERN);
    return m ? normalizeUrl(m[0]) : null;
  }

  function ensureButton(link) {
    let btn = document.getElementById(BTN_ID);
    if (!link) {
      if (btn) btn.remove();
      return;
    }

    if (!btn) {
      btn = document.createElement('a');
      btn.id = BTN_ID;
      btn.textContent = 'Подключиться к созвону';
      btn.style.position = 'fixed';
      btn.style.top = '12px';
      btn.style.right = '12px';
      btn.style.zIndex = '2147483647';
      btn.style.background = '#0b57d0';
      btn.style.color = '#fff';
      btn.style.padding = '10px 14px';
      btn.style.borderRadius = '8px';
      btn.style.font = '600 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      btn.style.textDecoration = 'none';
      btn.style.boxShadow = '0 6px 18px rgba(0,0,0,.25)';
      btn.style.cursor = 'pointer';
      btn.target = '_self';
      btn.rel = 'noopener noreferrer';
      document.body.appendChild(btn);
    }
    btn.href = link;
  }

  function update() {
    try {
      ensureButton(extractLinkFromDom());
    } catch (_) {}
  }

  update();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();

