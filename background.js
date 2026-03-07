// background.js — TTS service worker using chrome.tts API + Gemini TTS

// ---- Gemini TTS Helper ----
async function geminiTtsSpeak(text, apiKey, voiceName, tabId) {
  const CHUNK_SIZE = 4000; // characters per chunk (safe under 32k token limit)
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);

  // Notify content script: total chunks count + speech started
  await chrome.tabs.sendMessage(tabId, {
    action: 'gemini-start',
    totalChunks: chunks.length,
    totalChars: text.length
  }).catch(() => {});

  for (let i = 0; i < chunks.length; i++) {
    // Notify progress before fetching
    await chrome.tabs.sendMessage(tabId, {
      action: 'gemini-progress',
      chunkIndex: i,
      totalChunks: chunks.length,
      phase: 'fetching'
    }).catch(() => {});

    const audioBase64 = await callGeminiTts(chunks[i], apiKey, voiceName);

    // Send audio chunk to content script for playback
    await chrome.tabs.sendMessage(tabId, {
      action: 'gemini-audio-chunk',
      audioData: audioBase64,
      chunkIndex: i,
      totalChunks: chunks.length,
      isLast: i === chunks.length - 1
    }).catch(() => {});
  }
}

async function callGeminiTts(text, apiKey, voiceName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`;

  const body = {
    systemInstruction: {
      parts: [{
        text: "You are an audiobook narrator. Read the story with a consistent, calm narrative voice. You MUST use exactly ONE voice throughout. Do NOT change voices for different characters. Do NOT hallucinate audio."
      }]
    },
    contents: [{
      parts: [{ text: text }]
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voiceName || 'Kore'
          }
        }
      }
    }
  };

  const response = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) {
    throw new Error('Không nhận được audio từ Gemini API');
  }
  return audioData;
}

function splitTextIntoChunks(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at sentence boundary (Vietnamese uses '. ' or newlines)
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) {
      splitAt = remaining.lastIndexOf('. ', maxLen);
    }
    if (splitAt < maxLen * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt < maxLen * 0.3) {
      splitAt = maxLen;
    }
    chunks.push(remaining.substring(0, splitAt + 1).trim());
    remaining = remaining.substring(splitAt + 1).trim();
  }
  return chunks;
}

function notifyTab(tabId, type, errorMsg) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, {
    action: 'tts-event',
    type: type,
    error: errorMsg || null
  }).catch(() => { /* tab may be closed */ });
}

// ---- Message Listener ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'tts-speak': {
      // Stop any current speech first
      chrome.tts.stop();

      const options = {
        lang: 'vi-VN',
        rate: request.rate || 1.0,
        pitch: request.pitch || 1.0,
        onEvent: (event) => {
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: 'tts-event',
              type: event.type
            }).catch(() => {});
          }
        }
      };

      if (request.voiceName) {
        options.voiceName = request.voiceName;
      }

      chrome.tts.speak(request.text, options);
      sendResponse({ success: true });
      break;
    }

    case 'tts-pause':
      chrome.tts.pause();
      sendResponse({ success: true });
      break;

    case 'tts-resume':
      chrome.tts.resume();
      sendResponse({ success: true });
      break;

    case 'tts-stop':
      chrome.tts.stop();
      sendResponse({ success: true });
      break;

    case 'tts-getVoices':
      chrome.tts.getVoices((voices) => {
        const viVoices = (voices || []).filter(v => v.lang && v.lang.toLowerCase().startsWith('vi'));
        sendResponse({ voices: viVoices });
      });
      return true;

    case 'gemini-tts-speak': {
      chrome.tts.stop();

      const tabId = sender.tab?.id;
      if (!request.apiKey) {
        sendResponse({ success: false, error: 'Chưa cung cấp API key' });
        break;
      }

      geminiTtsSpeak(request.text, request.apiKey, request.geminiVoice, tabId)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((err) => {
          notifyTab(tabId, 'error', err.message);
          sendResponse({ success: false, error: err.message });
        });

      return true; // Keep channel open for MV3 service worker
    }

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true;
});
