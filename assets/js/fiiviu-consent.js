(() => {
  "use strict";

  const STORAGE_KEY = "fiiviu_consent_v1";
  const CONSENT_VERSION = 1;
  const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
  const DEFAULTS = Object.freeze({ necessary: true, statistics: false, marketing: false });
  const TEXT = {
    de: {
      title: "Deine Privatsphäre ist uns wichtig",
      body: "Wir verwenden notwendige Speichertechnologien für den Betrieb der Website. Optionale Statistik- und Marketing-Technologien sind standardmäßig ausgeschaltet. Du kannst alle akzeptieren, optionale Technologien ablehnen oder deine Auswahl festlegen.",
      accept: "Alle akzeptieren",
      reject: "Alle ablehnen",
      settings: "Einstellungen",
      save: "Auswahl speichern",
      back: "Zurück",
      necessary: "Notwendig",
      necessaryText: "Für grundlegende Funktionen, Sicherheit und die Speicherung deiner Datenschutzauswahl erforderlich.",
      stats: "Statistik",
      statsText: "Hilft uns zu verstehen, wie die Website genutzt wird. Derzeit ist kein Statistikdienst aktiviert.",
      marketing: "Marketing",
      marketingText: "Für personalisierte Werbung und Marketingmessung. Derzeit ist kein Marketingdienst aktiviert.",
      privacy: "Datenschutzerklärung",
      cookies: "Cookie-Richtlinie",
      manage: "Cookie-Einstellungen",
      saved: "Deine Auswahl wurde gespeichert."
    },
    en: {
      title: "Your privacy matters",
      body: "We use essential storage technologies to operate this website. Optional statistics and marketing technologies are off by default. You can accept all, reject optional technologies, or configure your choices.",
      accept: "Accept all",
      reject: "Reject all",
      settings: "Settings",
      save: "Save choices",
      back: "Back",
      necessary: "Necessary",
      necessaryText: "Required for core functions, security and storing your privacy choice.",
      stats: "Statistics",
      statsText: "Helps us understand how the website is used. No statistics service is currently enabled.",
      marketing: "Marketing",
      marketingText: "Used for personalised advertising and campaign measurement. No marketing service is currently enabled.",
      privacy: "Privacy policy",
      cookies: "Cookie policy",
      manage: "Cookie settings",
      saved: "Your choice has been saved."
    },
    ro: {
      title: "Confidențialitatea ta este importantă",
      body: "Utilizăm tehnologii de stocare necesare pentru funcționarea site-ului. Tehnologiile opționale de statistică și marketing sunt dezactivate implicit. Poți accepta toate, refuza tehnologiile opționale sau îți poți configura opțiunile.",
      accept: "Acceptă toate",
      reject: "Respinge toate",
      settings: "Setări",
      save: "Salvează opțiunile",
      back: "Înapoi",
      necessary: "Necesare",
      necessaryText: "Necesare pentru funcțiile de bază, securitate și memorarea opțiunii tale privind confidențialitatea.",
      stats: "Statistică",
      statsText: "Ne ajută să înțelegem utilizarea site-ului. În prezent nu este activat niciun serviciu de statistică.",
      marketing: "Marketing",
      marketingText: "Pentru publicitate personalizată și măsurarea campaniilor. În prezent nu este activat niciun serviciu de marketing.",
      privacy: "Politica de confidențialitate",
      cookies: "Politica privind cookie-urile",
      manage: "Setări cookie",
      saved: "Opțiunea ta a fost salvată."
    }
  };

  const safeRead = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const updatedAt = Date.parse(parsed.updatedAt);
      if (parsed.version !== CONSENT_VERSION || !Number.isFinite(updatedAt) || Date.now() - updatedAt > CONSENT_MAX_AGE_MS) return null;
      return {
        version: CONSENT_VERSION,
        updatedAt: parsed.updatedAt,
        necessary: true,
        statistics: parsed.statistics === true,
        marketing: parsed.marketing === true
      };
    } catch (_) {
      return null;
    }
  };

  let current = safeRead();
  let panel = "banner";
  let lang = (document.documentElement.lang || "de").slice(0, 2).toLowerCase();
  if (!TEXT[lang]) lang = "de";

  const copy = () => TEXT[lang] || TEXT.de;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  const save = choices => {
    current = {
      version: CONSENT_VERSION,
      updatedAt: new Date().toISOString(),
      necessary: true,
      statistics: choices.statistics === true,
      marketing: choices.marketing === true
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (_) {}
    window.dispatchEvent(new CustomEvent("fiiviu:consentchange", { detail: { ...current } }));
    render();
  };

  const style = document.createElement("style");
  style.textContent = `
    #fiiviu-consent-root{position:fixed;inset:auto 16px 16px 16px;z-index:10050;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#171717}
    #fiiviu-consent-root *{box-sizing:border-box}
    #fiiviu-consent-root .fc-panel{max-width:760px;margin:0 auto;background:#fff;border:1px solid rgba(21,21,21,.14);border-radius:20px;box-shadow:0 18px 70px rgba(0,0,0,.22);padding:22px}
    #fiiviu-consent-root h2{font-size:20px;font-weight:800;line-height:1.2;margin:0 0 9px}
    #fiiviu-consent-root p{margin:0 0 14px;color:#4b5563}
    #fiiviu-consent-root .fc-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}
    #fiiviu-consent-root button{border:1px solid #151515;border-radius:12px;padding:11px 15px;font-weight:750;cursor:pointer;min-height:44px}
    #fiiviu-consent-root .fc-primary{background:#151515;color:#fff}
    #fiiviu-consent-root .fc-secondary{background:#fff;color:#151515}
    #fiiviu-consent-root .fc-links{display:flex;gap:14px;flex-wrap:wrap;margin-top:13px;font-size:12px}
    #fiiviu-consent-root a{color:#9b451b;text-decoration:underline}
    #fiiviu-consent-root .fc-row{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-top:1px solid #eee}
    #fiiviu-consent-root .fc-row strong{display:block}
    #fiiviu-consent-root .fc-row small{display:block;color:#6b7280;max-width:560px;margin-top:3px}
    #fiiviu-consent-root input{width:20px;height:20px;accent-color:#c9581d;flex:0 0 auto}
    #fiiviu-consent-root .fc-manage{position:fixed;right:16px;bottom:16px;background:#151515;color:#fff;border:0;border-radius:999px;padding:10px 15px;box-shadow:0 5px 20px rgba(0,0,0,.2);font-size:12px}
    @media(max-width:560px){#fiiviu-consent-root{inset:auto 8px 8px}#fiiviu-consent-root .fc-panel{padding:17px;border-radius:17px}#fiiviu-consent-root .fc-actions button{flex:1 1 100%}#fiiviu-consent-root .fc-manage{right:10px;bottom:10px}}
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "fiiviu-consent-root";
  root.setAttribute("aria-live", "polite");
  document.body.appendChild(root);

  const render = () => {
    const t = copy();
    if (panel === "closed") {
      root.innerHTML = '<button class="fc-manage" type="button" data-action="open">' + escapeHtml(t.manage) + '</button>';
      return;
    }
    const settings = panel === "settings";
    const intro = current && !settings ? t.saved : t.body;
    root.innerHTML = '<section class="fc-panel" role="dialog" aria-modal="false" aria-labelledby="fc-title">' +
      '<h2 id="fc-title">' + escapeHtml(settings ? t.settings : t.title) + '</h2>' +
      '<p>' + escapeHtml(intro) + '</p>' +
      (settings ? (
        '<div class="fc-row"><div><strong>' + escapeHtml(t.necessary) + '</strong><small>' + escapeHtml(t.necessaryText) + '</small></div><input type="checkbox" checked disabled aria-label="' + escapeHtml(t.necessary) + '"></div>' +
        '<div class="fc-row"><div><strong>' + escapeHtml(t.stats) + '</strong><small>' + escapeHtml(t.statsText) + '</small></div><input id="fc-statistics" type="checkbox" ' + (current && current.statistics ? 'checked' : '') + '></div>' +
        '<div class="fc-row"><div><strong>' + escapeHtml(t.marketing) + '</strong><small>' + escapeHtml(t.marketingText) + '</small></div><input id="fc-marketing" type="checkbox" ' + (current && current.marketing ? 'checked' : '') + '></div>'
      ) : '') +
      '<div class="fc-actions">' +
        (settings ? '<button class="fc-secondary" type="button" data-action="back">' + escapeHtml(t.back) + '</button><button class="fc-primary" type="button" data-action="save">' + escapeHtml(t.save) + '</button>' :
          '<button class="fc-primary" type="button" data-action="accept">' + escapeHtml(t.accept) + '</button><button class="fc-secondary" type="button" data-action="reject">' + escapeHtml(t.reject) + '</button><button class="fc-secondary" type="button" data-action="settings">' + escapeHtml(t.settings) + '</button>') +
      '</div><div class="fc-links"><a href="/legal/politica-de-confidentialitate.html?lang=' + lang + '">' + escapeHtml(t.privacy) + '</a><a href="/legal/politica-cookie.html?lang=' + lang + '">' + escapeHtml(t.cookies) + '</a></div></section>';
  };

  root.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "open" || action === "settings") { panel = "settings"; render(); }
    if (action === "back") { panel = current ? "closed" : "banner"; render(); }
    if (action === "accept") { save({ statistics: true, marketing: true }); panel = "closed"; render(); }
    if (action === "reject") { save(DEFAULTS); panel = "closed"; render(); }
    if (action === "save") {
      save({
        statistics: !!root.querySelector("#fc-statistics")?.checked,
        marketing: !!root.querySelector("#fc-marketing")?.checked
      });
      panel = "closed";
      render();
    }
  });

  window.FiiViuConsent = Object.freeze({
    get current() { return current ? { ...current } : null; },
    hasConsent(category) {
      if (category === "necessary") return true;
      return !!current && current[category] === true;
    },
    openSettings() { panel = "settings"; render(); },
    loadScript(category, src, options = {}) {
      if (!["statistics", "marketing"].includes(category) || !this.hasConsent(category)) {
        return Promise.reject(new Error("Consent required for " + category));
      }
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        if (options.integrity) script.integrity = options.integrity;
        if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
        script.onload = () => resolve(script);
        script.onerror = () => reject(new Error("Unable to load optional script"));
        document.head.appendChild(script);
      });
    }
  });

  window.addEventListener("fiiviu:consentchange", event => {
    const choices = event.detail || {};
    if (!choices.statistics || !choices.marketing) {
      // Optional integrations must subscribe to this event and stop future collection.
      // Existing third-party cookies cannot be deleted reliably across domains.
    }
  });

  const observer = new MutationObserver(() => {
    const next = (document.documentElement.lang || lang).slice(0, 2).toLowerCase();
    if (TEXT[next] && next !== lang) { lang = next; render(); }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  panel = current ? "closed" : "banner";
  render();
})();
