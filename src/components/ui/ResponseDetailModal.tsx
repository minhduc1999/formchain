import { useState, useEffect } from 'react';
import { X, Wallet, Clock, Star, Flag, FileText, Hash, Mail, MailOpen, Loader2, ExternalLink, Save, Lock } from 'lucide-react';
import { FormResponse, FormConfig, FormField } from '../../types';
import { useFormChain } from '../../hooks/useFormChain';
import { walrusDownload, walrusDownloadJSON, walrusBlobUrl } from '../../lib/walrus';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { createSessionKey, sealDecryptResponse } from '../../lib/seal';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

interface Props {
  response: FormResponse;
  form: FormConfig;
  isRead: boolean;
  computedPriority: 'high' | 'medium' | 'low' | null;
  onClose: () => void;
}

const priorityLabel: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const priorityClass: Record<string, string> = { high: 'badge-high', medium: 'badge-medium', low: 'badge-low' };

export default function ResponseDetailModal({ response, form, isRead, computedPriority, onClose }: Props) {
  const { annotateResponse, txStatus } = useFormChain();
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [fetchedData, setFetchedData] = useState<Record<string, unknown> | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [needsDecrypt, setNeedsDecrypt] = useState(false);
  const [decrypting, setDecrypting] = useState(false);

  const [resolvedFields, setResolvedFields] = useState<FormField[]>(form.fields ?? []);
  const [fetchingFields, setFetchingFields] = useState(false);

  const [editPriority, setEditPriority] = useState<'high' | 'medium' | 'low' | ''>(response.priority ?? '');
  const [editNote, setEditNote] = useState(response.note ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!response.blobId) return;

    if (!form.sealEncrypted) {
      // Plain form hoặc per-field seal → fetch JSON bình thường
      setFetching(true);
      setFetchError(null);
      walrusDownloadJSON<{ answers: Record<string, unknown> }>(response.blobId)
        .then(d => setFetchedData(d.answers ?? {}))
        .catch(err => {
          console.warn('[ResponseDetailModal] Walrus fetch failed:', err);
          setFetchedData(response.data ?? {});
          setFetchError('Could not load from Walrus, using local data.');
        })
        .finally(() => setFetching(false));
      return;
    }

    setNeedsDecrypt(true);
  }, [response.blobId, form.sealEncrypted]);

  async function handleSealDecrypt() {
    if (!response.blobId || !form.onChain?.objectId || !form.onChain?.capId) return;
    if (!account) { setFetchError('Please connect your wallet first.'); return; }
    if (response.responseIndex == null) { setFetchError('Missing responseIndex.'); return; }

    setDecrypting(true);
    setFetchError(null);
    try {
      const encryptedBytes = await walrusDownload(response.blobId);

      const sessionKey = await createSessionKey(
        account.address,
        async ({ message }) => {
          const result = await signPersonalMessage({ message });
          return { signature: result.signature };
        },
      );

      const decryptedBytes = await sealDecryptResponse(
        encryptedBytes,
        form.onChain.objectId,
        form.onChain.capId,
        response.responseIndex,
        sessionKey,
      );

      let text = new TextDecoder('utf-8').decode(decryptedBytes);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const parsed = JSON.parse(text.trim());
      setFetchedData(parsed.answers ?? parsed);
      setNeedsDecrypt(false);
    } catch (err) {
      console.error('[Seal decrypt]', err);
      setFetchError(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDecrypting(false);
    }
  }

  useEffect(() => {
    if ((form.fields ?? []).length > 0) {
      setResolvedFields(form.fields);
      return;
    }

    const configBlobId = form.onChain?.configBlobId;
    if (!configBlobId) return;

    setFetchingFields(true);
    walrusDownloadJSON<Partial<FormConfig>>(configBlobId)
      .then(cfg => {
        if (cfg.fields && cfg.fields.length > 0) {
          setResolvedFields(cfg.fields);
        }
      })
      .catch(err => {
        console.warn('[ResponseDetailModal] Walrus config fetch failed:', err);
      })
      .finally(() => setFetchingFields(false));
  }, [form.fields, form.onChain?.configBlobId]);

  const displayData = fetchedData ?? response.data ?? {};

  // Per-field seal: decrypt một field cụ thể
  async function decryptField(fieldId: string) {
    if (!form.onChain?.objectId || !form.onChain?.capId) return;
    if (!account) { setFetchError('Please connect your wallet first.'); return; }
    if (response.responseIndex == null) return;

    setDecrypting(true);
    setFetchError(null);
    try {
      const sessionKey = await createSessionKey(
        account.address,
        async ({ message }) => {
          const result = await signPersonalMessage({ message });
          return { signature: result.signature };
        },
      );

      const sealedVal = displayData[fieldId] as { __sealed: boolean; data: number[] };
      const encryptedBytes = new Uint8Array(sealedVal.data);

      const decryptedBytes = await sealDecryptResponse(
        encryptedBytes,
        form.onChain.objectId,
        form.onChain.capId,
        response.responseIndex,
        sessionKey,
      );

      const text = new TextDecoder('utf-8').decode(decryptedBytes);
      const parsed = JSON.parse(text);

      // Update fetchedData với giá trị đã decrypt
      setFetchedData(prev => ({
        ...(prev ?? {}),
        [fieldId]: parsed,
      }));
    } catch (err) {
      setFetchError(`Field decryption failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDecrypting(false);
    }
  }

  function isSealedValue(val: unknown): val is { __sealed: boolean; data: number[] } {
    return typeof val === 'object' && val !== null && '__sealed' in val && (val as Record<string, unknown>).__sealed === true;
  }

  async function handleSaveAnnotation() {
    if (!form.onChain?.objectId || response.responseIndex == null) return;
    setSaving(true);
    try {
      await annotateResponse(
        form,
        response.responseIndex,
        editPriority || undefined,
        editNote
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  function isWalrusBlobId(val: unknown): val is string {
    if (typeof val !== 'string' || val.length < 20) return false;
    if (/^[0-9a-f]{64}$/i.test(val)) return true;
    if (val.startsWith('bafk')) return true;
    if (/^[A-Za-z0-9_-]{30,}$/.test(val)) return true;
    return false;
  }

  function WalrusImage({ blobId, fallbackText }: { blobId: string; fallbackText?: string }) {
    const [src, setSrc] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
      let objectUrl: string | null = null;
      walrusDownload(blobId)
        .then(bytes => {
          let mime = 'image/jpeg';
          if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
          else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = 'image/gif';
          else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = 'image/webp';
          const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        })
        .catch(() => setError(true));
      return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [blobId]);

    if (error) return <span>{fallbackText ?? blobId}</span>;
    if (!src) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 12 }}>
        <Loader2 size={12} className="spin" /> Loading image...
      </div>
    );

    return (
      <a href={src} target="_blank" rel="noreferrer">
        <img
          src={src}
          alt="Uploaded"
          style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, marginTop: 4, display: 'block' }}
        />
      </a>
    );
  }

  function renderFieldValue(field: FormField, val: unknown) {
    const fieldType = field.type;

    if (val === undefined || val === null || val === '') {
      return <span className="muted italic">— No data —</span>;
    }

    // Dropdown và Checkbox phải check TRƯỚC isWalrusBlobId vì option.id
    // có thể bị nhận nhầm là blob ID (string dài >= 30 chars).

    // Dropdown: lưu option.id → resolve sang label
    if (fieldType === 'dropdown' && typeof val === 'string') {
      const found = (field.options ?? []).find(o => o.id === val);
      return <span>{found ? found.label : val}</span>;
    }

    // Checkbox: lưu array of option.id → resolve sang labels
    if (fieldType === 'checkbox' && Array.isArray(val)) {
      if (val.length === 0) return <span className="muted italic">— No data —</span>;
      const options = field.options ?? [];
      const labels = (val as string[]).map(id => options.find(o => o.id === id)?.label ?? id);
      return <span>{labels.join(', ')}</span>;
    }

    if (fieldType === 'image_upload' && isWalrusBlobId(val)) {
      return <WalrusImage blobId={val as string} />;
    }

    if (fieldType === 'video_upload' && isWalrusBlobId(val)) {
      return (
        <a href={walrusBlobUrl(val as string)} target="_blank" rel="noreferrer" className="tx-link">
          <ExternalLink size={12} /> View video on Walrus
        </a>
      );
    }

    if (fieldType !== 'video_upload' && isWalrusBlobId(val)) {
      return <WalrusImage blobId={val as string} fallbackText={String(val)} />;
    }

    if (fieldType === 'star_rating' && typeof val === 'number') {
      return (
        <span className="star-display">
          {'★'.repeat(val)}{'☆'.repeat(5 - val)}
          <span className="star-num"> {val}/5</span>
        </span>
      );
    }

    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  }

  function renderFields() {
    const isLoadingFields = fetchingFields || fetching;

    if (isLoadingFields) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13 }}>
          <Loader2 size={14} className="spin" /> Loading data...
        </div>
      );
    }

    if (resolvedFields.length > 0) {
      return resolvedFields.map(field => {
        const val = displayData[field.id];
        const isSealed = isSealedValue(val);
        return (
          <div key={field.id} className="modal-field-item">
            <div className="modal-field-label">
              {field.label}
              {field.sealEncrypted && (
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--purple)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <Lock size={9} /> Sealed
                </span>
              )}
            </div>
            <div className="modal-field-value">
              {isSealed ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>🔒 Encrypted — click to decrypt</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '2px 8px', color: 'var(--purple)' }}
                    onClick={() => decryptField(field.id)}
                    disabled={decrypting}
                  >
                    {decrypting ? <Loader2 size={11} className="spin" /> : <Lock size={11} />}
                    {decrypting ? 'Decrypting...' : 'Decrypt'}
                  </button>
                </div>
              ) : (
                renderFieldValue(field, val)
              )}
            </div>
          </div>
        );
      });
    }

    const keys = Object.keys(displayData);
    if (keys.length === 0) {
      return (
        <div className="muted italic" style={{ fontSize: 13 }}>
          No submission data available.
        </div>
      );
    }

    return keys.map(key => (
      <div key={key} className="modal-field-item">
        <div className="modal-field-label" style={{ fontFamily: 'monospace', fontSize: 11 }}>{key}</div>
        <div className="modal-field-value">
          {renderFieldValue({ id: key, type: 'short_text', label: key, required: false }, displayData[key])}
        </div>
      </div>
    ));
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal-panel">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            {isRead
              ? <MailOpen size={16} style={{ color: 'var(--text-3)' }} />
              : <Mail size={16} style={{ color: 'var(--green)' }} />}
            <span className="modal-title">Response detail</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* Form */}
          <div className="modal-section-label">Form</div>
          <div className="modal-info-row">
            <FileText size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span className="modal-info-value">{form.title}</span>
            {form.onChain?.objectId && (
              <a href={`https://suiscan.xyz/mainnet/object/${form.onChain.objectId}`} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
                <ExternalLink size={12} style={{ color: 'var(--text-3)' }} />
              </a>
            )}
          </div>

          {/* Wallet */}
          <div className="modal-section-label">Wallet address</div>
          <div className="modal-info-row">
            <Wallet size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <code className="modal-mono">{response.walletAddress}</code>
          </div>

          {/* Time */}
          <div className="modal-section-label">Submitted at</div>
          <div className="modal-info-row">
            <Clock size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span className="modal-info-value">
              {new Date(response.submittedAt).toLocaleString('en-US')}
              <span className="muted" style={{ marginLeft: 8 }}>({timeAgo(response.submittedAt)})</span>
            </span>
          </div>

          {/* Priority (auto) */}
          {computedPriority && (
            <>
              <div className="modal-section-label">Auto priority</div>
              <div className="modal-info-row">
                <Flag size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <span className={`badge ${priorityClass[computedPriority]}`}>{priorityLabel[computedPriority]}</span>
              </div>
            </>
          )}

          {/* Blob ID */}
          {response.blobId && (
            <>
              <div className="modal-section-label">Walrus Blob ID</div>
              <div className="modal-info-row">
                <Hash size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <code className="modal-mono" style={{ fontSize: 10, wordBreak: 'break-all' }}>{response.blobId}</code>
              </div>
            </>
          )}

          {/* Fields data */}
          <div className="modal-divider" />
          <div className="modal-section-label" style={{ marginBottom: 10 }}>
            Submission content
            {(fetching || fetchingFields || decrypting) && <Loader2 size={12} className="spin" style={{ marginLeft: 8 }} />}
            {form.sealEncrypted && (
              <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--green, #22c55e)' }}>
                🔒 Seal
              </span>
            )}
            {!fetching && !fetchingFields && !form.sealEncrypted && response.blobId && (
              <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>← Walrus</span>
            )}
            {fetchError && (
              <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--yellow, #f59e0b)' }}>
                ⚠ {fetchError}
              </span>
            )}
          </div>

          {/* Seal decrypt button */}
          {needsDecrypt && !fetchedData && (
            <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--surface-2, rgba(255,255,255,0.05))', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.1))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, color: 'var(--text-2)' }}>
                <Lock size={14} />
                Data is encrypted with Seal. Sign with your wallet to decrypt.
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSealDecrypt}
                disabled={decrypting}
              >
                {decrypting
                  ? <><Loader2 size={13} className="spin" /> Decrypting...</>
                  : <><Lock size={13} /> Decrypt with Seal</>}
              </button>
            </div>
          )}

          <div className="modal-fields-list">
            {!needsDecrypt || fetchedData ? renderFields() : null}
          </div>

          {/* Admin annotation */}
          {form.onChain?.capId && (
            <>
              <div className="modal-divider" />
              <div className="modal-section-label" style={{ marginBottom: 10 }}>📋 Admin notes</div>

              <label className="settings-label">Priority level</label>
              <select
                className="settings-input"
                value={editPriority}
                onChange={e => setEditPriority(e.target.value as 'high' | 'medium' | 'low' | '')}
              >
                <option value="">— Not assigned —</option>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>

              <label className="settings-label mt-3">Note (max 1000 chars)</label>
              <textarea
                className="settings-input"
                rows={3}
                placeholder="Internal note..."
                value={editNote}
                maxLength={1000}
                onChange={e => setEditNote(e.target.value)}
              />

              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: 10 }}
                onClick={handleSaveAnnotation}
                disabled={saving}
              >
                {saving ? <><Loader2 size={13} className="spin" /> Saving on-chain...</> 
                  : saved ? '✓ Saved!'
                  : <><Save size={13} /> Save to blockchain</>}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}