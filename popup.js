// popup.js — drives the Tpyo extension popup interface.

const settingsToggle = document.getElementById("coh-settings-toggle");
const genView = document.getElementById("coh-view-generate");
const settingsView = document.getElementById("coh-view-settings");
const noKeyBanner = document.getElementById("coh-no-key-banner");
const bannerLink = document.getElementById("coh-banner-link");

const ICON_GEAR = document.getElementById("coh-icon-gear").outerHTML;
const ICON_BACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>';

function goToSettings() {
  genView.classList.remove("active");
  settingsView.classList.add("active");
  settingsToggle.innerHTML = ICON_BACK;
  settingsToggle.title = "Back";
}
function goToGenerate() {
  settingsView.classList.remove("active");
  genView.classList.add("active");
  settingsToggle.innerHTML = ICON_GEAR;
  settingsToggle.title = "Settings";
}

settingsToggle.addEventListener("click", () => {
  const inSettings = settingsView.classList.contains("active");
  if (inSettings) goToGenerate();
  else goToSettings();
});
bannerLink.addEventListener("click", goToSettings);

// ---------- Settings View ----------

const apiKeyEl = document.getElementById("coh-api-key");
const settingsStatusEl = document.getElementById("coh-settings-status");
const toggleKeyEl = document.getElementById("coh-toggle-key");

toggleKeyEl.addEventListener("click", () => {
  const isPw = apiKeyEl.type === "password";
  apiKeyEl.type = isPw ? "text" : "password";
  toggleKeyEl.textContent = isPw ? "HIDE" : "SHOW";
});

async function loadSettings() {
  const { apiKey } = await chrome.storage.sync.get(["apiKey"]);
  apiKeyEl.value = apiKey || "";
  noKeyBanner.classList.toggle("coh-hidden", !!apiKey);
}

document.getElementById("coh-save-settings").addEventListener("click", async () => {
  const apiKey = apiKeyEl.value.trim();

  if (!apiKey) {
    settingsStatusEl.textContent = "Please enter an API key.";
    settingsStatusEl.className = "err";
    return;
  }

  await chrome.storage.sync.set({ apiKey });
  noKeyBanner.classList.add("coh-hidden");
  settingsStatusEl.textContent = "Saved ✓";
  settingsStatusEl.className = "ok";
  setTimeout(() => (settingsStatusEl.textContent = ""), 1800);
});

loadSettings();

// ---------- Generate View ----------

const previewEl = document.getElementById("coh-preview"); 
const refreshEl = document.getElementById("coh-refresh");
const toneButtons = document.querySelectorAll(".coh-segment-btn");
const slider = document.getElementById("coh-typo-slider");
const tierLabels = document.querySelectorAll(".coh-slider-row span");
const tiers = ["low", "medium", "high"];
const lowercaseEl = document.getElementById("coh-lowercase");
const generateBtn = document.getElementById("coh-generate");
const errorEl = document.getElementById("coh-error");
const formEl = document.getElementById("coh-form");
const resultEl = document.getElementById("coh-result");
const resultTextEl = document.getElementById("coh-result-text");
const regenBox = document.getElementById("coh-regen-box");
const regenInput = document.getElementById("coh-regen-input");
const regenSubmitBtn = document.getElementById("coh-regen-submit");

let selectedTone = "professional";
let lastResult = null;
let activeTabId = null;

toneButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toneButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedTone = btn.dataset.tone;
  });
});

function updateTierHighlight() {
  tierLabels.forEach((el) => {
    el.classList.toggle("active-tier", Number(el.dataset.tier) === Number(slider.value));
  });
}
slider.addEventListener("input", updateTierHighlight);
updateTierHighlight();

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}
function clearError() {
  errorEl.style.display = "none";
  errorEl.textContent = "";
}

async function pullActiveText() {
  previewEl.placeholder = "Loading active page selection…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      previewEl.placeholder = "Paste your message text here…";
      return;
    }
    activeTabId = tab.id;

    chrome.tabs.sendMessage(tab.id, { type: "COH_GET_ACTIVE_TEXT" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok || !res.hasField || !res.text?.trim()) {
        previewEl.placeholder = "Paste your message text here…";
        return;
      }
      previewEl.value = res.text;
    });
  } catch (err) {
    previewEl.placeholder = "Paste your message text here…";
  }
}

refreshEl.addEventListener("click", pullActiveText);
pullActiveText();

function runGeneration(additionalInstructions) {
  clearError();

  const text = previewEl.value.trim();
  if (!text) {
    showError("Please paste or type text first.");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.innerHTML = `<span class="coh-spinner"></span>Generating...`;

  const prompt = typeof coh_buildPrompt === "function" ? coh_buildPrompt({
    text,
    tone: selectedTone,
    typoTier: tiers[Number(slider.value)],
    lowercase: lowercaseEl.checked,
    additionalInstructions: additionalInstructions || null
  }) : `Rewrite this text in a ${selectedTone} human style: ${text}`;

  chrome.runtime.sendMessage({ type: "COH_GENERATE", prompt }, (res) => {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate";

    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }
    if (!res || !res.ok) {
      showError((res && res.error) || "Unable to generate response.");
      return;
    }

    lastResult = res.data;
    resultTextEl.textContent = res.data || "";
    formEl.classList.add("coh-hidden");
    resultEl.classList.remove("coh-hidden");
    regenBox.style.display = "none";
    regenInput.value = "";
  });
}

generateBtn.addEventListener("click", () => runGeneration());

// Global Ctrl + Enter / Cmd + Enter Keyboard Shortcut
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    if (genView.classList.contains("active") && formEl.classList.contains("coh-hidden") === false) {
      e.preventDefault();
      runGeneration();
    }
  }
});

resultEl.addEventListener("click", (e) => {
  const action = e.target.dataset?.action;
  if (!action) return;

  if (action === "replace") {
    if (lastResult && activeTabId) {
      chrome.tabs.sendMessage(
        activeTabId,
        { type: "COH_SET_ACTIVE_TEXT", text: lastResult },
        () => window.close()
      );
    } else {
      window.close();
    }
  } else if (action === "dismiss") {
    formEl.classList.remove("coh-hidden");
    resultEl.classList.add("coh-hidden");
  } else if (action === "regenerate") {
    regenBox.style.display = regenBox.style.display === "block" ? "none" : "block";
    if (regenBox.style.display === "block") regenInput.focus();
  }
});

function triggerRegenWithEdits() {
  const note = regenInput.value.trim();
  formEl.classList.remove("coh-hidden");
  resultEl.classList.add("coh-hidden");
  runGeneration(note || null);
}

regenSubmitBtn.addEventListener("click", triggerRegenWithEdits);

regenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    triggerRegenWithEdits();
  }
});