// --- GLOBAL CONFIGURATION ---
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxCupu05McUU1a3Aizzes3DOM2ryX4A966TlKkC7S2xZ88cu4avAPuN4XEX9huo7hgxUw/exec'; 

// --- STATE MANAGEMENT ---
let salaryRecords = JSON.parse(localStorage.getItem('salaryRecords')) || [];
let adjustmentRecords = JSON.parse(localStorage.getItem('adjustmentRecords')) || [];
let auditLog = JSON.parse(localStorage.getItem('auditLog')) || [];
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
        'yearly-summary-modal', 'recovery-modal'
    ];
    ids.forEach(id => {
        el[id] = document.getElementById(id);
    });
}

// --- INITIALIZATION ---
function startHub() {
    console.log('Hub Core: Booting Full Mode...');
    initDomReferences();
    initKeypad();
    initIdentity();
    initTheme();
    setupEventListeners();
    
    // Fast Load
    if (!isLocked && el['vault-lock']) el['vault-lock'].style.display = 'none';
    renderSalaryView();
    fetchCloudData(); // Sync with cloud in background

    const opt = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    if (el['current-date']) el['current-date'].innerText = new Date().toLocaleDateString('en-US', opt);
    
    if (window.lucide) lucide.createIcons();
    console.log('Hub Core: Online.');
}

// --- VIEW NAVIGATION ---
function showView(viewName) {
    // Current app only has one main view path, but for future proofing:
    const views = document.querySelectorAll('.app-view');
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`${viewName}-view`);
    if (target) {
        target.classList.add('active');
        if (el['view-title']) el['view-title'].innerText = viewName.charAt(0).toUpperCase() + viewName.slice(1) + ' Dashboard';
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick')?.includes(viewName)) item.classList.add('active');
        else item.classList.remove('active');
    });
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

    if (tabId === 'analytics') initSalaryChart();
    if (window.lucide) lucide.createIcons();
}

// --- DATA HANDLING ---
function formatMonth(monthStr) {
    if (!monthStr) return '-';
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
            salaryRecords = data.salaries;
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        }
        if (data.adjustments) {
            adjustmentRecords = data.adjustments;
            localStorage.setItem('adjustmentRecords', JSON.stringify(adjustmentRecords));
        }
        if (data.logs) {
            auditLog = data.logs;
            localStorage.setItem('auditLog', JSON.stringify(auditLog));
        }
        renderSalaryView();
        updateStatusText('ONLINE');
    } catch (err) {
        console.error('Cloud Error:', err);
        updateStatusText('OFFLINE');
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
        console.error('Sync Error:', err);
        return false;
    }
}

// --- CRUD OPERATIONS ---
async function deleteSalaryRecord(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    if (confirm(`CRITICAL: Permanently delete ${formatMonth(rec.month)} record?`)) {
        salaryRecords = salaryRecords.filter(r => r.id !== id);
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        renderSalaryView();
        await syncWithSheets('deleteSalary', 'salary_records', id);
        logAudit('DELETE', id, `Deleted monthly record: ${rec.month}`);
        showNotification('Data Purged!', 'success');
    }
}

function editSalaryRecord(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    isEditing = id;
    
    // Populate Form
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
}

function printSalarySlip(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    const printWindow = window.open('', '_blank');
    const html = `
        <html><head><title>Slip - ${formatMonth(rec.month)}</title>
        <style>
            body{font-family:'Outfit',sans-serif;padding:30px;background:#030712;color:white;}
            .slip{border:1px solid rgba(255,255,255,0.1);padding:30px;border-radius:15px;background:rgba(255,255,255,0.02);}
            h2{color:#10b981;letter-spacing:2px;}
            table{width:100%;margin-top:20px;border-collapse:collapse;}
            td{padding:12px;border-bottom:1px solid rgba(255,255,255,0.05);}
            .total{font-weight:700;color:#10b981;font-size:1.2rem;border-top:2px solid #10b981;}
        </style></head>
        <body><div class="slip">
            <h2>HASSAN HUB | SALARY SLIP</h2>
            <p>Period: ${formatMonth(rec.month)}</p>
            <table>
                <tr><td>Base Salary</td><td>${CURRENCY}${rec.baseSalary.toLocaleString()}</td></tr>
                <tr><td>Allowances</td><td>${CURRENCY}${rec.allowance.toLocaleString()}</td></tr>
                <tr><td>Gross Salary</td><td>${CURRENCY}${rec.grossSalary.toLocaleString()}</td></tr>
                <tr><td>Deductions</td><td style="color:#ef4444;">-${CURRENCY}${rec.overAllDeduction.toLocaleString()}</td></tr>
                <tr class="total"><td>NET PAYABLE</td><td>${CURRENCY}${rec.netPayable.toLocaleString()}</td></tr>
            </table>
        </div><script>window.print();<\/script></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
}

// --- UI RENDERING ---
function renderSalaryView() {
    populateSalaryFilters();
    renderSalaryTable();
    updateSalarySummary();
    initSalaryChart();
    renderExtraFundsList();
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
            <td>${item.totalDays}/${item.workingDays || item.totalDays}</td>
            <td>${CURRENCY}${(item.shortTimeAmount || 0).toLocaleString()} / ${CURRENCY}${(item.overTimeAmount || 0).toLocaleString()}</td>
            <td>${CURRENCY}${(item.pfDeduction + item.eobiDeduction).toLocaleString()}</td>
            <td>${CURRENCY}${(item.incomeTax || 0).toLocaleString()}</td>
            <td class="text-danger">${CURRENCY}${((item.otherDeductions || 0) + (item.withoutPay || 0)).toLocaleString()}</td>
            <td>${CURRENCY}${item.grossSalary.toLocaleString()}</td>
            <td class="text-success" style="font-weight: 700;">${CURRENCY}${item.netPayable.toLocaleString()}</td>
            <td class="compact-cell">${item.remarks || '-'}</td>
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
    const totalNet = salaryRecords.reduce((acc, r) => acc + r.netPayable, 0);
    const totalDed = salaryRecords.reduce((acc, r) => acc + r.overAllDeduction, 0);
    if (el['salary-total-net']) el['salary-total-net'].innerText = `${CURRENCY}${totalNet.toLocaleString()}`;
    if (el['salary-total-ded']) el['salary-total-ded'].innerText = `${CURRENCY}${totalDed.toLocaleString()}`;
    updateHackerStatus(totalNet);

    // Mini detail cards
    if (document.getElementById('breakdown-base')) {
         document.getElementById('breakdown-base').innerText = salaryRecords.reduce((a,r)=>a+r.baseSalary,0).toLocaleString();
         document.getElementById('breakdown-pf').innerText = salaryRecords.reduce((a,r)=>a+r.pfDeduction,0).toLocaleString();
    }
}

function renderExtraFundsList() {
    const tbody = document.getElementById('extra-funds-body');
    if (!tbody) return;
    tbody.innerHTML = adjustmentRecords.map(a => `
        <tr>
            <td>${a.month}</td>
            <td>${a.type}</td>
            <td>${CURRENCY}${a.amount.toLocaleString()}</td>
            <td>${a.remarks || '-'}</td>
            <td><button class="icon-btn delete-btn" onclick="deleteExtraFund('${a.id}')"><i data-lucide="trash-2"></i></button></td>
        </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

// --- MODAL & SECURITY ---
function openSecurityModal() { if (el['security-modal']) el['security-modal'].style.display = 'flex'; }
function closeSecurityModal() { if (el['security-modal']) el['security-modal'].style.display = 'none'; }
function openAuditLog() { if (el['audit-modal']) el['audit-modal'].style.display = 'flex'; renderAuditLog(); }
function closeAuditLog() { if (el['audit-modal']) el['audit-modal'].style.display = 'none'; }
function openYearlySummary() { if (el['yearly-summary-modal']) el['yearly-summary-modal'].style.display = 'flex'; updateYearlySummary(); }
function closeYearlySummary() { if (el['yearly-summary-modal']) el['yearly-summary-modal'].style.display = 'none'; }

function openForgotPinFlow() {
    if (el['recovery-modal']) el['recovery-modal'].style.display = 'flex';
}

function initKeypad() {
    const pinBtns = document.querySelectorAll('.pin-btn');
    pinBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.textContent.trim();
            if (val === 'C' || btn.id === 'clear-pin') { currentPIN = ''; updatePINDots(); return; }
            if (btn.id === 'enter-pin' || val === 'L') { 
                if (currentPIN === vaultPIN) unlockVault(); 
                else loginFailure();
                return; 
            }
            if (/^\d$/.test(val) && currentPIN.length < 4) { currentPIN += val; updatePINDots(); }
        });
    });
}

function updatePINDots() {
    const display = document.getElementById('pin-display');
    if (display) display.innerHTML = '●'.repeat(currentPIN.length) + '○'.repeat(4 - currentPIN.length);
}

function unlockVault() {
    isLocked = false;
    if (el['vault-lock']) el['vault-lock'].style.display = 'none';
    renderSalaryView();
}

function loginFailure() {
    currentPIN = '';
    updatePINDots();
    showNotification('ACCESS DENIED', 'error');
}

// --- CORE UTILS ---
function populateSalaryFilters() {
    if (!el['sal-year-filter']) return;
    const years = [...new Set(salaryRecords.map(r => formatMonth(r.month).split('-')[1]))].sort();
    el['sal-year-filter'].innerHTML = '<option value="all">All Years</option>' + years.map(y => `<option value="20${y}">20${y}</option>`).join('');
}

function updateHackerStatus(total) {
    let rank = "HUB INTERN";
    if (total > 750000) rank = "ELITE ARCHITECT";
    else if (total > 400000) rank = "SENIOR ANALYST";
    else if (total > 150000) rank = "SECURITY SPECIALIST";
    const label = document.querySelector('.status-label');
    if (label) label.innerText = rank;
}

function initTheme() {
    const t = localStorage.getItem('theme') || 'default';
    document.documentElement.setAttribute('data-theme', t);
}

function updateStatusText(text) {
    if (el['cloud-status-text']) el['cloud-status-text'].innerText = text;
}

function updateAvatar(name) {
    if (el['user-avatar']) el['user-avatar'].src = `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`;
}

function setSyncing(state) {
    isSyncing = state;
    if (el['cloud-sync-indicator']) el['cloud-sync-indicator'].style.opacity = state ? '1' : '0.3';
}

function showNotification(m, t) {
    const container = document.getElementById('notification-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast ${t}`;
    toast.style = `position:fixed;top:20px;right:20px;background:${t==='error'?'#ef4444':'#10b981'};color:white;padding:15px 25px;border-radius:10px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.5);font-family:inherit;font-weight:600;`;
    toast.innerText = m;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity='0'; setTimeout(()=>toast.remove(),500); }, 3000);
}

async function logAudit(action, id, details) {
    const entry = { timestamp: new Date().toISOString(), action, id, details };
    auditLog.unshift(entry);
    localStorage.setItem('auditLog', JSON.stringify(auditLog));
    await syncWithSheets('logAudit', 'audit_log', entry);
}

function autoCalculateSalary() {
    const base = +document.getElementById('sal-base').value || 0;
    const stHrs = +document.getElementById('sal-st').value || 0;
    const otHrs = +document.getElementById('sal-ot').value || 0;
    const absent = +document.getElementById('sal-absent').value || 0;
    const allowance = +document.getElementById('sal-allowance').value || 0;
    
    // Hourly rate (Estimated 208 hours per month)
    const hrRate = base / 208;
    
    // Amounts
    const stAmt = Math.round(stHrs * hrRate);
    const otAmt = Math.round(otHrs * hrRate * 2); // 2X OT rate
    
    document.getElementById('sal-st-amount').value = stAmt;
    document.getElementById('sal-ot-amount').value = otAmt;
    
    // Auto-Deductions (Only if not manual)
    if (!document.getElementById('pf-manual').checked) {
        document.getElementById('sal-pf').value = Math.round(base * 0.0834);
    }
    if (!document.getElementById('eobi-manual').checked) {
        document.getElementById('sal-eobi').value = base > 0 ? 370 : 0;
    }
    if (!document.getElementById('tax-manual').checked) {
        document.getElementById('sal-tax').value = base > 100000 ? Math.round((base - 100000) * 0.05) : 0;
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Live Calculation listeners
    const calcInputs = ['sal-base', 'sal-st', 'sal-ot', 'sal-absent', 'sal-allowance'];
    calcInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', autoCalculateSalary);
    });

    ['pf-manual', 'eobi-manual', 'tax-manual'].forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', (e) => {
            const field = id.split('-')[0];
            document.getElementById(`sal-${field}`).readOnly = !e.target.checked;
            autoCalculateSalary();
        });
    });
    if (el['salary-form']) {
        el['salary-form'].onsubmit = async (e) => {
            e.preventDefault();
            const month = document.getElementById('sal-month').value;
            const baseSalary = +document.getElementById('sal-base').value;
            const totalDays = +document.getElementById('sal-tot-days').value;
            const workingDays = totalDays - (+document.getElementById('sal-absent').value);
            const allowance = +document.getElementById('sal-allowance').value || 0;
            const pfDeduction = +document.getElementById('sal-pf').value || 0;
            const eobiDeduction = +document.getElementById('sal-eobi').value || 0;
            const incomeTax = +document.getElementById('sal-tax').value || 0;
            const shortTimeAmount = +document.getElementById('sal-st-amount').value || 0;
            const withoutPay = +document.getElementById('sal-wop').value || 0;
            const otherDeductions = +document.getElementById('sal-other-ded').value || 0;
            const remarks = document.getElementById('sal-remarks').value;
            const grossSalary = baseSalary + (+document.getElementById('sal-ot-amount').value || 0) + allowance;
            const overAllDeduction = pfDeduction + eobiDeduction + incomeTax + shortTimeAmount + withoutPay + otherDeductions;
            
            const rec = { id: isEditing || Math.random().toString(36).substr(2,9), month, date: new Date().toISOString(), baseSalary, totalDays, workingDays, allowance, pfDeduction, eobiDeduction, incomeTax, shortTimeAmount, withoutPay, otherDeductions, remarks, grossSalary, overAllDeduction, netPayable: grossSalary - overAllDeduction };
            
            if (isEditing) { const idx = salaryRecords.findIndex(r => r.id === isEditing); salaryRecords[idx] = rec; }
            else salaryRecords.push(rec);

            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
            isEditing = null; el['salary-modal'].style.display = 'none'; el['salary-form'].reset(); renderSalaryView();
            showNotification('Syncing...', 'success');
            await syncWithSheets('saveSalary', 'salary_records', rec);
            showNotification('Cloud Secured!', 'success');
        };
    }

    if (el['add-salary-btn']) el['add-salary-btn'].onclick = () => { isEditing = null; el['salary-form'].reset(); el['salary-modal'].style.display = 'flex'; };
    if (el['close-salary-modal']) el['close-salary-modal'].onclick = () => el['salary-modal'].style.display = 'none';
    if (el['close-security-modal']) el['close-security-modal'].onclick = closeSecurityModal;
    if (el['close-audit-modal']) el['close-audit-modal'].onclick = closeAuditLog;
    if (el['close-fund-modal']) el['close-fund-modal'].onclick = () => el['fund-modal'].style.display='none';
    if (el['add-fund-btn']) el['add-fund-btn'].onclick = () => el['fund-modal'].style.display='flex';

    if (el['sal-year-filter']) el['sal-year-filter'].onchange = (e) => { salYearFilter = e.target.value; renderSalaryView(); };
}

function initSalaryChart() {
    const ctx = document.getElementById('salary-chart')?.getContext('2d');
    if (!ctx || !window.Chart) return;
    if (salaryChartInstance) salaryChartInstance.destroy();
    const sorted = [...salaryRecords].sort((a,b)=>new Date(a.date)-new Date(b.date));
    salaryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sorted.map(r=>formatMonth(r.month)),
            datasets: [{ label: 'Net Payable', data: sorted.map(r=>r.netPayable), borderColor: '#10b981', tension: 0.4, fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)' }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderAuditLog() {
    const list = document.getElementById('audit-list');
    if (list) list.innerHTML = auditLog.map(a => `<tr><td>${new Date(a.timestamp).toLocaleString()}</td><td>${a.action}</td><td>${a.details}</td></tr>`).join('');
}

function updateYearlySummary() {} // Placeholder
function backupData() {
    const data = JSON.stringify({ salaryRecords, adjustmentRecords, auditLog });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `salary_hub_backup_${new Date().toISOString().split('T')[0]}.json`; a.click();
}

function initIdentity() {
    const name = localStorage.getItem('userName') || 'Mr Hassan';
    if (el['user-handle']) el['user-handle'].innerText = name;
    updateAvatar(name);
}

// --- START ---
document.addEventListener('DOMContentLoaded', startHub);
