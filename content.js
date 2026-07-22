// content.js — opens Tpyo Humanizer panel via keyboard shortcut (Alt+T) over active field.

(() => {
  let disabledOnThisTab = false;
  let lastField = null;
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

  // Listen for messages from background script or popup
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "COH_SET_DISABLED") {
        disabledOnThisTab = !!msg.disabled;
        if (disabledOnThisTab) { closePanel(); }
        sendResponse({ ok: true });
        return true;
      }

      // Shortcut triggered (Alt + T)
      if (msg?.type === "COH_TOGGLE_PANEL") {
        if (disabledOnThisTab) return;
        
        const activeEl = document.activeElement;
        const targetField = isEditableField(activeEl) ? activeEl : (lastField && document.contains(lastField) ? lastField : null);

        if (targetField) {
          lastField = targetField;
          openPanel(targetField);
        } else {
          console.warn("Tpyo: Please click inside a text box first.");
        }
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

  // Keep track of the last focused input field automatically
  document.addEventListener("focusin", (e) => {
    if (isEditableField(e.target)) {
      lastField = e.target;
    }
  }, true);

  function isEditableField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      return ["text", "email", "search", ""].includes((el.getAttribute("type") || "").toLowerCase());
    }
    return !!el.isContentEditable || el.getAttribute("role") === "textbox";
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

  function closePanel() {
    if (panelHost) {
      panelHost.remove();
      panelHost = null;
      panelState = null;
      document.removeEventListener("mousedown", onOutsideClick, true);
    }
  }

  function onOutsideClick(e) {
    if (!panelHost) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(panelHost)) closePanel();
  }

  function openPanel(field) {
    closePanel();
    panelState = { originalText: getFieldText(field), lastResult: null, field };
    
    const rect = field.getBoundingClientRect();
    const PANEL_W = 340;
    const PANEL_MAX_H = Math.min(520, window.innerHeight - 24);
    
    let left = Math.max(12, Math.min(rect.left, window.innerWidth - PANEL_W - 12));
    let top = rect.bottom + 8;
    if (top + PANEL_MAX_H > window.innerHeight) {
      top = Math.max(12, rect.top - PANEL_MAX_H - 8);
    }

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
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      
      .coh-panel { 
        width: ${width}px; 
        max-height: ${maxHeight}px; 
        overflow-y: auto; 
        background: rgba(255, 255, 255, 0.85); 
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 16px; 
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08); 
        padding: 16px; 
        color: #0f0f11; 
      }
      
      .coh-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      .coh-title { font-size: 14px; font-weight: 700; color: #0f0f11; letter-spacing: -0.01em; }
      .coh-close { cursor: pointer; font-size: 14px; color: #71717a; padding: 4px 8px; border-radius: 8px; font-weight: 600; transition: all 0.15s; }
      .coh-close:hover { background: rgba(0,0,0,0.06); color: #0f0f11; }
      
      .coh-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin: 0 0 6px; }
      .coh-section { margin-bottom: 14px; }
      
      .coh-textarea { 
        width: 100%; 
        min-height: 75px; 
        max-height: 140px; 
        resize: vertical; 
        font-size: 13px; 
        line-height: 1.5;
        background: #ffffff; 
        border-radius: 12px; 
        padding: 10px 12px; 
        color: #0f0f11; 
        border: 1px solid #e4e4e7; 
        outline: none;
        transition: border-color 0.15s;
      }
      .coh-textarea:focus { border-color: #0f0f11; }
      
      .coh-segment { display: flex; background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 10px; padding: 3px; gap: 3px; }
      .coh-segment-btn { flex: 1; text-align: center; padding: 7px 0; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; color: #71717a; transition: all 0.15s; }
      .coh-segment-btn.active { background: #0f0f11; color: #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
      
      .coh-slider-card { background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 12px; }
      input[type="range"] { width: 100%; accent-color: #0f0f11; cursor: pointer; }
      .coh-slider-row { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; color: #a1a1aa; margin-top: 6px; }
      .coh-slider-row span.active-tier { color: #0f0f11; font-weight: 700; }
      
      .coh-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; color: #27272a; cursor: pointer; }
      .coh-checkbox-row input { accent-color: #0f0f11; cursor: pointer; }
      
      .coh-generate-btn { 
        width: 100%; 
        padding: 11px; 
        border: none; 
        border-radius: 10px; 
        background: #0f0f11; 
        color: #ffffff; 
        font-size: 13px; 
        font-weight: 700; 
        cursor: pointer; 
        transition: background 0.15s, transform 0.05s;
      }
      .coh-generate-btn:hover { background: #18181b; }
      .coh-generate-btn:active { transform: scale(0.99); }
      .coh-generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      
      .coh-error { margin-top: 10px; font-size: 12px; color: #ef4444; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 8px 10px; display: none; }
      
      .coh-result-text { font-size: 13px; line-height: 1.5; white-space: pre-wrap; background: #ffffff; border-radius: 12px; padding: 12px; max-height: 200px; overflow-y: auto; border: 1px solid #e4e4e7; color: #0f0f11; }
      
      .coh-btn-row { display: flex; gap: 8px; margin-top: 12px; }
      .coh-btn { flex: 1; padding: 9px 0; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid #e4e4e7; background: #ffffff; color: #27272a; text-align: center; transition: all 0.15s; }
      .coh-btn:hover { background: #f4f4f5; }
      .coh-btn.coh-replace { background: #0f0f11; border-color: #0f0f11; color: #ffffff; }
      .coh-btn.coh-replace:hover { background: #18181b; }
      
      /* Regenerate Sub-panel */
      .coh-regen-box { display: none; margin-top: 10px; background: #f4f4f5; padding: 10px; border-radius: 10px; border: 1px solid #e4e4e7; }
      .coh-regen-box input { width: 100%; padding: 8px 10px; font-size: 12px; border-radius: 6px; border: 1px solid #e4e4e7; background: #ffffff; color: #0f0f11; outline: none; }
      .coh-regen-box input:focus { border-color: #0f0f11; }
      .coh-regen-box button { margin-top: 6px; width: 100%; padding: 8px; font-size: 12px; font-weight: 600; background: #0f0f11; color: #ffffff; border: none; border-radius: 6px; cursor: pointer; }
      .coh-regen-box button:hover { background: #18181b; }

      .coh-hidden { display: none !important; }
      .coh-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #ffffff; border-radius: 50%; animation: coh-spin 0.7s linear infinite; margin-right: 6px; vertical-align: -1px; }
      @keyframes coh-spin { to { transform: rotate(360deg); } }
    </style>
    <div class="coh-panel">
      <div class="coh-header"><div class="coh-title">Humanize this text</div><div class="coh-close" data-action="close">✕</div></div>
      <div id="coh-form">
        <div class="coh-section"><div class="coh-label">Your text</div><textarea class="coh-textarea" id="coh-textarea"></textarea></div>
        <div class="coh-section"><div class="coh-label">Tone</div><div class="coh-segment"><div class="coh-segment-btn active" data-tone="professional">Professional</div><div class="coh-segment-btn" data-tone="conversational">Conversational</div></div></div>
        <div class="coh-section"><div class="coh-label">Typo level</div><div class="coh-slider-card"><input type="range" id="coh-typo-slider" min="0" max="2" step="1" value="1" /><div class="coh-slider-row"><span data-tier="0">Low</span><span class="active-tier" data-tier="1">Medium</span><span data-tier="2">High</span></div></div></div>
        <div class="coh-section"><div class="coh-checkbox-row"><input type="checkbox" id="coh-lowercase" /><label for="coh-lowercase">Write everything in lowercase</label></div></div>
        <button class="coh-generate-btn" id="coh-generate">Generate</button>
        <div class="coh-error" id="coh-error"></div>
      </div>
      <div id="coh-result" class="coh-hidden">
        <div class="coh-label">Result</div><div class="coh-result-text" id="coh-result-text"></div>
        <div class="coh-btn-row"><div class="coh-btn coh-replace" data-action="replace">Replace</div><div class="coh-btn" data-action="regenerate">Regenerate</div><div class="coh-btn" data-action="dismiss">Dismiss</div></div>
        <div class="coh-regen-box" id="coh-regen-box"><input type="text" id="coh-regen-input" placeholder="Additional instructions..." /><button id="coh-regen-submit">Regenerate</button></div>
      </div>
    </div>`;
  }

  function wirePanel(shadow, field) {
    const textarea = shadow.getElementById("coh-textarea");
    textarea.value = panelState.originalText;
    shadow.querySelector('[data-action="close"]').addEventListener("click", closePanel);

    const toneButtons = shadow.querySelectorAll(".coh-segment-btn");
    let selectedTone = "professional";
    toneButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        toneButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTone = btn.dataset.tone;
      });
    });

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
    const regenSubmitBtn = shadow.getElementById("coh-regen-submit");

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
          showError("The background worker took too long. Please refresh the page.");
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
              ? "Extension context lost. Please reload the page." 
              : chrome.runtime.lastError.message);
            return;
          }
          if (!res || !res.ok) {
            showError(res?.error || "An unexpected system variation occurred.");
            return;
          }

          panelState.lastResult = res.data;
          resultTextEl.textContent = res.data || "";
          formEl.classList.add("coh-hidden");
          resultEl.classList.remove("coh-hidden");
          regenBox.style.display = "none";
          regenInput.value = ""; // Clean input box state so old prompts don't persist
        });
      } catch (err) {
        requestResolved = true;
        clearTimeout(safetyTimeout);
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate";
        showError("Extension connection lost. Please reload the page.");
      }
    }

    generateBtn.addEventListener("click", () => {
      if (textarea.value.trim()) runGeneration();
      else showError("Please write some text first.");
    });

    resultEl.addEventListener("click", (e) => {
      const action = e.target.dataset?.action;
      if (!action) return;
      if (action === "replace") {
        if (panelState.lastResult) setFieldText(field, panelState.lastResult);
        closePanel();
      } else if (action === "dismiss") {
        formEl.classList.remove("coh-hidden");
        resultEl.classList.add("coh-hidden");
      } else if (action === "regenerate") {
        regenBox.style.display = regenBox.style.display === "block" ? "none" : "block";
        if (regenBox.style.display === "block") {
          regenInput.value = ""; // Ensure input is clean when toggling open
          regenInput.focus();
        }
      }
    });

    function handleRegenTrigger() {
      const note = regenInput.value.trim();
      formEl.classList.remove("coh-hidden");
      resultEl.classList.add("coh-hidden");
      runGeneration(note || null);
    }

    regenSubmitBtn.addEventListener("click", handleRegenTrigger);

    // Auto-trigger regenerate when pressing 'Enter' inside the input field
    regenInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRegenTrigger();
      }
    });
  }
})(); 