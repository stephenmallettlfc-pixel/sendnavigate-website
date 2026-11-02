/* Optional organic measurement. No Google request before analytics consent. */
(() => {
  'use strict';
  const key = 'sendnavigate-analytics-choice-v1';
  const measurementId = 'G-LM84B56QZY';
  let enabled = false;
  let loaded = false;
  let dialog;
  const readChoice = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const remember = value => { try { localStorage.setItem(key, value); } catch { /* Session-only choice if storage unavailable. */ } };
  function googleTag() { window.dataLayer.push(arguments); }
  const event = (name, values = {}) => {
    if (!enabled || !loaded) return;
    // Never send field values, addresses, search text, case details or URL queries.
    googleTag('event', name, values);
  };
  function enable() {
    enabled = true;
    window['ga-disable-' + measurementId] = false;
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    googleTag('js', new Date());
    googleTag('config', measurementId, {
      send_page_view: false,
      page_location: location.origin + location.pathname,
      page_referrer: '',
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    googleTag('event', 'page_view', {
      page_location: location.origin + location.pathname,
      page_title: document.title,
      page_referrer: ''
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.append(script);
  }
  function disable() {
    enabled = false;
    window['ga-disable-' + measurementId] = true;
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim();
      if (!/^_(ga|gid|gat|gcl)/.test(name)) continue;
      for (const domain of ['', location.hostname, '.' + location.hostname]) {
        document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax' + (domain ? '; domain=' + domain : '');
      }
    }
  }
  function close() {
    dialog.hidden = true;
    const previous = dialog.previousFocus;
    if (previous && document.contains(previous)) previous.focus();
  }
  function choose(value) {
    remember(value);
    if (value === 'accept') enable(); else disable();
    close();
  }
  // Keep legacy calls harmless after their old tracking blocks are removed.
  // No call can configure advertising or claim a click is a booking/sale.
  window.gtag = function () {};
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.sn-consent[hidden]{display:none}.sn-consent{position:fixed;inset:auto 1rem 1rem;z-index:9999;margin:auto;max-width:680px;padding:1.4rem;background:#fffdf9;color:#2c1a0e;border:2px solid #355a40;border-radius:10px;box-shadow:0 8px 40px #0003;font:normal 1rem/1.6 system-ui}.sn-consent h2{font:700 1.2rem/1.3 system-ui;margin:0 0 .6rem;color:#2c1a0e}.sn-consent p{margin:0 0 1rem;color:#4a3728}.sn-consent-actions{display:flex;flex-wrap:wrap;gap:.8rem}.sn-consent button{padding:.75rem 1rem;min-height:44px;background:#355a40;color:#fff;border:2px solid #355a40;border-radius:6px;font:700 .95rem system-ui;cursor:pointer}.sn-consent a{color:#355a40;text-decoration:underline}.sn-consent button:focus-visible,.sn-privacy-control:focus-visible{outline:3px solid #c97b2a;outline-offset:4px}.sn-privacy-control{display:block;margin:1rem auto;padding:.5rem .75rem;min-height:44px;border:1px solid #dfc595;background:transparent;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}';
    document.head.append(style);
    dialog = document.createElement('section');
    dialog.className = 'sn-consent';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Optional analytics');
    dialog.innerHTML = '<h2>Optional website analytics</h2><p>With your permission, Google Analytics helps us see which pages and help links are useful. We do not use advertising tags here. You can use the site and book a call without accepting analytics. Your choice is saved on this device. <a href="/privacy-policy#analytics-choice">Privacy details</a>.</p><div class="sn-consent-actions"><button type="button" data-choice="reject">Reject analytics</button><button type="button" data-choice="accept">Accept analytics</button></div>';
    document.body.append(dialog);
    dialog.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => choose(button.dataset.choice)));
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'sn-privacy-control';
    settings.textContent = 'Analytics preferences';
    settings.addEventListener('click', () => { dialog.previousFocus = settings; dialog.hidden = false; dialog.querySelector('button').focus(); });
    (document.querySelector('footer') || document.body).append(settings);
    const choice = readChoice();
    if (choice === 'accept') enable();
    else if (choice === 'reject') disable();
    else dialog.hidden = false;
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      let url;
      try { url = new URL(link.href, location.href); } catch { return; }
      if (['calendar.app.google', 'calendar.google.com'].includes(url.hostname)) event('consultation_link_click', { link_destination: 'calendar' });
      else if (url.hostname.includes('amazon.') || url.hostname === 'amzn.to') event('book_retailer_click', { link_destination: 'amazon' });
      else if (url.origin === location.origin && url.pathname === '/free-consultation') event('consultation_page_link_click');
      else if (url.origin === location.origin && url.pathname.endsWith('.pdf')) event('resource_link_click', { resource_path: url.pathname });
    });
  });
})();
