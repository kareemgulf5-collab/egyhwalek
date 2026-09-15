import type { DocumentStatus, MatchStatus } from '@/types';

const DOC_STATUS_MAP: Record<DocumentStatus, { label: string; cls: string }> = {
  draft: { label: 'مسودة', cls: 'bg-gray-100 text-gray-700' },
  pending_review: { label: 'بانتظار المراجعة', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'معتمد', cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'ملغي', cls: 'bg-red-100 text-red-700' },
};

const MATCH_STATUS_MAP: Record<MatchStatus, { label: string; cls: string }> = {
  matched: { label: 'مطابق', cls: 'bg-emerald-100 text-emerald-800' },
  needs_review: { label: 'يحتاج مراجعة', cls: 'bg-amber-100 text-amber-800' },
  closed: { label: 'مغلق', cls: 'bg-gray-100 text-gray-700' },
};

export function DocStatusBadge({ status }: { status: DocumentStatus }) {
  const s = DOC_STATUS_MAP[status] || DOC_STATUS_MAP.draft;
  return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const s = MATCH_STATUS_MAP[status] || MATCH_STATUS_MAP.matched;
  return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
}

export function DifferenceBadge({ difference }: { difference: number }) {
  if (difference === 0) {
    return <span className="status-badge bg-emerald-100 text-emerald-800">مطابق</span>;
  }
  if (difference > 0) {
    return <span className="status-badge bg-red-100 text-red-700">عجز في الفوارغ ({difference})</span>;
  }
  return <span className="status-badge bg-blue-100 text-blue-700">زيادة عن المصروف ({Math.abs(difference)})</span>;
}
