import { useRef, useState } from "react";
import "./App.css";
import pineCode from "../../indicator/gex-levels.pine?raw";

function App() {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(pineCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  const scrollToCode = () =>
    codeRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="app modern">
      <nav className="nav">
        <div className="nav-left">
          <div className="logo-mark">GEX</div>
          <div className="brand">GEX Levels</div>
        </div>
        <div className="nav-links">
          <a href="#home">Home</a>
          <a href="#features">Features</a>
          <a href="#docs">Docs</a>
          <button className="btn small" onClick={scrollToCode}>
            Get Script
          </button>
        </div>
      </nav>

      <header className="hero modern-hero" id="home">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>GEX Levels for SPX & NDX — Futures</h1>
            <p className="lead">
              Mesurez les niveaux d’exposition options (GEX) et anticipez les
              réactions du marché. Script Pine prêt pour TradingView.
            </p>
            <div className="hero-cta">
              <button className="btn" onClick={scrollToCode}>
                Copier le script
              </button>
              <a
                className="btn secondary"
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                  pineCode
                )}`}
                download="gex-levels.pine"
              >
                Télécharger
              </a>
            </div>
          </div>

          <div className="hero-cards">
            <div className="stat-card">
              <div className="stat">SPX</div>
              <div className="stat-desc">S&P 500 Futures</div>
            </div>
            <div className="stat-card">
              <div className="stat">NDX</div>
              <div className="stat-desc">Nasdaq 100 Futures</div>
            </div>
            <div className="stat-card">
              <div className="stat">Real-time</div>
              <div className="stat-desc">Mise à jour locale</div>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="code-section modern" ref={codeRef} id="docs">
          <div className="code-header">
            <h3>Script Pine — copier/coller</h3>
            <div className="actions">
              <button className="btn" onClick={copyToClipboard}>
                {copied ? "Copié ✓" : "Copier le code"}
              </button>
              <a
                className="btn secondary"
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                  pineCode
                )}`}
                download="gex-levels.pine"
              >
                Télécharger
              </a>
            </div>
          </div>
          <pre className="code-block" aria-label="Pine Script">
            <code>{pineCode}</code>
          </pre>
        </section>

        <footer className="site-footer">
          <div>
            © {new Date().getFullYear()} GEX Levels — pour usage éducatif
          </div>
          <div className="footer-links">
            <a href="#">Privacy</a> · <a href="#">License</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
