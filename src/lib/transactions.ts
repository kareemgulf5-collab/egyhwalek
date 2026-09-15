import {
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  collection,
  addDoc,
} from 'firebase/firestore';
import { db } from './firebase';

async function writeAuditLog(entry: {
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  userId: string;
  userName: string;
  details?: string;
}) {
  await addDoc(collection(db, 'auditLogs'), {
    ...entry,
    timestamp: serverTimestamp(),
  });
}

export async function approveMaterialIssue(issueId: string, uid: string, userName: string) {
  const issueRef = doc(db, 'materialIssues', issueId);

  await runTransaction(db, async (tx) => {
    const issueSnap = await tx.get(issueRef);
    if (!issueSnap.exists()) throw new Error('إذن الصرف غير موجود');
    const issue = issueSnap.data();

    if (issue.status === 'approved') throw new Error('الإذن معتمد بالفعل');
    if (issue.status === 'cancelled') throw new Error('لا يمكن اعتماد إذن ملغي');
    if (!issue.lines || issue.lines.length === 0) throw new Error('لا يمكن اعتماد إذن بدون أصناف');
    for (const line of issue.lines) {
      if (!(line.quantity > 0)) throw new Error(`الكمية غير صحيحة للصنف ${line.itemName}`);
    }

    const remainingByItem: Record<string, number> = {};
    for (const line of issue.lines) {
      remainingByItem[line.itemId] = (remainingByItem[line.itemId] || 0) + line.quantity;
    }

    tx.update(issueRef, {
      status: 'approved',
      remainingByItem,
      approvedAt: serverTimestamp(),
      approvedBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });

    for (const line of issue.lines) {
      const movementRef = doc(collection(db, 'stockMovements'));
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
        userName,
        createdAt: serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'approve', entityType: 'materialIssue', entityId: issueId,
    entityLabel: issueId, userId: uid, userName,
  });
}

export async function approveScrapReceipt(receiptId: string, uid: string, userName: string) {
  const receiptRef = doc(db, 'scrapReceipts', receiptId);

  await runTransaction(db, async (tx) => {
    const receiptSnap = await tx.get(receiptRef);
    if (!receiptSnap.exists()) throw new Error('إذن التسليم غير موجود');
    const receipt = receiptSnap.data();

    if (receipt.status === 'approved') throw new Error('الإذن معتمد بالفعل');
    if (receipt.status === 'cancelled') throw new Error('لا يمكن اعتماد إذن ملغي');

    const issueRef = doc(db, 'materialIssues', receipt.sourceIssueId);
    const issueSnap = await tx.get(issueRef);
    if (!issueSnap.exists()) throw new Error('إذن الصرف الأصلي غير موجود');
    const issue = issueSnap.data();
    if (issue.status !== 'approved') throw new Error('إذن الصرف الأصلي غير معتمد');

    const remaining: Record<string, number> = { ...(issue.remainingByItem || {}) };

    let hasUnresolvedDifference = false;
    for (const line of receipt.lines) {
      const availableRemaining = remaining[line.itemId] ?? 0;
      if (line.deliveredQuantity > availableRemaining) {
        throw new Error(
          `الكمية المسلمة للصنف ${line.itemName} أكبر من المتبقي من إذن الصرف (${availableRemaining})`
        );
      }
      if (line.difference !== 0 && (!line.differenceReason || !line.differenceReason.trim())) {
        hasUnresolvedDifference = true;
      }
    }
    if (hasUnresolvedDifference) {
      throw new Error('يوجد فرق في الكمية بدون تسجيل السبب — لا يمكن الاعتماد قبل المراجعة');
    }

    for (const line of receipt.lines) {
      remaining[line.itemId] = (remaining[line.itemId] ?? 0) - line.deliveredQuantity;
    }

    const overallMatchStatus = receipt.lines.some((l: any) => l.difference !== 0) ? 'needs_review' : 'matched';

    const balanceRefs = receipt.lines
      .filter((l: any) => l.deliveredQuantity > 0)
      .map((l: any) => doc(db, 'scrapBalances', l.itemId));
    const balanceSnaps = await Promise.all(balanceRefs.map((r: any) => tx.get(r)));

    tx.update(issueRef, { remainingByItem: remaining });
    tx.update(receiptRef, {
      status: 'approved',
      overallMatchStatus,
      approvedAt: serverTimestamp(),
      approvedBy: uid,
      reviewedAt: serverTimestamp(),
      reviewedBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });

    const deliveredLines = receipt.lines.filter((l: any) => l.deliveredQuantity > 0);
    for (let i = 0; i < deliveredLines.length; i++) {
      const line = deliveredLines[i];

      const movementRef = doc(collection(db, 'stockMovements'));
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
        userName,
        referenceDocumentId: receipt.sourceIssueId,
        createdAt: serverTimestamp(),
      });

      const balanceSnap = balanceSnaps[i];
      const prevReceived = balanceSnap.exists() ? balanceSnap.data()!.totalReceived || 0 : 0;
      const prevSold = balanceSnap.exists() ? balanceSnap.data()!.totalSold || 0 : 0;
      const newReceived = prevReceived + line.deliveredQuantity;
      tx.set(
        balanceRefs[i],
        {
          itemId: line.itemId,
          itemCode: line.itemCode,
          itemName: line.itemName,
          scrapType: line.scrapType,
          totalReceived: newReceived,
          totalSold: prevSold,
          balance: newReceived - prevSold,
          lastMovementAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  await writeAuditLog({
    action: 'approve', entityType: 'scrapReceipt', entityId: receiptId,
    entityLabel: receiptId, userId: uid, userName,
  });
}

export async function approveScrapSale(saleId: string, uid: string, userName: string) {
  const saleRef = doc(db, 'scrapSales', saleId);

  await runTransaction(db, async (tx) => {
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists()) throw new Error('فاتورة البيع غير موجودة');
    const sale = saleSnap.data();

    if (sale.status === 'approved') throw new Error('الفاتورة معتمدة بالفعل');
    if (sale.status === 'cancelled') throw new Error('لا يمكن اعتماد فاتورة ملغية');
    if (!sale.lines || sale.lines.length === 0) throw new Error('لا يمكن اعتماد فاتورة بدون أصناف');

    const balanceRefs = sale.lines.map((l: any) => doc(db, 'scrapBalances', l.itemId));
    const balanceSnaps = await Promise.all(balanceRefs.map((r: any) => tx.get(r)));

    for (let i = 0; i < sale.lines.length; i++) {
      const line = sale.lines[i];
      const bSnap = balanceSnaps[i];
      const currentBalance = bSnap.exists() ? bSnap.data().balance || 0 : 0;
      if (line.quantity > currentBalance) {
        throw new Error(`الكمية المطلوب بيعها من ${line.itemName} (${line.quantity}) أكبر من الرصيد المتاح (${currentBalance})`);
      }
    }

    tx.update(saleRef, {
      status: 'approved',
      approvedAt: serverTimestamp(),
      approvedBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });

    for (let i = 0; i < sale.lines.length; i++) {
      const line = sale.lines[i];
      const bSnap = balanceSnaps[i];
      const prevSold = bSnap.exists() ? bSnap.data().totalSold || 0 : 0;
      const prevReceived = bSnap.exists() ? bSnap.data().totalReceived || 0 : 0;
      const newSold = prevSold + line.quantity;

      tx.set(
        balanceRefs[i],
        { totalSold: newSold, balance: prevReceived - newSold, lastMovementAt: serverTimestamp() },
        { merge: true }
      );

      const movementRef = doc(collection(db, 'stockMovements'));
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
        userName,
        createdAt: serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'approve', entityType: 'scrapSale', entityId: saleId,
    entityLabel: saleId, userId: uid, userName,
  });
}

export async function cancelScrapSale(saleId: string, reason: string, uid: string, userName: string) {
  const saleRef = doc(db, 'scrapSales', saleId);

  await runTransaction(db, async (tx) => {
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists()) throw new Error('الفاتورة غير موجودة');
    const sale = saleSnap.data();
    if (sale.status !== 'approved') throw new Error('لا يمكن إلغاء فاتورة غير معتمدة بهذا الإجراء');

    const balanceRefs = sale.lines.map((l: any) => doc(db, 'scrapBalances', l.itemId));
    const balanceSnaps = await Promise.all(balanceRefs.map((r: any) => tx.get(r)));

    tx.update(saleRef, {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      cancelledBy: uid,
      cancelReason: reason,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });

    for (let i = 0; i < sale.lines.length; i++) {
      const line = sale.lines[i];
      const bSnap = balanceSnaps[i];
      const prevSold = bSnap.exists() ? bSnap.data().totalSold || 0 : 0;
      const prevReceived = bSnap.exists() ? bSnap.data().totalReceived || 0 : 0;
      const newSold = Math.max(0, prevSold - line.quantity);

      tx.set(
        balanceRefs[i],
        { totalSold: newSold, balance: prevReceived - newSold, lastMovementAt: serverTimestamp() },
        { merge: true }
      );

      const movementRef = doc(collection(db, 'stockMovements'));
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
        date: Timestamp.now(),
        userId: uid,
        userName,
        notes: `إلغاء: ${reason}`,
        createdAt: serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    action: 'cancel', entityType: 'scrapSale', entityId: saleId,
    entityLabel: saleId, userId: uid, userName, details: reason,
  });
}
