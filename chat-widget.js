(function () {
  // ============================================================
  // Chat Widget — Fixed & Production-Ready
  //
  // FIXES APPLIED:
  //  #1  Panel animation: replaced display toggle with visibility+opacity
  //  #2  Close button transform conflict: removed hardcoded translateY
  //  #3  Teaser nested fixed: moved teaser outside root to <body>
  //  #4  No session ID: generated once per page load, sent with every message
  //  #5  No retry logic: auto-retry once on network/timeout failure
  //  #6  Fragile response parsing: added more fields + cleaner fallback message
  //  #7  WhatsApp <a> Safari hover: isolated hover rule for anchor
  //  #8  Send button contrast: auto light/dark text based on primary color
  //  #9  Send button loading state: shows "..." label while waiting
  //  #10 Teaser single line: added optional subText field in config
  //  #11 Teaser re-show on update(): guarded with isChatOpen flag
  //  #12 Teaser 900ms too short: increased to 1600ms
  //  #13 WhatsApp SVG color override: force currentColor on SVG fills/strokes
  // ============================================================
 
  const defaults = {
    webhook: { url: "", route: "general" },
    branding: {
      logo: "",
      name: "My Business",
      welcomeText: "Hi 👋, how can we help?",
      responseTimeText: "We typically respond right away"
    },
    teaser: {
      enabled: true,
      text: "What brings you here today?",
      subText: "",           // FIX #10: optional second line
      autoShow: true,
      openOnClick: true
    },
    whatsapp: {
      enabled: true,
      phoneE164: "",
      message: "Hi! I'm on your website and need help.",
      showInHeader: true
    },
    style: {
      primaryColor: "#854fff",
      secondaryColor: "#6b3fd4",
      position: "right",
      backgroundColor: "#ffffff",
      fontColor: "#333333",
      whatsappBg: "rgba(255,255,255,.10)",
      whatsappHoverBg: "rgba(255,255,255,.16)",
      whatsappIconColor: "#ffffff"
    },
    requestTimeoutMs: 15000
  };
 
  const rootId = "chat-widget-root";
  if (document.getElementById(rootId)) return;
 
  // ── Utilities ────────────────────────────────────────────────
  function structuredCloneSafe(obj) {
    try { return structuredClone(obj); }
    catch { return JSON.parse(JSON.stringify(obj)); }
  }
 
  function mergeDeep(target, src) {
    for (const k of Object.keys(src || {})) {
      const v = src[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        target[k] = mergeDeep(target[k] || {}, v);
      } else {
        target[k] = v;
      }
    }
    return target;
  }
 
  const safe = (s) => (s == null ? "" : String(s));
  const esc  = (s) =>
    safe(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
 
  function hexToRgb(hex) {
    const h  = safe(hex).replace("#", "").trim();
    const is3 = h.length === 3;
    const r  = parseInt(is3 ? h[0]+h[0] : h.slice(0,2), 16);
    const g  = parseInt(is3 ? h[1]+h[1] : h.slice(2,4), 16);
    const b  = parseInt(is3 ? h[2]+h[2] : h.slice(4,6), 16);
    if ([r,g,b].some(x => Number.isNaN(x))) return {r:0,g:0,b:0};
    return {r,g,b};
  }
  function rgba(hex, a) {
    const {r,g,b} = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
 
  // FIX #8 — pick black or white text depending on background luminance
  function contrastText(hex) {
    const {r,g,b} = hexToRgb(hex);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.55 ? "#0a0a0a" : "#ffffff";
  }
 
  // FIX #4 — session ID generated once per page load
  const sessionId = "cw-" + Math.random().toString(36).slice(2) + "-" + Date.now();
 
  // ── Config ───────────────────────────────────────────────────
  const cfg = mergeDeep(structuredCloneSafe(defaults), window.ChatWidgetConfig || {});
  if (!cfg.webhook?.url) console.warn("[ChatWidget] Missing webhook.url in window.ChatWidgetConfig");
 
  function side() { return cfg.style?.position === "left" ? "left" : "right"; }
 
  // ── State ────────────────────────────────────────────────────
  let teaserDismissed = false;
  let isChatOpen      = false;   // FIX #11 — track open state reliably
 
  // ── DOM: Root ────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = rootId;
 
  // ── DOM: Panel ───────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "cw-panel";
 
  const header = document.createElement("div");
  header.className = "cw-header";
 
  const headerLeft = document.createElement("div");
  headerLeft.className = "cw-header-left";
 
  const logo = document.createElement("img");
  logo.className = "cw-logo";
  logo.alt = "logo";
 
  const titleWrap = document.createElement("div");
  titleWrap.className = "cw-title-wrap";
 
  const title    = document.createElement("div");
  title.className = "cw-title";
 
  const subtitle = document.createElement("div");
  subtitle.className = "cw-subtitle";
 
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);
  headerLeft.appendChild(logo);
  headerLeft.appendChild(titleWrap);
 
  const headerActions = document.createElement("div");
  headerActions.className = "cw-header-actions";
 
  let waLink = null;
 
  const closeBtn = document.createElement("button");
  closeBtn.className = "cw-icon-btn cw-close-btn";
  closeBtn.type = "button";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.textContent = "×";
 
  headerActions.appendChild(closeBtn);
  header.appendChild(headerLeft);
  header.appendChild(headerActions);
 
  const body = document.createElement("div");
  body.className = "cw-body";
 
  // FIX #9 — typing indicator upgraded with animated dots
  const typing = document.createElement("div");
  typing.className = "cw-typing";
  typing.style.display = "none";
  typing.innerHTML = '<span class="cw-dot"></span><span class="cw-dot"></span><span class="cw-dot"></span>';
 
  const footer = document.createElement("div");
  footer.className = "cw-footer";
 
  const input = document.createElement("input");
  input.className = "cw-input";
  input.placeholder = "Type a message…";
  input.autocomplete = "off";
  input.spellcheck = true;
  input.setAttribute("aria-label", "Chat message");
 
  const send = document.createElement("button");
  send.className = "cw-send";
  send.type = "button";
  send.innerHTML = '<span class="cw-send-label">Send</span>';
 
  footer.appendChild(input);
  footer.appendChild(send);
  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(typing);
  panel.appendChild(footer);
 
  // ── DOM: Teaser — FIX #3: appended to body, not inside root ──
  const teaserWrap = document.createElement("div");
  teaserWrap.className = "cw-teaser-wrap";
  teaserWrap.id = "cw-teaser-wrap";
 
  const teaserX = document.createElement("button");
  teaserX.className = "cw-teaser-x";
  teaserX.type = "button";
  teaserX.title = "Close";
  teaserX.setAttribute("aria-label", "Close teaser");
  teaserX.textContent = "×";
 
  const teaser = document.createElement("div");
  teaser.className = "cw-teaser";
 
  teaserWrap.appendChild(teaserX);
  teaserWrap.appendChild(teaser);
 
  // ── DOM: Launcher ─────────────────────────────────────────────
  const launcher = document.createElement("button");
  launcher.className = "cw-launcher";
  launcher.type = "button";
  launcher.title = "Chat";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C7.03 3 3 6.58 3 11c0 2.11.93 4.03 2.47 5.49L5 21l4.11-2.05c.9.23 1.87.35 2.89.35 4.97 0 9-3.58 9-8s-4.03-8.3-9-8.3Zm-3 9h6a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Zm0-4h10a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Z"/></svg>';
 
  root.appendChild(panel);
  root.appendChild(launcher);
  document.body.appendChild(root);
  document.body.appendChild(teaserWrap); // FIX #3
 
  // ── Styles ────────────────────────────────────────────────────
  const styleTag = document.createElement("style");
  styleTag.id = rootId + "-style";
  document.head.appendChild(styleTag);
 
  function buildCss() {
    const s         = mergeDeep(structuredCloneSafe(defaults.style), cfg.style || {});
    const pos       = side();
    const primary   = s.primaryColor;
    const secondary = s.secondaryColor;
    const bg        = s.backgroundColor;
    const font      = s.fontColor;
    const waBg      = s.whatsappBg;
    const waHoverBg = s.whatsappHoverBg;
    const waIcon    = s.whatsappIconColor;
    const sendText  = contrastText(primary); // FIX #8
 
    return `
#${rootId}{
  position:fixed;
  ${pos}:22px;
  bottom:22px;
  z-index:999999;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
}
#${rootId} *{box-sizing:border-box}
 
/* ── Launcher ── */
.cw-launcher{
  width:62px;height:62px;border-radius:999px;border:0;cursor:pointer;
  background:
    radial-gradient(120% 120% at 20% 10%, rgba(255,255,255,.45), rgba(255,255,255,0) 50%),
    linear-gradient(135deg, ${primary}, ${secondary});
  box-shadow:0 12px 28px rgba(2,6,23,.18);
  display:flex;align-items:center;justify-content:center;
  color:#fff;
  transition:transform .18s ease, box-shadow .18s ease, filter .18s ease;
}
.cw-launcher:hover{transform:translateY(-2px);filter:saturate(1.05);box-shadow:0 18px 36px rgba(2,6,23,.22)}
.cw-launcher:active{transform:translateY(0) scale(.98)}
.cw-launcher svg{display:block}
 
/* ── Panel ── */
/* FIX #1: use visibility+opacity instead of display toggle so transitions actually fire */
.cw-panel{
  position:absolute;
  ${pos}:0;
  bottom:78px;
  width:360px;
  max-width:calc(100vw - 44px);
  height:520px;
  max-height:calc(100vh - 130px);
  border-radius:18px;
  overflow:hidden;
  background:${bg};
  color:${font};
  box-shadow:0 22px 60px rgba(2,6,23,.30);
  border:1px solid rgba(15,23,42,.10);
  display:flex;
  flex-direction:column;
  visibility:hidden;
  pointer-events:none;
  transform:translateY(14px) scale(.98);
  opacity:0;
  transform-origin:${pos} bottom;
  transition:transform .22s ease, opacity .22s ease, visibility .22s;
}
.cw-panel.open{
  visibility:visible;
  pointer-events:auto;
  transform:translateY(0) scale(1);
  opacity:1;
}
 
/* ── Header ── */
.cw-header{
  padding:14px;
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  color:#fff;
  background:linear-gradient(135deg, ${primary}, ${secondary});
  position:relative;
  flex-shrink:0;
}
.cw-header:after{
  content:"";position:absolute;inset:0;
  background:radial-gradient(70% 120% at 15% 10%, rgba(255,255,255,.18), rgba(255,255,255,0) 60%);
  pointer-events:none;
}
.cw-header-left{display:flex;align-items:center;gap:10px;min-width:0;position:relative;z-index:1}
.cw-logo{
  width:34px;height:34px;border-radius:10px;object-fit:cover;
  background:rgba(255,255,255,.15);
  border:1px solid rgba(255,255,255,.22);
  box-shadow:0 8px 18px rgba(0,0,0,.20);
}
.cw-title-wrap{min-width:0}
.cw-title{font-weight:800;font-size:14px;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-subtitle{font-size:12px;opacity:.85;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-header-actions{display:flex;gap:8px;align-items:center;position:relative;z-index:1}
 
/* ── Icon buttons ── */
.cw-icon-btn{
  width:38px;height:38px;border-radius:12px;
  border:1px solid rgba(255,255,255,.22);
  background:rgba(255,255,255,.10);
  color:#fff;
  cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  text-decoration:none;
  padding:0;margin:0;line-height:1;
  font:inherit;
  -webkit-appearance:none;appearance:none;
  transition:background .15s ease, transform .15s ease;
}
.cw-icon-btn:hover{background:rgba(255,255,255,.16);transform:translateY(-1px)}
.cw-icon-btn:active{transform:translateY(0) scale(.98)}
 
/* FIX #2: close btn no longer has conflicting hardcoded transform */
.cw-close-btn{
  font-size:26px;font-weight:900;line-height:1;color:#fff;
}
 
/* FIX #7 & #13: WhatsApp is an <a>, isolated hover rule + force SVG currentColor */
/* Website/theme CSS can override .cw-wa color, so scope to #chat-widget-root and add !important */
#${rootId} a.cw-icon-btn.cw-wa{background:${waBg} !important;color:${waIcon} !important;}
#${rootId} a.cw-icon-btn.cw-wa:hover{background:${waHoverBg} !important;}
#${rootId} a.cw-icon-btn.cw-wa svg{display:block}
/* FIX #13: force WhatsApp SVG to respect configured icon color override */
#${rootId} a.cw-icon-btn.cw-wa svg,
#${rootId} a.cw-icon-btn.cw-wa svg * { fill: currentColor !important; stroke: currentColor !important; }
 
/* ── Body ── */
.cw-body{
  padding:14px;overflow-y:auto;flex:1;
  background:
    radial-gradient(120% 120% at 20% 0%, ${rgba(primary,.10)}, rgba(255,255,255,0) 40%),
    radial-gradient(120% 120% at 100% 10%, ${rgba(secondary,.08)}, rgba(255,255,255,0) 45%),
    linear-gradient(${bg}, ${bg});
}
.cw-msg{margin:10px 0;display:flex}
.cw-msg.user{justify-content:flex-end}
.cw-bubble{
  max-width:82%;padding:11px 12px;border-radius:16px;
  font-size:14px;line-height:1.5;
  white-space:pre-wrap;word-break:break-word;
  color:${font};
  box-shadow:0 8px 20px rgba(2,6,23,.06);
}
.cw-msg.bot .cw-bubble{
  background:rgba(255,255,255,.92);
  border:1px solid rgba(15,23,42,.08);
  backdrop-filter:blur(8px);
  border-top-left-radius:8px;
}
.cw-msg.user .cw-bubble{
  background:linear-gradient(135deg, ${rgba(primary,.22)}, ${rgba(secondary,.18)});
  border:1px solid rgba(15,23,42,.08);
  border-top-right-radius:8px;
}
 
/* FIX #9: animated typing dots */
.cw-typing{
  padding:6px 14px 10px;
  display:flex;align-items:center;gap:5px;
  min-height:32px;
}
.cw-dot{
  width:7px;height:7px;border-radius:50%;
  background:${rgba(primary,.55)};
  display:inline-block;
  animation:cwBounce 1.1s infinite ease-in-out both;
}
.cw-dot:nth-child(1){animation-delay:0s}
.cw-dot:nth-child(2){animation-delay:.18s}
.cw-dot:nth-child(3){animation-delay:.36s}
@keyframes cwBounce{
  0%,80%,100%{transform:scale(.6);opacity:.5}
  40%{transform:scale(1);opacity:1}
}
 
/* ── Footer ── */
.cw-footer{
  padding:12px;display:flex;gap:10px;flex-shrink:0;
  border-top:1px solid rgba(15,23,42,.08);
  background:rgba(255,255,255,.90);
  backdrop-filter:blur(10px);
}
.cw-input{
  flex:1;border:1px solid rgba(15,23,42,.14);border-radius:14px;
  padding:11px 12px;font-size:14px;outline:none;background:#fff;
  transition:box-shadow .15s ease, border-color .15s ease;
}
.cw-input:focus{
  border-color:${rgba(primary,.65)};
  box-shadow:0 0 0 4px ${rgba(primary,.18)};
}
/* FIX #8: send text color auto-contrasts with primary */
.cw-send{
  border:none;border-radius:14px;padding:0 18px;
  cursor:pointer;font-weight:900;letter-spacing:.2px;
  color:${sendText};
  background:linear-gradient(135deg, ${primary}, ${secondary});
  box-shadow:0 12px 26px ${rgba(secondary,.22)};
  transition:transform .15s ease, filter .15s ease;
  min-width:66px;
  display:flex;align-items:center;justify-content:center;
}
.cw-send:hover:not(:disabled){transform:translateY(-1px);filter:saturate(1.05)}
.cw-send:active:not(:disabled){transform:translateY(0) scale(.99)}
.cw-send:disabled{opacity:.6;cursor:not-allowed;box-shadow:none}
.cw-send-label{font-size:14px}
 
/* FIX #9: sending dots inside button */
.cw-send-dots{display:flex;gap:3px;align-items:center}
.cw-send-dot{
  width:5px;height:5px;border-radius:50%;
  background:${sendText};
  animation:cwBounce 1.1s infinite ease-in-out both;
}
.cw-send-dot:nth-child(1){animation-delay:0s}
.cw-send-dot:nth-child(2){animation-delay:.18s}
.cw-send-dot:nth-child(3){animation-delay:.36s}
 
/* ── Teaser ── FIX #3: position:fixed on direct body child ── */
/* FIX #12: shown after 1600ms delay (handled in JS) */
.cw-teaser-wrap{
  position:fixed;
  ${pos}:96px;
  bottom:30px;
  display:none;
  align-items:flex-start;
  gap:8px;
  max-width:290px;
  z-index:1000000;
}
.cw-teaser{
  background:#fff;
  border:1px solid rgba(15,23,42,.10);
  box-shadow:0 16px 40px rgba(2,6,23,.18);
  border-radius:16px;
  padding:13px 16px;
  color:${font};
  cursor:pointer;
  user-select:none;
  animation:cwTeaserIn .25s ease forwards;
}
@keyframes cwTeaserIn{
  from{opacity:0;transform:translateY(8px) scale(.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
/* FIX #10: teaser supports main text + subText */
.cw-teaser-main{font-weight:700;font-size:14px;margin-bottom:0}
.cw-teaser-sub{font-size:12px;opacity:.65;margin-top:4px;line-height:1.4}
 
.cw-teaser-x{
  width:28px;height:28px;border-radius:999px;
  border:1px solid rgba(15,23,42,.12);
  background:#fff;
  box-shadow:0 6px 16px rgba(2,6,23,.12);
  cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  padding:0;margin:0;font:inherit;
  -webkit-appearance:none;appearance:none;
  color:#111;
  font-size:20px;font-weight:900;line-height:1;
  flex-shrink:0;
  margin-top:2px;
  transition:transform .12s ease;
}
.cw-teaser-x:hover{transform:translateY(-1px)}
 
@media(max-width:420px){
  .cw-panel{width:calc(100vw - 44px);height:70vh}
  .cw-teaser-wrap{max-width:220px}
}
    `;
  }
 
  // ── Apply config to UI ─────────────────────────────────────
  function applyBranding() {
    title.textContent    = safe(cfg.branding?.name)             || defaults.branding.name;
    subtitle.textContent = safe(cfg.branding?.responseTimeText) || defaults.branding.responseTimeText;
    const logoUrl = safe(cfg.branding?.logo);
    if (logoUrl) {
      logo.src = logoUrl;
      logo.style.display = "";
    } else {
      logo.style.display = "none";
    }
  }
 
  function applyTeaser() {
    const t = mergeDeep(structuredCloneSafe(defaults.teaser), cfg.teaser || {});
    cfg.teaser = t;
 
    // FIX #10: render main + optional subText
    let html = `<div class="cw-teaser-main">${esc(t.text)}</div>`;
    if (t.subText) html += `<div class="cw-teaser-sub">${esc(t.subText)}</div>`;
    teaser.innerHTML = html;
 
    if (!t.enabled) teaserWrap.style.display = "none";
  }
 
  function applyWhatsApp() {
    if (waLink && waLink.parentNode) waLink.parentNode.removeChild(waLink);
    waLink = null;
 
    const wa = mergeDeep(structuredCloneSafe(defaults.whatsapp), cfg.whatsapp || {});
    cfg.whatsapp = wa;
    if (!wa.enabled || !wa.showInHeader || !wa.phoneE164) return;
 
    const msg  = encodeURIComponent(wa.message || "");
    const href = `https://wa.me/${wa.phoneE164}${msg ? `?text=${msg}` : ""}`;
 
    waLink = document.createElement("a");
    waLink.className = "cw-icon-btn cw-wa";
    waLink.href      = href;
    waLink.target    = "_blank";
    waLink.rel       = "noopener noreferrer";
    waLink.title     = "Chat on WhatsApp";
    waLink.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M19.11 17.79c-.27-.14-1.61-.79-1.86-.88-.25-.09-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.15-.42-2.19-1.35-.81-.72-1.35-1.61-1.51-1.88-.16-.27-.02-.42.12-.56.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.61-1.48-.84-2.03-.22-.53-.45-.46-.61-.47h-.52c-.18 0-.48.07-.73.34-.25.27-.95.93-.95 2.27 0 1.34.98 2.63 1.12 2.81.14.18 1.93 2.95 4.67 4.13.65.28 1.16.45 1.56.58.66.21 1.27.18 1.75.11.53-.08 1.61-.66 1.84-1.29.23-.63.23-1.18.16-1.29-.07-.11-.25-.18-.52-.32z"/><path fill="currentColor" d="M16.03 3C9.4 3 4 8.4 4 15.03c0 2.1.55 4.14 1.6 5.95L4 29l8.22-1.56c1.74.95 3.7 1.45 5.81 1.45C24.66 28.89 30 23.63 30 17c0-6.63-5.34-14-13.97-14zm0 23.5c-1.86 0-3.6-.5-5.12-1.37l-.37-.22-4.88.93.94-4.75-.24-.39c-1.03-1.66-1.57-3.57-1.57-5.55C5.79 9.56 10.56 4.8 16.03 4.8S26.3 9.56 26.3 15.03 21.5 26.5 16.03 26.5z"/></svg>';
 
    headerActions.insertBefore(waLink, closeBtn);
  }
 
  function render() {
    cfg.style = mergeDeep(structuredCloneSafe(defaults.style), cfg.style || {});
    styleTag.textContent = buildCss();
    applyBranding();
    applyTeaser();
    applyWhatsApp();
  }
 
  // ── Chat behavior ──────────────────────────────────────────
  function addMsg(role, text) {
    const row = document.createElement("div");
    row.className = "cw-msg " + (role === "user" ? "user" : "bot");
    const b = document.createElement("div");
    b.className = "cw-bubble";
    b.innerHTML = esc(text);
    row.appendChild(b);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }
 
  // FIX #1: open/close via class only (visibility/opacity handles animation)
  function setOpen(open) {
    isChatOpen = open;
    panel.classList.toggle("open", open);
    if (open) teaserWrap.style.display = "none";
  }
 
  // FIX #9: proper typing indicator + send button loading state
  function setLoading(on) {
    typing.style.display = on ? "flex" : "none";
    send.disabled = on;
    send.innerHTML = on
      ? '<span class="cw-send-dots"><span class="cw-send-dot"></span><span class="cw-send-dot"></span><span class="cw-send-dot"></span></span>'
      : '<span class="cw-send-label">Send</span>';
  }
 
  // FIX #6: expanded response field extraction + user-friendly fallback
  function extractReply(data) {
    if (typeof data === "string" && data.trim()) return data;
    if (data && typeof data === "object") {
      const fields = ["reply","text","message","output","response","answer","content","result"];
      for (const f of fields) {
        if (typeof data[f] === "string" && data[f]) return data[f];
      }
      if (data.data && typeof data.data === "object") {
        for (const f of fields) {
          if (typeof data.data[f] === "string" && data.data[f]) return data.data[f];
        }
      }
    }
    return "Sorry, I didn't get a response. Please try again.";
  }
 
  // FIX #4 + FIX #5: session ID sent, with one auto-retry on failure
  async function doFetch(message) {
    const url        = cfg.webhook?.url;
    const controller = new AbortController();
    const timeoutMs  = Number(cfg.requestTimeoutMs) > 0 ? Number(cfg.requestTimeoutMs) : 15000;
    const timeout    = setTimeout(() => controller.abort(), timeoutMs);
 
    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message,
          route:     cfg.webhook?.route || "general",
          sessionId              // FIX #4
        }),
        signal: controller.signal
      });
 
      const raw = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw}`);
 
      let data;
      try { data = JSON.parse(raw); }
      catch { data = raw; }
 
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e };
    } finally {
      clearTimeout(timeout);
    }
  }
 
  async function sendToWebhook(message) {
    if (!cfg.webhook?.url) {
      addMsg("bot", "Webhook URL is not configured.");
      return;
    }
 
    setLoading(true);
 
    // FIX #5: try once, on failure retry once automatically
    let result = await doFetch(message);
    if (!result.ok) {
      result = await doFetch(message); // one retry
    }
 
    setLoading(false);
 
    if (!result.ok) {
      const e = result.error;
      if (e && (e.name === "AbortError" || String(e).includes("AbortError"))) {
        addMsg("bot", "Request timed out. Please try again.");
      } else {
        addMsg("bot", "Could not reach the server. Please check your connection and try again.");
      }
      console.error("[ChatWidget] webhook error after retry", e);
      return;
    }
 
    addMsg("bot", extractReply(result.data));
  }
 
  function handleSend() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    addMsg("user", text);
    sendToWebhook(text);
  }
 
  // ── Teaser logic ───────────────────────────────────────────
  function showTeaser() {
    if (teaserDismissed)              return;
    if (!cfg.teaser?.enabled)         return;
    if (isChatOpen)                   return;
    teaserWrap.style.display = "flex";
  }
 
  // ── Events ─────────────────────────────────────────────────
  launcher.addEventListener("click", () => {
    const open = !isChatOpen;
    setOpen(open);
    if (open && body.childElementCount === 0)
      addMsg("bot", cfg.branding?.welcomeText || defaults.branding.welcomeText);
    if (open) setTimeout(() => input.focus(), 50);
  });
 
  closeBtn.addEventListener("click", () => setOpen(false));
  send.addEventListener("click", handleSend);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSend(); });
 
  teaserX.addEventListener("click", (e) => {
    e.stopPropagation();
    teaserDismissed = true;
    teaserWrap.style.display = "none";
  });
 
  teaser.addEventListener("click", () => {
    if (cfg.teaser?.openOnClick) {
      setOpen(true);
      if (body.childElementCount === 0)
        addMsg("bot", cfg.branding?.welcomeText || defaults.branding.welcomeText);
      setTimeout(() => input.focus(), 50);
    }
  });
 
  // ── Public API ─────────────────────────────────────────────
  window.ChatWidget = window.ChatWidget || {};
 
  window.ChatWidget.update = function (partial) {
    mergeDeep(cfg, partial || {});
    mergeDeep(window.ChatWidgetConfig || {}, partial || {});
    render();
 
    // FIX #11: only re-show teaser if not dismissed AND chat is not open
    if (cfg.teaser?.enabled && !teaserDismissed && !isChatOpen) {
      teaserWrap.style.display = "flex";
    }
  };
 
  window.ChatWidget.getConfig = function () {
    return structuredCloneSafe(cfg);
  };
 
  // ── Init ───────────────────────────────────────────────────
  render();
  // FIX #12: 1600ms delay instead of 900ms for safer page-load timing
  if (cfg.teaser?.enabled && cfg.teaser?.autoShow) setTimeout(showTeaser, 1600);
 
})();
