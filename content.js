// content.js — injects a small trigger icon into text fields the moment the
// user focuses them, opens a self-contained panel (Shadow DOM, position:fixed).

(() => {
  let disabledOnThisTab = false;
  let lastField = null;
  let icon = null;
  let panelHost = null;
  let panelState = null;

  try {
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({ type: "COH_CHECK_DISABLED" }, (res) => {
        if (chrome.runtime.lastError) return; 
        if (res) disabledOnThisTab = !!res.disabled;
      });
    }
  } catch (e) {
    disabledOnThisTab = true; 
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "COH_SET_DISABLED") {
        disabledOnThisTab = !!msg.disabled;
        if (disabledOnThisTab) { hideIcon(); closePanel(); }
        sendResponse({ ok: true });
        return true;
      }
      if (msg?.type === "COH_GET_ACTIVE_TEXT") {
        const field = lastField && document.contains(lastField) ? lastField : document.activeElement;
        sendResponse({ ok: true, text: isEditableField(field) ? getFieldText(field) : "", hasField: isEditableField(field) });
        return true;
      }
      if (msg?.type === "COH_SET_ACTIVE_TEXT") {
        const field = lastField && document.contains(lastField) ? lastField : document.activeElement;
        sendResponse({ ok: isEditableField(field) ? setFieldText(field, msg.text) : false });
        return true;
      }
    });
  } catch (e) {}

  function isEditableField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      return ["text", "email", "search", ""].includes((el.getAttribute("type") || "").toLowerCase());
    }
    return !!el.isContentEditable;
  }

  function getFieldText(el) {
    if (!el) return "";
    return (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? (el.value || "") : (el.innerText || el.textContent || "");
  }

  function setFieldText(el, text) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
    } else {
      return false;
    }
    return true;
  }

  function ensureIcon() {
    if (icon) return icon;
    icon = document.createElement("div");
    icon.setAttribute("style", `all: initial; position: fixed; width: 26px; height: 26px; border-radius: 50%; background: #17171a; color: #fff; font: 13px/26px -apple-system, sans-serif; text-align: center; cursor: pointer; z-index: 2147483647; box-shadow: 0 2px 8px rgba(0,0,0,0.35); user-select: none; display: none;`);
    icon.textContent = "H";
    icon.title = "Humanize text";
    icon.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (lastField) openPanel(lastField);
    });
    document.documentElement.appendChild(icon);
    return icon;
  }

  function positionIcon(el) {
    if (!icon || !el) return;
    const rect = el.getBoundingClientRect();
    icon.style.top = `${Math.max(4, rect.top + 6)}px`;
    icon.style.left = `${Math.min(window.innerWidth - 30, rect.right - 30)}px`;
  }

  function showIconFor(el) {
    if (disabledOnThisTab) return;
    lastField = el; ensureIcon(); positionIcon(el);
    icon.style.display = "block";
  }

  function hideIcon() { if (icon) icon.style.display = "none"; }

  document.addEventListener("focusin", (e) => { if (isEditableField(e.target)) showIconFor(e.target); }, true);
  document.addEventListener("input", (e) => { if (isEditableField(e.target)) showIconFor(e.target); }, true);
  document.addEventListener("focusout", () => { setTimeout(() => { if (!panelHost && document.activeElement !== lastField) hideIcon(); }, 150); }, true);
  window.addEventListener("scroll", () => { if (lastField && icon && icon.style.display !== "none") positionIcon(lastField); }, true);
  window.addEventListener("resize", () => { if (lastField && icon && icon.style.display !== "none") positionIcon(lastField); });

  function closePanel() {
    if (panelHost) { panelHost.remove(); panelHost = null; panelState = null; document.removeEventListener("mousedown", onOutsideClick, true); }
  }

  function onOutsideClick(e) {
    if (!panelHost) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(panelHost) && !path.includes(icon)) closePanel();
  }

  function openPanel(field) {
    closePanel();
    panelState = { originalText: getFieldText(field), lastResult: null, field };
    const iconRect = icon.getBoundingClientRect();
    const PANEL_W = 340; const PANEL_MAX_H = Math.min(520, window.innerHeight - 24);
    let left = Math.max(8, Math.min(iconRect.left - PANEL_W + 30, window.innerWidth - PANEL_W - 8));
    let top = (iconRect.bottom + PANEL_MAX_H + 8 > window.innerHeight) ? Math.max(8, iconRect.top - PANEL_MAX_H - 8) : iconRect.bottom + 8;

    panelHost = document.createElement("div");
    panelHost.setAttribute("style", `all: initial; position: fixed; top: ${top}px; left: ${left}px; z-index: 2147483647;`);
    document.documentElement.appendChild(panelHost);

    const shadow = panelHost.attachShadow({ mode: "open" });
    shadow.innerHTML = renderPanel(PANEL_W, PANEL_MAX_H);
    wirePanel(shadow, field);
    setTimeout(() => document.addEventListener("mousedown", onOutsideClick, true), 0);
  }

  function renderPanel(width, maxHeight) {
    return `
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
      .coh-panel { width: ${width}px; max-height: ${maxHeight}px; overflow-y: auto; background: #fbfaf8; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.28); border: 1px solid #e8e7e4; padding: 16px; color: #17171a; }
      .coh-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .coh-title { font-size: 13.5px; font-weight: 700; }
      .coh-close { cursor: pointer; font-size: 15px; color: #9a978f; padding: 3px 7px; border-radius: 7px; }
      .coh-close:hover { background: #f0efec; color: #17171a; }
      .coh-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: #9a978f; margin: 0 0 8px; }
      .coh-section { margin-bottom: 14px; }
      .coh-textarea { width: 100%; min-height: 70px; max-height: 140px; resize: vertical; font-size: 12.5px; background: #fff; border-radius: 10px; padding: 10px 12px; color: #3a3a3f; border: 1px solid #e8e7e4; }
      .coh-segment { display: flex; background: #fff; border: 1px solid #e8e7e4; border-radius: 10px; padding: 3px; gap: 3px; }
      .coh-segment-btn { flex: 1; text-align: center; padding: 8px 0; border-radius: 7px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: #5b5b63; }
      .coh-segment-btn.active { background: #17171a; color: #fff; }
      .coh-slider-card { background: #fff; border: 1px solid #e8e7e4; border-radius: 10px; padding: 12px; }
      input[type="range"] { width: 100%; accent-color: #7a2e2e; }
      .coh-slider-row { display: flex; justify-content: space-between; font-size: 10.5px; color: #a6a39b; margin-top: 6px; }
      .coh-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #3a3a3f; }
      .coh-generate-btn { width: 100%; padding: 12px; border: none; border-radius: 10px; background: #7a2e2e; color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer; }
      .coh-generate-btn:disabled { opacity: 0.45; }
      .coh-error { margin-top: 10px; font-size: 12px; color: #a13c2c; background: #fbeae6; border-radius: 8px; padding: 9px 10px; display: none; }
      .coh-result-text { font-size: 13px; line-height: 1.6; white-space: pre-wrap; background: #fff; border-radius: 10px; padding: 12px; max-height: 220px; overflow-y: auto; border: 1px solid #e8e7e4; }
      .coh-btn-row { display: flex; gap: 8px; margin-top: 12px; }
      .coh-btn { flex: 1; padding: 10px 0; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid #e8e7e4; background: #fff; color: #3a3a3f; text-align: center; }
      .coh-btn.coh-replace { background: #17171a; border-color: #17171a; color: #fff; }
      .coh-regen-box { display: none; margin-top: 10px; }
      .coh-regen-box input { width: 100%; padding: 9px 10px; font-size: 12.5px; border-radius: 9px; border: 1px solid #e8e7e4; }
      .coh-regen-box button { margin-top: 8px; width: 100%; padding: 9px; font-size: 12.5px; background: #17171a; color: #fff; border: none; border-radius: 9px; cursor: pointer; }
      .coh-hidden { display: none !important; }
      .coh-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: coh-spin 0.7s linear infinite; margin-right: 6px; vertical-align: -1px; }
      @keyframes coh-spin { to { transform: rotate(360deg); } }
    </style>
    <div class="coh-panel">
      <div class="coh-header"><div class="coh-title">Humanize this text</div><div class="coh-close" data-action="close">✕</div></div>
      <div id="coh-form">
        <div class="coh-section"><div class="coh-label">Your text</div><textarea class="coh-textarea" id="coh-textarea"></textarea></div>
        <div class="coh-section"><div class="coh-label">Tone</div><div class="coh-segment"><div class="coh-segment-btn active" data-tone="professional">Professional</div><div class="coh-segment-btn" data-tone="conversational">Conversational</div></div></div>
        <div class="coh-section"><div class="coh-label">Typo range</div><div class="coh-slider-card"><input type="range" id="coh-typo-slider" min="0" max="2" step="1" value="1" /><div class="coh-slider-row"><span data-tier="0">Low</span><span data-tier="1">Medium</span><span data-tier="2">High</span></div></div></div>
        <div class="coh-section"><div class="coh-checkbox-row"><input type="checkbox" id="coh-lowercase" /><label for="coh-lowercase">Write everything in lowercase</label></div></div>
        <button class="coh-generate-btn" id="coh-generate">Generate</button>
        <div class="coh-error" id="coh-error"></div>
      </div>
      <div id="coh-result" class="coh-hidden">
        <div class="coh-label">Result</div><div class="coh-result-text" id="coh-result-text"></div>
        <div class="coh-btn-row"><div class="coh-btn coh-replace" data-action="replace">Replace</div><div class="coh-btn" data-action="regenerate">Regenerate</div><div class="coh-btn" data-action="dismiss">Dismiss</div></div>
        <div class="coh-regen-box" id="coh-regen-box"><input type="text" id="coh-regen-input" placeholder="additional changes..." /><button id="coh-regen-submit">Regenerate with changes</button></div>
      </div>
    </div>`;
  }

  function wirePanel(shadow, field) {
    const textarea = shadow.getElementById("coh-textarea");
    textarea.value = panelState.originalText;
    shadow.querySelector('[data-action="close"]').addEventListener("click", closePanel);

    const toneButtons = shadow.querySelectorAll(".coh-segment-btn");
    let selectedTone = "professional";
    toneButtons.forEach((btn) => { btn.addEventListener("click", () => { toneButtons.forEach((b) => b.classList.remove("active")); btn.classList.add("active"); selectedTone = btn.dataset.tone; }); });

    const slider = shadow.getElementById("coh-typo-slider");
    const tiers = ["low", "medium", "high"];

    const lowercaseEl = shadow.getElementById("coh-lowercase");
    const generateBtn = shadow.getElementById("coh-generate");
    const errorEl = shadow.getElementById("coh-error");
    const formEl = shadow.getElementById("coh-form");
    const resultEl = shadow.getElementById("coh-result");
    const resultTextEl = shadow.getElementById("coh-result-text");
    const regenBox = shadow.getElementById("coh-regen-box");
    const regenInput = shadow.getElementById("coh-regen-input");

    function showError(msg) { errorEl.textContent = msg; errorEl.style.display = "block"; }
    function clearError() { errorEl.style.display = "none"; errorEl.textContent = ""; }

    function runGeneration(additionalInstructions) {
      clearError();
      generateBtn.disabled = true;
      generateBtn.innerHTML = `<span class="coh-spinner"></span>Generating...`;

      const prompt = typeof coh_buildPrompt === "function" ? coh_buildPrompt({
        text: textarea.value,
        tone: selectedTone,
        typoTier: tiers[Number(slider.value)],
        lowercase: lowercaseEl.checked,
        additionalInstructions: additionalInstructions || null
      }) : `Rewrite this text in a ${selectedTone} human style: ${textarea.value}`;

      let requestResolved = false;
      const safetyTimeout = setTimeout(() => {
        if (!requestResolved) {
          generateBtn.disabled = false;
          generateBtn.textContent = "Generate";
          showError("The background worker took too long. Please refresh Gmail to align connection states.");
        }
      }, 20000);

      try {
        if (!chrome.runtime || !chrome.runtime.id) { throw new Error("Extension context invalidated."); }

        chrome.runtime.sendMessage({ type: "COH_GENERATE", prompt }, (res) => {
          requestResolved = true;
          clearTimeout(safetyTimeout);
          generateBtn.disabled = false;
          generateBtn.textContent = "Generate";

          if (chrome.runtime.lastError) {
            showError(chrome.runtime.lastError.message.includes("context invalidated") 
              ? "Extension context lost. Please reload Gmail." 
              : chrome.runtime.lastError.message);
            return;
          }
          if (!res || !res.ok) {
            showError(res?.error || "An unexpected system variation occurred.");
            return;
          }

          // res.data is now a raw text string instead of a JSON object
          panelState.lastResult = res.data;
          resultTextEl.textContent = res.data || "";
          formEl.classList.add("coh-hidden");
          resultEl.classList.remove("coh-hidden");
          regenBox.style.display = "none";
        });
      } catch (err) {
        requestResolved = true;
        clearTimeout(safetyTimeout);
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate";
        showError("Extension connection lost. Please reload Gmail.");
      }
    }

    generateBtn.addEventListener("click", () => { if (textarea.value.trim()) runGeneration(); else showError("Please write some text first."); });

    resultEl.addEventListener("click", (e) => {
      const action = e.target.dataset?.action; if (!action) return;
      if (action === "replace") {
        if (panelState.lastResult) setFieldText(field, panelState.lastResult);
        closePanel();
      } else if (action === "dismiss") {
        formEl.classList.remove("coh-hidden"); resultEl.classList.add("coh-hidden");
      } else if (action === "regenerate") {
        regenBox.style.display = regenBox.style.display === "block" ? "none" : "block";
        if (regenBox.style.display === "block") regenInput.focus();
      }
    });

    shadow.getElementById("coh-regen-submit").addEventListener("click", () => {
      const note = regenInput.value.trim(); formEl.classList.remove("coh-hidden"); resultEl.classList.add("coh-hidden");
      runGeneration(note || null);
    });
  }
})();