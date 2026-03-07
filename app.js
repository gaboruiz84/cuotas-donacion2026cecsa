// ==========================================
// 1. REGISTRO DE SERVICE WORKER (PWA)
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW falló:', err));
  });
}

// ==========================================
// 2. CONFIGURACIÓN Y UTILIDADES
// ==========================================
const $ = (id) => document.getElementById(id);
let MONTHS = [];
let studentsCache = [];

// ¡IMPORTANTE! Reemplaza esto con la URL de tu API de Apps Script (doPost)
const API_URL = "https://script.google.com/macros/s/AKfycbxXusmC2j_bA60sXfmh_4mw6PjOe6_02N59nq_uybZoiIPDtLRomwLAgK8FIuT0Vvab/exec"; 

function money(n) { return `$${Number(n).toFixed(2)}`; }

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replaceAll('"', "&quot;"); }

function parseCombo(value) {
  const [grade, section] = value.split("||");
  return { grade, section };
}

// ==========================================
// 3. COMUNICACIÓN CON EL BACKEND (FETCH API)
// ==========================================
async function callApi(action, payload = {}) {
  payload.action = action;
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Evita errores de CORS en Apps Script
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data;
  } catch (err) {
    console.error(`Error en API [${action}]:`, err);
    throw err;
  }
}

// ==========================================
// 4. LÓGICA DE INTERFAZ Y DATOS
// ==========================================

async function updateGlobalStats() {
  const monthKey = $("monthSelect").value || "Feb";
  try {
    const g = await callApi("getGlobalStats", { monthKey: monthKey });
    $("totalCollected").textContent = money(g.globalCollected);
    $("totalExpenses").textContent = money(g.globalExpenses);
    $("totalBalance").textContent = money(g.globalBalance);
    $("pendingMonth").textContent = String(g.globalPendingThisMonth);
    $("countInfo").textContent = `${studentsCache.length} estudiantes en el filtro actual`;
  } catch (e) {
    console.log("No se pudieron cargar las estadísticas.");
  }
}

function renderTable() {
  if (!studentsCache.length) {
    $("tableArea").innerHTML = `<div class="loading">No hay estudiantes para este Grado/Sección.</div>`;
    updateGlobalStats();
    return;
  }

  const monthKey = $("monthSelect").value;
  let html = `
    <table>
      <thead>
        <tr>
          <th style="width:30px; text-align:center;">N°</th>
          <th>Estudiante</th>
          ${MONTHS.map(m => `<th><div class="monthHead"><span style="margin: 0 auto;">${m}</span></div></th>`).join("")}
          <th>Pendientes</th>
        </tr>
      </thead>
      <tbody>
  `;

  let correlativo = 1;
  for (const st of studentsCache) {
    let pendingCount = 0;
    MONTHS.forEach(m => { if (!st.payments[m]) pendingCount++; });

    html += `
      <tr>
        <td style="text-align:center;" class="muted">${correlativo++}</td>
        <td><div class="name">${escapeHtml(st.Nombre)}</div></td>
        ${MONTHS.map(m => `
          <td>
            <input type="checkbox" data-id="${escapeAttr(st.StudentID)}" data-month="${m}" ${st.payments[m] ? "checked" : ""} />
          </td>
        `).join("")}
        <td style="font-weight:bold; color:var(--danger); text-align:center;" id="pend-${escapeAttr(st.StudentID)}">${pendingCount}</td>
      </tr>
    `;
  }

  html += `</tbody></table>`;
  $("tableArea").innerHTML = html;

  // Listeners para los Checkboxes
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const month = e.target.dataset.month;
      const val = e.target.checked;
      const st = studentsCache.find(x => x.StudentID === id);
      
      if (st) st.payments[month] = val;
      
      let newPend = 0;
      if (st) MONTHS.forEach(m => { if (!st.payments[m]) newPend++; });
      const pendCell = document.getElementById(`pend-${id}`);
      if (pendCell) pendCell.textContent = newPend;

      updateGlobalStats(); // Actualiza visualmente rápido

      try {
        await callApi("setPayment", { studentId: id, monthKey: month, value: val });
        await updateGlobalStats(); // Confirma datos reales
      } catch (err) {
        // Revertir en caso de error
        if (st) st.payments[month] = !val;
        e.target.checked = !val;
        let revertPend = 0;
        if (st) MONTHS.forEach(m => { if (!st.payments[m]) revertPend++; });
        if (pendCell) pendCell.textContent = revertPend;
        updateGlobalStats();
        alert("Error guardando pago.\n" + (err.message || err));
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
    const res = await callApi("getStudentsByGradeSection", { grade, section });
    studentsCache = res.students || [];
    renderTable();
  } catch (err) {
    $("tableArea").innerHTML = `<div class="loading" style="color: var(--danger)">Error: ${err.message}</div>`;
  }
}

async function loadCombos() {
  $("tableArea").innerHTML = `<div class="loading">Conectando con la base de datos...</div>`;
  try {
    const data = await callApi("getGradesSections");
    MONTHS = data.months;

    $("comboSelect").innerHTML = (data.combos || []).map(c => {
      const v = `${c.Grado}||${c.Seccion}`;
      return `<option value="${v}">Grado ${c.Grado} - Sección ${c.Seccion}</option>`;
    }).join("");

    const uniqueGrades = [...new Set((data.combos || []).map(c => c.Grado))];
    $("gradeList").innerHTML = uniqueGrades.map(g => `<option value="${g}">`).join("");

    $("monthSelect").innerHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join("");
    $("monthSelect").value = "Feb";

    await refreshStudents();
  } catch (err) {
    $("tableArea").innerHTML = `<div class="loading" style="color: var(--danger)">Error de conexión: ${err.message}. Verifica la URL de tu API.</div>`;
  }
}

// ==========================================
// 5. LÓGICA DE EGRESOS (GASTOS)
// ==========================================
async function loadExpenses() {
  const tbody = $("egresosTableBody");
  tbody.innerHTML = `<tr><td colspan="3" class="loading">Cargando gastos...</td></tr>`;
  try {
    const expenses = await callApi("getExpenses");
    if (!expenses || expenses.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted" style="text-align:center;">No hay gastos registrados.</td></tr>`;
      return;
    }
    
    tbody.innerHTML = expenses.map(e => `
      <tr>
        <td class="muted">${escapeHtml(e.fecha)}</td>
        <td class="name">${escapeHtml(e.descripcion)}</td>
        <td style="text-align: right; color: var(--danger); font-weight: bold;">${money(e.monto)}</td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--danger);">Error cargando gastos: ${err.message}</td></tr>`;
  }
}

$("btnSaveGasto").addEventListener("click", async () => {
  const desc = $("gastoDesc").value.trim();
  const monto = $("gastoMonto").value;
  const msg = $("gastoMsg");

  if (!desc || !monto || Number(monto) <= 0) {
    msg.textContent = "Por favor ingresa una descripción y un monto válido mayor a 0.";
    msg.style.color = "var(--danger)";
    return;
  }

  msg.textContent = "Guardando gasto...";
  msg.style.color = "var(--text)";
  
  try {
    await callApi("addExpense", { descripcion: desc, monto: monto });
    $("gastoDesc").value = "";
    $("gastoMonto").value = "";
    msg.textContent = "¡Gasto registrado exitosamente!";
    msg.style.color = "var(--accent2)";
    
    // Recargar datos
    loadExpenses();
    updateGlobalStats();
    setTimeout(() => msg.textContent = "", 3000);
  } catch (err) {
    msg.textContent = "Error al guardar: " + err.message;
    msg.style.color = "var(--danger)";
  }
});


// ==========================================
// 6. EVENTOS DE INTERFAZ Y MODALES
// ==========================================
function setTheme(p) {
  const palettes = [
    {bg:"#0b1220", accent:"#7c3aed", accent2:"#22c55e", info:"#3b82f6"},
    {bg:"#070a12", accent:"#06b6d4", accent2:"#a3e635", info:"#8b5cf6"},
    {bg:"#0c0a1a", accent:"#f97316", accent2:"#22c55e", info:"#06b6d4"},
    {bg:"#08131a", accent:"#3b82f6", accent2:"#f59e0b", info:"#10b981"},
    {bg:"#0f0f12", accent:"#ec4899", accent2:"#14b8a6", info:"#8b5cf6"},
  ];
  const pick = palettes[p ?? Math.floor(Math.random() * palettes.length)];
  document.documentElement.style.setProperty('--bg', pick.bg);
  document.documentElement.style.setProperty('--accent', pick.accent);
  document.documentElement.style.setProperty('--accent2', pick.accent2);
  document.documentElement.style.setProperty('--info', pick.info);
}

// Navegación de Pestañas
document.querySelectorAll('.tab-btn').forEach(btn => {
  if(btn.id === 'themeBtn') return; // Excluir botón de tema
  
  btn.addEventListener('click', (e) => {
    // Quitar active a todos los botones y secciones
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    
    // Activar el seleccionado
    e.target.classList.add('active');
    const targetId = e.target.getAttribute('data-target');
    $(targetId).classList.add('active');

    // Si entra a la pestaña de gastos, cargarlos
    if(targetId === 'view-egresos') {
      loadExpenses();
    }
  });
});

$("themeBtn").addEventListener("click", () => setTheme());

// Modal Estudiantes
$("addBtn").addEventListener("click", () => {
  $("modalBack").style.display = "block";
  $("mMsg").textContent = "Si no colocas NIE/ID, se generará NEW-0001, etc.";
  $("mMsg").style.color = "var(--muted)";
  $("mNombre").value = ""; $("mGrado").value = ""; $("mSeccion").value = "A"; $("mId").value = "";
});
$("closeModal").addEventListener("click", () => $("modalBack").style.display = "none");

$("saveStudent").addEventListener("click", async () => {
  const nombre = $("mNombre").value.trim();
  const grado = $("mGrado").value.trim();
  const seccion = $("mSeccion").value.trim();
  const id = $("mId").value.trim();

  $("mMsg").textContent = "Guardando en la nube…";
  $("mMsg").style.color = "var(--text)";
  try {
    const res = await callApi("addStudent", { nombre, grado, seccion, studentId: id });
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

// Generar PDF
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

// Inicializar aplicación
setTheme(0);
loadCombos();
