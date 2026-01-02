import { useState, useEffect, useRef } from "react";
import "./IndicatorSummary.css";

export default function IndicatorSummary({ metadataMap, lastUpdate }) {
  const [activeDte, setActiveDte] = useState("zero");
  const previousDataRef = useRef({ es: null, nq: null });
  const [changes, setChanges] = useState({});

  // Parse metadata string to object
  const parseMetadata = (metaString) => {
    if (!metaString) return null;

    const parts = metaString.split("|");
    const metadata = {};

    parts.forEach((part) => {
      const [key, value] = part.split(":");
      if (key && value) {
        metadata[key.toLowerCase()] = value;
      }
    });

    return {
      timestamp: parseInt(metadata.timestamp) || 0,
      symbol: metadata.symbol || "",
      spot: parseFloat(metadata.spot) || 0,
      frontDte: parseInt(metadata.frontdte) || 0,
      nextDte: parseInt(metadata.nextdte) || 0,
      volTrigger: parseFloat(metadata.voltrigger) || 0,
      netGexVol: parseFloat(metadata.netgexvol) || 0,
      netGexOi: parseFloat(metadata.netgexoi) || 0,
      callResAll: parseFloat(metadata.callresall) || 0,
      putSupAll: parseFloat(metadata.putsupall) || 0,
    };
  };

  // Get metadata for specific ticker
  const getMetadataForTicker = (ticker) => {
    if (!metadataMap) return null;

    const candidates = [
      `${ticker}_${activeDte}`,
      `${ticker}_meta_${activeDte}`,
    ];

    for (const k of candidates) {
      if (k in metadataMap && metadataMap[k])
        return parseMetadata(metadataMap[k]);
    }

    return null;
  };

  const esData = getMetadataForTicker("es");
  const nqData = getMetadataForTicker("nq");

  // Track changes when data updates
  useEffect(() => {
    if (esData || nqData) {
      const prev = previousDataRef.current || {};
      const newChanges = {};

      // Compare ES data
      if (esData && prev.es) {
        newChanges.es = {
          spot: esData.spot - prev.es.spot,
          volTrigger: esData.volTrigger - prev.es.volTrigger,
          netGex:
            esData.netGexVol +
            esData.netGexOi -
            (prev.es.netGexVol + prev.es.netGexOi),
          callResAll: esData.callResAll - prev.es.callResAll,
          putSupAll: esData.putSupAll - prev.es.putSupAll,
        };
      }

      // Compare NQ data
      if (nqData && prev.nq) {
        newChanges.nq = {
          spot: nqData.spot - prev.nq.spot,
          volTrigger: nqData.volTrigger - prev.nq.volTrigger,
          netGex:
            nqData.netGexVol +
            nqData.netGexOi -
            (prev.nq.netGexVol + prev.nq.netGexOi),
          callResAll: nqData.callResAll - prev.nq.callResAll,
          putSupAll: nqData.putSupAll - prev.nq.putSupAll,
        };
      }

      // Only update state if we found differences to avoid unnecessary renders
      if (Object.keys(newChanges).length > 0) {
        // Schedule the state update asynchronously to avoid synchronous
        // setState() inside the effect body which can trigger cascading renders.
        Promise.resolve().then(() => {
          setChanges((prev) => {
            // Simple shallow equality check to avoid unnecessary updates
            const prevKeys = Object.keys(prev || {});
            const newKeys = Object.keys(newChanges);
            if (prevKeys.length === newKeys.length) {
              let equal = true;
              for (const k of newKeys) {
                const p = prev[k];
                const n = newChanges[k];
                if (!p || !n) {
                  equal = false;
                  break;
                }
                for (const field of Object.keys(n)) {
                  if (p[field] !== n[field]) {
                    equal = false;
                    break;
                  }
                }
                if (!equal) break;
              }
              if (equal) return prev;
            }
            return newChanges;
          });
        });
      }

      // Update previous data ref (no state update)
      previousDataRef.current = {
        es: esData,
        nq: nqData,
      };
    }
  }, [esData, nqData]);

  // Calculate gamma regime
  const getGammaRegime = (meta) => {
    if (!meta) return null;

    const totalNetGex = meta.netGexVol + meta.netGexOi;
    const isPositive = totalNetGex > 0;
    const spotVsZero = meta.spot - meta.volTrigger;

    return {
      totalNetGex,
      isPositive,
      spotAboveZero: spotVsZero > 0,
      spotVsZeroDistance: spotVsZero,
      spotVsZeroPercent:
        meta.volTrigger !== 0 ? (spotVsZero / meta.volTrigger) * 100 : 0,
    };
  };

  // Calculate market balance
  const getMarketBalance = (meta) => {
    if (!meta) return null;

    const totalGex = meta.callResAll + meta.putSupAll;
    const callDominance =
      totalGex > 0 ? (meta.callResAll / totalGex) * 100 : 50;
    const putDominance = totalGex > 0 ? (meta.putSupAll / totalGex) * 100 : 50;
    const imbalance = Math.abs(callDominance - putDominance);

    return {
      callResAll: meta.callResAll,
      putSupAll: meta.putSupAll,
      totalGex,
      callDominance,
      putDominance,
      imbalance,
      isBalanced: imbalance < 20,
    };
  };

  // Get interpretation text
  const getInterpretation = (meta) => {
    if (!meta) return null;

    const regime = getGammaRegime(meta);
    const balance = getMarketBalance(meta);

    let volatilityExpectation = "";
    let marketBehavior = "";
    let tradingStrategy = "";
    let riskLevel = "";

    // Zero Gamma interpretation
    if (meta.volTrigger === 0) {
      if (regime.totalNetGex < -1000) {
        volatilityExpectation = "Volatilité explosive attendue";
        marketBehavior =
          "Les market makers amplifieront les mouvements (achètent haut, vendent bas)";
        tradingStrategy =
          "Favoriser les stratégies directionnelles et les breakouts";
        riskLevel = "very-high";
      } else if (regime.totalNetGex > 1000) {
        volatilityExpectation = "Volatilité supprimée";
        marketBehavior =
          "Les market makers stabiliseront le prix (achètent bas, vendent haut)";
        tradingStrategy = "Favoriser les stratégies range et mean-reversion";
        riskLevel = "low";
      } else {
        volatilityExpectation = "Aucun point d'équilibre gamma détecté";
        marketBehavior = "Marché en déséquilibre - prudence requise";
        tradingStrategy = "Attendre une structure plus claire";
        riskLevel = "high";
      }
    } else {
      // Normal zero gamma interpretation
      if (regime.spotAboveZero) {
        volatilityExpectation =
          "Volatilité amplifiée (au-dessus du Zero Gamma)";
        marketBehavior =
          "Régime de gamma négatif - les MM hedgent dans le sens du mouvement";
        tradingStrategy = "Momentum et breakouts plus efficaces";
        riskLevel = "high";
      } else {
        volatilityExpectation =
          "Volatilité contenue (en-dessous du Zero Gamma)";
        marketBehavior =
          "Régime de gamma positif - les MM stabilisent le marché";
        tradingStrategy = "Mean-reversion et support/résistance fiables";
        riskLevel = "medium";
      }
    }

    // Balance interpretation
    let balanceInterpretation = "";
    if (balance.imbalance > 40) {
      if (balance.callDominance > balance.putDominance) {
        balanceInterpretation =
          "Forte résistance call au-dessus - difficile de monter";
      } else {
        balanceInterpretation =
          "Fort support put en-dessous - difficile de baisser";
      }
    } else if (balance.imbalance < 20) {
      balanceInterpretation =
        "Marché équilibré - pas de biais directionnel fort";
    }

    return {
      volatilityExpectation,
      marketBehavior,
      tradingStrategy,
      riskLevel,
      balanceInterpretation,
    };
  };

  // Format change value with arrow
  const formatChange = (value, decimals = 2) => {
    if (!value || Math.abs(value) < 0.01) return null;

    const formatted = Math.abs(value).toFixed(decimals);
    const arrow = value > 0 ? "↗" : "↘";
    const className = value > 0 ? "change-up" : "change-down";

    return (
      <span className={`change-indicator ${className}`}>
        {arrow} {formatted}
      </span>
    );
  };

  // Render ticker card
  const renderTickerCard = (meta, tickerName, ticker) => {
    if (!meta) {
      return (
        <div className="ticker-card">
          <h3>{tickerName}</h3>
          <p className="no-data">Données non disponibles</p>
        </div>
      );
    }

    const regime = getGammaRegime(meta);
    const balance = getMarketBalance(meta);
    const interpretation = getInterpretation(meta);
    const tickerChanges = changes[ticker] || {};

    return (
      <div className="ticker-card">
        <div className="ticker-header">
          <h3>{tickerName}</h3>
          <span className="ticker-symbol">{meta.symbol}</span>
        </div>

        {/* Key Metrics */}
        <div className="ticker-metrics">
          <div className="ticker-metric">
            <div className="ticker-metric-label">Spot</div>
            <div className="ticker-metric-value">
              {meta.spot.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}
              {formatChange(tickerChanges.spot, 2)}
            </div>
          </div>

          <div className="ticker-metric">
            <div className="ticker-metric-label">Zero Gamma</div>
            <div className="ticker-metric-value">
              {meta.volTrigger === 0 ? (
                <span className="no-zero-gamma">Aucun</span>
              ) : (
                <>
                  {meta.volTrigger.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  })}
                  {formatChange(tickerChanges.volTrigger, 2)}
                </>
              )}
            </div>
            {meta.volTrigger !== 0 && regime && (
              <div
                className={`ticker-badge ${
                  regime.spotAboveZero ? "negative" : "positive"
                }`}
              >
                {regime.spotAboveZero ? "📈 Au-dessus" : "📉 En-dessous"}
              </div>
            )}
          </div>

          <div className="ticker-metric">
            <div className="ticker-metric-label">GEX Net</div>
            <div
              className={`ticker-metric-value ${
                regime?.totalNetGex < 0 ? "negative" : "positive"
              }`}
            >
              {regime?.totalNetGex?.toFixed(0)}
              {formatChange(tickerChanges.netGex, 0)}
            </div>
            <div
              className={`ticker-badge ${
                regime?.totalNetGex < 0 ? "negative" : "positive"
              }`}
            >
              {regime?.totalNetGex < 0 ? "Gamma -" : "Gamma +"}
            </div>
          </div>

          <div className="ticker-metric">
            <div className="ticker-metric-label">Call/Put</div>
            <div className="ticker-metric-value">
              {balance?.callDominance.toFixed(0)}% /{" "}
              {balance?.putDominance.toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Regime */}
        <div className={`ticker-regime ${interpretation?.riskLevel}`}>
          <div className="ticker-regime-header">
            <span>{interpretation?.volatilityExpectation}</span>
            <span className={`risk-badge-small ${interpretation?.riskLevel}`}>
              {interpretation?.riskLevel === "very-high" && "🔴"}
              {interpretation?.riskLevel === "high" && "🟠"}
              {interpretation?.riskLevel === "medium" && "🟡"}
              {interpretation?.riskLevel === "low" && "🟢"}
            </span>
          </div>
          <p className="ticker-regime-text">{interpretation?.marketBehavior}</p>
        </div>

        {/* GEX Distribution */}
        <div className="ticker-gex">
          <div className="ticker-gex-row">
            <span className="ticker-gex-label">Call</span>
            <div className="ticker-gex-bar-wrapper">
              <div
                className="ticker-gex-bar call-bar"
                style={{ width: `${balance?.callDominance}%` }}
              ></div>
            </div>
            <span className="ticker-gex-value">
              {balance?.callResAll.toFixed(0)}
              {formatChange(tickerChanges.callResAll, 0)}
            </span>
          </div>
          <div className="ticker-gex-row">
            <span className="ticker-gex-label">Put</span>
            <div className="ticker-gex-bar-wrapper">
              <div
                className="ticker-gex-bar put-bar"
                style={{ width: `${balance?.putDominance}%` }}
              ></div>
            </div>
            <span className="ticker-gex-value">
              {balance?.putSupAll.toFixed(0)}
              {formatChange(tickerChanges.putSupAll, 0)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  if (!esData && !nqData) {
    return (
      <section className="indicator-summary">
        <div className="summary-container">
          <p className="no-data">Chargement des données d'analyse...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="indicator-summary" id="analysis">
      <div className="summary-container">
        <div className="summary-header">
          <h2>📊 Analyse de Marché en Temps Réel</h2>
          <p className="summary-subtitle">
            Comparaison ES/SPX vs NQ/NDX •{" "}
            {esData?.frontDte === 0 ? "0DTE" : `${esData?.frontDte}DTE`}
          </p>
          {lastUpdate && (
            <p className="summary-last-update">
              Dernière mise à jour : {lastUpdate}
            </p>
          )}
        </div>

        {/* DTE Selector */}
        <div className="summary-controls">
          <div className="dte-selector">
            <button
              className={activeDte === "zero" ? "active" : ""}
              onClick={() => setActiveDte("zero")}
            >
              0DTE
            </button>
            <button
              className={activeDte === "one" ? "active" : ""}
              onClick={() => setActiveDte("one")}
            >
              1DTE
            </button>
            <button
              className={activeDte === "full" ? "active" : ""}
              onClick={() => setActiveDte("full")}
            >
              Full
            </button>
          </div>
        </div>

        {/* Side by side tickers */}
        <div className="tickers-grid">
          {renderTickerCard(esData, "ES/SPX", "es")}
          {renderTickerCard(nqData, "NQ/NDX", "nq")}
        </div>

        {/* Timeframe Context */}
        {esData?.frontDte === 0 && (
          <div className="analysis-section">
            <div className="alert-box warning">
              <strong>⚠️ Attention 0DTE :</strong> Les niveaux 0DTE deviennent
              exponentiellement plus puissants en fin de journée (après 14h
              EST). Le gamma explose en approchant l'expiration, rendant les
              market makers particulièrement actifs.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
