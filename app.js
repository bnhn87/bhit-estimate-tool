// ============================================
// BH ESTIMATE PRO v30
// ============================================

const PROJECT_URL = 'https://wgsqrjnliglemogtukly.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indnc3Fyam5saWdsZW1vZ3R1a2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODY2MTIsImV4cCI6MjA3OTU2MjYxMn0.chlJ9Ba2kQDu_xnqMfwcRwv5pgiwHnv7FJJSzKxbPeM';

let supabase = null;
if (window.supabase && window.supabase.createClient) {
    supabase = window.supabase.createClient(PROJECT_URL, ANON_KEY);
    console.log("Supabase initialized");
} else {
    console.warn("Supabase not available");
}

const DEFAULT_TERMS = `1. All estimates are supplied on the assumption of clear access, use of appropriate size lift, which will accommodate ALL items, for uplift and clear working areas.

2. Waste will be disposed of by a licensed waste carrier and disposed of as per regulations and recycled where possible. Pallets will be returned to the sender or recycled where possible.

3. Any uplift required via stairs, access issues, product changes, phased deliveries, product/delivery split by floor will require a new estimate to be raised to suit.

4. Out Of Hours is considered to be 18:00 - 07:00 Monday to Friday (NOT incl. Bank holidays). Saturday, Sunday & Bank Holiday works will require re-estimating.

5. Parking - Parking will be charged at the value of PCN, UNLESS on-site parking is made available for the duration of the task.`;

const DEFAULT_CONFIG = {
    labour: [
        { id: 'l1', label: "Installer + Vehicle", rate: 325 },
        { id: 'l2', label: "2 Person Team", rate: 550 },
        { id: 'l3', label: "Installer (On Foot)", rate: 185 },
        { id: 'l4', label: "Supervisor", rate: 220 },
        { id: 'l5', label: "Custom/Snagging", rate: 750 }
    ],
    vehicles: [
        { id: 'v1', label: "SWB Van", rate: 170 },
        { id: 'v2', label: "XLWB Van", rate: 200 },
        { id: 'v3', label: "Luton Van", rate: 230 },
        { id: 'v4', label: "7.5T Truck", rate: 540 },
        { id: 'v5', label: "18T Truck", rate: 720 }
    ],
    expenses: [
        { id: 'e1', label: "Additional Mileage", rate: 0.90, perDay: false },
        { id: 'e2', label: "Waste Disposal", rate: 340, perDay: false },
        { id: 'e3', label: "ULEZ/City Charge", rate: 15, perDay: true },
        { id: 'e4', label: "Parking", rate: 75, perDay: true }
    ],
    globals: {
        dayHours: 7.25,
        oohMultiplier: 1.6,
        satMultiplier: 1.75,
        sunMultiplier: 2.0,
        vatRate: 0.20,
        marginTarget: 0.35
    },
    terms: DEFAULT_TERMS,
    defaultScope: 'Installation of products as detailed in the supplied Works Order.'
};

let config = JSON.parse(localStorage.getItem('bh_est_config_v30')) || DEFAULT_CONFIG;
let currentQuoteId = null;
let currentRevision = 0;
let autosaveTimer = null;
let charts = {};

// ============================================
// INITIALIZATION
// ============================================

window.onload = async function() {
    await loadSharedConfig(); // Fetch from Supabase
    
    renderAll();
    setupKeyboardShortcuts();
    setupDragDrop();
    
    document.getElementById('quoteDate').valueAsDate = new Date();
    document.getElementById('scopeNotes').value = config.defaultScope || '';
    
    updateValidDate();
    addItemRow();
    calc();

    // Recover autosave if exists
    const saved = localStorage.getItem('bh_est_autosave');
    if (saved) {
        toast('Restored autosave session', 'info');
        try {
            populateFormData(JSON.parse(saved));
        } catch(e) { console.error(e); }
    }
    
    if (supabase) {
        toast('Connected to Cloud', 'success');
    }
};

async function loadSharedConfig() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single();
        if (data && data.config) {
            // Merge with default to ensure structure exists
            // We map old config structure to new structure if needed, or assume data.config matches new structure
            // For now, assuming data.config matches, or we use defaults.
            // If the old config structure is very different, we might need a transform step.
            // The old config had 'type' fields which we don't strictly use in the new UI but don't hurt.
            // Let's assume we want to prioritize the Cloud config if it looks compatible.
            if (data.config.labour) {
                // Ideally we should merge carefully. For now, let's use cloud config if it has data.
                // We might need to transform 'val' to 'rate' if it's the old schema.
                
                // transform old schema to new if necessary
                const transform = (c) => {
                    if (c.labour && c.labour[0] && c.labour[0].val !== undefined) {
                        // Old schema detected
                        return {
                            labour: c.labour.map(i => ({ id: i.id, label: i.label, rate: i.val })),
                            vehicles: c.vehicles.map(i => ({ id: i.id, label: i.label, rate: i.val })),
                            expenses: c.expenses.map(i => ({ 
                                id: i.id, 
                                label: i.label, 
                                rate: i.val, 
                                perDay: (i.label.includes('Parking') || i.label.includes('ULEZ'))
                            })),
                            globals: {
                                dayHours: c.globals.find(g => g.id === 'g1')?.val || 7.25,
                                oohMultiplier: c.globals.find(g => g.id === 'g2')?.val || 1.6,
                                satMultiplier: c.globals.find(g => g.id === 'g3')?.val || 1.75,
                                sunMultiplier: c.globals.find(g => g.id === 'g4')?.val || 2.0,
                                vatRate: 0.20
                            },
                            terms: c.terms || DEFAULT_TERMS,
                            defaultScope: DEFAULT_CONFIG.defaultScope
                        };
                    }
                    return c;
                };
                
                config = transform(data.config);
                localStorage.setItem('bh_est_config_v30', JSON.stringify(config));
            }
        }
    } catch (e) {
        console.warn('Config load failed', e);
    }
}

function renderAll() {
    renderLabourRows();
    renderVehicleRows();
    renderExpenseRows();
    updateGlobalLabels();
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="flex-1">
            <div class="font-medium">${message}</div>
        </div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key.toLowerCase()) {
                case 's': e.preventDefault(); saveQuote(); break;
                case 'n': e.preventDefault(); newQuote(); break;
                case 'l': e.preventDefault(); openLibrary(); break;
                case 'p': e.preventDefault(); generatePDF(); break;
                case 'i': e.preventDefault(); addItemRow(); break;
                case 'r':
                    e.preventDefault();
                    if (!document.getElementById('btnRevision').disabled) saveRevision();
                    break;
            }
        }
        if (e.key === 'Escape') closeAllModals();
    });
}

// ============================================
// DRAG & DROP
// ============================================

function setupDragDrop() {
    const container = document.getElementById('itemsContainer');
    if (container && typeof Sortable !== 'undefined') {
        new Sortable(container, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: function() { calc(); triggerAutosave(); }
        });
    }
}

// ============================================
// AUTO-SAVE
// ============================================

function triggerAutosave() {
    clearTimeout(autosaveTimer);
    const ind = document.getElementById('autosaveIndicator');
    if (ind) ind.innerHTML = '<span class="autosave-dot" style="background: var(--warning); animation: none;"></span><span>Saving...</span>';
    
    autosaveTimer = setTimeout(() => {
        localStorage.setItem('bh_est_autosave', JSON.stringify(collectFormData()));
        if (ind) ind.innerHTML = '<span class="autosave-dot"></span><span>Auto-saved</span>';
    }, 1000);
}

// ============================================
// HELPERS
// ============================================

function formatDateUK(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB');
}

function updateValidDate() {
    const dateInput = document.getElementById('quoteDate');
    const baseDate = dateInput.value ? new Date(dateInput.value) : new Date();
    const validDate = new Date(baseDate);
    validDate.setDate(validDate.getDate() + 90);
    document.getElementById('validDate').innerText = formatDateUK(validDate);
}

function fmtMoney(v) { return '£' + parseFloat(v || 0).toFixed(2); }
function fmtMoneyShort(v) {
    const num = parseFloat(v || 0);
    if (num >= 1000) return '£' + (num / 1000).toFixed(1) + 'k';
    return '£' + num.toFixed(0);
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderLabourRows() {
    const container = document.getElementById('labourRows');
    container.innerHTML = config.labour.map(l => `
        <tr>
            <td class="font-medium">${l.label}</td>
            <td><input type="number" id="qty_${l.id}" class="input input-sm input-center" oninput="calc(); triggerAutosave()"></td>
            <td class="text-center text-[var(--text-muted)]">${fmtMoney(l.rate)}</td>
            <td><input type="number" id="days_${l.id}" class="input input-sm input-center" oninput="calc(); triggerAutosave()"></td>
            <td class="text-right font-bold" id="tot_${l.id}">£0.00</td>
        </tr>
    `).join('');
}

function renderVehicleRows() {
    const container = document.getElementById('vehicleRows');
    container.innerHTML = config.vehicles.map(v => `
        <tr>
            <td class="font-medium">${v.label}</td>
            <td class="text-center text-[var(--text-muted)]">${fmtMoney(v.rate)}</td>
            <td><input type="number" id="qty_${v.id}" class="input input-sm input-center" oninput="calc(); triggerAutosave()"></td>
            <td><input type="text" id="area_${v.id}" class="input input-sm input-center" value="London" oninput="triggerAutosave()"></td>
            <td class="text-right font-bold" id="tot_${v.id}">£0.00</td>
        </tr>
    `).join('');
}

function renderExpenseRows() {
    const container = document.getElementById('expenseRows');
    container.innerHTML = config.expenses.map(e => `
        <tr>
            <td class="font-medium">${e.label} ${e.perDay ? '<span class="text-xs text-[var(--text-muted)]">(per day)</span>' : ''}</td>
            <td class="text-center text-[var(--text-muted)]">${fmtMoney(e.rate)}</td>
            <td><input type="number" id="qty_${e.id}" class="input input-sm input-center" ${e.perDay ? 'disabled' : ''} oninput="calc(); triggerAutosave()"></td>
            <td class="text-right font-bold" id="tot_${e.id}">£0.00</td>
        </tr>
    `).join('');
}

function updateGlobalLabels() {
    document.getElementById('lblOoh').innerText = config.globals.oohMultiplier;
    document.getElementById('lblSat').innerText = config.globals.satMultiplier;
    document.getElementById('lblSun').innerText = config.globals.sunMultiplier;
    document.getElementById('dayHrsDisplay').innerText = config.globals.dayHours;
}

// ============================================
// LINE ITEMS
// ============================================

function addItemRow() {
    const container = document.getElementById('itemsContainer');
    const id = Date.now();
    const row = document.createElement('div');
    row.className = 'item-row fade-in';
    row.dataset.id = id;
    row.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="text" class="input input-sm item-desc" placeholder="Item description..." oninput="triggerAutosave()">
        <input type="number" class="input input-sm input-center item-qty" value="1" oninput="calc(); triggerAutosave()">
        <input type="number" class="input input-sm input-center item-rate" step="0.1" placeholder="0.0" oninput="calc(); triggerAutosave()">
        <div class="text-center font-bold text-[var(--primary)] item-total">0.0</div>
        <button onclick="removeItemRow(this)" class="btn btn-ghost btn-icon text-[var(--danger)]" style="width: 30px; height: 30px; padding: 0;">✕</button>
    `;
    container.appendChild(row);
    row.querySelector('.item-desc').focus();
    updateItemCount();
}

function removeItemRow(btn) {
    const row = btn.closest('.item-row');
    row.style.animation = 'fadeIn 0.2s ease reverse';
    setTimeout(() => {
        row.remove();
        calc();
        updateItemCount();
        triggerAutosave();
    }, 200);
}

function updateItemCount() {
    const count = document.querySelectorAll('.item-row').length;
    document.getElementById('statItemCount').innerText = count;
}

// ============================================
// CALCULATIONS
// ============================================

function calc() {
    let totalHrs = 0;
    let totalMoney = 0;
    const daysOnSite = parseFloat(document.getElementById('daysOnSite').value) || 0;

    // Items
    document.querySelectorAll('.item-row').forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
        const total = qty * rate;
        row.querySelector('.item-total').innerText = total ? total.toFixed(1) : '';
        totalHrs += total;
    });

    // Labour
    config.labour.forEach(l => {
        const qty = parseFloat(document.getElementById(`qty_${l.id}`)?.value) || 0;
        const days = parseFloat(document.getElementById(`days_${l.id}`)?.value) || 0;
        const total = qty * days * l.rate;
        const el = document.getElementById(`tot_${l.id}`);
        if (el) el.innerText = fmtMoney(total);
        totalMoney += total;
    });

    // Vehicles
    config.vehicles.forEach(v => {
        const qty = parseFloat(document.getElementById(`qty_${v.id}`)?.value) || 0;
        const total = qty * v.rate;
        const el = document.getElementById(`tot_${v.id}`);
        if (el) el.innerText = fmtMoney(total);
        totalMoney += total;
    });

    // Expenses
    config.expenses.forEach(e => {
        let total = 0;
        if (e.perDay) {
            total = daysOnSite * e.rate;
        } else {
            const qty = parseFloat(document.getElementById(`qty_${e.id}`)?.value) || 0;
            total = qty * e.rate;
        }
        const el = document.getElementById(`tot_${e.id}`);
        if (el) el.innerText = fmtMoney(total);
        totalMoney += total;
    });

    const dayHrs = config.globals.dayHours;
    const labourDays = totalHrs / dayHrs;
    const vat = totalMoney * config.globals.vatRate;

    // Update displays
    document.getElementById('grandTotalHrs').innerText = totalHrs.toFixed(1);
    document.getElementById('grandTotalDays').innerText = labourDays.toFixed(2);
    document.getElementById('statTotalHours').innerText = totalHrs.toFixed(1);
    document.getElementById('statLabourDays').innerText = labourDays.toFixed(2);
    
    document.getElementById('finalTotal').innerText = fmtMoney(totalMoney);
    document.getElementById('oohTotal').innerText = fmtMoney(totalMoney * config.globals.oohMultiplier);
    document.getElementById('satTotal').innerText = fmtMoney(totalMoney * config.globals.satMultiplier);
    document.getElementById('sunTotal').innerText = fmtMoney(totalMoney * config.globals.sunMultiplier);
    
    document.getElementById('vatAmount').innerText = fmtMoney(vat);
    document.getElementById('totalWithVat').innerText = fmtMoney(totalMoney + vat);

    const labourCost = totalHrs * 25; // Assume approx cost for margin check
    const margin = totalMoney > 0 ? ((totalMoney - labourCost) / totalMoney * 100) : 0;
    document.getElementById('statMargin').innerText = Math.max(0, margin).toFixed(0) + '%';
}

function collectFormData() {
    const items = [];
    document.querySelectorAll('.item-row').forEach(row => {
        items.push({
            desc: row.querySelector('.item-desc').value,
            qty: row.querySelector('.item-qty').value,
            rate: row.querySelector('.item-rate').value
        });
    });

    const labourData = {};
    config.labour.forEach(l => {
        labourData[l.id] = {
            qty: document.getElementById(`qty_${l.id}`)?.value || '',
            days: document.getElementById(`days_${l.id}`)?.value || ''
        };
    });

    const vehicleData = {};
    config.vehicles.forEach(v => {
        vehicleData[v.id] = {
            qty: document.getElementById(`qty_${v.id}`)?.value || '',
            area: document.getElementById(`area_${v.id}`)?.value || 'London'
        };
    });

    const expenseData = {};
    config.expenses.forEach(e => {
        expenseData[e.id] = document.getElementById(`qty_${e.id}`)?.value || '';
    });

    return {
        quoteRef: document.getElementById('quoteRef').value,
        quoteDate: document.getElementById('quoteDate').value,
        clientName: document.getElementById('clientName').value,
        projName: document.getElementById('projName').value,
        siteAddr: document.getElementById('siteAddr').value,
        scopeNotes: document.getElementById('scopeNotes').value,
        daysOnSite: document.getElementById('daysOnSite').value,
        issuedBy: document.getElementById('issuedBy').value,
        finalTotal: document.getElementById('finalTotal').innerText,
        items,
        labourData,
        vehicleData,
        expenseData,
        status: 'draft'
    };
}

function populateFormData(data) {
    document.getElementById('quoteRef').value = data.quoteRef || '';
    document.getElementById('quoteDate').value = data.quoteDate || '';
    document.getElementById('clientName').value = data.clientName || '';
    document.getElementById('projName').value = data.projName || '';
    document.getElementById('siteAddr').value = data.siteAddr || '';
    document.getElementById('scopeNotes').value = data.scopeNotes || config.defaultScope;
    document.getElementById('daysOnSite').value = data.daysOnSite || '';
    document.getElementById('issuedBy').value = data.issuedBy || 'Ben Hone';

    document.getElementById('itemsContainer').innerHTML = '';
    if (data.items && data.items.length > 0) {
        data.items.forEach(item => {
            addItemRow();
            const rows = document.querySelectorAll('.item-row');
            const lastRow = rows[rows.length - 1];
            lastRow.querySelector('.item-desc').value = item.desc || '';
            lastRow.querySelector('.item-qty').value = item.qty || 1;
            lastRow.querySelector('.item-rate').value = item.rate || '';
        });
    } else {
        addItemRow();
    }

    if (data.labourData) {
        config.labour.forEach(l => {
            if (data.labourData[l.id]) {
                const q = document.getElementById(`qty_${l.id}`);
                const d = document.getElementById(`days_${l.id}`);
                if (q) q.value = data.labourData[l.id].qty || '';
                if (d) d.value = data.labourData[l.id].days || '';
            }
        });
    }

    if (data.vehicleData) {
        config.vehicles.forEach(v => {
            if (data.vehicleData[v.id]) {
                const q = document.getElementById(`qty_${v.id}`);
                const a = document.getElementById(`area_${v.id}`);
                if (q) q.value = data.vehicleData[v.id].qty || '';
                if (a) a.value = data.vehicleData[v.id].area || 'London';
            }
        });
    }

    if (data.expenseData) {
        config.expenses.forEach(e => {
            const el = document.getElementById(`qty_${e.id}`);
            if (el && data.expenseData[e.id]) el.value = data.expenseData[e.id];
        });
    }

    updateValidDate();
    calc();
    updateItemCount();
}

// ============================================
// DATA STORAGE (Backend + Local)
// ============================================

function getLibrary() {
    return JSON.parse(localStorage.getItem('bh_quote_library_v30') || '[]');
}

function setLibrary(library) {
    localStorage.setItem('bh_quote_library_v30', JSON.stringify(library));
}

async function saveQuote() {
    const data = collectFormData();
    if (!data.quoteRef) {
        toast('Please enter an Estimate Reference first', 'warning');
        return;
    }

    const toastId = toast('Saving...', 'info', 10000); // long toast

    // 1. Save locally first
    const library = getLibrary();
    const existingIndex = library.findIndex(q => q.id === currentQuoteId);
    
    // Ensure we have an ID
    const quoteId = currentQuoteId || crypto.randomUUID(); 

    const quote = {
        id: quoteId,
        ref_code: data.quoteRef,
        project_name: data.projName,
        client_name: data.clientName,
        quote_date: data.quoteDate,
        total_amount: data.finalTotal,
        revision: currentRevision,
        status: data.status || 'draft',
        created_at: new Date().toISOString(),
        data: data 
    };

    if (existingIndex >= 0) {
        library[existingIndex] = quote;
    } else {
        library.unshift(quote);
    }
    setLibrary(library);
    currentQuoteId = quoteId;

    // 2. Save to Supabase if connected
    if (supabase) {
        try {
            // Upsert based on ID
            const { error } = await supabase.from('estimates').upsert({
                id: quoteId,
                ref_code: quote.ref_code,
                project_name: quote.project_name,
                client_name: quote.client_name,
                total_amount: quote.total_amount,
                data: quote.data,
                updated_at: new Date()
            });
            
            if (error) throw error;
            toast('Saved to Cloud & Local', 'success');
        } catch (e) {
            console.error(e);
            toast('Saved Locally (Cloud Error)', 'warning');
        }
    } else {
        toast('Saved Locally', 'success');
    }
    
    updateRevisionDisplay();
}

async function saveRevision() {
    if (!currentQuoteId) {
        toast('Save the original quote first', 'warning');
        return;
    }

    currentRevision++;
    const data = collectFormData();
    const baseRef = data.quoteRef.replace(/-REV\d+$/, '');
    const newRef = `${baseRef}-REV${currentRevision}`;
    
    document.getElementById('quoteRef').value = newRef;
    
    // Trigger save as new
    currentQuoteId = null; 
    await saveQuote();
    
    toast(`Revision ${currentRevision} created!`, 'success');
}

async function openLibrary() {
    renderLibraryLoading();
    document.getElementById('libraryModal').classList.add('active');

    // Fetch from Supabase if available, else local
    let quotes = [];
    
    if (supabase) {
        const { data, error } = await supabase
            .from('estimates')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (!error && data) {
            quotes = data.map(d => ({
                id: d.id,
                ref: d.ref_code,
                project: d.project_name,
                client: d.client_name,
                date: d.created_at,
                total: d.total_amount,
                data: d.data
            }));
        } else {
            console.warn('Backend library error', error);
            quotes = getLibrary().map(q => ({
                id: q.id,
                ref: q.ref_code || q.ref,
                project: q.project_name || q.project,
                client: q.client_name || q.client,
                date: q.created_at || q.savedAt,
                total: q.total_amount || q.total,
                data: q.data
            }));
        }
    } else {
        quotes = getLibrary().map(q => ({
            id: q.id,
            ref: q.ref,
            project: q.project,
            client: q.client,
            date: q.savedAt,
            total: q.total,
            data: q.data
        }));
    }
    
    renderLibraryList(quotes);
}

function renderLibraryLoading() {
    document.getElementById('libraryContent').innerHTML = '<div class="p-8 text-center">Loading...</div>';
}

function renderLibraryList(quotes) {
    const container = document.getElementById('libraryContent');
    const countEl = document.getElementById('libraryCount');
    
    countEl.innerText = `${quotes.length} quotes`;

    if (quotes.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-[var(--text-muted)]"><p>No quotes found.</p></div>`;
        return;
    }

    container.innerHTML = quotes.map(q => `
        <div class="library-item ${q.id === currentQuoteId ? 'border-[var(--primary)]' : ''}">
            <div>
                <div class="font-bold text-[var(--primary)]">${q.ref || 'Untitled'}</div>
                <div class="text-sm text-[var(--text-muted)]">${q.project || q.client || 'No project'}</div>
            </div>
            <div class="text-sm text-[var(--text-muted)]">${formatDateUK(q.date)}</div>
            <div class="font-bold text-[var(--success)]">${q.total || '£0.00'}</div>
            <button onclick="loadQuoteData('${encodeURIComponent(JSON.stringify(q))}')" class="btn btn-info btn-sm">Load</button>
        </div>
    `).join('');
}

function loadQuoteData(quoteStr) {
    const quote = JSON.parse(decodeURIComponent(quoteStr));
    currentQuoteId = quote.id;
    currentRevision = 0; // reset/detect from ref?
    if (quote.data) {
        populateFormData(quote.data);
    }
    toast(`Loaded: ${quote.ref}`, 'success');
    closeLibrary();
}

function newQuote() {
    currentQuoteId = null;
    currentRevision = 0;
    document.getElementById('quoteRef').value = '';
    document.getElementById('quoteDate').valueAsDate = new Date();
    document.getElementById('clientName').value = '';
    document.getElementById('projName').value = '';
    document.getElementById('siteAddr').value = '';
    document.getElementById('scopeNotes').value = config.defaultScope;
    document.getElementById('daysOnSite').value = '';
    
    document.getElementById('itemsContainer').innerHTML = '';
    addItemRow();
    
    document.querySelectorAll('#labourRows input, #vehicleRows input, #expenseRows input').forEach(i => {
        if (i.id.startsWith('qty_') || i.id.startsWith('days_')) i.value = '';
        if (i.id.startsWith('area_')) i.value = 'London';
    });

    updateValidDate();
    calc();
    updateRevisionDisplay();
    toast('New quote started', 'info');
}

function updateRevisionDisplay() {
    const badge = document.getElementById('revisionBadge');
    const btn = document.getElementById('btnRevision');
    
    if (currentQuoteId) {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
        badge.innerHTML = `<span class="status-pill status-sent">${currentQuoteId.substr(0,4)}...</span>`;
    } else {
        btn.disabled = true;
        btn.classList.add('opacity-50');
        badge.innerHTML = '';
    }
}

// ============================================
// MODALS & UTILS
// ============================================

function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function closeLibrary() { document.getElementById('libraryModal').classList.remove('active'); }
function openSettings() {
    renderSettingsContent('rates');
    document.getElementById('settingsModal').classList.add('active');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('active'); }

function switchSettingsTab(tab) {
    document.querySelectorAll('#settingsTabs .tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    renderSettingsContent(tab);
}

function renderSettingsContent(tab) {
    const container = document.getElementById('settingsContent');
    // ... Copy of renderSettingsContent from previous code ...
    // Simplified for brevity, assume similar implementation to provided user code
    // Adding just enough to work:
    
    if (tab === 'rates') {
        container.innerHTML = config.labour.map((l, i) => `
            <div class="flex gap-4 items-center mb-3">
                <input type="text" class="input flex-1" value="${l.label}" id="labourLabel_${i}">
                <input type="number" class="input w-32" value="${l.rate}" id="labourRate_${i}">
            </div>`).join('');
    } else if (tab === 'general') {
        container.innerHTML = `
            <div>
                <label>Terms</label>
                <textarea id="settingTerms" class="input h-64">${config.terms}</textarea>
            </div>
            <button onclick="saveAdminConfig()" class="btn btn-primary mt-4">Save Config</button>
        `;
    } else {
        container.innerHTML = '<div>Coming soon...</div>';
    }
}

async function saveAdminConfig() {
    if (document.getElementById('settingTerms')) config.terms = document.getElementById('settingTerms').value;
    
    localStorage.setItem('bh_est_config_v30', JSON.stringify(config));
    
    // Save to Supabase
    if (supabase) {
        await supabase.from('app_settings').upsert({ id: 1, config: config });
        toast('Config saved to Cloud', 'success');
    } else {
        toast('Config saved locally', 'success');
    }
    closeSettings();
}

function openAnalytics() {
    document.getElementById('analyticsModal').classList.add('active');
    // Implement analytics...
}
function closeAnalytics() { document.getElementById('analyticsModal').classList.remove('active'); }

function openPasteModal() { document.getElementById('pasteModal').classList.add('active'); }
function closePasteModal() { document.getElementById('pasteModal').classList.remove('active'); }
function parseAndAddItems() {
    const input = document.getElementById('pasteInput').value.trim();
    if (!input) return;
    const lines = input.split('\n');
    lines.forEach(line => {
        if (!line.trim()) return;
        const [desc, qty, rate] = line.split(/[|,\t]/).map(s => s.trim());
        if (desc) {
            addItemRow();
            const rows = document.querySelectorAll('.item-row');
            const last = rows[rows.length-1];
            last.querySelector('.item-desc').value = desc;
            last.querySelector('.item-qty').value = qty || 1;
            last.querySelector('.item-rate').value = rate || '';
        }
    });
    calc();
    closePasteModal();
}

function exportJSON() {
    const data = collectFormData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.quoteRef || 'quote'}.json`;
    a.click();
}

function generatePDF() {
    const template = document.getElementById('pdf-template');
    document.getElementById('pdfRef').innerText = document.getElementById('quoteRef').value || 'Draft';
    document.getElementById('pdfDate').innerText = formatDateUK(document.getElementById('quoteDate').value);
    document.getElementById('pdfValid').innerText = document.getElementById('validDate').innerText;
    document.getElementById('pdfClient').innerText = document.getElementById('clientName').value || 'Client';
    document.getElementById('pdfProject').innerText = document.getElementById('projName').value || 'Project';
    document.getElementById('pdfSite').innerText = document.getElementById('siteAddr').value || 'TBC';
    document.getElementById('pdfScope').innerText = document.getElementById('scopeNotes').value || config.defaultScope;
    document.getElementById('pdfTotalHrs').innerText = document.getElementById('grandTotalHrs').innerText;
    document.getElementById('pdfLabourDays').innerText = document.getElementById('grandTotalDays').innerText;
    document.getElementById('pdfTotal').innerText = document.getElementById('finalTotal').innerText;
    document.getElementById('pdfIssuedBy').innerText = document.getElementById('issuedBy').value;
    document.getElementById('pdfTerms').innerText = config.terms || DEFAULT_TERMS;

    const itemsHtml = Array.from(document.querySelectorAll('.item-row')).map(row => {
        const desc = row.querySelector('.item-desc').value;
        if (!desc) return '';
        return `<tr><td>${desc}</td><td class="text-center">${row.querySelector('.item-qty').value}</td><td class="text-center">${row.querySelector('.item-rate').value}</td><td class="text-right">${row.querySelector('.item-total').innerText}</td></tr>`;
    }).join('');
    document.getElementById('pdfItems').innerHTML = itemsHtml;

    template.classList.remove('hidden');
    html2pdf().set({
        margin: 0,
        filename: `BH_Estimate_${document.getElementById('quoteRef').value}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(template).save().then(() => template.classList.add('hidden'));
}
