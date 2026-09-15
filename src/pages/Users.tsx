import { useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { createUserAccount } from '@/lib/userAdmin';
import { useCollection } from '@/hooks/useCollection';
import { useAuth, ROLE_LABELS } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import type { AppUser, UserRole } from '@/types';
import { Card, PageHeader, Button, Modal, Input, Select, EmptyState, LoadingState } from '@/components/ui';
import { Plus, UserX, UserCheck } from 'lucide-react';

const ROLE_OPTIONS: UserRole[] = ['admin', 'raw_material_keeper', 'production_supervisor', 'scrap_keeper', 'reviewer'];

export default function Users() {
  const { appUser, hasRole } = useAuth();
  const { showToast } = useToast();
  const { data: users, loading } = useCollection<AppUser>('users', [orderBy('createdAt', 'desc')]);

  if (!hasRole('admin')) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        هذه الصفحة متاحة لمدير النظام فقط.
      </div>
    );
  }

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '', role: 'reviewer' as UserRole });

  const openNew = () => {
    setForm({ email: '', password: '', displayName: '', role: 'reviewer' });
    setModalOpen(true);
  };

  const handleCreate = async () => {
    if (!form.email.trim() || !form.password.trim() || !form.displayName.trim()) {
      showToast('error', 'كل الحقول مطلوبة');
      return;
    }
    setSaving(true);
    try {
      await createUserAccount({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
        role: form.role,
        createdBy: appUser!.uid,
      });
      showToast('success', 'تم إنشاء المستخدم بنجاح');
      setModalOpen(false);
    } catch (e: any) {
      showToast('error', e.message || 'فشل إنشاء المستخدم');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (u: AppUser, role: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', u.uid), { role, updatedAt: serverTimestamp() });
      showToast('success', 'تم تحديث الدور');
    } catch (e: any) {
      showToast('error', e.message || 'فشل التحديث');
    }
  };

  const toggleActive = async (u: AppUser) => {
    if (u.uid === appUser?.uid) {
      showToast('error', 'لا يمكنك تعطيل حسابك الخاص');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', u.uid), { active: !u.active, updatedAt: serverTimestamp() });
      showToast('success', u.active ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم');
    } catch (e: any) {
      showToast('error', e.message || 'فشل التحديث');
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="المستخدمون والصلاحيات"
        subtitle="إدارة حسابات النظام وأدوارها (متاح لمدير النظام فقط)"
        actions={<Button onClick={openNew}><Plus size={16} /> مستخدم جديد</Button>}
      />

      <Card className="overflow-x-auto">
        {users.length === 0 ? (
          <EmptyState message="لا يوجد مستخدمون" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right px-4 py-3 font-medium">الاسم</th>
                <th className="text-right px-4 py-3 font-medium">البريد الإلكتروني</th>
                <th className="text-right px-4 py-3 font-medium">الدور</th>
                <th className="text-right px-4 py-3 font-medium">الحالة</th>
                <th className="text-right px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.displayName}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-surface-200 px-2 py-1.5 text-xs bg-white"
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as UserRole)}
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`status-badge ${u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                      {u.active ? 'نشط' : 'غير نشط'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(u)} className="text-gray-400 hover:text-red-600" title={u.active ? 'تعطيل' : 'تفعيل'}>
                      {u.active ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إنشاء مستخدم جديد">
        <div className="space-y-4">
          <Input label="الاسم الكامل" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="كلمة المرور المبدئية" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Select label="الدور" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'جاري الإنشاء...' : 'إنشاء المستخدم'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
