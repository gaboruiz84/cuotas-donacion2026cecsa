// ==========================================
// 1. REGISTRO DE SERVICE WORKER (PWA)
// ==========================================
if ('serviceWorker' in navigator) { 
  window.addEventListener('load', () => { 
    navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW falló:', e)); 
  }); 
}

// ==========================================
// 1.5 MANEJO DE CONEXIÓN OFFLINE/ONLINE
// ==========================================
function updateOnlineStatus() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  
  if (navigator.onLine) {
    banner.style.display = 'none';
    document.body.classList.remove('offline');
  } else {
    banner.style.display = 'block';
    document.body.classList.add('offline');
  }
}

// Crear banner offline si no existe
function createOfflineBanner() {
  if (document.getElementById('offlineBanner')) return;
  
  const banner = document.createElement('div');
  banner.id = 'offlineBanner';
  banner.innerHTML = '📡 Sin conexión - Los cambios se guardarán localmente';
  banner.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #000;
    padding: 12px;
    text-align: center;
    font-weight: 600;
    z-index: 9999;
    font-size: 14px;
  `;
  document.body.prepend(banner);
}

// Guardar pagos pendientes offline
async function savePendingPayment(studentId, monthKey, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cuotas-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction('pendingPayments', 'readwrite');
      const store = tx.objectStore('pendingPayments');
      store.add({ studentId, monthKey, value, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingPayments')) {
        db.createObjectStore('pendingPayments', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

// Sincronizar pagos pendientes cuando vuelva la conexión
async function syncPendingPayments() {
  if (!navigator.onLine) return;
  
  try {
    const request = indexedDB.open('cuotas-offline', 1);
    request.onsuccess = async (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingPayments')) return;
      
      const tx = db.transaction('pendingPayments', 'readwrite');
      const store = tx.objectStore('pendingPayments');
      const all = await new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      
      if (all.length > 0) {
        console.log(`[Offline] Sincronizando ${all.length} pagos pendientes...`);
        for (const payment of all) {
          try {
            await FirebaseService.setPayment(payment.studentId, payment.monthKey, payment.value);
            store.delete(payment.id);
            console.log(`[Offline] Pago sincronizado: ${payment.studentId}`);
          } catch (err) {
            console.error('[Offline] Error sincronizando:', err);
          }
        }
        // Actualizar tabla después de sincronizar
        if (typeof renderTable === 'function') renderTable();
        if (typeof updateGlobalStats === 'function') updateGlobalStats();
      }
    };
  } catch (err) {
    console.error('[Offline] Error en sync:', err);
  }
}

// Inicializar manejo de conexión
window.addEventListener('online', () => {
  updateOnlineStatus();
  syncPendingPayments();
});
window.addEventListener('offline', updateOnlineStatus);

document.addEventListener('DOMContentLoaded', () => {
  createOfflineBanner();
  updateOnlineStatus();
});

// ==========================================
// 2. CONFIGURACIÓN Y UTILIDADES
// ==========================================
const $ = (id) => document.getElementById(id);
let MONTHS = [];
let studentsCache = [];

function money(n) { return `$${Number(n).toFixed(2)}`; }
function escapeHtml(s) { 
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
                        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
                        .replaceAll("'", "&#039;"); 
}
function escapeAttr(s) { return escapeHtml(s).replaceAll('"', "&quot;"); }
function parseCombo(value) { const [grade, section] = value.split("||"); return { grade, section }; }
function parsePayments(payments) {
  if (!payments) return {};
  if (typeof payments === 'string') {
    try { return JSON.parse(payments); } catch { return {}; }
  }
  return payments;
}

// ==========================================
// 3. COMUNICACIÓN CON FIREBASE
// ==========================================

// ==========================================
// 4. LÓGICA DE INTERFAZ Y DATOS (CUOTAS)
// ==========================================
async function updateGlobalStats() {
  const monthKey = $("monthSelect").value || "Feb";
  document.querySelectorAll('.lblMes').forEach(el => el.textContent = monthKey);
  try {
    const g = await FirebaseService.getGlobalStats(monthKey);
    $("totalCollected").textContent = money(g.globalCollected);
    $("totalExpenses").textContent = money(g.globalExpenses);
    $("totalBalance").textContent = money(g.globalBalance);
    $("collectedThisMonth").textContent = money(g.collectedThisMonth);
    $("expensesThisMonth").textContent = money(g.expensesThisMonth);
    $("pendingMonth").textContent = String(g.globalPendingThisMonth);
  } catch (e) { console.log("Error cargando estadísticas", e); }
}

function renderTable() {
  if (!studentsCache.length) { 
    $("tableArea").innerHTML = `<div class="loading">No hay estudiantes.</div>`; 
    updateGlobalStats(); 
    return; 
  }
  
  // Apply search filter
  const searchQuery = $("searchInput") ? $("searchInput").value : '';
  let filtered = FirebaseService.searchStudents(studentsCache, searchQuery);
  
  if (!filtered.length) {
    $("tableArea").innerHTML = `<div class="loading">No se encontraron resultados.</div>`;
    return;
  }
  
  const monthKey = $("monthSelect").value;
  const isAllView = $("comboSelect").value === "ALL||ALL";
  
  let html = `<table><thead><tr><th style="width:30px; text-align:center;">N°</th><th>Estudiante</th>`;
  if (isAllView) {
    html += `<th>Grado</th><th>Sección</th>`;
  }
  html += MONTHS.map(m => `<th><div class="monthHead"><span style="margin: 0 auto;">${m}</span></div></th>`).join("");
  html += `<th>Pendientes</th></tr></thead><tbody>`;

  let correlativo = 1;
  for (const st of filtered) {
    let pendingCount = 0; 
    MONTHS.forEach(m => { if (!st.payments[m]) pendingCount++; });
    
    html += `<tr><td style="text-align:center;" class="muted">${correlativo++}</td><td><div class="name">${escapeHtml(st.Nombre)}</div></td>`;
    if (isAllView) {
      html += `<td class="muted">${escapeHtml(st.grado)}</td><td class="muted">${escapeHtml(st.seccion)}</td>`;
    }
    html += MONTHS.map(m => `<td><input type="checkbox" data-id="${escapeAttr(st.StudentID)}" data-month="${m}" ${st.payments[m] ? "checked" : ""} /></td>`).join("");
    html += `<td style="font-weight:bold; color:var(--danger); text-align:center;" id="pend-${escapeAttr(st.StudentID)}">${pendingCount}</td></tr>`;
  }
  html += `</tbody></table>`;
  $("tableArea").innerHTML = html;

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const id = e.target.dataset.id, month = e.target.dataset.month, val = e.target.checked;
      const st = studentsCache.find(x => x.StudentID === id);
      
      const accionText = val ? "MARCAR COMO PAGADO" : "QUITAR EL PAGO de";
      const seguro = confirm(`¿Estás seguro de ${accionText} el mes de ${month} para:\n\n${st ? st.Nombre : 'este estudiante'}?`);
      
      if (!seguro) {
        e.target.checked = !val;
        return; 
      }
      
      if (st) st.payments[month] = val;
      let newPend = 0; 
      if (st) MONTHS.forEach(m => { if (!st.payments[m]) newPend++; });
      const pendCell = document.getElementById(`pend-${id}`); 
      if (pendCell) pendCell.textContent = newPend;
      
      updateGlobalStats(); 
      
      try { 
        if (navigator.onLine) {
          await FirebaseService.setPayment(id, month, val); 
        } else {
          // Guardar offline para sincronizar después
          await savePendingPayment(id, month, val);
          console.log('[Offline] Pago guardado localmente:', id, month, val);
        }
        await updateGlobalStats(); 
      } catch (err) { 
        e.target.checked = !val; 
        if(st) st.payments[month] = !val;
        updateGlobalStats(); 
        alert("Error guardando pago."); 
      }
    });
  });
  updateGlobalStats();
}

async function refreshStudents() {
  const comboVal = $("comboSelect").value; 
  if (!comboVal) return;
  const { grade, section } = parseCombo(comboVal);
  $("tableArea").innerHTML = `<div class="loading">Cargando estudiantes…</div>`;
  try {
    const res = await FirebaseService.getStudentsByGradeSection(grade, section);
    studentsCache = res.students || []; 
    renderTable();
  } catch (err) { 
    $("tableArea").innerHTML = `<div class="loading" style="color: var(--danger)">Error: ${err.message}</div>`; 
  }
}

async function loadCombos() {
  try {
    const data = await FirebaseService.getGradesSections(); 
    MONTHS = data.months;
    
    // Agregar opción "Todos" al inicio
    let comboHtml = '<option value="ALL||ALL">Todos los Grados</option>';
    comboHtml += (data.combos || []).map(c => `<option value="${c.Grado}||${c.Seccion}">Grado ${c.Grado} - Sección ${c.Seccion}</option>`).join("");
    $("comboSelect").innerHTML = comboHtml;
    
    $("gradeList").innerHTML = [...new Set((data.combos || []).map(c => c.Grado))].map(g => `<option value="${g}">`).join("");
    $("monthSelect").innerHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join("");
    $("monthSelect").value = MONTHS[0] || "Feb"; 
    await refreshStudents();
  } catch (err) {
    $("tableArea").innerHTML = `<div class="loading" style="color: var(--danger)">Error cargando. Verifica tu conexión.</div>`;
  }
}

// ==========================================
// 5. LÓGICA GASTOS
// ==========================================
$("gastoFecha").value = new Date().toISOString().split('T')[0];

async function loadExpenses() {
  const tbody = $("egresosTableBody");
  tbody.innerHTML = `<tr><td colspan="4" class="loading">Cargando gastos...</td></tr>`;
  try {
    const expenses = await FirebaseService.getExpenses();
    if (!expenses || expenses.length === 0) { 
      tbody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;">No hay gastos registrados.</td></tr>`; 
      return; 
    }
    
    tbody.innerHTML = expenses.map(e => `
      <tr>
        <td class="muted">${escapeHtml(e.fecha)}</td>
        <td class="name">${escapeHtml(e.descripcion)}</td>
        <td style="text-align: right; color: var(--danger); font-weight: bold;">${money(e.monto)}</td>
        <td style="text-align: center;">
          <button class="primary btn-edit-gasto" data-id="${escapeAttr(e.id)}" data-fecha="${escapeAttr(e.fecha)}" data-desc="${escapeAttr(e.descripcion)}" data-monto="${e.monto}" style="padding: 4px 8px; font-size: 11px;">Editar</button>
        </td>
      </tr>
    `).join("");
    
    // Agregar event listeners a los botones de editar
    document.querySelectorAll('.btn-edit-gasto').forEach(btn => {
      btn.addEventListener('click', function() {
        editGasto(
          this.dataset.id,
          this.dataset.fecha,
          this.dataset.desc,
          parseFloat(this.dataset.monto)
        );
      });
    });
  } catch (err) { 
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger);">Error cargando gastos</td></tr>`; 
  }
}

function editGasto(id, fecha, desc, monto) {
  $("formGastoTitle").textContent = "Editar Gasto";
  $("gastoFecha").value = fecha;
  $("gastoDesc").value = desc;
  $("gastoMonto").value = monto;
  $("btnSaveGasto").textContent = "Actualizar";
  $("btnSaveGasto").dataset.editId = id; 
  $("btnCancelEditGasto").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$("btnCancelEditGasto").addEventListener("click", () => {
  $("formGastoTitle").textContent = "Registrar Nuevo Gasto";
  $("gastoFecha").value = new Date().toISOString().split('T')[0];
  $("gastoDesc").value = ""; 
  $("gastoMonto").value = "";
  $("btnSaveGasto").textContent = "Guardar";
  $("btnSaveGasto").dataset.editId = "";
  $("btnCancelEditGasto").style.display = "none";
});

$("btnSaveGasto").addEventListener("click", async () => {
  const fecha = $("gastoFecha").value;
  const desc = $("gastoDesc").value.trim();
  const monto = $("gastoMonto").value;
  const editId = $("btnSaveGasto").dataset.editId;
  const msg = $("gastoMsg");

  if (!fecha || !desc || !monto || Number(monto) <= 0) { 
    msg.textContent = "Datos incompletos."; 
    msg.style.color = "var(--danger)"; 
    return; 
  }

  msg.textContent = "Guardando..."; 
  msg.style.color = "var(--text)";
  
  try {
    if (editId) {
      await FirebaseService.updateExpense({ id: editId, fecha, descripcion: desc, monto });
      msg.textContent = "¡Gasto actualizado!";
    } else {
      await FirebaseService.addExpense({ fecha, descripcion: desc, monto });
      msg.textContent = "¡Gasto registrado!";
    }
    
    msg.style.color = "var(--accent2)";
    $("btnCancelEditGasto").click(); 
    
    await loadExpenses(); 
    await updateGlobalStats();
    
    setTimeout(() => msg.textContent = "", 3000);
  } catch (err) { 
    msg.textContent = "Error: " + err.message; 
    msg.style.color = "var(--danger)"; 
    alert("Hubo un error al guardar: " + err.message);
  }
});

// ==========================================
// 6. EVENTOS INTERFAZ Y MODALES
// ==========================================
function setTheme(p) {
  const palettes = [
    {bg:"#0b1220", accent:"#7c3aed", accent2:"#22c55e", info:"#3b82f6"},
    {bg:"#070a12", accent:"#06b6d4", accent2:"#a3e635", info:"#8b5cf6"},
    {bg:"#08131a", accent:"#3b82f6", accent2:"#f59e0b", info:"#10b981"},
  ];
  const pick = palettes[p ?? Math.floor(Math.random() * palettes.length)];
  document.documentElement.style.setProperty('--bg', pick.bg);
  document.documentElement.style.setProperty('--accent', pick.accent);
  document.documentElement.style.setProperty('--accent2', pick.accent2);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  if(btn.id === 'themeBtn') return; 
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    e.target.classList.add('active');
    const targetId = e.target.getAttribute('data-target');
    $(targetId).classList.add('active');
    if(targetId === 'view-egresos') loadExpenses();
  });
});

$("themeBtn").addEventListener("click", () => setTheme());
$("addBtn").addEventListener("click", () => { $("modalBack").style.display = "block"; });
$("closeModal").addEventListener("click", () => $("modalBack").style.display = "none");

// GUARDAR ESTUDIANTE
$("saveStudent").addEventListener("click", async () => {
  const nombre = $("mNombre").value.trim();
  const grado = $("mGrado").value.trim();
  const seccion = $("mSeccion").value.trim();
  const id = $("mId").value.trim();

  $("mMsg").textContent = "Guardando en la nube…";
  $("mMsg").style.color = "var(--text)";
  try {
    const res = await FirebaseService.addStudent({ nombre, grado, seccion, studentId: id });
    $("mMsg").textContent = `Guardado. ID: ${res.StudentID}. Actualizando…`;
    $("mMsg").style.color = "var(--accent2)";
    await loadCombos();
    $("modalBack").style.display = "none";
  } catch (err) {
    $("mMsg").textContent = "Error: " + (err.message || err);
    $("mMsg").style.color = "var(--danger)";
  }
});

$("comboSelect").addEventListener("change", refreshStudents);
$("monthSelect").addEventListener("change", () => { renderTable(); updateGlobalStats(); });
$("refreshBtn").addEventListener("click", refreshStudents);

// Búsqueda por nombre
if ($("searchInput")) {
  $("searchInput").addEventListener("input", () => { renderTable(); });
}

// EXPORTAR A PDF
$("pdfBtn").addEventListener("click", () => {
  document.body.classList.add("pdf-mode");
  const comboText = $("comboSelect").options[$("comboSelect").selectedIndex]?.text || "";
  $("printHeader").textContent = `Reporte de Cuotas - ${comboText}`;
  
  const opt = {
    margin: [0.2, 0.2, 0.2, 0.2], 
    filename: `Cuotas_${comboText.replace(/ /g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 }, 
    jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
  };

  html2pdf().set(opt).from($("pdfContainer")).save().then(() => {
    document.body.classList.remove("pdf-mode");
  });
});

// INICIO AUTOMÁTICO
setTheme(0);
loadCombos();
