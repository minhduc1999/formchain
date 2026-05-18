import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Wallet, Send, Lock, CheckCircle, LogIn,
  Loader2, ExternalLink, AlertCircle, Upload, Video,
} from 'lucide-react';
import {
  useCurrentAccount,
  useConnectWallet,
  useWallets,
  useDisconnectWallet,
  useSuiClient,
} from '@mysten/dapp-kit';
import { useAppStore } from '../store';
import { useFormChain } from '../hooks/useFormChain';
import { walrusDownloadJSON, walrusBlobUrl } from '../lib/walrus';
import { fetchFormObject, checkWalletSubmitted } from '../lib/contract';
import type { FormConfig, FormField } from '../types';

/* ── Individual field ─────────────────────────────────────────────────────────── */
function SurveyField({
  field,
  value,
  onChange,
  onFileChange,
  error,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  onFileChange?: (file: File) => void;
  error?: boolean;
}) {
  const [star, setStar] = useState(0);
  const [hover, setHover] = useState(0);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  return (
    <div className={`survey-field ${error ? 'has-error' : ''}`}>
      <label className="survey-label">
        {field.label}
        {field.required && <span className="required-star"> *</span>}
      </label>

      {field.type === 'short_text' && (
        <input
          className={`survey-input ${error ? 'input-error' : ''}`}
          placeholder={field.placeholder || 'Enter your answer...'}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      )}

      {field.type === 'long_text' && (
        <textarea
          className={`survey-input survey-textarea ${error ? 'input-error' : ''}`}
          placeholder={field.placeholder || 'Enter your answer...'}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          rows={4}
        />
      )}

      {field.type === 'dropdown' && (
        <select
          className={`survey-input ${error ? 'input-error' : ''}`}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">{field.placeholder || 'Select an option...'}</option>
          {field.options?.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )}

      {field.type === 'checkbox' && (
        <div className="checkbox-group">
          {field.options?.map(o => (
            <label key={o.id} className="checkbox-label">
              <input
                type="checkbox"
                className="checkbox-input"
                checked={((value as string[]) ?? []).includes(o.id)}
                onChange={e => {
                  const arr = (value as string[]) ?? [];
                  onChange(e.target.checked ? [...arr, o.id] : arr.filter(x => x !== o.id));
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}

      {field.type === 'star_rating' && (
        <div>
          <div className="star-row-interactive">
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                className={`star-btn ${s <= (hover || star) ? 'active' : ''}`}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(0)}
                onClick={() => { setStar(s); onChange(s); }}
              >★</button>
            ))}
          </div>
          {star > 0 && <p className="star-count">{star} / 5 stars</p>}
        </div>
      )}

      {field.type === 'image_upload' && (
        <div
          className="upload-zone"
          onClick={() => document.getElementById(`file-${field.id}`)?.click()}
        >
          {uploading ? (
            <><Loader2 size={16} className="spin" /><p>Uploading to Walrus...</p></>
          ) : fileName ? (
            <><Upload size={16} style={{ color: 'var(--green)' }} /><p style={{ color: 'var(--green)' }}>✓ {fileName} (saved to Walrus)</p></>
          ) : (
            <><Upload size={16} /><p>📎 Click to select image</p><p className="upload-hint">PNG, JPG, WEBP · max 10MB · stored on Walrus</p></>
          )}
          <input
            id={`file-${field.id}`}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f && onFileChange) {
                setFileName(f.name);
                onFileChange(f);
              }
            }}
          />
        </div>
      )}

      {field.type === 'video_upload' && (
        <div
          className="upload-zone"
          onClick={() => document.getElementById(`vid-${field.id}`)?.click()}
        >
          {uploading ? (
            <><Loader2 size={16} className="spin" /><p>Uploading to Walrus...</p></>
          ) : fileName ? (
            <><Video size={16} style={{ color: 'var(--green)' }} /><p style={{ color: 'var(--green)' }}>✓ {fileName} (saved to Walrus)</p></>
          ) : (
            <><Video size={16} /><p>🎬 Click to select video</p><p className="upload-hint">MP4 · stored on Walrus</p></>
          )}
          <input id={`vid-${field.id}`} type="file" accept="video/*" hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f && onFileChange) { setFileName(f.name); onFileChange(f); }
            }} />
        </div>
      )}

      {field.type === 'url' && (
        <input
          className={`survey-input ${error ? 'input-error' : ''}`}
          placeholder={field.placeholder || 'https://...'}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      )}

      {error && <p className="field-error">⚠ This field is required</p>}
    </div>
  );
}

/* ── Wallet banner ────────────────────────────────────────────────────────────── */
function WalletBanner() {
  const { mutate: connect } = useConnectWallet();
  const wallets = useWallets();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();

  if (account) {
    return (
      <div className="wallet-banner connected">
        <div className="wallet-banner-left">
          <span className="wallet-dot" />
          <span className="wallet-banner-addr">{account.address.slice(0, 8)}...{account.address.slice(-6)}</span>
          <span className="wallet-banner-label">connected</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="wallet-banner">
      <div className="wallet-banner-left">
        <Wallet size={14} />
        <span>Connect your Sui wallet to submit</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {wallets.length === 0 ? (
          <a href="https://chrome.google.com/webstore/detail/sui-wallet" target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
            Install Sui Wallet
          </a>
        ) : (
          wallets.map(w => (
            <button key={w.name} className="btn btn-primary btn-sm" onClick={() => connect({ wallet: w })}>
              {w.icon && <img src={w.icon} width={14} height={14} style={{ borderRadius: 3 }} alt="" />}
              {w.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Submitted card ───────────────────────────────────────────────────────────── */
function SubmittedCard({ blobId, sealEncrypted, txDigest, submittedAt }: {
  blobId: string;
  sealEncrypted: boolean;
  txDigest?: string;
  submittedAt?: string;
}) {
  return (
    <div className="survey-page">
      <div className="survey-card submitted-card">
        <CheckCircle size={52} className="submitted-icon" />
        <h2 className="submitted-title">Thank you!</h2>
        <p className="submitted-desc">
          Response saved on Walrus{sealEncrypted ? ' and encrypted by Seal' : ''}
          {' '}· Metadata written to Sui blockchain.
        </p>
        {submittedAt && (
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
            Submitted at {new Date(submittedAt).toLocaleString('en-US')}
          </p>
        )}
        {blobId && (
          <div className="blob-info">
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Walrus Blob ID</p>
            <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{blobId}</span>
          </div>
        )}
        {txDigest && (
          <a
            href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
            target="_blank"
            rel="noreferrer"
            className="tx-link"
            style={{ marginTop: 12 }}
          >
            <ExternalLink size={12} /> View tx on SuiScan
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Main SurveyPage ──────────────────────────────────────────────────────────── */
export default function SurveyPage() {
  const { id } = useParams<{ id: string }>();
  const { forms, responses } = useAppStore();
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { submitResponse, uploadStatus, txStatus } = useFormChain();

  const localForm = forms.find(f => f.id === id);

  const [form, setForm] = useState<FormConfig | null>(localForm ?? null);
  const [loading, setLoading] = useState(!localForm);
  const [fetchError, setFetchError] = useState('');

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submittedBlobId, setSubmittedBlobId] = useState('');
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const [checkingSubmitted, setCheckingSubmitted] = useState(false);

  useEffect(() => {
    setAnswers({});
    setFileUploads({});
    setErrors({});
    setSubmitted(false);
    setSubmittedBlobId('');

    if (!account || !id) return;

    setCheckingSubmitted(true);
    checkWalletSubmitted(suiClient, id, account.address)
      .then(result => {
        if (result) {
          setSubmittedBlobId(result.blobId);
          setSubmitted(true);
        }
      })
      .catch(err => console.warn('[SurveyPage] checkWalletSubmitted error:', err))
      .finally(() => setCheckingSubmitted(false));
  }, [account?.address]);

  useEffect(() => {
    if (localForm || !id) return;
    (async () => {
      setLoading(true);
      try {
        const onChainFields = await fetchFormObject(suiClient, id);
        if (!onChainFields) { setFetchError('Form does not exist on the blockchain.'); return; }

        let configPayload: Partial<FormConfig> = {};
        try {
          const configBlobId = onChainFields.config_blob_id;
          if (configBlobId) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                configPayload = await walrusDownloadJSON<Partial<FormConfig>>(configBlobId);
                if (configPayload.fields?.length) break;
              } catch (e) {
                console.warn(`[SurveyPage] Walrus fetch attempt ${attempt + 1} failed:`, e);
                if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
              }
            }
          }
        } catch (e) {
          console.warn('[SurveyPage] config fetch failed:', e);
        }

        const fetchedForm: FormConfig = {
          id,
          title: onChainFields.title,
          description: onChainFields.description,
          fields: configPayload.fields ?? [],
          sealEncrypted: onChainFields.seal_encrypted,
          coverBlobId: configPayload.coverBlobId,
          createdAt: new Date(Number(onChainFields.created_at)).toISOString(),
          published: onChainFields.published,
          responseCount: Number(onChainFields.response_count),
          onChain: {
            objectId: id,
            capId: '',
            configBlobId: onChainFields.config_blob_id,
          },
        };
        setForm(fetchedForm);
        if (fetchedForm.fields.length > 0) {
          useAppStore.getState().addForm(fetchedForm);
        }
      } catch (e) {
        setFetchError('Unable to load form. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, localForm, suiClient]);

  const filledCount = form?.fields.filter(f => {
    const v = answers[f.id];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== '';
  }).length ?? 0;
  const progress = form?.fields.length ? Math.round((filledCount / form.fields.length) * 100) : 0;

  function validate() {
    if (!form) return false;
    const errs: Record<string, boolean> = {};
    form.fields.forEach(f => {
      if (!f.required) return;
      const v = answers[f.id];
      if (Array.isArray(v) && v.length === 0) errs[f.id] = true;
      else if (!v) errs[f.id] = true;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!account || !form || !validate()) return;
    try {
      const response = await submitResponse(form, answers, fileUploads);
      if (response) {
        setSubmittedBlobId(response.blobId ?? '');
        setSubmitted(true);
      }
    } catch (err) {
      console.error('Submit failed:', err);
    }
  }

  const isSubmitting =
    uploadStatus === 'uploading' ||
    uploadStatus === 'encrypting' ||
    uploadStatus === 'signing';

  if (loading || checkingSubmitted) {
    return (
      <div className="survey-page">
        <div className="survey-card" style={{ textAlign: 'center', padding: 48 }}>
          <Loader2 size={32} className="spin" style={{ color: 'var(--green)' }} />
          <p style={{ marginTop: 16, color: 'var(--text-2)' }}>
            {checkingSubmitted ? 'Checking on-chain...' : 'Loading form from Walrus...'}
          </p>
        </div>
      </div>
    );
  }

  if (fetchError || !form) {
    return (
      <div className="empty-state">
        <AlertCircle size={32} style={{ color: 'var(--text-3)', marginBottom: 12 }} />
        <p style={{ marginBottom: 8 }}>{fetchError || 'Form not found.'}</p>
        <Link to="/" className="btn btn-primary">Back to home</Link>
      </div>
    );
  }

  if (!form.published) {
    return (
      <div className="empty-state">
        <p style={{ marginBottom: 8 }}>This form is not published yet.</p>
        <Link to="/" className="btn btn-ghost">Back to home</Link>
      </div>
    );
  }

  if (submitted) {
    const prevResp = id && account
      ? responses.find(r => r.formId === id && r.walletAddress === account.address)
      : undefined;
    return (
      <SubmittedCard
        blobId={submittedBlobId}
        sealEncrypted={form?.sealEncrypted ?? false}
        txDigest={txStatus.digest}
        submittedAt={prevResp?.submittedAt}
      />
    );
  }

  return (
    <div className="survey-page">
      <div className="survey-wallet-area">
        <WalletBanner />
      </div>

      {form.fields.length > 0 && (
        <>
          <div className="survey-progress-bar">
            <div className="survey-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="survey-progress-label">{filledCount}/{form.fields.length} questions answered</p>
        </>
      )}

      <div className="survey-card">
        {form.coverBlobId && (
          <img src={walrusBlobUrl(form.coverBlobId)} alt="Cover" className="survey-cover" />
        )}

        <div className="survey-header">
          <h1 className="survey-title">{form.title}</h1>
          {form.description && <p className="survey-desc">{form.description}</p>}
          {form.sealEncrypted && (
            <div className="seal-notice">
              <Lock size={12} />
              This form is encrypted with Seal — only you and the form creator can read it
            </div>
          )}
        </div>

        {form.fields.map(field => (
          <SurveyField
            key={field.id}
            field={field}
            value={answers[field.id]}
            error={errors[field.id]}
            onChange={v => {
              setAnswers(prev => ({ ...prev, [field.id]: v }));
              if (errors[field.id]) setErrors(prev => ({ ...prev, [field.id]: false }));
            }}
            onFileChange={file => setFileUploads(prev => ({ ...prev, [field.id]: file }))}
          />
        ))}

        {/* Submit area */}
        <div className="survey-submit-area">
          {txStatus.status === 'error' && (
            <div className="error-banner" style={{ marginBottom: 12 }}>
              <AlertCircle size={14} />
              <span>{txStatus.error}</span>
            </div>
          )}

          {!account ? (
            <div className="submit-wallet-notice">
              <LogIn size={16} />
              <span>Connect your Sui wallet above to submit the form</span>
            </div>
          ) : (
            <button
              className="btn btn-primary btn-block"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="spin" />
                  {uploadStatus === 'uploading'  ? 'Uploading to Walrus...' :
                   uploadStatus === 'encrypting' ? 'Encrypting with Seal...' :
                   'Signing Sui transaction...'}
                </>
              ) : (
                <><Send size={14} /> Submit form</>
              )}
            </button>
          )}
          {account && !isSubmitting && (
            <p className="survey-footer-note">
              Signed with Sui wallet · Data stored on Walrus{form.sealEncrypted ? ' · Seal encrypted' : ''}
            </p>
          )}
        </div>

        <p className="survey-bottom-note">
          Data stored on Walrus · {form.sealEncrypted ? 'Seal encrypted · ' : ''}Cannot be deleted
        </p>
      </div>
    </div>
  );
}
