import { Square, Wallet, ChevronDown, Shield, BarChart2, Lock } from 'lucide-react';
import { useConnectWallet, useWallets } from '@mysten/dapp-kit';
import { useState } from 'react';

export default function LandingPage() {
  const { mutate: connect } = useConnectWallet();
  const wallets = useWallets();
  const [showWalletMenu, setShowWalletMenu] = useState(false);

  const handleConnect = () => {
    if (wallets.length === 1) {
      connect({ wallet: wallets[0] });
    } else {
      setShowWalletMenu((v) => !v);
    }
  };

  return (
    <div className="landing">
      <div className="landing-hero">
        <div className="landing-logo">
          <img src="https://aggregator.walrus-mainnet.walrus.space/v1/blobs/YzsRios57h2st5Tu7OQUJmsT4Lr9duddamSS8q7Lo6c" style={{width:50,height:50,borderRadius:8,objectFit:'cover'}} />
          <span className="landing-logo-text">FormChain</span>
        </div>

        <h1 className="landing-title">
          Decentralized surveys,<br />
          <span className="landing-accent">secured on the blockchain</span>
        </h1>

        <p className="landing-desc">
          Create forms, collect responses, and manage user data — all encrypted
          and immutably stored on Sui Network + Walrus + Seal.
        </p>

        <div className="landing-cta" style={{ position: 'relative', display: 'inline-block' }}>
          <button className="btn btn-primary btn-lg" onClick={handleConnect}>
            <Wallet size={16} />
            Connect wallet to get started
            {wallets.length > 1 && <ChevronDown size={14} />}
          </button>

          {showWalletMenu && wallets.length > 1 && (
            <div className="wallet-dropdown">
              {wallets.map((wallet) => (
                <button
                  key={wallet.name}
                  className="wallet-dropdown-item"
                  onClick={() => { connect({ wallet }); setShowWalletMenu(false); }}
                >
                  {wallet.icon && <img src={wallet.icon} alt={wallet.name} width={18} height={18} style={{ borderRadius: 4 }} />}
                  {wallet.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {wallets.length === 0 && (
          <p className="landing-no-wallet">
            No wallet?{' '}
            <a href="https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil" target="_blank" rel="noreferrer">
              Install Sui Wallet
            </a>{' '}
            to get started.
          </p>
        )}
      </div>

      <div className="landing-features">
        <div className="feature-card">
          <div className="feature-icon"><Shield size={22} /></div>
          <h3>Seal Encryption</h3>
          <p>Response data is end-to-end encrypted with Seal Protocol — only the form owner can read it.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon"><BarChart2 size={22} /></div>
          <h3>Smart Dashboard</h3>
          <p>View, filter, and manage all responses. Export CSV, assign priority, add on-chain notes.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon"><Lock size={22} /></div>
          <h3>Walrus + Sui</h3>
          <p>Config and responses stored on Walrus. Metadata indexed on-chain on Sui Mainnet — immutable, transparent.</p>
        </div>
      </div>

      <p className="landing-footer-hint">
        Connect your Sui wallet to access the dashboard and manage forms.
      </p>
      <footer style={{ textAlign: 'center', padding: '24px 0 16px', color: 'var(--text-3)', fontSize: 13 }}>
      © 2026 FormChain · Built by the{' '}
      <a 
        href="https://twitter.com/dut469" 
        target="_blank" 
        rel="noreferrer"
        style={{ color: 'var(--green)', textDecoration: 'none' }}
      >
        Dut
      </a>
      {' '}team
    </footer>
    </div>
    
  );
}
