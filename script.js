/* ==========================================================================
   CELEBRATING ME - JAVASCRIPT LOGIC (WITH GUEST MATCHING & PASSPHRASE RESET)
   Features:
   - Returning Guest Matching & Editing (by name)
   - Two-Stage Claims (Pending vs Confirmed)
   - Secret Reset Button ("banana")
   - Real-time Cloud Polling & Multi-User Sync
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

  const PUBLIC_BIN_ID = '6a6ee55ef5f4af5e29e03b69';
  const POLL_INTERVAL_SECONDS = 3;
  const SECRET_PASSPHRASE = 'banana';

  let activeItemForModal = null;
  let selectedModalQty = 1;
  let isSyncing = false;

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

  const secretResetBtn = document.getElementById('secret-reset-btn');

  // --- Initial Setup ---
  initApp();

  async function initApp() {
    createForestEmbers();
    initCountdownTimer();
    loadUserFromLocalStorage();

    // Fetch Initial Data
    await fetchLatestData();

    // Name input listener (Guest Matching & Re-editing)
    guestNameInput.addEventListener('input', handleNameInputChange);

    guestInitialsInput.addEventListener('input', (e) => {
      guestInitialsInput.dataset.userEdited = 'true';
      currentUser.initials = e.target.value.trim().toUpperCase();
      renderItems();
    });

    // RSVP Submit (Confirms & Updates RSVP)
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

    // Secret Reset Button ("banana")
    if (secretResetBtn) {
      secretResetBtn.addEventListener('click', handleSecretReset);
    }

    // Initial Renders
    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    // Start Live Polling for multi-user real-time sync
    setInterval(fetchLatestData, POLL_INTERVAL_SECONDS * 1000);

    // Modal Closes
    modalCancelBtn.addEventListener('click', closeModal);
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    }));
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

    // Check if guest exists in rsvpsData
    const existingRsvp = rsvpsData.find(r => r.name && r.name.toLowerCase() === inputName.toLowerCase());

    if (existingRsvp) {
      // Auto-populate form fields from existing record
      currentUser.initials = existingRsvp.initials || getInitials(inputName);
      currentUser.attending = existingRsvp.attending || 'yes';
      currentUser.guestsCount = existingRsvp.guestsCount || 1;
      currentUser.notes = existingRsvp.notes || '';
      currentUser.claimedItems = existingRsvp.claimedItems ? [...existingRsvp.claimedItems] : [];

      guestInitialsInput.value = currentUser.initials;
      guestAttendingSelect.value = currentUser.attending;
      guestCountInput.value = currentUser.guestsCount;
      guestNotesInput.value = currentUser.notes;

      returningGuestNotice.innerHTML = `
        <div class="returning-guest-banner">
          <span>👋 Welcome back, <strong>${existingRsvp.name}</strong>! Your previously saved RSVP and item claims have been loaded. You can modify your choices below.</span>
        </div>
      `;
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

  // --- Fetch Latest Data (Tries Cloud Bins first, fallback to local rsvps.json) ---
  async function fetchLatestData() {
    try {
      // 1. Fetch items.json
      const itemsRes = await fetch(`items.json?t=${Date.now()}`);
      if (itemsRes.ok) {
        itemsData = await itemsRes.json();
      }

      // 2. Fetch live rsvps from cloud bin
      let remoteRsvps = null;

      if (PUBLIC_BIN_ID) {
        try {
          const binUrl = `https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}/latest`;
          const binRes = await fetch(binUrl);
          if (binRes.ok) {
            const jsonBinPayload = await binRes.json();
            remoteRsvps = jsonBinPayload.record || jsonBinPayload;
          }
        } catch (e) {}

        // Keyless storage backup if needed
        if (!remoteRsvps) {
          try {
            const backupUrl = `https://api.jsonstorage.net/v1/json/${PUBLIC_BIN_ID}`;
            const bRes = await fetch(backupUrl);
            if (bRes.ok) {
              remoteRsvps = await bRes.json();
            }
          } catch (e) {}
        }
      }

      // Fallback: Local rsvps.json
      if (!remoteRsvps) {
        const rsvpsRes = await fetch(`rsvps.json?t=${Date.now()}`);
        if (rsvpsRes.ok) {
          remoteRsvps = await rsvpsRes.json();
        }
      }

      if (remoteRsvps && Array.isArray(remoteRsvps)) {
        rsvpsData = remoteRsvps;

        // If current user is typing/editing, match and refresh claims
        if (currentUser.name) {
          const matched = rsvpsData.find(r => r.name && r.name.toLowerCase() === currentUser.name.toLowerCase());
          if (matched && matched.claimedItems) {
            // Keep local pending items, update confirmed ones
            syncCurrentUserWithRsvps();
          }
        }

        renderItems();
        renderRoster();
        updateRuleProgressBanner();
      }
    } catch (err) {
      console.warn('Error fetching live data:', err);
    }
  }

  // --- Push Update to Cloud (Live Guest Claiming) ---
  async function persistRsvpsToCloud() {
    saveUserToLocalStorage();

    if (!PUBLIC_BIN_ID) {
      syncCurrentUserWithRsvps();
      renderItems();
      renderRoster();
      return;
    }

    if (isSyncing) return;
    isSyncing = true;

    try {
      let latestRemote = [...rsvpsData];

      try {
        const binUrl = `https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}/latest`;
        const getRes = await fetch(binUrl);
        if (getRes.ok) {
          const payload = await getRes.json();
          const rec = payload.record || payload;
          if (Array.isArray(rec)) {
            latestRemote = rec;
          }
        }
      } catch (e) {}

      // Merge current user RSVP
      const mergedRsvps = mergeRsvpsArrays(latestRemote, currentUser);
      rsvpsData = mergedRsvps;

      // PUT update to Cloud
      let writeSuccess = false;

      try {
        const putRes = await fetch(`https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mergedRsvps)
        });

        if (putRes.ok) writeSuccess = true;
      } catch (e) {}

      if (!writeSuccess) {
        try {
          const altRes = await fetch(`https://api.jsonstorage.net/v1/json/${PUBLIC_BIN_ID}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(mergedRsvps)
          });
          if (altRes.ok) writeSuccess = true;
        } catch (e) {}
      }

      if (writeSuccess) {
        showToast(`✅ Synced with Cloud!`);
      }
    } catch (e) {
      console.error('Failed to sync to Cloud', e);
    } finally {
      isSyncing = false;
    }
  }

  // --- Secret Passphrase Reset ("banana") ---
  async function handleSecretReset() {
    const inputPassphrase = prompt('⚠️ PASSPHRASE PROTECTED:\nEnter passphrase to reset all RSVPs and clear all selections:');

    if (!inputPassphrase) return;

    if (inputPassphrase.trim().toLowerCase() === SECRET_PASSPHRASE) {
      if (!confirm('Are you 100% sure you want to clear ALL guest RSVPs and item claims?')) return;

      // Clear local memory & storage
      rsvpsData = [];
      currentUser.claimedItems = [];
      currentUser.name = '';
      currentUser.initials = '';
      currentUser.notes = '';
      localStorage.removeItem('celebrating_me_user');
      localStorage.removeItem('mx_cookout_user');

      // Clear form inputs
      rsvpForm.reset();
      returningGuestNotice.innerHTML = '';

      // Commit empty array [] to Cloud Bin
      try {
        await fetch(`https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([])
        });

        await fetch(`https://api.jsonstorage.net/v1/json/${PUBLIC_BIN_ID}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([])
        });
      } catch (e) {}

      renderItems();
      renderRoster();
      updateRuleProgressBanner();
      alert('🧹 All RSVPs & item claims have been completely reset!');
      showToast('🧹 All selections cleared!');
    } else {
      alert('❌ Incorrect passphrase! Access denied.');
    }
  }

  // Helper: Merges user RSVP safely into remote array
  function mergeRsvpsArrays(remoteList, userObj) {
    if (!userObj.name) return remoteList;

    const copy = [...remoteList];
    const index = copy.findIndex(r => r.name.toLowerCase() === userObj.name.toLowerCase());

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

  // --- Countdown Timer ---
  function initCountdownTimer() {
    const targetDate = new Date('2026-08-08T11:30:00+03:00').getTime();

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
      <div style="font-size: 0.85rem; color: var(--text-muted);">
        Rule: 1 Big Item OR 2 Small Items
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
                <label for="check-${item.id}" class="checkbox-custom ${userStatus === 'pending' ? 'pending-check' : ''}" data-id="${item.id}">
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

            <button class="btn-claim-qty" data-id="${item.id}">
              ${isChecked ? `${userStatus === 'confirmed' ? '✅ Claimed' : '⏳ Pending'} (${userClaimQty})` : `Select Item`}
            </button>
          </div>
        </div>
      `;
    }).join('');

    attachItemEventListeners();
  }

  function attachItemEventListeners() {
    document.querySelectorAll('.checkbox-custom, .btn-claim-qty').forEach(element => {
      element.addEventListener('click', (e) => {
        e.preventDefault();
        const itemId = element.dataset.id;
        handleItemClick(itemId);
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

  function showPreRsvpModal() {
    modalTitle.innerHTML = `⚠️ Please Enter Your Name First!`;
    modalBody.innerHTML = `
      <p style="margin-bottom: 12px;">Before selecting items from the list, please enter your name in the <strong>RSVP form</strong> so everyone knows who is bringing what!</p>
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
      if (r.name.toLowerCase() !== currentUser.name.toLowerCase() && r.claimedItems) {
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
        💡 <em>This holds the item temporarily. Click the "Save & Confirm My RSVP & Items" button on the page to lock in your choice!</em>
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

    modalConfirmBtn.textContent = selectedModalQty === 0 ? 'Remove Hold' : 'Temporarily Hold Item';
    modalConfirmBtn.onclick = () => {
      saveItemClaim(item.id, selectedModalQty);
      closeModal();
    };

    modalOverlay.classList.add('active');
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
  }

  // Stage 1: Temporary Selection (Allow unselecting!)
  function saveItemClaim(itemId, quantity) {
    const existingIndex = currentUser.claimedItems.findIndex(c => c.itemId === itemId);

    if (quantity <= 0) {
      if (existingIndex !== -1) currentUser.claimedItems.splice(existingIndex, 1);
    } else {
      if (existingIndex !== -1) {
        currentUser.claimedItems[existingIndex].quantity = quantity;
        currentUser.claimedItems[existingIndex].status = currentUser.claimedItems[existingIndex].status || 'pending';
      } else {
        currentUser.claimedItems.push({ itemId, quantity, status: 'pending' });
      }
    }

    saveUserToLocalStorage();
    syncCurrentUserWithRsvps();
    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    persistRsvpsToCloud();
    showToast(quantity <= 0 ? `Unselected item!` : `Temporarily selected item! Click RSVP button to confirm.`);
  }

  // Stage 2: Confirmed RSVP & Gifts Confirmation (Supports Re-editing & Updating!)
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

    // Lock in all selections as confirmed!
    currentUser.claimedItems.forEach(c => {
      c.status = 'confirmed';
    });

    saveUserToLocalStorage();
    syncCurrentUserWithRsvps();

    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    // Broadcast updated/confirmed state to cloud
    persistRsvpsToCloud();
    showToast(`🎉 RSVP & Gifts Updated! Thank you, ${currentUser.name}!`);
  }

  function renderRoster() {
    if (!rosterContainer) return;

    if (!rsvpsData.length) {
      rosterContainer.innerHTML = `<p style="color: var(--text-muted);">No RSVPs yet. Be the first!</p>`;
      return;
    }

    rosterContainer.innerHTML = rsvpsData.map(rsvp => {
      const attendingBadge = rsvp.attending === 'yes' ? '✅ Attending' : (rsvp.attending === 'no' ? '❌ Can\'t Make It' : '❓ Maybe');
      const confirmedItems = rsvp.claimedItems ? rsvp.claimedItems.filter(c => c.status === 'confirmed').length : 0;
      const pendingItems = rsvp.claimedItems ? rsvp.claimedItems.filter(c => c.status === 'pending').length : 0;

      return `
        <div class="roster-card">
          <div class="avatar-circle">${rsvp.initials || getInitials(rsvp.name)}</div>
          <div class="roster-info">
            <h4>${rsvp.name} (${rsvp.guestsCount} guest${rsvp.guestsCount > 1 ? 's' : ''})</h4>
            <p>${attendingBadge} • ${confirmedItems} confirmed, ${pendingItems} pending</p>
            ${rsvp.notes ? `<p style="font-style: italic; color: var(--text-muted); margin-top: 4px;">"${rsvp.notes}"</p>` : ''}
          </div>
        </div>
      `;
    }).join('');
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
