if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(e=>{}); }); }

const $ = (id) => document.getElementById(id);
let MONTHS = [];
let studentsCache = [];

// ¡PON TU URL DE GOOGLE APPS SCRIPT AQUÍ!
const API_URL = "https://script.google.com/macros/s/AKfycbzuzMj75bv9wLx9Lch5IfpFw5d30dndvP1c7fVdKWlvpnS-ae31PBrSSStZlgYpbzcI/exec"; 

function money(n) { return `$${Number(n).toFixed(2)}`; }
function escapeHtml(s) { return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function escapeAttr(s) { return escapeHtml(s).replaceAll('"', "&quot;"); }
function parseCombo(value) { const [grade, section] = value.split("||"); return { grade, section }; }

async function callApi(action, payload = {}) {
  payload.action = action;
  try {
    const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data;
  } catch (err) { throw err; }
}

// --- LÓGICA CUOTAS ---
async function updateGlobalStats() {
  const monthKey = $("monthSelect").value || "Feb";
  document.querySelectorAll('.lblMes').forEach(el => el.textContent = monthKey);
  try {
    const g = await callApi("getGlobalStats", { monthKey: monthKey });
    $("totalCollected").textContent = money(g.globalCollected);
    $("totalExpenses").textContent = money(g.globalExpenses);
    $("totalBalance").textContent = money(g.globalBalance);
    $("collectedThisMonth").textContent = money(g.collectedThisMonth);
    $("expensesThisMonth").textContent = money(g.expensesThisMonth);
    $("pendingMonth").textContent = String(g.globalPendingThisMonth);
  } catch (e) { console.log(e); }
}

function renderTable() {
  if (!studentsCache.length) { $("tableArea").innerHTML = `<div class="loading">No hay estudiantes.</div>`; updateGlobalStats(); return; }
  const monthKey = $("monthSelect").value;
  let html = `<table><thead><tr><th style="width:30px; text-align:center;">N°</th><th>Estudiante</th>`;
  html += MONTHS.map(m => `<th><div class="monthHead"><span style="margin: 0 auto;">${m}</span></div></th>`).join("");
  html += `<th>Pendientes</th></tr></thead><tbody>`;

  let correlativo = 1;
  for (const st of studentsCache) {
    let pendingCount = 0; MONTHS.forEach(m => { if (!st.payments[m]) pendingCount++; });
    html += `<tr><td style="text-align:center;" class="muted">${correlativo++}</td><td><div class="name">${escapeHtml(st.Nombre)}</div></td>`;
    html += MONTHS.map(m => `<td><input type="checkbox" data-id="${escapeAttr(st.StudentID)}" data-month="${m}" ${st.payments[m] ? "checked" : ""} /></td>`).join("");
    html += `<td style="font-weight:bold; color:var(--danger); text-align:center;" id="pend-${escapeAttr(st.StudentID)}">${pendingCount}</td></tr>`;
  }
  html += `</tbody></table>`;
  $("tableArea").innerHTML = html;

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const id = e.target.dataset.id, month = e.target.dataset.month, val = e.target.checked;
      const st = studentsCache.find(x => x.StudentID === id);
      if (st) st.payments[month] = val;
      let newPend = 0; if (st) MONTHS.forEach(m => { if (!st.payments[m]) newPend++; });
      const pendCell = document.getElementById(`pend-${id}`); if (pendCell) pendCell.textContent = newPend;
      updateGlobalStats(); 
      try { await callApi("setPayment", { studentId: id, monthKey: month, value: val }); await updateGlobalStats(); } 
      catch (err) { e.target.checked = !val; updateGlobalStats(); alert("Error guardando pago."); }
    });
  });
  updateGlobalStats();
}

async function refreshStudents() {
  const comboVal = $("comboSelect").value; if (!comboVal) return;
  const { grade, section } = parseCombo(comboVal);
  $("tableArea").innerHTML = `<div class="loading">Cargando estudiantes…</div>`;
  try {
    const res = await callApi("getStudentsByGradeSection", { grade, section });
    studentsCache = res.students || []; renderTable();
  } catch (err) { $("tableArea").innerHTML = `<div class="loading" style="color: var(--danger)">Error: ${err.message}</div>`; }
}

async function loadCombos() {
  try {
    const data = await callApi("getGradesSections"); MONTHS = data.months;
    $("comboSelect").innerHTML = (data.combos || []).map(c => `<option value="${c.Grado}||${c.Seccion}">Grado ${c.Grado} - Sección ${c.Seccion}</option>`).join("");
    $("gradeList").innerHTML = [...new Set((data.combos || []).map(c => c.Grado))].map(g => `<option value="${g}">`).join("");
    $("monthSelect").innerHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join("");
    $("monthSelect").value = "Feb"; await refreshStudents();
  } catch (err) {}
}

// --- LÓGICA GASTOS (NUEVA CON FECHAS Y EDICIÓN) ---

// Poner fecha de hoy por defecto al cargar
$("gastoFecha").value = new Date().toISOString().split('T')[0];

async function loadExpenses() {
  const tbody = $("egresosTableBody");
  tbody.innerHTML = `<tr><td colspan="4" class="loading">Cargando gastos...</td></tr>`;
  try {
    const expenses = await callApi("getExpenses");
    if (!expenses || expenses.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;">No hay gastos registrados.</td></tr>`; return; }
    
    tbody.innerHTML = expenses.map(e => `
      <tr>
        <td class="muted">${escapeHtml(e.fecha)}</td>
        <td class="name">${escapeHtml(e.descripcion)}</td>
        <td style="text-align: right; color: var(--danger); font-weight: bold;">${money(e.monto)}</td>
        <td style="text-align: center;">
          <button class="primary" style="padding: 4px 8px; font-size: 11px;" onclick="editGasto('${escapeAttr(e.id)}', '${escapeAttr(e.fecha)}', '${escapeAttr(e.descripcion)}', ${e.monto})">Editar</button>
        </td>
      </tr>
    `).join("");
  } catch (err) { tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger);">Error cargando gastos</td></tr>`; }
}

window.editGasto = function(id, fecha, desc, monto) {
  $("formGastoTitle").textContent = "Editar Gasto";
  $("gastoFecha").value = fecha;
  $("gastoDesc").value = desc;
  $("gastoMonto").value = monto;
  $("btnSaveGasto").textContent = "Actualizar";
  $("btnSaveGasto").dataset.editId = id; // Guardamos el ID que estamos editando
  $("btnCancelEditGasto").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$("btnCancelEditGasto").addEventListener("click", () => {
  $("formGastoTitle").textContent = "Registrar Nuevo Gasto";
  $("gastoFecha").value = new Date().toISOString().split('T')[0];
  $("gastoDesc").value = ""; $("gastoMonto").value = "";
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

  if (!fecha || !desc || !monto || Number(monto) <= 0) { msg.textContent = "Datos incompletos."; msg.style.color = "var(--danger)"; return; }

  msg.textContent = "Procesando..."; msg.style.color = "var(--text)";
  
  try {
    if (editId) {
      await callApi("updateExpense", { id: editId, fecha: fecha, descripcion: desc, monto: monto });
      msg.textContent = "¡Gasto actualizado!";
    } else {
      await callApi("addExpense", { fecha: fecha, descripcion: desc, monto: monto });
      msg.textContent = "¡Gasto registrado!";
    }
    
    msg.style.color = "var(--accent2)";
    $("btnCancelEditGasto").click(); // Limpia el form
    loadExpenses(); updateGlobalStats();
    setTimeout(() => msg.textContent = "", 3000);
  } catch (err) { msg.textContent = "Error: " + err.message; msg.style.color = "var(--danger)"; }
});

// --- EVENTOS INTERFAZ ---
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
$("saveStudent").addEventListener("click", async () => { /* logica estudiante */ });
$("comboSelect").addEventListener("change", refreshStudents);
$("monthSelect").addEventListener("change", () => { renderTable(); updateGlobalStats(); });
$("refreshBtn").addEventListener("click", refreshStudents);

setTheme(0);
loadCombos();
