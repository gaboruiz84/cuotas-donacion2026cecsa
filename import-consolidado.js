const fs = require('fs');

const PROJECT_ID = 'cecsa-online';
const API_KEY = 'AIzaSyAsvOGMiYQkvFAd1wNN5sBANoI-brAPmmM';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const configPath = require('os').homedir() + '/.config/configstore/firebase-tools.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const ACCESS_TOKEN = config.tokens.access_token;

const GRADE_MAP = {
  'Parvularia 4': 'P4', 'Parvularia 5': 'P5', 'Parvularia 6': 'P6',
  'Primer Grado': '1ERO', 'Segundo Grado': '2DO', 'Tercer Grado': '3RO',
  'Cuarto Grado': '4TO', 'Quinto Grado': '5TO', 'Sexto Grado': '6TO',
  'Séptimo Grado': '7MO', 'Septimo Grado': '7MO', 'Octavo Grado': '8VO', 'Noveno Grado': '9NO',
};

async function api(method, path, body = null) {
  const url = `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}key=${API_KEY}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ACCESS_TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function deleteAll(collection) {
  let total = 0;
  let pageToken = '';
  do {
    let url = `/${collection}?pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const list = await api('GET', url);
    if (!list.documents || list.documents.length === 0) break;
    
    for (const doc of list.documents) {
      const docPath = doc.name.replace(`projects/${PROJECT_ID}/databases/(default)/documents`, '');
      await api('DELETE', docPath);
      total++;
    }
    pageToken = list.nextPageToken || '';
  } while (pageToken);
  return total;
}

function parseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += c;
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log("=== IMPORTACIÓN CONSOLIDADA ===\n");

  // 1. Read consolidated CSV
  console.log("1️⃣  Leyendo CSV consolidado...");
  const studentsCsv = fs.readFileSync('estudiantes_matriculados_consolidado.csv', 'utf8');
  const students = [];
  for (const line of studentsCsv.split('\n').slice(1).filter(l => l.trim())) {
    const parts = parseLine(line);
    if (parts.length >= 3) {
      const nie = parts[0];
      const gradeRaw = parts[1].trim();
      const name = parts[2].replace(/^"|"$/g, '').trim();
      students.push({ nie, grade: GRADE_MAP[gradeRaw] || gradeRaw, name, section: 'A' });
    }
  }
  console.log(`   ✅ ${students.length} estudiantes`);

  // 2. Read payments
  console.log("\n2️⃣  Leyendo pagos...");
  const paymentsCsv = fs.readFileSync('Payments.csv', 'utf8');
  const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
  const paymentsByNIE = {};
  for (const line of paymentsCsv.split('\n').slice(1).filter(l => l.trim())) {
    const parts = parseLine(line);
    if (parts.length >= 5) {
      const nie = parts[0];
      const pvals = parts.slice(4);
      const p = {};
      months.forEach((m, i) => { p[m] = (pvals[i] || '').toUpperCase() === 'TRUE'; });
      paymentsByNIE[nie] = p;
    }
  }
  console.log(`   ✅ Pagos de ${Object.keys(paymentsByNIE).length} estudiantes`);

  // 3. Delete ALL students
  console.log("\n3️⃣  Eliminando todos los estudiantes...");
  const deleted = await deleteAll('students');
  console.log(`   🗑️  ${deleted} eliminados`);

  // 4. Import
  console.log("\n4️⃣  Importando...");
  let ok = 0, withPay = 0;
  for (const st of students) {
    const payments = paymentsByNIE[st.nie] || {};
    if (Object.keys(payments).length > 0) withPay++;
    await api('POST', '/students', {
      fields: {
        nombre: { stringValue: st.name },
        grado: { stringValue: st.grade },
        seccion: { stringValue: st.section },
        nie: { stringValue: st.nie },
        payments: { stringValue: JSON.stringify(payments) }
      }
    });
    ok++;
    if (ok % 50 === 0) process.stdout.write(`   📝 ${ok}/${students.length}\r`);
  }
  console.log(`   ✅ ${ok} importados (${withPay} con pagos)`);

  // 5. Verify
  console.log("\n5️⃣  Verificando...");
  let count = 0;
  let pt = '';
  do {
    let url = '/students?pageSize=300';
    if (pt) url += `&pageToken=${pt}`;
    const res = await api('GET', url);
    count += (res.documents || []).length;
    pt = res.nextPageToken || '';
  } while (pt);
  console.log(`   📚 Total en Firestore: ${count}`);

  console.log("\n=== ✅ COMPLETADO ===");
  process.exit(0);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
