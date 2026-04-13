// CareTalk360 Screenpop — popup.js

const emailInput      = document.getElementById('email-input');
const useridInput     = document.getElementById('userid-input');
const btnSignin       = document.getElementById('btn-signin');
const signinError     = document.getElementById('signin-error');
const signedOut       = document.getElementById('signed-out');
const signedIn        = document.getElementById('signed-in');
const emailDisplay    = document.getElementById('agent-email-display');
const useridDisplay   = document.getElementById('agent-userid-display');
const btnSignout      = document.getElementById('btn-signout');

// ── Render correct view based on stored state ─────────────────────────────
function render(email, userId) {
  if (email) {
    signedOut.style.display  = 'none';
    signedIn.style.display   = 'block';
    emailDisplay.textContent = email;
    if (userId) {
      useridDisplay.textContent = 'ID: ' + userId;
      useridDisplay.style.display = 'block';
    } else {
      useridDisplay.textContent = '';
      useridDisplay.style.display = 'none';
    }
  } else {
    signedOut.style.display  = 'block';
    signedIn.style.display   = 'none';
    emailInput.value         = '';
    useridInput.value        = '';
    signinError.textContent  = '';
  }
}

// Load saved state on open
chrome.storage.local.get(['agentEmail', 'agentUserId'], ({ agentEmail, agentUserId }) => {
  render(agentEmail || '', agentUserId || '');
});

// ── Sign In ───────────────────────────────────────────────────────────────
btnSignin.addEventListener('click', () => {
  const email  = emailInput.value.trim().toLowerCase();
  const userId = useridInput.value.trim();

  if (!email || !email.includes('@')) {
    signinError.textContent = 'Please enter a valid email address.';
    return;
  }
  signinError.textContent = '';

  const data = { agentEmail: email };
  if (userId) data.agentUserId = userId;

  chrome.storage.local.set(data, () => {
    if (chrome.runtime.lastError) {
      signinError.textContent = 'Error saving: ' + chrome.runtime.lastError.message;
      return;
    }
    render(email, userId);
  });
});

// Allow pressing Enter in either field
emailInput.addEventListener('keydown',  (e) => { if (e.key === 'Enter') btnSignin.click(); });
useridInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSignin.click(); });

// ── Sign Out ──────────────────────────────────────────────────────────────
btnSignout.addEventListener('click', () => {
  chrome.storage.local.remove(['agentEmail', 'agentUserId', 'lastSeenTs'], () => {
    render('', '');
  });
});
