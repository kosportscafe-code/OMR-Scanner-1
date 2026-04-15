// Initialize Lucide Icons
lucide.createIcons();

// State management for Answer Key and OpenCV
let currentAnswerKey = JSON.parse(localStorage.getItem('omr_answer_key')) || {};
let isCvReady = false;
let detectedBubbles = []; // Array of {x, y, radius, isFilled}
let studentAnswers = {}; // Final mapping: { 1: "A", 2: "C" }
let db = null;

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
    };
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

        document.getElementById('stat-total-scans').innerText = totalScans;
        document.getElementById('stat-avg-score').innerText = `${avgScore}%`;
        document.getElementById('stat-batches').innerText = uniqueStudents;
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
    if (!item) return;

    // Update active nav item
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');
    
    // Update active tab content
    tabContents.forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === `tab-${tabId}`) {
            tab.classList.add('active');
        }
    });

    if (tabId === 'settings') {
        initSettingsTab();
    } else if (tabId === 'analytics') {
        renderAnalytics();
    } else if (tabId === 'scan') {
        updateDashboardStats();
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
});

// Settings Tab Logic
function initSettingsTab() {
    const settingsContainer = document.getElementById('tab-settings');
    if (!settingsContainer) return;

    // Build the form structure if it doesn't exist
    settingsContainer.innerHTML = `
        <div class="card">
            <div class="settings-form">
                <h2>Answer Key Setup</h2>
                <div class="input-group">
                    <label for="question-count">How many questions?</label>
                    <input type="number" id="question-count" min="1" max="100" placeholder="e.g. 20">
                </div>
                
                <div id="questions-container" class="question-rows">
                    <!-- Dynamic rows will appear here -->
                </div>

                <button id="save-key" class="btn-primary">Save Answer Key</button>
            </div>
        </div>
    `;

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
    const qRows = document.querySelectorAll('.question-row');
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
const imagePreview = document.getElementById('image-preview');
const previewContainer = document.getElementById('preview-container');
const scanActions = document.getElementById('scan-actions');
const finalScanBtn = document.getElementById('final-scan-btn');
const retakeBtn = document.getElementById('retake-btn');
const studentIdInput = document.getElementById('student-id');

if (scanTrigger && cameraInput) {
    // Open camera/file picker when scan card is clicked
    scanTrigger.addEventListener('click', () => {
        cameraInput.click();
    });

    // Handle file selection
    cameraInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                imagePreview.src = event.target.result;
                previewContainer.classList.add('active');
                scanActions.classList.add('active');
                
                // Optional: Scroll to preview
                previewContainer.scrollIntoView({ behavior: 'smooth' });
            };
            reader.readAsDataURL(file);
        }
    });
}

if (retakeBtn) {
    retakeBtn.addEventListener('click', () => {
        resetScanner();
    });
}

function resetScanner() {
    // Clear inputs and images
    cameraInput.value = '';
    imagePreview.src = '';
    previewContainer.classList.remove('active');
    scanActions.classList.remove('active');
    
    // Hide results
    document.getElementById('result-container').style.display = 'none';
    document.getElementById('spinner').classList.remove('show');
    document.getElementById('results-mapping').style.display = 'none';
    
    // Reset state
    detectedBubbles = [];
    studentAnswers = {};

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Scanner Reset', 'success');
}

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
        resultContainer.style.display = 'flex';
        showToast(`Detection Complete! ${detectedBubbles.length} bubbles found.`, 'success');
        resultContainer.scrollIntoView({ behavior: 'smooth' });

        // --- PHASE 3: MAPPING TO QUESTIONS ---
        mapResultsToQuestions(studentId);

        console.log('Detected Bubbles Array:', detectedBubbles);
        console.log('Final Student Answers:', studentAnswers);

    } catch (err) {
        console.error('Processing Error:', err);
        spinner.classList.remove('show');
        
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
    rows.forEach((rowBubbles, rowIdx) => {
        const questionNum = rowIdx + 1;
        
        // Find all bubbles that are filled in this row
        const filledIndices = rowBubbles
            .map((b, i) => (b.isFilled ? i : null))
            .filter(i => i !== null);

        let result = "";
        if (filledIndices.length === 0) {
            result = "Not Attempted";
        } else if (filledIndices.length > 1) {
            result = "Invalid";
        } else {
            // Check if we have standard 4 options
            const index = filledIndices[0];
            result = options[index] || `Option ${index + 1}`;
        }
        
        studentAnswers[questionNum] = result;
    });

    displayMappedAnswers();
    calculateAndShowResults(studentId);
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
    const resultsTab = document.getElementById('tab-results');
    const isPass = percent >= 50;
    
    // SVG Progress Logic
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    resultsTab.innerHTML = `
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
        const progressCircle = resultsTab.querySelector('.score-bar');
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
