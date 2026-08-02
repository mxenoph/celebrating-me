# 🍢 MX Birthday Cookout - Celebrating Me

A web application designed for MX's Birthday Cookout on **Saturday, August 8th** at **Trooditisa Picnic Site** in the Troodos Mountains, Cyprus.

---

## 🌟 Key Features

- **🌲 Theme & Aesthetics**: Custom light mint background (`#f3f7f4`), pine green (`#1e5631`), forest moss (`#2e8b57`), and warm golden embers animation.
- **📱 Responsive Layout**: 3-column items list grid with distinct green left borders for Small items and amber left borders for Big items.
- **⚙️ Two-Stage Item Reservation**:
  - Selecting an item puts it on **temporary hold** (`status: "pending"`) with a glowing amber border.
  - Clicking the floating **`💾` Save Bubble** locks in all selections (`status: "confirmed"`) with a glowing green border.
- **🔄 Live Real-Time & Incognito Sync**:
  - Syncs with verified keyless cloud storage endpoint (`https://jsonblob.com/api/jsonBlob/019fc18d-4418-7f05-914b-572854103832`).
  - Utilizes Web `BroadcastChannel` API for instant cross-tab and Incognito window updates.
- **🧹 Secret Passphrase Master Reset**:
  - Passphrase: **`banana`**
  - Completely wipes the guest roster and resets 100% item availability across all devices and cloud storage.

---

## 🧪 Automated Persistence & Incognito Test Suite

We created an automated Python test suite (`test_jsonblob_persistence_verified.py`) that tests:
1. **User RSVP & Item Selection (`PUT`)**: Saves guest claims to cloud storage.
2. **Incognito Fetch (`GET`)**: Simulates a clean, un-cached Incognito session fetching saved claims.
3. **Master Reset (`PUT []`)**: Verifies that passphrase reset wipes the cloud database back to an empty array.

### Test Results:
```text
🚀 Verifying JSONBlob Full Absolute URL Persistence...
--- Step 1: User Saves RSVP & Items ---
Save PUT Status: 200 (Expected: 200)

--- Step 2: Incognito Window Fetch Simulation ---
Incognito GET Status: 200
✅ INCOGNITO FETCH PERSISTENCE TEST PASSED!

--- Step 3: Master Reset ('banana') Simulation ---
Master Reset PUT Status: 200 (Expected: 200)
Post-Reset Incognito Fetched Data: []
✅ MASTER RESET PERSISTENCE TEST PASSED!
```

---

## 📋 Rules & Requirements

- **Item Quantity Rule**: 1 Big Item OR 2 Small Items per guest.
- **Water Notice**: Mandatory water in insulated bottle required.
- **Souvlakia**: Pork Souvlakia provided on skewers by MX.
