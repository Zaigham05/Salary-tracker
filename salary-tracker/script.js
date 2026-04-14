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
let recoveryPhrase = localStorage.getItem('recoveryPhrase') || '';
let currentPIN = '';
let isLocked = true;
let isEditing = null; 
let activeDashTab = 'analytics';
let isSyncing = false;

// --- DOM CACHE ---
let el = {}; 

function initDomReferences() {
    const ids = [
        'cloud-sync-indicator', 'current-date', 'view-title', 'salary-table-body',
        'salary-total-net', 'salary-total-ded', 'salary-avg-net', 'add-salary-btn',
        'sal-year-filter', 'sal-month-filter', 'vault-lock', 'cloud-status-text',
        'status-fill', 'pin-display', 'user-handle', 'user-avatar', 'salary-modal',
        'salary-form', 'close-salary-modal', 'fund-modal', 'fund-form', 'add-fund-btn',
        'close-fund-modal', 'security-modal', 'close-security-modal', 'security-form',
        'security-error', 'audit-modal', 'close-audit-modal', 'audit-list', 'vault-msg',
        'yearly-summary-modal', 'recovery-modal', 'import-salary-csv', 'export-salary-csv',
        'export-audit-csv', 'export-funds-only-csv'
    ];
    ids.forEach(id => { el[id] = document.getElementById(id); });
}

// --- INITIALIZATION ---
function startHub() {
    initDomReferences();
    initKeypad();
    initIdentity();
    initTheme();
    setupEventListeners();
    if (!isLocked && el['vault-lock']) el['vault-lock'].style.display = 'none';
    renderSalaryView();
    fetchCloudData();
}

// --- VIEW NAVIGATION ---
function showView(viewName) {
    const views = document.querySelectorAll('.app-view');
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`${viewName}-view`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick')?.includes(viewName)) item.classList.add('active');
        else item.classList.remove('active');
    });
}

function switchDashboardTab(tabId) {
    activeDashTab = tabId;
    document.querySelectorAll('.dash-tab').forEach(tab => {
        if (tab.dataset.tab === tabId) tab.classList.add('active');
        else tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === `tab-${tabId}`) pane.classList.add('active');
        else pane.classList.remove('active');
    });
    if (tabId === 'analytics') initSalaryChart();
}

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
        if (data.adjustments) { adjustmentRecords = data.adjustments; localStorage.setItem('adjustmentRecords', JSON.stringify(adjustmentRecords)); }
        renderSalaryView();
        updateStatusText('ONLINE');
    } catch (err) { updateStatusText('OFFLINE'); } finally { setSyncing(false); }
}

async function syncWithSheets(action, table, data) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    try {
        await fetch(GOOGLE_SHEET_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, table, data }) });
        return true;
    } catch (err) { return false; }
}

// --- CRUD OPERATIONS ---
async function deleteSalaryRecord(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    if (confirm(`CRITICAL: Permanently delete ${formatMonth(rec.month)} record?`)) {
        salaryRecords = salaryRecords.filter(r => r.id !== id);
        if (!deletedIds.includes(id)) { deletedIds.push(id); localStorage.setItem('deletedIds', JSON.stringify(deletedIds)); }
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        renderSalaryView();
        showNotification('Purging cloud...', 'success');
        await syncWithSheets('deleteSalary', 'salary_records', id);
        showNotification('Cloud Data Purged!', 'success');
    }
}

function restoreData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.salaryRecords) {
                salaryRecords = data.salaryRecords;
                localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
                showNotification('Restore Complete!', 'success');
                renderSalaryView();
            }
        } catch (err) { showNotification('Invalid Backup File', 'error'); }
    };
    reader.readAsText(file);
}

// --- CSV UPLOAD/EXPORT LOGIC ---
function importSalaryCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const rows = e.target.result.split('\n').filter(r => r.trim());
        const imported = [];
        for (let i = 1; i < rows.length; i++) { // Skip header
            const cols = rows[i].split(',').map(c => c.trim());
            if (cols.length < 5) continue;
            const rec = {
                id: Math.random().toString(36).substr(2, 9),
                month: cols[0],
                baseSalary: +cols[1] || 0,
                netPayable: +cols[2] || 0,
                date: new Date().toISOString(),
                totalDays: 26, workingDays: 26, allowance: 0, pfDeduction: 0, eobiDeduction: 0, incomeTax: 0, shortTimeAmount: 0, overTimeAmount: 0, withoutPay: 0, otherDeductions: 0, grossSalary: +cols[1] || 0, overAllDeduction: 0, remarks: 'CSV Import'
            };
            imported.push(rec);
            await syncWithSheets('saveSalary', 'salary_records', rec);
        }
        salaryRecords = [...salaryRecords, ...imported];
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        renderSalaryView();
        showNotification(`${imported.length} Records Imported!`, 'success');
    };
    reader.readAsText(file);
}

function exportSalaryToCSV() {
    let csv = "Month,Base Salary,Total Days,OT/ST,Deductions,Gross Salary,Net Payable,Remarks\n";
    salaryRecords.forEach(r => {
        csv += `${formatMonth(r.month)},${r.baseSalary},${r.workingDays},${r.overTimeAmount},${r.overAllDeduction},${r.grossSalary},${r.netPayable},"${r.remarks || ''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `salary_records_export.csv`; a.click();
}

// --- UI RENDERING ---
function renderSalaryTable() {
    if (!el['salary-table-body']) return;
    el['salary-table-body'].innerHTML = '';
    const sorted = [...salaryRecords].sort((a,b)=>new Date(a.date)-new Date(b.date));
    sorted.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="sticky-col" style="font-weight: 600; color: var(--primary);">${formatMonth(item.month)}</td><td>${CURRENCY}${item.baseSalary.toLocaleString()}</td><td>${item.totalDays}/${item.workingDays || item.totalDays}</td><td>${CURRENCY}${(item.shortTimeAmount || 0).toLocaleString()} / ${CURRENCY}${(item.overTimeAmount || 0).toLocaleString()}</td><td>${CURRENCY}${(item.pfDeduction + item.eobiDeduction).toLocaleString()}</td><td>${CURRENCY}${(item.incomeTax || 0).toLocaleString()}</td><td class="text-danger">${CURRENCY}${((item.otherDeductions || 0) + (item.withoutPay || 0)).toLocaleString()}</td><td>${CURRENCY}${item.grossSalary.toLocaleString()}</td><td class="text-success" style="font-weight: 700;">${CURRENCY}${item.netPayable.toLocaleString()}</td><td class="compact-cell">${item.remarks || '-'}</td><td class="action-td"><button class="icon-btn" onclick="editSalaryRecord('${item.id}')"><i data-lucide="edit-3"></i></button><button class="icon-btn" onclick="printSalarySlip('${item.id}')"><i data-lucide="printer"></i></button><button class="icon-btn delete-btn" onclick="deleteSalaryRecord('${item.id}')"><i data-lucide="trash-2"></i></button></td>`;
        el['salary-table-body'].appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
}

function setupEventListeners() {
    if (el['import-salary-csv']) el['import-salary-csv'].onchange = importSalaryCSV;
    if (el['export-salary-csv']) el['export-salary-csv'].onclick = exportSalaryToCSV;
    if (el['add-salary-btn']) el['add-salary-btn'].onclick = () => { isEditing = null; el['salary-form'].reset(); el['salary-modal'].style.display = 'flex'; };
    if (el['close-salary-modal']) el['close-salary-modal'].onclick = () => el['salary-modal'].style.display = 'none';
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
            el['salary-modal'].style.display = 'none'; renderSalaryView();
            await syncWithSheets('saveSalary', 'salary_records', rec);
        };
    }
}

// --- BASIC PLACEHOLDERS TO PREVENT CRASH ---
function renderSalaryView() { renderSalaryTable(); }
function initIdentity() { const name = localStorage.getItem('userName') || 'Mr Hassan'; if (el['user-handle']) el['user-handle'].innerText = name; }
function initKeypad() { document.querySelectorAll('.pin-btn').forEach(b => b.onclick = () => { currentPIN += b.textContent; if (currentPIN === vaultPIN) unlockVault(); }); }
function unlockVault() { isLocked = false; if (el['vault-lock']) el['vault-lock'].style.display = 'none'; renderSalaryView(); }
function updateStatusText(t) { if (el['cloud-status-text']) el['cloud-status-text'].innerText = t; }
function initTheme() {}
function setSyncing(s) { if (el['cloud-sync-indicator']) el['cloud-sync-indicator'].style.opacity = s ? '1' : '0.3'; }
function showNotification(m, t) { alert(m); }
function initSalaryChart() {}

document.addEventListener('DOMContentLoaded', startHub);
