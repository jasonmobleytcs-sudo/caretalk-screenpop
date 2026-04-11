document.addEventListener('DOMContentLoaded', () => {
  const input  = document.getElementById('agent-email');
  const btn    = document.getElementById('save-btn');
  const msg    = document.getElementById('saved-msg');

  // Load saved email
  chrome.storage.sync.get(['agentEmail'], (r) => {
    if (r.agentEmail) input.value = r.agentEmail;
  });

  btn.addEventListener('click', () => {
    const email = input.value.trim().toLowerCase();
    chrome.storage.sync.set({ agentEmail: email }, () => {
      msg.textContent = email ? `✅ Saved — polling for ${email}` : '✅ Saved — monitoring all queue calls';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    });
  });
});
