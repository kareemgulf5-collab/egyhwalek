import { useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { approveMaterialIssue as approveMaterialIssueTx } from '@/lib/transactions';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { generateDocumentNumber } from '@/lib/documentNumbers';
import type { Item, MaterialIssue, ProductionArea, Warehouse, IssueLine } from '@/types';
import { Card, PageHeader, Button, Modal, Input, Select, Textarea, EmptyState, LoadingState } from '@/components/ui';
import { DocStatusBadge } from '@/components/StatusBadge';
import { Plus, Trash2, Printer, CheckCircle2, Eye } from 'lucide-react';
import { format } from 'date-fns';

export default function MaterialIssues() {
  const { appUser, hasRole } = useAuth();
  const { showToast } = useToast();
  const { data: issues, loading } = useCollection<MaterialIssue>('materialIssues', [orderBy('createdAt', 'desc')]);
  const { data: items } = useCollection<Item>('items');
  const { data: warehouses } = useCollection<Warehouse>('warehouses');
  const { data: areas } = useCollection<ProductionArea>('productionAreas');

  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState<MaterialIssue | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  const canCreate = hasRole('raw_material_keeper');
  const rawWarehouses = warehouses.filter((w) => w.type === 'raw_materials');
  const activeItems = items.filter((i) => i.active);

  const [header, setHeader] = useState({
    sourceWarehouseId: '',
    productionAreaId: '',
    workOrderNumber: '',
    receivedByName: '',
    notes: '',
  });
  const [lines, setLines] = useState<Partial<IssueLine>[]>([{ itemId: '', quantity: 0 }]);

  const resetForm = () => {
    setHeader({ sourceWarehouseId: '', productionAreaId: '', workOrderNumber: '', receivedByName: '', notes: '' });
    setLines([{ itemId: '', quantity: 0 }]);
  };

  const openNew = () => {
    resetForm();
    setModalOpen(true);
  };

  const addLine = () => setLines([...lines, { itemId: '', quantity: 0 }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, patch: Partial<IssueLine>) => {
    const copy = [...lines];
    copy[idx] = { ...copy[idx], ...patch };
    setLines(copy);
  };

  const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  const handleSave = async (submitStatus: 'draft' | 'pending_review') => {
    if (!header.sourceWarehouseId || !header.productionAreaId || !header.receivedByName.trim()) {
      showToast('error', 'من فضلك أكمل بيانات الإذن الأساسية');
      return;
    }
    const validLines = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      showToast('error', 'أضف صنفًا واحدًا على الأقل بكمية أكبر من صفر');
      return;
    }

    setSaving(true);
    try {
      const issueNumber = await generateDocumentNumber('materialIssue');
      const warehouse = rawWarehouses.find((w) => w.id === header.sourceWarehouseId)!;
      const area = areas.find((a) => a.id === header.productionAreaId)!;

      const builtLines: IssueLine[] = validLines.map((l) => {
        const item = items.find((i) => i.id === l.itemId)!;
        return {
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          scrapType: item.scrapType,
          quantity: Number(l.quantity),
          notes: l.notes || '',
        };
      });

      await addDoc(collection(db, 'materialIssues'), {
        issueNumber,
        date: Timestamp.now(),
        sourceWarehouseId: warehouse.id,
        sourceWarehouseName: warehouse.name,
        productionAreaId: area.id,
        productionAreaName: area.name,
        workOrderNumber: header.workOrderNumber,
        receivedByName: header.receivedByName,
        notes: header.notes,
        status: submitStatus,
        lines: builtLines,
        totalQuantity: builtLines.reduce((s, l) => s + l.quantity, 0),
        remainingByItem: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: appUser?.uid,
        updatedBy: appUser?.uid,
      });

      showToast('success', 'تم حفظ إذن الصرف بنجاح');
      setModalOpen(false);
    } catch (e: any) {
      showToast('error', 'حدث خطأ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (issue: MaterialIssue) => {
    if (!confirm(`تأكيد اعتماد إذن الصرف ${issue.issueNumber}؟ لن يمكن تعديل الكميات بعد الاعتماد.`)) return;
    setApproving(issue.id);
    try {
      await approveMaterialIssueTx(issue.id, appUser!.uid, appUser!.displayName);
      showToast('success', 'تم اعتماد إذن الصرف');
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
        title="منصرف من مخزن الخامات إلى صالة الإنتاج"
        subtitle="تسجيل واعتماد أذونات صرف المواد الخام والفوارغ"
        actions={canCreate ? <Button onClick={openNew}><Plus size={16} /> إذن صرف جديد</Button> : undefined}
      />

      <Card className="overflow-x-auto">
        {issues.length === 0 ? (
          <EmptyState message="لا توجد أذونات صرف بعد" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">رقم الإذن</th>
                <th className="text-right px-4 py-3 font-medium">التاريخ</th>
                <th className="text-right px-4 py-3 font-medium">المخزن</th>
                <th className="text-right px-4 py-3 font-medium">صالة الإنتاج</th>
                <th className="text-right px-4 py-3 font-medium">إجمالي الكمية</th>
                <th className="text-right px-4 py-3 font-medium">الحالة</th>
                <th className="text-right px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{issue.issueNumber}</td>
                  <td className="px-4 py-3">{issue.date?.toDate ? format(issue.date.toDate(), 'yyyy/MM/dd') : '—'}</td>
                  <td className="px-4 py-3">{issue.sourceWarehouseName}</td>
                  <td className="px-4 py-3">{issue.productionAreaName}</td>
                  <td className="px-4 py-3 font-semibold">{issue.totalQuantity}</td>
                  <td className="px-4 py-3"><DocStatusBadge status={issue.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setViewing(issue)} className="text-gray-400 hover:text-brand-600" title="عرض">
                        <Eye size={16} />
                      </button>
                      {issue.status !== 'approved' && issue.status !== 'cancelled' && canCreate && (
                        <button
                          onClick={() => handleApprove(issue)}
                          disabled={approving === issue.id}
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

      {/* نموذج إنشاء إذن صرف جديد */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إذن صرف جديد" widthClass="max-w-4xl">
        <div className="space-y-5">
          <div className="grid md:grid-cols-2 gap-3">
            <Select
              label="مخزن الصرف"
              value={header.sourceWarehouseId}
              onChange={(e) => setHeader({ ...header, sourceWarehouseId: e.target.value })}
            >
              <option value="">اختر المخزن</option>
              {rawWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select
              label="صالة الإنتاج المستلمة"
              value={header.productionAreaId}
              onChange={(e) => setHeader({ ...header, productionAreaId: e.target.value })}
            >
              <option value="">اختر الصالة</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Input
              label="رقم أمر التشغيل (اختياري)"
              value={header.workOrderNumber}
              onChange={(e) => setHeader({ ...header, workOrderNumber: e.target.value })}
            />
            <Input
              label="اسم المسؤول عن الاستلام"
              value={header.receivedByName}
              onChange={(e) => setHeader({ ...header, receivedByName: e.target.value })}
            />
          </div>
          <Textarea label="ملاحظات" value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-800 text-sm">الأصناف</h3>
              <button onClick={addLine} className="text-brand-600 text-sm flex items-center gap-1 font-medium">
                <Plus size={14} /> إضافة صنف
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-start bg-surface-50 rounded-lg p-2">
                  <select
                    className="flex-1 rounded-lg border border-surface-200 px-2 py-2 text-sm bg-white"
                    value={line.itemId || ''}
                    onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                  >
                    <option value="">اختر الصنف</option>
                    {activeItems.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.code})</option>)}
                  </select>
                  <input
                    type="number"
                    min={1}
                    placeholder="الكمية"
                    className="w-28 rounded-lg border border-surface-200 px-2 py-2 text-sm"
                    value={line.quantity || ''}
                    onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                  />
                  <button onClick={() => removeLine(idx)} className="text-gray-400 hover:text-red-600 p-2">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="text-left mt-2 text-sm font-semibold text-gray-700">إجمالي الكمية: {totalQty}</div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-surface-100">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button variant="secondary" onClick={() => handleSave('draft')} disabled={saving}>حفظ كمسودة</Button>
            <Button onClick={() => handleSave('pending_review')} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ وإرسال للاعتماد'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* عرض/طباعة الإذن */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`إذن صرف ${viewing?.issueNumber || ''}`} widthClass="max-w-2xl">
        {viewing && (
          <div>
            <div className="flex justify-end mb-3 no-print">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> طباعة
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div><span className="text-gray-400">التاريخ:</span> {viewing.date?.toDate ? format(viewing.date.toDate(), 'yyyy/MM/dd') : '—'}</div>
              <div><span className="text-gray-400">الحالة:</span> <DocStatusBadge status={viewing.status} /></div>
              <div><span className="text-gray-400">المخزن:</span> {viewing.sourceWarehouseName}</div>
              <div><span className="text-gray-400">صالة الإنتاج:</span> {viewing.productionAreaName}</div>
              <div><span className="text-gray-400">المستلم:</span> {viewing.receivedByName}</div>
              <div><span className="text-gray-400">أمر التشغيل:</span> {viewing.workOrderNumber || '—'}</div>
            </div>
            <table className="w-full text-sm border border-surface-200 rounded-lg overflow-hidden">
              <thead className="bg-surface-50">
                <tr>
                  <th className="text-right px-3 py-2">الصنف</th>
                  <th className="text-right px-3 py-2">النوع</th>
                  <th className="text-right px-3 py-2">الكمية</th>
                  <th className="text-right px-3 py-2">متبقي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-t border-surface-100">
                    <td className="px-3 py-2">{l.itemName}</td>
                    <td className="px-3 py-2">{l.scrapType}</td>
                    <td className="px-3 py-2">{l.quantity}</td>
                    <td className="px-3 py-2">{viewing.remainingByItem?.[l.itemId] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {viewing.notes && <p className="text-sm text-gray-500 mt-3">ملاحظات: {viewing.notes}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
