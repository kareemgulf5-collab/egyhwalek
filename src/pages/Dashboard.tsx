import { useMemo, useState } from 'react';
import { orderBy, limit } from 'firebase/firestore';
import { useCollection } from '@/hooks/useCollection';
import type { MaterialIssue, ScrapReceipt, ScrapSale, StockMovement, DocumentCounter } from '@/types';
import { Card, PageHeader, LoadingState } from '@/components/ui';
import {
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Boxes,
  Wallet,
} from 'lucide-react';
import { isToday, isThisMonth } from 'date-fns';

interface ScrapBalance {
  id: string;
  itemName: string;
  itemCode: string;
  balance: number;
  totalReceived: number;
  totalSold: number;
}

type Period = 'today' | 'month' | 'all';

function KpiCard({
  icon: Icon,
  label,
  value,
  tone = 'brand',
}: {
  icon: any;
  label: string;
  value: string | number;
  tone?: 'brand' | 'emerald' | 'amber' | 'red';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${tones[tone]}`}>
        <Icon size={20} />
      </div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-xl font-bold text-gray-900">{value}</div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('all');

  const { data: issues, loading: l1 } = useCollection<MaterialIssue>('materialIssues', [orderBy('date', 'desc')]);
  const { data: receipts, loading: l2 } = useCollection<ScrapReceipt>('scrapReceipts', [orderBy('date', 'desc')]);
  const { data: sales, loading: l3 } = useCollection<ScrapSale>('scrapSales', [orderBy('date', 'desc')]);
  const { data: balances, loading: l4 } = useCollection<ScrapBalance>('scrapBalances');
  const { data: recentMovements, loading: l5 } = useCollection<StockMovement>('stockMovements', [
    orderBy('date', 'desc'),
    limit(8),
  ]);

  const loading = l1 || l2 || l3 || l4 || l5;

  const inPeriod = (ts: any) => {
    if (period === 'all') return true;
    if (!ts?.toDate) return true;
    const d = ts.toDate();
    return period === 'today' ? isToday(d) : isThisMonth(d);
  };

  const stats = useMemo(() => {
    const issuedTotal = issues
      .filter((i) => i.status === 'approved' && inPeriod(i.date))
      .reduce((sum, i) => sum + (i.totalQuantity || 0), 0);

    const deliveredTotal = receipts
      .filter((r) => r.status === 'approved' && inPeriod(r.date))
      .reduce((sum, r) => sum + (r.totalDelivered || 0), 0);

    const soldQty = sales
      .filter((s) => s.status === 'approved' && inPeriod(s.date))
      .reduce((sum, s) => sum + s.lines.reduce((a, l) => a + l.quantity, 0), 0);

    const salesValue = sales
      .filter((s) => s.status === 'approved' && inPeriod(s.date))
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);

    const matchedCount = receipts.filter((r) => r.overallMatchStatus === 'matched').length;
    const needsReviewCount = receipts.filter((r) => r.overallMatchStatus === 'needs_review').length;
    const pendingCount = receipts.filter((r) => r.status === 'pending_review').length;

    const scrapBalanceTotal = balances.reduce((sum, b) => sum + (b.balance || 0), 0);

    return {
      issuedTotal,
      deliveredTotal,
      soldQty,
      salesValue,
      matchedCount,
      needsReviewCount,
      pendingCount,
      scrapBalanceTotal,
    };
  }, [issues, receipts, sales, balances, period]);

  const alerts = useMemo(() => {
    const list: { type: 'warning' | 'danger'; text: string }[] = [];
    receipts
      .filter((r) => r.overallMatchStatus === 'needs_review')
      .forEach((r) => list.push({ type: 'danger', text: `فرق في الكمية بإذن التسليم ${r.receiptNumber}` }));
    receipts
      .filter((r) => r.status === 'pending_review')
      .forEach((r) => list.push({ type: 'warning', text: `إذن تسليم بانتظار المراجعة: ${r.receiptNumber}` }));
    return list.slice(0, 6);
  }, [receipts]);

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="لوحة التحكم"
        subtitle="ملخص حالة نظام الفوارغ والهالك"
        actions={
          <div className="flex gap-1 bg-surface-100 rounded-lg p-1">
            {(['today', 'month', 'all'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  period === p ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500'
                }`}
              >
                {p === 'today' ? 'اليوم' : p === 'month' ? 'هذا الشهر' : 'الكل'}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={Boxes} label="رصيد مخزن الهالك (إجمالي)" value={stats.scrapBalanceTotal} tone="brand" />
        <KpiCard icon={PackageMinus} label="إجمالي المصروف من الخامات" value={stats.issuedTotal} tone="amber" />
        <KpiCard icon={PackagePlus} label="إجمالي المسلم للهالك" value={stats.deliveredTotal} tone="emerald" />
        <KpiCard icon={ShoppingCart} label="إجمالي الكمية المباعة" value={stats.soldQty} tone="brand" />
        <KpiCard icon={Wallet} label="قيمة مبيعات الهالك" value={`${stats.salesValue.toLocaleString()} ج.م`} tone="emerald" />
        <KpiCard icon={CheckCircle2} label="أذونات مطابقة" value={stats.matchedCount} tone="emerald" />
        <KpiCard icon={AlertTriangle} label="أذونات بها فروق" value={stats.needsReviewCount} tone="red" />
        <KpiCard icon={Clock} label="بانتظار المراجعة" value={stats.pendingCount} tone="amber" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-5">
          <h3 className="font-bold text-gray-900 mb-4">آخر الحركات المسجلة</h3>
          {recentMovements.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد حركات بعد</p>
          ) : (
            <div className="space-y-3">
              {recentMovements.map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b border-surface-100 pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{m.itemName}</div>
                    <div className="text-xs text-gray-400">{m.documentNumber} · {m.warehouseName}</div>
                  </div>
                  <div className="text-sm font-bold text-gray-700">{m.quantity}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" /> تنبيهات
          </h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد تنبيهات حاليًا</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a, idx) => (
                <div
                  key={idx}
                  className={`text-sm rounded-lg px-3 py-2 ${
                    a.type === 'danger' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {a.text}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
