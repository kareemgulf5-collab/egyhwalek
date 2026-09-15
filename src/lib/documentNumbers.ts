import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';

const PREFIXES: Record<string, string> = {
  materialIssue: 'MI',
  scrapReceipt: 'SR',
  scrapSale: 'SS',
};

/**
 * يولّد رقم مستند تسلسلي فريد بصيغة PREFIX-YYYY-000001
 * باستخدام Firestore transaction على settings/counters_{type} لمنع التعارض.
 */
export async function generateDocumentNumber(
  type: 'materialIssue' | 'scrapReceipt' | 'scrapSale'
): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'settings', `counter_${type}`);
  const prefix = PREFIXES[type];

  const newNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    let lastNumber = 0;
    let counterYear = year;

    if (snap.exists()) {
      const data = snap.data() as { lastNumber: number; year: number };
      counterYear = data.year === year ? data.year : year;
      lastNumber = data.year === year ? data.lastNumber : 0;
    }

    const next = lastNumber + 1;
    tx.set(counterRef, { prefix, lastNumber: next, year: counterYear }, { merge: true });
    return next;
  });

  return `${prefix}-${year}-${String(newNumber).padStart(6, '0')}`;
}
