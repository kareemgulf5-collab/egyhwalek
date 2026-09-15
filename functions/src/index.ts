import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

// ============================================================
// أدوار وصلاحيات
// ============================================================
type UserRole = 'admin' | 'raw_material_keeper' | 'production_supervisor' | 'scrap_keeper' | 'reviewer';

async function getCallerRole(uid: string): Promise<UserRole> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'المستخدم غير مسجل في النظام');
  const data = snap.data()!;
  if (!data.active) throw new HttpsError('permission-denied', 'حساب المستخدم غير نشط');
  return data.role as UserRole;
}

function assertRole(role: UserRole, allowed: UserRole[]) {
  if (role === 'admin') return;
  if (!allowed.includes(role)) {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية تنفيذ هذا الإجراء');
  }
}

async function writeAuditLog(entry: {
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  userId: string;
  userName: string;
  details?: string;
}) {
  await db.collection('auditLogs').add({
    ...entry,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ============================================================
// 1) اعتماد إذن صرف الخامات → مخزون خارج من مخزن الخامات
// ============================================================
export const approveMaterialIssue = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');
  const role = await getCallerRole(uid);
  assertRole(role, ['raw_material_keeper']);

  const { issueId } = request.data as { issueId: string };
  if (!issueId) throw new HttpsError('invalid-argument', 'رقم الإذن مطلوب');

  const issueRef = db.collection('materialIssues').doc(issueId);

  await db.runTransaction(async (tx) => {
    const issueSnap = await tx.get(issueRef);
    if (!issueSnap.exists) throw new HttpsError('not-found', 'إذن الصرف غير موجود');
    const issue = issueSnap.data()!;

    if (issue.status === 'approved') {
      throw new HttpsError('failed-precondition', 'الإذن معتمد بالفعل');
    }
    if (issue.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'لا يمكن اعتماد إذن ملغي');
    }
    if (!issue.lines || issue.lines.length === 0) {
      throw new HttpsError('failed-precondition', 'لا يمكن اعتماد إذن بدون أصناف');
    }
    for (const line of issue.lines) {
      if (!(line.quantity > 0)) {
        throw new HttpsError('failed-precondition', `الكمية غير صحيحة للصنف ${line.itemName}`);
      }
    }

    const remainingByItem: Record<string, number> = {};
    for (const line of issue.lines) {
      remainingByItem[line.itemId] = (remainingByItem[line.itemId] || 0) + line.quantity;
    }

    tx.update(issueRef, {
      status: 'approved',
      remainingByItem,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });

    for (const line of issue.lines) {
      const movementRef = db.collection('stockMovements').doc();
      tx.set(movementRef, {
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        warehouseId: issue.sourceWarehouseId,
        warehouseName: issue.sourceWarehouseName,
        movementType: 'issue_out',
        quantity: line.quantity,
        documentId: issueId,
        documentNumber: issue.issueNumber,
        documentType: 'materialIssue',
        date: issue.date,
        userId: uid,
        userName: request.auth?.token.name || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'approve',
    entityType: 'materialIssue',
    entityId: issueId,
    entityLabel: issueId,
    userId: uid,
    userName: request.auth?.token.name || '',
  });

  return { success: true };
});

// ============================================================
// 2) اعتماد إذن تسليم الهالك → مطابقة + مخزون داخل لمخزن الهالك
//    هذا هو قلب النظام: يمنع تسليم أكبر من المتبقي، يفرض سبب الفرق،
//    ويحدّث رصيد الهالك بأمان عبر transaction واحدة.
// ============================================================
export const approveScrapReceipt = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');
  const role = await getCallerRole(uid);
  assertRole(role, ['scrap_keeper', 'reviewer']);

  const { receiptId } = request.data as { receiptId: string };
  if (!receiptId) throw new HttpsError('invalid-argument', 'رقم الإذن مطلوب');

  const receiptRef = db.collection('scrapReceipts').doc(receiptId);

  await db.runTransaction(async (tx) => {
    const receiptSnap = await tx.get(receiptRef);
    if (!receiptSnap.exists) throw new HttpsError('not-found', 'إذن التسليم غير موجود');
    const receipt = receiptSnap.data()!;

    if (receipt.status === 'approved') {
      throw new HttpsError('failed-precondition', 'الإذن معتمد بالفعل');
    }
    if (receipt.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'لا يمكن اعتماد إذن ملغي');
    }

    const issueRef = db.collection('materialIssues').doc(receipt.sourceIssueId);
    const issueSnap = await tx.get(issueRef);
    if (!issueSnap.exists) throw new HttpsError('not-found', 'إذن الصرف الأصلي غير موجود');
    const issue = issueSnap.data()!;
    if (issue.status !== 'approved') {
      throw new HttpsError('failed-precondition', 'إذن الصرف الأصلي غير معتمد');
    }

    const remaining: Record<string, number> = { ...(issue.remainingByItem || {}) };

    // تحقق من عدم تجاوز الكمية المتبقية، وفرض سبب الفرق عند وجوده
    let hasUnresolvedDifference = false;
    for (const line of receipt.lines) {
      const availableRemaining = remaining[line.itemId] ?? 0;
      if (line.deliveredQuantity > availableRemaining) {
        throw new HttpsError(
          'failed-precondition',
          `الكمية المسلمة للصنف ${line.itemName} أكبر من المتبقي من إذن الصرف (${availableRemaining})`
        );
      }
      if (line.difference !== 0 && (!line.differenceReason || !line.differenceReason.trim())) {
        hasUnresolvedDifference = true;
      }
    }
    if (hasUnresolvedDifference) {
      throw new HttpsError(
        'failed-precondition',
        'يوجد فرق في الكمية بدون تسجيل السبب — لا يمكن الاعتماد قبل المراجعة'
      );
    }

    // خصم الكمية المسلمة من المتبقي على إذن الصرف الأصلي (وليس الفرق)
    for (const line of receipt.lines) {
      remaining[line.itemId] = (remaining[line.itemId] ?? 0) - line.deliveredQuantity;
    }

    const overallMatchStatus = receipt.lines.some((l: any) => l.difference !== 0)
      ? 'needs_review'
      : 'matched';

    tx.update(issueRef, { remainingByItem: remaining });

    tx.update(receiptRef, {
      status: 'approved',
      overallMatchStatus,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy: uid,
      reviewedAt: hasUnresolvedDifference ? null : admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });

    for (const line of receipt.lines) {
      if (line.deliveredQuantity <= 0) continue;

      const movementRef = db.collection('stockMovements').doc();
      tx.set(movementRef, {
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        warehouseId: receipt.scrapWarehouseId,
        warehouseName: receipt.scrapWarehouseName,
        movementType: 'scrap_in',
        quantity: line.deliveredQuantity,
        documentId: receiptId,
        documentNumber: receipt.receiptNumber,
        documentType: 'scrapReceipt',
        date: receipt.date,
        userId: uid,
        userName: request.auth?.token.name || '',
        referenceDocumentId: receipt.sourceIssueId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // تحديث رصيد الهالك (المصدر الآمن للتحقق من الرصيد عند البيع)
      const balanceRef = db.collection('scrapBalances').doc(line.itemId);
      const balanceSnap = await tx.get(balanceRef);
      const prevReceived = balanceSnap.exists ? balanceSnap.data()!.totalReceived || 0 : 0;
      const prevSold = balanceSnap.exists ? balanceSnap.data()!.totalSold || 0 : 0;
      const newReceived = prevReceived + line.deliveredQuantity;
      tx.set(
        balanceRef,
        {
          itemId: line.itemId,
          itemCode: line.itemCode,
          itemName: line.itemName,
          scrapType: line.scrapType,
          totalReceived: newReceived,
          totalSold: prevSold,
          balance: newReceived - prevSold,
          lastMovementAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  await writeAuditLog({
    action: 'approve',
    entityType: 'scrapReceipt',
    entityId: receiptId,
    entityLabel: receiptId,
    userId: uid,
    userName: request.auth?.token.name || '',
  });

  return { success: true };
});

// ============================================================
// 3) اعتماد بيع الهالك → خصم آمن من scrapBalances عبر transaction
// ============================================================
export const approveScrapSale = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');
  const role = await getCallerRole(uid);
  assertRole(role, ['scrap_keeper']);

  const { saleId } = request.data as { saleId: string };
  if (!saleId) throw new HttpsError('invalid-argument', 'رقم الفاتورة مطلوب');

  const saleRef = db.collection('scrapSales').doc(saleId);

  await db.runTransaction(async (tx) => {
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists) throw new HttpsError('not-found', 'فاتورة البيع غير موجودة');
    const sale = saleSnap.data()!;

    if (sale.status === 'approved') throw new HttpsError('failed-precondition', 'الفاتورة معتمدة بالفعل');
    if (sale.status === 'cancelled') throw new HttpsError('failed-precondition', 'لا يمكن اعتماد فاتورة ملغية');
    if (!sale.lines || sale.lines.length === 0) {
      throw new HttpsError('failed-precondition', 'لا يمكن اعتماد فاتورة بدون أصناف');
    }

    // تحقق من الرصيد الفعلي لكل صنف — هذا هو التحقق الملزم الوحيد المعتمد
    const balanceRefs = sale.lines.map((l: any) => db.collection('scrapBalances').doc(l.itemId));
    const balanceSnaps = await Promise.all(balanceRefs.map((r: any) => tx.get(r)));

    for (let i = 0; i < sale.lines.length; i++) {
      const line = sale.lines[i];
      const bSnap = balanceSnaps[i];
      const currentBalance = bSnap.exists ? bSnap.data()!.balance || 0 : 0;
      if (line.quantity > currentBalance) {
        throw new HttpsError(
          'failed-precondition',
          `الكمية المطلوب بيعها من ${line.itemName} (${line.quantity}) أكبر من الرصيد المتاح (${currentBalance})`
        );
      }
    }

    tx.update(saleRef, {
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });

    for (let i = 0; i < sale.lines.length; i++) {
      const line = sale.lines[i];
      const bSnap = balanceSnaps[i];
      const prevSold = bSnap.exists ? bSnap.data()!.totalSold || 0 : 0;
      const prevReceived = bSnap.exists ? bSnap.data()!.totalReceived || 0 : 0;
      const newSold = prevSold + line.quantity;

      tx.set(
        balanceRefs[i],
        { totalSold: newSold, balance: prevReceived - newSold, lastMovementAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      const movementRef = db.collection('stockMovements').doc();
      tx.set(movementRef, {
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        warehouseId: sale.scrapWarehouseId || 'scrap',
        warehouseName: 'مخزن الهالك',
        movementType: 'sale_out',
        quantity: line.quantity,
        documentId: saleId,
        documentNumber: sale.saleNumber,
        documentType: 'scrapSale',
        date: sale.date,
        userId: uid,
        userName: request.auth?.token.name || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'approve',
    entityType: 'scrapSale',
    entityId: saleId,
    entityLabel: saleId,
    userId: uid,
    userName: request.auth?.token.name || '',
  });

  return { success: true };
});

// ============================================================
// 4) إلغاء بيع معتمد → حركة عكسية آمنة (صلاحية خاصة: admin أو reviewer)
// ============================================================
export const cancelScrapSale = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');
  const role = await getCallerRole(uid);
  assertRole(role, ['reviewer']);

  const { saleId, reason } = request.data as { saleId: string; reason: string };
  if (!saleId) throw new HttpsError('invalid-argument', 'رقم الفاتورة مطلوب');
  if (!reason || !reason.trim()) {
    throw new HttpsError('invalid-argument', 'سبب الإلغاء مطلوب');
  }

  const saleRef = db.collection('scrapSales').doc(saleId);

  await db.runTransaction(async (tx) => {
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists) throw new HttpsError('not-found', 'الفاتورة غير موجودة');
    const sale = saleSnap.data()!;
    if (sale.status !== 'approved') {
      throw new HttpsError('failed-precondition', 'لا يمكن إلغاء فاتورة غير معتمدة بهذا الإجراء');
    }

    const balanceRefs = sale.lines.map((l: any) => db.collection('scrapBalances').doc(l.itemId));
    const balanceSnaps = await Promise.all(balanceRefs.map((r: any) => tx.get(r)));

    tx.update(saleRef, {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: uid,
      cancelReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });

    for (let i = 0; i < sale.lines.length; i++) {
      const line = sale.lines[i];
      const bSnap = balanceSnaps[i];
      const prevSold = bSnap.exists ? bSnap.data()!.totalSold || 0 : 0;
      const prevReceived = bSnap.exists ? bSnap.data()!.totalReceived || 0 : 0;
      const newSold = Math.max(0, prevSold - line.quantity);

      tx.set(
        balanceRefs[i],
        { totalSold: newSold, balance: prevReceived - newSold, lastMovementAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

      const movementRef = db.collection('stockMovements').doc();
      tx.set(movementRef, {
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        warehouseId: sale.scrapWarehouseId || 'scrap',
        warehouseName: 'مخزن الهالك',
        movementType: 'sale_reversal',
        quantity: line.quantity,
        documentId: saleId,
        documentNumber: sale.saleNumber,
        documentType: 'scrapSale',
        date: admin.firestore.Timestamp.now(),
        userId: uid,
        userName: request.auth?.token.name || '',
        notes: `إلغاء: ${reason}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'cancel',
    entityType: 'scrapSale',
    entityId: saleId,
    entityLabel: saleId,
    userId: uid,
    userName: request.auth?.token.name || '',
    details: reason,
  });

  return { success: true };
});

// ============================================================
// 5) اعتماد سبب الفرق لإذن هالك "بانتظار المراجعة" بدون تغيير الكميات
// ============================================================
export const reviewScrapReceiptDifference = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');
  const role = await getCallerRole(uid);
  assertRole(role, ['reviewer']);

  const { receiptId, lineReasons } = request.data as {
    receiptId: string;
    lineReasons: Record<string, string>; // itemId -> reason
  };
  if (!receiptId) throw new HttpsError('invalid-argument', 'رقم الإذن مطلوب');

  const receiptRef = db.collection('scrapReceipts').doc(receiptId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(receiptRef);
    if (!snap.exists) throw new HttpsError('not-found', 'الإذن غير موجود');
    const receipt = snap.data()!;

    const updatedLines = receipt.lines.map((l: any) =>
      l.difference !== 0 && lineReasons[l.itemId]
        ? { ...l, differenceReason: lineReasons[l.itemId] }
        : l
    );

    tx.update(receiptRef, {
      lines: updatedLines,
      status: 'pending_review',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });
  });

  await writeAuditLog({
    action: 'review',
    entityType: 'scrapReceipt',
    entityId: receiptId,
    entityLabel: receiptId,
    userId: uid,
    userName: request.auth?.token.name || '',
    details: 'تسجيل أسباب الفروق',
  });

  return { success: true };
});

// ============================================================
// 5.5) إنشاء مستخدم جديد (أدمن فقط) — ينشئ حساب Auth + مستند users/{uid}
//      لا يتم عمل هذا من الواجهة مباشرة بـ createUserWithEmailAndPassword
//      لأن ذلك كان سيسجّل دخول الأدمن كمستخدم جديد تلقائيًا في المتصفح.
// ============================================================
export const createUser = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');
  const role = await getCallerRole(uid);
  assertRole(role, []); // admin فقط (assertRole يسمح تلقائيًا للـ admin)

  const { email, password, displayName, newUserRole } = request.data as {
    email: string;
    password: string;
    displayName: string;
    newUserRole: UserRole;
  };

  if (!email || !password || !displayName || !newUserRole) {
    throw new HttpsError('invalid-argument', 'كل الحقول مطلوبة');
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  }

  const validRoles: UserRole[] = ['admin', 'raw_material_keeper', 'production_supervisor', 'scrap_keeper', 'reviewer'];
  if (!validRoles.includes(newUserRole)) {
    throw new HttpsError('invalid-argument', 'دور غير صحيح');
  }

  let newUserRecord;
  try {
    newUserRecord = await admin.auth().createUser({ email, password, displayName });
  } catch (e: any) {
    throw new HttpsError('already-exists', e.message || 'تعذّر إنشاء المستخدم — قد يكون البريد مستخدمًا بالفعل');
  }

  await db.collection('users').doc(newUserRecord.uid).set({
    email,
    displayName,
    role: newUserRole,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  await writeAuditLog({
    action: 'create',
    entityType: 'user',
    entityId: newUserRecord.uid,
    entityLabel: email,
    userId: uid,
    userName: request.auth?.token.name || '',
    details: `دور: ${newUserRole}`,
  });

  return { success: true, uid: newUserRecord.uid };
});

// ============================================================
// 6) إنشاء أول Admin (يُستدعى يدويًا مرة واحدة فقط عبر سكريبت منفصل — انظر README)
// ============================================================
export const bootstrapAdmin = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول');

  const usersSnap = await db.collection('users').limit(1).get();
  if (!usersSnap.empty) {
    throw new HttpsError(
      'failed-precondition',
      'يوجد مستخدمون بالفعل — لا يمكن استخدام هذه الوظيفة إلا مرة واحدة عند إنشاء أول حساب'
    );
  }

  const { displayName } = request.data as { displayName: string };

  await db.collection('users').doc(uid).set({
    email: request.auth?.token.email || '',
    displayName: displayName || request.auth?.token.email || 'Admin',
    role: 'admin',
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
