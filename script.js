// Cloud Storage Configuration (Google Sheets)
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxCupu05McUU1a3Aizzes3DOM2ryX4A966TlKkC7S2xZ88cu4avAPuN4XEX9huo7hgxUw/exec'; 

// State Management
let salaryRecords = [];
let adjustmentRecords = [];
let auditLog = [];
const CURRENCY = 'Rs.';
let salaryChartInstance = null;
let breakdownChartInstance = null;
let salYearFilter = 'all';
let salMonthFilter = 'all';
let vaultPIN = localStorage.getItem('vaultPIN') || '2222';
let recoveryPhrase = localStorage.getItem('recoveryPhrase') || '';
let currentPIN = '';
let isLocked = true;
let isEditing = null; 
let activeDashTab = 'analytics';
let isSyncing = false;

// DOM Reference Cache
let el = {}; 

function initDomReferences() {
    const ids = [
        'cloud-sync-indicator', 'current-date', 'view-title', 'salary-table-body',
        'salary-total-net', 'salary-total-ded', 'salary-avg-net', 'add-salary-btn',
        'sal-year-filter', 'sal-month-filter', 'vault-lock', 'cloud-status-text',
        'status-fill', 'pin-display', 'user-handle', 'user-avatar', 'salary-modal',
        'salary-form', 'close-salary-modal', 'fund-modal', 'fund-form', 'add-fund-btn',
        'close-fund-modal', 'security-modal', 'close-security-modal', 'security-form',
        'security-error', 'audit-modal', 'close-audit-modal', 'audit-list', 'vault-msg'
    ];
    ids.forEach(id => {
        el[id] = document.getElementById(id);
    });
}

function setSyncing(state) {
    isSyncing = state;
    if (el['cloud-sync-indicator']) {
        if (state) el['cloud-sync-indicator'].classList.add('syncing');
        else el['cloud-sync-indicator'].classList.remove('syncing');
    }
}

function switchDashboardTab(tabId) {
    activeDashTab = tabId;
    const tabs = document.querySelectorAll('.dash-tab');
    const panes = document.querySelectorAll('.tab-pane');
    
    tabs.forEach(tab => {
        if (tab.dataset.tab === tabId) tab.classList.add('active');
        else tab.classList.remove('active');
    });

    panes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) pane.classList.add('active');
        else pane.classList.remove('active');
    });

    if (tabId === 'analytics' && salaryChartInstance) {
        salaryChartInstance.resize();
    }
    
    if (window.lucide) lucide.createIcons();
}

function initIdentity() {
    const savedName = localStorage.getItem('userName') || 'Mr Hassan';
    if (el['user-handle']) el['user-handle'].innerText = savedName;
    updateAvatar(savedName);
}

function updateAvatar(name) {
    if (el['user-avatar']) {
        el['user-avatar'].src = `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`;
    }
}

// Data Handling logic...
function formatMonth(monthStr) {
    if (!monthStr) return '-';
    // If it's already in MMM-YY format (e.g., Mar-26)
    if (/^[a-zA-Z]{3}-\d{2}$/.test(monthStr)) return monthStr;
    
    // If it's an ISO string or other date format
    const date = new Date(monthStr);
    if (isNaN(date.getTime())) return monthStr;
    
    const mNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const m = mNames[date.getMonth()];
    const y = date.getFullYear().toString().slice(-2);
    return `${m}-${y}`;
}

async function fetchCloudData() {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    setSyncing(true);
    
    const statusText = document.getElementById('cloud-status-text');
    
    try {
        const response = await fetch(`${GOOGLE_SHEET_URL}?action=fetchAll`);
        if (!response.ok) throw new Error('Offline');
        
        const data = await response.json();
        if (data.salaries) salaryRecords = data.salaries;
        if (data.adjustments) adjustmentRecords = data.adjustments;
        if (data.logs) auditLog = data.logs;

        if (statusText) statusText.innerText = 'ONLINE';
        renderSalaryView();
    } catch (err) {
        console.error('Sheets Fetch Error:', err);
        if (statusText) statusText.innerText = 'OFFLINE';
    } finally {
        setSyncing(false);
    }
}

async function syncWithSheets(action, table, data) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    try {
        await fetch(GOOGLE_SHEET_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, table, data })
        });
        return true;
    } catch (err) {
        console.error('Sheets Sync Error:', err);
        return false;
    }
}

async function checkAndSyncData() {
    const hasSynced = localStorage.getItem('hasSyncedToSheets');
    const localSals = JSON.parse(localStorage.getItem('salaryRecords')) || [];
    if (!hasSynced && localSals.length > 0) {
        setSyncing(true);
        try {
            for (const rec of localSals) {
                await syncWithSheets('saveSalary', 'salary_records', rec);
            }
            localStorage.setItem('hasSyncedToSheets', 'true');
        } catch (err) {
            console.error('Migration Error:', err);
        } finally {
            setSyncing(false);
            fetchCloudData();
        }
    } else {
        fetchCloudData();
    }
}

// UI Logic
function renderSalaryView() {
    populateSalaryFilters();
    renderSalaryTable();
    updateSalarySummary();
    initSalaryChart();
    renderExtraFundsList();
}

function populateSalaryFilters() {
    if (!el['sal-year-filter']) return;
    const years = [...new Set(salaryRecords.map(r => {
        const parts = r.month.split('-');
        return parts.length > 1 ? '20' + parts[1] : null;
    }))].filter(y => y).sort();

    const currentYear = el['sal-year-filter'].value;
    el['sal-year-filter'].innerHTML = '<option value="all">All Years</option>';
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.innerText = year;
        el['sal-year-filter'].appendChild(option);
    });
    if (Array.from(el['sal-year-filter'].options).some(o => o.value === currentYear)) {
        el['sal-year-filter'].value = currentYear;
    }
}

function renderSalaryTable() {
    if (!el['salary-table-body']) return;
    el['salary-table-body'].innerHTML = '';
    const filtered = salaryRecords.filter(rec => {
        const matchesYear = salYearFilter === 'all' || rec.month.includes(salYearFilter.slice(-2));
        const matchesMonth = salMonthFilter === 'all' || rec.month.startsWith(salMonthFilter);
        return matchesYear && matchesMonth;
    });
    const sorted = [...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));

    sorted.forEach(item => {
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td class="sticky-col" style="font-weight: 600; color: var(--primary);">${formatMonth(item.month)}</td>
            <td>${CURRENCY}${item.baseSalary.toLocaleString()}</td>
            <td>${item.totalDays}/${item.workingDays}</td>
            <td>${CURRENCY}${(item.shortTimeAmount || 0).toLocaleString()} / ${CURRENCY}${(item.overTimeAmount || 0).toLocaleString()}</td>
            <td>${CURRENCY}${(item.pfDeduction + item.eobiDeduction).toLocaleString()}</td>
            <td>${CURRENCY}${(item.incomeTax || 0).toLocaleString()}</td>
            <td class="text-danger">${CURRENCY}${((item.otherDeductions || 0) + (item.withoutPay || 0)).toLocaleString()}</td>
            <td>${CURRENCY}${item.grossSalary.toLocaleString()}</td>
            <td class="text-success" style="font-weight: 700;">${CURRENCY}${item.netPayable.toLocaleString()}</td>
            <td class="compact-cell" title="${item.remarks || ''}">${item.remarks || '-'}</td>
            <td class="action-td">
                <button class="icon-btn" onclick="editSalaryRecord('${item.id}')"><i data-lucide="edit-3"></i></button>
                <button class="icon-btn" onclick="printSalarySlip('${item.id}')"><i data-lucide="printer"></i></button>
                <button class="icon-btn delete-btn" onclick="deleteSalaryRecord('${item.id}')"><i data-lucide="trash-2"></i></button>
            </td>`;
        el['salary-table-body'].appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
}

function updateSalarySummary() {
    const filtered = salaryRecords.filter(rec => {
        const matchesYear = salYearFilter === 'all' || rec.month.includes(salYearFilter.slice(-2));
        const matchesMonth = salMonthFilter === 'all' || rec.month.startsWith(salMonthFilter);
        return matchesYear && matchesMonth;
    });

    if (filtered.length === 0) {
        if (el['salary-total-net']) el['salary-total-net'].innerText = `${CURRENCY}0`;
        return;
    }

    const totalNet = filtered.reduce((acc, r) => acc + r.netPayable, 0);
    const totalDed = filtered.reduce((acc, r) => acc + r.overAllDeduction, 0);
    const avgNet = totalNet / filtered.length;

    if (el['salary-total-net']) el['salary-total-net'].innerText = `${CURRENCY}${totalNet.toLocaleString()}`;
    if (el['salary-total-ded']) el['salary-total-ded'].innerText = `${CURRENCY}${Math.round(totalDed).toLocaleString()}`;
    if (el['salary-avg-net']) el['salary-avg-net'].innerText = `${CURRENCY}${Math.round(avgNet).toLocaleString()}`;
    
    updateHackerStatus(totalNet);
}

// Chart Logic
function initSalaryChart() {
    const canvas = document.getElementById('salary-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (salaryChartInstance) salaryChartInstance.destroy();

    const sorted = [...salaryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    const labels = sorted.map(r => r.month);
    const netData = sorted.map(r => r.netPayable);

    salaryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{ label: 'Net Payable', data: netData, borderColor: '#10b981', tension: 0.4, fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

// Keypad System
function initKeypad() {
    const pinBtns = document.querySelectorAll('.pin-btn');
    const msg = document.getElementById('vault-msg');
    
    pinBtns.forEach(btn => {
        if (btn.getAttribute('data-listener-attached')) return;
        btn.addEventListener('click', () => {
            const val = btn.textContent.trim();
            if (val === 'C' || btn.id === 'clear-pin') { 
                currentPIN = ''; 
                updatePINDots(); 
                if (msg) msg.innerText = "Enter decryption key to proceed";
                return; 
            }
            if (val === 'L' || btn.id === 'enter-pin') {
                if (currentPIN === vaultPIN) unlockVault();
                else loginFailure();
                return;
            }
            if (/^\d$/.test(val) && currentPIN.length < 16) { 
                currentPIN += val; 
                updatePINDots(); 
            }
        });
        btn.setAttribute('data-listener-attached', 'true');
    });
    updatePINDots();
}

function updatePINDots() {
    const display = document.getElementById('pin-display');
    if (!display) return;
    display.innerHTML = '';
    for (let i = 0; i < currentPIN.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot active';
        display.appendChild(dot);
    }
    if (currentPIN.length === 0) {
        for (let i = 0; i < 4; i++) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            display.appendChild(dot);
        }
    }
}

function unlockVault() {
    isLocked = false;
    if (el['vault-lock']) {
        el['vault-lock'].style.opacity = '0';
        setTimeout(() => {
            el['vault-lock'].style.display = 'none';
            renderSalaryView();
            checkAndSyncData();
        }, 500);
    }
}

function loginFailure() {
    currentPIN = '';
    updatePINDots();
    const msg = document.getElementById('vault-msg');
    if (msg) {
        msg.innerText = "ACCESS DENIED";
        msg.classList.add('shake');
        setTimeout(() => msg.classList.remove('shake'), 500);
    }
}

// Event Listeners
function setupEventListeners() {
    if (el['add-salary-btn']) el['add-salary-btn'].onclick = () => el['salary-modal'].style.display = 'flex';
    if (el['close-salary-modal']) el['close-salary-modal'].onclick = () => el['salary-modal'].style.display = 'none';
    
    if (el['sal-year-filter']) el['sal-year-filter'].onchange = (e) => { salYearFilter = e.target.value; renderSalaryView(); };
    if (el['sal-month-filter']) el['sal-month-filter'].onchange = (e) => { salMonthFilter = e.target.value; renderSalaryView(); };

    if (el['user-handle']) {
        el['user-handle'].onblur = () => {
            const name = el['user-handle'].innerText.trim() || 'Mr Hassan';
            localStorage.setItem('userName', name);
            updateAvatar(name);
        };
    }
}

function updateHackerStatus(total) {
    let rank = "HUB INTERN";
    if (total > 750000) rank = "ELITE ARCHITECT";
    else if (total > 400000) rank = "SENIOR ANALYST";
    else if (total > 150000) rank = "SECURITY SPECIALIST";
    else if (total > 50000) rank = "HUB JUNIOR";

    const label = document.querySelector('.status-label');
    if (label) label.innerText = rank;
}

function initTheme() {
    const t = localStorage.getItem('theme') || 'default';
    document.documentElement.setAttribute('data-theme', t);
}

function renderExtraFundsList() {} // Placeholder
function showNotification(m, t) { alert(m); } // Simple fallback

// THE MASTER BOOT
function startHub() {
    console.log('Hub Core: Booting...');
    initDomReferences();
    initKeypad();
    initIdentity();
    initTheme();
    setupEventListeners();
    
    if (!isLocked && el['vault-lock']) el['vault-lock'].style.display = 'none';
    
    if (el['current-date']) {
        const opt = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        el['current-date'].innerText = new Date().toLocaleDateString('en-US', opt);
    }
    if (window.lucide) lucide.createIcons();
    console.log('Hub Core: Online.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startHub);
} else {
    startHub();
}
