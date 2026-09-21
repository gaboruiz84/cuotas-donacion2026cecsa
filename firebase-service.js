// ==========================================
// SERVICIO FIREBASE - OPERACIONES CRUD
// ==========================================

// Inicializar Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

// Helper para parsear payments (puede ser JSON string u objeto)
function parsePayments(payments) {
  if (!payments) return {};
  if (typeof payments === 'string') {
    try {
      return JSON.parse(payments);
    } catch {
      return {};
    }
  }
  return payments;
}

const FirebaseService = {
  // ==========================================
  // ESTUDIANTES
  // ==========================================

  // Obtener grados y secciones únicos (sin borrar datos existentes)
  async getGradesSections() {
    const snapshot = await db.collection('students').get();
    const combos = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();
      const key = `${data.grado}||${data.seccion}`;
      if (!combos.has(key)) {
        combos.set(key, { Grado: data.grado, Seccion: data.seccion });
      }
    });

    // Obtener meses de la configuración
    let months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    
    // Intentar leer de config/main (almacenado como monthsStr)
    const configDoc = await db.collection('config').doc('main').get();
    if (configDoc.exists) {
      const configData = configDoc.data();
      if (configData.monthsStr) {
        months = configData.monthsStr.split(',');
      } else if (configData.months && Array.isArray(configData.months)) {
        months = configData.months;
      }
    }

    return {
      combos: Array.from(combos.values()),
      months: months
    };
  },

  // Obtener estudiantes por grado y sección
  async getStudentsByGradeSection(grade, section) {
    let snapshot;
    
    // Si grade es "ALL", obtener todos los estudiantes
    if (grade === 'ALL') {
      snapshot = await db.collection('students').get();
    } else if (section === 'ALL') {
      // Si solo se filtra por grado
      snapshot = await db.collection('students')
        .where('grado', '==', grade)
        .get();
    } else {
      // Filtrar por grado y sección
      snapshot = await db.collection('students')
        .where('grado', '==', grade)
        .where('seccion', '==', section)
        .get();
    }

    const students = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      students.push({
        StudentID: doc.id,
        Nombre: data.nombre,
        grado: data.grado,
        seccion: data.seccion,
        payments: parsePayments(data.payments)
      });
    });

    return { students };
  },

  // Agregar estudiante
  async addStudent({ nombre, grado, seccion, studentId }) {
    const docRef = await db.collection('students').add({
      nombre: nombre.toUpperCase(),
      grado: grado,
      seccion: seccion.toUpperCase(),
      nie: studentId || '',
      payments: {},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return { StudentID: docRef.id };
  },

  // Actualizar pago de estudiante
  async setPayment(studentId, monthKey, value) {
    // Primero obtener el estudiante actual
    const doc = await db.collection('students').doc(studentId).get();
    const data = doc.data();
    const payments = parsePayments(data.payments);
    
    // Actualizar el pago
    payments[monthKey] = value;
    
    // Guardar como JSON string
    await db.collection('students').doc(studentId).update({
      payments: JSON.stringify(payments)
    });
    
    return { success: true };
  },

  // ==========================================
  // GASTOS
  // ==========================================

  // Obtener todos los gastos
  async getExpenses() {
    const snapshot = await db.collection('expenses')
      .orderBy('fecha', 'desc')
      .get();

    const expenses = [];
    snapshot.forEach(doc => {
      expenses.push({
        id: doc.id,
        fecha: doc.data().fecha,
        descripcion: doc.data().descripcion,
        monto: doc.data().monto
      });
    });

    return expenses;
  },

  // Agregar gasto
  async addExpense({ fecha, descripcion, monto }) {
    const docRef = await db.collection('expenses').add({
      fecha: fecha,
      descripcion: descripcion.toUpperCase(),
      monto: parseFloat(monto),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return { id: docRef.id };
  },

  // Actualizar gasto
  async updateExpense({ id, fecha, descripcion, monto }) {
    await db.collection('expenses').doc(id).update({
      fecha: fecha,
      descripcion: descripcion.toUpperCase(),
      monto: parseFloat(monto)
    });

    return { success: true };
  },

  // ==========================================
  // ESTADÍSTICAS GLOBALES
  // ==========================================

  async getGlobalStats(monthKey) {
    // Obtener todos los estudiantes
    const studentsSnapshot = await db.collection('students').get();
    let globalCollected = 0;
    let collectedThisMonth = 0;
    let globalPendingThisMonth = 0;

    studentsSnapshot.forEach(doc => {
      const payments = parsePayments(doc.data().payments);
      const paymentKeys = Object.keys(payments);

      // Contar pagos totales
      paymentKeys.forEach(month => {
        if (payments[month] === true) {
          globalCollected++;
        }
      });

      // Contar pagos del mes actual
      if (payments[monthKey] === true) {
        collectedThisMonth++;
      } else {
        globalPendingThisMonth++;
      }
    });

    // Obtener total de gastos
    const expensesSnapshot = await db.collection('expenses').get();
    let globalExpenses = 0;
    let expensesThisMonth = 0;

    expensesSnapshot.forEach(doc => {
      const data = doc.data();
      globalExpenses += data.monto;
      if (data.fecha && data.fecha.startsWith(monthKey)) {
        expensesThisMonth += data.monto;
      }
    });

    return {
      globalCollected: globalCollected,
      globalExpenses: globalExpenses,
      globalBalance: globalCollected - globalExpenses,
      collectedThisMonth: collectedThisMonth,
      expensesThisMonth: expensesThisMonth,
      globalPendingThisMonth: globalPendingThisMonth
    };
  }
};
