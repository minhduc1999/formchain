import { useCallback, useState } from 'react';
import {
  useCurrentAccount,
  useSuiClient,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import { useAppStore } from '../store';
import type { FormConfig, FormField, FormResponse, TxStatus, UploadStatus } from '../types';
import { walrusDownloadJSON } from '../lib/walrus';
import {
  buildCreateFormTx,
  buildPublishFormTx,
  buildSubmitResponseTx,
  buildAnnotateResponseTx,
  buildDeleteFormTx,
  buildSetPausedTx,
  parseCreateFormResult,
  fetchOwnerFormEvents,
  fetchFormObject,
  fetchAllOwnerCaps,
  priorityToString,
  priorityToNumber,
  type OnChainFormFields,
} from '../lib/contract';
import { sealEncryptResponse } from '../lib/seal';
import { WALRUS_EPOCHS_CONFIG, WALRUS_EPOCHS_RESPONSE, WALRUS_EPOCHS_FILE } from '../lib/constants';
import { createWalrusClient } from '../lib/walrus';
import { WalrusFile } from '@mysten/walrus';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateFormInput {
  title: string;
  description: string;
  fields: FormField[];
  sealEncrypted: boolean;
  coverImage?: string;
  coverFile?: File;
}

type SignAndExecuteFn = ReturnType<typeof useSignAndExecuteTransaction>['mutateAsync'];

function toArrayBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return new Uint8Array(copy) as Uint8Array<ArrayBuffer>;
}

async function uploadViaFlow(
  data: Uint8Array<ArrayBuffer>,
  opts: { epochs: number; deletable: boolean },
  ownerAddress: string,
  signAndExecute: SignAndExecuteFn,
  contentType = 'application/json',
  filename = 'data.json',
): Promise<string> {
  const client = createWalrusClient();

  const flow = client.walrus.writeFilesFlow({
    files: [
      WalrusFile.from({
        contents: data,
        identifier: filename,
        tags: { 'content-type': contentType },
      }),
    ],
  });

  await flow.encode();

  const registerTx = flow.register({
    epochs: opts.epochs,
    deletable: opts.deletable,
    owner: ownerAddress,
  });

  const registerResult = await signAndExecute({ transaction: registerTx });
  const digest = (registerResult as { digest: string }).digest;

  await flow.upload({ digest });

  const certifyTx = flow.certify();
  await signAndExecute({ transaction: certifyTx });

  const uploadedFiles = await flow.listFiles();
  return uploadedFiles[0].blobId;
}

function decodeVecU8Field(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return new TextDecoder().decode(new Uint8Array(val as number[]));
  if (val instanceof Uint8Array) return new TextDecoder().decode(val);
  return String(val ?? '');
}

export function useFormChain() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();

  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { addForm, updateForm, deleteForm, addResponse, updateResponse, setForms, setResponses } =
    useAppStore();

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [txStatus, setTxStatus] = useState<TxStatus>({ status: 'idle' });

  const createAndPublishForm = useCallback(
    async (input: CreateFormInput): Promise<FormConfig | null> => {
      if (!account) throw new Error('Wallet not connected');

      try {
        setUploadStatus('uploading');
        setTxStatus({ status: 'idle' });

        // 1. Upload cover image nếu có
        // Dùng writeBlobFlow (raw blob) — aggregator HTTP chỉ serve được raw blob,
        // không đọc được quilt format của writeFilesFlow.
        let coverBlobId: string | undefined;
        if (input.coverFile) {
          const buffer = await input.coverFile.arrayBuffer();
          const imageData = toArrayBuffer(new Uint8Array(buffer));
          const mimeType = input.coverFile.type || 'image/jpeg';
          const client = createWalrusClient();
          const flow = client.walrus.writeBlobFlow({ blob: imageData });
          await flow.encode();
          const registerTx = flow.register({
            epochs: WALRUS_EPOCHS_FILE,
            deletable: true,
            owner: account.address,
            attributes: { 'content-type': mimeType },
          });
          const registerResult = await signAndExecute({ transaction: registerTx });
          const digest = (registerResult as { digest: string }).digest;
          await flow.upload({ digest });
          const certifyTx = flow.certify();
          await signAndExecute({ transaction: certifyTx });
          const certified = await flow.getBlob();
          coverBlobId = certified.blobId;
        }

        // 2. Build config object
        const configPayload = {
          title: input.title,
          description: input.description,
          fields: input.fields,
          sealEncrypted: input.sealEncrypted,
          coverBlobId,
          createdAt: new Date().toISOString(),
          version: 1,
        };

        // 3. Upload config lên Walrus
        const configBytes = toArrayBuffer(new TextEncoder().encode(JSON.stringify(configPayload)));
        const configBlobId = await uploadViaFlow(
          configBytes,
          { epochs: WALRUS_EPOCHS_CONFIG, deletable: true },
          account.address,
          signAndExecute,
        );

        setUploadStatus('signing');

        // 4. Gọi create_form on-chain
        const createTx = buildCreateFormTx({
          configBlobId,
          title: input.title,
          description: input.description,
          sealEncrypted: input.sealEncrypted,
          sealPolicyId: undefined,
        });

        setTxStatus({ status: 'pending' });

        // signAndExecute không trả effects theo mặc định.
        // Dùng waitForTransaction để fetch effects sau khi tx confirmed.
        const createResult = await signAndExecute({ transaction: createTx });
        const createTxData = await suiClient.waitForTransaction({
          digest: createResult.digest,
          options: { showEffects: true },
        });

        const parsed = parseCreateFormResult(
          createTxData.effects as {
            created?: Array<{
              reference: { objectId: string };
              owner: string | { AddressOwner: string } | { Shared: unknown };
            }>;
          },
        );
        if (!parsed) throw new Error('Failed to parse form creation result');

        const { formObjectId, capId } = parsed;

        // 5. Publish form (2nd tx)
        const publishTx = buildPublishFormTx(capId, formObjectId);
        const publishResult = await signAndExecute({ transaction: publishTx });

        setTxStatus({ status: 'success', digest: publishResult.digest });
        setUploadStatus('done');

        // 6. Build FormConfig để lưu local
        const formConfig: FormConfig = {
          id: formObjectId,
          title: input.title,
          description: input.description,
          coverBlobId,
          fields: input.fields,
          sealEncrypted: input.sealEncrypted,
          createdAt: new Date().toISOString(),
          published: true,
          responseCount: 0,
          onChain: {
            objectId: formObjectId,
            capId,
            configBlobId,
          },
        };

        addForm(formConfig);
        return formConfig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTxStatus({ status: 'error', error: msg });
        setUploadStatus('error');
        throw err;
      }
    },
    [account, suiClient, signAndExecute, addForm],
  );

  const submitResponse = useCallback(
    async (
      form: FormConfig,
      answers: Record<string, unknown>,
      fileUploads: Record<string, File>,
    ): Promise<FormResponse | null> => {
      if (!account) throw new Error('Wallet not connected');
      if (!form.onChain?.objectId) throw new Error('Form not published on-chain');

      try {
        setUploadStatus('uploading');
        setTxStatus({ status: 'idle' });

        // 1. Upload files (ảnh, video → blob_id)
        const fileBlobs: Record<string, string> = {};
        for (const [fieldId, file] of Object.entries(fileUploads)) {
          const buffer = await file.arrayBuffer();
          fileBlobs[fieldId] = await uploadViaFlow(
            toArrayBuffer(new Uint8Array(buffer)),
            { epochs: WALRUS_EPOCHS_FILE, deletable: false },
            account.address,
            signAndExecute,
          );
        }

        // 2. Ghép answers + fileBlobs
        const responseIndex = form.responseCount ?? 0;
        const mergedAnswers: Record<string, unknown> = { ...answers, ...fileBlobs };

        // 3. Encrypt từng field có sealEncrypted = true (per-field Seal)
        const sealedFieldIds = (form.fields ?? [])
          .filter(f => f.sealEncrypted)
          .map(f => f.id);

        // Cũng encrypt toàn bộ nếu form.sealEncrypted = true
        const hasPerFieldSeal = sealedFieldIds.length > 0;
        const hasFormLevelSeal = form.sealEncrypted && !hasPerFieldSeal;

        if (hasPerFieldSeal) {
          setUploadStatus('encrypting');
          for (const fieldId of sealedFieldIds) {
            if (mergedAnswers[fieldId] == null) continue;
            try {
              const fieldBytes = toArrayBuffer(
                new TextEncoder().encode(JSON.stringify(mergedAnswers[fieldId]))
              );
              const { encryptedBytes } = await sealEncryptResponse(
                form.onChain.objectId,
                responseIndex,
                fieldBytes,
              );
              // Lưu dạng marker để biết khi decrypt
              mergedAnswers[fieldId] = {
                __sealed: true,
                data: Array.from(encryptedBytes),
              };
            } catch (sealErr) {
              console.error(`Seal encrypt field ${fieldId} failed:`, sealErr);
              throw new Error(`Seal encryption failed for field "${fieldId}": ${sealErr instanceof Error ? sealErr.message : String(sealErr)}`);
            }
          }
        }

        const responsePayload = {
          formId: form.onChain.objectId,
          submitter: account.address,
          submittedAt: new Date().toISOString(),
          answers: mergedAnswers,
          sealedFields: sealedFieldIds, // danh sách field đã encrypt
          version: 1,
        };

        let uploadBytes: Uint8Array<ArrayBuffer> = toArrayBuffer(
          new TextEncoder().encode(JSON.stringify(responsePayload)),
        );

        if (hasFormLevelSeal) {
          setUploadStatus('encrypting');
          try {
            const { encryptedBytes } = await sealEncryptResponse(
              form.onChain.objectId,
              responseIndex,
              uploadBytes,
            );
            uploadBytes = toArrayBuffer(encryptedBytes);
          } catch (sealErr) {
            console.error('Seal encryption failed, aborting:', sealErr);
            throw new Error(
              `Seal encryption failed: ${sealErr instanceof Error ? sealErr.message : String(sealErr)}`,
            );
          }
        }

        // 4. Upload response lên Walrus
        const responseBlobId = await uploadViaFlow(
          uploadBytes,
          { epochs: WALRUS_EPOCHS_RESPONSE, deletable: false },
          account.address,
          signAndExecute,
        );

        setUploadStatus('signing');
        setTxStatus({ status: 'pending' });

        // 5. Submit on-chain
        const tx = buildSubmitResponseTx(form.onChain.objectId, responseBlobId);
        const result = await signAndExecute({ transaction: tx });

        setTxStatus({ status: 'success', digest: result.digest });
        setUploadStatus('done');

        // 6. Build response object cho local store
        const response: FormResponse = {
          id: `${form.id}-${responseIndex}`,
          formId: form.id,
          walletAddress: account.address,
          submittedAt: new Date().toISOString(),
          data: responsePayload.answers,
          blobId: responseBlobId,
          responseIndex,
        };

        addResponse(response);
        updateForm(form.id, { responseCount: responseIndex + 1 });
        return response;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTxStatus({ status: 'error', error: msg });
        setUploadStatus('error');
        throw err;
      }
    },
    [account, signAndExecute, addResponse, updateForm],
  );

  const syncFormsFromChain = useCallback(async () => {
    if (!account) return;

    try {
      const events = await fetchOwnerFormEvents(
        suiClient,
        account.address,
      );
      const caps = await fetchAllOwnerCaps(
        suiClient,
        account.address,
      );

      const forms: FormConfig[] = [];

      for (const event of events) {
        const onChainFields = await fetchFormObject(
          suiClient,
          event.formObjectId,
        );
        if (!onChainFields) continue;

        let configPayload: Partial<FormConfig> = {};
        try {
          configPayload = await walrusDownloadJSON<Partial<FormConfig>>(event.configBlobId);
        } catch {
          console.warn(`Failed to fetch config for ${event.formObjectId}`);
        }

        const formConfig: FormConfig = {
          id: event.formObjectId,
          title: onChainFields.title,
          description: onChainFields.description,
          fields: configPayload.fields ?? [],
          sealEncrypted: onChainFields.seal_encrypted,
          createdAt: new Date(Number(onChainFields.created_at)).toISOString(),
          published: onChainFields.published,
          responseCount: Number(onChainFields.response_count),
          coverBlobId: configPayload.coverBlobId,
          onChain: {
            objectId: event.formObjectId,
            capId: caps[event.formObjectId] ?? '',
            configBlobId: event.configBlobId,
          },
        };

        forms.push(formConfig);
      }

      setForms(forms);
    } catch (err) {
      console.error('Sync from chain failed:', err);
    }
  }, [account, suiClient, setForms]);

  const fetchResponsesForForm = useCallback(
    async (form: FormConfig): Promise<void> => {
      if (!form.onChain?.objectId) return;

      try {
        // Bước 1: Lấy form object để tìm Table ID của responses
        const formObj = await suiClient.getObject({
          id: form.onChain.objectId,
          options: { showContent: true },
        });

        if (!formObj.data?.content || formObj.data.content.dataType !== 'moveObject') return;
        const formFields = (formObj.data.content as { fields: Record<string, unknown> }).fields;

        const responsesTable = formFields.responses as {
          type?: string;
          fields?: { id?: { id?: string }; size?: string };
        } | null;

        const tableId = responsesTable?.fields?.id?.id;
        if (!tableId) {
          console.warn('[fetchResponsesForForm] No table ID found in responses field');
          setResponses(form.id, []);
          return;
        }

        // Bước 2: getDynamicFields từ Table ID
        const dynamicFields = await suiClient.getDynamicFields({
          parentId: tableId,
        });

        const responses: FormResponse[] = [];

        for (const field of dynamicFields.data) {
          try {
            const obj = await suiClient.getDynamicFieldObject({
              parentId: tableId,
              name: field.name,
            });

            if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') continue;

            const fields = (obj.data.content as { fields: Record<string, unknown> }).fields;
            const valueFields = (fields.value as { fields?: Record<string, unknown> })?.fields ?? fields;

            const idx = Number(valueFields.index ?? valueFields.key ?? fields.name ?? 0);
            const blobId = decodeVecU8Field(valueFields.blob_id ?? valueFields.value ?? '');
            const submitter = decodeVecU8Field(valueFields.submitter ?? '');
            const submittedAt = (valueFields.submitted_at ?? valueFields.timestamp ?? Date.now().toString()) as string;
            const priority = Number(valueFields.priority ?? 0);
            const note = decodeVecU8Field(valueFields.note ?? '');

            const priorityStr = priorityToString(priority);

            responses.push({
              id: `${form.id}-${idx}`,
              formId: form.id,
              walletAddress: submitter,
              submittedAt: new Date(Number(submittedAt)).toISOString(),
              data: {},
              blobId: blobId || undefined,
              responseIndex: idx,
              priority: priorityStr === 'none' ? undefined : priorityStr,
              note: note || undefined,
            });
          } catch (e) {
            console.warn('[fetchResponsesForForm] skipping field:', field, e);
          }
        }

        // Bước 3: Fetch Walrus blob để lấy star_rating → rating
        const withRating = await Promise.all(
          responses.map(async r => {
            if (!r.blobId) return r;
            try {
              const blob = await walrusDownloadJSON<{ answers: Record<string, unknown> }>(r.blobId);
              const answers = blob.answers ?? {};
              const ratingVal = Object.values(answers).find(
                v => typeof v === 'number' && v >= 1 && v <= 5
              );
              if (ratingVal != null) return { ...r, rating: ratingVal as number };
            } catch { /* bỏ qua nếu fetch lỗi */ }
            return r;
          })
        );

        setResponses(form.id, withRating);
      } catch (err) {
        console.error('fetchResponsesForForm failed:', err);
      }
    },
    [suiClient, setResponses],
  );

  const annotateResponse = useCallback(
    async (
      form: FormConfig,
      responseIndex: number,
      priority: 'high' | 'medium' | 'low' | undefined,
      note: string,
    ) => {
      if (!account || !form.onChain?.objectId || !form.onChain?.capId) return;

      setTxStatus({ status: 'pending' });
      try {
        const tx = buildAnnotateResponseTx(
          form.onChain.capId,
          form.onChain.objectId,
          responseIndex,
          priorityToNumber(priority),
          note,
        );
        const result = await signAndExecute({ transaction: tx });
        setTxStatus({ status: 'success', digest: result.digest });

        const responseId = `${form.id}-${responseIndex}`;
        updateResponse(responseId, { priority, note });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTxStatus({ status: 'error', error: msg });
      }
    },
    [account, signAndExecute, updateResponse],
  );

  const deleteFormOnChain = useCallback(
    async (form: FormConfig) => {
      if (!account || !form.onChain?.objectId) return;

      setTxStatus({ status: 'pending' });
      try {
        let capId = form.onChain.capId;
        if (!capId) {
          const { fetchOwnerCap } = await import('../lib/contract');
          capId = await fetchOwnerCap(
            suiClient,
            account.address,
            form.onChain.objectId,
          ) ?? '';
        }

        if (!capId) {
          setTxStatus({ status: 'error', error: 'Không tìm thấy quyền sở hữu form này.' });
          return;
        }

        const tx = buildDeleteFormTx(capId, form.onChain.objectId);
        const result = await signAndExecute({ transaction: tx });
        setTxStatus({ status: 'success', digest: result.digest });
        deleteForm(form.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTxStatus({ status: 'error', error: msg });
      }
    },
    [account, suiClient, signAndExecute, deleteForm],
  );

  const setPausedOnChain = useCallback(
    async (form: FormConfig, paused: boolean) => {
      if (!account || !form.onChain?.objectId || !form.onChain?.capId) return;

      setTxStatus({ status: 'pending' });
      try {
        const tx = buildSetPausedTx(form.onChain.capId, form.onChain.objectId, paused);
        const result = await signAndExecute({ transaction: tx });
        setTxStatus({ status: 'success', digest: result.digest });
        updateForm(form.id, { published: !paused });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTxStatus({ status: 'error', error: msg });
      }
    },
    [account, signAndExecute, updateForm],
  );

  return {
    createAndPublishForm,
    submitResponse,
    syncFormsFromChain,
    fetchResponsesForForm,
    annotateResponse,
    deleteFormOnChain,
    setPausedOnChain,
    uploadStatus,
    txStatus,
    resetStatus: () => {
      setUploadStatus('idle');
      setTxStatus({ status: 'idle' });
    },
  };
}
