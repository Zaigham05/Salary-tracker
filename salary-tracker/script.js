// Cloud Storage Configuration (Google Sheets)
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxCupu05McUU1a3Aizzes3DOM2ryX4A966TlKkC7S2xZ88cu4avAPuN4XEX9huo7hgxUw/exec'; 

// State Management
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

function updateStatusText(text) {
    if (el['cloud-status-text']) el['cloud-status-text'].innerText = text;
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

// Data Handling helpers
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
    setSyncing(true);
    updateStatusText('CONNECTING...');
    try {
        const response = await fetch(`${GOOGLE_SHEET_URL}?action=fetchAll`);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        if (data.salaries) {
            salaryRecords = data.salaries;
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        }
        if (data.adjustments) adjustmentRecords = data.adjustments;
        if (data.logs) auditLog = data.logs;
        renderSalaryView();
        updateStatusText('ONLINE');
    } catch (err) {
        console.error('Sheets Fetch Error:', err);
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
        console.error('Sheets Sync Error:', err);
        return false;
    }
}

// Core CRUD functions (GLOBAL SCOPE)
async function deleteSalaryRecord(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    if (confirm(`Delete record for ${formatMonth(rec.month)}?`)) {
        salaryRecords = salaryRecords.filter(r => r.id !== id);
        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        renderSalaryView();
        await syncWithSheets('deleteSalary', 'salary_records', id);
        showNotification('Record deleted!', 'success');
    }
}

function editSalaryRecord(id) {
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
}

function printSalarySlip(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;
    const printWindow = window.open('', '_blank');
    const html = `<html><head><title>Salary Slip - ${formatMonth(rec.month)}</title><style>body{font-family:sans-serif;padding:40px;}.slip{border:1px solid #eee;padding:20px;max-width:600px;margin:auto;}table{width:100%;border-collapse:collapse;}td{padding:10px;border-bottom:1px solid #eee;}.total{font-weight:bold;background:#f9f9f9;}</style></head><body><div class="slip"><h2>MR HASSAN | SALARY HUB</h2><p>Period: ${formatMonth(rec.month)}</p><table><tr><td>Base Salary</td><td>${CURRENCY}${rec.baseSalary.toLocaleString()}</td></tr><tr><td>Allowances</td><td>${CURRENCY}${rec.allowance.toLocaleString()}</td></tr><tr><td>Gross Salary</td><td>${CURRENCY}${rec.grossSalary.toLocaleString()}</td></tr><tr><td>Deductions</td><td style="color:red;">-${CURRENCY}${rec.overAllDeduction.toLocaleString()}</td></tr><tr class="total"><td>NET PAYABLE</td><td>${CURRENCY}${rec.netPayable.toLocaleString()}</td></tr></table></div><script>window.print();<\/script></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
}

// UI Rendering
function renderSalaryView() {
    populateSalaryFilters();
    renderSalaryTable();
    updateSalarySummary();
    initSalaryChart();
}

function populateSalaryFilters() {
    if (!el['sal-year-filter']) return;
    const years = [...new Set(salaryRecords.map(r => formatMonth(r.month).split('-')[1]))].sort();
    el['sal-year-filter'].innerHTML = '<option value="all">All Years</option>' + years.map(y => `<option value="20${y}">20${y}</option>`).join('');
}

function renderSalaryTable() {
    if (!el['salary-table-body']) return;
    el['salary-table-body'].innerHTML = '';
    const sorted = [...salaryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
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
    if (el['salary-total-ded']) el['salary-total-ded'].innerText = `${CURRENCY}${Math.round(totalDed).toLocaleString()}`;
    updateHackerStatus(totalNet);
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

// Chart Logic
function initSalaryChart() {
    const canvas = document.getElementById('salary-chart');
    if (!canvas || !window.Chart) return;
    if (salaryChartInstance) salaryChartInstance.destroy();
    const sorted = [...salaryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    salaryChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: sorted.map(r => formatMonth(r.month)),
            datasets: [{ label: 'Net Payable', data: sorted.map(r => r.netPayable), borderColor: '#10b981', tension: 0.4, fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

// Keypad
function initKeypad() {
    const pinBtns = document.querySelectorAll('.pin-btn');
    pinBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.textContent.trim();
            if (val === 'C' || btn.id === 'clear-pin') { currentPIN = ''; updatePINDots(); return; }
            if (btn.id === 'enter-pin' || val === 'L') { 
                if (currentPIN === vaultPIN) unlockVault(); 
                else { currentPIN = ''; updatePINDots(); showNotification('Access Denied', 'error'); }
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
    fetchCloudData();
}

function showNotification(m, t) {
    const container = document.getElementById('notification-container') || document.body;
    const toast = document.createElement('div');
    toast.style = `position:fixed;top:20px;right:20px;background:${t==='error'?'#ef4444':'#10b981'};color:white;padding:15px;border-radius:10px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.3);`;
    toast.innerText = m;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// THE MASTER BOOT
function startHub() {
    initDomReferences();
    initKeypad();
    initIdentity();
    const t = localStorage.getItem('theme') || 'default';
    document.documentElement.setAttribute('data-theme', t);
    
    // Add Salary Form Submit
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
            
            const rec = {
                id: isEditing || Math.random().toString(36).substr(2, 9),
                month, date: new Date().toISOString(),
                baseSalary, totalDays, workingDays, allowance, pfDeduction, eobiDeduction, incomeTax, shortTimeAmount, withoutPay, otherDeductions, remarks,
                grossSalary, overAllDeduction, netPayable: grossSalary - overAllDeduction
            };

            if (isEditing) {
                const idx = salaryRecords.findIndex(r => r.id === isEditing);
                salaryRecords[idx] = rec;
            } else {
                salaryRecords.push(rec);
            }
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
            isEditing = null;
            el['salary-modal'].style.display = 'none';
            el['salary-form'].reset();
            renderSalaryView();
            showNotification('Record Saved Locally!', 'success');
            await syncWithSheets('saveSalary', 'salary_records', rec);
            showNotification('Sync Complete!', 'success');
        };
    }

    if (el['add-salary-btn']) el['add-salary-btn'].onclick = () => { isEditing = null; el['salary-form'].reset(); el['salary-modal'].style.display = 'flex'; };
    if (el['close-salary-modal']) el['close-salary-modal'].onclick = () => el['salary-modal'].style.display = 'none';

    if (el['current-date']) el['current-date'].innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (window.lucide) lucide.createIcons();
    
    // RENDER LOCAL DATA IMMEDIATELY
    renderSalaryView();
    console.log('Hub Core: Online.');
}

// USE FAST BOOT
document.addEventListener('DOMContentLoaded', startHub);
