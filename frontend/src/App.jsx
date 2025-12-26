import { useRef, useState } from "react";
import "./App.css";
import pineCode from "../../indicator/gex-levels.pine?raw";
import lastUpdateRaw from "../../last_update.txt?raw";

function App() {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const featuresRef = useRef(null);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(pineCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  // parse last update date from file
  let lastUpdate = "";
  try {
    const raw = (lastUpdateRaw || "").trim();
    if (raw) {
      // Try parsing as-is first, then try common variants (space->T, ' UTC'->Z),
      // then fall back to a manual ISO construction for formats like
      // "YYYY-MM-DD HH:MM:SS UTC". If all fail, show the raw string.
      let d = new Date(raw);
      if (isNaN(d.getTime())) {
        const isoVariant = raw.replace(" ", "T").replace(" UTC", "Z");
        d = new Date(isoVariant);
      }
      if (isNaN(d.getTime())) {
        const m = raw.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
        if (m) {
          d = new Date(`${m[1]}T${m[2]}Z`);
        }
      }
      if (!isNaN(d.getTime())) {
        lastUpdate = d.toLocaleString("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Europe/Paris",
        });
      } else {
        lastUpdate = raw;
      }
    }
  } catch (e) {
    console.error("Failed to parse last update", e);
  }

  return (
    <div className="app modern">
      <nav className="nav">
        <div className="nav-left">
          <div className="logo-mark">GEX</div>
          <div className="brand">GEX Levels</div>
        </div>
        <button
          className="hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div className={`nav-links ${menuOpen ? "open" : ""}`}>
          <a href="#home" onClick={() => scrollToSection("home")}>
            Home
          </a>
          <a href="#features" onClick={() => scrollToSection("features")}>
            Features
          </a>
          <a
            href="https://www.tradingview.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            TradingView
          </a>
        </div>
      </nav>

      {/* BANNIERE DE MISE A JOUR (TRÈS VISIBLE) */}
      {lastUpdate && (
        <div className="update-banner" role="status" aria-live="polite">
          Dernière mise à jour de l'indicateur : <strong>{lastUpdate}</strong>
        </div>
      )}

      <main className="main">
        {/* Hero compact en haut */}
        <section className="hero-compact" id="home">
          <div className="hero-compact-inner">
            <div className="badge">TradingView Pine Script v5</div>
            <h1>GEX Levels — SPX & NDX Futures</h1>
            <p className="lead">
              Indicateur d'exposition gamma (GEX) pour identifier les zones clés
              de support/résistance sur les indices majeurs. Prêt à copier dans
              TradingView.
            </p>

            <div className="stats-inline">
              <div className="stat-inline">
                <span className="stat-icon">📈</span>
                <span>SPX</span>
              </div>
              <div className="stat-inline">
                <span className="stat-icon">💹</span>
                <span>NDX</span>
              </div>
              <div className="stat-inline">
                <span className="stat-icon">⚡</span>
                <span>Real-time</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section code — première position, centrée */}
        <section className="code-section-primary">
          <div className="code-container">
            <div className="code-header">
              <div>
                <h2>Script Pine — Copier & Coller</h2>
                <p className="code-subtitle">
                  Copiez ce code et collez-le dans l'éditeur Pine Script de
                  TradingView
                </p>
                {lastUpdate && (
                  <p className="code-update">
                    Dernière mise à jour : <strong>{lastUpdate}</strong>
                  </p>
                )}
              </div>
            </div>

            <div className="code-actions">
              <button
                className={`btn ${copied ? "success" : "primary"}`}
                onClick={copyToClipboard}
              >
                {copied ? (
                  <>
                    <svg
                      width="18"
                      height="18"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                    </svg>
                    Code copié !
                  </>
                ) : (
                  <>
                    <svg
                      width="18"
                      height="18"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
                    </svg>
                    Copier le code
                  </>
                )}
              </button>
              <a
                className="btn secondary"
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                  pineCode
                )}`}
                download="gex-levels.pine"
              >
                <svg
                  width="18"
                  height="18"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                  <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                </svg>
                Télécharger .pine
              </a>
            </div>

            <div className="code-wrapper">
              <pre className="code-block" aria-label="Pine Script Code">
                <code>{pineCode}</code>
              </pre>
            </div>

            <div className="code-instructions">
              <h4>Installation en 3 étapes :</h4>
              <ol>
                <li>
                  Ouvrez TradingView et accédez à l'éditeur Pine Script (Alt+E)
                </li>
                <li>Collez le code ci-dessus dans l'éditeur</li>
                <li>
                  Cliquez sur "Ajouter au graphique" pour activer l'indicateur
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* Features en dessous */}
        <section className="features" id="features" ref={featuresRef}>
          <h2>Fonctionnalités</h2>
          <div className="features-grid">
            <div className="feature">
              <div className="feature-icon">🎯</div>
              <h4>Niveaux GEX précis</h4>
              <p className="muted">
                Calcul des zones d'exposition gamma pour identifier les niveaux
                clés de support/résistance
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">🔄</div>
              <h4>Multi-instruments</h4>
              <p className="muted">
                Compatible SPX et NDX avec adaptation automatique des paramètres
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">⏱️</div>
              <h4>Session tracking</h4>
              <p className="muted">
                Suivi des ouvertures de marché et ajustement dynamique des
                niveaux
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">📊</div>
              <h4>Visualisation claire</h4>
              <p className="muted">
                Affichage optimisé avec niveaux colorés et labels informatifs
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">⚙️</div>
              <h4>Personnalisable</h4>
              <p className="muted">
                Paramètres ajustables pour adapter l'indicateur à votre style
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">🚀</div>
              <h4>Performance optimale</h4>
              <p className="muted">
                Code optimisé Pine Script v5 pour une exécution rapide
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="site-footer">
          <div className="footer-content">
            <div className="footer-brand">
              <div className="logo-mark small">GEX</div>
              <div>
                <div className="footer-title">GEX Levels</div>
                <div className="footer-copyright">
                  © {new Date().getFullYear()} — Usage éducatif uniquement
                </div>
              </div>
            </div>
            <div className="footer-links">
              {lastUpdate && (
                <div className="footer-update">
                  Dernière mise à jour : <strong>{lastUpdate}</strong>
                </div>
              )}
              <a href="#privacy">Privacy</a>
              <a href="#license">License</a>
              <a href="#contact">Contact</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
