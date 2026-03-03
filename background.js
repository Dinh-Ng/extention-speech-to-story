// background.js — TTS service worker using chrome.tts API

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
          // Forward TTS events back to the content script
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: 'tts-event',
              type: event.type
            }).catch(() => {
              // Tab may have been closed, ignore
            });
          }
        }
      };

      // Use specific voice if provided
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
      return true; // Keep channel open for async getVoices callback

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true; // Keep channel open for async response
});
