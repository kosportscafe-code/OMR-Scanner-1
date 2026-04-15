// Initialize Lucide Icons
lucide.createIcons();

// State management for Answer Key and OpenCV
let currentAnswerKey = JSON.parse(localStorage.getItem('omr_answer_key')) || {};
let isCvReady = false;
let detectedBubbles = []; // Array of {x, y, radius, isFilled}
let studentAnswers = {}; // Final mapping: { 1: "A", 2: "C" }
let db = null;
let scannerStatus = 'ready';

// Initialize IndexedDB
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OMR_Academy_DB', 1);

        request.onupgradeneeded = (e) => {
            const dbRef = e.target.result;
            if (!dbRef.objectStoreNames.contains('exam_results')) {
                dbRef.createObjectStore('exam_results', { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            console.log('IndexedDB Initialized');
            resolve(db);
        };

        request.onerror = (e) => {
            console.error('IndexedDB Error:', e.target.error);
            reject(e.target.error);
        };
    });
};

initDB();

const dbSaveResult = (data) => {
    if (!db) return;
    const transaction = db.transaction(['exam_results'], 'readwrite');
    const store = transaction.objectStore('exam_results');
    const request = store.add({
        ...data,
        scanDate: new Date().toISOString()
    });

    request.onsuccess = () => {
        showToast('Result saved to device history');
        renderPastScansList();
    };
};

const dbDeleteResult = (id) => {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('DB not initialized'));
        const transaction = db.transaction(['exam_results'], 'readwrite');
        const store = transaction.objectStore('exam_results');
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = (e) => reject(e.target.error);
    });
};

const dbGetAllResults = () => {
    return new Promise((resolve, reject) => {
        if (!db) return reject('DB not initialized');
        const transaction = db.transaction(['exam_results'], 'readonly');
        const store = transaction.objectStore('exam_results');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
};

// Handle OpenCV.js ready event
// Note: We check if cv is defined periodically or via onload
window.onOpenCvReady = () => {
    console.log('OpenCV.js is ready.');
    isCvReady = true;
};

const checkCvInterval = setInterval(() => {
    if (typeof cv !== 'undefined' && cv.Mat) {
        isCvReady = true;
        clearInterval(checkCvInterval);
        console.log('OpenCV context detected.');
    }
}, 500);

// Dashboard Stats Logic
const updateDashboardStats = async () => {
    try {
        const records = await dbGetAllResults();
        const totalScans = records.length;
        const avgScore = totalScans > 0 
            ? Math.round(records.reduce((acc, r) => acc + r.scorePercentage, 0) / totalScans) 
            : 0;
        
        // Calculate unique student IDs as a proxy for 'batches' or just show student count
        const uniqueStudents = new Set(records.map(r => r.studentId)).size;
        const totalNode = document.getElementById('stat-total-scans');
        const avgNode = document.getElementById('stat-avg-score');
        const batchNode = document.getElementById('stat-batches');

        if (totalNode) totalNode.innerText = totalScans;
        if (avgNode) avgNode.innerText = `${avgScore}%`;
        if (batchNode) batchNode.innerText = uniqueStudents;
    } catch (err) {
        console.error('Stats Error:', err);
    }
};

const setGreeting = () => {
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
    const greetText = document.getElementById('greeting-text');
    const dateText = document.getElementById('today-date');
    if (greetText) greetText.innerText = `${greet}, Trainer 🚀`;
    if (dateText) dateText.innerText = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
    });
};

// Tab switching helper
function switchTab(tabId) {
    const item = document.querySelector(`.nav-item[data-tab="${tabId}"]`);

    // Update active nav item
    navItems.forEach(nav => nav.classList.remove('active'));
    if (item) item.classList.add('active');
    
    // Update active tab content
    tabContents.forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === `tab-${tabId}`) {
            tab.classList.add('active');
        }
    });

    document.body.dataset.activeTab = tabId;

    if (tabId === 'settings') {
        initSettingsTab();
    } else if (tabId === 'analytics') {
        renderAnalytics();
    } else if (tabId === 'scan') {
        updateDashboardStats();
    } else if (tabId === 'results') {
        renderPastScansList();
    }
}

// Tab Switching Logic
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = item.getAttribute('data-tab');
        switchTab(targetTab);
    });
});

document.addEventListener('DOMContentLoaded', () => {
    setGreeting();
    updateDashboardStats();
    setScannerStatus('ready');
    switchTab('scan');
    renderPastScansList();
    initPwa();
});

let pastScansCache = null;
let pastScansQuery = '';
let pastScansRenderHandle = null;

// PWA install + offline
let deferredInstallPrompt = null;
let swRegistration = null;

function formatScanTimestamp(iso) {
    try {
        const d = new Date(iso);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
        return iso || '';
    }
}

async function ensurePastScansLoaded() {
    if (pastScansCache) return pastScansCache;
    const records = await dbGetAllResults();
    records.sort((a, b) => new Date(b.scanDate) - new Date(a.scanDate));
    pastScansCache = records;
    return pastScansCache;
}

function scheduleRenderPastScans() {
    if (pastScansRenderHandle) return;
    pastScansRenderHandle = window.requestAnimationFrame(() => {
        pastScansRenderHandle = null;
        renderPastScansList();
    });
}

async function renderPastScansList() {
    const list = document.getElementById('past-scans-list');
    if (!list) return;

    try {
        const records = await ensurePastScansLoaded();
        const query = (pastScansQuery || '').trim().toLowerCase();
        const filtered = query
            ? records.filter((r) => String(r.studentId || '').toLowerCase().includes(query))
            : records;

        const searchInput = document.getElementById('past-scans-search');
        const clearBtn = document.getElementById('past-scans-search-clear');
        if (searchInput && !searchInput.dataset.bound) {
            searchInput.dataset.bound = '1';
            searchInput.addEventListener('input', (e) => {
                pastScansQuery = e.target.value || '';
                scheduleRenderPastScans();
            });
        }
        if (clearBtn && !clearBtn.dataset.bound) {
            clearBtn.dataset.bound = '1';
            clearBtn.addEventListener('click', () => {
                pastScansQuery = '';
                if (searchInput) searchInput.value = '';
                scheduleRenderPastScans();
            });
        }

        if (!records || records.length === 0) {
            list.innerHTML = `<p class="date-subtext" style="padding: 0.5rem 0;">No past scans yet.</p>`;
            return;
        }

        if (filtered.length === 0) {
            list.innerHTML = `<p class="date-subtext" style="padding: 0.5rem 0;">No matches for "${pastScansQuery}".</p>`;
            return;
        }

        const recent = filtered.slice(0, 50);

        list.innerHTML = recent
            .map((r) => {
                const score = typeof r.scorePercentage === 'number' ? `${r.scorePercentage}%` : '';
                const dateStr = formatScanTimestamp(r.scanDate);
                const student = r.studentId || 'Unknown Student';
                return `
                    <button type="button" class="history-item" onclick="openPastScan(${r.id})" aria-label="Open scan for ${student}">
                        <div class="history-item-row">
                            <div style="display:flex; flex-direction:column; gap:0.15rem; text-align:left; min-width:0;">
                                <strong style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${student}</strong>
                                <span class="date-subtext">${dateStr}</span>
                            </div>
                            <div class="history-item-actions">
                                <span class="history-score">${score}</span>
                                <button type="button" class="history-delete-btn" onclick="deletePastScan(event, ${r.id})" aria-label="Delete scan for ${student}">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </div>
                    </button>
                `;
            })
            .join('');

        lucide.createIcons();
    } catch (err) {
        console.error('Past scans render failed:', err);
        list.innerHTML = `<p class="date-subtext" style="padding: 0.5rem 0;">Unable to load past scans.</p>`;
    }
}

window.openPastScan = async function openPastScan(id) {
    try {
        const records = await ensurePastScansLoaded();
        const record = records.find((r) => r.id === id);
        if (!record) return;

        switchTab('results');
        renderResultsReport(
            record.studentId || 'Unknown Student',
            record.scorePercentage || 0,
            record.correctAnswers || 0,
            record.wrongAnswers || 0,
            record.notAttempted || 0,
            record.detailedAnswers || []
        );
    } catch (err) {
        console.error('Open past scan failed:', err);
        showToast('Unable to open scan record', 'error');
    }
};

async function initPwa() {
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn && !installBtn.dataset.bound) {
        installBtn.dataset.bound = '1';
        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            installBtn.hidden = true;
            if (choice?.outcome === 'accepted') {
                showToast('App installation started');
            }
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (installBtn) installBtn.hidden = false;
        lucide.createIcons();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (installBtn) installBtn.hidden = true;
        showToast('App installed');
    });

    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register('./service-worker.js');

            // Notify user when an update is available
            swRegistration.addEventListener('updatefound', () => {
                const installing = swRegistration.installing;
                if (!installing) return;
                installing.addEventListener('statechange', () => {
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        const refresh = confirm('Update available. Refresh now?');
                        if (refresh) {
                            swRegistration.waiting?.postMessage({ type: 'SKIP_WAITING' });
                        }
                    }
                });
            });

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });
        } catch (err) {
            console.debug('Service worker registration failed:', err);
        }
    }
}

window.deletePastScan = async function deletePastScan(event, id) {
    try {
        event?.stopPropagation?.();
        event?.preventDefault?.();

        const records = await ensurePastScansLoaded();
        const record = records.find((r) => r.id === id);
        const label = record?.studentId ? ` (${record.studentId})` : '';
        if (!confirm(`Delete this scan${label}? This cannot be undone.`)) return;

        // Optimistic UI update
        pastScansCache = records.filter((r) => r.id !== id);
        scheduleRenderPastScans();

        await dbDeleteResult(id);
        updateDashboardStats();
        showToast('Scan deleted', 'success');
    } catch (err) {
        console.error('Delete scan failed:', err);
        pastScansCache = null; // force reload
        scheduleRenderPastScans();
        showToast('Failed to delete scan', 'error');
    }
};

// Correction Log State
let correctionLog = JSON.parse(localStorage.getItem('omr_answer_key_log')) || [];

function updateHeaderStatusChip() {
    const chipContainer = document.getElementById('status-chip-container');
    if (!chipContainer) return;

    const labelMap = {
        ready: 'Ready',
        scanning: 'Scanning',
        error: 'Error'
    };

    chipContainer.innerHTML = `
        <div class="status-chip ${scannerStatus}">
            <span class="status-dot"></span>
            <span>${labelMap[scannerStatus] || 'Ready'}</span>
        </div>
    `;
}

function setScannerStatus(nextStatus = 'ready') {
    scannerStatus = nextStatus;
    updateHeaderStatusChip();
    setScannerFrameState(nextStatus === 'scanning' ? 'detecting' : 'idle');
}

// Settings Tab Logic
function initSettingsTab() {
    const settingsContainer = document.getElementById('tab-settings');
    if (!settingsContainer) return;

    // Build the form structure
    settingsContainer.innerHTML = `
        <div class="card glass">
            <div class="settings-form">
                <h2 class="glow-text">SYSTEM://KEY_GENERATOR</h2>
                <div class="input-group">
                    <label for="question-count">NODE_CAPACITY (MAX 100)</label>
                    <input type="number" id="question-count" min="1" max="100" placeholder="e.g. 20">
                </div>
                
                <div id="questions-container" class="question-rows">
                    <!-- Dynamic rows will appear here -->
                </div>

                <button id="save-key" class="btn-cyber-primary">SAVE_NEW_VECTOR <i data-lucide="download"></i></button>
            </div>
        </div>

        <!-- Correction Table Section -->
        <div id="settings-review-section" style="margin-top: 2rem;"></div>

        <!-- History Log Section -->
        <details id="history-log-section" class="card glass history-log" style="margin-top: 2rem; border-color: var(--surface-border);">
            <summary class="glow-text" style="cursor: pointer; padding: 1rem; list-style: none;">📋 EDIT_HISTORY_CACHED</summary>
            <div id="history-list" style="padding: 1rem; border-top: 1px solid var(--surface-border);"></div>
        </details>
    `;

    renderAnswerKeyReview();
    renderEditHistory();

    const qCountInput = document.getElementById('question-count');
    const qContainer = document.getElementById('questions-container');
    const saveBtn = document.getElementById('save-key');

    // Load existing count from state
    const existingCount = Object.keys(currentAnswerKey).length;
    if (existingCount > 0) {
        qCountInput.value = existingCount;
        generateQuestionRows(existingCount, qContainer);
    }

    // Handle input change
    qCountInput.addEventListener('input', (e) => {
        const count = parseInt(e.target.value) || 0;
        if (count > 100) e.target.value = 100;
        generateQuestionRows(Math.min(count, 100), qContainer);
    });

    // Handle Save
    saveBtn.addEventListener('click', () => {
        saveAnswerKey();
    });
}

function generateQuestionRows(count, container) {
    container.innerHTML = '';
    for (let i = 1; i <= count; i++) {
        const row = document.createElement('div');
        row.className = 'question-row';
        
        const existingValue = currentAnswerKey[i] || '';
        
        row.innerHTML = `
            <span class="q-num">${i}.</span>
            <div class="options">
                ${['A', 'B', 'C', 'D'].map(opt => `
                    <div class="option-btn">
                        <input type="radio" name="q${i}" id="q${i}${opt}" value="${opt}" ${existingValue === opt ? 'checked' : ''}>
                        <label for="q${i}${opt}">${opt}</label>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(row);
    }
}

function saveAnswerKey() {
    const qRows = document.querySelectorAll('#questions-container .question-row');
    const newKey = {};
    
    qRows.forEach((row, index) => {
        const qNum = index + 1;
        const selected = row.querySelector('input[type="radio"]:checked');
        if (selected) {
            newKey[qNum] = selected.value;
        }
    });

    currentAnswerKey = newKey;
    localStorage.setItem('omr_answer_key', JSON.stringify(newKey));
    showToast('Answer Key Saved!');
    renderAnswerKeyReview();
    updateHeaderStatusChip();
}

async function renderAnswerKeyReview() {
    const reviewSection = document.getElementById('settings-review-section');
    if (!reviewSection) return;

    const key = currentAnswerKey;
    const qNums = Object.keys(key).sort((a,b) => a-b);

    if (qNums.length === 0) {
        reviewSection.innerHTML = `
            <div class="card glass" style="text-align: center; padding: 2rem;">
                <p class="date-subtext">No answer key found. Please create one above.</p>
            </div>
        `;
        return;
    }

    // Check for today's scans in IndexedDB
    const records = await dbGetAllResults();
    const today = new Date().toISOString().split('T')[0];
    const todayScans = records.filter(r => r.scanDate.startsWith(today)).length;

    let warningHtml = '';
    if (todayScans > 0) {
        warningHtml = `
            <div class="warning-banner">
                <div style="display: flex; gap: 0.5rem; color: #f97316; font-weight: 800;">
                    <i data-lucide="alert-triangle"></i> CAUTION: ${todayScans} SCANS_DETECTED_TODAY
                </div>
                <p style="font-size: 0.7rem; opacity: 0.8;">Modifying the key will not auto-update their scores.</p>
                <button onclick="recalculateTodayScores()" class="btn-cyber-outline" style="border-color: #f97316; color: #f97316;">RECALCULATE_TODAY_SCORES</button>
            </div>
        `;
    }

    reviewSection.innerHTML = `
        <h2 class="glow-text">// SAVED_VECTOR_REVIEW</h2>
        ${warningHtml}
        <div class="card glass" style="padding: 0;">
            <div class="table-responsive">
                <table class="report-table" style="margin: 0; border: none;">
                    <thead>
                        <tr style="text-align: left; opacity: 0.6; font-size: 0.7rem;">
                            <th style="padding: 1rem;">Q#</th>
                            <th>DATA</th>
                            <th>CMD</th>
                            <th>STAT</th>
                        </tr>
                    </thead>
                    <tbody id="review-table-body">
                        ${qNums.map(q => renderReviewRow(q, key[q])).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        <button onclick="resetAnswerKey()" class="btn-cyber-outline" style="color: var(--primary); border-color: var(--primary-glow); margin-top: 1rem;">
            RESET_ENTIRE_VECTOR <i data-lucide="trash-2"></i>
        </button>
    `;
    lucide.createIcons();
}

function renderReviewRow(q, ans, isEditing = false) {
    if (isEditing) {
        return `
            <tr id="row-q-${q}">
                <td style="padding: 1rem;">${q}</td>
                <td>
                    <div class="edit-row-pills">
                        ${['A','B','C','D'].map(opt => `
                            <button onclick="setRowEditValue(${q}, '${opt}')" id="edit-pill-${q}-${opt}" 
                                class="edit-pill-btn ${ans === opt ? 'active' : ''}">${opt}</button>
                        `).join('')}
                    </div>
                </td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button onclick="commitRowEdit(${q})" class="btn-update"><i data-lucide="check" style="width: 14px;"></i></button>
                        <button onclick="cancelRowEdit(${q}, '${ans}')" class="btn-cancel"><i data-lucide="x" style="width: 14px;"></i></button>
                    </div>
                </td>
                <td style="font-size: 0.6rem; color: #f97316;">EDIT_MODE</td>
            </tr>
        `;
    }

    return `
        <tr id="row-q-${q}">
            <td style="padding: 1rem;">${q}</td>
            <td><span class="ans-pill ${ans}">${ans}</span></td>
            <td>
                <button class="btn-icon" onclick="toggleRowEdit(${q}, '${ans}')"><i data-lucide="pencil" style="width: 16px;"></i></button>
            </td>
            <td style="font-size: 0.6rem; opacity: 0.6;">✅ SAVED</td>
        </tr>
    `;
}

let activeEditRow = null;
let currentEditValue = null;

function toggleRowEdit(q, ans) {
    if (activeEditRow) {
        showToast('Only one vector can be edited at once', 'error');
        return;
    }
    activeEditRow = q;
    currentEditValue = ans;
    const row = document.getElementById(`row-q-${q}`);
    row.outerHTML = renderReviewRow(q, ans, true);
    lucide.createIcons();
}

function setRowEditValue(q, val) {
    currentEditValue = val;
    // Update visual pills
    document.querySelectorAll(`#row-q-${q} .edit-pill-btn`).forEach(btn => btn.classList.remove('active'));
    document.getElementById(`edit-pill-${q}-${val}`).classList.add('active');
}

function cancelRowEdit(q, originalAns) {
    activeEditRow = null;
    const row = document.getElementById(`row-q-${q}`);
    row.outerHTML = renderReviewRow(q, originalAns, false);
    lucide.createIcons();
}

function commitRowEdit(q) {
    const oldAns = currentAnswerKey[q];
    const newAns = currentEditValue;
    
    if (oldAns === newAns) {
        cancelRowEdit(q, oldAns);
        return;
    }

    // Save to State & LocalStorage
    currentAnswerKey[q] = newAns;
    localStorage.setItem('omr_answer_key', JSON.stringify(currentAnswerKey));

    // Log the change
    const logEntry = {
        question: q,
        oldAnswer: oldAns,
        newAnswer: newAns,
        changedAt: new Date().toISOString()
    };
    correctionLog.unshift(logEntry);
    if (correctionLog.length > 10) correctionLog.pop();
    localStorage.setItem('omr_answer_key_log', JSON.stringify(correctionLog));

    activeEditRow = null;
    currentEditValue = null;
    
    // UI Feedback
    showToast(`Q${q} updated to ${newAns}`, 'success');
    renderAnswerKeyReview();
    renderEditHistory();
    updateHeaderStatusChip();
}

function renderEditHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;

    if (correctionLog.length === 0) {
        list.innerHTML = `<p class="date-subtext">No modification log found.</p>`;
        return;
    }

    list.innerHTML = correctionLog.map((log, index) => {
        const date = new Date(log.changedAt);
        const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="history-entry">
                <div>
                    <span style="font-weight: 800; color: var(--primary);">Q${log.question}</span> 
                    <span style="opacity: 0.6;">${log.oldAnswer} &rarr; ${log.newAnswer}</span>
                    <span style="font-size: 0.6rem; margin-left: 0.5rem; opacity: 0.4;">${dateStr}, ${timeStr}</span>
                </div>
                <button onclick="undoLogEntry(${index})" class="undo-btn" title="Undo change">↩️</button>
            </div>
        `;
    }).join('');
}

function undoLogEntry(index) {
    const log = correctionLog[index];
    if (!log) return;

    // Restore answer
    currentAnswerKey[log.question] = log.oldAnswer;
    localStorage.setItem('omr_answer_key', JSON.stringify(currentAnswerKey));

    // Remove from log
    correctionLog.splice(index, 1);
    localStorage.setItem('omr_answer_key_log', JSON.stringify(correctionLog));

    showToast(`Q${log.question} reverted to ${log.oldAnswer}`, 'success');
    renderAnswerKeyReview();
    renderEditHistory();
    updateHeaderStatusChip();
}

function resetAnswerKey() {
    if (confirm('⚠️ RESET_ANSWER_KEY?\n\nThis will permanently delete ALL saved answers. This cannot be undone.')) {
        currentAnswerKey = {};
        localStorage.removeItem('omr_answer_key');
        correctionLog = [];
        localStorage.removeItem('omr_answer_key_log');

        showToast('Answer Key Cleared', 'success');
        renderAnswerKeyReview();
        renderEditHistory();
        updateHeaderStatusChip();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

async function recalculateTodayScores() {
    const records = await dbGetAllResults();
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = records.filter(r => r.scanDate.startsWith(today));

    if (todayRecords.length === 0) return;

    const banner = document.querySelector('.warning-banner');
    const answerKey = currentAnswerKey;

    for (let i = 0; i < todayRecords.length; i++) {
        const record = todayRecords[i];
        if (banner) banner.innerHTML = `<p class="date-subtext">RECALCULATING ${i+1} OF ${todayRecords.length}...</p>`;

        let correctCount = 0;
        let wrongCount = 0;
        let unattemptedCount = 0;
        const newDetailedAnswers = [];

        // Note: record.detailedAnswers stores [{q, student, correct, status}]
        record.detailedAnswers.forEach(ans => {
            const studentAns = ans.student;
            const newCorrectAns = answerKey[ans.q];
            
            let status = 'wrong';
            if (studentAns === newCorrectAns) {
                status = 'correct';
                correctCount++;
            } else if (studentAns === 'Not Attempted') {
                status = 'blank';
                unattemptedCount++;
            } else {
                wrongCount++;
            }

            newDetailedAnswers.push({ 
                q: ans.q, 
                student: studentAns, 
                correct: newCorrectAns, 
                status 
            });
        });

        const scorePercent = Math.round((correctCount / record.totalQuestions) * 100);

        // Update IndexedDB record
        const transaction = db.transaction(['exam_results'], 'readwrite');
        const store = transaction.objectStore('exam_results');
        const updateRequest = store.put({
            ...record,
            correctAnswers: correctCount,
            wrongAnswers: wrongCount,
            notAttempted: unattemptedCount,
            scorePercentage: scorePercent,
            detailedAnswers: newDetailedAnswers
        });

        await new Promise((resolve) => { updateRequest.onsuccess = resolve; });
    }

    showToast(`✅ All ${todayRecords.length} scores updated with new key`, 'success');
    renderAnswerKeyReview();
    updateDashboardStats();
}

function showToast(message, type = 'success') {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    
    const icon = type === 'error' ? 'alert-circle' : 'check-circle';
    toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${message}</span>`;
    document.body.appendChild(toast);
    
    // Initialize icon
    lucide.createIcons();
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Animate out
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// Scan Tab Logic
const scanTrigger = document.getElementById('scan-trigger');
const cameraInput = document.getElementById('camera-input');
const cameraPreview = document.getElementById('camera-preview');
const edgeOverlay = document.getElementById('edge-overlay');
const imagePreview = document.getElementById('image-preview');
const previewContainer = document.getElementById('preview-container');
const scanActions = document.getElementById('scan-actions');
const uploadBtn = document.getElementById('upload-btn');
const flashToggleBtn = document.getElementById('flash-toggle-btn');
const finalScanBtn = document.getElementById('final-scan-btn');
const studentIdInput = document.getElementById('student-id');
const scannerScreen = document.getElementById('tab-scan');
const frameStatusText = document.getElementById('frame-status-text');
const frameInstructionText = document.getElementById('frame-instruction-text');
const capturePreviewModal = document.getElementById('capture-preview-modal');
const capturePreviewImage = document.getElementById('capture-preview-image');
const modalRetakeBtn = document.getElementById('modal-retake-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const successFlash = document.getElementById('success-flash');
let isFlashEnabled = false;
let frameFeedbackTimer = null;
let cameraStream = null;
let liveCameraReady = false;
let liveDetectionInterval = null;
const liveDetectionCanvas = document.createElement('canvas');

// Auto-capture when OMR sheet is stable
const AUTO_CAPTURE_MIN_DELAY_MS = 1000;
const AUTO_CAPTURE_MAX_DELAY_MS = 2000;
const STABLE_REQUIRED_CYCLES = 3; // detect loop runs every ~350ms
const STABLE_POINT_DELTA_PX = 12; // avg corner movement threshold (in source pixels)
let stableCycleCount = 0;
let lastStablePoints = null; // flat array of 8 numbers
let lastStableUpdatedAt = 0;
let autoCaptureTimer = null;
let autoCapturedOnce = false;

function meanAbsDelta8(a, b) {
    if (!a || !b || a.length !== 8 || b.length !== 8) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += Math.abs(a[i] - b[i]);
    return sum / 8;
}

function disarmAutoCaptureTimer() {
    if (autoCaptureTimer) {
        clearTimeout(autoCaptureTimer);
        autoCaptureTimer = null;
    }
}

function resetAutoCaptureState() {
    stableCycleCount = 0;
    lastStablePoints = null;
    lastStableUpdatedAt = 0;
    autoCapturedOnce = false;
    disarmAutoCaptureTimer();
}

function maybeArmAutoCapture() {
    if (autoCapturedOnce) return;
    if (autoCaptureTimer) return;
    if (stableCycleCount < STABLE_REQUIRED_CYCLES) return;
    if (document.body.classList.contains('processing')) return;
    if (capturePreviewModal?.classList.contains('active')) return;
    if (document.body.dataset.activeTab !== 'scan') return;

    const delayMs =
        AUTO_CAPTURE_MIN_DELAY_MS +
        Math.floor(Math.random() * (AUTO_CAPTURE_MAX_DELAY_MS - AUTO_CAPTURE_MIN_DELAY_MS + 1));

    autoCaptureTimer = setTimeout(() => {
        autoCaptureTimer = null;

        if (autoCapturedOnce) return;
        if (stableCycleCount < STABLE_REQUIRED_CYCLES) return;
        if (Date.now() - lastStableUpdatedAt > 900) return;
        if (document.body.classList.contains('processing')) return;
        if (capturePreviewModal?.classList.contains('active')) return;
        if (document.body.dataset.activeTab !== 'scan') return;

        const ok = captureLiveFrame();
        if (!ok) return;

        scanActions?.classList.add('active');
        setScannerStatus('ready');
        syncPrimaryAction();
        openCapturePreview(imagePreview.src);
        autoCapturedOnce = true;
    }, delayMs);
}

function openCameraPicker() {
    if (cameraInput) {
        cameraInput.click();
    }
}

function syncPrimaryAction() {
    if (!finalScanBtn) return;
    finalScanBtn.disabled = !imagePreview?.src && !liveCameraReady;
}

function syncEdgeOverlaySize() {
    if (!edgeOverlay || !cameraPreview) return;
    const rect = cameraPreview.getBoundingClientRect();
    edgeOverlay.width = Math.max(1, Math.round(rect.width));
    edgeOverlay.height = Math.max(1, Math.round(rect.height));
}

function clearEdgeOverlay() {
    if (!edgeOverlay) return;
    const context = edgeOverlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, edgeOverlay.width, edgeOverlay.height);
}

function drawDetectedBoundary(points, sourceWidth, sourceHeight) {
    if (!edgeOverlay) return;
    const context = edgeOverlay.getContext('2d');
    if (!context) return;

    clearEdgeOverlay();

    const scaleX = edgeOverlay.width / sourceWidth;
    const scaleY = edgeOverlay.height / sourceHeight;
    const mapped = [];

    for (let i = 0; i < points.length; i += 2) {
        mapped.push({
            x: points[i] * scaleX,
            y: points[i + 1] * scaleY
        });
    }

    context.strokeStyle = 'rgba(0, 255, 156, 0.95)';
    context.lineWidth = 4;
    context.shadowColor = 'rgba(0, 255, 156, 0.65)';
    context.shadowBlur = 16;
    context.beginPath();
    context.moveTo(mapped[0].x, mapped[0].y);
    mapped.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.closePath();
    context.stroke();
}

function setFlashToggleState(enabled) {
    isFlashEnabled = enabled;
    if (!flashToggleBtn) return;
    flashToggleBtn.classList.toggle('active', enabled);
    flashToggleBtn.setAttribute('aria-pressed', String(enabled));
    flashToggleBtn.setAttribute('title', enabled ? 'Flash on' : 'Flash off');
    flashToggleBtn.innerHTML = `
        <i data-lucide="${enabled ? 'flashlight' : 'flashlight-off'}"></i>
    `;
    lucide.createIcons();
}

async function initLiveCamera() {
    if (!cameraPreview || !navigator.mediaDevices?.getUserMedia) {
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        cameraStream = stream;
        cameraPreview.srcObject = stream;
        await cameraPreview.play();
        cameraPreview.classList.add('active');
        liveCameraReady = true;
        syncEdgeOverlaySize();
        startLiveDetectionLoop();
        syncPrimaryAction();
    } catch (err) {
        console.error('Camera access failed:', err);
        scannerStatus = 'error';
        updateHeaderStatusChip();
        setScannerFrameState('error', true);
        showToast('Camera access blocked. You can still upload an image.', 'error');
    }
}

function startLiveDetectionLoop() {
    if (liveDetectionInterval) return;
    liveDetectionInterval = setInterval(detectLiveOmrEdges, 350);
}

function detectLiveOmrEdges() {
    if (
        !isCvReady ||
        !liveCameraReady ||
        !cameraPreview ||
        cameraPreview.videoWidth === 0 ||
        cameraPreview.videoHeight === 0 ||
        document.body.dataset.activeTab !== 'scan' ||
        document.body.classList.contains('processing') ||
        capturePreviewModal?.classList.contains('active')
    ) {
        clearEdgeOverlay();
        stableCycleCount = 0;
        lastStablePoints = null;
        lastStableUpdatedAt = 0;
        disarmAutoCaptureTimer();
        return;
    }

    liveDetectionCanvas.width = cameraPreview.videoWidth;
    liveDetectionCanvas.height = cameraPreview.videoHeight;
    const tempContext = liveDetectionCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempContext) return;
    tempContext.drawImage(cameraPreview, 0, 0, liveDetectionCanvas.width, liveDetectionCanvas.height);

    let src;
    let gray;
    let blurred;
    let edged;
    let contours;
    let hierarchy;
    let largestContour = null;

    try {
        src = cv.imread(liveDetectionCanvas);
        gray = new cv.Mat();
        blurred = new cv.Mat();
        edged = new cv.Mat();
        contours = new cv.MatVector();
        hierarchy = new cv.Mat();

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        cv.Canny(blurred, edged, 75, 200);
        cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;

        for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const area = cv.contourArea(cnt);
            if (area > 12000) {
                const peri = cv.arcLength(cnt, true);
                const approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
                if (approx.rows === 4 && area > maxArea) {
                    maxArea = area;
                    if (largestContour) largestContour.delete();
                    largestContour = approx;
                } else {
                    approx.delete();
                }
            }
        }

        if (!largestContour) {
            clearEdgeOverlay();
            stableCycleCount = 0;
            lastStablePoints = null;
            lastStableUpdatedAt = 0;
            disarmAutoCaptureTimer();
            return;
        }

        const orderedPoints = orderPoints(largestContour.data32S);
        drawDetectedBoundary(orderedPoints, src.cols, src.rows);

        // Stability tracking (corner movement)
        const delta = meanAbsDelta8(lastStablePoints, orderedPoints);
        const isStableNow = delta <= STABLE_POINT_DELTA_PX;
        if (isStableNow) {
            stableCycleCount = Math.min(STABLE_REQUIRED_CYCLES + 2, stableCycleCount + 1);
        } else {
            stableCycleCount = 0;
            disarmAutoCaptureTimer();
        }
        lastStablePoints = orderedPoints.slice(0);
        lastStableUpdatedAt = Date.now();
        maybeArmAutoCapture();
    } catch (err) {
        console.debug('Live edge detection skipped:', err);
        clearEdgeOverlay();
        stableCycleCount = 0;
        lastStablePoints = null;
        lastStableUpdatedAt = 0;
        disarmAutoCaptureTimer();
    } finally {
        if (largestContour) largestContour.delete();
        if (src) src.delete();
        if (gray) gray.delete();
        if (blurred) blurred.delete();
        if (edged) edged.delete();
        if (contours) contours.delete();
        if (hierarchy) hierarchy.delete();
    }
}

function captureLiveFrame() {
    if (!cameraPreview || !liveCameraReady || cameraPreview.videoWidth === 0 || cameraPreview.videoHeight === 0) {
        return false;
    }

    const canvas = document.createElement('canvas');
    canvas.width = cameraPreview.videoWidth;
    canvas.height = cameraPreview.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return false;

    context.drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
    imagePreview.src = canvas.toDataURL('image/jpeg', 0.92);
    previewContainer.classList.add('active');
    return true;
}

function openCapturePreview(src) {
    if (!capturePreviewModal || !capturePreviewImage) return;
    capturePreviewImage.src = src;
    capturePreviewModal.classList.add('active');
}

function closeCapturePreview() {
    if (!capturePreviewModal || !capturePreviewImage) return;
    capturePreviewModal.classList.remove('active');
    capturePreviewImage.src = '';
}

function setProcessingState(isProcessing) {
    document.body.classList.toggle('processing', Boolean(isProcessing));
    if (finalScanBtn) {
        finalScanBtn.disabled = isProcessing || (!imagePreview?.src && !liveCameraReady);
        finalScanBtn.innerHTML = isProcessing
            ? `<i data-lucide="loader-circle"></i> Scanning...`
            : `<i data-lucide="scan-search"></i> Scan Now`;
    }
    if (uploadBtn) uploadBtn.disabled = Boolean(isProcessing);
    if (flashToggleBtn) flashToggleBtn.disabled = Boolean(isProcessing);
    lucide.createIcons();
}

function triggerSuccessFeedback() {
    if (navigator.vibrate) {
        navigator.vibrate([40, 30, 60]);
    }

    if (successFlash) {
        successFlash.classList.remove('active');
        void successFlash.offsetWidth;
        successFlash.classList.add('active');
        setTimeout(() => successFlash.classList.remove('active'), 500);
    }

    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const audioCtx = new AudioContextClass();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1174, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);

        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.18);
        oscillator.onended = () => audioCtx.close();
    } catch (err) {
        console.debug('Success beep unavailable', err);
    }
}

function setScannerFrameState(state = 'idle', temporary = false) {
    if (!scannerScreen || !frameStatusText) return;

    clearTimeout(frameFeedbackTimer);
    scannerScreen.classList.remove('state-idle', 'state-detecting', 'state-success', 'state-error');

    const states = {
        idle: 'Ready to scan',
        detecting: 'Scanning...',
        success: 'OMR Detected',
        error: 'Adjust position'
    };

    scannerScreen.classList.add(`state-${state}`);
    frameStatusText.textContent = states[state] || states.idle;
    frameStatusText.classList.add('show-feedback');
    if (frameInstructionText) {
        frameInstructionText.textContent = 'Align OMR sheet within frame';
    }

    if (temporary) {
        frameFeedbackTimer = setTimeout(() => {
            setScannerFrameState('idle');
        }, 2000);
    }
}

if (scanTrigger && cameraInput) {
    // Open camera/file picker when scan frame is tapped
    scanTrigger.addEventListener('click', () => {
        if (!liveCameraReady) {
            openCameraPicker();
        }
    });
    scanTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!liveCameraReady) {
                openCameraPicker();
            }
        }
    });

    // Handle file selection
    cameraInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                imagePreview.src = event.target.result;
                scanActions.classList.add('active');
                setScannerStatus('ready');
                syncPrimaryAction();
                openCapturePreview(event.target.result);
                
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            reader.readAsDataURL(file);
        }
    });
}

if (uploadBtn) {
    uploadBtn.addEventListener('click', openCameraPicker);
}

if (flashToggleBtn) {
    flashToggleBtn.addEventListener('click', async () => {
        const track = cameraStream?.getVideoTracks?.()[0];
        const capabilities = track?.getCapabilities?.();
        const supportsTorch = Boolean(capabilities?.torch);

        if (!track || !supportsTorch) {
            showToast('Flash control is not supported on this browser.', 'error');
            return;
        }

        const nextState = !isFlashEnabled;
        try {
            await track.applyConstraints({ advanced: [{ torch: nextState }] });
            setFlashToggleState(nextState);
        } catch (err) {
            console.error('Torch toggle failed:', err);
            showToast('Unable to toggle flash.', 'error');
        }
    });
}

if (modalRetakeBtn) {
    modalRetakeBtn.addEventListener('click', () => {
        resetScanner();
        if (!liveCameraReady) {
            openCameraPicker();
        }
    });
}

function resetScanner() {
    // Clear inputs and images
    cameraInput.value = '';
    imagePreview.src = '';
    previewContainer.classList.remove('active');
    scanActions.classList.remove('active');
    syncPrimaryAction();
    
    // Hide results
    document.getElementById('result-container').style.display = 'none';
    document.getElementById('spinner').classList.remove('show');
    document.getElementById('results-mapping').style.display = 'none';
    
    // Reset state
    detectedBubbles = [];
    studentAnswers = {};
    setScannerStatus('ready');
    setFlashToggleState(false);
    closeCapturePreview();
    setProcessingState(false);
    clearEdgeOverlay();
    resetAutoCaptureState();

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Scanner Reset', 'success');
}

if (finalScanBtn) {
    finalScanBtn.addEventListener('click', async () => {
        // If we're on live camera and haven't captured yet, capture -> full screen preview first.
        if (!imagePreview.src && liveCameraReady) {
            if (!captureLiveFrame()) {
                showToast('Capture a sheet image first', 'error');
                return;
            }
            scanActions.classList.add('active');
            setScannerStatus('ready');
            syncPrimaryAction();
            openCapturePreview(imagePreview.src);
            return;
        }

        if (!imagePreview.src) {
            showToast('Capture a sheet image first', 'error');
            return;
        }

        const studentId = studentIdInput?.value?.trim() || 'Unknown Student';
        setScannerStatus('scanning');
        await processImage(studentId);
    });
}

if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', async () => {
        if (!imagePreview.src) {
            showToast('Capture a sheet image first', 'error');
            return;
        }

        closeCapturePreview();
        previewContainer.classList.add('active');
        const studentId = studentIdInput?.value?.trim() || 'Unknown Student';
        setScannerStatus('scanning');
        await processImage(studentId);
    });
}

syncPrimaryAction();
setFlashToggleState(false);
initLiveCamera();
window.addEventListener('resize', syncEdgeOverlaySize);

function orderPoints(pts) {
    // pts is a flat array [x1, y1, x2, y2, x3, y3, x4, y4]
    const points = [];
    for (let i = 0; i < 8; i += 2) {
        points.push({ x: pts[i], y: pts[i + 1] });
    }

    // Sort by sum (x + y) -> TL is min, BR is max
    const sumSorted = [...points].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const tl = sumSorted[0];
    const br = sumSorted[3];

    // Sort by diff (y - x) -> TR is min, BL is max
    const diffSorted = [...points].sort((a, b) => (a.y - a.x) - (b.y - b.x));
    const tr = diffSorted[0];
    const bl = diffSorted[3];

    return [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
}

async function processImage(studentId) {
    const spinner = document.getElementById('spinner');
    const resultContainer = document.getElementById('result-container');
    const imageDetails = document.getElementById('image-details');
    const bubbleCountPill = document.getElementById('bubble-count-pill');

    // Show loading state
    setScannerStatus('scanning');
    setProcessingState(true);
    spinner.classList.add('show');
    resultContainer.style.display = 'none';
    bubbleCountPill.style.display = 'none';

    // Small delay to allow spinner to show up
    await new Promise(resolve => setTimeout(resolve, 500));

    let src, gray, blurred, edged, contours, hierarchy;
    
    try {
        // 1. Load image into OpenCV Mat
        src = cv.imread(imagePreview);
        gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // 2. Reduce noise with Gaussian Blur
        blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

        // 3. Detect edges with Canny
        edged = new cv.Mat();
        cv.Canny(blurred, edged, 75, 200);

        // 4. Find Contours for Sheet Boundary
        contours = new cv.MatVector();
        hierarchy = new cv.Mat();
        cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let largestContour = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > 5000) {
                let peri = cv.arcLength(cnt, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
                if (approx.rows === 4 && area > maxArea) {
                    maxArea = area;
                    if (largestContour) largestContour.delete();
                    largestContour = approx;
                } else {
                    approx.delete();
                }
            }
        }

        if (!largestContour) throw new Error('SHEET_NOT_FOUND');

        // 5. Perspective Transform
        const orderedPoints = orderPoints(largestContour.data32S);
        const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, orderedPoints);
        const destWidth = 600;
        const destHeight = 840;
        const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, destWidth, 0, destWidth, destHeight, 0, destHeight]);
        const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
        const warped = new cv.Mat();
        cv.warpPerspective(src, warped, M, new cv.Size(destWidth, destHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

        // --- PHASE 2: BUBBLE DETECTION ---
        
        // 1. Preprocess warped image for bubble detection
        let warpedGray = new cv.Mat();
        cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);
        
        let thresh = new cv.Mat();
        cv.adaptiveThreshold(warpedGray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // 2. Find contours in thresholded image
        let bContours = new cv.MatVector();
        let bHierarchy = new cv.Mat();
        cv.findContours(thresh, bContours, bHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        detectedBubbles = [];
        let bubbleVisual = warped.clone();

        for (let i = 0; i < bContours.size(); ++i) {
            let cnt = bContours.get(i);
            let rect = cv.boundingRect(cnt);
            let aspectRatio = rect.width / rect.height;
            let area = cv.contourArea(cnt);

            // Filter for OMR bubbles (approx 10-25px radius)
            // Area of circle with r=15 is ~700. We'll use a range 200 - 1500
            if (area > 200 && area < 1500 && aspectRatio > 0.7 && aspectRatio < 1.3) {
                
                // Calculate fill ratio
                // Create a circular mask for this specific bubble
                let mask = cv.Mat.zeros(thresh.rows, thresh.cols, cv.CV_8U);
                cv.drawContours(mask, bContours, i, new cv.Scalar(255), -1);
                
                let bubbleData = new cv.Mat();
                cv.bitwise_and(thresh, thresh, bubbleData, mask);
                
                let filledPixels = cv.countNonZero(bubbleData);
                let totalArea = cv.countNonZero(mask);
                let fillRatio = filledPixels / totalArea;

                const isFilled = fillRatio >= 0.5;
                const circleColor = isFilled ? new cv.Scalar(255, 0, 0, 255) : new cv.Scalar(255, 255, 0, 255); // Red if filled, Yellow if not

                // Store and Visualize
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                const radius = (rect.width + rect.height) / 4;

                detectedBubbles.push({ x: centerX, y: centerY, r: radius, isFilled });
                cv.circle(bubbleVisual, new cv.Point(centerX, centerY), radius, circleColor, 2);

                mask.delete();
                bubbleData.delete();
            }
        }

        // 3. Display Result
        cv.imshow('canvas-original', bubbleVisual);
        cv.imshow('canvas-grayscale', warpedGray);

        imageDetails.innerText = `Aligned Sheet: ${warped.cols}x${warped.rows}`;
        bubbleCountPill.innerText = `${detectedBubbles.length} bubbles found`;
        bubbleCountPill.style.display = 'block';

        // Cleanup
        src.delete(); gray.delete(); blurred.delete(); edged.delete(); 
        contours.delete(); hierarchy.delete(); largestContour.delete();
        srcCoords.delete(); dstCoords.delete(); M.delete(); 
        warped.delete(); warpedGray.delete(); thresh.delete();
        bContours.delete(); bHierarchy.delete(); bubbleVisual.delete();

        spinner.classList.remove('show');
        setProcessingState(false);
        resultContainer.style.display = 'flex';
        showToast(`Detection Complete! ${detectedBubbles.length} bubbles found.`, 'success');
        resultContainer.scrollIntoView({ behavior: 'smooth' });
        setScannerFrameState('success', true);
        triggerSuccessFeedback();
        scannerStatus = 'ready';
        updateHeaderStatusChip();

        // --- PHASE 3: MAPPING TO QUESTIONS ---
        const mapped = mapResultsToQuestions(studentId);
        const resultJson = {
            studentId,
            capturedAt: new Date().toISOString(),
            bubblesDetected: detectedBubbles.length,
            answers: mapped?.answers || {},
            raw: {
                invalidCount: mapped?.invalidCount ?? 0,
                notAttemptedCount: mapped?.notAttemptedCount ?? 0
            }
        };

        // Expose result for integrations / automation
        window.omrLastResult = resultJson;
        console.log('OMR_RESULT_JSON', JSON.stringify(resultJson));

        console.log('Detected Bubbles Array:', detectedBubbles);
        console.log('Final Student Answers:', studentAnswers);

    } catch (err) {
        console.error('Processing Error:', err);
        spinner.classList.remove('show');
        setProcessingState(false);
        scannerStatus = 'error';
        updateHeaderStatusChip();
        setScannerFrameState('error', true);
        setTimeout(() => {
            scannerStatus = 'ready';
            updateHeaderStatusChip();
        }, 2000);
        
        if (err.message === 'SHEET_NOT_FOUND') {
            showToast('Sheet edges not detected. Please retake photo with better lighting.', 'error');
        } else {
            showToast('Image could not be read. Please try again.', 'error');
        }

        if (src) src.delete(); if (gray) gray.delete(); 
        if (blurred) blurred.delete(); if (edged) edged.delete();
        if (contours) contours.delete(); if (hierarchy) hierarchy.delete();
    }
}

function mapResultsToQuestions(studentId) {
    if (detectedBubbles.length === 0) return;

    const options = ['A', 'B', 'C', 'D'];
    studentAnswers = {};

    // 1. Sort bubbles Top-to-Bottom (Y), then Left-to-Right (X)
    let sorted = [...detectedBubbles].sort((a, b) => {
        if (Math.abs(a.y - b.y) < 15) { // Threshold for "same row"
            return a.x - b.x;
        }
        return a.y - b.y;
    });

    // 2. Group into Rows
    const rows = [];
    let currentRow = [];
    
    sorted.forEach((bubble, idx) => {
        if (idx === 0) {
            currentRow.push(bubble);
        } else {
            const prev = sorted[idx - 1];
            if (Math.abs(bubble.y - prev.y) < 15) {
                currentRow.push(bubble);
            } else {
                // Row finished. Sort by X to be sure
                currentRow.sort((a, b) => a.x - b.x);
                rows.push(currentRow);
                currentRow = [bubble];
            }
        }
    });
    if (currentRow.length > 0) {
        currentRow.sort((a, b) => a.x - b.x);
        rows.push(currentRow);
    }

    // 3. Map each row to a Question
    let invalidCount = 0;
    let notAttemptedCount = 0;

    rows.forEach((rowBubbles, rowIdx) => {
        const questionNum = rowIdx + 1;
        
        // Find all bubbles that are filled in this row
        const filledIndices = rowBubbles
            .map((b, i) => (b.isFilled ? i : null))
            .filter(i => i !== null);

        let result = "";
        if (filledIndices.length === 0) {
            result = "Not Attempted";
            notAttemptedCount++;
        } else if (filledIndices.length > 1) {
            result = "Invalid";
            invalidCount++;
        } else {
            // Check if we have standard 4 options
            const index = filledIndices[0];
            result = options[index] || `Option ${index + 1}`;
        }
        
        studentAnswers[questionNum] = result;
    });

    displayMappedAnswers();
    calculateAndShowResults(studentId);

    return {
        answers: { ...studentAnswers },
        invalidCount,
        notAttemptedCount
    };
}

function displayMappedAnswers() {
    const container = document.getElementById('results-mapping');
    const list = document.getElementById('answers-list');
    
    list.innerHTML = '';
    
    Object.entries(studentAnswers).forEach(([q, ans]) => {
        const item = document.createElement('div');
        item.className = 'answer-item';
        
        let statusClass = '';
        if (ans === 'Invalid') statusClass = 'invalid';
        if (ans === 'Not Attempted') statusClass = 'not-attempted';

        item.innerHTML = `
            <span class="ans-q">Q${q}:</span>
            <span class="ans-val ${statusClass}">${ans}</span>
        `;
        list.appendChild(item);
    });

    container.style.display = 'block';
}

function calculateAndShowResults(studentId) {
    const answerKey = JSON.parse(localStorage.getItem('omr_answer_key')) || {};
    const totalQuestions = Object.keys(answerKey).length;
    
    if (totalQuestions === 0) {
        showToast('Please set an Answer Key in Settings first!', 'error');
        return;
    }

    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;
    const reportData = [];

    for (let i = 1; i <= totalQuestions; i++) {
        const studentAns = studentAnswers[i] || "Not Attempted";
        const correctAns = answerKey[i];
        
        let status = 'wrong';
        if (studentAns === correctAns) {
            status = 'correct';
            correctCount++;
        } else if (studentAns === 'Not Attempted') {
            status = 'blank';
            unattemptedCount++;
        } else {
            wrongCount++;
        }

        reportData.push({ q: i, student: studentAns, correct: correctAns, status });
    }

    const scorePercent = Math.round((correctCount / totalQuestions) * 100);
    
    // SAVE TO INDEXEDDB
    dbSaveResult({
        studentId,
        totalQuestions,
        correctAnswers: correctCount,
        wrongAnswers: wrongCount,
        notAttempted: unattemptedCount,
        scorePercentage: scorePercent,
        detailedAnswers: reportData
    });

    // Provide multi-sequence haptic feedback
    if (navigator.vibrate) {
        navigator.vibrate([100, 30, 100, 30, 200]);
    }

    // Switch to results tab
    switchTab('results');
    
    // Render the report
    renderResultsReport(studentId, scorePercent, correctCount, wrongCount, unattemptedCount, reportData);
}

function renderResultsReport(studentId, percent, correct, wrong, blank, data) {
    const resultsTarget = document.getElementById('results-target');
    const isPass = percent >= 50;
    
    // SVG Progress Logic
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    if (!resultsTarget) return;
    resultsTarget.innerHTML = `
        <div class="result-card glass">
            <div class="report-header">
                <div style="display: flex; justify-content: space-between; align-items: start; width: 100%; margin-bottom: 1.5rem;">
                    <div>
                        <h2 class="glow-text">SYSTEM://RESULT_NODE</h2>
                        <span class="student-id-display">${studentId}</span>
                    </div>
                    <button class="btn-icon" onclick="window.print()" title="Print Result">
                        <i data-lucide="printer"></i>
                    </button>
                </div>
            </div>

            <div class="score-circle-container">
                <svg class="score-svg" width="180" height="180" viewBox="0 0 180 180">
                    <circle class="score-bg" cx="90" cy="90" r="${radius}"></circle>
                    <circle class="score-bar" cx="90" cy="90" r="${radius}" 
                            style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${circumference};"></circle>
                </svg>
                <div class="score-content">
                    <span class="score-num glow-text">${percent}%</span>
                    <span class="score-label">VECTOR_SCORE</span>
                </div>
            </div>

            <div class="pf-badge ${isPass ? 'pass' : 'fail'}">${isPass ? 'SYSTEM_PASS' : 'SYSTEM_FAIL'}</div>

            <div class="stats-row" style="margin-bottom: 1.5rem;">
                <div class="stat-card glass">
                    <span class="stat-val" style="color: var(--success)">${correct}</span>
                    <span class="stat-label">CORRECT</span>
                </div>
                <div class="stat-card glass">
                    <span class="stat-val" style="color: var(--primary)">${wrong}</span>
                    <span class="stat-label">FAILED</span>
                </div>
                <div class="stat-card glass">
                    <span class="stat-val" style="color: var(--text-muted)">${blank}</span>
                    <span class="stat-label">SKIPPED</span>
                </div>
            </div>

            <button id="scan-next-btn" class="btn-cyber-primary btn-full">SCAN_NEXT_NODE <i data-lucide="zap"></i></button>

            <div class="report-table-container" style="margin-top: 2rem;">
                <table class="report-table">
                    <thead>
                        <tr style="text-align: left; opacity: 0.6; font-size: 0.7rem;">
                            <th style="padding: 0.5rem;">Q_ID</th>
                            <th style="padding: 0.5rem;">DATA</th>
                            <th style="padding: 0.5rem;">KEY</th>
                            <th style="padding: 0.5rem;">STAT</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(row => `
                            <tr class="${row.status === 'correct' ? 'report-row-correct' : 'report-row-wrong'}">
                                <td>${row.q}</td>
                                <td>${row.student}</td>
                                <td>${row.correct}</td>
                                <td>
                                    <i class="status-icon" style="color: var(--${row.status === 'correct' ? 'success' : 'primary'})"
                                       data-lucide="${row.status === 'correct' ? 'check-circle' : 'shield-alert'}"></i>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Trigger SVG animation after a short delay
    setTimeout(() => {
        const progressCircle = resultsTarget.querySelector('.score-bar');
        if (progressCircle) {
            progressCircle.style.strokeDashoffset = offset;
        }
    }, 100);

    // Initialize icons in the table
    lucide.createIcons();

    // Scan next student button
    const nextBtn = document.getElementById('scan-next-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            resetScanner();
            studentIdInput.value = '';
            switchTab('scan');
        });
    }

    // Refresh list (in case record was newly saved)
    renderPastScansList();
}

async function renderAnalytics() {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    try {
        const records = await dbGetAllResults();
        if (records.length === 0) {
            container.innerHTML = `<p class="date-subtext">No historical data available for vector mapping.</p>`;
            return;
        }

        // Calculate trends (last 5 scores)
        const recentScores = records.slice(-5).map(r => r.scorePercentage);
        const avgScore = Math.round(records.reduce((acc, r) => acc + r.scorePercentage, 0) / records.length);
        const passRate = Math.round((records.filter(r => r.scorePercentage >= 50).length / records.length) * 100);

        container.innerHTML = `
            <div class="stats-row" style="grid-template-columns: 1fr 1fr;">
                 <div class="stat-card glass">
                    <span class="stat-val" style="color: var(--success)">${passRate}%</span>
                    <span class="stat-label">OVERALL_PASS_RATE</span>
                </div>
                <div class="stat-card glass">
                    <span class="stat-val">${avgScore}%</span>
                    <span class="stat-label">AVERAGE_YIELD</span>
                </div>
            </div>
            <div class="preview-container glass active" style="padding: 1rem; margin-top: 1rem;">
                <div class="canvas-label">// RECENT_GRADIENT_TRAJECTORY</div>
                <div style="display: flex; align-items: flex-end; gap: 4px; height: 100px; margin-top: 1rem;">
                    ${recentScores.map(score => `
                        <div style="flex: 1; background: var(--primary); height: ${score}%; opacity: ${score / 100}; border-radius: 4px; box-shadow: 0 0 10px var(--primary-glow);"></div>
                    `).join('')}
                </div>
            </div>
        `;
    } catch (err) {
        console.error('Analytics Error:', err);
    }
}

// History UI Logic
const historyModal = document.getElementById('history-modal');
const viewHistoryBtn = document.getElementById('view-history-btn');
const closeHistoryBtn = document.getElementById('close-history');
const printHistoryBtn = document.getElementById('print-history-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const historyContainer = document.getElementById('history-container');

if (viewHistoryBtn) {
    viewHistoryBtn.addEventListener('click', async () => {
        await renderHistory();
        historyModal.classList.add('active');
    });
}

if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
        historyModal.classList.remove('active');
    });
}

if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportResultsToCSV);
}

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearAllRecords);
}
if (printHistoryBtn) {
    printHistoryBtn.addEventListener('click', () => {
        // We highlight the modal content for printing
        window.print();
    });
}

async function exportResultsToCSV() {
    try {
        const records = await dbGetAllResults();
        if (records.length === 0) return showToast('No records to export', 'error');

        const headers = ["Student ID", "Date", "Total Q", "Correct", "Wrong", "Blank", "Score%", "Status"];
        const csvRows = [headers.join(",")];

        records.forEach(r => {
            const date = new Date(r.scanDate).toLocaleDateString().replace(/,/g, '');
            const status = r.scorePercentage >= 50 ? "PASS" : "FAIL";
            const row = [
                r.studentId,
                date,
                r.totalQuestions,
                r.correctAnswers,
                r.wrongAnswers,
                r.notAttempted,
                `${r.scorePercentage}%`,
                status
            ];
            csvRows.push(row.join(","));
        });

        const csvString = csvRows.join("\n");
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `omr_results_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('CSV Exported Successfully');
    } catch (err) {
        showToast('CSV Export Failed', 'error');
    }
}

async function clearAllRecords() {
    if (!confirm('Are you sure? This will delete all saved results permanently.')) return;

    try {
        const transaction = db.transaction(['exam_results'], 'readwrite');
        const store = transaction.objectStore('exam_results');
        const request = store.clear();

        request.onsuccess = () => {
            renderHistory();
            showToast('All records deleted', 'success');
        };
    } catch (err) {
        showToast('Failed to clear records', 'error');
    }
}

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    if (e.target === historyModal) {
        historyModal.classList.remove('active');
    }
});

async function renderHistory() {
    try {
        const records = await dbGetAllResults();
        
        if (records.length === 0) {
            historyContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No records found.</p>';
            return;
        }

        // Sort by date newest first
        records.sort((a, b) => new Date(b.scanDate) - new Date(a.scanDate));

        historyContainer.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Student ID</th>
                        <th>Scan Date</th>
                        <th>Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                        <tr>
                            <td><strong>${r.studentId}</strong></td>
                            <td>
                                <span class="history-date">${new Date(r.scanDate).toLocaleDateString()}</span>
                                <span class="history-date">${new Date(r.scanDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </td>
                            <td><span class="history-score">${r.scorePercentage}%</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('History Error:', err);
        historyContainer.innerHTML = '<p style="color: red; padding: 1rem;">Failed to load records.</p>';
    }
}
