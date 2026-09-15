import { useMemo, useState } from 'react';
import { useCollection } from '@/hooks/useCollection';
import { Card, PageHeader, Button, EmptyState, LoadingState } from '@/components/ui';
import { Search, FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ScrapBalance {
  id: string;
  itemCode: string;
  itemName: string;
  scrapType: string;
  totalReceived: number;
  totalSold: number;
  balance: number;
  lastMovementAt?: any;
}

export default function ScrapBalancePage() {
  const { data: balances, loading } = useCollection<ScrapBalance>('scrapBalances');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const filtered = useMemo(
    () =>
      balances.filter(
        (b) =>
          (b.itemName?.includes(search) || b.itemCode?.includes(search)) &&
          (!typeFilter || b.scrapType === typeFilter)
      ),
    [balances, search, typeFilter]
  );

  const scrapTypes = Array.from(new Set(balances.map((b) => b.scrapType).filter(Boolean)));

  const exportExcel = () => {
    const rows = filtered.map((b) => ({
      'كود الصنف': b.itemCode,
      'اسم الصنف': b.itemName,
      'نوع الفارغ': b.scrapType,
      'إجمالي الوارد': b.totalReceived,
      'إجمالي المباع': b.totalSold,
      'الرصيد الحالي': b.balance,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'رصيد الهالك');
    XLSX.writeFile(wb, 'رصيد_الهالك.xlsx');
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="رصيد الهالك"
        subtitle="رصيد كل صنف في مخزن الهالك"
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> تصدير Excel</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> طباعة / PDF</Button>
          </>
        }
      />

      <Card className="p-4 mb-4 flex flex-wrap gap-3 no-print">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute right-3 top-2.5 text-gray-400" size={16} />
          <input
            className="w-full rounded-lg border border-surface-200 pr-9 pl-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
            placeholder="بحث بالاسم أو الكود..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-surface-200 px-3 py-2 text-sm bg-white"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">كل الأنواع</option>
          {scrapTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Card>

      <Card className="overflow-x-auto">
        {filtered.length === 0 ? (
          <EmptyState message="لا توجد أرصدة بعد" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">الكود</th>
                <th className="text-right px-4 py-3 font-medium">اسم الصنف</th>
                <th className="text-right px-4 py-3 font-medium">النوع</th>
                <th className="text-right px-4 py-3 font-medium">إجمالي الوارد</th>
                <th className="text-right px-4 py-3 font-medium">إجمالي المباع</th>
                <th className="text-right px-4 py-3 font-medium">الرصيد الحالي</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{b.itemCode}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.itemName}</td>
                  <td className="px-4 py-3">{b.scrapType}</td>
                  <td className="px-4 py-3">{b.totalReceived}</td>
                  <td className="px-4 py-3">{b.totalSold}</td>
                  <td className="px-4 py-3 font-bold text-brand-700">{b.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
