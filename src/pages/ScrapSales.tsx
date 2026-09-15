import { useMemo, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { approveScrapSale as approveScrapSaleTx, cancelScrapSale as cancelScrapSaleTx } from '@/lib/transactions';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { generateDocumentNumber } from '@/lib/documentNumbers';
import type { ScrapSale, ScrapSaleLine } from '@/types';
import { Card, PageHeader, Button, Modal, Input, Select, Textarea, EmptyState, LoadingState } from '@/components/ui';
import { DocStatusBadge } from '@/components/StatusBadge';
import { Plus, Trash2, Printer, CheckCircle2, Eye, Ban } from 'lucide-react';
import { format } from 'date-fns';

interface ScrapBalance {
  id: string;
  itemName: string;
  itemCode: string;
  balance: number;
}

export default function ScrapSales() {
  const { appUser, hasRole } = useAuth();
  const { showToast } = useToast();
  const { data: sales, loading } = useCollection<ScrapSale>('scrapSales', [orderBy('createdAt', 'desc')]);
  const { data: balances } = useCollection<ScrapBalance>('scrapBalances');

  const canCreate = hasRole('scrap_keeper');
  const canCancel = hasRole('reviewer');

  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState<ScrapSale | null>(null);
  const [cancelling, setCancelling] = useState<ScrapSale | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  const availableItems = balances.filter((b) => b.balance > 0);

  const [header, setHeader] = useState({ customerName: '', customerPhone: '', paymentMethod: 'نقدي' as ScrapSale['paymentMethod'], notes: '' });
  const [lines, setLines] = useState<{ itemId: string; quantity: string; unitPrice: string }[]>([
    { itemId: '', quantity: '', unitPrice: '' },
  ]);

  const resetForm = () => {
    setHeader({ customerName: '', customerPhone: '', paymentMethod: 'نقدي', notes: '' });
    setLines([{ itemId: '', quantity: '', unitPrice: '' }]);
  };

  const openNew = () => {
    resetForm();
    setModalOpen(true);
  };

  const addLine = () => setLines([...lines, { itemId: '', quantity: '', unitPrice: '' }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, patch: Partial<{ itemId: string; quantity: string; unitPrice: string }>) => {
    const copy = [...lines];
    copy[idx] = { ...copy[idx], ...patch };
    setLines(copy);
  };

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0),
    [lines]
  );

  const handleSave = async () => {
    if (!header.customerName.trim()) {
      showToast('error', 'اسم العميل مطلوب');
      return;
    }
    const validLines = lines.filter((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0);
    if (validLines.length === 0) {
      showToast('error', 'أضف صنفًا واحدًا على الأقل بكمية وسعر صحيحين');
      return;
    }
    // تحذير أولي في الواجهة (التحقق الملزم يتم على السيرفر عند الاعتماد)
    for (const l of validLines) {
      const bal = balances.find((b) => b.id === l.itemId);
      if (bal && Number(l.quantity) > bal.balance) {
        showToast('error', `الكمية المطلوبة من ${bal.itemName} أكبر من الرصيد المتاح (${bal.balance})`);
        return;
      }
    }

    setSaving(true);
    try {
      const saleNumber = await generateDocumentNumber('scrapSale');
      const builtLines: ScrapSaleLine[] = validLines.map((l) => {
        const bal = balances.find((b) => b.id === l.itemId)!;
        const qty = Number(l.quantity);
        const price = Number(l.unitPrice);
        return {
          itemId: bal.id,
          itemCode: bal.itemCode,
          itemName: bal.itemName,
          quantity: qty,
          unitPrice: price,
          lineTotal: qty * price,
        };
      });

      await addDoc(collection(db, 'scrapSales'), {
        saleNumber,
        date: Timestamp.now(),
        customerName: header.customerName,
        customerPhone: header.customerPhone,
        paymentMethod: header.paymentMethod,
        notes: header.notes,
        status: 'pending_review',
        lines: builtLines,
        totalAmount: builtLines.reduce((s, l) => s + l.lineTotal, 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: appUser?.uid,
        updatedBy: appUser?.uid,
      });

      showToast('success', 'تم حفظ فاتورة البيع بنجاح');
      setModalOpen(false);
    } catch (e: any) {
      showToast('error', 'حدث خطأ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (sale: ScrapSale) => {
    if (!confirm(`تأكيد اعتماد فاتورة البيع ${sale.saleNumber}؟`)) return;
    setApproving(sale.id);
    try {
      await approveScrapSaleTx(sale.id, appUser!.uid, appUser!.displayName);
      showToast('success', 'تم اعتماد الفاتورة وخصم الرصيد');
    } catch (e: any) {
      showToast('error', e.message || 'فشل الاعتماد');
    } finally {
      setApproving(null);
    }
  };

  const handleCancel = async () => {
    if (!cancelling || !cancelReason.trim()) {
      showToast('error', 'سبب الإلغاء مطلوب');
      return;
    }
    try {
      await cancelScrapSaleTx(cancelling.id, cancelReason, appUser!.uid, appUser!.displayName);
      showToast('success', 'تم إلغاء الفاتورة وإرجاع الكمية للرصيد');
      setCancelling(null);
      setCancelReason('');
    } catch (e: any) {
      showToast('error', e.message || 'فشل الإلغاء');
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="مبيعات الهالك"
        subtitle="تسجيل بيع الفوارغ من مخزن الهالك"
        actions={canCreate ? <Button onClick={openNew}><Plus size={16} /> فاتورة بيع جديدة</Button> : undefined}
      />

      <Card className="overflow-x-auto">
        {sales.length === 0 ? (
          <EmptyState message="لا توجد فواتير بيع بعد" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">رقم الفاتورة</th>
                <th className="text-right px-4 py-3 font-medium">التاريخ</th>
                <th className="text-right px-4 py-3 font-medium">العميل</th>
                <th className="text-right px-4 py-3 font-medium">الإجمالي</th>
                <th className="text-right px-4 py-3 font-medium">الحالة</th>
                <th className="text-right px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{s.saleNumber}</td>
                  <td className="px-4 py-3">{s.date?.toDate ? format(s.date.toDate(), 'yyyy/MM/dd') : '—'}</td>
                  <td className="px-4 py-3">{s.customerName}</td>
                  <td className="px-4 py-3 font-semibold">{s.totalAmount?.toLocaleString()} ج.م</td>
                  <td className="px-4 py-3"><DocStatusBadge status={s.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setViewing(s)} className="text-gray-400 hover:text-brand-600" title="عرض"><Eye size={16} /></button>
                      {s.status === 'pending_review' && canCreate && (
                        <button onClick={() => handleApprove(s)} disabled={approving === s.id} className="text-gray-400 hover:text-emerald-600" title="اعتماد">
                          <CheckCircle2 size={16} />
                        </button>
                      )}
                      {s.status === 'approved' && canCancel && (
                        <button onClick={() => setCancelling(s)} className="text-gray-400 hover:text-red-600" title="إلغاء">
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* نموذج فاتورة جديدة */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="فاتورة بيع هالك جديدة" widthClass="max-w-3xl">
        <div className="space-y-5">
          <div className="grid md:grid-cols-3 gap-3">
            <Input label="اسم العميل" value={header.customerName} onChange={(e) => setHeader({ ...header, customerName: e.target.value })} />
            <Input label="رقم الهاتف (اختياري)" value={header.customerPhone} onChange={(e) => setHeader({ ...header, customerPhone: e.target.value })} />
            <Select label="طريقة الدفع" value={header.paymentMethod} onChange={(e) => setHeader({ ...header, paymentMethod: e.target.value as any })}>
              <option value="نقدي">نقدي</option>
              <option value="تحويل بنكي">تحويل بنكي</option>
              <option value="شيك">شيك</option>
              <option value="آجل">آجل</option>
            </Select>
          </div>
          <Textarea label="ملاحظات" value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-800 text-sm">أصناف الفاتورة</h3>
              <button onClick={addLine} className="text-brand-600 text-sm flex items-center gap-1 font-medium">
                <Plus size={14} /> إضافة صنف
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const bal = balances.find((b) => b.id === line.itemId);
                const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                return (
                  <div key={idx} className="flex gap-2 items-center bg-surface-50 rounded-lg p-2">
                    <select
                      className="flex-1 rounded-lg border border-surface-200 px-2 py-2 text-sm bg-white"
                      value={line.itemId}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                    >
                      <option value="">اختر الصنف</option>
                      {availableItems.map((it) => (
                        <option key={it.id} value={it.id}>{it.itemName} — متاح: {it.balance}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={bal?.balance}
                      placeholder="الكمية"
                      className="w-24 rounded-lg border border-surface-200 px-2 py-2 text-sm"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="سعر الوحدة"
                      className="w-28 rounded-lg border border-surface-200 px-2 py-2 text-sm"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                    />
                    <span className="w-24 text-sm font-semibold text-gray-700">{lineTotal.toFixed(2)}</span>
                    <button onClick={() => removeLine(idx)} className="text-gray-400 hover:text-red-600 p-1">
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="text-left mt-2 font-bold text-gray-800">الإجمالي: {totalAmount.toFixed(2)} ج.م</div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-surface-100">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ الفاتورة'}</Button>
          </div>
        </div>
      </Modal>

      {/* عرض/طباعة فاتورة */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`فاتورة بيع ${viewing?.saleNumber || ''}`} widthClass="max-w-2xl">
        {viewing && (
          <div>
            <div className="flex justify-end mb-3 no-print">
              <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> طباعة</Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div><span className="text-gray-400">العميل:</span> {viewing.customerName}</div>
              <div><span className="text-gray-400">طريقة الدفع:</span> {viewing.paymentMethod}</div>
              <div><span className="text-gray-400">الحالة:</span> <DocStatusBadge status={viewing.status} /></div>
              {viewing.cancelReason && <div><span className="text-gray-400">سبب الإلغاء:</span> {viewing.cancelReason}</div>}
            </div>
            <table className="w-full text-sm border border-surface-200 rounded-lg overflow-hidden">
              <thead className="bg-surface-50">
                <tr>
                  <th className="text-right px-3 py-2">الصنف</th>
                  <th className="text-right px-3 py-2">الكمية</th>
                  <th className="text-right px-3 py-2">السعر</th>
                  <th className="text-right px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-t border-surface-100">
                    <td className="px-3 py-2">{l.itemName}</td>
                    <td className="px-3 py-2">{l.quantity}</td>
                    <td className="px-3 py-2">{l.unitPrice}</td>
                    <td className="px-3 py-2 font-semibold">{l.lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-left mt-2 font-bold">الإجمالي: {viewing.totalAmount.toFixed(2)} ج.م</div>
          </div>
        )}
      </Modal>

      {/* تأكيد إلغاء */}
      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title="إلغاء فاتورة معتمدة">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">سيتم إرجاع الكمية إلى رصيد مخزن الهالك تلقائيًا عبر حركة عكسية معتمدة.</p>
          <Textarea label="سبب الإلغاء (إجباري)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelling(null)}>تراجع</Button>
            <Button variant="danger" onClick={handleCancel}>تأكيد الإلغاء</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
