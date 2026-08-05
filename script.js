/* ==========================================================================
   CELEBRATING ME - JAVASCRIPT LOGIC (DIRECT CLAIM / UNCLAIM & CLOUD SYNC)
   Features:
   - "+ Claim" button puts item on hold (status: pending) & immediately writes to cloud
   - "✕ Unclaim" button removes claim/hold & immediately writes to cloud to release item
   - Floating 💾 Save button confirms all "on hold" items (status: confirmed)
   - Detailed Item Summaries on Guest Roster Cards
   - Cloud sync via jsonbin.io (versioned, private bin — version history available on jsonbin dashboard)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // --- App State ---
  let itemsData = [];
  let rsvpsData = [];
  let currentUser = {
    name: '',
    initials: '',
    attending: 'yes',
    guestsCount: 1,
    notes: '',
    claimedItems: [] // array of { itemId, quantity, status: 'pending' | 'confirmed' }
  };

  // Cloud Storage — jsonbin.io (versioned, private bin)
  const JSONBIN_BIN_ID = '6a6ee55ef5f4af5e29e03b69';
  const JSONBIN_ACCESS_KEY = '$2a$10$NZNg5GPqV6Ip8a0LIiQL5.SgfOklPNGTruj8tf2SsWZNqvGRGpDSq';
  const CLOUD_STORAGE_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
  const CLOUD_LATEST_URL  = `${CLOUD_STORAGE_URL}/latest`; // always fetch the newest version
  const POLL_INTERVAL_SECONDS = 15;
  const SECRET_PASSPHRASE = 'banana';
  const SESSION_INACTIVE_TTL_MS = 3 * 60 * 1000; // release pending holds after 3 min away

  // BroadcastChannel for instant cross-tab / incognito sync
  let syncChannel = null;
  if ('BroadcastChannel' in window) {
    try {
      syncChannel = new BroadcastChannel('cookout_sync_channel');
      syncChannel.onmessage = (event) => {
        if (event.data && Array.isArray(event.data.rsvps)) {
          rsvpsData = event.data.rsvps;
          saveCachedRsvps(rsvpsData);
          renderItems();
          renderRoster();
          updateRuleProgressBanner();
        }
      };
    } catch (e) {}
  }

  let activeItemForModal = null;
  let selectedModalQty = 1;
  let isSyncing = false;
  let pendingSync = false;
  let inactivityTimer = null;
  let pollIntervalId = null;

  // --- DOM Elements ---
  const countdownDays = document.getElementById('days');
  const countdownHours = document.getElementById('hours');
  const countdownMinutes = document.getElementById('minutes');
  const countdownSeconds = document.getElementById('seconds');

  const rsvpForm = document.getElementById('rsvp-form');
  const guestNameInput = document.getElementById('guest-name');
  const guestInitialsInput = document.getElementById('guest-initials');
  const guestAttendingSelect = document.getElementById('guest-attending');
  const guestCountInput = document.getElementById('guest-count');
  const guestNotesInput = document.getElementById('guest-notes');
  const returningGuestNotice = document.getElementById('returning-guest-notice');
  const messageBoardSection = document.getElementById('message-board-section');
  const messageBoardContainer = document.getElementById('message-board-container');

  const ruleBanner = document.getElementById('rule-banner');
  const itemsContainer = document.getElementById('items-container');
  const rosterContainer = document.getElementById('roster-container');

  const filterTabs = document.querySelectorAll('.filter-tab');
  const searchInput = document.getElementById('search-input');

  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const qtyStepperContainer = document.getElementById('qty-stepper-container');
  const qtyDisplay = document.getElementById('qty-display');
  const qtyMinusBtn = document.getElementById('qty-minus');
  const qtyPlusBtn = document.getElementById('qty-plus');

  // Global triggers
  window.triggerSecretReset = handleSecretReset;
  window.triggerRsvpConfirm = handleFloatingRsvpConfirm;

  // --- Initial Setup ---
  initApp();

  async function initApp() {
    createForestEmbers();
    initCountdownTimer();
    loadUserFromLocalStorage();
    loadCachedRsvps();

    // Fetch items catalog
    try {
      const itemsRes = await fetch(`items.json?t=${Date.now()}`);
      if (itemsRes.ok) {
        itemsData = await itemsRes.json();
      }
    } catch (e) {}

    // Fetch Initial Live RSVPs
    await fetchLatestData();

    // Name input listener (Guest Matching & Re-editing)
    guestNameInput.addEventListener('input', handleNameInputChange);

    guestInitialsInput.addEventListener('input', (e) => {
      guestInitialsInput.dataset.userEdited = 'true';
      currentUser.initials = e.target.value.trim().toUpperCase();
      renderItems();
    });

    // Mark form fields as user-edited so reconcileReturningUser won't overwrite them
    guestAttendingSelect.addEventListener('change', () => { guestAttendingSelect.dataset.userEdited = 'true'; });
    guestCountInput.addEventListener('input', () => { guestCountInput.dataset.userEdited = 'true'; });
    guestNotesInput.addEventListener('input', () => { guestNotesInput.dataset.userEdited = 'true'; });

    // RSVP Form Submit
    rsvpForm.addEventListener('submit', handleRsvpSubmit);

    // Filter Tabs
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderItems();
      });
    });

    // Search Input
    searchInput.addEventListener('input', renderItems);

    // Initial Renders
    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    // Start Live Polling (pause when tab is hidden to conserve API quota)
    pollIntervalId = setInterval(() => {
      if (document.visibilityState !== 'hidden') fetchLatestData();
    }, POLL_INTERVAL_SECONDS * 1000);

    // Refetch on tab reactivation; start TTL timer when leaving
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        inactivityTimer = setTimeout(releasePendingHolds, SESSION_INACTIVE_TTL_MS);
      } else {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
        fetchLatestData(); // always pull fresh on return
      }
    });

    // Modal Closes
    modalCancelBtn.addEventListener('click', closeModal);
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    }));
  }

  // Cache helper to prevent flickering
  function saveCachedRsvps(data) {
    try {
      localStorage.setItem('cookout_rsvps_cache', JSON.stringify(data));
    } catch (e) {}
  }

  function loadCachedRsvps() {
    try {
      const cached = localStorage.getItem('cookout_rsvps_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          rsvpsData = parsed;
        }
      }
    } catch (e) {}
  }

  // --- Green & Yellow Floating Embers ---
  function createForestEmbers() {
    const container = document.getElementById('particles-container');
    if (!container) return;

    const colors = ['pine-green', 'forest-moss', 'golden-yellow', 'warm-amber'];

    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      const chosenColor = colors[Math.floor(Math.random() * colors.length)];
      p.className = `particle ${chosenColor}`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.animationDuration = `${5 + Math.random() * 7}s`;
      p.style.animationDelay = `${Math.random() * 6}s`;
      const size = 4 + Math.random() * 5;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      container.appendChild(p);
    }
  }

  // --- Guest Matching & Re-Editing Logic ---
  function handleNameInputChange(e) {
    const inputName = e.target.value.trim();
    currentUser.name = inputName;

    if (!inputName) {
      returningGuestNotice.innerHTML = '';
      return;
    }

    const result = findRsvpMatch(inputName, rsvpsData);

    if (result && result.type === 'exact') {
      loadRsvpDataIntoForm(result.rsvp);
      returningGuestNotice.innerHTML = `
        <div class="returning-guest-banner">
          <span>👋 Welcome back, <strong>${result.rsvp.name}</strong>! Your previously saved RSVP and item claims have been loaded. You can modify your choices below.</span>
        </div>
      `;
    } else if (result && result.type === 'fuzzy') {
      returningGuestNotice.innerHTML = `
        <div class="returning-guest-banner fuzzy-match-banner">
          <span>🤔 Did you mean <strong>${result.rsvp.name}</strong>?</span>
          <button class="btn-fuzzy-load" data-rsvp-name="${result.rsvp.name}">Yes, load my info →</button>
        </div>
      `;
      document.querySelector('.btn-fuzzy-load')?.addEventListener('click', () => {
        guestNameInput.value = result.rsvp.name;
        currentUser.name = result.rsvp.name;
        loadRsvpDataIntoForm(result.rsvp);
        returningGuestNotice.innerHTML = `
          <div class="returning-guest-banner">
            <span>👋 Welcome back, <strong>${result.rsvp.name}</strong>! Your previously saved RSVP and item claims have been loaded. You can modify your choices below.</span>
          </div>
        `;
        renderItems();
        updateRuleProgressBanner();
      });
    } else {
      returningGuestNotice.innerHTML = '';
      if (!guestInitialsInput.dataset.userEdited) {
        currentUser.initials = getInitials(inputName);
        guestInitialsInput.value = currentUser.initials;
      }
    }

    renderItems();
    updateRuleProgressBanner();
  }

  // --- Fetch Latest Data ---
  async function fetchLatestData() {
    try {
      // Use /latest to ensure jsonbin always returns the newest version, never a cached old one
      const bRes = await fetch(CLOUD_LATEST_URL, {
        cache: 'no-store',
        headers: { 'Accept': 'application/json', 'X-Access-Key': JSONBIN_ACCESS_KEY }
      });

      if (bRes.ok) {
        const payload = await bRes.json();
        const data = payload && Array.isArray(payload.record) ? payload.record : payload;
        if (Array.isArray(data)) {
          rsvpsData = data;
          saveCachedRsvps(rsvpsData);

          // Reconcile the returning user's local state against fresh cloud data
          if (currentUser.name) reconcileReturningUser();

          renderItems();
          renderRoster();
          updateRuleProgressBanner();
        }
      }
    } catch (err) {
      console.warn('Error fetching live data (retaining existing view):', err);
    }
  }

  // --- Release pending holds after inactivity ---
  function releasePendingHolds() {
    inactivityTimer = null;
    const hadPending = currentUser.claimedItems.some(c => c.status === 'pending');
    if (!hadPending) return;
    currentUser.claimedItems = currentUser.claimedItems.filter(c => c.status === 'confirmed');
    saveUserToLocalStorage();
    if (currentUser.name) persistRsvpsToCloud();
    else { renderItems(); renderRoster(); updateRuleProgressBanner(); }
  }

  // --- Reconcile returning user's local state against fresh cloud data ---
  // Called after every successful fetchLatestData when currentUser.name is known.
  function reconcileReturningUser() {
    const cloudEntry = rsvpsData.find(
      r => r.name && r.name.toLowerCase() === currentUser.name.toLowerCase()
    );

    if (cloudEntry) {
      // Cloud is authoritative for committed RSVP fields — sync form if user hasn't edited them
      if (!guestAttendingSelect.dataset.userEdited) {
        currentUser.attending = cloudEntry.attending || 'yes';
        guestAttendingSelect.value = currentUser.attending;
      }
      if (!guestCountInput.dataset.userEdited) {
        currentUser.guestsCount = cloudEntry.guestsCount || 1;
        guestCountInput.value = currentUser.guestsCount;
      }
      if (!guestNotesInput.dataset.userEdited && cloudEntry.notes) {
        currentUser.notes = cloudEntry.notes;
        guestNotesInput.value = currentUser.notes;
      }
    }

    // Reconcile pending items: drop any that are now taken by someone else in cloud
    if (currentUser.claimedItems.length) {
      currentUser.claimedItems = currentUser.claimedItems.map(localClaim => {
        if (localClaim.status === 'confirmed') return localClaim; // confirmed stays forever

        // If someone else has this item in the cloud, our pending hold is no longer valid
        const takenByOther = rsvpsData.some(r =>
          r.name.toLowerCase() !== currentUser.name.toLowerCase() &&
          r.claimedItems?.some(c => c.itemId === localClaim.itemId)
        );
        if (takenByOther) return null;

        // If cloud has an updated status for this item for our user, trust it
        const cloudClaim = cloudEntry?.claimedItems?.find(c => c.itemId === localClaim.itemId);
        if (cloudClaim) return { ...localClaim, status: cloudClaim.status };

        return localClaim; // still pending and not taken
      }).filter(Boolean);

      saveUserToLocalStorage();
    } else if (cloudEntry?.claimedItems?.length) {
      // Nothing local but cloud has this user's items — restore from cloud
      currentUser.claimedItems = [...cloudEntry.claimedItems];
      saveUserToLocalStorage();
    }
  }

  // --- Push Update to Cloud (read-before-write to prevent concurrent-user race conditions) ---
  async function persistRsvpsToCloud() {
    saveUserToLocalStorage();

    if (isSyncing) {
      pendingSync = true;
      return;
    }
    isSyncing = true;

    try {
      // Step 1: Fetch the freshest cloud state so we never overwrite a concurrent user's claim
      let base = rsvpsData;
      try {
        const freshRes = await fetch(CLOUD_LATEST_URL, {
          cache: 'no-store',
          headers: { 'Accept': 'application/json', 'X-Access-Key': JSONBIN_ACCESS_KEY }
        });
        if (freshRes.ok) {
          const payload = await freshRes.json();
          const data = payload && Array.isArray(payload.record) ? payload.record : payload;
          if (Array.isArray(data)) base = data;
        }
      } catch (e) { /* network error — fall back to last known rsvpsData */ }

      // Step 2: Merge current user into the freshest known state
      rsvpsData = mergeRsvpsArrays(base, currentUser);
      saveCachedRsvps(rsvpsData);

      renderItems();
      renderRoster();
      updateRuleProgressBanner();

      // Broadcast to other tabs on the same origin
      if (syncChannel) {
        try { syncChannel.postMessage({ rsvps: rsvpsData }); } catch (e) {}
      }

      // Step 3: Write the merged state back to cloud
      // Write guard: never PUT an empty array when the cloud already has data
      let writeSuccess = false;
      if (rsvpsData.length === 0 && base.length > 0) {
        console.warn('Write guard: refusing to overwrite cloud data with empty array.');
      } else {
        try {
          const putRes = await fetch(CLOUD_STORAGE_URL, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Access-Key': JSONBIN_ACCESS_KEY
            },
            body: JSON.stringify(rsvpsData)
          });
          if (putRes.ok || putRes.status === 200) writeSuccess = true;
        } catch (e) {}
      }

      showToast(writeSuccess ? `✅ Synced to Cloud Live!` : `💾 Saved locally!`);
    } catch (e) {
      console.error('Failed to sync to Cloud', e);
    } finally {
      isSyncing = false;
      if (pendingSync) {
        pendingSync = false;
        setTimeout(persistRsvpsToCloud, 100);
      }
    }
  }

  // --- Secret Passphrase Master Reset ("banana") ---
  function handleSecretReset() {
    // Step 1: ask for passphrase via custom modal
    modalTitle.innerHTML = `🧹 Organiser Reset`;
    modalBody.innerHTML = `
      <p style="margin-bottom: 12px;">This will <strong>permanently wipe all RSVPs and item claims</strong> from the cloud. Use only to clear test data.</p>
      <label style="font-size: 0.85rem; font-weight: 600; color: var(--pine-green);">Passphrase</label>
      <input id="reset-passphrase-input" type="password" placeholder="Enter passphrase…"
        style="margin-top: 6px; width: 100%; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.9rem; box-sizing: border-box;" />
      <p id="reset-error-msg" style="color: #e53e3e; font-size: 0.82rem; margin-top: 8px; display: none;">❌ Incorrect passphrase.</p>
    `;
    qtyStepperContainer.style.display = 'none';
    modalConfirmBtn.textContent = 'Reset Everything';
    modalConfirmBtn.style.background = '#e53e3e';

    modalConfirmBtn.onclick = async () => {
      const input = document.getElementById('reset-passphrase-input');
      const errorMsg = document.getElementById('reset-error-msg');

      if (!input || input.value.trim().toLowerCase() !== SECRET_PASSPHRASE) {
        errorMsg.style.display = 'block';
        if (input) input.focus();
        return;
      }

      // Step 2: confirmed correct passphrase — show final confirm step
      modalTitle.innerHTML = `⚠️ Are you sure?`;
      modalBody.innerHTML = `<p>This will wipe <strong>all guest RSVPs and item claims</strong> from the cloud and reset everything to zero. This cannot be undone.</p>`;
      modalConfirmBtn.textContent = '🗑️ Yes, wipe everything';

      modalConfirmBtn.onclick = async () => {
        closeModal();
        modalConfirmBtn.style.background = '';

        // Wipe memory & current user state
        rsvpsData = [];
        currentUser = {
          name: '',
          initials: '',
          attending: 'yes',
          guestsCount: 1,
          notes: '',
          claimedItems: []
        };

        // Clear local storage & cache
        localStorage.removeItem('celebrating_me_user');
        localStorage.removeItem('mx_cookout_user');
        localStorage.removeItem('cookout_rsvps_cache');

        // Reset form inputs
        if (rsvpForm) rsvpForm.reset();
        if (returningGuestNotice) returningGuestNotice.innerHTML = '';

        // Broadcast clear to other open tabs
        if (syncChannel) {
          try { syncChannel.postMessage({ rsvps: [] }); } catch (e) {}
        }

        // Write empty array to cloud
        try {
          await fetch(CLOUD_STORAGE_URL, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Access-Key': JSONBIN_ACCESS_KEY
            },
            body: JSON.stringify([])
          });
        } catch (e) {}

        renderItems();
        renderRoster();
        updateRuleProgressBanner();
        showToast('🧹 Roster & all claims wiped!');
      };
    };

    modalCancelBtn.onclick = () => {
      modalConfirmBtn.style.background = '';
      closeModal();
    };

    modalOverlay.classList.add('active');
    // Focus the passphrase input after modal opens
    setTimeout(() => {
      const input = document.getElementById('reset-passphrase-input');
      if (input) input.focus();
    }, 50);
  }

  // --- Floating Confirm Button Trigger ---
  function handleFloatingRsvpConfirm() {
    const name = guestNameInput.value.trim();
    if (!name) {
      showPreRsvpModal();
      return;
    }
    rsvpForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  // Helper: Merges user RSVP safely into remote array
  function mergeRsvpsArrays(remoteList, userObj) {
    if (!userObj.name) return remoteList;

    const copy = [...remoteList];
    const index = copy.findIndex(r => r.name && r.name.toLowerCase() === userObj.name.toLowerCase());

    const updatedUserEntry = {
      id: index !== -1 ? copy[index].id : 'rsvp_' + Date.now(),
      name: userObj.name,
      initials: userObj.initials || getInitials(userObj.name),
      attending: userObj.attending || 'yes',
      guestsCount: userObj.guestsCount || 1,
      notes: userObj.notes || '',
      claimedItems: userObj.claimedItems || [],
      timestamp: new Date().toISOString()
    };

    if (index !== -1) {
      copy[index] = updatedUserEntry;
    } else {
      copy.push(updatedUserEntry);
    }

    return copy;
  }

  // --- Local Storage Helpers ---
  function loadUserFromLocalStorage() {
    const saved = localStorage.getItem('celebrating_me_user') || localStorage.getItem('mx_cookout_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        currentUser = {
          ...currentUser,
          name: parsed.name || '',
          initials: parsed.initials || '',
          claimedItems: Array.isArray(parsed.claimedItems) ? parsed.claimedItems : []
        };
        if (currentUser.name) {
          guestNameInput.value = currentUser.name;
          guestInitialsInput.value = currentUser.initials || getInitials(currentUser.name);
        }
      } catch (e) {
        console.error('LocalStorage parse error', e);
      }
    }
  }

  function saveUserToLocalStorage() {
    localStorage.setItem('celebrating_me_user', JSON.stringify(currentUser));
  }

  // --- Initials Extractor ---
  function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // --- Fuzzy Name Matching (Levenshtein) ---
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) dp[i] = [i];
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  function findRsvpMatch(inputName, rsvpsList) {
    const norm = inputName.toLowerCase().trim();
    const exact = rsvpsList.find(r => r.name && r.name.toLowerCase() === norm);
    if (exact) return { rsvp: exact, type: 'exact' };

    let best = null, bestDist = Infinity;
    rsvpsList.forEach(r => {
      if (!r.name) return;
      const dist = levenshtein(norm, r.name.toLowerCase());
      const threshold = Math.max(2, Math.floor(Math.max(norm.length, r.name.length) * 0.25));
      if (dist < bestDist && dist <= threshold) { bestDist = dist; best = r; }
    });
    return best ? { rsvp: best, type: 'fuzzy' } : null;
  }

  function loadRsvpDataIntoForm(rsvp) {
    currentUser.initials = rsvp.initials || getInitials(rsvp.name);
    currentUser.attending = rsvp.attending || 'yes';
    currentUser.guestsCount = rsvp.guestsCount || 1;
    currentUser.notes = rsvp.notes || '';
    currentUser.claimedItems = rsvp.claimedItems ? [...rsvp.claimedItems] : [];
    guestInitialsInput.value = currentUser.initials;
    guestAttendingSelect.value = currentUser.attending;
    guestCountInput.value = currentUser.guestsCount;
    guestNotesInput.value = currentUser.notes;
    // Clear user-edited markers since we've just loaded authoritative cloud data
    delete guestAttendingSelect.dataset.userEdited;
    delete guestCountInput.dataset.userEdited;
    delete guestNotesInput.dataset.userEdited;
  }

  // --- Countdown Timer ---
  function initCountdownTimer() {
    const targetDate = new Date('2026-08-08T12:00:00+03:00').getTime();

    function update() {
      const now = new Date().getTime();
      const diff = targetDate - now;

      if (diff <= 0) {
        if (countdownDays) countdownDays.textContent = '00';
        if (countdownHours) countdownHours.textContent = '00';
        if (countdownMinutes) countdownMinutes.textContent = '00';
        if (countdownSeconds) countdownSeconds.textContent = '00';
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      if (countdownDays) countdownDays.textContent = String(d).padStart(2, '0');
      if (countdownHours) countdownHours.textContent = String(h).padStart(2, '0');
      if (countdownMinutes) countdownMinutes.textContent = String(m).padStart(2, '0');
      if (countdownSeconds) countdownSeconds.textContent = String(s).padStart(2, '0');
    }

    update();
    setInterval(update, 1000);
  }

  // --- Rule Progress Banner ---
  function updateRuleProgressBanner() {
    let bigCount = 0;
    let smallCount = 0;

    currentUser.claimedItems.forEach(c => {
      const item = itemsData.find(i => i.id === c.itemId);
      if (item) {
        if (item.category === 'big') bigCount += c.quantity;
        if (item.category === 'small') smallCount += c.quantity;
      }
    });

    let badgeHtml = '';
    let messageHtml = '';

    if (bigCount >= 1 && smallCount >= 2) {
      badgeHtml = `<span class="rule-badge success">🌟 Rockstar Guest!</span>`;
      messageHtml = `You selected <strong>${bigCount} Big item(s)</strong> AND <strong>${smallCount} Small item(s)</strong>! MX loves you! ❤️`;
    } else if (bigCount >= 1) {
      badgeHtml = `<span class="rule-badge success">✅ Rule Satisfied</span>`;
      messageHtml = `You selected <strong>1 Big Item</strong> (${bigCount} total). Perfect!`;
    } else if (smallCount >= 2) {
      badgeHtml = `<span class="rule-badge success">✅ Rule Satisfied</span>`;
      messageHtml = `You selected <strong>2 Small Items</strong> (${smallCount} total). Perfect!`;
    } else if (smallCount === 1) {
      badgeHtml = `<span class="rule-badge pending">⏳ Almost There</span>`;
      messageHtml = `You picked <strong>1 Small Item</strong>. Please select <strong>1 more small item</strong> (or switch to 1 Big item)!`;
    } else {
      badgeHtml = `<span class="rule-badge pending">👇 Pick Your Items</span>`;
      messageHtml = `Please select <strong>1 Big Item</strong> OR <strong>2 Small Items</strong> from the list below.`;
    }

    ruleBanner.innerHTML = `
      <div class="rule-info">
        ${badgeHtml}
        <div>${messageHtml}</div>
      </div>
    `;
  }

  // --- Render 3-Column Items Grid ---
  function renderItems() {
    if (!itemsData.length) return;

    const activeFilter = document.querySelector('.filter-tab.active')?.dataset.filter || 'all';
    const searchQuery = searchInput.value.toLowerCase().trim();

    const itemClaimsMap = {};

    rsvpsData.forEach(rsvp => {
      if (rsvp.claimedItems && Array.isArray(rsvp.claimedItems)) {
        rsvp.claimedItems.forEach(c => {
          if (!itemClaimsMap[c.itemId]) {
            itemClaimsMap[c.itemId] = { totalConfirmed: 0, totalPending: 0, claimants: [] };
          }

          const status = c.status || 'confirmed';
          if (status === 'confirmed') {
            itemClaimsMap[c.itemId].totalConfirmed += c.quantity;
          } else {
            itemClaimsMap[c.itemId].totalPending += c.quantity;
          }

          itemClaimsMap[c.itemId].claimants.push({
            name: rsvp.name,
            initials: rsvp.initials || getInitials(rsvp.name),
            quantity: c.quantity,
            status: status
          });
        });
      }
    });

    const filtered = itemsData.filter(item => {
      if (activeFilter === 'big' && item.category !== 'big') return false;
      if (activeFilter === 'small' && item.category !== 'small') return false;
      
      const claimsInfo = itemClaimsMap[item.id] || { totalConfirmed: 0, totalPending: 0, claimants: [] };
      const totalClaimed = claimsInfo.totalConfirmed + claimsInfo.totalPending;
      const isFullyClaimed = totalClaimed >= item.totalNeeded;

      if (activeFilter === 'claimed' && !isFullyClaimed) return false;
      if (activeFilter === 'needed' && isFullyClaimed) return false;

      if (searchQuery) {
        const matchName = item.name.toLowerCase().includes(searchQuery);
        const matchNote = item.note.toLowerCase().includes(searchQuery);
        if (!matchName && !matchNote) return false;
      }

      return true;
    });

    itemsContainer.innerHTML = filtered.map(item => {
      const claimsInfo = itemClaimsMap[item.id] || { totalConfirmed: 0, totalPending: 0, claimants: [] };
      const totalConfirmed = claimsInfo.totalConfirmed;
      const totalPending = claimsInfo.totalPending;
      const totalClaimed = totalConfirmed + totalPending;
      const remainingNeeded = Math.max(0, item.totalNeeded - totalClaimed);
      const isFullyClaimed = totalClaimed >= item.totalNeeded;

      const userClaim = currentUser.claimedItems.find(c => c.itemId === item.id);
      const userClaimQty = userClaim ? userClaim.quantity : 0;
      const userStatus = userClaim ? (userClaim.status || 'pending') : null;
      const isChecked = userClaimQty > 0;

      let cardHighlightClass = '';
      if (isChecked) {
        cardHighlightClass = userStatus === 'confirmed' ? 'user-confirmed' : 'user-pending';
      } else if (totalPending > 0) {
        cardHighlightClass = 'has-pending-others';
      }

      const displayInitials = isChecked ? (currentUser.initials || getInitials(currentUser.name) || '✓') : '';

      const claimantsTags = claimsInfo.claimants.map(c => {
        const isMe = currentUser.name && c.name.toLowerCase() === currentUser.name.toLowerCase();
        let tagClass = 'others';

        if (isMe) {
          tagClass = c.status === 'confirmed' ? 'my-confirmed' : 'my-pending';
        } else if (c.status === 'pending') {
          tagClass = 'others-pending';
        }

        const labelStatus = c.status === 'pending' ? '⏳ hold' : '✅ confirmed';
        return `<span class="claimant-tag ${tagClass}">${c.initials}: ${c.quantity} (${labelStatus})</span>`;
      }).join(' ');

      return `
        <div class="item-card category-${item.category} ${cardHighlightClass} ${isFullyClaimed ? 'fully-claimed' : ''}" data-id="${item.id}">
          <div>
            <div class="item-header">
              <div class="checkbox-wrapper">
                <input type="checkbox" id="check-${item.id}" class="item-checkbox" ${isChecked ? 'checked' : ''} data-id="${item.id}">
                <label for="check-${item.id}" class="checkbox-custom ${userStatus === 'pending' ? 'pending-check' : ''}" data-id="${item.id}" data-action="toggle-check">
                  <span class="initials-badge">${displayInitials}</span>
                </label>
              </div>

              <div class="item-title-group">
                <div class="item-name">
                  <span>${item.icon} ${item.name}</span>
                  <span class="cat-pill ${item.category}">${item.category === 'big' ? 'Big Item' : 'Small Item'}</span>
                </div>
                ${item.note ? `<div class="item-note">${item.note}</div>` : ''}
              </div>
            </div>
          </div>

          <div class="item-footer">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div class="counter-badge ${isFullyClaimed ? 'claimed' : 'needed'}">
                ${isFullyClaimed ? `✓ Fully Claimed (${totalConfirmed} confirmed, ${totalPending} pending)` : `⏳ Needed: ${remainingNeeded} of ${item.totalNeeded} ${item.unit}`}
              </div>

              ${claimsInfo.claimants.length > 0 ? `
                <div class="claimants-list">
                  <span style="font-size: 0.75rem; color: var(--text-dim);">Status:</span>
                  ${claimantsTags}
                </div>
              ` : ''}
            </div>

            <div class="item-actions-group" style="display: flex; align-items: center; gap: 6px;">
              ${isChecked ? `
                <button class="btn-claim-qty btn-status-indicator" data-action="edit" data-id="${item.id}">
                  ${userStatus === 'confirmed' ? '✅ Claimed' : '⏳ On Hold'} (${userClaimQty})
                </button>
                <button class="btn-claim-qty btn-unclaim-action" data-action="unclaim" data-id="${item.id}" title="Remove claim & release item for everyone">
                  ✕ Unclaim
                </button>
              ` : `
                <button class="btn-claim-qty btn-claim-action" data-action="claim" data-id="${item.id}">
                  + Claim
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    attachItemEventListeners();
  }

  function attachItemEventListeners() {
    document.querySelectorAll('.item-card [data-action]').forEach(element => {
      element.addEventListener('click', (e) => {
        e.preventDefault();
        const action = element.dataset.action;
        const itemId = element.dataset.id;
        
        if (action === 'unclaim') {
          unclaimItem(itemId);
        } else if (action === 'claim') {
          claimItemDirectly(itemId);
        } else if (action === 'edit' || action === 'toggle-check') {
          handleItemClick(itemId);
        }
      });
    });
  }

  function handleItemClick(itemId) {
    const name = guestNameInput.value.trim();
    if (!name) {
      showPreRsvpModal();
      return;
    }

    currentUser.name = name;
    currentUser.initials = guestInitialsInput.value.trim().toUpperCase() || getInitials(name);

    const item = itemsData.find(i => i.id === itemId);
    if (!item) return;

    openQuantityModal(item);
  }

  // --- Directly Claim Item (+ Claim button) ---
  function claimItemDirectly(itemId) {
    const name = guestNameInput.value.trim();
    if (!name) {
      showPreRsvpModal();
      return;
    }

    currentUser.name = name;
    currentUser.initials = guestInitialsInput.value.trim().toUpperCase() || getInitials(name);

    const item = itemsData.find(i => i.id === itemId);
    if (!item) return;

    if (item.totalNeeded > 1) {
      openQuantityModal(item);
    } else {
      saveItemClaim(itemId, 1, 'pending');
    }
  }

  // --- Directly Unclaim Item (✕ Unclaim button) ---
  function unclaimItem(itemId) {
    saveItemClaim(itemId, 0);
  }

  function showPreRsvpModal() {
    modalTitle.innerHTML = `⚠️ Please Enter Your Name First!`;
    modalBody.innerHTML = `
      <p style="margin-bottom: 12px;">Before claiming items from the list, please enter your name in the <strong>RSVP form</strong> so everyone knows who is bringing what!</p>
    `;
    qtyStepperContainer.style.display = 'none';

    modalConfirmBtn.textContent = 'Go to RSVP Form';
    modalConfirmBtn.onclick = () => {
      closeModal();
      guestNameInput.focus();
      guestNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    modalOverlay.classList.add('active');
  }

  function openQuantityModal(item) {
    activeItemForModal = item;

    let claimedByOthers = 0;
    rsvpsData.forEach(r => {
      if (r.name && r.name.toLowerCase() !== currentUser.name.toLowerCase() && r.claimedItems) {
        const c = r.claimedItems.find(x => x.itemId === item.id);
        if (c) claimedByOthers += c.quantity;
      }
    });

    const maxAvailable = Math.max(0, item.totalNeeded - claimedByOthers);
    const existingClaim = currentUser.claimedItems.find(c => c.itemId === item.id);
    selectedModalQty = existingClaim ? existingClaim.quantity : (maxAvailable > 0 ? 1 : 0);

    modalTitle.innerHTML = `${item.icon} Select ${item.name}`;
    modalBody.innerHTML = `
      <p>How many <strong>${item.name}</strong> are you bringing?</p>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">
        Total needed: <strong>${item.totalNeeded} ${item.unit}</strong> | Claimed by others: <strong>${claimedByOthers}</strong> | Available: <strong>${maxAvailable}</strong>
      </div>
      <p style="font-size: 0.82rem; color: var(--accent-amber); margin-top: 8px;">
        💡 <em>Claiming puts the item on ⏳ HOLD for everyone in real time. Click the floating 💾 bubble anytime to lock in your choice!</em>
      </p>
    `;

    qtyStepperContainer.style.display = 'flex';
    qtyDisplay.textContent = selectedModalQty;

    qtyMinusBtn.onclick = () => {
      if (selectedModalQty > 0) {
        selectedModalQty--;
        qtyDisplay.textContent = selectedModalQty;
      }
    };

    qtyPlusBtn.onclick = () => {
      if (selectedModalQty < maxAvailable || selectedModalQty < item.totalNeeded) {
        selectedModalQty++;
        qtyDisplay.textContent = selectedModalQty;
      }
    };

    modalConfirmBtn.textContent = selectedModalQty === 0 ? '✕ Unclaim Item' : '⏳ Put on Hold (Claim)';
    modalConfirmBtn.onclick = () => {
      saveItemClaim(item.id, selectedModalQty, 'pending');
      closeModal();
    };

    modalOverlay.classList.add('active');
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
  }

  function saveItemClaim(itemId, quantity, forceStatus = null) {
    const existingIndex = currentUser.claimedItems.findIndex(c => c.itemId === itemId);

    if (quantity <= 0) {
      if (existingIndex !== -1) currentUser.claimedItems.splice(existingIndex, 1);
    } else {
      if (existingIndex !== -1) {
        currentUser.claimedItems[existingIndex].quantity = quantity;
        if (forceStatus) {
          currentUser.claimedItems[existingIndex].status = forceStatus;
        }
      } else {
        currentUser.claimedItems.push({ itemId, quantity, status: forceStatus || 'pending' });
      }
    }

    saveUserToLocalStorage();
    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    // Immediately push update to cloud so everyone sees hold/unclaim in real time!
    persistRsvpsToCloud();
    
    if (quantity <= 0) {
      showToast(`✕ Unclaimed item! (Released for everyone)`);
    } else {
      showToast(`⏳ Item on Hold! Click 💾 bubble to confirm.`);
    }
  }

  function handleRsvpSubmit(e) {
    e.preventDefault();

    const name = guestNameInput.value.trim();
    if (!name) {
      alert('Please enter your name!');
      return;
    }

    currentUser.name = name;
    currentUser.initials = guestInitialsInput.value.trim().toUpperCase() || getInitials(name);
    currentUser.attending = guestAttendingSelect.value;
    currentUser.guestsCount = parseInt(guestCountInput.value) || 1;
    currentUser.notes = guestNotesInput.value.trim();

    // Lock in all on-hold (pending) items to confirmed!
    currentUser.claimedItems.forEach(c => {
      c.status = 'confirmed';
    });

    saveUserToLocalStorage();

    // Clear user-edited markers — cloud is now up to date with what the user entered
    delete guestAttendingSelect.dataset.userEdited;
    delete guestCountInput.dataset.userEdited;
    delete guestNotesInput.dataset.userEdited;

    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    // Sync confirmed state to cloud
    persistRsvpsToCloud();
    showToast(`🎉 RSVP & Gifts Locked In! Thank you, ${currentUser.name}!`);
  }

  // --- RENDER GUEST ROSTER WITH DETAILED ITEM SUMMARIES ---
  function renderRoster() {
    if (!rosterContainer) return;

    if (!rsvpsData.length) {
      rosterContainer.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 20px;">No RSVPs yet. Be the first to RSVP!</p>`;
      return;
    }

    rosterContainer.innerHTML = rsvpsData.map(rsvp => {
      const attendingBadge = rsvp.attending === 'yes' ? '✅ Attending' : (rsvp.attending === 'no' ? '❌ Can\'t Make It' : '❓ Maybe');

      // Build detailed summary list of items with icons & names
      let itemSummaryList = [];
      if (rsvp.claimedItems && Array.isArray(rsvp.claimedItems)) {
        rsvp.claimedItems.forEach(c => {
          const matchedItem = itemsData.find(i => i.id === c.itemId);
          const icon = matchedItem ? matchedItem.icon : '🎁';
          const name = matchedItem ? matchedItem.name : c.itemId;
          const cat = matchedItem ? matchedItem.category : '';
          const statusBadge = c.status === 'pending' ? '⏳ hold' : '✅ confirmed';

          itemSummaryList.push(`
            <li style="font-size: 0.85rem; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
              <span>${icon} <strong>${c.quantity}x ${name}</strong></span>
              <span class="cat-pill ${cat}" style="font-size: 0.7rem; padding: 1px 6px;">${cat === 'big' ? 'Big' : 'Small'}</span>
              <span style="font-size: 0.72rem; color: ${c.status === 'pending' ? 'var(--accent-amber)' : 'var(--forest-moss)'}; font-weight: 600;">(${statusBadge})</span>
            </li>
          `);
        });
      }

      const itemsSummaryHtml = itemSummaryList.length > 0
        ? `<ul style="list-style: none; padding-left: 0; margin-top: 8px; border-top: 1px dashed rgba(30,86,49,0.15); padding-top: 6px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--pine-green); text-transform: uppercase; letter-spacing: 0.5px;">🎁 Bringing:</div>
            ${itemSummaryList.join('')}
           </ul>`
        : `<p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 6px; font-style: italic;">No items selected yet</p>`;

      return `
        <div class="roster-card">
          <div class="avatar-circle">${rsvp.initials || getInitials(rsvp.name)}</div>
          <div class="roster-info" style="width: 100%;">
            <h4>${rsvp.name} (${rsvp.guestsCount} guest${rsvp.guestsCount > 1 ? 's' : ''})</h4>
            <p>${attendingBadge}</p>
            ${itemsSummaryHtml}
          </div>
        </div>
      `;
    }).join('');

    renderMessageBoard();
  }

  // --- Message Board: speech bubbles for guests who left a note ---
  function renderMessageBoard() {
    if (!messageBoardContainer || !messageBoardSection) return;
    const withNotes = rsvpsData.filter(r => r.notes && r.notes.trim());
    if (!withNotes.length) {
      messageBoardSection.style.display = 'none';
      return;
    }
    messageBoardSection.style.display = '';
    messageBoardContainer.innerHTML = withNotes.map(r => `
      <div class="speech-bubble">
        <div class="speech-avatar">${r.initials || getInitials(r.name)}</div>
        <div class="speech-content">
          <div class="speech-name">${r.name}</div>
          <div class="speech-text">“${r.notes}”</div>
        </div>
      </div>
    `).join('');
  }

  function showToast(message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }
});
