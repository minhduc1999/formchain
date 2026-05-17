import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Copy, Check, ExternalLink,
  Clock, Users, Star, Mail, MailOpen, CheckCheck,
  Lock, Inbox, ChevronsUpDown, RefreshCw, Loader2,
  Download, Pause, Play, AlertCircle,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useAppStore } from '../store';
import { useFormChain } from '../hooks/useFormChain';
import { walrusDownload, walrusDownloadJSON } from '../lib/walrus';
import { createSessionKey, sealDecryptResponse } from '../lib/seal';
import { useSignPersonalMessage } from '@mysten/dapp-kit';
import { FormResponse, FormConfig } from '../types';
import ResponseDetailModal from '../components/ui/ResponseDetailModal';

/* ── helpers ─────────────────────────────────────────────────────────────────── */
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

function StarRow({ n }: { n?: number }) {
  if (!n) return <span className="muted">—</span>;
  return (
    <span className="star-display">
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
      <span className="star-num"> {n}</span>
    </span>
  );
}

function CopyBtn({ formId }: { formId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/survey/${formId}`;
  return (
    <button className="btn btn-ghost btn-sm" onClick={e => {
      e.stopPropagation();
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }}>
      {copied ? <Check size={13} style={{ color: 'var(--green)' }} /> : <Copy size={13} />}
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}

function autoPriority(r: FormResponse): 'high' | 'medium' | 'low' | null {
  if (r.priority) return r.priority;
  const HIGH_KW = ['error','crash','data loss','bug','not working','critical','urgent','fail'];
  const MED_KW  = ['need','follow up','difficult','missing','slow','issue','problem'];
  const scores: number[] = [];

  if (r.rating != null) {
    if (r.rating <= 2) scores.push(0);
    else if (r.rating === 3) scores.push(1);
    else scores.push(2);
  }
  if (r.note) {
    const n = r.note.toLowerCase();
    if (HIGH_KW.some(k => n.includes(k))) scores.push(0);
    else if (MED_KW.some(k => n.includes(k))) scores.push(1);
  }
  if (r.note?.trim()) scores.push(1);

  if (!scores.length) return null;
  const best = Math.min(...scores);
  return best === 0 ? 'high' : best === 1 ? 'medium' : 'low';
}

/* ── Response row ─────────────────────────────────────────────────────────────── */
function ResponseRow({ r, isRead, onRead, computedPriority }: {
  r: FormResponse;
  isRead: boolean;
  onRead: () => void;
  computedPriority: 'high' | 'medium' | 'low' | null;
}) {
  const priorityLabel: Record<string, string> = { high: 'High', medium: 'Med', low: 'Low' };
  const priorityClass: Record<string, string> = { high: 'badge-high', medium: 'badge-medium', low: 'badge-low' };

  return (
    <tr className={`resp-row ${!isRead ? 'unread-row' : ''}`} onClick={onRead} style={{ cursor: 'pointer' }}>
      <td>{isRead
        ? <MailOpen size={14} style={{ color: 'var(--text-3)' }} />
        : <Mail size={14} style={{ color: 'var(--green)' }} />}
      </td>
      <td className="mono addr-cell">{r.walletAddress.slice(0, 8)}...{r.walletAddress.slice(-6)}</td>
      <td className="muted time-cell">
        <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
        {timeAgo(r.submittedAt)}
      </td>
      <td><StarRow n={r.rating} /></td>
      <td>
        {computedPriority
          ? <span className={`badge ${priorityClass[computedPriority]}`}>{priorityLabel[computedPriority]}</span>
          : <span className="muted">—</span>}
      </td>
      <td className="note-cell">{r.note ?? <span className="muted">—</span>}</td>
      <td className="mono muted blob-cell" style={{ fontSize: 10 }}>
        {r.blobId ? `${r.blobId.slice(0, 12)}...` : '—'}
      </td>
    </tr>
  );
}

/* ── Export helper ────────────────────────────────────────────────────────────── */
function detectImageExt(bytes: Uint8Array): 'png' | 'gif' | 'jpeg' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  return 'jpeg';
}

/** Kiểm tra value là field-level sealed (dạng { __sealed: true, data: [...] }) */
function isSealedFieldValue(val: unknown): boolean {
  return (
    typeof val === 'object' &&
    val !== null &&
    '__sealed' in val &&
    (val as Record<string, unknown>).__sealed === true
  );
}

type SealDecryptFn = (
  encryptedBytes: Uint8Array,
  responseIndex: number,
) => Promise<Uint8Array>;

async function exportResponses(
  form: FormConfig,
  responses: FormResponse[],
  sealDecrypt?: SealDecryptFn,
) {
  if (responses.length === 0) { alert('No data to export.'); return; }

  // @ts-ignore
  if (!window.ExcelJS) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ExcelJS'));
      document.head.appendChild(s);
    });
  }
  // @ts-ignore
  const ExcelJS = window.ExcelJS;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(form.title.slice(0, 31));

  const imageFields = form.fields.filter((f: { type: string }) => f.type === 'image_upload');
  const IMAGE_ROW_HEIGHT = 150;

  const fixedHeaders = ['Wallet Address', 'Time', 'Blob ID', 'Priority', 'Note'];
  const allHeaders = [
    ...fixedHeaders,
    ...form.fields.map((f: { label: string; sealEncrypted?: boolean }) =>
      f.sealEncrypted ? f.label + ' 🔒' : f.label
    ),
  ];

  const headerRow = ws.addRow(allHeaders);
  headerRow.height = 20;
  headerRow.eachCell((cell: { font: object; fill: object }, colNumber: number) => {
    const fieldIndex = colNumber - fixedHeaders.length - 1;
    const field = form.fields[fieldIndex] as { sealEncrypted?: boolean } | undefined;
    if (field?.sealEncrypted) {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } };
    } else {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF222222' } };
    }
  });

  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 20;
  form.fields.forEach((f: { type: string }, i: number) => {
    ws.getColumn(6 + i).width = f.type === 'image_upload' ? 35 : 20;
  });

  let excelRow = 2;
  for (const r of responses) {
    let data: Record<string, unknown> = r.data ?? {};
    if (r.blobId) {
      try {
        if (form.sealEncrypted && sealDecrypt && r.responseIndex != null) {
          // Seal-encrypted: download raw bytes then decrypt
          const encryptedBytes = await walrusDownload(r.blobId);
          const decryptedBytes = await sealDecrypt(encryptedBytes, r.responseIndex);
          let text = new TextDecoder('utf-8').decode(decryptedBytes);
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          const parsed = JSON.parse(text.trim());
          data = parsed.answers ?? parsed;
        } else {
          const fetched = await walrusDownloadJSON<{ answers: Record<string, unknown> }>(r.blobId);
          const rawAnswers = fetched.answers ?? {};

          // Decrypt từng field __sealed nếu có sealDecrypt (per-field seal)
          if (sealDecrypt && r.responseIndex != null) {
            for (const [fieldId, val] of Object.entries(rawAnswers)) {
              if (isSealedFieldValue(val)) {
                try {
                  const encBytes = new Uint8Array((val as { __sealed: boolean; data: number[] }).data);
                  const decBytes = await sealDecrypt(encBytes, r.responseIndex);
                  let text = new TextDecoder('utf-8').decode(decBytes);
                  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                  rawAnswers[fieldId] = JSON.parse(text.trim());
                } catch {
                  rawAnswers[fieldId] = '[Decrypt failed]';
                }
              }
            }
          }

          data = rawAnswers;
        }
      } catch { /* use local data as fallback */ }
    }

    const imagesToEmbed: { colIndex: number; bytes: Uint8Array }[] = [];
    for (const f of imageFields) {
      const val = data[f.id];
      if (typeof val === 'string' && val.length > 20) {
        try {
          const bytes = await walrusDownload(val);
          const colIndex = fixedHeaders.length + form.fields.findIndex((x: { id: string }) => x.id === f.id);
          imagesToEmbed.push({ colIndex, bytes });
        } catch { /* skip */ }
      }
    }

    const rowValues = [
      r.walletAddress,
      new Date(r.submittedAt).toLocaleString('en-US'),
      r.blobId ?? '',
      r.priority ?? '',
      r.note ?? '',
      ...form.fields.map((f: { type: string; id: string; options?: { id: string; label: string }[] }) => {
        if (f.type === 'image_upload') return '';
        const v = data[f.id];
        // Nếu value vẫn còn dạng sealed (decrypt fail hoặc không có sealDecrypt) → hiển thị [Sealed]
        if (isSealedFieldValue(v)) return '🔒 [Sealed]';
        // Dropdown: resolve option.id → label
        if (f.type === 'dropdown' && typeof v === 'string') {
          const found = (f.options ?? []).find((o) => o.id === v);
          return found ? found.label : v;
        }
        // Checkbox: resolve array of option.id → labels
        if (f.type === 'checkbox' && Array.isArray(v)) {
          const options = f.options ?? [];
          return (v as string[]).map((id) => options.find((o) => o.id === id)?.label ?? id).join(', ');
        }
        if (Array.isArray(v)) return v.join(', ');
        return v != null ? String(v) : '';
      }),
    ];

    const row = ws.addRow(rowValues);
    row.font = { name: 'Arial', size: 10 };
    row.alignment = { vertical: 'top', wrapText: true };

    // Tô màu cell nếu value vẫn còn sealed (decrypt fail hoặc không có quyền)
    form.fields.forEach((f: { type: string; id: string }, i: number) => {
      const v = data[f.id];
      if (isSealedFieldValue(v)) {
        const colNum = fixedHeaders.length + i + 1; // 1-indexed
        const cell = row.getCell(colNum);
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF8B5CF6' }, italic: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1040' } };
      }
    });

    if (imagesToEmbed.length > 0) {
      row.height = IMAGE_ROW_HEIGHT;
      for (const { colIndex, bytes } of imagesToEmbed) {
        const ext = detectImageExt(bytes);
        const imageId = wb.addImage({ buffer: bytes.buffer as ArrayBuffer, extension: ext });
        ws.addImage(imageId, {
          tl: { col: colIndex + 0.05, row: excelRow - 1 + 0.05 },
          br: { col: colIndex + 1 - 0.05, row: excelRow - 0.05 },
          editAs: 'oneCell',
        });
      }
    }
    excelRow++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${form.title.replace(/[^a-z0-9]/gi, '_')}_responses.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Main Dashboard ────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { forms, responses, readResponseIds, markAsRead, markAllAsRead, updateForm } = useAppStore();
  const { syncFormsFromChain, setPausedOnChain, fetchResponsesForForm, txStatus } = useFormChain();

  const [selectedFormId, setSelectedFormId] = useState(forms[0]?.id ?? '');
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  const [selectedResponse, setSelectedResponse] = useState<string | null>(null);
  const [sortByPriority, setSortByPriority] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fetchingResponses, setFetchingResponses] = useState(false);

  const selectedForm = forms.find(f => f.id === selectedFormId);
  const formResponses = responses.filter(r => r.formId === selectedFormId);
  const unread = formResponses.filter(r => !readResponseIds.has(r.id));
  const read   = formResponses.filter(r =>  readResponseIds.has(r.id));

  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const baseShown = tab === 'unread' ? unread : read;
  const shown = sortByPriority
    ? [...baseShown].sort((a, b) => {
        const pa = autoPriority(a); const pb = autoPriority(b);
        const na = pa != null ? PRIORITY_ORDER[pa] : 99;
        const nb = pb != null ? PRIORITY_ORDER[pb] : 99;
        return na !== nb ? na - nb : new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
      })
    : baseShown;

  const avgRating = formResponses.filter(r => r.rating).length
    ? (formResponses.reduce((s, r) => s + (r.rating ?? 0), 0) / formResponses.filter(r => r.rating).length).toFixed(1)
    : '—';

  useEffect(() => {
    if (account && forms.length === 0) handleSync();
  }, [account]);

  useEffect(() => {
    if (forms.length > 0 && !selectedFormId) {
      setSelectedFormId(forms[0].id);
    }
  }, [forms]);

  useEffect(() => {
    if (!selectedForm) return;
    setFetchingResponses(true);
    fetchResponsesForForm(selectedForm).finally(() => setFetchingResponses(false));
  }, [selectedFormId]);

  async function handleSync() {
    setSyncing(true);
    await syncFormsFromChain();
    setSyncing(false);
  }

  function handleSelectForm(id: string) {
    setSelectedFormId(id);
    setTab('unread');
  }

  async function handleExport() {
    if (!selectedForm) return;
    setExporting(true);
    try {
      let sealDecrypt: SealDecryptFn | undefined;

      // Cần decrypt nếu form-level seal HOẶC có bất kỳ field nào sealEncrypted
      const hasPerFieldSeal = (selectedForm.fields ?? []).some(f => f.sealEncrypted);
      const needsSeal = (selectedForm.sealEncrypted || hasPerFieldSeal)
        && selectedForm.onChain?.objectId
        && selectedForm.onChain?.capId;

      if (needsSeal) {
        if (!account) {
          alert('Please connect your wallet to export Seal-encrypted responses.');
          return;
        }
        // Tạo một session key dùng chung cho toàn bộ export
        const sessionKey = await createSessionKey(
          account.address,
          async ({ message }) => {
            const result = await signPersonalMessage({ message });
            return { signature: result.signature };
          },
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const formObjectId = selectedForm.onChain!.objectId;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const capObjectId = selectedForm.onChain!.capId;
        sealDecrypt = (encryptedBytes, responseIndex) =>
          sealDecryptResponse(encryptedBytes, formObjectId, capObjectId, responseIndex, sessionKey);
      }

      await exportResponses(selectedForm, formResponses, sealDecrypt);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleTogglePause() {
    if (!selectedForm) return;
    await setPausedOnChain(selectedForm, !!selectedForm.published);
  }

  return (
    <div className="dashboard">
      {/* Mobile form chips */}
      <div className="mobile-form-select">
        {forms.map(f => {
          const unreadCount = responses.filter(r => r.formId === f.id && !readResponseIds.has(r.id)).length;
          return (
            <button key={f.id} className={`mobile-form-chip ${f.id === selectedFormId ? 'active' : ''}`} onClick={() => handleSelectForm(f.id)}>
              <span className={`dot ${f.published ? 'dot-green' : 'dot-gray'}`} style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
              {f.title}
              {unreadCount > 0 && <span className="chip-count">{unreadCount}</span>}
            </button>
          );
        })}
      </div>

      {/* Sidebar */}
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <p className="sidebar-label" style={{ marginBottom: 0 }}>My Forms</p>
          <button className="btn btn-ghost btn-icon btn-xs" onClick={handleSync} disabled={syncing} title="Sync from blockchain">
            {syncing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          </button>
        </div>

        {forms.length === 0 ? (
          <p className="hint-text">No forms yet. Create one to get started.</p>
        ) : (
          <ul className="form-list">
            {forms.map(f => {
              const unreadCount = responses.filter(r => r.formId === f.id && !readResponseIds.has(r.id)).length;
              return (
                <li key={f.id} className={`form-list-item ${f.id === selectedFormId ? 'active' : ''}`} onClick={() => handleSelectForm(f.id)}>
                  <div className="form-list-row">
                    <span className="form-list-title">{f.title}</span>
                    {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
                  </div>
                  <span className="form-list-meta">
                    <span className={`dot ${f.published ? 'dot-green' : 'dot-gray'}`} />
                    {f.responseCount} responses
                    {f.sealEncrypted && <Lock size={10} style={{ marginLeft: 4, color: 'var(--purple)' }} />}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Main */}
      <main className="main-content">
        {!selectedForm ? (
          <div className="empty-state">
            {syncing ? (
              <><Loader2 size={32} className="spin" style={{ color: 'var(--green)', marginBottom: 12 }} /><p>Syncing from blockchain...</p></>
            ) : (
              <>
                <p style={{ marginBottom: 12 }}>No forms found.</p>
                <Link to="/create" className="btn btn-primary"><Plus size={14} /> Create your first form</Link>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="content-header">
              <div>
                <h1 className="page-title">{selectedForm.title}</h1>
                {selectedForm.published && (
                  <div className="page-link-row">
                    <code className="page-url">{window.location.origin}/survey/{selectedForm.id.slice(0, 12)}...</code>
                    <a href={`/survey/${selectedForm.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon btn-xs">
                      <ExternalLink size={12} />
                    </a>
                  </div>
                )}
                {selectedForm.onChain?.objectId && (
                  <a
                    href={`https://suiscan.xyz/mainnet/object/${selectedForm.onChain.objectId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="tx-link"
                    style={{ display: 'inline-flex', marginTop: 4 }}
                  >
                    <ExternalLink size={11} /> View on SuiScan
                  </a>
                )}
              </div>
              <div className="header-actions">
                {selectedForm.published && <CopyBtn formId={selectedForm.id} />}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleExport}
                  disabled={exporting || formResponses.length === 0}
                  title="Export CSV"
                >
                  {exporting ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                  Export CSV
                </button>
                {selectedForm.onChain?.capId && (
                  <button className="btn btn-ghost btn-sm" onClick={handleTogglePause} title={selectedForm.published ? 'Pause accepting responses' : 'Resume accepting responses'}>
                    {selectedForm.published ? <Pause size={13} /> : <Play size={13} />}
                    {selectedForm.published ? 'Pause' : 'Resume'}
                  </button>
                )}
              </div>
            </div>

            {/* Tx error */}
            {txStatus.status === 'error' && (
              <div className="error-banner" style={{ marginBottom: 16 }}>
                <AlertCircle size={14} />
                <span>{txStatus.error}</span>
              </div>
            )}

            {/* Stats */}
            <div className="stats-row">
              <div className="stat-card">
                <p className="stat-label">Total Responses</p>
                <p className="stat-value">{selectedForm.responseCount ?? formResponses.length}</p>
                <p className="stat-sub">all time</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Unread</p>
                <p className="stat-value blue">{unread.length}</p>
                <p className="stat-sub">needs review</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Avg Rating</p>
                <p className="stat-value gold">{avgRating}{avgRating !== '—' ? ' ★' : ''}</p>
                <p className="stat-sub">/ 5 stars</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Encryption</p>
                <p className="stat-value" style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {selectedForm.sealEncrypted
                    ? <><Lock size={16} style={{ color: 'var(--purple)' }} /> <span style={{ color: 'var(--purple)', fontSize: 14 }}>Seal</span></>
                    : <span style={{ color: 'var(--text-3)', fontSize: 14 }}>None</span>}
                </p>
                <p className="stat-sub">{selectedForm.fields.length} fields</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="resp-tabs">
              <button className={`resp-tab ${tab === 'unread' ? 'active' : ''}`} onClick={() => setTab('unread')}>
                <Mail size={14} />Unread{unread.length > 0 && <span className="tab-count">{unread.length}</span>}
              </button>
              <button className={`resp-tab ${tab === 'read' ? 'active' : ''}`} onClick={() => setTab('read')}>
                <MailOpen size={14} />Read{read.length > 0 && <span className="tab-count tab-count-dim">{read.length}</span>}
              </button>
              {tab === 'unread' && unread.length > 0 && (
                <button className="btn btn-ghost btn-sm mark-all-btn" onClick={() => markAllAsRead(selectedForm.id)}>
                  <CheckCheck size={13} /> Mark all as read
                </button>
              )}
              <button
                className={`btn btn-ghost btn-sm sort-priority-btn ${sortByPriority ? 'active' : ''}`}
                onClick={() => setSortByPriority(v => !v)}
              >
                <ChevronsUpDown size={13} />
                {sortByPriority ? 'Sorted by: Priority' : 'Sort by priority'}
              </button>
            </div>

            {/* Table */}
            {shown.length === 0 ? (
              <div className="resp-empty">
                {fetchingResponses
                  ? <><Loader2 size={24} className="spin" style={{ color: 'var(--green)', marginBottom: 10 }} /><p>Loading responses from blockchain...</p></>
                  : <><Inbox size={32} style={{ color: 'var(--text-3)', marginBottom: 10 }} /><p>{tab === 'unread' ? 'No unread responses' : 'No read responses yet'}</p></>
                }
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="resp-table">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }}></th>
                        <th>Sender Wallet</th>
                        <th>Time</th>
                        <th>Rating</th>
                        <th>Priority</th>
                        <th>Note</th>
                        <th>Blob ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(r => (
                        <ResponseRow
                          key={r.id}
                          r={r}
                          isRead={readResponseIds.has(r.id)}
                          computedPriority={autoPriority(r)}
                          onRead={() => {
                            markAsRead(r.id);
                            setSelectedResponse(r.id);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="resp-card-list">
                  {shown.map(r => {
                    const isRead = readResponseIds.has(r.id);
                    const cp = autoPriority(r);
                    const priorityClass: Record<string, string> = { high: 'badge-high', medium: 'badge-medium', low: 'badge-low' };
                    const priorityLabel: Record<string, string> = { high: 'High', medium: 'Med', low: 'Low' };
                    return (
                      <div key={r.id} className={`resp-card ${!isRead ? 'unread' : ''}`}
                        onClick={() => { markAsRead(r.id); setSelectedResponse(r.id); }}>
                        <div className="resp-card-top">
                          <span className="resp-card-addr">
                            {!isRead && <Mail size={12} style={{ color: 'var(--green)', marginRight: 6 }} />}
                            {r.walletAddress.slice(0, 8)}...{r.walletAddress.slice(-6)}
                          </span>
                          <span className="resp-card-time">{timeAgo(r.submittedAt)}</span>
                        </div>
                        <div className="resp-card-bottom">
                          {r.rating && <StarRow n={r.rating} />}
                          {cp && <span className={`badge ${priorityClass[cp]}`}>{priorityLabel[cp]}</span>}
                          {r.blobId && <span className="mono muted" style={{ fontSize: 10 }}>{r.blobId.slice(0, 12)}...</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* Response Modal */}
      {selectedResponse && selectedForm && (() => {
        const resp = responses.find(r => r.id === selectedResponse);
        if (!resp) return null;
        return (
          <ResponseDetailModal
            response={resp}
            form={selectedForm}
            isRead={readResponseIds.has(resp.id)}
            computedPriority={autoPriority(resp)}
            onClose={() => setSelectedResponse(null)}
          />
        );
      })()}
    </div>
  );
}