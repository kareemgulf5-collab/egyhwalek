import { useMemo, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/hooks/useCollection';
import type { MaterialIssue, ScrapReceipt, ScrapSale, StockMovement } from '@/types';
import { Card, PageHeader, Button, EmptyState, LoadingState } from '@/components/ui';
import { FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { MatchStatusBadge, DifferenceBadge } from '@/components/StatusBadge';

type ReportTab = 'issues' | 'receipts' | 'matching' | 'differences' | 'sales' | 'movements';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'issues', label: 'منصرف الخامات' },
  { key: 'receipts', label: 'الفوارغ المسلمة للهالك' },
  { key: 'matching', label: 'المطابقة' },
  { key: 'differences', label: 'الفروق' },
  { key: 'sales', label: 'مبيعات الهالك' },
  { key: 'movements', label: 'حركة الأصناف' },
];

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('matching');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: issues, loading: l1 } = useCollection<MaterialIssue>('materialIssues', [orderBy('date', 'desc')]);
  const { data: receipts, loading: l2 } = useCollection<ScrapReceipt>('scrapReceipts', [orderBy('date', 'desc')]);
  const { data: sales, loading: l3 } = useCollection<ScrapSale>('scrapSales', [orderBy('date', 'desc')]);
  const { data: movements, loading: l4 } = useCollection<StockMovement>('stockMovements', [orderBy('date', 'desc')]);

  const loading = l1 || l2 || l3 || l4;

  const inRange = (ts: any) => {
    if (!ts?.toDate) return true;
    const d = ts.toDate();
    if (from && d < new Date(from)) return false;
    if (to && d > new Date(to + 'T23:59:59')) return false;
    return true;
  };

  const filteredIssues = useMemo(() => issues.filter((i) => inRange(i.date)), [issues, from, to]);
  const filteredReceipts = useMemo(() => receipts.filter((r) => inRange(r.date)), [receipts, from, to]);
  const filteredSales = useMemo(() => sales.filter((s) => inRange(s.date)), [sales, from, to]);
  const filteredMovements = useMemo(() => movements.filter((m) => inRange(m.date)), [movements, from, to]);

  const differenceLines = useMemo(() => {
    const rows: { receiptNumber: string; itemName: string; difference: number; reason: string; date: any }[] = [];
    filteredReceipts.forEach((r) => {
      r.lines.filter((l) => l.difference !== 0).forEach((l) => {
        rows.push({ receiptNumber: r.receiptNumber, itemName: l.itemName, difference: l.difference, reason: l.differenceReason || '', date: r.date });
      });
    });
    return rows;
  }, [filteredReceipts]);

  const exportCurrentExcel = () => {
    let rows: any[] = [];
    let filename = 'تقرير';
    if (tab === 'issues') {
      rows = filteredIssues.map((i) => ({ 'رقم الإذن': i.issueNumber, التاريخ: fmt(i.date), المخزن: i.sourceWarehouseName, 'صالة الإنتاج': i.productionAreaName, 'إجمالي الكمية': i.totalQuantity, الحالة: i.status }));
      filename = 'تقرير_منصرف_الخامات';
    } else if (tab === 'receipts') {
      rows = filteredReceipts.map((r) => ({ 'رقم الإذن': r.receiptNumber, التاريخ: fmt(r.date), 'إذن الصرف': r.sourceIssueNumber, 'إجمالي المسلم': r.totalDelivered, المطابقة: r.overallMatchStatus }));
      filename = 'تقرير_الفوارغ_المسلمة';
    } else if (tab === 'matching') {
      rows = filteredReceipts.flatMap((r) => r.lines.map((l) => ({ 'رقم الإذن': r.receiptNumber, الصنف: l.itemName, المصروف: l.issuedQuantity, المسلم: l.deliveredQuantity, الفرق: l.difference, الحالة: l.matchStatus })));
      filename = 'تقرير_المطابقة';
    } else if (tab === 'differences') {
      rows = differenceLines.map((d) => ({ 'رقم الإذن': d.receiptNumber, الصنف: d.itemName, الفرق: d.difference, السبب: d.reason, التاريخ: fmt(d.date) }));
      filename = 'تقرير_الفروق';
    } else if (tab === 'sales') {
      rows = filteredSales.map((s) => ({ 'رقم الفاتورة': s.saleNumber, التاريخ: fmt(s.date), العميل: s.customerName, الإجمالي: s.totalAmount, الحالة: s.status }));
      filename = 'تقرير_مبيعات_الهالك';
    } else {
      rows = filteredMovements.map((m) => ({ الصنف: m.itemName, المخزن: m.warehouseName, 'نوع الحركة': m.movementType, الكمية: m.quantity, 'رقم المستند': m.documentNumber, التاريخ: fmt(m.date) }));
      filename = 'تقرير_حركة_الأصناف';
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const fmt = (ts: any) => (ts?.toDate ? format(ts.toDate(), 'yyyy/MM/dd') : '—');

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="التقارير"
        actions={
          <>
            <Button variant="secondary" onClick={exportCurrentExcel}><FileSpreadsheet size={16} /> تصدير Excel</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> طباعة / PDF</Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-1 bg-surface-100 rounded-lg p-1 mb-4 w-fit no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === t.key ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-4 mb-4 flex flex-wrap gap-3 items-end no-print">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">من تاريخ</span>
          <input type="date" className="rounded-lg border border-surface-200 px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">إلى تاريخ</span>
          <input type="date" className="rounded-lg border border-surface-200 px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </Card>

      <Card className="overflow-x-auto">
        {tab === 'issues' && (
          filteredIssues.length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs"><tr>
                <th className="text-right px-4 py-3">رقم الإذن</th><th className="text-right px-4 py-3">التاريخ</th>
                <th className="text-right px-4 py-3">المخزن</th><th className="text-right px-4 py-3">صالة الإنتاج</th>
                <th className="text-right px-4 py-3">إجمالي الكمية</th>
              </tr></thead>
              <tbody>{filteredIssues.map((i) => (
                <tr key={i.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{i.issueNumber}</td><td className="px-4 py-3">{fmt(i.date)}</td>
                  <td className="px-4 py-3">{i.sourceWarehouseName}</td><td className="px-4 py-3">{i.productionAreaName}</td>
                  <td className="px-4 py-3 font-semibold">{i.totalQuantity}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}

        {tab === 'receipts' && (
          filteredReceipts.length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs"><tr>
                <th className="text-right px-4 py-3">رقم الإذن</th><th className="text-right px-4 py-3">إذن الصرف</th>
                <th className="text-right px-4 py-3">التاريخ</th><th className="text-right px-4 py-3">إجمالي المسلم</th>
                <th className="text-right px-4 py-3">المطابقة</th>
              </tr></thead>
              <tbody>{filteredReceipts.map((r) => (
                <tr key={r.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{r.receiptNumber}</td><td className="px-4 py-3 font-mono text-xs">{r.sourceIssueNumber}</td>
                  <td className="px-4 py-3">{fmt(r.date)}</td><td className="px-4 py-3 font-semibold">{r.totalDelivered}</td>
                  <td className="px-4 py-3"><MatchStatusBadge status={r.overallMatchStatus} /></td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}

        {tab === 'matching' && (
          filteredReceipts.length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs"><tr>
                <th className="text-right px-4 py-3">رقم الإذن</th><th className="text-right px-4 py-3">الصنف</th>
                <th className="text-right px-4 py-3">المصروف</th><th className="text-right px-4 py-3">المسلم</th>
                <th className="text-right px-4 py-3">الفرق</th>
              </tr></thead>
              <tbody>{filteredReceipts.flatMap((r) => r.lines.map((l, idx) => (
                <tr key={r.id + idx} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{r.receiptNumber}</td><td className="px-4 py-3">{l.itemName}</td>
                  <td className="px-4 py-3">{l.issuedQuantity}</td><td className="px-4 py-3">{l.deliveredQuantity}</td>
                  <td className="px-4 py-3"><DifferenceBadge difference={l.difference} /></td>
                </tr>
              )))}</tbody>
            </table>
          )
        )}

        {tab === 'differences' && (
          differenceLines.length === 0 ? <EmptyState message="لا توجد فروق مسجّلة" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs"><tr>
                <th className="text-right px-4 py-3">رقم الإذن</th><th className="text-right px-4 py-3">الصنف</th>
                <th className="text-right px-4 py-3">الفرق</th><th className="text-right px-4 py-3">السبب</th>
                <th className="text-right px-4 py-3">التاريخ</th>
              </tr></thead>
              <tbody>{differenceLines.map((d, idx) => (
                <tr key={idx} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{d.receiptNumber}</td><td className="px-4 py-3">{d.itemName}</td>
                  <td className="px-4 py-3"><DifferenceBadge difference={d.difference} /></td>
                  <td className="px-4 py-3 text-gray-500">{d.reason || '—'}</td><td className="px-4 py-3">{fmt(d.date)}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}

        {tab === 'sales' && (
          filteredSales.length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs"><tr>
                <th className="text-right px-4 py-3">رقم الفاتورة</th><th className="text-right px-4 py-3">التاريخ</th>
                <th className="text-right px-4 py-3">العميل</th><th className="text-right px-4 py-3">الإجمالي</th>
              </tr></thead>
              <tbody>{filteredSales.map((s) => (
                <tr key={s.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{s.saleNumber}</td><td className="px-4 py-3">{fmt(s.date)}</td>
                  <td className="px-4 py-3">{s.customerName}</td><td className="px-4 py-3 font-semibold">{s.totalAmount?.toLocaleString()} ج.م</td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}

        {tab === 'movements' && (
          filteredMovements.length === 0 ? <EmptyState message="لا توجد بيانات" /> : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs"><tr>
                <th className="text-right px-4 py-3">الصنف</th><th className="text-right px-4 py-3">المخزن</th>
                <th className="text-right px-4 py-3">نوع الحركة</th><th className="text-right px-4 py-3">الكمية</th>
                <th className="text-right px-4 py-3">رقم المستند</th><th className="text-right px-4 py-3">التاريخ</th>
              </tr></thead>
              <tbody>{filteredMovements.map((m) => (
                <tr key={m.id} className="border-t border-surface-100">
                  <td className="px-4 py-3">{m.itemName}</td><td className="px-4 py-3">{m.warehouseName}</td>
                  <td className="px-4 py-3">{movementLabel(m.movementType)}</td><td className="px-4 py-3">{m.quantity}</td>
                  <td className="px-4 py-3 font-mono text-xs">{m.documentNumber}</td><td className="px-4 py-3">{fmt(m.date)}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}
      </Card>
    </div>
  );
}

function movementLabel(type: string) {
  const map: Record<string, string> = {
    issue_out: 'صرف من الخامات',
    scrap_in: 'وارد للهالك',
    sale_out: 'بيع هالك',
    sale_reversal: 'إلغاء بيع',
  };
  return map[type] || type;
}
