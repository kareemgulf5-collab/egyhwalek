import { useMemo, useState } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { approveScrapReceipt as approveScrapReceiptTx } from '@/lib/transactions';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { generateDocumentNumber } from '@/lib/documentNumbers';
import type { MaterialIssue, ScrapReceipt, ScrapMatchLine, Warehouse } from '@/types';
import { Card, PageHeader, Button, Modal, Input, Select, Textarea, EmptyState, LoadingState } from '@/components/ui';
import { DocStatusBadge, MatchStatusBadge, DifferenceBadge } from '@/components/StatusBadge';
import { Plus, Printer, CheckCircle2, Eye } from 'lucide-react';
import { format } from 'date-fns';

export default function ScrapReceipts() {
  const { appUser, hasRole } = useAuth();
  const { showToast } = useToast();
  const { data: receipts, loading } = useCollection<ScrapReceipt>('scrapReceipts', [orderBy('createdAt', 'desc')]);
  const { data: approvedIssues } = useCollection<MaterialIssue>('materialIssues', [where('status', '==', 'approved')]);
  const { data: warehouses } = useCollection<Warehouse>('warehouses');

  const scrapWarehouses = warehouses.filter((w) => w.type === 'scrap');
  const canCreate = hasRole('production_supervisor');
  const canReviewApprove = hasRole('reviewer') || hasRole('scrap_keeper' as any);

  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState<ScrapReceipt | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  const [header, setHeader] = useState({
    sourceIssueId: '',
    scrapWarehouseId: '',
    deliveredByName: '',
    receivedByName: '',
    notes: '',
  });
  const [deliveredQty, setDeliveredQty] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const selectedIssue = approvedIssues.find((i) => i.id === header.sourceIssueId) || null;

  // الأصناف المتاحة للتسليم مع الكمية المتبقية من إذن الصرف المحدد
  const availableLines = useMemo(() => {
    if (!selectedIssue) return [];
    return selectedIssue.lines
      .map((l) => ({ ...l, remaining: selectedIssue.remainingByItem?.[l.itemId] ?? 0 }))
      .filter((l) => l.remaining > 0);
  }, [selectedIssue]);

  const resetForm = () => {
    setHeader({ sourceIssueId: '', scrapWarehouseId: '', deliveredByName: '', receivedByName: '', notes: '' });
    setDeliveredQty({});
    setReasons({});
  };

  const openNew = () => {
    resetForm();
    setModalOpen(true);
  };

  const matchLines: ScrapMatchLine[] = useMemo(() => {
    return availableLines.map((l) => {
      const delivered = Number(deliveredQty[l.itemId]) || 0;
      const difference = l.remaining - delivered;
      return {
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        scrapType: l.scrapType,
        issuedQuantity: l.remaining,
        deliveredQuantity: delivered,
        difference,
        matchStatus: difference === 0 ? 'matched' : 'needs_review',
        differenceReason: reasons[l.itemId] || '',
      };
    });
  }, [availableLines, deliveredQty, reasons]);

  const hasAnyDelivered = matchLines.some((l) => l.deliveredQuantity > 0);
  const hasUnresolvedDiff = matchLines.some((l) => l.difference !== 0 && !l.differenceReason?.trim());

  const handleSave = async () => {
    if (!header.sourceIssueId || !header.scrapWarehouseId || !header.deliveredByName.trim() || !header.receivedByName.trim()) {
      showToast('error', 'من فضلك أكمل بيانات الإذن الأساسية');
      return;
    }
    if (!hasAnyDelivered) {
      showToast('error', 'أدخل كمية مسلمة لصنف واحد على الأقل');
      return;
    }
    const finalLines = matchLines.filter((l) => l.deliveredQuantity > 0 || l.difference !== 0);

    setSaving(true);
    try {
      const receiptNumber = await generateDocumentNumber('scrapReceipt');
      const warehouse = scrapWarehouses.find((w) => w.id === header.scrapWarehouseId)!;
      const status = hasUnresolvedDiff ? 'pending_review' : 'draft';
      const overallMatchStatus = finalLines.some((l) => l.difference !== 0) ? 'needs_review' : 'matched';

      await addDoc(collection(db, 'scrapReceipts'), {
        receiptNumber,
        date: Timestamp.now(),
        sourceIssueId: selectedIssue!.id,
        sourceIssueNumber: selectedIssue!.issueNumber,
        productionAreaId: selectedIssue!.productionAreaId,
        productionAreaName: selectedIssue!.productionAreaName,
        scrapWarehouseId: warehouse.id,
        scrapWarehouseName: warehouse.name,
        deliveredByName: header.deliveredByName,
        receivedByName: header.receivedByName,
        notes: header.notes,
        status,
        overallMatchStatus,
        lines: finalLines,
        totalDelivered: finalLines.reduce((s, l) => s + l.deliveredQuantity, 0),
        totalDifference: finalLines.reduce((s, l) => s + l.difference, 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: appUser?.uid,
        updatedBy: appUser?.uid,
      });

      showToast('success', 'تم حفظ إذن التسليم بنجاح');
      setModalOpen(false);
    } catch (e: any) {
      showToast('error', 'حدث خطأ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (receipt: ScrapReceipt) => {
    const unresolved = receipt.lines.some((l) => l.difference !== 0 && !l.differenceReason?.trim());
    if (unresolved) {
      showToast('error', 'يوجد فرق بدون سبب مسجل — راجع الإذن أولًا وسجّل الأسباب');
      return;
    }
    if (!confirm(`تأكيد اعتماد إذن التسليم ${receipt.receiptNumber}؟`)) return;
    setApproving(receipt.id);
    try {
      await approveScrapReceiptTx(receipt.id, appUser!.uid, appUser!.displayName);
      showToast('success', 'تم اعتماد إذن التسليم وتحديث رصيد الهالك');
    } catch (e: any) {
      showToast('error', e.message || 'فشل الاعتماد');
    } finally {
      setApproving(null);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="منصرف فوارغ من صالة الإنتاج إلى مخزن الهالك"
        subtitle="أهم تابة في المشروع — مطابقة الكميات المصروفة بالمسلمة للهالك"
        actions={canCreate ? <Button onClick={openNew}><Plus size={16} /> إذن تسليم جديد</Button> : undefined}
      />

      <Card className="overflow-x-auto">
        {receipts.length === 0 ? (
          <EmptyState message="لا توجد أذونات تسليم بعد" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">رقم الإذن</th>
                <th className="text-right px-4 py-3 font-medium">إذن الصرف المرتبط</th>
                <th className="text-right px-4 py-3 font-medium">التاريخ</th>
                <th className="text-right px-4 py-3 font-medium">إجمالي المسلم</th>
                <th className="text-right px-4 py-3 font-medium">المطابقة</th>
                <th className="text-right px-4 py-3 font-medium">الحالة</th>
                <th className="text-right px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{r.receiptNumber}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.sourceIssueNumber}</td>
                  <td className="px-4 py-3">{r.date?.toDate ? format(r.date.toDate(), 'yyyy/MM/dd') : '—'}</td>
                  <td className="px-4 py-3 font-semibold">{r.totalDelivered}</td>
                  <td className="px-4 py-3"><MatchStatusBadge status={r.overallMatchStatus} /></td>
                  <td className="px-4 py-3"><DocStatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setViewing(r)} className="text-gray-400 hover:text-brand-600" title="عرض">
                        <Eye size={16} />
                      </button>
                      {r.status !== 'approved' && r.status !== 'cancelled' && canReviewApprove && (
                        <button
                          onClick={() => handleApprove(r)}
                          disabled={approving === r.id}
                          className="text-gray-400 hover:text-emerald-600"
                          title="اعتماد"
                        >
                          <CheckCircle2 size={16} />
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

      {/* نموذج إنشاء إذن تسليم */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إذن تسليم فوارغ للهالك" widthClass="max-w-4xl">
        <div className="space-y-5">
          <div className="grid md:grid-cols-2 gap-3">
            <Select
              label="إذن الصرف الأصلي"
              value={header.sourceIssueId}
              onChange={(e) => {
                setHeader({ ...header, sourceIssueId: e.target.value });
                setDeliveredQty({});
                setReasons({});
              }}
            >
              <option value="">اختر إذن الصرف</option>
              {approvedIssues
                .filter((i) => Object.values(i.remainingByItem || {}).some((v) => v > 0))
                .map((i) => (
                  <option key={i.id} value={i.id}>{i.issueNumber} — {i.productionAreaName}</option>
                ))}
            </Select>
            <Select
              label="مخزن الهالك"
              value={header.scrapWarehouseId}
              onChange={(e) => setHeader({ ...header, scrapWarehouseId: e.target.value })}
            >
              <option value="">اختر المخزن</option>
              {scrapWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Input label="اسم المسلم" value={header.deliveredByName} onChange={(e) => setHeader({ ...header, deliveredByName: e.target.value })} />
            <Input label="اسم المستلم" value={header.receivedByName} onChange={(e) => setHeader({ ...header, receivedByName: e.target.value })} />
          </div>
          <Textarea label="ملاحظات" value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />

          {selectedIssue && (
            <div>
              <h3 className="font-semibold text-gray-800 text-sm mb-2">جدول المطابقة</h3>
              {availableLines.length === 0 ? (
                <p className="text-sm text-gray-400">لا توجد كميات متبقية للتسليم من هذا الإذن</p>
              ) : (
                <div className="border border-surface-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-right px-3 py-2">الصنف</th>
                        <th className="text-right px-3 py-2">المتبقي من الصرف</th>
                        <th className="text-right px-3 py-2">الكمية المسلمة</th>
                        <th className="text-right px-3 py-2">الفرق</th>
                        <th className="text-right px-3 py-2">سبب الفرق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableLines.map((l) => {
                        const delivered = Number(deliveredQty[l.itemId]) || 0;
                        const diff = l.remaining - delivered;
                        return (
                          <tr key={l.itemId} className="border-t border-surface-100">
                            <td className="px-3 py-2">{l.itemName}</td>
                            <td className="px-3 py-2">{l.remaining}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                max={l.remaining}
                                className="w-24 rounded-lg border border-surface-200 px-2 py-1.5 text-sm"
                                value={deliveredQty[l.itemId] || ''}
                                onChange={(e) => setDeliveredQty({ ...deliveredQty, [l.itemId]: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2"><DifferenceBadge difference={diff} /></td>
                            <td className="px-3 py-2">
                              {diff !== 0 && (
                                <input
                                  className="w-40 rounded-lg border border-surface-200 px-2 py-1.5 text-sm"
                                  placeholder="سبب الفرق (إجباري)"
                                  value={reasons[l.itemId] || ''}
                                  onChange={(e) => setReasons({ ...reasons, [l.itemId]: e.target.value })}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-surface-100">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving || !hasAnyDelivered}>
              {saving ? 'جاري الحفظ...' : 'حفظ الإذن'}
            </Button>
          </div>
          {hasUnresolvedDiff && (
            <p className="text-xs text-amber-600">
              يوجد فرق بدون سبب — سيتم حفظ الإذن بحالة "بانتظار المراجعة" ولن يمكن اعتماده قبل تسجيل السبب.
            </p>
          )}
        </div>
      </Modal>

      {/* عرض/طباعة إذن التسليم */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`إذن تسليم ${viewing?.receiptNumber || ''}`} widthClass="max-w-2xl">
        {viewing && (
          <div>
            <div className="flex justify-end mb-3 no-print">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> طباعة
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div><span className="text-gray-400">إذن الصرف الأصلي:</span> {viewing.sourceIssueNumber}</div>
              <div><span className="text-gray-400">الحالة:</span> <DocStatusBadge status={viewing.status} /></div>
              <div><span className="text-gray-400">مخزن الهالك:</span> {viewing.scrapWarehouseName}</div>
              <div><span className="text-gray-400">المطابقة:</span> <MatchStatusBadge status={viewing.overallMatchStatus} /></div>
              <div><span className="text-gray-400">المسلم:</span> {viewing.deliveredByName}</div>
              <div><span className="text-gray-400">المستلم:</span> {viewing.receivedByName}</div>
            </div>
            <table className="w-full text-sm border border-surface-200 rounded-lg overflow-hidden">
              <thead className="bg-surface-50">
                <tr>
                  <th className="text-right px-3 py-2">الصنف</th>
                  <th className="text-right px-3 py-2">المصروف</th>
                  <th className="text-right px-3 py-2">المسلم</th>
                  <th className="text-right px-3 py-2">الفرق</th>
                  <th className="text-right px-3 py-2">السبب</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-t border-surface-100">
                    <td className="px-3 py-2">{l.itemName}</td>
                    <td className="px-3 py-2">{l.issuedQuantity}</td>
                    <td className="px-3 py-2">{l.deliveredQuantity}</td>
                    <td className="px-3 py-2"><DifferenceBadge difference={l.difference} /></td>
                    <td className="px-3 py-2 text-gray-500">{l.differenceReason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
