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

const cloudIndicator = document.getElementById('cloud-sync-indicator');
function setSyncing(state) {
    isSyncing = state;
    if (state) cloudIndicator.classList.add('syncing');
    else cloudIndicator.classList.remove('syncing');
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
    
    lucide.createIcons();
}

// DOM Elements
const dateEl = document.getElementById('current-date');
const themeBtns = document.querySelectorAll('.theme-btn');
const viewTitle = document.getElementById('view-title');

// Salary DOM
const salaryListEl = document.getElementById('salary-table-body');
const salTotalNetEl = document.getElementById('salary-total-net');
const salTotalDedEl = document.getElementById('salary-total-ded');
const salAvgNetEl = document.getElementById('salary-avg-net');
const addSalaryBtn = document.getElementById('add-salary-btn');
const salYearSelect = document.getElementById('sal-year-filter');
const salMonthSelect = document.getElementById('sal-month-filter');
const vaultOverlay = document.getElementById('vault-lock');

const statusText = document.getElementById('cloud-status-text');
const statusFill = document.getElementById('status-fill');
const pinDisplay = document.getElementById('pin-display');

// Set Current Date logic moved to Boot Sequence at end of file

// Identity Persistence
const userHandleEl = document.getElementById('user-handle');
const userAvatarEl = document.getElementById('user-avatar');

function initIdentity() {
    const savedName = localStorage.getItem('userName') || 'Mr Hassan';
    userHandleEl.innerText = savedName;
    updateAvatar(savedName);
}

function updateAvatar(name) {
    userAvatarEl.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`;
}

// Data Mapping Utilities
function mapToSql(record) {
    const mapping = {
        baseSalary: 'base_salary',
        totalDays: 'total_days',
        workingDays: 'working_days',
        shortTimeAmount: 'short_time_amount',
        overTimeAmount: 'over_time_amount',
        pfDeduction: 'pf_deduction',
        eobiDeduction: 'eobi_deduction',
        incomeTax: 'income_tax',
        withoutPay: 'without_pay',
        grossSalary: 'gross_salary',
        overAllDeduction: 'overall_deduction',
        netPayable: 'net_payable',
        otHrs: 'ot_hrs'
    };
    const sqlRec = { ...record };
    for (const [jsKey, sqlKey] of Object.entries(mapping)) {
        if (record[jsKey] !== undefined) {
            sqlRec[sqlKey] = record[jsKey];
            // Only delete if the names are actually different
            if (jsKey !== sqlKey) delete sqlRec[jsKey];
        }
    }
    return sqlRec;
}

function mapFromSql(sqlRec) {
    const mapping = {
        base_salary: 'baseSalary',
        total_days: 'totalDays',
        working_days: 'workingDays',
        short_time_amount: 'shortTimeAmount',
        over_time_amount: 'overTimeAmount',
        pf_deduction: 'pfDeduction',
        eobi_deduction: 'eobiDeduction',
        income_tax: 'incomeTax',
        without_pay: 'withoutPay',
        gross_salary: 'grossSalary',
        overall_deduction: 'overAllDeduction',
        net_payable: 'netPayable',
        ot_hrs: 'otHrs'
    };
    const record = { ...sqlRec };
    for (const [sqlKey, jsKey] of Object.entries(mapping)) {
        if (sqlRec[sqlKey] !== undefined) {
            record[jsKey] = sqlRec[sqlKey];
            if (sqlKey !== jsKey) delete record[sqlKey];
        }
    }
    return record;
}

async function fetchCloudData() {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    setSyncing(true);
    try {
        const response = await fetch(`${GOOGLE_SHEET_URL}?action=fetchAll`);
        const data = await response.json();
        
        if (data.salaries) salaryRecords = data.salaries;
        if (data.adjustments) adjustmentRecords = data.adjustments;
        if (data.logs) auditLog = data.logs;

        renderSalaryView();
    } catch (err) {
        console.error('Sheets Fetch Error:', err);
    } finally {
        setSyncing(false);
    }
}

async function syncWithSheets(action, table, data) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) return;
    try {
        const response = await fetch(GOOGLE_SHEET_URL, {
            method: 'POST',
            mode: 'no-cors', // Apps Script requires no-cors for simple posts or careful CORS headers
            cache: 'no-cache',
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
    // Migration logic for first-time setup
    const hasSynced = localStorage.getItem('hasSyncedToSheets');
    const localSals = JSON.parse(localStorage.getItem('salaryRecords')) || [];
    
    if (!hasSynced && localSals.length > 0) {
        setSyncing(true);
        try {
            for (const rec of localSals) {
                await syncWithSheets('saveSalary', 'salary_records', rec);
            }
            localStorage.setItem('hasSyncedToSheets', 'true');
            showNotification('Legacy data migrated to Google Sheets!', 'success');
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

userHandleEl.addEventListener('blur', () => {
    const newName = userHandleEl.innerText.trim() || 'Mr Hacker';
    localStorage.setItem('userName', newName);
    updateAvatar(newName);
});

userHandleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        userHandleEl.blur();
    }
});

// Initialize App
function init() {
    initTheme();
    initIdentity();
    if (isLocked) {
        vaultOverlay.style.display = 'flex';
    } else {
        vaultOverlay.style.display = 'none';
        renderSalaryView();
        checkAndSyncData(); // Push any leftovers to cloud
    }
}

// Salary Rendering & Logic
function renderSalaryView() {
    populateSalaryFilters();
    renderSalaryTable();
    updateSalarySummary();
    initSalaryChart();
    renderExtraFundsList();
}

function getFilteredSalaryRecords() {
    return salaryRecords.filter(rec => {
        const matchesYear = salYearFilter === 'all' || rec.month.includes(salYearFilter.slice(-2));
        const matchesMonth = salMonthFilter === 'all' || rec.month.startsWith(salMonthFilter);
        return matchesYear && matchesMonth;
    });
}

function updateSalarySummary() {
    const filtered = getFilteredSalaryRecords();
    
    // Summary breakdown DOM elements
    const bdBase = document.getElementById('breakdown-base');
    const bdOT = document.getElementById('breakdown-ot');
    const bdPF = document.getElementById('breakdown-pf');
    const bdEOBI = document.getElementById('breakdown-eobi');
    const bdTax = document.getElementById('breakdown-tax');
    const bdST = document.getElementById('breakdown-st');

    if (filtered.length === 0) {
        salTotalNetEl.innerText = `${CURRENCY}0`;
        salTotalDedEl.innerText = `${CURRENCY}0`;
        salAvgNetEl.innerText = `${CURRENCY}0`;
        document.getElementById('breakdown-avg-ot').innerText = '0';
        [bdBase, bdOT, bdPF, bdEOBI, bdTax, bdST].forEach(el => el.innerText = '0');
        return;
    }

    const totalNet = filtered.reduce((acc, r) => acc + r.netPayable, 0);
    const totalDed = filtered.reduce((acc, r) => acc + r.overAllDeduction, 0);
    const totalOT = filtered.reduce((acc, r) => acc + r.overTimeAmount, 0);
    
    // Calculate Breakdowns
    const totalBase = filtered.reduce((acc, r) => acc + r.baseSalary, 0);
    const totalPF = filtered.reduce((acc, r) => acc + r.pfDeduction, 0);
    const totalEOBI = filtered.reduce((acc, r) => acc + r.eobiDeduction, 0);
    const totalTax = filtered.reduce((acc, r) => acc + (r.incomeTax || 0), 0);
    const totalST = filtered.reduce((acc, r) => acc + r.shortTimeAmount, 0);

    const avgNet = totalNet / filtered.length;
    const avgOT = totalOT / filtered.length;

    salTotalNetEl.innerText = `${CURRENCY}${totalNet.toLocaleString()}`;
    salTotalDedEl.innerText = `${CURRENCY}${Math.round(totalDed).toLocaleString()}`;
    salAvgNetEl.innerText = `${CURRENCY}${Math.round(avgNet).toLocaleString()}`;
    document.getElementById('breakdown-avg-ot').innerText = Math.round(avgOT).toLocaleString();
    
    // Update Breakdown Display
    bdBase.innerText = Math.round(totalBase).toLocaleString();
    bdOT.innerText = Math.round(totalOT).toLocaleString();
    bdPF.innerText = Math.round(totalPF).toLocaleString();
    bdEOBI.innerText = Math.round(totalEOBI).toLocaleString();
    bdTax.innerText = Math.round(totalTax).toLocaleString();
    bdST.innerText = Math.round(totalST).toLocaleString();
    
    updateHackerStatus(totalNet);
}

function renderSalaryTable() {
    salaryListEl.innerHTML = '';
    const filtered = getFilteredSalaryRecords();
    const sorted = [...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        
        // Ensure month is MMM-YY
        const dateParts = item.month.split('-');
        const formattedMonth = dateParts.length === 2 ? `${dateParts[0]}-${dateParts[1].slice(-2)}` : item.month;

        tr.innerHTML = `
            <td class="sticky-col" style="font-weight: 600; color: var(--primary);">${formattedMonth}</td>
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
                ${isWithinEditWindow(item.month) ? `
                <button class="icon-btn" onclick="editSalaryRecord('${item.id}')" title="Edit Record">
                    <i data-lucide="edit-3"></i>
                </button>` : ''}
                <button class="icon-btn" onclick="printSalarySlip('${item.id}')" title="Print Slip">
                    <i data-lucide="printer"></i>
                </button>
                <button class="icon-btn delete-btn" onclick="deleteSalaryRecord('${item.id}')" title="Delete">
                    <i data-lucide="trash-2"></i>
                </button>
            </td>
        `;
        salaryListEl.appendChild(tr);
    });
    lucide.createIcons();
}

function renderExtraFundsList() {
    const logSection = document.getElementById('extra-funds-section');
    const tbody = document.getElementById('extra-funds-body');
    if (!logSection || !tbody) return;
    
    // Sort and filter adjustments
    const yearSuffix = salYearFilter === 'all' ? '' : salYearFilter.slice(-2);
    const filtered = adjustmentRecords.filter(a => a.month.includes(yearSuffix));
    
    if (filtered.length === 0) {
        logSection.style.display = 'none';
        return;
    }

    logSection.style.display = 'block';
    tbody.innerHTML = filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).map(a => `
        <tr>
            <td>${a.month}</td>
            <td><span class="badge ${a.type.toLowerCase().replace(' ', '-')}">${a.type}</span></td>
            <td style="font-weight: bold;">${CURRENCY}${a.amount.toLocaleString()}</td>
            <td><div class="remark-text">${a.remarks || '-'}</div></td>
            <td>
                <button class="icon-btn delete-btn" onclick="deleteExtraFund('${a.id}')" title="Delete record">
                    <i data-lucide="trash-2"></i>
                </button>
            </td>
        </tr>
    `).join('');
    lucide.createIcons();
}

async function deleteSalaryRecord(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;

    if (confirm(`Are you sure you want to delete the record for ${rec.month}?`)) {
        setSyncing(true);
        try {
            salaryRecords = salaryRecords.filter(r => r.id !== id);
            await syncWithSheets('delete', 'salary_records', id);
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
            logAudit('Delete', id, `Deleted monthly record for ${rec.month}`);
            renderSalaryView();
            showNotification('Record deleted from Sheets!', 'success');
        } catch (err) {
            console.error('Delete error:', err);
            showNotification('Failed to delete from cloud', 'error');
        } finally {
            setSyncing(false);
        }
    }
}

async function deleteExtraFund(id) {
    const rec = adjustmentRecords.find(r => r.id === id);
    if (!rec) return;

    if (confirm(`Delete ${rec.type} record for ${rec.month}?`)) {
        setSyncing(true);
        try {
            adjustmentRecords = adjustmentRecords.filter(r => r.id !== id);
            await syncWithSheets('delete', 'adjustment_records', id);
            localStorage.setItem('adjustmentRecords', JSON.stringify(adjustmentRecords));
            logAudit('Delete Fund', id, `Deleted fund record: ${rec.type} for ${rec.month}`);
            renderSalaryView();
            showNotification('Fund record deleted from Sheets', 'success');
        } catch (err) {
            console.error('Delete error:', err);
            showNotification('Failed to delete from cloud', 'error');
        } finally {
            setSyncing(false);
        }
    }
}

function isWithinEditWindow(monthStr) {
    if (salaryRecords.length === 0) return true;
    
    // Sort all records by date to find the absolute latest
    const sorted = [...salaryRecords].sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestDate = new Date(sorted[0].date);
    
    // Convert target month to a date (approximate to 1st of that month)
    const parts = monthStr.split('-');
    const mNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIdx = mNames.indexOf(parts[0]);
    const year = parseInt('20' + parts[1]);
    const targetDate = new Date(year, monthIdx, 1);

    // Calculate month difference
    const diffMonths = (latestDate.getFullYear() - targetDate.getFullYear()) * 12 + (latestDate.getMonth() - targetDate.getMonth());
    
    return diffMonths <= 2;
}

function editSalaryRecord(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;

    isEditing = id;
    document.getElementById('sal-month').value = rec.month;
    document.getElementById('sal-base').value = rec.baseSalary;
    document.getElementById('sal-tot-days').value = rec.totalDays;
    document.getElementById('sal-absent').value = rec.totalDays - rec.workingDays;
    document.getElementById('sal-st').value = Math.round(rec.shortTimeAmount / (rec.baseSalary / 208));
    document.getElementById('sal-ot').value = rec.otHrs || 0;
    document.getElementById('sal-pf').value = rec.pfDeduction;
    document.getElementById('sal-eobi').value = rec.eobiDeduction;
    document.getElementById('sal-tax').value = rec.incomeTax || 0;
    document.getElementById('sal-wop').value = rec.withoutPay || 0;
    document.getElementById('sal-other-ded').value = rec.otherDeductions || 0;
    document.getElementById('sal-allowance').value = rec.allowance || 0;
    document.getElementById('sal-remarks').value = rec.remarks || '';

    // Mark as manual if they differ from defaults
    // (Logic for that would be complex, better to just let user toggle if needed)
    
    salaryModal.style.display = 'flex';
}

function populateSalaryFilters() {
    const years = [...new Set(salaryRecords.map(r => {
        const parts = r.month.split('-');
        return parts.length > 1 ? '20' + parts[1] : null;
    }))].filter(y => y).sort();

    const currentYear = salYearSelect.value;
    salYearSelect.innerHTML = '<option value="all">All Years</option>';
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.innerText = year;
        salYearSelect.appendChild(option);
    });

    if (Array.from(salYearSelect.options).some(o => o.value === currentYear)) {
        salYearSelect.value = currentYear;
    }
}

function initSalaryChart() {
    const ctx = document.getElementById('salary-chart').getContext('2d');
    if (salaryChartInstance) salaryChartInstance.destroy();

    const sorted = [...salaryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    const labels = sorted.map(r => r.month);
    const netData = sorted.map(r => r.netPayable);
    const grossData = sorted.map(r => r.grossSalary);

    // Create Premium Gradients
    const netGradient = ctx.createLinearGradient(0, 0, 0, 300);
    netGradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
    netGradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

    const grossGradient = ctx.createLinearGradient(0, 0, 0, 300);
    grossGradient.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
    grossGradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

    salaryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { 
                    label: 'Net Payable', 
                    data: netData, 
                    borderColor: '#10b981', 
                    backgroundColor: netGradient, 
                    fill: true, 
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: 'rgba(255,255,255,0.2)',
                    pointHoverRadius: 6
                },
                { 
                    label: 'Gross Salary', 
                    data: grossData, 
                    borderColor: '#6366f1', 
                    backgroundColor: grossGradient,
                    borderDash: [5, 5], 
                    fill: true, 
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: { 
                legend: { 
                    position: 'top',
                    align: 'end',
                    labels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 }, usePointStyle: true } 
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: { family: 'Outfit' },
                    bodyFont: { family: 'Outfit' },
                    padding: 12,
                    displayColors: true,
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }
            },
            scales: {
                y: { 
                    grid: { color: 'rgba(255,255,255,0.03)' }, 
                    ticks: { 
                        color: '#94a3b8',
                        callback: function(value) { return 'Rs.' + value.toLocaleString(); }
                    } 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { color: '#94a3b8' } 
                }
            }
        }
    });
}



function seedSalaryData() {
    const data = [
        { month: 'Dec-23', date: '2023-12-01', baseSalary: 4444, totalDays: 3, workingDays: 3, shortTimeAmount: 26, overTimeAmount: 0, otHrs: 0, pfDeduction: 0, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Jan-24', date: '2024-01-01', baseSalary: 38514, totalDays: 31, workingDays: 27, shortTimeAmount: 1148, overTimeAmount: 0, otHrs: 0, pfDeduction: 3212, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Feb-24', date: '2024-02-01', baseSalary: 38514, totalDays: 29, workingDays: 23, shortTimeAmount: 842, overTimeAmount: 0, otHrs: 0, pfDeduction: 3212, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Mar-24', date: '2024-03-01', baseSalary: 38514, totalDays: 31, workingDays: 27, shortTimeAmount: 19, overTimeAmount: 5925, otHrs: 16, pfDeduction: 3212, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Apr-24', date: '2024-04-01', baseSalary: 38514, totalDays: 30, workingDays: 25, shortTimeAmount: 9, overTimeAmount: 20738, otHrs: 40, pfDeduction: 3212, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'May-24', date: '2024-05-01', baseSalary: 38514, totalDays: 31, workingDays: 24, shortTimeAmount: 0, overTimeAmount: 2963, otHrs: 8, pfDeduction: 3212, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Jun-24', date: '2024-06-01', baseSalary: 38514, totalDays: 30, workingDays: 14.09, shortTimeAmount: 177, overTimeAmount: 0, otHrs: 0, pfDeduction: 3212, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Jul-24', date: '2024-07-01', baseSalary: 44532, totalDays: 31, workingDays: 21, shortTimeAmount: 101, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 320, incomeTax: 0, withoutPay: 0, remarks: 'Rs/- 16 Less Pay' },
        { month: 'Aug-24', date: '2024-08-01', baseSalary: 44532, totalDays: 31, workingDays: 24, shortTimeAmount: 0, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 320, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Sep-24', date: '2024-09-01', baseSalary: 44532, totalDays: 30, workingDays: 23.54, shortTimeAmount: 0, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 250, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Oct-24', date: '2024-10-01', baseSalary: 44532, totalDays: 31, workingDays: 23, shortTimeAmount: 364, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 590, incomeTax: 0, withoutPay: 2346, remarks: '' },
        { month: 'Nov-24', date: '2024-11-01', baseSalary: 44532, totalDays: 30, workingDays: 23.43, shortTimeAmount: 59, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 370, incomeTax: 0, withoutPay: 1165, remarks: '' },
        { month: 'Dec-24', date: '2024-12-01', baseSalary: 44532, totalDays: 31, workingDays: 23, shortTimeAmount: 370, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 370, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Jan-25', date: '2025-01-01', baseSalary: 44532, totalDays: 31, workingDays: 25.88, shortTimeAmount: 591, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 370, incomeTax: 0, withoutPay: 0, remarks: '' },
        { month: 'Feb-25', date: '2025-02-01', baseSalary: 44532, totalDays: 28, workingDays: 23.00, shortTimeAmount: 600, overTimeAmount: 0, otHrs: 0, pfDeduction: 3714, eobiDeduction: 370, incomeTax: 0, withoutPay: 0, remarks: '' }
    ];

    salaryRecords = data.map(item => {
        const grossSalary = item.baseSalary + item.overTimeAmount;
        const overAllDeduction = item.pfDeduction + item.eobiDeduction + (item.incomeTax || 0) + item.shortTimeAmount + item.withoutPay;
        const netPayable = grossSalary - overAllDeduction;
        return { ...item, id: Math.random().toString(36).substr(2, 9), grossSalary, overAllDeduction, netPayable };
    });
    localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
}

// Modal Logic
const salaryModal = document.getElementById('salary-modal');
const closeSalaryModalBtn = document.getElementById('close-salary-modal');
const salaryForm = document.getElementById('salary-form');

addSalaryBtn.addEventListener('click', () => salaryModal.style.display = 'flex');
closeSalaryModalBtn.addEventListener('click', () => salaryModal.style.display = 'none');

salaryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const month = document.getElementById('sal-month').value;
    const baseSalary = +document.getElementById('sal-base').value;
    const totalDays = +document.getElementById('sal-tot-days').value;
    const absentDays = +document.getElementById('sal-absent').value;
    const workingDays = totalDays - absentDays;
    
    const shortTimeAmount = +document.getElementById('sal-st-amount').value || 0;
    const overTimeAmount = +document.getElementById('sal-ot-amount').value || 0;
    const pfDeduction = +document.getElementById('sal-pf').value || 0;
    const eobiDeduction = +document.getElementById('sal-eobi').value || 0;
    const incomeTax = +document.getElementById('sal-tax').value || 0;
    const withoutPay = +document.getElementById('sal-wop').value || 0;
    const remarks = document.getElementById('sal-remarks').value;
    const otherDeductions = +document.getElementById('sal-other-ded').value || 0;
    const allowance = +document.getElementById('sal-allowance').value || 0;

    const grossSalary = baseSalary + overTimeAmount + allowance;
    const overAllDeduction = pfDeduction + eobiDeduction + incomeTax + shortTimeAmount + withoutPay + otherDeductions;
    const netPayable = grossSalary - overAllDeduction;

    const newRec = { 
        id: isEditing || Math.random().toString(36).substr(2, 9), 
        month, 
        date: new Date().toISOString(), 
        baseSalary, 
        totalDays, 
        workingDays, 
        shortTimeAmount, 
        overTimeAmount, 
        otherDeductions,
        allowance,
        pfDeduction, 
        eobiDeduction, 
        incomeTax, 
        withoutPay, 
        remarks: remarks || '', 
        grossSalary, 
        overAllDeduction, 
        netPayable 
    };

    setSyncing(true);
    try {
        if (isEditing) {
            const index = salaryRecords.findIndex(r => r.id === isEditing);
            salaryRecords[index] = newRec;
            await syncWithSheets('saveSalary', 'salary_records', newRec);
            logAudit('Edit', isEditing, `Updated record for ${month}. Base: ${baseSalary}`);
            isEditing = null;
        } else {
            salaryRecords.push(newRec);
            await syncWithSheets('saveSalary', 'salary_records', newRec);
            logAudit('Add', newRec.id, `Added record for ${month}. Net: ${netPayable}`);
        }

        localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
        salaryForm.reset();
        salaryModal.style.display = 'none';
        renderSalaryView();
        showNotification('Saved to Google Sheets!', 'success');
    } catch (err) {
        console.error('Save Error:', err);
        showNotification(`Sheets Error: ${err.message || 'Check Connection'}`, 'error');
    } finally {
        setSyncing(false);
    }
});

// Extra Fund Modal Logic
const fundModal = document.getElementById('fund-modal');
const fundForm = document.getElementById('fund-form');
const addFundBtn = document.getElementById('add-fund-btn');
const closeFundModalBtn = document.getElementById('close-fund-modal');

addFundBtn.addEventListener('click', () => fundModal.style.display = 'flex');
closeFundModalBtn.addEventListener('click', () => fundModal.style.display = 'none');

fundForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const month = document.getElementById('fund-month').value;
    const type = document.getElementById('fund-type').value;
    const amount = +document.getElementById('fund-amount').value || 0;
    const remarks = document.getElementById('fund-remarks').value;

    const newFund = {
        id: Math.random().toString(36).substr(2, 9),
        month,
        type,
        amount,
        remarks: remarks || '',
        date: new Date().toISOString()
    };

    setSyncing(true);
    try {
        adjustmentRecords.push(newFund);
        await syncWithSheets('saveAdjustment', 'adjustment_records', newFund);
        localStorage.setItem('adjustmentRecords', JSON.stringify(adjustmentRecords));
        logAudit('Add Fund', newFund.id, `Added ${type} for ${month}: ${amount}`);
        fundForm.reset();
        fundModal.style.display = 'none';
        renderSalaryView();
        showNotification(`${type} saved to Google Sheets!`, 'success');
    } catch (err) {
        console.error('Fund Error:', err);
        showNotification(`Cloud Error: ${err.message || 'Check Connection'}`, 'error');
    } finally {
        setSyncing(false);
    }
});

// Close listeners to reset state
closeSalaryModalBtn.addEventListener('click', () => {
    isEditing = null;
    salaryForm.reset();
});

// Security Management
const securityModal = document.getElementById('security-modal');
const closeSecurityModalBtn = document.getElementById('close-security-modal');
const securityForm = document.getElementById('security-form');
const securityError = document.getElementById('security-error');

function openSecurityModal() {
    securityModal.style.display = 'flex';
}

closeSecurityModalBtn.addEventListener('click', () => {
    securityModal.style.display = 'none';
});

securityForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = document.getElementById('current-pin').value;
    const next = document.getElementById('new-pin').value;
    const confirm = document.getElementById('confirm-pin').value;

    if (current !== vaultPIN) {
        showSecurityError('Current PIN is incorrect');
        return;
    }

    if (next !== confirm) {
        showSecurityError('New PINs do not match');
        return;
    }

    if (next.length < 4 || next.length > 16 || isNaN(next)) {
        showSecurityError('PIN must be 4 to 16 digits');
        return;
    }

    setSyncing(true);
    try {
        vaultPIN = next;
        recoveryPhrase = document.getElementById('recovery-phrase').value;
        localStorage.setItem('vaultPIN', vaultPIN);
        localStorage.setItem('recoveryPhrase', recoveryPhrase);
        
        // Eventually we sync this to a 'profile' table in Supabase
        await logAudit('Security Update', 'SYSTEM', 'PIN and/or Recovery Phrase updated');
        
        showNotification('Secret Key updated successfully!', 'success');
        securityForm.reset();
        securityModal.style.display = 'none';
        isLocked = false;
    } catch (err) {
        console.error('Security Update Error:', err);
    } finally {
        setSyncing(false);
    }
});

// Audit Log Logic
const auditModal = document.getElementById('audit-modal');
const closeAuditModalBtn = document.getElementById('close-audit-modal');
const auditListEl = document.getElementById('audit-list');

async function logAudit(action, recordId, details) {
    const entry = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        action,
        recordId: recordId || 'SYSTEM',
        details
    };
    auditLog.unshift(entry);
    if (auditLog.length > 100) auditLog.pop();
    
    localStorage.setItem('auditLog', JSON.stringify(auditLog));
    await syncWithSheets('logAudit', 'audit_log', entry);
}

function openAuditLog() {
    renderAuditLog();
    auditModal.style.display = 'flex';
}

closeAuditModalBtn.addEventListener('click', () => auditModal.style.display = 'none');

function renderAuditLog() {
    if (auditLog.length === 0) {
        auditListEl.innerHTML = '<div class="empty-log">No activity recorded yet.</div>';
        return;
    }

    auditListEl.innerHTML = auditLog.map(entry => `
        <tr class="audit-row">
            <td class="audit-time">${new Date(entry.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td><span class="audit-action badge ${entry.action.toLowerCase().replace(' ', '-')}">${entry.action}</span></td>
            <td class="audit-details"><div>${entry.details}</div></td>
        </tr>
    `).join('');
}

function openForgotPinFlow() {
    if (!recoveryPhrase) {
        showNotification("No recovery phrase set. Cannot reset PIN.", "error");
        return;
    }
    
    // Reset modal state
    document.getElementById('recovery-answer').value = '';
    document.getElementById('recovery-new-pin').value = '';
    document.getElementById('new-pin-section').style.display = 'none';
    document.getElementById('recovery-error').style.display = 'none';
    document.getElementById('recovery-title').innerText = "Identity Verification";
    document.getElementById('recovery-subtitle').innerText = "Enter recovery phrase to reset PIN";
    document.getElementById('submit-recovery').innerText = "Verify Identity";
    
    document.getElementById('recovery-modal').style.display = 'flex';
}

// Recovery Handlers
document.getElementById('cancel-recovery').addEventListener('click', () => {
    document.getElementById('recovery-modal').style.display = 'none';
});

document.getElementById('submit-recovery').addEventListener('click', () => {
    const step = document.getElementById('new-pin-section').style.display === 'none' ? 'verify' : 'reset';
    const errorEl = document.getElementById('recovery-error');
    
    if (step === 'verify') {
        const answer = document.getElementById('recovery-answer').value.trim().toLowerCase();
        if (answer === recoveryPhrase.toLowerCase()) {
            document.getElementById('new-pin-section').style.display = 'block';
            document.getElementById('recovery-title').innerText = "Security Override";
            document.getElementById('recovery-subtitle').innerText = "Identity confirmed. Set new key.";
            document.getElementById('submit-recovery').innerText = "Reset PIN";
            errorEl.style.display = 'none';
        } else {
            errorEl.innerText = "Incorrect recovery phrase.";
            errorEl.style.display = 'block';
        }
    } else {
        const newKey = document.getElementById('recovery-new-pin').value;
        if (newKey && newKey.length >= 4 && newKey.length <= 16 && !isNaN(newKey)) {
            vaultPIN = newKey;
            localStorage.setItem('vaultPIN', vaultPIN);
            showNotification("PIN reset successful!", "success");
            logAudit('PIN Reset', 'SYSTEM', 'PIN reset via recovery phrase');
            document.getElementById('recovery-modal').style.display = 'none';
        } else {
            errorEl.innerText = "PIN must be 4 to 16 digits.";
            errorEl.style.display = 'block';
        }
    }
});

// Final Initialization
document.addEventListener('DOMContentLoaded', () => {
    initCloud();
    initIdentity();
    initTheme();
    setupFilters();
    checkAndSyncData();
    lucide.createIcons();
});

async function initCloud() {
    // Small delay to ensure everything is ready
    await new Promise(res => setTimeout(res, 300)); 
    
    const statusText = document.getElementById('cloud-status-text');
    const statusIndicator = document.getElementById('cloud-sync-indicator');
    const statusFill = document.getElementById('status-fill');

    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes('PASTE')) {
        if (statusText) statusText.innerText = 'SHEETS: SETUP NEEDED';
        return;
    }

    try {
        const response = await fetch(`${GOOGLE_SHEET_URL}?action=fetchAll`);
        if (!response.ok) throw new Error('Network error');
        
        if (statusText) statusText.innerText = 'SHEETS: ONLINE';
        if (statusIndicator) statusIndicator.classList.add('online');
        if (statusFill) statusFill.style.width = '100.2%'; 
        console.log('Hassan Hub: Sheets Link Active 📊✅');
        
        const data = await response.json();
        if (data.salaries) salaryRecords = data.salaries;
        if (data.adjustments) adjustmentRecords = data.adjustments;
        if (data.logs) auditLog = data.logs;
        renderSalaryView();
        
    } catch (err) {
        console.error('Sheets Connection Failed:', err);
        if (statusText) statusText.innerText = 'SHEETS: OFFLINE';
        if (statusIndicator) statusIndicator.classList.remove('online');
        if (statusFill) statusFill.style.width = '10%';
    }
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `notification ${type}`;
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    if (type === 'warning') icon = 'alert-triangle';

    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <div class="notif-content">
            <div class="notif-msg">${message}</div>
        </div>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function showSecurityError(msg) {
    securityError.innerText = msg;
    securityError.style.display = 'block';
    setTimeout(() => securityError.style.display = 'none', 3000);
}

function showView(view) {
    // Basic view switching logic can be expanded here
}

function printSalarySlip(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;

    // Populate Template
    document.getElementById('slip-name').innerText = localStorage.getItem('userName') || 'Mr Hacker';
    document.getElementById('slip-month').innerText = rec.month;
    document.getElementById('slip-base').innerText = `${CURRENCY}${rec.baseSalary.toLocaleString()}`;
    document.getElementById('slip-gross').innerText = `${CURRENCY}${rec.grossSalary.toLocaleString()}`;
    document.getElementById('slip-deductions').innerText = `-${CURRENCY}${rec.overAllDeduction.toLocaleString()}`;
    document.getElementById('slip-net').innerText = `${CURRENCY}${rec.netPayable.toLocaleString()}`;

    // Trigger Print
    window.print();
}

// Yearly Summary Logic
const yearlySummaryModal = document.getElementById('yearly-summary-modal');

function openYearlySummary() {
    const years = [...new Set(salaryRecords.map(r => {
        const parts = r.month.split('-');
        return parts.length > 1 ? '20' + parts[1] : null;
    }))].filter(y => y).sort().reverse();

    const select = document.getElementById('summary-year-select');
    select.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    
    if (years.length > 0) {
        updateYearlySummary();
    }
    yearlySummaryModal.style.display = 'flex';
}

function closeYearlySummary() {
    yearlySummaryModal.style.display = 'none';
}

function updateYearlySummary() {
    const year = document.getElementById('summary-year-select').value;
    const yearSuffix = year.slice(-2);
    
    // Get unique months from both sources
    const monthsInSalary = salaryRecords.filter(r => r.month.includes(yearSuffix)).map(r => r.month);
    const monthsInAdjs = adjustmentRecords.filter(r => r.month.includes(yearSuffix)).map(r => r.month);
    const allMonths = [...new Set([...monthsInSalary, ...monthsInAdjs])];

    const monthlySummaries = allMonths.map(m => {
        const salRec = salaryRecords.find(r => r.month === m);
        const adjs = adjustmentRecords.filter(r => r.month === m);
        
        return {
            month: m,
            base: salRec ? salRec.baseSalary : 0,
            ot: salRec ? (salRec.overTimeAmount || 0) : 0,
            otherDed: salRec ? (salRec.otherDeductions || 0) : 0,
            allowance: (salRec ? (salRec.allowance || 0) : 0) + adjs.filter(a => a.type === 'Other').reduce((sum, a) => sum + a.amount, 0),
            pf: salRec ? salRec.pfDeduction : 0,
            eobi: salRec ? salRec.eobiDeduction : 0,
            stWop: salRec ? ((salRec.shortTimeAmount || 0) + (salRec.withoutPay || 0)) : 0,
            wppf: adjs.filter(a => a.type === 'WPPF').reduce((sum, a) => sum + a.amount, 0),
            pfWd: adjs.filter(a => a.type === 'PF Withdrawal').reduce((sum, a) => sum + a.amount, 0),
            tax: salRec ? (salRec.incomeTax || 0) : 0,
            net: (salRec ? salRec.netPayable : 0) + adjs.filter(a => a.type !== 'PF Withdrawal').reduce((sum, a) => sum + a.amount, 0)
        };
    }).sort((a, b) => {
        const mNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return mNames.indexOf(a.month.split('-')[0]) - mNames.indexOf(b.month.split('-')[0]);
    });

    // Aggregate Master Totals
    const totalGross = monthlySummaries.reduce((acc, r) => acc + r.base + r.ot + r.allowance + r.wppf, 0);
    const totalTax = monthlySummaries.reduce((acc, d) => acc + d.tax, 0);
    const totalNet = monthlySummaries.reduce((acc, r) => acc + r.net, 0);
    const totalDeductions = monthlySummaries.reduce((acc, r) => acc + r.pf + r.eobi + r.stWop + r.tax + r.otherDed, 0);
    
    const totalPF = monthlySummaries.reduce((acc, r) => acc + r.pf, 0);
    const totalEOBI = monthlySummaries.reduce((acc, r) => acc + r.eobi, 0);
    const totalST = monthlySummaries.reduce((acc, r) => acc + r.stWop, 0);
    const totalSavings = totalPF + totalEOBI;
    const totalWindfall = monthlySummaries.reduce((acc, r) => acc + r.wppf + r.pfWd, 0);
    const avgNet = monthlySummaries.length > 0 ? Math.round(totalNet / monthlySummaries.length) : 0;

    // Update Master Cards
    document.getElementById('year-total-gross').innerText = `${CURRENCY}${totalGross.toLocaleString()}`;
    document.getElementById('year-breakdown-base').innerText = monthlySummaries.reduce((acc, r) => acc + r.base, 0).toLocaleString();
    document.getElementById('year-breakdown-extras').innerText = monthlySummaries.reduce((acc, r) => acc + r.ot + r.allowance, 0).toLocaleString();

    document.getElementById('year-total-ded').innerText = `${CURRENCY}${totalDeductions.toLocaleString()}`;
    document.getElementById('year-breakdown-pf').innerText = totalPF.toLocaleString();
    document.getElementById('year-breakdown-eobi').innerText = totalEOBI.toLocaleString();
    document.getElementById('year-breakdown-tax').innerText = totalTax.toLocaleString();
    document.getElementById('year-breakdown-st').innerText = totalST.toLocaleString();

    document.getElementById('year-total-net').innerText = `${CURRENCY}${totalNet.toLocaleString()}`;
    document.getElementById('year-breakdown-avg').innerText = avgNet.toLocaleString();
    document.getElementById('year-breakdown-savings').innerText = totalSavings.toLocaleString();
    document.getElementById('year-breakdown-windfall').innerText = totalWindfall.toLocaleString();

    if (window.lucide) lucide.createIcons();

    const tbody = document.getElementById('yearly-summary-body');
    tbody.innerHTML = monthlySummaries.map(rec => `
        <tr>
            <td>${rec.month}</td>
            <td>${rec.base.toLocaleString()}</td>
            <td>${(rec.ot + rec.bonus + rec.allowance).toLocaleString()}</td>
            <td>${rec.pf.toLocaleString()}</td>
            <td>${rec.eobi.toLocaleString()}</td>
            <td>${rec.stWop.toLocaleString()}</td>
            <td>${rec.wppf.toLocaleString()}</td>
            <td>${rec.pfWd.toLocaleString()}</td>
            <td class="text-danger">${rec.tax.toLocaleString()}</td>
            <td style="font-weight: bold;">${rec.net.toLocaleString()}</td>
        </tr>
    `).join('');
}

function backupData() {
    const data = {
        salaryRecords: salaryRecords,
        vaultPIN: vaultPIN,
        userName: localStorage.getItem('userName'),
        theme: localStorage.getItem('theme'),
        backupDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Salary_Hub_Backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showNotification('Backup generated successfully', 'success');
}

function restoreData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.salaryRecords) {
                if (confirm('Are you sure? This will replace your current records and settings.')) {
                    salaryRecords = data.salaryRecords;
                    vaultPIN = data.vaultPIN || '1337';
                    localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
                    localStorage.setItem('vaultPIN', vaultPIN);
                    if (data.userName) localStorage.setItem('userName', data.userName);
                    if (data.theme) localStorage.setItem('theme', data.theme);
                    
                    showNotification('System restored successfully!', 'success');
                    setTimeout(() => window.location.reload(), 1500);
                }
            } else {
                showNotification('Invalid backup file', 'error');
            }
        } catch (err) {
            showNotification('Error parsing backup file', 'error');
        }
    };
    reader.readAsText(file);
}

// Global Click listener for modesty
window.onclick = function(event) {
    if (event.target == salaryModal) salaryModal.style.display = "none";
    if (event.target == securityModal) securityModal.style.display = "none";
    if (event.target == yearlySummaryModal) yearlySummaryModal.style.display = "none";
}

// Initial Call is handled by DOMContentLoaded at the end of the file

// Auto-Calculation Engine
function autoCalculateSalary() {
    const base = +document.getElementById('sal-base').value || 0;
    const totDays = +document.getElementById('sal-tot-days').value || 0;
    const absent = +document.getElementById('sal-absent').value || 0;
    const stHrs = +document.getElementById('sal-st').value || 0;
    const otHrs = +document.getElementById('sal-ot').value || 0;

    const workingDays = totDays - absent;
    const hourlyRate = base / 208;

    // Calculation from Excel Formulas
    const stAmount = Math.round(hourlyRate * stHrs);
    const otAmount = Math.round(hourlyRate * otHrs * 2);
    
    // PF Override Check
    if (!document.getElementById('pf-manual').checked) {
        const pf = (workingDays > 13 && base > 0) ? Math.round(base * 8.34 / 100) : 0;
        document.getElementById('sal-pf').value = pf;
    }
    
    // EOBI Override Check
    if (!document.getElementById('eobi-manual').checked) {
        const eobi = base > 0 ? 370 : 0;
        document.getElementById('sal-eobi').value = eobi;
    }

    // Tax Override Check
    if (!document.getElementById('tax-manual').checked) {
        const annual = base * 12;
        let annualTax = 0;
        if (annual > 600000 && annual <= 1200000) {
            annualTax = (annual - 600000) * 0.01;
        } else if (annual > 1200000) {
            annualTax = (600000 * 0.01) + (annual - 1200000) * 0.02; 
        }
        const monthlyTax = Math.round(annualTax / 12);
        document.getElementById('sal-tax').value = monthlyTax;
    }

    // Update ST/OT previews
    document.getElementById('sal-st-amount').value = stAmount;
    document.getElementById('sal-ot-amount').value = otAmount;
}

// Bind listeners for toggles to swap icons & toggle readonly
['pf-manual', 'eobi-manual', 'tax-manual'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
        const icon = e.target.nextElementSibling;
        const targetInputId = 'sal-' + id.split('-')[0];
        const targetInput = document.getElementById(targetInputId);
        
        if (e.target.checked) {
            icon.setAttribute('data-lucide', 'lock-open');
            targetInput.readOnly = false;
            targetInput.focus();
        } else {
            icon.setAttribute('data-lucide', 'lock');
            targetInput.readOnly = true;
            autoCalculateSalary(); // Recalculate if locked back
        }
        lucide.createIcons();
    });
});

// Bind listeners
['sal-base', 'sal-tot-days', 'sal-absent', 'sal-st', 'sal-ot', 'sal-bonus', 'sal-allowance'].forEach(id => {
    document.getElementById(id).addEventListener('input', autoCalculateSalary);
});

// Smart Month Parsing
document.getElementById('sal-month').addEventListener('blur', (e) => {
    const val = e.target.value;
    const meta = getMonthMetadata(val);
    if (meta) {
        document.getElementById('sal-tot-days').value = meta.workingDays;
        autoCalculateSalary();
    }
});

function getMonthMetadata(monthStr) {
    const match = monthStr.match(/^([a-zA-Z]{3})-(\d{2})$/);
    if (!match) return null;
    
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = monthNames.indexOf(match[1].toLowerCase());
    const year = 2000 + parseInt(match[2]);
    if (month === -1) return null;

    const totalDays = new Date(year, month + 1, 0).getDate();
    let workingDays = 0;
    for (let i = 1; i <= totalDays; i++) {
        const d = new Date(year, month, i);
        if (d.getDay() !== 0) workingDays++; // Exclude Sundays
    }
    
    return { totalDays, workingDays };
}

// CSV Export & Import
document.getElementById('export-salary-csv').addEventListener('click', () => {
    if (salaryRecords.length === 0 && adjustmentRecords.length === 0) return alert('No data to export');
    
    // Salary Section
    const salHeaders = ['Month', 'Salary', 'Total Days', 'Working Days', 'Short Time Amount', 'Over Time Amount', 'OT Hrs.', 'Bonus', 'Allowance', 'PF Deduction', 'EOBI Deduction', 'Income Tax', 'Without Pay', 'Over All Deduction', 'Gross Salary', 'Net Payable', 'Remarks'];
    const salRows = salaryRecords.map(r => [
        r.month, 
        r.baseSalary, 
        r.totalDays, 
        r.workingDays, 
        r.shortTimeAmount, 
        r.overTimeAmount,
        r.otHrs || 0,
        r.bonus || 0,
        r.allowance || 0,
        r.pfDeduction, 
        r.eobiDeduction, 
        r.incomeTax || 0, 
        r.withoutPay, 
        r.overAllDeduction,
        r.grossSalary,
        r.netPayable, 
        r.remarks.replace(/,/g, ';')
    ]);

    // Funds Section
    const fundHeaders = ['', 'EXTRA FUNDS LOG', '', 'Month', 'Type', 'Amount', 'Remarks'];
    const fundRows = adjustmentRecords.map(a => ['', '', '', a.month, a.type, a.amount, a.remarks.replace(/,/g, ';')]);

    let csvContent = "data:text/csv;charset=utf-8," + salHeaders.join(",") + "\n" + salRows.map(e => e.join(",")).join("\n");
    csvContent += "\n\n" + fundHeaders.join(",") + "\n" + fundRows.map(e => e.join(",")).join("\n");

    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Salary_Hub_Export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
});

document.getElementById('export-audit-csv').addEventListener('click', () => {
    if (auditLog.length === 0) return showNotification('No activity log entries to export', 'error');
    
    const headers = ['Timestamp', 'Action', 'Target ID', 'Details'];
    const rows = auditLog.map(log => [
        log.timestamp,
        log.type,
        log.targetId,
        log.details.replace(/,/g, ';')
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Salary_Hub_Activity_Log_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showNotification('Activity log exported!', 'success');
});

document.getElementById('export-funds-only-csv').addEventListener('click', () => {
    if (adjustmentRecords.length === 0) return showNotification('No fund records to export', 'error');
    
    const headers = ['Month', 'Date Recorded', 'Type', 'Amount', 'Remarks'];
    const rows = adjustmentRecords.map(a => [
        a.month,
        new Date(a.date).toLocaleDateString(),
        a.type,
        a.amount,
        a.remarks ? a.remarks.replace(/,/g, ';') : '-'
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Salary_Hub_Extra_Funds_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showNotification('Extra funds exported!', 'success');
});

document.getElementById('import-salary-csv').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        const lines = text.split('\n');
        if (lines.length < 2) return showNotification('Invalid CSV file selected', 'error');

        const importedData = [];
        // Smart CSV parser to handle quotes and commas inside values
        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let char of line) {
                if (char === '"' && !inQuotes) inQuotes = true;
                else if (char === '"' && inQuotes) inQuotes = false;
                else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim());
            return result;
        };

        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            if (cols.length < 2) continue;

            // Clean number values (remove commas if present)
            const cleanNum = (val) => val ? parseFloat(val.replace(/,/g, '')) : 0;

            const baseSalary = cleanNum(cols[1]);
            const shortTimeAmount = cleanNum(cols[4]);
            const overTimeAmount = cleanNum(cols[5]);
            const pfDeduction = cleanNum(cols[7]);
            const eobiDeduction = cleanNum(cols[8]);
            const incomeTax = cleanNum(cols[9]);
            const withoutPay = cleanNum(cols[10]);

            const grossSalary = cleanNum(cols[12]) || (baseSalary + overTimeAmount);
            const overAllDeduction = cleanNum(cols[11]) || (pfDeduction + eobiDeduction + incomeTax + shortTimeAmount + withoutPay);
            const netPayable = cleanNum(cols[13]) || (grossSalary - overAllDeduction);

            importedData.push({
                id: Math.random().toString(36).substr(2, 9),
                month: cols[0],
                date: new Date().toISOString(),
                baseSalary,
                totalDays: +cols[2] || 31,
                workingDays: +cols[3] || 25,
                shortTimeAmount,
                overTimeAmount,
                otHrs: cleanNum(cols[6]),
                pfDeduction,
                eobiDeduction,
                incomeTax,
                withoutPay,
                remarks: cols[14] ? cols[14].replace(/;/g, ',') : '',
                grossSalary,
                overAllDeduction,
                netPayable
            });
        }

        if (confirm(`Import ${importedData.length} records?`)) {
            salaryRecords = [...salaryRecords, ...importedData];
            localStorage.setItem('salaryRecords', JSON.stringify(salaryRecords));
            renderSalaryView();
            showNotification(`Imported ${importedData.length} records successfully!`, 'success');
        }
        e.target.value = '';
    };
    reader.readAsText(file);
});

// Filter Listeners
salYearSelect.addEventListener('change', (e) => { salYearFilter = e.target.value; renderSalaryView(); });
salMonthSelect.addEventListener('change', (e) => { salMonthFilter = e.target.value; renderSalaryView(); });

// Final Initialization
document.addEventListener('DOMContentLoaded', () => {
    try {
        init(); // Initial UI states
    } catch (e) { console.warn('Init error:', e); }

    try {
        initCloud(); // Connect to Supabase
    } catch (e) { console.warn('Cloud init error:', e); }

    try {
        initKeypad(); // Attach keypad listeners
    } catch (e) { console.warn('Keypad error:', e); }

    lucide.createIcons();
});

function initTheme() {
    applyStoredTheme();
}

function setupFilters() {
    // Filters are handled by renderSalaryView and change listeners
}

function applyStoredTheme() {
    const theme = localStorage.getItem('theme') || 'default';
    document.documentElement.setAttribute('data-theme', theme);
    themeBtns.forEach(btn => {
        if (btn.dataset.theme === theme) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function initKeypad() {
    const pinBtns = document.querySelectorAll('.pin-btn');
    if (!pinBtns) return;

    pinBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.textContent.trim();
            if (btn.id === 'clear-pin' || val === 'C') { 
                currentPIN = ''; 
                updatePINDots(); 
                document.getElementById('vault-msg').innerText = "Enter decryption key to proceed";
                return; 
            }
            if (btn.id === 'enter-pin') {
                if (currentPIN.length >= 4) {
                    if (currentPIN === vaultPIN) unlockVault();
                    else loginFailure();
                } else {
                    document.getElementById('vault-msg').innerText = "PIN MUST BE 4+ DIGITS";
                }
                return;
            }
            if (/^\d$/.test(val) && currentPIN.length < 16) { 
                currentPIN += val; 
                updatePINDots(); 
            }
        });
    });
    updatePINDots();
}

function updatePINDots() {
    const pinDisplay = document.getElementById('pin-display');
    if (!pinDisplay) return;
    pinDisplay.innerHTML = '';
    for (let i = 0; i < currentPIN.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot active';
        pinDisplay.appendChild(dot);
    }
    // Add 4 empty dots if no PIN entered yet for aesthetic
    if (currentPIN.length === 0) {
        for (let i = 0; i < 4; i++) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            pinDisplay.appendChild(dot);
        }
    }
}

function loginFailure() {
    currentPIN = ''; 
    updatePINDots(); 
    const msg = document.getElementById('vault-msg');
    msg.innerText = "ACCESS DENIED"; 
    msg.classList.add('shake');
    setTimeout(() => msg.classList.remove('shake'), 500);
    logAudit('SECURITY ALERT', 'VAULT', 'Incorrect PIN attempt detected');
}

function unlockVault() { 
    isLocked = false; 
    vaultOverlay.style.opacity = '0'; 
    setTimeout(() => { 
        vaultOverlay.style.display = 'none'; 
        init(); 
        checkAndSyncData(); // Migration Engine
    }, 500); 
}
themeBtns.forEach(btn => { btn.addEventListener('click', () => { const t = btn.dataset.theme; document.documentElement.setAttribute('data-theme', t); localStorage.setItem('theme', t); themeBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); }); });
function applyStoredTheme() { const t = localStorage.getItem('theme') || 'default'; document.documentElement.setAttribute('data-theme', t); themeBtns.forEach(b => { if (b.dataset.theme === t) b.classList.add('active'); else b.classList.remove('active'); }); }

function printSalarySlip(id) {
    const rec = salaryRecords.find(r => r.id === id);
    if (!rec) return;

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Salary Slip - ${rec.month}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; }
                .slip-container { border: 2px solid #eee; padding: 30px; border-radius: 10px; max-width: 700px; margin: auto; }
                .header { text-align: center; border-bottom: 2px solid var(--primary); padding-bottom: 20px; margin-bottom: 30px; }
                .header h1 { margin: 0; color: #10b981; font-size: 24px; text-transform: uppercase; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                .info-item b { color: #666; font-size: 12px; text-transform: uppercase; display: block; }
                .data-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                .data-table th { text-align: left; padding: 12px; background: #f9fafb; border-bottom: 2px solid #eee; }
                .data-table td { padding: 12px; border-bottom: 1px solid #eee; }
                .total-row { background: #f9fafb; font-weight: bold; }
                .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="slip-container">
                <div class="header">
                    <h1>MR HASSAN | SALARY HUB</h1>
                    <p>Official Remuneration Statement</p>
                </div>
                
                <div class="info-grid">
                    <div class="info-item"><b>Employee Name</b>Mr Hassan</div>
                    <div class="info-item"><b>Statement Period</b>${rec.month}</div>
                    <div class="info-item"><b>Designation</b>Senior Executive / Specialist</div>
                    <div class="info-item"><b>Generation Date</b>${new Date().toLocaleDateString()}</div>
                </div>

                <table class="data-table">
                    <thead>
                        <tr><th>Description</th><th style="text-align: right;">Amount</th></tr>
                    </thead>
                    <tbody>
                        <tr><td>Base Salary</td><td style="text-align: right;">${CURRENCY}${rec.baseSalary.toLocaleString()}</td></tr>
                        <tr><td>Overtime Amount</td><td style="text-align: right;">${CURRENCY}${rec.overTimeAmount.toLocaleString()}</td></tr>
                        <tr><td>Allowances</td><td style="text-align: right;">${CURRENCY}${rec.allowance.toLocaleString()}</td></tr>
                        <tr class="total-row"><td>Gross Earnings</td><td style="text-align: right;">${CURRENCY}${rec.grossSalary.toLocaleString()}</td></tr>
                        
                        <tr><td>Provident Fund (PF)</td><td style="text-align: right; color: #ef4444;">-${CURRENCY}${rec.pfDeduction.toLocaleString()}</td></tr>
                        <tr><td>EOBI Contribution</td><td style="text-align: right; color: #ef4444;">-${CURRENCY}${rec.eobiDeduction.toLocaleString()}</td></tr>
                        <tr><td>Income Tax</td><td style="text-align: right; color: #ef4444;">-${CURRENCY}${rec.incomeTax.toLocaleString()}</td></tr>
                        <tr><td>ST / Without Pay</td><td style="text-align: right; color: #ef4444;">-${CURRENCY}${(rec.shortTimeAmount + rec.withoutPay).toLocaleString()}</td></tr>
                        <tr><td>Other Deductions</td><td style="text-align: right; color: #ef4444;">-${CURRENCY}${rec.otherDeductions.toLocaleString()}</td></tr>
                        <tr class="total-row"><td>Total Deductions</td><td style="text-align: right; color: #ef4444;">-${CURRENCY}${rec.overAllDeduction.toLocaleString()}</td></tr>
                        
                        <tr style="background: #10b981; color: white;">
                            <td style="font-size: 18px; padding: 20px;">NET PAYABLE</td>
                            <td style="text-align: right; font-size: 18px; padding: 20px;">${CURRENCY}${rec.netPayable.toLocaleString()}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="footer">
                    <p>This is a computer-generated document and does not require a physical signature.</p>
                    <p>© 2026 MR HASSAN SALARY HUB - Confidential</p>
                </div>
            </div>
            <script>window.print();<\/script>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
}

function updateHackerStatus(totalSalary = 0) {
    let rank = "HUB INTERN";
    const goal = 1000000; // 1M Goal
    const progress = Math.min((totalSalary / goal) * 100, 100);
    
    if (totalSalary > 750000) rank = "ELITE ARCHITECT";
    else if (totalSalary > 400000) rank = "SENIOR ANALYST";
    else if (totalSalary > 100000) rank = "SECURITY SPECIALIST";

    // Use the statusText if available (it represents the Sheets connection status usually,
    // but here we can append the rank or use another element if we want)
    const statusLabel = document.querySelector('.status-label');
    if (statusLabel) statusLabel.innerText = rank;
    
    if (statusFill) statusFill.style.width = `${progress}%`;
    
    if (progress === 100 && statusFill) statusFill.style.boxShadow = '0 0 10px var(--primary)';
}

// Final Boot Sequence
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Core Setup
        init(); 
        initCloud(); 
        initIdentity();
        initKeypad();
        
        // UI Polish
        if (dateEl) {
            const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            dateEl.innerText = new Date().toLocaleDateString('en-US', options);
        }
        
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error('Boot Error:', e);
    }
});
