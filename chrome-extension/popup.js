// CareTalk360 Screenpop — popup.js

const emailInput   = document.getElementById('email-input');
const btnSignin    = document.getElementById('btn-signin');
const signinError  = document.getElementById('signin-error');
const signedOut    = document.getElementById('signed-out');
const signedIn     = document.getElementById('signed-in');
const emailDisplay = document.getElementById('agent-email-display');
const btnSignout   = document.getElementById('btn-signout');

// ── Render correct view based on stored email ─────────────────────────────
function render(email) {
  if (email) {
    signedOut.style.display  = 'none';
    signedIn.style.display   = 'block';
    emailDisplay.textContent = email;
  } else {
    signedOut.style.display  = 'block';
    signedIn.style.display   = 'none';
    emailInput.value         = '';
    signinError.textContent  = '';
  }
}

// Load saved state on open
chrome.storage.local.get(['agentEmail'], ({ agentEmail }) => {
  render(agentEmail || '');
});

// ── Sign In ───────────────────────────────────────────────────────────────
btnSignin.addEventListener('click', () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    signinError.textContent = 'Please enter a valid email address.';
    return;
  }
  signinError.textContent = '';
  chrome.storage.local.set({ agentEmail: email }, () => {
    if (chrome.runtime.lastError) {
      signinError.textContent = 'Error saving: ' + chrome.runtime.lastError.message;
      return;
    }
    render(email);
  });
});

// Allow pressing Enter in the email field
emailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSignin.click();
});

// ── Sign Out ──────────────────────────────────────────────────────────────
btnSignout.addEventListener('click', () => {
  chrome.storage.local.remove(['agentEmail', 'lastSeenTs'], () => {
    render('');
  });
});
