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

// --- DOM CACHE ---
let el = {}; 
function initDomReferences() {
    const ids = [
        'cloud-sync-indicator', 'current-date', 'view-title', 'salary-table-body',
        'salary-total-net', 'salary-total-ded', 'salary-avg-net', 'vault-lock', 
        'cloud-status-text', 'pin-display', 'salary-modal', 'salary-form', 
        'fund-modal', 'fund-form', 'security-modal', 'yearly-summary-modal',
        'breakdown-base', 'breakdown-ot', 'breakdown-pf', 'breakdown-eobi', 
        'breakdown-tax', 'breakdown-st', 'breakdown-avg-ot',
        'confirm-modal', 'confirm-title', 'confirm-msg', 'confirm-ok', 'confirm-cancel'
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
    
    if (isLocked) {
        if (el['vault-lock']) el['vault-lock'].style.display = 'flex';
        const profile = document.querySelector('.user-profile');
        const main = document.querySelector('.main-content');
        const nav = document.querySelector('.nav-menu');
        if (profile) profile.style.display = 'none';
        if (main) main.style.display = 'none';
        if (nav) nav.style.display = 'none';
    } else {
        unlockVault();
    }

    renderSalaryView();
    fetchCloudData();
}

// --- VIEW NAVIGATION ---
window.showView = function(v) {
    if (isLocked) return;
    document.querySelectorAll('.app-view').forEach(view => view.classList.toggle('active', view.id === `${v}-view`));
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('onclick')?.includes(v));
    });
    if (v === 'audit') renderAuditLog();
};

window.switchDashboardTab = function(tabId) {
    document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
    if (tabId === 'analytics') {
        initSalaryChart();
        updateSummaryCards();
    }
};

function unlockVault() {
    isLocked = false;
    if (el['vault-lock']) el['vault-lock'].style.display = 'none';
    const profile = document.querySelector('.user-profile');
    const main = document.querySelector('.main-content');
    const nav = document.querySelector('.nav-menu');
    if (profile) profile.style.display = 'flex';
    if (main) main.style.display = 'block';
    if (nav) nav.style.display = 'flex';
    renderSalaryView();
    window.showNotify('VAULT UNLOCKED: WELCOME BACK', 'success');
}

// --- SEQUENTIAL ID SYSTEM ---
function getNextNumericId() {
    const salMax = salaryRecords.reduce((max, r) => Math.max(max, parseInt(r.id) || 0), 0);
    const adjMax = adjustmentRecords.reduce((max, r) => Math.max(max, parseInt(r.id) || 0), 0);
    return Math.max(salMax, adjMax) + 1;
}

// --- DATA HANDLING ---
function formatMonth(m) {
    if (!m || m === '-') return '-';
    if (/^[a-zA-Z]{3}-\d{2}$/.test(m)) return m;
    const d = new Date(m);
    if (isNaN(d.getTime())) return m;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]}-${d.getFullYear().toString().slice(-2)}`;
}

function isRecordEditable(monthStr) {
    if (!monthStr || monthStr === '-') return true;
    try {
        const parts = monthStr.split('-');
        if (parts.length !== 2) return true;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const recMonth = months.indexOf(parts[0]);
        const recYear = 2000 + parseInt(parts[1]);
        const now = new Date();
        const diff = (now.getFullYear() - recYear) * 12 + (now.getMonth() - recMonth);
        return diff <= 1;
    } catch(e) { return true; }
}

async function fetchCloudData() {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    updateStatusText('CONNECTING...');
    try {
        const response = await fetch(`${GOOGLE_SHEET_URL}?action=fetchAll`);
        const data = await response.json();
        if (data.salaries) {
            salaryRecords = data.salaries.filter(r => !deletedIds.includes(r.id));
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        }
        if (data.adjustments) {
            adjustmentRecords = data.adjustments;
            localStorage.setItem('adjustmentRecords', JSON.stringify(adjustmentRecords));
        }
        if (data.auditLog) {
            auditLog = data.auditLog;
            localStorage.setItem('auditLog', JSON.stringify(auditLog));
        }
        renderSalaryView();
        updateStatusText('ONLINE');
    } catch (e) { updateStatusText('OFFLINE'); }
}

async function syncWithSheets(action, table, data) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    try {
        await fetch(GOOGLE_SHEET_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, table, data }) });
        return true;
    } catch (e) { return false; }
}

// --- AUDIT SYSTEM ---
window.addAuditEntry = async function(action, details, recordId) {
    const entry = {
        id: (auditLog.length ? Math.max(...auditLog.map(a => parseInt(a.id) || 0)) : 0) + 1,
        timestamp: new Date().toISOString(),
        action: action,
        recordId: recordId || '-',
        details: details
    };
    auditLog.push(entry);
    localStorage.setItem('auditLog', JSON.stringify(auditLog));
    await syncWithSheets('saveAudit', 'audit_log', entry);
};

// --- CRUD OPERATIONS (GLOBAL) ---
window.deleteSalaryRecord = async function(id) {
    const rec = salaryRecords.find(r => r.id == id);
    if (!rec) return;
    if (await window.showConfirm('ARCHIVE DATA?', `Move ${formatMonth(rec.month)} [ID: ${id}] to Archive?`)) {
        salaryRecords = salaryRecords.filter(r => r.id != id);
        if (!deletedIds.includes(id)) { deletedIds.push(id); localStorage.setItem('deletedIds', JSON.stringify(deletedIds)); }
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        renderSalaryView();
        await syncWithSheets('deleteSalary', 'salary_records', id);
        window.addAuditEntry('DELETE', `Archived salary record for ${formatMonth(rec.month)}`, id);
        window.showNotify('Record Archived Successfully', 'success');
    }
};

window.editSalaryRecord = function(id) {
    const rec = salaryRecords.find(r => r.id == id);
    if (!rec) return;
    if (!isRecordEditable(rec.month)) {
        window.showNotify(`LOCKED: Records older than 2 months cannot be edited.`, 'warning');
        return;
    }
    isEditing = id;
    document.getElementById('sal-month').value = rec.month;
    document.getElementById('sal-base').value = rec.baseSalary || 0;
    document.getElementById('sal-tot-days').value = rec.totalDays || 26;
    document.getElementById('sal-absent').value = (rec.totalDays || 26) - (rec.workingDays || 26);
    document.getElementById('sal-st-amount').value = rec.shortTimeAmount || 0;
    document.getElementById('sal-ot-amount').value = rec.overTimeAmount || 0;
    document.getElementById('sal-pf').value = rec.pfDeduction || 0;
    document.getElementById('sal-eobi').value = rec.eobiDeduction || 0;
    document.getElementById('sal-tax').value = rec.incomeTax || 0;
    document.getElementById('sal-allowance').value = rec.allowance || 0;
    document.getElementById('sal-remarks').value = rec.remarks || '';
    
    ['pf', 'eobi', 'tax'].forEach(f => {
        const cb = document.getElementById(`${f}-manual`);
        if (cb) cb.checked = false;
        const inp = document.getElementById(`sal-${f}`);
        if (inp) inp.readOnly = true;
    });
    el['salary-modal'].style.display = 'flex';
};

window.printSalarySlip = function(id) {
    const rec = salaryRecords.find(r => r.id == id);
    if (!rec) return;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Slip - ${formatMonth(rec.month)}</title><style>body{font-family:sans-serif;background:#030712;color:white;padding:40px;}table{width:100%;border-collapse:collapse;}td{padding:12px;border-bottom:1px solid #333;}.total{color:#10b981;font-weight:700;font-size:1.2rem;}</style></head><body><h2>HASSAN HUB | SALARY SLIP</h2><p>Period: ${formatMonth(rec.month)}</p><table><tr><td>Base Salary</td><td>${CURRENCY}${rec.baseSalary.toLocaleString()}</td></tr><tr><td>Deductions</td><td style="color:#ef4444;">-${CURRENCY}${(rec.overAllDeduction || 0).toLocaleString()}</td></tr><tr class="total"><td>NET PAYABLE</td><td>${CURRENCY}${rec.netPayable.toLocaleString()}</td></tr></table><script>window.print();<\/script></body></html>`);
    w.document.close();
};

window.openSalaryModal = () => { 
    isEditing = null; 
    if (el['salary-form']) el['salary-form'].reset(); 
    ['pf', 'eobi', 'tax'].forEach(f => {
        const inp = document.getElementById(`sal-${f}`);
        if (inp) inp.readOnly = true;
    });
    el['salary-modal'].style.display = 'flex'; 
};

window.openFundModal = () => { if (el['fund-form']) el['fund-form'].reset(); el['fund-modal'].style.display = 'flex'; };
window.openYearlySummary = () => { if (el['yearly-summary-modal']) el['yearly-summary-modal'].style.display = 'flex'; updateYearlySummary(); };
window.closeModal = (id) => { const m = document.getElementById(id); if (m) m.style.display = 'none'; };

window.autoCalculateSalary = function() {
    const base = +document.getElementById('sal-base').value || 0;
    const stHrs = +document.getElementById('sal-st').value || 0;
    const otHrs = +document.getElementById('sal-ot').value || 0;
    const hrRate = base / 208;
    document.getElementById('sal-st-amount').value = Math.round(stHrs * hrRate);
    document.getElementById('sal-ot-amount').value = Math.round(otHrs * hrRate * 2);
    if (!document.getElementById('pf-manual').checked) document.getElementById('sal-pf').value = Math.round(base * 0.0834);
    if (!document.getElementById('eobi-manual').checked) document.getElementById('sal-eobi').value = base > 0 ? 370 : 0;
    if (!document.getElementById('tax-manual').checked) document.getElementById('sal-tax').value = base > 100000 ? Math.round((base - 100000) * 0.05) : 0;
};

// --- CORE UI ---
function renderSalaryView() {
    if (!el['salary-table-body']) return;
    el['salary-table-body'].innerHTML = '';
    [...salaryRecords].sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(item => {
        const tr = document.createElement('tr');
        const editable = isRecordEditable(item.month);
        tr.style.opacity = editable ? '1' : '0.85';
        tr.innerHTML = `<td class="sticky-col" style="color:var(--primary); font-weight:600;">${formatMonth(item.month)}</td><td>${CURRENCY}${(item.baseSalary || 0).toLocaleString()}</td><td>${item.totalDays || 26}/${item.workingDays || 26}</td><td>${CURRENCY}${item.shortTimeAmount || 0} / ${CURRENCY}${item.overTimeAmount || 0}</td><td>${CURRENCY}${(item.pfDeduction || 0) + (item.eobiDeduction || 0)}</td><td>${CURRENCY}${item.incomeTax || 0}</td><td class="text-danger">${CURRENCY}${((item.otherDeductions || 0) + (item.withoutPay || 0)).toLocaleString()}</td><td>${CURRENCY}${(item.grossSalary || 0).toLocaleString()}</td><td class="text-success" style="font-weight:700;">${CURRENCY}${(item.netPayable || 0).toLocaleString()}</td><td>${item.remarks || '-'}</td><td class="action-td"><button class="icon-btn ${editable ? '' : 'locked'}" onclick="window.editSalaryRecord('${item.id}')" ${editable ? '' : 'title="LOCKED"'}><i data-lucide="${editable ? 'edit-3' : 'lock'}"></i></button><button class="icon-btn" onclick="window.printSalarySlip('${item.id}')"><i data-lucide="printer"></i></button><button class="icon-btn delete-btn" onclick="window.deleteSalaryRecord('${item.id}')"><i data-lucide="trash-2"></i></button></td>`;
        el['salary-table-body'].appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
    updateSummaryCards();
}

function updateSummaryCards() {
    const netSal = salaryRecords.reduce((acc, r) => acc + (Number(r.netPayable) || 0), 0);
    const netAdj = adjustmentRecords.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    const totalNet = netSal + netAdj;
    const base = salaryRecords.reduce((acc, r) => acc + (Number(r.baseSalary) || 0), 0);
    const ot = salaryRecords.reduce((acc, r) => acc + (Number(r.overTimeAmount) || 0), 0);
    const ded = salaryRecords.reduce((acc, r) => acc + (Number(r.overAllDeduction) || 0), 0);
    const pf = salaryRecords.reduce((acc, r) => acc + (Number(r.pfDeduction) || 0), 0);
    const eobi = salaryRecords.reduce((acc, r) => acc + (Number(r.eobiDeduction) || 0), 0);
    const tax = salaryRecords.reduce((acc, r) => acc + (Number(r.incomeTax) || 0), 0);
    const st = salaryRecords.reduce((acc, r) => acc + (Number(r.shortTimeAmount) || 0), 0);

    if (el['salary-total-net']) el['salary-total-net'].innerText = `${CURRENCY}${totalNet.toLocaleString()}`;
    if (el['breakdown-base']) el['breakdown-base'].innerText = base.toLocaleString();
    if (el['breakdown-ot']) el['breakdown-ot'].innerText = ot.toLocaleString();
    if (el['salary-total-ded']) el['salary-total-ded'].innerText = `${CURRENCY}${ded.toLocaleString()}`;
    if (el['breakdown-pf']) el['breakdown-pf'].innerText = pf.toLocaleString();
    if (el['breakdown-eobi']) el['breakdown-eobi'].innerText = eobi.toLocaleString();
    if (el['breakdown-tax']) el['breakdown-tax'].innerText = tax.toLocaleString();
    if (el['breakdown-st']) el['breakdown-st'].innerText = st.toLocaleString();

    const count = salaryRecords.length || 1;
    if (el['salary-avg-net']) el['salary-avg-net'].innerText = `${CURRENCY}${Math.round(totalNet/count).toLocaleString()}`;
    if (el['breakdown-avg-ot']) el['breakdown-avg-ot'].innerText = Math.round(ot/count).toLocaleString();
}

// --- THEME ENGINE ---
function initTheme() {
    const saved = localStorage.getItem('salaryHubTheme') || 'default';
    window.setTheme(saved);
}

window.setTheme = function(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('salaryHubTheme', t);
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === t);
    });
};

function setupEventListeners() {
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.onclick = () => window.setTheme(btn.dataset.theme);
    });

    ['sal-base', 'sal-st', 'sal-ot', 'sal-tot-days', 'sal-absent'].forEach(id => { 
        const f = document.getElementById(id); 
        if (f) f.oninput = window.autoCalculateSalary; 
    });
    
    document.querySelectorAll('.close-btn').forEach(btn => btn.onclick = () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) modal.style.display = 'none';
        else {
            const up = btn.closest('.app-view');
            if (up) window.showView('salary');
        }
    });
    
    ['pf', 'eobi', 'tax'].forEach(field => {
        const cb = document.getElementById(`${field}-manual`);
        if (cb) {
            cb.addEventListener('change', (e) => {
                const input = document.getElementById(`sal-${field}`);
                if (input) {
                    input.readOnly = !e.target.checked;
                    if (e.target.checked) input.focus();
                    window.autoCalculateSalary();
                }
            });
        }
    });

    if (el['salary-form']) el['salary-form'].onsubmit = async (e) => {
        e.preventDefault();
        const id = isEditing || getNextNumericId();
        const rec = { id, month: document.getElementById('sal-month').value, date: new Date().toISOString(), baseSalary: +document.getElementById('sal-base').value, totalDays: +document.getElementById('sal-tot-days').value, workingDays: (+document.getElementById('sal-tot-days').value) - (+document.getElementById('sal-absent').value), allowance: +document.getElementById('sal-allowance').value || 0, pfDeduction: +document.getElementById('sal-pf').value || 0, eobiDeduction: +document.getElementById('sal-eobi').value || 0, incomeTax: +document.getElementById('sal-tax').value || 0, shortTimeAmount: +document.getElementById('sal-st-amount').value || 0, overTimeAmount: +document.getElementById('sal-ot-amount').value || 0, withoutPay: +document.getElementById('sal-wop').value || 0, otherDeductions: +document.getElementById('sal-other-ded').value || 0, remarks: document.getElementById('sal-remarks').value, grossSalary: 0, overAllDeduction: 0, netPayable: 0 };
        rec.grossSalary = rec.baseSalary + rec.overTimeAmount + rec.allowance;
        rec.overAllDeduction = rec.pfDeduction + rec.eobiDeduction + rec.incomeTax + rec.shortTimeAmount + rec.withoutPay + rec.otherDeductions;
        rec.netPayable = rec.grossSalary - rec.overAllDeduction;
        const actionText = isEditing ? 'EDIT' : 'ADD';
        if (isEditing) { const idx = salaryRecords.findIndex(r => r.id == isEditing); salaryRecords[idx] = rec; }
        else salaryRecords.push(rec);
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        el['salary-modal'].style.display = 'none'; renderSalaryView();
        window.showNotify('Salary Record Secured', 'success');
        await syncWithSheets('saveSalary', 'salary_records', rec);
        window.addAuditEntry(actionText, `${actionText === 'ADD' ? 'Added' : 'Updated'} record for ${formatMonth(rec.month)}. Net: ${rec.netPayable}`, id);
    };
    
    if (el['fund-form']) el['fund-form'].onsubmit = async (e) => {
        e.preventDefault();
        const id = getNextNumericId();
        const rec = { id: id, month: document.getElementById('fund-month').value, amount: +document.getElementById('fund-amount').value, date: new Date().toISOString(), remarks: document.getElementById('fund-remarks').value };
        adjustmentRecords.push(rec); localStorage.setItem('adjustmentRecords', JSON.stringify(adjustmentRecords));
        el['fund-modal'].style.display = 'none'; renderSalaryView();
        window.showNotify('Adjustment Logged', 'success');
        await syncWithSheets('saveAdjustment', 'adjustments', rec);
        window.addAuditEntry('ADD_FUND', `Logged extra fund for ${formatMonth(rec.month)}. Amt: ${rec.amount}`, id);
    };
}

// --- POPUPS & NOTIFICATIONS ---
window.showNotify = function(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconName = type === 'success' ? 'check-circle' : (type === 'error' ? 'x-circle' : 'alert-triangle');
    toast.innerHTML = `<div class="toast-icon"><i data-lucide="${iconName}"></i></div><div class="toast-content"><h4>${type.toUpperCase()}</h4><p>${msg}</p></div>`;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; setTimeout(() => toast.remove(), 300); }, 4000);
};

window.showConfirm = function(title, msg) {
    return new Promise((resolve) => {
        const modal = el['confirm-modal'];
        if (!modal) return resolve(false);
        if (el['confirm-title']) el['confirm-title'].innerText = title;
        if (el['confirm-msg']) el['confirm-msg'].innerText = msg;
        modal.style.display = 'flex';
        const cleanup = (val) => { modal.style.display = 'none'; if (el['confirm-ok']) el['confirm-ok'].onclick = null; if (el['confirm-cancel']) el['confirm-cancel'].onclick = null; resolve(val); };
        if (el['confirm-ok']) el['confirm-ok'].onclick = () => cleanup(true);
        if (el['confirm-cancel']) el['confirm-cancel'].onclick = () => cleanup(false);
    });
};

function initKeypad() {
    document.querySelectorAll('.pin-btn').forEach(b => {
        b.onclick = () => {
            const v = b.textContent.trim();
            if (v === 'C') currentPIN = '';
            else if (b.id === 'enter-pin' || v === 'L') {
                if (currentPIN === vaultPIN) unlockVault();
                else { currentPIN = ''; window.showNotify('ACCESS DENIED', 'error'); }
            } else if (/^\d$/.test(v)) {
                if (currentPIN.length < 4) currentPIN += v;
            }
            if (el['pin-display']) el['pin-display'].innerHTML = '●'.repeat(currentPIN.length) + '○'.repeat(4 - currentPIN.length);
        };
    });
}

window.updatePIN = function(e) {
    e.preventDefault();
    const curr = document.getElementById('current-pin').value;
    const n1 = document.getElementById('new-pin').value;
    const n2 = document.getElementById('confirm-pin').value;
    if (curr !== vaultPIN) return window.showNotify('Current PIN is incorrect', 'error');
    if (n1 !== n2) return window.showNotify('New PINs do not match', 'error');
    if (n1.length < 4) return window.showNotify('PIN must be 4 digits', 'warning');
    vaultPIN = n1;
    localStorage.setItem('vaultPIN', n1);
    window.showNotify('Encryption Key Updated Successfully', 'success');
    window.addAuditEntry('SECURITY_UPDATE', 'Vault PIN was updated by user', '-');
    e.target.reset();
    window.showView('salary');
};

function renderAuditLog() {
    const list = document.getElementById('audit-list');
    if (!list) return;
    list.innerHTML = auditLog.length ? [...auditLog].reverse().map(a => {
        const ts = a.timestamp || a.time || new Date().toISOString();
        const dateObj = new Date(ts);
        const displayDate = isNaN(dateObj.getTime()) ? 'Recent' : dateObj.toLocaleString();
        return `<tr><td>${displayDate}</td><td>${a.action}</td><td>${a.details}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="text-muted" style="text-align:center;">No activity recorded yet.</td></tr>';
}

function initIdentity() { if (el['user-handle']) el['user-handle'].innerText = localStorage.getItem('userName') || 'Mr Hassan'; }
function updateStatusText(t) { if (el['cloud-status-text']) el['cloud-status-text'].innerText = t; }
function initSalaryChart() {}
function updateYearlySummary() {}
document.addEventListener('DOMContentLoaded', startHub);
