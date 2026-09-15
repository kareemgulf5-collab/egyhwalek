/**
 * سكريبت تعبئة بيانات تجريبية (Seed Data)
 *
 * الاستخدام:
 *   1) نزّل Service Account Key من Firebase Console > Project Settings > Service Accounts
 *      واحفظه باسم scripts/serviceAccountKey.json (هذا الملف مُتجاهل في .gitignore ولا يُرفع أبدًا).
 *   2) npm run seed
 *
 * البيانات هنا للتجربة فقط ومنفصلة تمامًا عن بيانات الإنتاج الحقيقية —
 * لا تُشغّل هذا السكريبت على مشروع Firebase الإنتاجي الحقيقي.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, 'serviceAccountKey.json');

let serviceAccount: any;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf-8'));
} catch {
  console.error(
    '❌ لم يتم العثور على scripts/serviceAccountKey.json\nنزّله من Firebase Console > Project Settings > Service Accounts > Generate new private key'
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

async function seed() {
  console.log('🌱 جاري تعبئة البيانات التجريبية...');

  // مخازن
  const rawWh = await db.collection('warehouses').add({
    code: 'WH-RAW-01', name: 'مخزن الخامات الرئيسي', type: 'raw_materials', active: true, createdAt: now,
  });
  const scrapWh = await db.collection('warehouses').add({
    code: 'WH-SCRAP-01', name: 'مخزن الهالك الرئيسي', type: 'scrap', active: true, createdAt: now,
  });

  // صالة إنتاج
  const area = await db.collection('productionAreas').add({
    code: 'PA-01', name: 'صالة الإنتاج الأولى', active: true, createdAt: now,
  });

  // أصناف
  const itemsData = [
    { code: 'ITM-001', name: 'جركن بلاستيك 5 لتر', scrapType: 'جركن' },
    { code: 'ITM-002', name: 'علبة معدنية', scrapType: 'علبة' },
    { code: 'ITM-003', name: 'كرتونة تعبئة', scrapType: 'كرتونة' },
    { code: 'ITM-004', name: 'زجاجة زجاج', scrapType: 'زجاجة' },
    { code: 'ITM-005', name: 'جركن بلاستيك 20 لتر', scrapType: 'جركن' },
  ];
  const itemRefs: Record<string, FirebaseFirestore.DocumentReference> = {};
  for (const it of itemsData) {
    const ref = await db.collection('items').add({
      ...it, unit: 'عدد', active: true, createdAt: now, updatedAt: now, createdBy: 'seed', updatedBy: 'seed',
    });
    itemRefs[it.code] = ref;
  }

  console.log('✅ تم إنشاء المخازن والصالات والأصناف الأساسية.');
  console.log('ℹ️  لإنشاء أذونات صرف/تسليم/بيع تجريبية معتمدة، استخدم الواجهة مباشرة');
  console.log('    لأن الاعتماد يمر عبر Cloud Functions (approveMaterialIssue إلخ) التي تتطلب مصادقة مستخدم حقيقي.');
  console.log('');
  console.log('🎉 اكتملت التعبئة الأساسية بنجاح.');
  process.exit(0);
}

seed().catch((e) => {
  console.error('❌ فشلت التعبئة:', e);
  process.exit(1);
});
