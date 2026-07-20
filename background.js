// background.js — MV3 service worker. Calls the Gemini API using the user's
// own API key (from Google AI Studio), and manages the "disable on this tab"
// context-menu toggle.

const MODEL_TIERS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
const disabledTabs = new Set(); 

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "coh-disable-tab",
    title: "Disable Humanizer icon on this tab",
    contexts: ["editable"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "coh-disable-tab" || !tab?.id) return;
  disabledTabs.add(tab.id);
  chrome.tabs.sendMessage(tab.id, { type: "COH_SET_DISABLED", disabled: true }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => disabledTabs.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "COH_CHECK_DISABLED") {
    sendResponse({ disabled: sender.tab ? disabledTabs.has(sender.tab.id) : false });
    return true;
  }

  if (msg?.type !== "COH_GENERATE") return;

  (async () => {
    try {
      const { apiKey } = await chrome.storage.sync.get(["apiKey"]);

      if (!apiKey) {
        sendResponse({ ok: false, error: "No API key found. Please open configuration settings." });
        return;
      }

      // Fetch the raw string directly from the model
      const rawText = await callGeminiWithFallback(apiKey, msg.prompt, 0);
      
      // Directly return the raw text string to content.js
      sendResponse({ ok: true, data: rawText });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; 
});

async function callGeminiWithFallback(apiKey, prompt, currentTierIndex) {
  const currentModel = MODEL_TIERS[currentTierIndex];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    currentModel
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7
        }
      })
    });

    if (res.status === 503) {
      const nextIndex = currentTierIndex + 1;
      if (nextIndex < MODEL_TIERS.length) {
        return await callGeminiWithFallback(apiKey, prompt, nextIndex);
      }
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API Error (${res.status}): ${errorText.slice(0, 150)}`);
    }

    const data = await res.json();
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Blocked by safety settings (${blockReason}).`);
    }

    const parts = data.candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text).filter(Boolean).join("");
    if (!text) throw new Error("API returned blank generation space.");
    
    return text;

  } catch (err) {
    const nextIndex = currentTierIndex + 1;
    if (nextIndex < MODEL_TIERS.length) {
      return await callGeminiWithFallback(apiKey, prompt, nextIndex);
    }
    throw err;
  }
}