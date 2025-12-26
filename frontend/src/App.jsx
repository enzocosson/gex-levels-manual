import { useRef, useState, useMemo } from "react";
import "./App.css";
import pineCode from "../../indicator/gex-levels.pine?raw";
import lastUpdateRaw from "../../last_update.txt?raw";

// Import CSV files as raw text
import esGexZeroRaw from "../../es_gex_zero.csv?raw";
import esGexOneRaw from "../../es_gex_one.csv?raw";
import esGexFullRaw from "../../es_gex_full.csv?raw";
import nqGexZeroRaw from "../../nq_gex_zero.csv?raw";
import nqGexOneRaw from "../../nq_gex_one.csv?raw";
import nqGexFullRaw from "../../nq_gex_full.csv?raw";

// Parse CSV helper function
const parseCSV = (csvText) => {
  if (!csvText) return [];
  const lines = csvText.trim().split("\n");
  if (lines.length === 0) return [];

  const headers = lines[0].split(",");

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header.trim()] = values[idx]?.trim() || "";
    });
    return obj;
  });
};

function App() {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const featuresRef = useRef(null);

  // Parse CSV data using useMemo (computed once, no side effects)
  const gexData = useMemo(
    () => ({
      es: {
        zero: parseCSV(esGexZeroRaw),
        one: parseCSV(esGexOneRaw),
        full: parseCSV(esGexFullRaw),
      },
      nq: {
        zero: parseCSV(nqGexZeroRaw),
        one: parseCSV(nqGexOneRaw),
        full: parseCSV(nqGexFullRaw),
      },
    }),
    []
  ); // Empty deps = computed once on mount

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

  // Parse last update date using useMemo
  const lastUpdate = useMemo(() => {
    try {
      const raw = (lastUpdateRaw || "").trim();
      if (!raw) return "";

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
        return d.toLocaleString("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Europe/Paris",
        });
      }
      return raw;
    } catch (e) {
      console.error("Failed to parse last update", e);
      return "";
    }
  }, []);

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
          <a href="#levels" onClick={() => scrollToSection("levels")}>
            Niveaux GEX
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

      {/* Update banner */}
      {lastUpdate && (
        <div className="update-banner" role="status" aria-live="polite">
          Dernière mise à jour : <strong>{lastUpdate}</strong>
        </div>
      )}

      <main className="main">
        {/* Hero compact */}
        <section className="hero-compact" id="home">
          <div className="hero-compact-inner">
            <div className="badge">TradingView Pine Script v5</div>
            <h1>GEX Levels — ES & NQ Futures</h1>
            <p className="lead">
              Niveaux d'exposition gamma (GEX) en temps réel pour ES (SPX) et NQ
              (NDX). Identifiez instantanément les zones clés de
              support/résistance.
            </p>

            <div className="stats-inline">
              <div className="stat-inline">
                <span className="stat-icon">📈</span>
                <span>ES (SPX)</span>
              </div>
              <div className="stat-inline">
                <span className="stat-icon">💹</span>
                <span>NQ (NDX)</span>
              </div>
              <div className="stat-inline">
                <span className="stat-icon">⚡</span>
                <span>Temps réel</span>
              </div>
            </div>
          </div>
        </section>

        {/* Code Section */}
        <section className="code-section-primary">
          <div className="code-container">
            <div className="code-header">
              <div>
                <h2>Script Pine — Copier & Coller</h2>
                <p className="code-subtitle">
                  Copiez ce code et collez-le dans l'éditeur Pine Script de
                  TradingView
                </p>
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

        {/* GEX Levels Section */}
        <section className="gex-levels-section" id="levels">
          <h2>📊 Niveaux GEX Actuels</h2>
          <p className="section-subtitle">
            Consultez les niveaux d'exposition gamma calculés pour 0DTE, 1DTE et
            Full
          </p>

          <div className="gex-container">
            {/* ES (SPX) Levels */}
            <div className="gex-instrument">
              <h3>
                <span className="instrument-icon">📈</span>
                ES — S&P 500 Futures
              </h3>

              <div className="gex-tabs">
                <GexTable title="0DTE" data={gexData.es.zero} color="blue" />
                <GexTable title="1DTE" data={gexData.es.one} color="purple" />
                <GexTable title="Full" data={gexData.es.full} color="green" />
              </div>
            </div>

            {/* NQ (NDX) Levels */}
            <div className="gex-instrument">
              <h3>
                <span className="instrument-icon">💹</span>
                NQ — Nasdaq 100 Futures
              </h3>

              <div className="gex-tabs">
                <GexTable title="0DTE" data={gexData.nq.zero} color="blue" />
                <GexTable title="1DTE" data={gexData.nq.one} color="purple" />
                <GexTable title="Full" data={gexData.nq.full} color="green" />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="features" id="features" ref={featuresRef}>
          <h2>Fonctionnalités</h2>
          <div className="features-grid">
            <div className="feature">
              <div className="feature-icon">🎯</div>
              <h4>Niveaux GEX précis</h4>
              <p className="muted">
                Calcul des zones d'exposition gamma pour identifier les niveaux
                clés
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">🔄</div>
              <h4>Multi-expirations</h4>
              <p className="muted">
                0DTE, 1DTE et Full pour une vision complète du marché
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">⏱️</div>
              <h4>Temps réel</h4>
              <p className="muted">
                Mise à jour automatique toutes les 5 minutes via GitHub Actions
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
              <h4>Performance</h4>
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

// Component for displaying GEX table
function GexTable({ title, data, color }) {
  if (!data || data.length === 0) {
    return (
      <div className={`gex-table-card ${color}`}>
        <h4>{title}</h4>
        <p className="no-data">Aucune donnée disponible</p>
      </div>
    );
  }

  return (
    <div className={`gex-table-card ${color}`}>
      <h4>{title}</h4>
      <div className="gex-table-wrapper">
        <table className="gex-table">
          <thead>
            <tr>
              {Object.keys(data[0]).map((key) => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx}>
                {Object.values(row).map((val, i) => (
                  <td key={i}>{val}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
