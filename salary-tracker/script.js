// --- GLOBAL CONFIGURATION ---
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxCupu05McUU1a3Aizzes3DOM2ryX4A966TlKkC7S2xZ88cu4avAPuN4XEX9huo7hgxUw/exec'; 

// --- STATE MANAGEMENT ---
let salaryRecords = JSON.parse(localStorage.getItem('salaryRecords')) || [];
let adjustmentRecords = JSON.parse(localStorage.getItem('adjustmentRecords')) || [];
let auditLog = JSON.parse(localStorage.getItem('auditLog')) || [];
let deletedIds = JSON.parse(localStorage.getItem('deletedIds')) || [];
const CURRENCY = 'Rs.';
let salaryChartInstance = null;
let salYearFilter = 'all';
let salMonthFilter = 'all';
let vaultPIN = localStorage.getItem('vaultPIN') || '2222';
let currentPIN = '';
let isLocked = true;
let isEditing = null; 
let isSyncing = false;

// --- DOM CACHE ---
let el = {}; 

function initDomReferences() {
    const ids = [
        'cloud-sync-indicator', 'current-date', 'view-title', 'salary-table-body',
        'salary-total-net', 'salary-total-ded', 'salary-avg-net', 'add-salary-btn',
        'sal-year-filter', 'sal-month-filter', 'vault-lock', 'cloud-status-text',
        'status-fill', 'pin-display', 'salary-modal', 'salary-form', 'fund-modal',
        'fund-form', 'security-modal', 'yearly-summary-modal', 'recovery-modal',
        'import-salary-csv', 'export-salary-csv', 'import-json'
    ];
    ids.forEach(id => { el[id] = document.getElementById(id); });
}

// --- INITIALIZATION ---
function startHub() {
    initDomReferences();
    initKeypad();
    initIdentity();
    setupEventListeners();
    if (!isLocked && el['vault-lock']) el['vault-lock'].style.display = 'none';
    renderSalaryView();
    fetchCloudData();
}

// --- VIEW NAVIGATION (GLOBAL) ---
window.showView = function(viewName) {
    const views = document.querySelectorAll('.app-view');
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`${viewName}-view`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick')?.includes(viewName)) item.classList.add('active');
        else item.classList.remove('active');
    });
};

window.switchDashboardTab = function(tabId) {
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
    if (tabId === 'analytics') initSalaryChart();
};

// --- DATA HANDLING ---
function formatMonth(monthStr) {
    if (!monthStr || monthStr === '-') return '-';
    if (/^[a-zA-Z]{3}-\d{2}$/.test(monthStr)) return monthStr;
    const date = new Date(monthStr);
    if (isNaN(date.getTime())) return monthStr;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]}-${date.getFullYear().toString().slice(-2)}`;
}

async function fetchCloudData() {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    updateStatusText('CONNECTING...');
    setSyncing(true);
    try {
        const response = await fetch(`${GOOGLE_SHEET_URL}?action=fetchAll`);
        const data = await response.json();
        if (data.salaries) {
            const cloudIds = data.salaries.map(r => r.id);
            deletedIds = deletedIds.filter(id => cloudIds.includes(id));
            localStorage.setItem('deletedIds', JSON.stringify(deletedIds));
            salaryRecords = data.salaries.filter(r => !deletedIds.includes(r.id));
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        }
        renderSalaryView();
        updateStatusText('ONLINE');
    } catch (err) { updateStatusText('OFFLINE'); } finally { setSyncing(false); }
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
    } catch (err) { return false; }
}

// --- CRUD OPERATIONS (GLOBAL) ---
window.deleteSalaryRecord = async function(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    if (confirm(`CRITICAL: Permanently delete ${formatMonth(rec.month)} record?`)) {
        salaryRecords = salaryRecords.filter(r => r.id !== id);
        if (!deletedIds.includes(id)) { deletedIds.push(id); localStorage.setItem('deletedIds', JSON.stringify(deletedIds)); }
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        renderSalaryView();
        await syncWithSheets('deleteSalary', 'salary_records', id);
        showNotification('Data Purged!', 'success');
    }
};

window.editSalaryRecord = function(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    isEditing = id;
    document.getElementById('sal-month').value = rec.month;
    document.getElementById('sal-base').value = rec.baseSalary;
    document.getElementById('sal-tot-days').value = rec.totalDays;
    document.getElementById('sal-absent').value = rec.totalDays - (rec.workingDays || rec.totalDays);
    document.getElementById('sal-st-amount').value = rec.shortTimeAmount || 0;
    document.getElementById('sal-ot-amount').value = rec.overTimeAmount || 0;
    document.getElementById('sal-pf').value = rec.pfDeduction || 0;
    document.getElementById('sal-eobi').value = rec.eobiDeduction || 0;
    document.getElementById('sal-tax').value = rec.incomeTax || 0;
    document.getElementById('sal-wop').value = rec.withoutPay || 0;
    document.getElementById('sal-other-ded').value = rec.otherDeductions || 0;
    document.getElementById('sal-allowance').value = rec.allowance || 0;
    document.getElementById('sal-remarks').value = rec.remarks || '';
    if (el['salary-modal']) el['salary-modal'].style.display = 'flex';
};

window.restoreData = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.salaryRecords) {
                salaryRecords = data.salaryRecords;
                localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
                renderSalaryView();
                showNotification('Hub Restored!', 'success');
            }
        } catch (err) { showNotification('Invalid Backup', 'error'); }
    };
    reader.readAsText(file);
};

window.printSalarySlip = function(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Slip - ${formatMonth(rec.month)}</title><style>body{font-family:sans-serif;padding:40px;}table{width:100%;border-collapse:collapse;}td{padding:10px;border-bottom:1px solid #eee;}.total{font-weight:700;color:#10b981;}</style></head><body><h2>HASSAN HUB | SALARY SLIP</h2><p>Period: ${formatMonth(rec.month)}</p><table><tr><td>Base</td><td>${CURRENCY}${rec.baseSalary.toLocaleString()}</td></tr><tr><td>Deductions</td><td style="color:red;">-${CURRENCY}${rec.overAllDeduction.toLocaleString()}</td></tr><tr class="total"><td>NET PAYABLE</td><td>${CURRENCY}${rec.netPayable.toLocaleString()}</td></tr></table><script>window.print();<\/script></body></html>`);
    w.document.close();
};

window.openSecurityModal = () => el['security-modal'].style.display = 'flex';
window.openAuditLog = () => el['audit-modal'].style.display = 'flex';
window.openYearlySummary = () => { el['yearly-summary-modal'].style.display = 'flex'; updateYearlySummary(); };
window.backupData = () => {
    const data = JSON.stringify({ salaryRecords });
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hub_backup.json'; a.click();
};

// --- CORE UTILS ---
function renderSalaryView() {
    if (!el['salary-table-body']) return;
    el['salary-table-body'].innerHTML = '';
    const sorted = [...salaryRecords].sort((a,b)=>new Date(a.date)-new Date(b.date));
    sorted.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="sticky-col" style="font-weight: 600; color: var(--primary);">${formatMonth(item.month)}</td><td>${CURRENCY}${item.baseSalary.toLocaleString()}</td><td>${item.totalDays}/${item.workingDays || item.totalDays}</td><td>${CURRENCY}${(item.shortTimeAmount || 0).toLocaleString()} / ${CURRENCY}${(item.overTimeAmount || 0).toLocaleString()}</td><td>${CURRENCY}${(item.pfDeduction + item.eobiDeduction).toLocaleString()}</td><td>${CURRENCY}${(item.incomeTax || 0).toLocaleString()}</td><td class="text-danger">${CURRENCY}${((item.otherDeductions || 0) + (item.withoutPay || 0)).toLocaleString()}</td><td>${CURRENCY}${item.grossSalary.toLocaleString()}</td><td class="text-success" style="font-weight: 700;">${CURRENCY}${item.netPayable.toLocaleString()}</td><td>${item.remarks || '-'}</td><td class="action-td"><button class="icon-btn" onclick="editSalaryRecord('${item.id}')"><i data-lucide="edit-3"></i></button><button class="icon-btn" onclick="printSalarySlip('${item.id}')"><i data-lucide="printer"></i></button><button class="icon-btn delete-btn" onclick="deleteSalaryRecord('${item.id}')"><i data-lucide="trash-2"></i></button></td>`;
        el['salary-table-body'].appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
    updateSummaryCards();
}

function updateSummaryCards() {
    const total = salaryRecords.reduce((acc, r) => acc + r.netPayable, 0);
    if (el['salary-total-net']) el['salary-total-net'].innerText = `${CURRENCY}${total.toLocaleString()}`;
    const rank = total > 500000 ? "ELITE ARCHITECT" : total > 200000 ? "SENIOR ANALYST" : "HUB JUNIOR";
    const label = document.querySelector('.status-label');
    if (label) label.innerText = rank;
}

function initKeypad() {
    const pinBtns = document.querySelectorAll('.pin-btn');
    pinBtns.forEach(btn => {
        btn.onclick = () => {
            const val = btn.textContent.trim();
            if (val === 'C' || btn.id === 'clear-pin') { currentPIN = ''; }
            else if (btn.id === 'enter-pin' || val === 'L') { if (currentPIN === vaultPIN) unlockVault(); else currentPIN = ''; }
            else if (/^\d$/.test(val)) { currentPIN += val; }
            if (el['pin-display']) el['pin-display'].innerHTML = '●'.repeat(currentPIN.length) + '○'.repeat(4 - currentPIN.length);
        };
    });
}

function unlockVault() { isLocked = false; if (el['vault-lock']) el['vault-lock'].style.display = 'none'; renderSalaryView(); }
function updateStatusText(t) { if (el['cloud-status-text']) el['cloud-status-text'].innerText = t; }
function initIdentity() { if (el['user-handle']) el['user-handle'].innerText = localStorage.getItem('userName') || 'Mr Hassan'; }
function initTheme() { document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'default'); }
function setSyncing(s) { if (el['cloud-sync-indicator']) el['cloud-sync-indicator'].style.opacity = s ? '1' : '0.3'; }
function showNotification(m, t) { alert(m); }
function initSalaryChart() {}

function setupEventListeners() {
    if (el['salary-form']) {
        el['salary-form'].onsubmit = async (e) => {
            e.preventDefault();
            const rec = { id: isEditing || Math.random().toString(36).substr(2,9), month: document.getElementById('sal-month').value, date: new Date().toISOString(), baseSalary: +document.getElementById('sal-base').value, totalDays: +document.getElementById('sal-tot-days').value, workingDays: (+document.getElementById('sal-tot-days').value) - (+document.getElementById('sal-absent').value), allowance: +document.getElementById('sal-allowance').value || 0, pfDeduction: +document.getElementById('sal-pf').value || 0, eobiDeduction: +document.getElementById('sal-eobi').value || 0, incomeTax: +document.getElementById('sal-tax').value || 0, shortTimeAmount: +document.getElementById('sal-st-amount').value || 0, overTimeAmount: +document.getElementById('sal-ot-amount').value || 0, withoutPay: +document.getElementById('sal-wop').value || 0, otherDeductions: +document.getElementById('sal-other-ded').value || 0, remarks: document.getElementById('sal-remarks').value, grossSalary: 0, overAllDeduction: 0, netPayable: 0 };
            rec.grossSalary = rec.baseSalary + rec.overTimeAmount + rec.allowance;
            rec.overAllDeduction = rec.pfDeduction + rec.eobiDeduction + rec.incomeTax + rec.shortTimeAmount + rec.withoutPay + rec.otherDeductions;
            rec.netPayable = rec.grossSalary - rec.overAllDeduction;
            if (isEditing) { const idx = salaryRecords.findIndex(r => r.id === isEditing); salaryRecords[idx] = rec; }
            else salaryRecords.push(rec);
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
            isEditing = null; el['salary-modal'].style.display = 'none'; renderSalaryView();
            await syncWithSheets('saveSalary', 'salary_records', rec);
        };
    }
}

document.addEventListener('DOMContentLoaded', startHub);
