import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Plus, Trash2, GripVertical, Image as ImageIcon,
  X, Upload, Star, AlignLeft, AlignJustify,
  ChevronDown, CheckSquare, Link as LinkIcon, Video,
  Lock, Eye, EyeOff, Copy, Check, ArrowLeft, Wallet,
  Loader2, ExternalLink, AlertCircle,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useFormChain } from '../hooks/useFormChain';
import { FieldType, FormField } from '../types';

const FIELD_TYPES: { type: FieldType; label: string; icon: React.ReactNode }[] = [
  { type: 'short_text',   label: 'Short text',      icon: <AlignLeft size={15} /> },
  { type: 'long_text',    label: 'Long text',        icon: <AlignJustify size={15} /> },
  { type: 'dropdown',     label: 'Dropdown',         icon: <ChevronDown size={15} /> },
  { type: 'checkbox',     label: 'Checkbox',         icon: <CheckSquare size={15} /> },
  { type: 'star_rating',  label: 'Star rating',      icon: <Star size={15} /> },
  { type: 'image_upload', label: 'Screenshot',       icon: <ImageIcon size={15} /> },
  { type: 'video_upload', label: 'Video upload',     icon: <Video size={15} /> },
  { type: 'url',          label: 'URL',              icon: <LinkIcon size={15} /> },
];

function newField(type: FieldType): FormField {
  return {
    id: uuidv4(), type,
    label: FIELD_TYPES.find((t) => t.type === type)?.label ?? 'New field',
    placeholder: '', required: false,
    options: ['dropdown', 'checkbox'].includes(type)
      ? [{ id: uuidv4(), label: 'Option 1' }] : undefined,
  };
}

/* ── Upload step indicator ──────────────────────────────────────────────────── */
function UploadSteps({ status }: { status: string }) {
  const steps = [
    { key: 'uploading',  label: 'Uploading config to Walrus' },
    { key: 'signing',    label: 'Signing Sui transaction' },
    { key: 'done',       label: 'Done!' },
  ];
  return (
    <div className="upload-steps">
      {steps.map((s, i) => {
        const active = s.key === status;
        const done = status === 'done' && i < steps.length;
        return (
          <div key={s.key} className={`upload-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
            <div className="step-dot">
              {active ? <Loader2 size={12} className="spin" /> : done ? '✓' : i + 1}
            </div>
            <span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Preview field renderer ─────────────────────────────────────────────────── */
function PreviewField({ field }: { field: FormField }) {
  const [value, setValue] = useState<string | string[]>('');
  const [star, setStar] = useState(0);
  const [hover, setHover] = useState(0);
  return (
    <div className="survey-field">
      <label className="survey-label">
        {field.label}
        {field.required && <span className="required-star"> * Required</span>}
      </label>
      {field.type === 'short_text' && (
        <input className="survey-input" placeholder={field.placeholder || 'Enter text...'} value={value as string} onChange={e => setValue(e.target.value)} />
      )}
      {field.type === 'long_text' && (
        <textarea className="survey-input survey-textarea" placeholder={field.placeholder || 'Enter long text...'} rows={3} value={value as string} onChange={e => setValue(e.target.value)} />
      )}
      {field.type === 'dropdown' && (
        <select className="survey-input" value={value as string} onChange={e => setValue(e.target.value)}>
          <option value="">{field.placeholder || 'Select an option...'}</option>
          {field.options?.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
      {field.type === 'checkbox' && (
        <div className="checkbox-group">
          {field.options?.map(o => (
            <label key={o.id} className="checkbox-label">
              <input type="checkbox" className="checkbox-input"
                checked={(value as string[])?.includes(o.id) ?? false}
                onChange={e => {
                  const arr = (value as string[]) ?? [];
                  setValue(e.target.checked ? [...arr, o.id] : arr.filter(x => x !== o.id));
                }} />
              {o.label}
            </label>
          ))}
        </div>
      )}
      {field.type === 'star_rating' && (
        <div className="star-row-interactive">
          {[1,2,3,4,5].map(s => (
            <button key={s} className={`star-btn ${s <= (hover||star) ? 'active' : ''}`}
              onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
              onClick={() => setStar(s)}>★</button>
          ))}
        </div>
      )}
      {field.type === 'image_upload' && (
        <div className="upload-zone">
          <Upload size={16} /><p>Drag & drop or click to select image</p>
          <p className="upload-hint">PNG, JPG, WEBP · max 10MB · stored on Walrus</p>
        </div>
      )}
      {field.type === 'video_upload' && (
        <div className="upload-zone">
          <Video size={16} /><p>Upload video</p>
          <p className="upload-hint">MP4 · stored on Walrus</p>
        </div>
      )}
      {field.type === 'url' && (
        <input className="survey-input" placeholder={field.placeholder || 'https://'} value={value as string} onChange={e => setValue(e.target.value)} />
      )}
    </div>
  );
}

/* ── Published modal ────────────────────────────────────────────────────────── */
function PublishedModal({
  formId,
  txDigest,
  onClose,
}: {
  formId: string;
  txDigest?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/survey/${formId}`;
  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-success-icon">🎉</div>
        <h2 className="modal-title">Form created!</h2>
        <p className="modal-desc">
          Config saved on Walrus · Metadata written to Sui mainnet
        </p>
        {txDigest && (
          <a
            href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
            target="_blank"
            rel="noreferrer"
            className="tx-link"
          >
            <ExternalLink size={12} />
            View transaction on SuiScan
          </a>
        )}
        <div className="modal-link-row">
          <code className="modal-link">{link}</code>
          <button className="btn btn-ghost btn-icon" onClick={copy}>
            {copied ? <Check size={14} className="copied-icon" /> : <Copy size={14} />}
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={copy}>
            {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy link</>}
          </button>
          <a href={`/survey/${formId}`} target="_blank" rel="noreferrer" className="btn btn-outline">
            Preview form
          </a>
          <button className="btn btn-ghost" onClick={onClose}>
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main FormBuilder ─────────────────────────────────────────────────────────── */
export default function FormBuilder() {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const { createAndPublishForm, uploadStatus, txStatus, resetStatus } = useFormChain();

  const [title, setTitle]         = useState('Untitled Form');
  const [description, setDesc]    = useState('');
  const [fields, setFields]       = useState<FormField[]>([]);
  const [sealEncrypted, setSeal]  = useState(false);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | undefined>();
  const [coverPreview, setCoverPreview] = useState<string | undefined>();
  const [showPreview, setShowPreview] = useState(false);
  const [publishedFormId, setPublishedFormId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  const selectedField = fields.find(f => f.id === selectedId) ?? null;

  function addField(type: FieldType) {
    const f = newField(type);
    setFields(prev => [...prev, f]);
    setSelected(f.id);
  }
  function updateField(id: string, updates: Partial<FormField>) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }
  function removeField(id: string) {
    setFields(prev => prev.filter(f => f.id !== id));
    if (selectedId === id) setSelected(null);
  }
  function addOption(fieldId: string) {
    setFields(prev => prev.map(f =>
      f.id === fieldId
        ? { ...f, options: [...(f.options ?? []), { id: uuidv4(), label: `Option ${(f.options?.length ?? 0) + 1}` }] }
        : f
    ));
  }
  function updateOption(fieldId: string, optId: string, label: string) {
    setFields(prev => prev.map(f =>
      f.id === fieldId
        ? { ...f, options: f.options?.map(o => o.id === optId ? { ...o, label } : o) }
        : f
    ));
  }
  function removeOption(fieldId: string, optId: string) {
    setFields(prev => prev.map(f =>
      f.id === fieldId ? { ...f, options: f.options?.filter(o => o.id !== optId) } : f
    ));
  }
  function handleCoverImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
    }
  }

  async function handlePublish() {
    if (!account || isPublishing || fields.length === 0) return;
    setIsPublishing(true);
    try {
      const form = await createAndPublishForm({
        title,
        description,
        fields,
        sealEncrypted,
        coverFile,
      });
      if (form) setPublishedFormId(form.id);
    } catch (err) {
      console.error('Publish failed:', err);
    } finally {
      setIsPublishing(false);
    }
  }

  const isWorking = isPublishing || uploadStatus === 'uploading' || uploadStatus === 'signing';

  return (
    <>
      {publishedFormId && (
        <PublishedModal
          formId={publishedFormId}
          txDigest={txStatus.digest}
          onClose={() => { resetStatus(); navigate('/dashboard'); }}
        />
      )}

      <div className="builder-layout">
        {/* Left: field types */}
        <aside className="builder-sidebar">
          <div className="builder-back">
            <Link to="/" className="btn btn-ghost btn-icon"><ArrowLeft size={15} /></Link>
            <span className="sidebar-label" style={{ margin: 0 }}>Field types</span>
          </div>
          <ul className="field-type-list" style={{ marginTop: 12 }}>
            {FIELD_TYPES.map(ft => (
              <li key={ft.type}>
                <button className="field-type-btn" onClick={() => addField(ft.type)} disabled={isWorking}>
                  {ft.icon}{ft.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="divider" />

          <button
            className={`btn btn-ghost btn-block preview-toggle-btn ${showPreview ? 'active' : ''}`}
            onClick={() => setShowPreview(v => !v)}
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPreview ? 'Hide preview' : 'Preview'}
          </button>
        </aside>

        {/* Center: canvas + preview */}
        <div className="builder-center">
          <div className={`builder-canvas ${showPreview ? 'split-left' : ''}`}>
            <div className="canvas-label">✏️ Edit</div>

            {/* Cover */}
            <div className="canvas-cover" onClick={() => coverRef.current?.click()}>
              {coverPreview ? (
                <div className="cover-img-wrap">
                  <img src={coverPreview} alt="Cover" className="cover-img" />
                  <button className="cover-remove" onClick={e => {
                    e.stopPropagation();
                    setCoverFile(undefined);
                    setCoverPreview(undefined);
                  }}><X size={14} /></button>
                </div>
              ) : (
                <div className="cover-placeholder"><ImageIcon size={20} /><span>Add cover image</span></div>
              )}
              <input ref={coverRef} type="file" accept="image/*" hidden onChange={handleCoverImage} />
            </div>

            <div className="canvas-header-card">
              <input className="title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Form title..." />
              <textarea className="desc-input" value={description} onChange={e => setDesc(e.target.value)} placeholder="Form description (optional)..." rows={2} />
            </div>

            {fields.map(field => (
              <div
                key={field.id}
                className={`field-card ${selectedId === field.id ? 'selected' : ''}`}
                onClick={() => setSelected(field.id)}
              >
                <div className="field-card-top">
                  <GripVertical size={16} className="drag-handle" />
                  <span className="field-label-preview">{field.label}</span>
                  {field.required && <span className="required-badge">* Required</span>}
                  {field.sealEncrypted && <span className="required-badge" style={{ background: 'var(--purple)', color: '#fff' }}>🔒 Sealed</span>}
                  <div className="field-card-actions">
                    <button className="icon-btn danger" onClick={e => { e.stopPropagation(); removeField(field.id); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="field-preview">
                  {field.type === 'short_text' && <input className="preview-input" placeholder={field.placeholder || 'Enter text...'} readOnly />}
                  {field.type === 'long_text' && <textarea className="preview-input" placeholder={field.placeholder || 'Enter long text...'} rows={3} readOnly />}
                  {field.type === 'dropdown' && (
                    <select className="preview-input">
                      <option>{field.placeholder || 'Select...'}</option>
                      {field.options?.map(o => <option key={o.id}>{o.label}</option>)}
                    </select>
                  )}
                  {field.type === 'checkbox' && field.options?.map(o => (
                    <label key={o.id} className="checkbox-row"><input type="checkbox" readOnly /> {o.label}</label>
                  ))}
                  {field.type === 'star_rating' && <div className="star-row">{[1,2,3,4,5].map(s => <span key={s} className="star-empty">★</span>)}</div>}
                  {(field.type === 'image_upload' || field.type === 'video_upload') && (
                    <div className="upload-box"><Upload size={15} /><span>Upload file</span></div>
                  )}
                  {field.type === 'url' && <input className="preview-input" placeholder={field.placeholder || 'https://'} readOnly />}
                </div>
              </div>
            ))}

            <button className="add-field-btn" onClick={() => addField('short_text')} disabled={isWorking}>
              <Plus size={16} /> Add new field
            </button>
          </div>

          {/* Preview panel */}
          {showPreview && (
            <div className="preview-split-panel">
              <div className="canvas-label preview-label">👁 Preview</div>
              <div className="survey-card preview-card">
                {coverPreview && <img src={coverPreview} alt="Cover" className="survey-cover" />}
                <div className="survey-header">
                  <h1 className="survey-title">{title || 'Untitled Form'}</h1>
                  {description && <p className="survey-desc">{description}</p>}
                  {sealEncrypted && (
                    <div className="seal-notice"><Lock size={12} /> Data encrypted with Seal</div>
                  )}
                </div>
                {fields.map(field => <PreviewField key={field.id} field={field} />)}
                <div className="survey-submit-area">
                  <button className="btn btn-primary btn-block" disabled style={{ opacity: 0.6 }}>
                    <Wallet size={14} /> Connect wallet to submit (preview)
                  </button>
                </div>
                <p className="survey-bottom-note">Data stored on Walrus · Encrypted by Seal</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: settings + publish */}
        <aside className="builder-settings">
          {selectedField ? (
            <>
              <p className="sidebar-label">Field settings</p>
              <label className="settings-label">Label</label>
              <input className="settings-input" value={selectedField.label}
                onChange={e => updateField(selectedField.id, { label: e.target.value })} />
              <label className="settings-label mt-3">Placeholder</label>
              <input className="settings-input" value={selectedField.placeholder ?? ''}
                onChange={e => updateField(selectedField.id, { placeholder: e.target.value })} />

              {(selectedField.type === 'dropdown' || selectedField.type === 'checkbox') && (
                <>
                  <label className="settings-label mt-3">Options</label>
                  {selectedField.options?.map(opt => (
                    <div key={opt.id} className="option-row">
                      <input className="settings-input" value={opt.label}
                        onChange={e => updateOption(selectedField.id, opt.id, e.target.value)} />
                      <button className="icon-btn" onClick={() => removeOption(selectedField.id, opt.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <button className="add-option-btn" onClick={() => addOption(selectedField.id)}>
                    + Add option
                  </button>
                </>
              )}

              <div className="toggle-row mt-3">
                <label className="settings-label">Required</label>
                <input type="checkbox" checked={selectedField.required}
                  onChange={e => updateField(selectedField.id, { required: e.target.checked })} />
              </div>

              <div className="toggle-row mt-3">
                <div>
                  <p className="settings-label">🔒 Seal Encrypt field</p>
                  <p className="hint-text">Only form creator can read this field</p>
                </div>
                <input type="checkbox" checked={selectedField.sealEncrypted ?? false}
                  onChange={e => updateField(selectedField.id, { sealEncrypted: e.target.checked })} />
              </div>
              {selectedField.sealEncrypted && (
                <div className="seal-badge" style={{ marginTop: 6 }}><Lock size={11} /> This field is encrypted</div>
              )}
            </>
          ) : (
            <p className="hint-text" style={{ marginTop: 0 }}>Click a field to edit</p>
          )}

          <div className="divider" />

          <p className="sidebar-label">Form settings</p>
          <div className="toggle-row">
            <div>
              <p className="settings-label">Seal Encryption</p>
              <p className="hint-text">Only you and the submitter can read it</p>
            </div>
            <input type="checkbox" checked={sealEncrypted} onChange={e => setSeal(e.target.checked)} />
          </div>
          {sealEncrypted && (
            <div className="seal-badge"><Lock size={11} /> Seal on — data encrypted</div>
          )}

          <div className="divider" />

          {/* Status */}
          {isWorking && <UploadSteps status={uploadStatus} />}

          {txStatus.status === 'error' && (
            <div className="error-banner">
              <AlertCircle size={14} />
              <span>{txStatus.error}</span>
            </div>
          )}

          {/* Wallet state */}
          {!account ? (
            <div className="builder-wallet-notice">
              <Wallet size={13} />
              <span>Connect your Sui wallet above to publish</span>
            </div>
          ) : (
            <div className="builder-wallet-ok">
              <Check size={13} />
              <span className="mono" style={{ fontSize: 11 }}>
                {account.address.slice(0, 6)}...{account.address.slice(-4)}
              </span>
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            onClick={handlePublish}
            style={{ marginTop: 12 }}
            disabled={!account || fields.length === 0 || isWorking}
          >
            {isWorking ? (
              <><Loader2 size={14} className="spin" />
                {uploadStatus === 'uploading' ? 'Uploading to Walrus...' :
                 uploadStatus === 'signing'   ? 'Signing Sui tx...' : 'Processing...'}
              </>
            ) : (
              'Create & Publish form'
            )}
          </button>

          <Link to="/" className="btn btn-ghost btn-block mt-2 text-center">Cancel</Link>

          {fields.length === 0 && (
            <p className="hint-text" style={{ textAlign: 'center', marginTop: 8 }}>
              Add at least 1 field to create a form
            </p>
          )}
        </aside>
      </div>
    </>
  );
}