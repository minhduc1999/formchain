import { Link, useLocation } from 'react-router-dom';
import { Square, Wallet, LogOut, Plus, ChevronDown } from 'lucide-react';
import {
  useCurrentAccount,
  useDisconnectWallet,
  useConnectWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { useState } from 'react';

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export default function Navbar() {
  const location = useLocation();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const { mutate: connect } = useConnectWallet();
  const wallets = useWallets();
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isDashboard =
    location.pathname === '/' || location.pathname === '/dashboard';
  const isSurvey = location.pathname.startsWith('/survey/');

  const handleConnect = () => {
    if (wallets.length === 1) {
      connect({ wallet: wallets[0] });
    } else {
      setShowWalletMenu((v) => !v);
    }
  };

  return (
    <>
      <nav className="navbar">
        {isSurvey ? (
          <span className="navbar-brand" style={{ cursor: 'default' }}>
            <img src="https://aggregator.walrus-mainnet.walrus.space/v1/blobs/YzsRios57h2st5Tu7OQUJmsT4Lr9duddamSS8q7Lo6c" style={{width:16,height:16,borderRadius:3,objectFit:'cover'}} />
            <span>FormChain</span>
          </span>
        ) : (
          <Link to="/" className="navbar-brand" onClick={() => setMenuOpen(false)}>
            <img src="https://aggregator.walrus-mainnet.walrus.space/v1/blobs/YzsRios57h2st5Tu7OQUJmsT4Lr9duddamSS8q7Lo6c" style={{width:20,height:20,borderRadius:8,objectFit:'cover'}} />
            <span>FormChain</span>
          </Link>
        )}

        {/* Desktop actions */}
        <div className="navbar-actions">
          {isDashboard && account && (
            <Link to="/create" className="btn btn-primary">
              <Plus size={14} />
              Create form
            </Link>
          )}

          {account ? (
            <div className="wallet-info">
              <button className="btn btn-ghost wallet-addr">
                <Square size={12} />
                {shortenAddress(account.address)}
              </button>
              <button
                onClick={() => disconnect()}
                className="btn btn-ghost btn-icon"
                title="Disconnect"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <button onClick={handleConnect} className="btn btn-outline">
                <Wallet size={14} />
                Connect wallet
                {wallets.length > 1 && <ChevronDown size={12} />}
              </button>

              {showWalletMenu && wallets.length > 1 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  background: 'var(--bg-2)', border: '1px solid var(--border)',
                  borderRadius: '8px', padding: '6px', minWidth: '180px',
                  zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                }}>
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.name}
                      onClick={() => { connect({ wallet }); setShowWalletMenu(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        width: '100%', padding: '8px 10px',
                        background: 'transparent', border: 'none', borderRadius: '6px',
                        cursor: 'pointer', color: 'var(--text)', fontSize: '13px',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {wallet.icon && <img src={wallet.icon} alt={wallet.name} width={18} height={18} style={{ borderRadius: '4px' }} />}
                      {wallet.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hamburger */}
        <button
          className={`hamburger ${menuOpen ? 'open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* Mobile menu */}
      <div className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
        {isDashboard && account && (
          <Link to="/create" className="btn btn-primary" onClick={() => setMenuOpen(false)}>
            <Plus size={14} /> Create form
          </Link>
        )}
        {account ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 0', color: 'var(--text-2)', fontSize: 13 }}>
              <Square size={13} style={{ color: 'var(--green)' }} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                {shortenAddress(account.address)}
              </span>
            </div>
            <button onClick={() => { disconnect(); setMenuOpen(false); }} className="btn btn-ghost">
              <LogOut size={14} /> Disconnect
            </button>
          </>
        ) : (
          <>
            {wallets.map((wallet) => (
              <button key={wallet.name} className="btn btn-outline"
                onClick={() => { connect({ wallet }); setMenuOpen(false); }}>
                {wallet.icon && <img src={wallet.icon} alt={wallet.name} width={16} height={16} style={{ borderRadius: 3 }} />}
                <Wallet size={14} /> Connect {wallet.name}
              </button>
            ))}
            {wallets.length === 0 && (
              <button className="btn btn-outline" onClick={() => { handleConnect(); setMenuOpen(false); }}>
                <Wallet size={14} /> Connect wallet
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
