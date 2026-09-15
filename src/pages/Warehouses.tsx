import { useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection } from '@/hooks/useCollection';
import { useToast } from '@/contexts/ToastContext';
import type { Warehouse, ProductionArea } from '@/types';
import { Card, PageHeader, Button, Modal, Input, Select, EmptyState, LoadingState } from '@/components/ui';
import { Plus, Pencil } from 'lucide-react';

export default function Warehouses() {
  const { showToast } = useToast();
  const { data: warehouses, loading: l1 } = useCollection<Warehouse>('warehouses');
  const { data: areas, loading: l2 } = useCollection<ProductionArea>('productionAreas');
  const [tab, setTab] = useState<'warehouses' | 'areas'>('warehouses');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingW, setEditingW] = useState<Warehouse | null>(null);
  const [editingA, setEditingA] = useState<ProductionArea | null>(null);
  const [wForm, setWForm] = useState({ code: '', name: '', type: 'raw_materials' as Warehouse['type'] });
  const [aForm, setAForm] = useState({ code: '', name: '' });

  const openNewWarehouse = () => {
    setEditingW(null);
    setWForm({ code: '', name: '', type: 'raw_materials' });
    setModalOpen(true);
  };
  const openEditWarehouse = (w: Warehouse) => {
    setEditingW(w);
    setWForm({ code: w.code, name: w.name, type: w.type });
    setModalOpen(true);
  };
  const saveWarehouse = async () => {
    if (!wForm.code || !wForm.name) return showToast('error', 'الكود والاسم مطلوبان');
    if (editingW) {
      await updateDoc(doc(db, 'warehouses', editingW.id), { ...wForm });
    } else {
      await addDoc(collection(db, 'warehouses'), { ...wForm, active: true, createdAt: serverTimestamp() });
    }
    showToast('success', 'تم الحفظ بنجاح');
    setModalOpen(false);
  };

  const openNewArea = () => {
    setEditingA(null);
    setAForm({ code: '', name: '' });
    setModalOpen(true);
  };
  const openEditArea = (a: ProductionArea) => {
    setEditingA(a);
    setAForm({ code: a.code, name: a.name });
    setModalOpen(true);
  };
  const saveArea = async () => {
    if (!aForm.code || !aForm.name) return showToast('error', 'الكود والاسم مطلوبان');
    if (editingA) {
      await updateDoc(doc(db, 'productionAreas', editingA.id), { ...aForm });
    } else {
      await addDoc(collection(db, 'productionAreas'), { ...aForm, active: true, createdAt: serverTimestamp() });
    }
    showToast('success', 'تم الحفظ بنجاح');
    setModalOpen(false);
  };

  if (l1 || l2) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="المخازن وصالات الإنتاج"
        actions={
          <Button onClick={tab === 'warehouses' ? openNewWarehouse : openNewArea}>
            <Plus size={16} /> {tab === 'warehouses' ? 'إضافة مخزن' : 'إضافة صالة إنتاج'}
          </Button>
        }
      />

      <div className="flex gap-1 bg-surface-100 rounded-lg p-1 mb-4 w-fit">
        <button
          onClick={() => setTab('warehouses')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md ${tab === 'warehouses' ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500'}`}
        >
          المخازن
        </button>
        <button
          onClick={() => setTab('areas')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md ${tab === 'areas' ? 'bg-white shadow-sm text-brand-700' : 'text-gray-500'}`}
        >
          صالات الإنتاج
        </button>
      </div>

      <Card className="overflow-x-auto">
        {tab === 'warehouses' ? (
          warehouses.length === 0 ? (
            <EmptyState message="لا توجد مخازن مسجّلة" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-right px-4 py-3 font-medium">الكود</th>
                  <th className="text-right px-4 py-3 font-medium">الاسم</th>
                  <th className="text-right px-4 py-3 font-medium">النوع</th>
                  <th className="text-right px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.id} className="border-t border-surface-100">
                    <td className="px-4 py-3 font-mono text-xs">{w.code}</td>
                    <td className="px-4 py-3 font-medium">{w.name}</td>
                    <td className="px-4 py-3">
                      {w.type === 'raw_materials' ? 'مخزن خامات' : w.type === 'scrap' ? 'مخزن هالك' : 'أخرى'}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => openEditWarehouse(w)} className="text-gray-400 hover:text-brand-600">
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : areas.length === 0 ? (
          <EmptyState message="لا توجد صالات إنتاج مسجّلة" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">الكود</th>
                <th className="text-right px-4 py-3 font-medium">الاسم</th>
                <th className="text-right px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{a.code}</td>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEditArea(a)} className="text-gray-400 hover:text-brand-600">
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={tab === 'warehouses' ? 'بيانات المخزن' : 'بيانات صالة الإنتاج'}>
        {tab === 'warehouses' ? (
          <div className="space-y-4">
            <Input label="كود المخزن" value={wForm.code} onChange={(e) => setWForm({ ...wForm, code: e.target.value })} />
            <Input label="اسم المخزن" value={wForm.name} onChange={(e) => setWForm({ ...wForm, name: e.target.value })} />
            <Select label="نوع المخزن" value={wForm.type} onChange={(e) => setWForm({ ...wForm, type: e.target.value as Warehouse['type'] })}>
              <option value="raw_materials">مخزن خامات</option>
              <option value="scrap">مخزن هالك</option>
              <option value="other">أخرى</option>
            </Select>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
              <Button onClick={saveWarehouse}>حفظ</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Input label="كود الصالة" value={aForm.code} onChange={(e) => setAForm({ ...aForm, code: e.target.value })} />
            <Input label="اسم الصالة" value={aForm.name} onChange={(e) => setAForm({ ...aForm, name: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
              <Button onClick={saveArea}>حفظ</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
