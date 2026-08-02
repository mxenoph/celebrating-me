/* ==========================================================================
   CELEBRATING ME - JAVASCRIPT LOGIC (SEAMLESS AUTOMATIC CLOUD SYNC)
   Zero configuration for guests & Zero client-side popups/settings buttons!
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
    claimedItems: [] // array of { itemId, quantity }
  };

  // Hardcoded Bin ID provided by host
  const PUBLIC_BIN_ID = '6a6ee55ef5f4af5e29e03b69';
  const POLL_INTERVAL_SECONDS = 4;

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

  // --- Initial Setup ---
  initApp();

  async function initApp() {
    createForestEmbers();
    initCountdownTimer();
    loadUserFromLocalStorage();

    // Fetch Initial Data
    await fetchLatestData();

    // Auto-fill initials if name is typed
    guestNameInput.addEventListener('input', (e) => {
      const name = e.target.value.trim();
      currentUser.name = name;
      if (!guestInitialsInput.dataset.userEdited) {
        currentUser.initials = getInitials(name);
        guestInitialsInput.value = currentUser.initials;
      }
      updateRuleProgressBanner();
    });

    guestInitialsInput.addEventListener('input', (e) => {
      guestInitialsInput.dataset.userEdited = 'true';
      currentUser.initials = e.target.value.trim().toUpperCase();
      renderItems();
    });

    // RSVP Submit
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
        // Try JSONBin
        try {
          const binUrl = `https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}/latest`;
          const binRes = await fetch(binUrl);
          if (binRes.ok) {
            const jsonBinPayload = await binRes.json();
            remoteRsvps = jsonBinPayload.record;
          }
        } catch (e) {}

        // Try Keyless storage backup if JSONBin not reachable
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

      // Fallback to local rsvps.json
      if (!remoteRsvps) {
        const rsvpsRes = await fetch(`rsvps.json?t=${Date.now()}`);
        if (rsvpsRes.ok) {
          remoteRsvps = await rsvpsRes.json();
        }
      }

      if (remoteRsvps && Array.isArray(remoteRsvps)) {
        rsvpsData = remoteRsvps;
        syncCurrentUserWithRsvps();
        renderItems();
        renderRoster();
        updateRuleProgressBanner();
      }
    } catch (err) {
      console.warn('Error fetching live data:', err);
    }
  }

  // --- Push Update to Cloud (Live Guest Claiming) ---
  async function persistRsvpsToJsonBin() {
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
      // 1. Fetch latest array right before writing
      let latestRemote = [...rsvpsData];

      try {
        const binUrl = `https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}/latest`;
        const getRes = await fetch(binUrl);
        if (getRes.ok) {
          const payload = await getRes.json();
          if (payload.record && Array.isArray(payload.record)) {
            latestRemote = payload.record;
          }
        }
      } catch (e) {}

      // Merge current user RSVP
      const mergedRsvps = mergeRsvpsArrays(latestRemote, currentUser);
      rsvpsData = mergedRsvps;

      // 2. PUT update to Cloud
      let writeSuccess = false;

      // Attempt PUT to JSONBin
      try {
        const putRes = await fetch(`https://api.jsonbin.io/v3/b/${PUBLIC_BIN_ID}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mergedRsvps)
        });

        if (putRes.ok) {
          writeSuccess = true;
        }
      } catch (e) {}

      // If JSONBin requires an API key for PUT, fallback seamlessly to Keyless Storage endpoint
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
        showToast(`✅ Saved live!`);
      }
    } catch (e) {
      console.error('Failed to sync to Cloud', e);
    } finally {
      isSyncing = false;
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

  // --- Local Storage Helpers ---
  function loadUserFromLocalStorage() {
    const saved = localStorage.getItem('celebrating_me_user') || localStorage.getItem('mx_cookout_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        currentUser = { ...currentUser, ...parsed };
        if (currentUser.name) {
          guestNameInput.value = currentUser.name;
          guestInitialsInput.value = currentUser.initials || getInitials(currentUser.name);
          guestAttendingSelect.value = currentUser.attending || 'yes';
          guestCountInput.value = currentUser.guestsCount || 1;
          guestNotesInput.value = currentUser.notes || '';
        }
      } catch (e) {
        console.error('LocalStorage parse error', e);
      }
    }
  }

  function saveUserToLocalStorage() {
    localStorage.setItem('celebrating_me_user', JSON.stringify(currentUser));
  }

  function syncCurrentUserWithRsvps() {
    if (!currentUser.name) return;
    rsvpsData = mergeRsvpsArrays(rsvpsData, currentUser);
  }

  // --- Initials Extractor ---
  function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
            itemClaimsMap[c.itemId] = { totalClaimed: 0, claimants: [] };
          }
          itemClaimsMap[c.itemId].totalClaimed += c.quantity;
          itemClaimsMap[c.itemId].claimants.push({
            name: rsvp.name,
            initials: rsvp.initials || getInitials(rsvp.name),
            quantity: c.quantity
          });
        });
      }
    });

    const filtered = itemsData.filter(item => {
      if (activeFilter === 'big' && item.category !== 'big') return false;
      if (activeFilter === 'small' && item.category !== 'small') return false;
      
      const claimsInfo = itemClaimsMap[item.id] || { totalClaimed: 0, claimants: [] };
      const isFullyClaimed = claimsInfo.totalClaimed >= item.totalNeeded;

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
      const claimsInfo = itemClaimsMap[item.id] || { totalClaimed: 0, claimants: [] };
      const totalClaimed = claimsInfo.totalClaimed;
      const remainingNeeded = Math.max(0, item.totalNeeded - totalClaimed);
      const isFullyClaimed = totalClaimed >= item.totalNeeded;

      const userClaim = currentUser.claimedItems.find(c => c.itemId === item.id);
      const userClaimQty = userClaim ? userClaim.quantity : 0;
      const isChecked = userClaimQty > 0;

      const displayInitials = isChecked ? (currentUser.initials || getInitials(currentUser.name) || '✓') : '';

      const claimantsTags = claimsInfo.claimants.map(c => {
        const isMe = currentUser.name && c.name.toLowerCase() === currentUser.name.toLowerCase();
        return `<span class="claimant-tag ${isMe ? 'my-claim' : ''}">${c.initials}: ${c.quantity}</span>`;
      }).join(' ');

      return `
        <div class="item-card category-${item.category} ${isFullyClaimed ? 'fully-claimed' : ''}" data-id="${item.id}">
          <div>
            <div class="item-header">
              <div class="checkbox-wrapper">
                <input type="checkbox" id="check-${item.id}" class="item-checkbox" ${isChecked ? 'checked' : ''} data-id="${item.id}">
                <label for="check-${item.id}" class="checkbox-custom" data-id="${item.id}">
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
                ${isFullyClaimed ? `✓ Fully Claimed (${totalClaimed}/${item.totalNeeded} ${item.unit})` : `⏳ Needed: ${remainingNeeded} of ${item.totalNeeded} ${item.unit}`}
              </div>

              ${claimsInfo.claimants.length > 0 ? `
                <div class="claimants-list">
                  <span style="font-size: 0.75rem; color: var(--text-dim);">Claimed by:</span>
                  ${claimantsTags}
                </div>
              ` : ''}
            </div>

            <button class="btn-claim-qty" data-id="${item.id}">
              ${isChecked ? `Edit Qty (${userClaimQty})` : `Claim Item`}
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
    modalTitle.innerHTML = `⚠️ Please RSVP First!`;
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
      if (r.name.toLowerCase() !== currentUser.name.toLowerCase() && r.claimedItems) {
        const c = r.claimedItems.find(x => x.itemId === item.id);
        if (c) claimedByOthers += c.quantity;
      }
    });

    const maxAvailable = Math.max(0, item.totalNeeded - claimedByOthers);
    const existingClaim = currentUser.claimedItems.find(c => c.itemId === item.id);
    selectedModalQty = existingClaim ? existingClaim.quantity : (maxAvailable > 0 ? 1 : 0);

    modalTitle.innerHTML = `${item.icon} Claim ${item.name}`;
    modalBody.innerHTML = `
      <p>How many <strong>${item.name}</strong> are you bringing?</p>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">
        Total needed: <strong>${item.totalNeeded} ${item.unit}</strong> | Claimed by others: <strong>${claimedByOthers}</strong> | Available: <strong>${maxAvailable}</strong>
      </div>
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

    modalConfirmBtn.textContent = selectedModalQty === 0 ? 'Remove Claim' : 'Confirm Claim';
    modalConfirmBtn.onclick = () => {
      saveItemClaim(item.id, selectedModalQty);
      closeModal();
    };

    modalOverlay.classList.add('active');
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
  }

  function saveItemClaim(itemId, quantity) {
    const existingIndex = currentUser.claimedItems.findIndex(c => c.itemId === itemId);

    if (quantity <= 0) {
      if (existingIndex !== -1) currentUser.claimedItems.splice(existingIndex, 1);
    } else {
      if (existingIndex !== -1) {
        currentUser.claimedItems[existingIndex].quantity = quantity;
      } else {
        currentUser.claimedItems.push({ itemId, quantity });
      }
    }

    saveUserToLocalStorage();
    syncCurrentUserWithRsvps();
    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    persistRsvpsToJsonBin();
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

    saveUserToLocalStorage();
    syncCurrentUserWithRsvps();

    renderItems();
    renderRoster();
    updateRuleProgressBanner();

    persistRsvpsToJsonBin();
    showToast(`RSVP Saved! Thank you, ${currentUser.name}! 🎉`);
  }

  function renderRoster() {
    if (!rosterContainer) return;

    if (!rsvpsData.length) {
      rosterContainer.innerHTML = `<p style="color: var(--text-muted);">No RSVPs yet. Be the first!</p>`;
      return;
    }

    rosterContainer.innerHTML = rsvpsData.map(rsvp => {
      const attendingBadge = rsvp.attending === 'yes' ? '✅ Attending' : (rsvp.attending === 'no' ? '❌ Can\'t Make It' : '❓ Maybe');
      const itemsCount = rsvp.claimedItems ? rsvp.claimedItems.length : 0;

      return `
        <div class="roster-card">
          <div class="avatar-circle">${rsvp.initials || getInitials(rsvp.name)}</div>
          <div class="roster-info">
            <h4>${rsvp.name} (${rsvp.guestsCount} guest${rsvp.guestsCount > 1 ? 's' : ''})</h4>
            <p>${attendingBadge} • ${itemsCount} item(s) bringing</p>
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
