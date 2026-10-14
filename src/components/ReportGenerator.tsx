import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { orderBy } from 'firebase/firestore';
import { format, startOfMonth } from 'date-fns';
import { FileText, Printer, X } from 'lucide-react';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Modal, Select, LoadingState } from '@/components/ui';
import type { Item, MaterialIssue, ScrapReceipt, ScrapSale, StockMovement, DocumentStatus } from '@/types';

// ===================== أنواع التقارير =====================
type ReportKind = 'period' | 'document' | 'item' | 'balance' | 'differences';
type DocKind = 'issue' | 'receipt' | 'sale';

const REPORT_KINDS: { key: ReportKind; label: string; hint: string }[] = [
  { key: 'period', label: 'تقرير شامل للفترة', hint: 'المنصرف والمسلم للهالك والفروق والمبيعات خلال فترة' },
  { key: 'document', label: 'تقرير مستند واحد', hint: 'طباعة إذن صرف أو إذن تسليم هالك أو فاتورة بيع' },
  { key: 'item', label: 'تقرير صنف معين', hint: 'كل حركة صنف واحد خلال فترة ورصيده الحالي' },
  { key: 'balance', label: 'رصيد الهالك الحالي', hint: 'رصيد كل الأصناف في مخزن الهالك الآن' },
  { key: 'differences', label: 'تقرير الفروق', hint: 'الفروق بين المصروف والمسلم للهالك خلال فترة' },
];

const DOC_KINDS: { key: DocKind; label: string }[] = [
  { key: 'issue', label: 'إذن صرف خامات' },
  { key: 'receipt', label: 'إذن تسليم فوارغ للهالك' },
  { key: 'sale', label: 'فاتورة بيع هالك' },
];

interface ScrapBalanceRow {
  id: string;
  itemCode: string;
  itemName: string;
  scrapType: string;
  totalReceived: number;
  totalSold: number;
  balance: number;
}

interface ReportRequest {
  kind: ReportKind;
  from: string;
  to: string;
  itemId?: string;
  docKind?: DocKind;
  docId?: string;
}

// ===================== أدوات مساعدة =====================
const fmtDate = (ts: any) => (ts?.toDate ? format(ts.toDate(), 'yyyy/MM/dd') : '—');
const fmtNum = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');
const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: 'مسودة',
  pending_review: 'قيد المراجعة',
  approved: 'معتمد',
  cancelled: 'ملغي',
};

function inRange(ts: any, from: string, to: string) {
  if (!ts?.toDate) return false;
  const d = ts.toDate();
  if (from && d < new Date(from + 'T00:00:00')) return false;
  if (to && d > new Date(to + 'T23:59:59')) return false;
  return true;
}

function periodText(from: string, to: string) {
  if (from && to) return `من ${from.replace(/-/g, '/')} إلى ${to.replace(/-/g, '/')}`;
  if (from) return `من ${from.replace(/-/g, '/')}`;
  if (to) return `حتى ${to.replace(/-/g, '/')}`;
  return 'كل الفترات';
}

// ===================== الزرار + نافذة الاختيار =====================
export default function ReportGenerator({ label = 'طلّع تقرير' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<ReportRequest | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FileText size={16} /> {label}
      </Button>
      {open && (
        <ReportPicker
          onClose={() => setOpen(false)}
          onGenerate={(r) => {
            setOpen(false);
            setRequest(r);
          }}
        />
      )}
      {request && <ReportPreview request={request} onClose={() => setRequest(null)} />}
    </>
  );
}

function ReportPicker({ onClose, onGenerate }: { onClose: () => void; onGenerate: (r: ReportRequest) => void }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [kind, setKind] = useState<ReportKind>('period');
  const [from, setFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [to, setTo] = useState(today);
  const [itemId, setItemId] = useState('');
  const [docKind, setDocKind] = useState<DocKind>('issue');
  const [docId, setDocId] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [error, setError] = useState('');

  const { data: items } = useCollection<Item>('items', [orderBy('name')]);
  const { data: issues } = useCollection<MaterialIssue>('materialIssues', [orderBy('date', 'desc')]);
  const { data: receipts } = useCollection<ScrapReceipt>('scrapReceipts', [orderBy('date', 'desc')]);
  const { data: sales } = useCollection<ScrapSale>('scrapSales', [orderBy('date', 'desc')]);

  const docOptions = useMemo(() => {
    const list =
      docKind === 'issue'
        ? issues.map((d) => ({ id: d.id, label: `${d.issueNumber} — ${fmtDate(d.date)} — ${d.productionAreaName}` }))
        : docKind === 'receipt'
        ? receipts.map((d) => ({ id: d.id, label: `${d.receiptNumber} — ${fmtDate(d.date)} — صرف ${d.sourceIssueNumber}` }))
        : sales.map((d) => ({ id: d.id, label: `${d.saleNumber} — ${fmtDate(d.date)} — ${d.customerName}` }));
    return docSearch ? list.filter((o) => o.label.includes(docSearch)) : list;
  }, [docKind, issues, receipts, sales, docSearch]);

  useEffect(() => setDocId(''), [docKind]);

  const needsPeriod = kind === 'period' || kind === 'item' || kind === 'differences';

  const submit = () => {
    setError('');
    if (needsPeriod && from && to && from > to) return setError('تاريخ البداية بعد تاريخ النهاية');
    if (kind === 'item' && !itemId) return setError('اختار الصنف');
    if (kind === 'document' && !docId) return setError('اختار المستند');
    onGenerate({ kind, from: needsPeriod ? from : '', to: needsPeriod ? to : '', itemId, docKind, docId });
  };

  return (
    <Modal open onClose={onClose} title="طلّع تقرير" widthClass="max-w-lg">
      <div className="space-y-4">
        <div className="grid gap-2">
          {REPORT_KINDS.map((k) => (
            <label
              key={k.key}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                kind === k.key ? 'border-brand-500 bg-brand-50' : 'border-surface-200 hover:bg-surface-50'
              }`}
            >
              <input type="radio" className="mt-1" checked={kind === k.key} onChange={() => setKind(k.key)} />
              <span>
                <span className="block text-sm font-semibold text-gray-900">{k.label}</span>
                <span className="block text-xs text-gray-500">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {kind === 'item' && (
          <Select label="الصنف" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">— اختار الصنف —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.name}
              </option>
            ))}
          </Select>
        )}

        {kind === 'document' && (
          <div className="space-y-3">
            <Select label="نوع المستند" value={docKind} onChange={(e) => setDocKind(e.target.value as DocKind)}>
              {DOC_KINDS.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </Select>
            <input
              className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm"
              placeholder="ابحث برقم المستند أو التاريخ أو الاسم..."
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
            />
            <Select label="المستند" value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">— اختار المستند ({docOptions.length}) —</option>
              {docOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          </div>
        )}

        {needsPeriod && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-gray-700 font-medium mb-1">من تاريخ</span>
              <input type="date" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block text-gray-700 font-medium mb-1">إلى تاريخ</span>
              <input type="date" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit}><FileText size={16} /> عرض التقرير</Button>
        </div>
      </div>
    </Modal>
  );
}

// ===================== معاينة التقرير والطباعة =====================
function ReportPreview({ request, onClose }: { request: ReportRequest; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add('report-open');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('report-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="report-root fixed inset-0 z-[60] overflow-y-auto bg-surface-100">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-surface-200 bg-white px-5 py-3 shadow-sm">
        <span className="text-sm font-semibold text-gray-700">معاينة التقرير</span>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}><Printer size={16} /> طباعة / حفظ PDF</Button>
          <Button variant="secondary" onClick={onClose}><X size={16} /> إغلاق</Button>
        </div>
      </div>
      <div className="report-page mx-auto my-6 max-w-[900px] bg-white p-10 shadow-sm">
        <ReportBody request={request} />
      </div>
    </div>,
    document.body
  );
}

function ReportBody({ request }: { request: ReportRequest }) {
  const { appUser } = useAuth();
  const { data: items, loading: l0 } = useCollection<Item>('items', [orderBy('name')]);
  const { data: issues, loading: l1 } = useCollection<MaterialIssue>('materialIssues', [orderBy('date', 'desc')]);
  const { data: receipts, loading: l2 } = useCollection<ScrapReceipt>('scrapReceipts', [orderBy('date', 'desc')]);
  const { data: sales, loading: l3 } = useCollection<ScrapSale>('scrapSales', [orderBy('date', 'desc')]);
  const { data: movements, loading: l4 } = useCollection<StockMovement>('stockMovements', [orderBy('date', 'desc')]);
  const { data: balances, loading: l5 } = useCollection<ScrapBalanceRow>('scrapBalances');

  if (l0 || l1 || l2 || l3 || l4 || l5) return <LoadingState message="جاري تجهيز التقرير..." />;

  const by = appUser?.displayName || appUser?.email || '';
  const { kind, from, to } = request;

  if (kind === 'balance') {
    const rows = [...balances].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || '', 'ar'));
    return (
      <>
        <ReportHeader title="تقرير رصيد الهالك" subtitle={`الرصيد حتى ${format(new Date(), 'yyyy/MM/dd')}`} by={by} />
        <Summary
          cells={[
            ['عدد الأصناف', rows.length],
            ['إجمالي الوارد', fmtNum(rows.reduce((s, r) => s + (r.totalReceived || 0), 0))],
            ['إجمالي المباع', fmtNum(rows.reduce((s, r) => s + (r.totalSold || 0), 0))],
            ['إجمالي الرصيد', fmtNum(rows.reduce((s, r) => s + (r.balance || 0), 0))],
          ]}
        />
        <Table
          head={['#', 'الكود', 'الصنف', 'النوع', 'إجمالي الوارد', 'إجمالي المباع', 'الرصيد الحالي']}
          rows={rows.map((r, i) => [i + 1, r.itemCode, r.itemName, r.scrapType, fmtNum(r.totalReceived), fmtNum(r.totalSold), <b key="b">{fmtNum(r.balance)}</b>])}
        />
        <Signatures />
      </>
    );
  }

  if (kind === 'document') {
    return <DocumentReport request={request} issues={issues} receipts={receipts} sales={sales} by={by} />;
  }

  const pIssues = issues.filter((d) => d.status !== 'cancelled' && inRange(d.date, from, to));
  const pReceipts = receipts.filter((d) => d.status !== 'cancelled' && inRange(d.date, from, to));
  const pSales = sales.filter((d) => d.status !== 'cancelled' && inRange(d.date, from, to));

  const diffLines = pReceipts.flatMap((r) =>
    r.lines
      .filter((l) => l.difference !== 0 && (!request.itemId || l.itemId === request.itemId))
      .map((l) => ({ r, l }))
  );

  if (kind === 'differences') {
    return (
      <>
        <ReportHeader title="تقرير الفروق" subtitle={periodText(from, to)} by={by} />
        <Summary
          cells={[
            ['عدد أذون التسليم', pReceipts.length],
            ['سطور بها فروق', diffLines.length],
            ['إجمالي الفروق', fmtNum(diffLines.reduce((s, x) => s + x.l.difference, 0))],
          ]}
        />
        {diffLines.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={['#', 'التاريخ', 'إذن التسليم', 'إذن الصرف', 'الصنف', 'المصروف', 'المسلم', 'الفرق', 'السبب']}
            rows={diffLines.map(({ r, l }, i) => [
              i + 1, fmtDate(r.date), r.receiptNumber, r.sourceIssueNumber, l.itemName,
              fmtNum(l.issuedQuantity), fmtNum(l.deliveredQuantity), <b key="d" className="text-red-700">{fmtNum(l.difference)}</b>, l.differenceReason || '—',
            ])}
          />
        )}
        <Signatures />
      </>
    );
  }

  if (kind === 'item') {
    const item = items.find((i) => i.id === request.itemId);
    const mv = movements.filter((m) => m.itemId === request.itemId && inRange(m.date, from, to));
    const sum = (t: string) => mv.filter((m) => m.movementType === t).reduce((s, m) => s + (m.quantity || 0), 0);
    const issued = sum('issue_out');
    const received = sum('scrap_in');
    const sold = sum('sale_out') - sum('sale_reversal');
    const bal = balances.find((b) => b.id === request.itemId);
    const itemDiffs = diffLines.filter(({ l }) => l.itemId === request.itemId);
    const typeLabel: Record<string, string> = { issue_out: 'صرف من الخامات', scrap_in: 'وارد للهالك', sale_out: 'بيع هالك', sale_reversal: 'إلغاء بيع' };
    return (
      <>
        <ReportHeader
          title={`تقرير صنف: ${item?.name || '—'}`}
          subtitle={`الكود ${item?.code || '—'} — ${item?.scrapType || ''} — ${periodText(from, to)}`}
          by={by}
        />
        <Summary
          cells={[
            ['المصروف من الخامات', fmtNum(issued)],
            ['المسلم للهالك', fmtNum(received)],
            ['المباع', fmtNum(sold)],
            ['الفرق (مصروف − مسلم)', fmtNum(issued - received)],
            ['رصيد الهالك الحالي', fmtNum(bal?.balance)],
          ]}
        />
        <h3 className="report-h3">الحركات خلال الفترة ({mv.length})</h3>
        {mv.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={['#', 'التاريخ', 'نوع الحركة', 'المخزن', 'رقم المستند', 'الكمية', 'بواسطة']}
            rows={[...mv].reverse().map((m, i) => [i + 1, fmtDate(m.date), typeLabel[m.movementType] || m.movementType, m.warehouseName, m.documentNumber, fmtNum(m.quantity), m.userName])}
          />
        )}
        {itemDiffs.length > 0 && (
          <>
            <h3 className="report-h3">الفروق المسجلة ({itemDiffs.length})</h3>
            <Table
              head={['التاريخ', 'إذن التسليم', 'المصروف', 'المسلم', 'الفرق', 'السبب']}
              rows={itemDiffs.map(({ r, l }) => [fmtDate(r.date), r.receiptNumber, fmtNum(l.issuedQuantity), fmtNum(l.deliveredQuantity), fmtNum(l.difference), l.differenceReason || '—'])}
            />
          </>
        )}
        <Signatures />
      </>
    );
  }

  // ===== التقرير الشامل للفترة =====
  const totalIssued = pIssues.reduce((s, d) => s + (d.totalQuantity || 0), 0);
  const totalDelivered = pReceipts.reduce((s, d) => s + (d.totalDelivered || 0), 0);
  const totalSales = pSales.reduce((s, d) => s + (d.totalAmount || 0), 0);
  const totalDiff = diffLines.reduce((s, x) => s + x.l.difference, 0);

  // ملخص لكل صنف خلال الفترة
  const perItem = new Map<string, { name: string; code: string; issued: number; delivered: number; sold: number }>();
  const touch = (id: string, name: string, code: string) => {
    if (!perItem.has(id)) perItem.set(id, { name, code, issued: 0, delivered: 0, sold: 0 });
    return perItem.get(id)!;
  };
  pIssues.forEach((d) => d.lines.forEach((l) => (touch(l.itemId, l.itemName, l.itemCode).issued += l.quantity || 0)));
  pReceipts.forEach((d) => d.lines.forEach((l) => (touch(l.itemId, l.itemName, l.itemCode).delivered += l.deliveredQuantity || 0)));
  pSales.forEach((d) => d.lines.forEach((l) => (touch(l.itemId, l.itemName, l.itemCode).sold += l.quantity || 0)));
  const itemRows = [...perItem.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  return (
    <>
      <ReportHeader title="التقرير الشامل" subtitle={periodText(from, to)} by={by} />
      <Summary
        cells={[
          ['أذون الصرف', `${pIssues.length} إذن — ${fmtNum(totalIssued)}`],
          ['أذون تسليم الهالك', `${pReceipts.length} إذن — ${fmtNum(totalDelivered)}`],
          ['إجمالي الفروق', fmtNum(totalDiff)],
          ['مبيعات الهالك', `${pSales.length} فاتورة — ${fmtNum(totalSales)} ج.م`],
        ]}
      />

      <h3 className="report-h3">ملخص الأصناف خلال الفترة</h3>
      {itemRows.length === 0 ? (
        <Empty />
      ) : (
        <Table
          head={['#', 'الكود', 'الصنف', 'المصروف', 'المسلم للهالك', 'الفرق', 'المباع']}
          rows={itemRows.map((r, i) => [i + 1, r.code, r.name, fmtNum(r.issued), fmtNum(r.delivered), fmtNum(r.issued - r.delivered), fmtNum(r.sold)])}
        />
      )}

      <h3 className="report-h3">أذون صرف الخامات ({pIssues.length})</h3>
      {pIssues.length === 0 ? (
        <Empty />
      ) : (
        <Table
          head={['#', 'رقم الإذن', 'التاريخ', 'المخزن', 'صالة الإنتاج', 'الكمية', 'الحالة']}
          rows={pIssues.map((d, i) => [i + 1, d.issueNumber, fmtDate(d.date), d.sourceWarehouseName, d.productionAreaName, fmtNum(d.totalQuantity), STATUS_LABEL[d.status]])}
        />
      )}

      <h3 className="report-h3">أذون تسليم الفوارغ للهالك ({pReceipts.length})</h3>
      {pReceipts.length === 0 ? (
        <Empty />
      ) : (
        <Table
          head={['#', 'رقم الإذن', 'التاريخ', 'إذن الصرف', 'المسلم', 'الفرق', 'الحالة']}
          rows={pReceipts.map((d, i) => [i + 1, d.receiptNumber, fmtDate(d.date), d.sourceIssueNumber, fmtNum(d.totalDelivered), fmtNum(d.totalDifference), STATUS_LABEL[d.status]])}
        />
      )}

      <h3 className="report-h3">فواتير بيع الهالك ({pSales.length})</h3>
      {pSales.length === 0 ? (
        <Empty />
      ) : (
        <Table
          head={['#', 'رقم الفاتورة', 'التاريخ', 'العميل', 'طريقة الدفع', 'الإجمالي (ج.م)', 'الحالة']}
          rows={pSales.map((d, i) => [i + 1, d.saleNumber, fmtDate(d.date), d.customerName, d.paymentMethod, fmtNum(d.totalAmount), STATUS_LABEL[d.status]])}
        />
      )}
      <p className="mt-2 text-[11px] text-gray-500">* المستندات الملغاة غير محسوبة في التقرير.</p>
      <Signatures />
    </>
  );
}

function DocumentReport({
  request, issues, receipts, sales, by,
}: {
  request: ReportRequest; issues: MaterialIssue[]; receipts: ScrapReceipt[]; sales: ScrapSale[]; by: string;
}) {
  if (request.docKind === 'issue') {
    const d = issues.find((x) => x.id === request.docId);
    if (!d) return <Empty />;
    return (
      <>
        <ReportHeader title="إذن صرف خامات" subtitle={`رقم ${d.issueNumber}`} by={by} />
        <InfoGrid
          rows={[
            ['التاريخ', fmtDate(d.date)], ['الحالة', STATUS_LABEL[d.status]],
            ['من مخزن', d.sourceWarehouseName], ['إلى صالة الإنتاج', d.productionAreaName],
            ['أمر الشغل', d.workOrderNumber || '—'], ['المستلم', d.receivedByName],
          ]}
        />
        <Table
          head={['#', 'الكود', 'الصنف', 'النوع', 'الكمية', 'المتبقي لم يسلم للهالك', 'ملاحظات']}
          rows={d.lines.map((l, i) => [i + 1, l.itemCode, l.itemName, l.scrapType, fmtNum(l.quantity), fmtNum(d.remainingByItem?.[l.itemId]), l.notes || '—'])}
          foot={['', '', '', 'الإجمالي', fmtNum(d.totalQuantity), '', '']}
        />
        {d.notes && <p className="mt-3 text-sm"><b>ملاحظات:</b> {d.notes}</p>}
        <Signatures labels={['أمين مخزن الخامات', 'المستلم', 'المراجع']} />
      </>
    );
  }
  if (request.docKind === 'receipt') {
    const d = receipts.find((x) => x.id === request.docId);
    if (!d) return <Empty />;
    return (
      <>
        <ReportHeader title="إذن تسليم فوارغ للهالك" subtitle={`رقم ${d.receiptNumber}`} by={by} />
        <InfoGrid
          rows={[
            ['التاريخ', fmtDate(d.date)], ['الحالة', STATUS_LABEL[d.status]],
            ['إذن الصرف الأصلي', d.sourceIssueNumber], ['من صالة الإنتاج', d.productionAreaName],
            ['إلى مخزن', d.scrapWarehouseName], ['المسلِّم / المستلم', `${d.deliveredByName} / ${d.receivedByName}`],
          ]}
        />
        <Table
          head={['#', 'الكود', 'الصنف', 'المصروف', 'المسلم', 'الفرق', 'سبب الفرق']}
          rows={d.lines.map((l, i) => [i + 1, l.itemCode, l.itemName, fmtNum(l.issuedQuantity), fmtNum(l.deliveredQuantity), fmtNum(l.difference), l.differenceReason || '—'])}
          foot={['', '', 'الإجمالي', '', fmtNum(d.totalDelivered), fmtNum(d.totalDifference), '']}
        />
        {d.notes && <p className="mt-3 text-sm"><b>ملاحظات:</b> {d.notes}</p>}
        <Signatures labels={['مسؤول الإنتاج', 'أمين مخزن الهالك', 'المراجع']} />
      </>
    );
  }
  const d = sales.find((x) => x.id === request.docId);
  if (!d) return <Empty />;
  return (
    <>
      <ReportHeader title="فاتورة بيع هالك" subtitle={`رقم ${d.saleNumber}`} by={by} />
      <InfoGrid
        rows={[
          ['التاريخ', fmtDate(d.date)], ['الحالة', STATUS_LABEL[d.status]],
          ['العميل', d.customerName], ['الهاتف', d.customerPhone || '—'],
          ['طريقة الدفع', d.paymentMethod], ['', ''],
        ]}
      />
      <Table
        head={['#', 'الكود', 'الصنف', 'الكمية', 'سعر الوحدة', 'الإجمالي (ج.م)']}
        rows={d.lines.map((l, i) => [i + 1, l.itemCode, l.itemName, fmtNum(l.quantity), fmtNum(l.unitPrice), fmtNum(l.lineTotal)])}
        foot={['', '', '', '', 'الإجمالي', fmtNum(d.totalAmount)]}
      />
      {d.status === 'cancelled' && d.cancelReason && <p className="mt-3 text-sm text-red-700"><b>سبب الإلغاء:</b> {d.cancelReason}</p>}
      {d.notes && <p className="mt-3 text-sm"><b>ملاحظات:</b> {d.notes}</p>}
      <Signatures labels={['أمين مخزن الهالك', 'العميل', 'المحاسب']} />
    </>
  );
}

// ===================== مكونات شكل التقرير =====================
function ReportHeader({ title, subtitle, by }: { title: string; subtitle: string; by: string }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 border-b-[3px] border-[#2E2A72] pb-4">
      <div>
        <h2 className="text-2xl font-bold text-[#2E2A72]">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
        <p className="mt-1 text-xs text-gray-500">
          نظام إدارة الفوارغ والهالك — تاريخ الإصدار {format(new Date(), 'yyyy/MM/dd HH:mm')}
          {by && ` — بواسطة ${by}`}
        </p>
      </div>
      <img src="/egygulf-logo.png" alt="EgyGulf Foods" className="h-14 w-auto" />
    </div>
  );
}

function Summary({ cells }: { cells: [string, string | number][] }) {
  return (
    <div className="mb-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-gray-300 p-3 text-center">
          <div className="text-[11px] text-gray-500">{label}</div>
          <div className="mt-1 text-base font-bold text-[#2E2A72]">{value}</div>
        </div>
      ))}
    </div>
  );
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v], i) =>
        k ? (
          <div key={i} className="flex gap-2 border-b border-dashed border-gray-200 pb-1">
            <span className="text-gray-500">{k}:</span>
            <span className="font-semibold text-gray-900">{v}</span>
          </div>
        ) : (
          <div key={i} />
        )
      )}
    </div>
  );
}

function Table({ head, rows, foot }: { head: string[]; rows: React.ReactNode[][]; foot?: React.ReactNode[] }) {
  return (
    <table className="report-table mb-6 w-full border-collapse text-[12px]">
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr>{foot.map((c, j) => <td key={j}>{c}</td>)}</tr>
        </tfoot>
      )}
    </table>
  );
}

function Empty() {
  return <p className="mb-6 rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">لا توجد بيانات</p>;
}

function Signatures({ labels = ['أعدّه', 'راجعه', 'اعتمده'] }: { labels?: string[] }) {
  return (
    <div className="mt-12 grid gap-8" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((l) => (
        <div key={l} className="text-center text-sm">
          <div className="mb-1 text-gray-600">{l}</div>
          <div className="mx-auto mt-10 w-4/5 border-t border-gray-400" />
        </div>
      ))}
    </div>
  );
}
