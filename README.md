# نظام إدارة الفوارغ والهالك — EgyGulf Foods

ويب آب لإدارة دورة العمل الكاملة: مخزن الخامات ← صالة الإنتاج ← مخزن الهالك ← مبيعات الهالك،
مع مطابقة تلقائية بين الكميات المصروفة والمسلمة، ورصيد هالك دقيق ومحدَّث لحظيًا.

**التقنيات:** React + TypeScript + Vite + Tailwind CSS + Firebase (Firestore, Authentication) + Vercel.

> **ملاحظة مهمة عن التكلفة:** النسخة دي مبنية بالكامل عشان تشتغل على **خطة Firebase المجانية (Spark)** —
> من غير أي بطاقة ائتمان أو ترقية. راجعي قسم "لماذا مفيش Cloud Functions؟" أسفل للتفاصيل.

---

## 1) التشغيل محليًا (Local)

### المتطلبات
- Node.js 20+
- حساب Firebase (مجاني بالكامل — Spark Plan)

### الخطوات

```bash
npm install
cp .env.example .env.local
npm run dev
```

يفتح المشروع على `http://localhost:5173`.

---

## 2) ربط GitHub بـ Vercel

1. أنشئي ريبو جديد على GitHub وارفعي المشروع:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <رابط الريبو بتاعك>
   git push -u origin main
   ```
2. على vercel.com: New Project ← اختاري الريبو ← Framework: Vite (يتم اكتشافه تلقائيًا من vercel.json).
3. أضيفي Environment Variables في إعدادات المشروع على Vercel (نفس القيم الموجودة في .env.local — راجعي القسم 3).
4. اضغطي Deploy. عند كل git push على main، ينشر Vercel نسخة جديدة تلقائيًا.

Vercel نفسه مجاني تمامًا لمشروع بالحجم ده (Hobby Plan) — مش هتحتاجي تدفعي حاجة هنا برضو.

---

## 3) إعداد Firebase (مجاني بالكامل — بدون Blaze)

### أ) إنشاء المشروع
اذهبي إلى console.firebase.google.com ← Add Project. لا داعي لترقية أي خطة — خطة Spark المجانية كافية تمامًا.

### ب) Firestore Database
1. Firestore Database ← Create Database ← اختاري أقرب Region (مثلاً eur3 أو europe-west1).
2. اختاري Production mode.
3. لن تحتاجي لإنشاء Collections يدويًا — يتم إنشاؤها تلقائيًا عند أول عملية كتابة.

### ج) Authentication
Authentication ← Sign-in method ← فعّلي Email/Password.

### د) نشر Security Rules و Indexes
هذه الخطوة الوحيدة المحتاجة Terminal، وبتاخد دقيقتين:

```bash
npm install -g firebase-tools
firebase login
cd scrap-mgmt
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

### هـ) الحصول على قيم Environment Variables
Project Settings ← Your apps ← أضيفي تطبيق ويب (</>) ← انسخي قيم firebaseConfig إلى .env.local وإلى Vercel.

### و) Backup لقاعدة البيانات (اختياري)
من Firestore Console ← Backups ← Create backup schedule، أو تصدير يدوي من نفس الشاشة.

---

## 4) طريقة إنشاء أول Admin

1. Authentication ← Users ← Add user ← حطي بريدك وكلمة مرور.
2. افتحي التطبيق وسجّلي دخول بنفس البريد وكلمة المرور.
3. بما إنه أول مستخدم، هتظهرلك شاشة "تفعيلي كمدير للنظام" — دوسي عليها.
4. هذه الخطوة بتتحقق فعليًا (من الكود ومن Firestore Rules معًا) إن مفيش مستخدمين مسجّلين قبل كده.
5. بعد كده، من تابة "المستخدمون" في القائمة الجانبية، ضيفي بقية الموظفين وحددي دور كل واحد.

---

## 5) Environment Variables المطلوبة

VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID

كل هذه القيم عامة وآمن وضعها في الفرونت إند — الحماية الحقيقية عبر Firestore Security Rules.

---

## 6) شرح الملفات المهمة

- src/lib/firebase.ts — إعداد اتصال Firebase (Auth, Firestore)
- src/lib/documentNumbers.ts — توليد أرقام مستندات تسلسلية آمنة
- src/lib/transactions.ts — كل منطق الاعتماد الحرج (بديل Cloud Functions): approveMaterialIssue, approveScrapReceipt, approveScrapSale, cancelScrapSale
- src/lib/userAdmin.ts — إنشاء مستخدمين جدد + تفعيل أول أدمن
- src/types/index.ts — كل أنواع بيانات Firestore
- src/contexts/AuthContext.tsx — تسجيل الدخول وتحديد الدور
- src/pages/MaterialIssues.tsx — تابة صرف الخامات
- src/pages/ScrapReceipts.tsx — تابة تسليم الهالك + جدول المطابقة (أهم تابة)
- src/pages/ScrapSales.tsx — تابة مبيعات الهالك
- src/pages/ScrapBalance.tsx — تابة رصيد الهالك
- src/pages/Reports.tsx — التقارير
- src/pages/Users.tsx — إدارة المستخدمين (أدمن فقط)
- firestore.rules — قواعد الصلاحيات الملزمة
- functions/ — نسخة Cloud Functions الأصلية، غير مفعّلة حاليًا، محفوظة كمسار ترقية اختياري

---

## 7) لماذا مفيش Cloud Functions؟

Firebase بيقسّم خدماته لخطتين: Spark (مجانية تمامًا: Firestore + Auth + Hosting بحدود سخية)
و Blaze (بتضيف Cloud Functions، وبتطلب بطاقة ائتمان حتى لو الاستخدام الفعلي فاضل جوه الحد المجاني).

بما إنك مش عايزة تربطي بطاقة، كل منطق الاعتماد الحرج (منع بيع كمية أكبر من الرصيد، منع تسليم
أكبر من المتبقي، فرض تسجيل سبب الفرق) بقى شغّال من المتصفح مباشرة، لكن بنفس ضمانة الأمان
الأساسية: بيستخدم Firestore Transactions في src/lib/transactions.ts، وهي آلية من Firebase نفسها
بتضمن إن العملية كاملة تنجح أو تفشل كاملة حتى لو أكتر من موظف بيعملوا حركة في نفس اللحظة بالظبط.

الفرق الحقيقي: مع Cloud Functions كانت الحماية بتتم على مستوى كل رقم وكل حقل على السيرفر.
دلوقتي الحماية على مستوى "مين يقدر يكتب في المستند ده" (عبر firestore.rules)، مش على مستوى صحة
الرقم رياضيًا. ده مقبول جدًا لنظام داخلي بعدد محدود من الموظفين الموثوقين، وكل حركة بتتسجل
باسم صاحبها في auditLogs.

لو حبيتي مستقبلًا ترجعي للنسخة الأكثر تشددًا، فعّلي خطة Blaze وشغّلي:
cd functions && npm install && npm run build && firebase deploy --only functions
وارجعي استدعاءات الصفحات لـ httpsCallable زي ما كانت.

---

## 8) خطة الاختبار

1. إنشاء صنف — تابة الأصناف
2. إنشاء إذن صرف — تابة صرف الخامات
3. اعتماد إذن صرف — الحالة تتحول معتمد و remainingByItem يُحسب
4. تسليم هالك مطابق — فرق = صفر
5. تسليم هالك فيه فرق — يظهر تنبيه فورًا
6. ظهور التنبيه في Dashboard
7. منع الاعتماد بدون سبب للفرق
8. تسجيل السبب والاعتماد
9. تحديث رصيد الهالك بعد الاعتماد
10. تسجيل مبيعات هالك وخصم الرصيد
11. منع بيع كمية أكبر من الرصيد
12. منع تكرار تسليم نفس الكمية
13. إلغاء فاتورة معتمدة بصلاحية المراجع فقط
14. بقاء البيانات بعد إعادة تحميل الصفحة
15. عمل المشروع بعد النشر على Vercel

نفّذي هذه الاختبارات فعليًا على مشروعك بعد الإعداد، لأن بيئة كتابة الكود دي ملهاش اتصال إنترنت.

---

## 9) بيانات تجريبية

نزّلي Service Account Key من Firebase Console > Project Settings > Service Accounts واحفظيه
في scripts/serviceAccountKey.json (متجاهل في .gitignore)، بعدين شغّلي: npm run seed
بينشئ مخزن خامات، مخزن هالك، صالة إنتاج، و5 أصناف فوارغ.

---

## 10) نقاط تحتاج إعداد يدوي منك

1. إنشاء مشروع Firebase فعلي وربطه بالمفاتيح (القسم 3 و5)
2. رفع الريبو على GitHub وربطه بـ Vercel (القسم 2)
3. نشر Firestore Rules والـ Indexes (القسم 3-د) — مهم جدًا، من غيرها كل الكتابة هترفض
4. إنشاء أول Admin (القسم 4)
5. اختبار السيناريوهات في القسم 8 فعليًا

---

## 11) الأدوار والصلاحيات

- admin: كل الصلاحيات
- raw_material_keeper (أمين مخزن الخامات): إنشاء واعتماد أذونات الصرف
- production_supervisor (مسؤول الإنتاج): إنشاء أذونات تسليم الهالك
- scrap_keeper (أمين مخزن الهالك): اعتماد تسليم الهالك، إنشاء واعتماد فواتير البيع
- reviewer (المراجع/المحاسب): مراجعة الفروق، اعتماد تسليم الهالك، إلغاء فواتير البيع
