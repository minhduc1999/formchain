# FormChain

> Decentralized form & feedback platform built on Sui + Walrus + Seal

FormChain lets anyone create custom forms, collect responses, and manage feedback — all stored immutably on [Walrus](https://walrus.xyz) and indexed on-chain via [Sui](https://sui.io), with end-to-end encryption powered by [Seal](https://github.com/MystenLabs/seal).

Built for **Walrus Sessions — Session 2** hackathon.

---

## Features

### Form builder
- 8 field types: short text, long text, dropdown, checkbox, star rating, image upload, video upload, URL
- Add / remove / configure fields with live preview
- Optional cover image (stored on Walrus)
- Toggle Seal encryption per form
- Publish / pause form at any time

### Respondent experience
- Public survey link — no wallet required to view
- Wallet connect required to submit (prevents duplicate submissions)
- On-chain duplicate check: one wallet = one response per form
- File uploads (screenshots, videos) go directly to Walrus

### Admin dashboard
- Private — only the form owner's wallet can access
- View all responses with read/unread tracking
- Auto-priority scoring based on star rating + keywords
- Add notes and manually set priority (High / Medium / Low)
- Filter by form, priority, status
- Export responses to CSV
- Decrypt Seal-encrypted responses with one click

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Blockchain | Sui Mainnet (Move smart contract) |
| Storage | Walrus Mainnet (`@mysten/walrus` SDK) |
| Encryption | Seal Protocol (`@mysten/seal`) |
| Wallet | `@mysten/dapp-kit` |
| State | Zustand |

---

## Architecture

```
User fills form
      │
      ▼
[Optional] File upload ──► Walrus (raw blob / writeBlobFlow)
      │
      ▼
Response JSON ──► [Optional] Seal encrypt ──► Walrus (writeFilesFlow)
      │
      ▼
Sui Move contract ── stores metadata + blobId on-chain
      │
      ▼
Admin dashboard reads on-chain index ── downloads + decrypts from Walrus
```

**Form config** (fields, title, description) is uploaded to Walrus as JSON, then the `blobId` is stored on-chain via `formchain::create_form`.

**Each response** is uploaded to Walrus (optionally Seal-encrypted), and the `blobId` is recorded on-chain via `formchain::submit_response`. The on-chain record stores submitter address, timestamp, priority, and admin notes.

---

## Smart contract

Deployed on **Sui Mainnet**:

| Object | ID |
|---|---|
| Package | `0xb0230f55f042d55838f312cb193ec67df1ed2a0fb2ce48a18183e7e67878103f` |
| Registry | `0xc7c1b0db4d7a7268197af81821ac0bbd3d2db2a756400507fc0a32666d4416fd` |

Key entry points:

```move
formchain::create_form(registry, config_blob_id, title, description, seal_encrypted, ...)
formchain::publish_form(cap, form)
formchain::submit_response(form, blob_id, submitter, ...)
formchain::annotate_response(cap, form, index, priority, note)
formchain::set_paused(cap, form, paused)
formchain_seal::seal_approve(id, cap, form)   // Seal access control
```

---

## Getting started

### Prerequisites
- Node.js 18+
- A Sui wallet ([Sui Wallet](https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil) or compatible)
- WAL tokens for Walrus storage fees

### Install & run

```bash
git clone https://github.com/your-username/formchain
cd formchain
npm install
cp .env.example .env
npm run dev
```

### Environment variables

```env
VITE_PACKAGE_ID=0xb0230f55f042d55838f312cb193ec67df1ed2a0fb2ce48a18183e7e67878103f
VITE_REGISTRY_ID=0xc7c1b0db4d7a7268197af81821ac0bbd3d2db2a756400507fc0a32666d4416fd
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-mainnet.walrus.space
VITE_WALRUS_PUBLISHER=https://publisher.walrus-mainnet.walrus.space
VITE_NETWORK=mainnet
```

### Build for production

```bash
npm run build
npm run preview
```

---

## How Walrus is used

FormChain uses the `@mysten/walrus` SDK exclusively — no direct HTTP calls to the aggregator for writes.

| Data | Upload method | Epochs |
|---|---|---|
| Form config (JSON) | `writeFilesFlow` | 5 |
| Response payload (JSON) | `writeFilesFlow` | 10 |
| Cover image | `writeBlobFlow` | 10 |
| File attachment (image/video) | `writeBlobFlow` | 10 |

Downloads use `getBlob` + `blob.files()` for quilt format (writeFilesFlow), falling back to `readBlob` for raw blobs — ensuring compatibility with both upload methods.

---

## How Seal encryption works

When a form has `sealEncrypted: true`:

1. Each response gets a unique Seal ID derived from `formObjectId + responseIndex`
2. Response JSON is encrypted via `sealClient.encrypt()` before upload to Walrus
3. The encrypted blob is stored on Walrus; only the `blobId` goes on-chain
4. To decrypt, the admin signs a `seal_approve` PTB — proving ownership of the `CapObject`
5. `sealClient.decrypt()` verifies the PTB and returns the plaintext

The Move function `formchain_seal::seal_approve` enforces that only the cap holder (form creator) can authorize decryption.

---

## Project structure

```
src/
├── components/
│   ├── layout/Navbar.tsx          # Wallet connect, navigation
│   └── ui/ResponseDetailModal.tsx # Response viewer + decrypt UI
├── hooks/
│   └── useFormChain.ts            # Main hook: create, submit, fetch, annotate
├── lib/
│   ├── walrus.ts                  # Walrus upload/download helpers
│   ├── seal.ts                    # Seal encrypt/decrypt helpers
│   ├── contract.ts                # Sui transaction builders + fetchers
│   └── constants.ts               # Package IDs, endpoints
├── pages/
│   ├── LandingPage.tsx            # Connect wallet CTA
│   ├── Dashboard.tsx              # Admin: list forms + responses
│   ├── FormBuilder.tsx            # Create & publish forms
│   └── SurveyPage.tsx             # Public survey fill page
├── store/index.ts                 # Zustand global state
└── types/index.ts                 # Shared TypeScript types

contract/
├── sources/
│   ├── formchain.move       # Core form logic
│   └── formchain_seal.move  # Seal encryption integration
├── Move.toml                # Package config
└── Move.lock                # Dependency lock file
```

---

## License

MIT — built by the [Dut](https://twitter.com/dut469) team for Walrus Sessions Session 2.
