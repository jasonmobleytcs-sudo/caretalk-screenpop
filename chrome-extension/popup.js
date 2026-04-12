document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('agent-email');
  const btn   = document.getElementById('save-btn');
  const msg   = document.getElementById('saved-msg');

  // Load saved email using local storage (works for unpacked extensions)
  chrome.storage.local.get(['agentEmail'], (r) => {
    if (r.agentEmail) input.value = r.agentEmail;
  });

  btn.addEventListener('click', () => {
    const email = input.value.trim().toLowerCase();

    // Immediate visual feedback — don't wait for storage
    btn.textContent = '✅ Saved!';
    btn.style.background = '#1a7a3a';
    msg.textContent = email
      ? `Polling for: ${email}`
      : 'Monitoring all queue calls';

    chrome.storage.local.set({ agentEmail: email }, () => {
      if (chrome.runtime.lastError) {
        msg.textContent = '⚠️ Save failed: ' + chrome.runtime.lastError.message;
      }
      // Reset button after 2 seconds
      setTimeout(() => {
        btn.textContent = 'Save Email';
        btn.style.background = '';
      }, 2000);
    });
  });
});
