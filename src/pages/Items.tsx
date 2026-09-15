import { useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import type { Item, ScrapType } from '@/types';
import { Card, PageHeader, Button, Modal, Input, Select, Textarea, EmptyState, LoadingState } from '@/components/ui';
import { Plus, Search, Pencil, PackageX, PackageCheck } from 'lucide-react';

const SCRAP_TYPES: ScrapType[] = ['جركن', 'علبة', 'كرتونة', 'زجاجة', 'أخرى'];

const emptyForm = {
  code: '',
  name: '',
  scrapType: 'جركن' as ScrapType,
  minStock: '',
  notes: '',
};

export default function Items() {
  const { appUser, hasRole } = useAuth();
  const { showToast } = useToast();
  const { data: items, loading } = useCollection<Item>('items', [orderBy('name')]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canEdit = hasRole('raw_material_keeper');

  const filtered = items.filter(
    (i) => i.name.includes(search) || i.code.includes(search)
  );

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      scrapType: item.scrapType,
      minStock: item.minStock?.toString() || '',
      notes: item.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      showToast('error', 'الكود والاسم مطلوبان');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'items', editing.id), {
          code: form.code,
          name: form.name,
          scrapType: form.scrapType,
          minStock: form.minStock ? Number(form.minStock) : null,
          notes: form.notes,
          updatedAt: serverTimestamp(),
          updatedBy: appUser?.uid,
        });
        showToast('success', 'تم تحديث الصنف بنجاح');
      } else {
        await addDoc(collection(db, 'items'), {
          code: form.code,
          name: form.name,
          scrapType: form.scrapType,
          unit: 'عدد',
          minStock: form.minStock ? Number(form.minStock) : null,
          notes: form.notes,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: appUser?.uid,
          updatedBy: appUser?.uid,
        });
        showToast('success', 'تم إضافة الصنف بنجاح');
      }
      setModalOpen(false);
    } catch (e: any) {
      showToast('error', 'حدث خطأ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: Item) => {
    try {
      await updateDoc(doc(db, 'items', item.id), {
        active: !item.active,
        updatedAt: serverTimestamp(),
        updatedBy: appUser?.uid,
      });
      showToast('success', item.active ? 'تم تعطيل الصنف' : 'تم تفعيل الصنف');
    } catch (e: any) {
      showToast('error', 'حدث خطأ: ' + e.message);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="إدارة الأصناف"
        subtitle="أصناف الفوارغ المستخدمة في النظام"
        actions={
          canEdit ? (
            <Button onClick={openNew}>
              <Plus size={16} /> إضافة صنف
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4 mb-4">
        <div className="relative max-w-xs">
          <Search className="absolute right-3 top-2.5 text-gray-400" size={16} />
          <input
            className="w-full rounded-lg border border-surface-200 pr-9 pl-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
            placeholder="بحث بالاسم أو الكود..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card className="overflow-x-auto">
        {filtered.length === 0 ? (
          <EmptyState message="لا توجد أصناف" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">الكود</th>
                <th className="text-right px-4 py-3 font-medium">اسم الصنف</th>
                <th className="text-right px-4 py-3 font-medium">نوع الفارغ</th>
                <th className="text-right px-4 py-3 font-medium">الحد الأدنى</th>
                <th className="text-right px-4 py-3 font-medium">الحالة</th>
                {canEdit && <th className="text-right px-4 py-3 font-medium">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3">{item.scrapType}</td>
                  <td className="px-4 py-3">{item.minStock ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`status-badge ${item.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                      {item.active ? 'نشط' : 'غير نشط'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(item)} className="text-gray-400 hover:text-brand-600">
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => toggleActive(item)}
                          className="text-gray-400 hover:text-red-600"
                          title={item.active ? 'تعطيل' : 'تفعيل'}
                        >
                          {item.active ? <PackageX size={16} /> : <PackageCheck size={16} />}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'تعديل صنف' : 'إضافة صنف جديد'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="كود الصنف" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Select label="نوع الفارغ" value={form.scrapType} onChange={(e) => setForm({ ...form, scrapType: e.target.value as ScrapType })}>
              {SCRAP_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>
          <Input label="اسم الصنف" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input
            label="الحد الأدنى للرصيد (اختياري)"
            type="number"
            value={form.minStock}
            onChange={(e) => setForm({ ...form, minStock: e.target.value })}
          />
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
