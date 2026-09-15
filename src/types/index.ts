import type { Timestamp } from 'firebase/firestore';

// ===== الأدوار =====
export type UserRole =
  | 'admin' // مدير النظام
  | 'raw_material_keeper' // أمين مخزن الخامات
  | 'production_supervisor' // مسؤول الإنتاج
  | 'scrap_keeper' // أمين مخزن الهالك
  | 'reviewer'; // المراجع / المحاسب

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: Timestamp;
  createdBy?: string;
}

// ===== حالات المستندات =====
export type DocumentStatus = 'draft' | 'pending_review' | 'approved' | 'cancelled';
export type MatchStatus = 'matched' | 'needs_review' | 'closed';

// ===== الأصناف =====
export type ScrapType = 'جركن' | 'علبة' | 'كرتونة' | 'زجاجة' | 'أخرى';

export interface Item {
  id: string;
  code: string;
  name: string;
  scrapType: ScrapType;
  unit: 'عدد';
  minStock?: number;
  active: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ===== المخازن وصالات الإنتاج =====
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: 'raw_materials' | 'scrap' | 'other';
  active: boolean;
  notes?: string;
  createdAt: Timestamp;
}

export interface ProductionArea {
  id: string;
  code: string;
  name: string;
  active: boolean;
  notes?: string;
  createdAt: Timestamp;
}

// ===== أصناف المستند (سطر) =====
export interface IssueLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  scrapType: ScrapType;
  quantity: number;
  notes?: string;
}

// ===== إذن صرف الخامات =====
export interface MaterialIssue {
  id: string;
  issueNumber: string; // تلقائي
  date: Timestamp;
  sourceWarehouseId: string;
  sourceWarehouseName: string;
  productionAreaId: string;
  productionAreaName: string;
  workOrderNumber?: string;
  receivedByName: string;
  notes?: string;
  status: DocumentStatus;
  lines: IssueLine[];
  totalQuantity: number;
  // كمية متبقية لكل صنف لم تُسلّم بعد للهالك (تُحدّث عند كل تسليم هالك مرتبط)
  remainingByItem: Record<string, number>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
  approvedAt?: Timestamp;
  approvedBy?: string;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
}

// ===== سطر مطابقة الهالك =====
export interface ScrapMatchLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  scrapType: ScrapType;
  issuedQuantity: number; // الكمية المصروفة (من إذن الصرف)
  deliveredQuantity: number; // الكمية المسلمة للهالك في هذا الإذن
  difference: number; // issuedQuantity - deliveredQuantity (للسطر ضمن هذا التسليم فقط، بناءً على المتبقي وقت الإذن)
  matchStatus: MatchStatus;
  differenceReason?: string;
}

// ===== إذن تسليم فوارغ للهالك =====
export interface ScrapReceipt {
  id: string;
  receiptNumber: string; // تلقائي
  date: Timestamp;
  sourceIssueId: string; // ربط بإذن الصرف الأصلي
  sourceIssueNumber: string;
  productionAreaId: string;
  productionAreaName: string;
  scrapWarehouseId: string;
  scrapWarehouseName: string;
  deliveredByName: string;
  receivedByName: string;
  notes?: string;
  status: DocumentStatus;
  overallMatchStatus: MatchStatus;
  lines: ScrapMatchLine[];
  totalDelivered: number;
  totalDifference: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
  approvedAt?: Timestamp;
  approvedBy?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
}

// ===== مبيعات الهالك =====
export interface ScrapSaleLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ScrapSale {
  id: string;
  saleNumber: string; // تلقائي
  date: Timestamp;
  customerName: string;
  customerPhone?: string;
  paymentMethod: 'نقدي' | 'تحويل بنكي' | 'شيك' | 'آجل';
  notes?: string;
  status: DocumentStatus;
  lines: ScrapSaleLine[];
  totalAmount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
  approvedAt?: Timestamp;
  approvedBy?: string;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  cancelReason?: string;
}

// ===== سجل حركة المخزون الموحد =====
export type MovementType =
  | 'issue_out' // خروج من مخزن الخامات
  | 'scrap_in' // دخول لمخزن الهالك
  | 'sale_out' // خروج (بيع) من مخزن الهالك
  | 'sale_reversal'; // إرجاع بسبب إلغاء بيع

export interface StockMovement {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  movementType: MovementType;
  quantity: number; // موجب دائمًا؛ الاتجاه يحدده movementType
  documentId: string;
  documentNumber: string;
  documentType: 'materialIssue' | 'scrapReceipt' | 'scrapSale';
  date: Timestamp;
  userId: string;
  userName: string;
  referenceDocumentId?: string;
  notes?: string;
  createdAt: Timestamp;
}

// ===== سجل التدقيق =====
export interface AuditLog {
  id: string;
  action: 'create' | 'update' | 'approve' | 'cancel' | 'review' | 'correct';
  entityType: 'item' | 'materialIssue' | 'scrapReceipt' | 'scrapSale' | 'warehouse' | 'user';
  entityId: string;
  entityLabel: string;
  userId: string;
  userName: string;
  details?: string;
  timestamp: Timestamp;
}

// ===== إعدادات ترقيم المستندات =====
export interface DocumentCounter {
  prefix: string;
  lastNumber: number;
  year: number;
}
