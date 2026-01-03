import { useState, useEffect, useRef } from "react";
import "./IndicatorSummary.css";

// Multipliers pour conversion SPX→ES et NDX→NQ
const TICKERS = {
  es: {
    source: "SPX",
    description: "SPX GEX for ES Futures",
    multiplier: 1.00685,
    strikeInterval: 5, // ES moves in 5pt increments
  },
  nq: {
    source: "NDX",
    description: "NDX GEX for NQ Futures",
    multiplier: 1.00842,
    strikeInterval: 25, // NQ moves in 25pt increments
  },
};

export default function IndicatorSummary({ metadataMap, lastUpdate, gexData }) {
  const [activeDte, setActiveDte] = useState("zero");
  const previousDataRef = useRef({ es: null, nq: null });
  const [changes, setChanges] = useState({});
  const [levelHistory, setLevelHistory] = useState({ es: [], nq: [] });

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

  // Convert SPX/NDX prices to ES/NQ
  const convertToFuturesPrice = (price, ticker) => {
    if (!price || price === 0) return 0;
    const multiplier = TICKERS[ticker]?.multiplier || 1;
    return price * multiplier;
  };

  // Calculate number of strikes between two levels
  const calculateStrikeCount = (level1, level2, ticker) => {
    const interval = TICKERS[ticker]?.strikeInterval || 5;
    return Math.abs(Math.round((level2 - level1) / interval));
  };

  // Get metadata for specific ticker with conversion
  const getMetadataForTicker = (ticker) => {
    if (!metadataMap) return null;

    const candidates = [
      `${ticker}_${activeDte}`,
      `${ticker}_meta_${activeDte}`,
    ];

    for (const k of candidates) {
      if (k in metadataMap && metadataMap[k]) {
        const parsed = parseMetadata(metadataMap[k]);
        if (parsed) {
          return {
            ...parsed,
            spot: convertToFuturesPrice(parsed.spot, ticker),
            volTrigger: convertToFuturesPrice(parsed.volTrigger, ticker),
            callResAll: convertToFuturesPrice(parsed.callResAll, ticker),
            putSupAll: convertToFuturesPrice(parsed.putSupAll, ticker),
            originalSpot: parsed.spot,
          };
        }
      }
    }

    return null;
  };

  const esData = getMetadataForTicker("es");
  const nqData = getMetadataForTicker("nq");

  // Calculate realistic intraday target based on volatility and time remaining
  const calculateIntradayTarget = (meta, direction, regime) => {
    if (!meta) return null;

    const now = new Date();
    const estHour = (now.getUTCHours() - 5 + 24) % 24;
    const marketClose = 16; // 4pm EST
    const hoursRemaining = Math.max(0, marketClose - estHour);

    // Average hourly move (0DTE typically 0.3-0.5% per hour)
    const baseHourlyMove = meta.frontDte === 0 ? 0.004 : 0.003;
    const volatilityMultiplier = Math.abs(regime.totalNetGex) < 500 ? 1.5 : 0.8;

    const maxIntradayMove =
      meta.spot * baseHourlyMove * hoursRemaining * volatilityMultiplier;

    return {
      bullishTarget: meta.spot + maxIntradayMove,
      bearishTarget: meta.spot - maxIntradayMove,
      hoursRemaining,
      maxMove: maxIntradayMove,
    };
  };

  // Calculate Gamma Regime
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

  // Calculate Market Balance with strike concentration
  const getMarketBalance = (meta, ticker) => {
    if (!meta) return null;

    const totalGex = Math.abs(meta.netGexVol) + Math.abs(meta.netGexOi);
    const callDominance =
      totalGex > 0 ? (Math.abs(meta.netGexVol) / totalGex) * 100 : 50;
    const putDominance = 100 - callDominance;
    const imbalance = Math.abs(callDominance - putDominance);

    // Calculate strike counts
    const strikesToCallRes = calculateStrikeCount(
      meta.spot,
      meta.callResAll,
      ticker
    );
    const strikesToPutSup = calculateStrikeCount(
      meta.spot,
      meta.putSupAll,
      ticker
    );
    const strikesToZero =
      meta.volTrigger > 0
        ? calculateStrikeCount(meta.spot, meta.volTrigger, ticker)
        : 0;

    return {
      callResAll: meta.callResAll,
      putSupAll: meta.putSupAll,
      totalGex,
      callDominance,
      putDominance,
      imbalance,
      isBalanced: imbalance < 20,
      strikesToCallRes,
      strikesToPutSup,
      strikesToZero,
    };
  };

  // Enhanced probability with ES/NQ correlation check
  const calculateMarketProbability = (
    meta,
    regime,
    balance,
    correlatedMeta
  ) => {
    if (!meta || !regime || !balance) return null;

    let bullishScore = 50;

    // Factor 1: Position relative to Zero Gamma (30% weight)
    if (meta.volTrigger !== 0) {
      if (regime.spotAboveZero) {
        const distance = Math.min(Math.abs(regime.spotVsZeroPercent), 5);
        bullishScore += distance * 2;
      } else {
        const distance = Math.min(Math.abs(regime.spotVsZeroPercent), 5);
        bullishScore -= distance * 2;
      }
    }

    // Factor 2: Net GEX sign (20% weight)
    if (regime.totalNetGex > 0) {
      bullishScore -= 10;
    } else {
      bullishScore += 10;
    }

    // Factor 3: Call/Put balance (25% weight)
    const callPutRatio = balance.callDominance / balance.putDominance;
    if (callPutRatio > 1.5) {
      bullishScore -= 12;
    } else if (callPutRatio < 0.67) {
      bullishScore += 12;
    }

    // Factor 4: Distance to key levels (15% weight)
    if (meta.callResAll > meta.spot) {
      const distanceToCallRes =
        ((meta.callResAll - meta.spot) / meta.spot) * 100;
      if (distanceToCallRes < 0.3) bullishScore -= 8;
      else if (distanceToCallRes < 0.8) bullishScore -= 4;
    }

    if (meta.putSupAll < meta.spot) {
      const distanceToPutSup = ((meta.spot - meta.putSupAll) / meta.spot) * 100;
      if (distanceToPutSup < 0.3) bullishScore += 8;
      else if (distanceToPutSup < 0.8) bullishScore += 4;
    }

    // Factor 5: Correlation with correlated ticker (10% weight)
    if (correlatedMeta) {
      const correlatedRegime = getGammaRegime(correlatedMeta);
      if (correlatedRegime) {
        // If both above/below zero gamma, add correlation bonus
        if (regime.spotAboveZero === correlatedRegime.spotAboveZero) {
          bullishScore += regime.spotAboveZero ? 5 : -5;
        }
      }
    }

    bullishScore = Math.max(0, Math.min(100, bullishScore));
    const bearishScore = 100 - bullishScore;

    return {
      bullish: bullishScore,
      bearish: bearishScore,
      bias:
        bullishScore > 60
          ? "Bullish"
          : bullishScore < 40
          ? "Bearish"
          : "Neutre",
      strength: Math.abs(bullishScore - 50) > 20 ? "Fort" : "Modéré",
    };
  };

  // Enhanced Key Levels with level history
  const getKeyLevelsAnalysis = (
    meta,
    regime,
    balance,
    ticker,
    intradayTarget
  ) => {
    if (!meta) return null;

    const spot = meta.spot;
    const zeroGamma = meta.volTrigger;
    const callRes = meta.callResAll;
    const putSup = meta.putSupAll;

    const levels = [];

    // Add Zero Gamma with acceleration effect
    if (zeroGamma > 0 && Math.abs(zeroGamma - spot) < spot * 0.1) {
      levels.push({
        price: zeroGamma,
        type: "Zero Gamma",
        label: "⚡ Zero Gamma",
        distance: ((zeroGamma - spot) / spot) * 100,
        distancePoints: Math.abs(zeroGamma - spot),
        strikes: balance.strikesToZero,
        strength: Math.abs(regime.totalNetGex) > 1000 ? "Forte" : "Modérée",
        behavior: regime.spotAboveZero
          ? "Accélération si cassé vers le haut"
          : "Ralentissement si cassé vers le bas",
        current: false,
      });
    }

    // Add Call Resistance
    if (callRes > spot && callRes < intradayTarget?.bullishTarget * 1.1) {
      levels.push({
        price: callRes,
        type: "Résistance Call",
        label: "🔴 Call Wall",
        distance: ((callRes - spot) / spot) * 100,
        distancePoints: Math.abs(callRes - spot),
        strikes: balance.strikesToCallRes,
        strength: balance.callDominance > 60 ? "Très forte" : "Modérée",
        behavior:
          balance.callDominance > 60
            ? "Rejet probable - MM vendent"
            : "Cassure possible si volume fort",
        current: false,
      });
    }

    // Add Put Support
    if (putSup < spot && putSup > intradayTarget?.bearishTarget * 0.9) {
      levels.push({
        price: putSup,
        type: "Support Put",
        label: "🟢 Put Wall",
        distance: ((putSup - spot) / spot) * 100,
        distancePoints: Math.abs(putSup - spot),
        strikes: balance.strikesToPutSup,
        strength: balance.putDominance > 60 ? "Très fort" : "Modéré",
        behavior:
          balance.putDominance > 60
            ? "Rebond probable - MM achètent"
            : "Cassure possible si pression vendeuse",
        current: false,
      });
    }

    // Sort by distance
    levels.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));

    const nextResistance = levels.find((l) => l.price > spot);
    const nextSupport = levels.find((l) => l.price < spot);
    const currentLevel = levels.find((l) => Math.abs(l.distance) < 0.1);

    // Track level breaks
    const history = levelHistory[ticker] || [];
    const lastLevel = history[history.length - 1];

    let levelBroken = null;
    if (lastLevel && lastLevel.price) {
      const crossedUp =
        lastLevel.spot < lastLevel.price && spot > lastLevel.price;
      const crossedDown =
        lastLevel.spot > lastLevel.price && spot < lastLevel.price;

      if (crossedUp || crossedDown) {
        levelBroken = {
          level: lastLevel.label,
          price: lastLevel.price,
          direction: crossedUp ? "Haussier (cassé)" : "Baissier (cassé)",
          outcome: crossedUp
            ? "Résistance cassée → Cible suivante activée"
            : "Support cassé → Prochain support activé",
          timestamp: new Date().toLocaleTimeString(),
        };
      }
    }

    return {
      levels,
      nextResistance,
      nextSupport,
      currentLevel,
      levelBroken,
      totalStrikes: levels.reduce((sum, l) => sum + l.strikes, 0),
    };
  };

  // Track level history
  useEffect(() => {
    if (esData || nqData) {
      const prev = previousDataRef.current;
      const newChanges = {};

      if (prev.es && esData) {
        const spotChange = esData.spot - prev.es.spot;
        const triggerChange = esData.volTrigger - prev.es.volTrigger;

        if (Math.abs(spotChange) > 0.01 || Math.abs(triggerChange) > 0.01) {
          newChanges.es = { spot: spotChange, volTrigger: triggerChange };

          // Track level history for break detection
          setLevelHistory((prevHistory) => ({
            ...prevHistory,
            es: [
              ...prevHistory.es.slice(-5), // Keep last 5
              {
                spot: esData.spot,
                price: esData.volTrigger,
                label: "Zero Gamma",
                timestamp: Date.now(),
              },
            ],
          }));
        }
      }

      if (prev.nq && nqData) {
        const spotChange = nqData.spot - prev.nq.spot;
        const triggerChange = nqData.volTrigger - prev.nq.volTrigger;

        if (Math.abs(spotChange) > 0.01 || Math.abs(triggerChange) > 0.01) {
          newChanges.nq = { spot: spotChange, volTrigger: triggerChange };

          setLevelHistory((prevHistory) => ({
            ...prevHistory,
            nq: [
              ...prevHistory.nq.slice(-5),
              {
                spot: nqData.spot,
                price: nqData.volTrigger,
                label: "Zero Gamma",
                timestamp: Date.now(),
              },
            ],
          }));
        }
      }

      if (Object.keys(newChanges).length > 0) {
        setChanges(newChanges);
      }

      previousDataRef.current = {
        es: esData ? { ...esData } : null,
        nq: nqData ? { ...nqData } : null,
      };
    }
  }, [esData?.spot, esData?.volTrigger, nqData?.spot, nqData?.volTrigger]);

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

  // Ticker Card with enhanced levels
  const renderTickerCard = (meta, tickerName, ticker, correlatedMeta) => {
    if (!meta) {
      return (
        <div className="ticker-card">
          <h3>{tickerName}</h3>
          <p className="no-data">Données non disponibles</p>
        </div>
      );
    }

    const regime = getGammaRegime(meta);
    const balance = getMarketBalance(meta, ticker);
    const intradayTarget = calculateIntradayTarget(meta, null, regime);
    const probability = calculateMarketProbability(
      meta,
      regime,
      balance,
      correlatedMeta
    );
    const keyLevels = getKeyLevelsAnalysis(
      meta,
      regime,
      balance,
      ticker,
      intradayTarget
    );
    const tickerChanges = changes[ticker] || {};

    // Determine realistic intraday target
    const realisticTarget =
      probability.bullish > 50
        ? Math.min(
            keyLevels.nextResistance?.price || intradayTarget.bullishTarget,
            intradayTarget.bullishTarget
          )
        : Math.max(
            keyLevels.nextSupport?.price || intradayTarget.bearishTarget,
            intradayTarget.bearishTarget
          );

    return (
      <div className="ticker-card-simple">
        <div className="ticker-header">
          <h3>{tickerName}</h3>
          <div className="spot-price">
            {meta.spot.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            {formatChange(tickerChanges.spot, 2)}
          </div>
        </div>

        {/* Total Strikes Info */}
        <div className="strikes-info">
          📊 <strong>{keyLevels.totalStrikes}</strong> strikes entre les niveaux
          clés
          {intradayTarget.hoursRemaining > 0 && (
            <span className="time-remaining">
              {" "}
              · {intradayTarget.hoursRemaining.toFixed(1)}h restantes
            </span>
          )}
        </div>

        {/* Probability Gauge */}
        <div className="probability-section">
          <h4>📊 Probabilité de Mouvement</h4>
          <div className="probability-gauge">
            <div className="gauge-bar">
              <div
                className="gauge-fill bullish"
                style={{ width: `${probability.bullish}%` }}
              >
                {probability.bullish > 15 && (
                  <span className="gauge-label">
                    🟢 {probability.bullish.toFixed(0)}%
                  </span>
                )}
              </div>
              <div
                className="gauge-fill bearish"
                style={{ width: `${probability.bearish}%` }}
              >
                {probability.bearish > 15 && (
                  <span className="gauge-label">
                    🔴 {probability.bearish.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={`bias-badge ${probability.bias.toLowerCase()}`}>
            {probability.bias} ({probability.strength})
          </div>
        </div>

        {/* Level Broken Alert */}
        {keyLevels.levelBroken && (
          <div className="alert-box level-broken">
            <strong>🚨 Dernier Niveau Franchi :</strong>{" "}
            {keyLevels.levelBroken.level} (
            {keyLevels.levelBroken.price.toFixed(2)})
            <div className="broken-implication">
              {keyLevels.levelBroken.direction} ·{" "}
              {keyLevels.levelBroken.outcome}
              <br />
              <small>{keyLevels.levelBroken.timestamp}</small>
            </div>
          </div>
        )}

        {/* Current Level */}
        {keyLevels.currentLevel && (
          <div className="current-level-box">
            <strong>📍 Niveau Actuel :</strong> {keyLevels.currentLevel.label}
            <div className="current-level-price">
              {keyLevels.currentLevel.price.toFixed(2)} (
              {keyLevels.currentLevel.strikes} strikes)
            </div>
            <div className="current-level-behavior">
              {keyLevels.currentLevel.behavior}
            </div>
          </div>
        )}

        {/* Next Level (Most Important) */}
        {(keyLevels.nextResistance || keyLevels.nextSupport) && (
          <div className="next-level-priority">
            <h4>🎯 Prochain Niveau Clé</h4>
            {probability.bullish > 50 && keyLevels.nextResistance ? (
              <div className="level-priority resistance">
                <div className="level-priority-header">
                  <span className="level-priority-icon">📈</span>
                  <span className="level-priority-name">
                    {keyLevels.nextResistance.label}
                  </span>
                  <span className="level-priority-distance">
                    {keyLevels.nextResistance.strikes} strikes
                  </span>
                </div>
                <div className="level-priority-price">
                  {keyLevels.nextResistance.price.toFixed(2)}
                  <span className="level-priority-points">
                    (+{keyLevels.nextResistance.distancePoints.toFixed(1)} pts)
                  </span>
                </div>
                <div className="level-priority-behavior">
                  <strong>Comportement :</strong>{" "}
                  {keyLevels.nextResistance.behavior}
                </div>
                <div className="level-priority-strength">
                  Force : <strong>{keyLevels.nextResistance.strength}</strong>
                </div>
              </div>
            ) : keyLevels.nextSupport ? (
              <div className="level-priority support">
                <div className="level-priority-header">
                  <span className="level-priority-icon">📉</span>
                  <span className="level-priority-name">
                    {keyLevels.nextSupport.label}
                  </span>
                  <span className="level-priority-distance">
                    {keyLevels.nextSupport.strikes} strikes
                  </span>
                </div>
                <div className="level-priority-price">
                  {keyLevels.nextSupport.price.toFixed(2)}
                  <span className="level-priority-points">
                    ({keyLevels.nextSupport.distancePoints.toFixed(1)} pts)
                  </span>
                </div>
                <div className="level-priority-behavior">
                  <strong>Comportement :</strong>{" "}
                  {keyLevels.nextSupport.behavior}
                </div>
                <div className="level-priority-strength">
                  Force : <strong>{keyLevels.nextSupport.strength}</strong>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Intraday Target */}
        <div className="target-section">
          <h4>🎲 Cible Intraday Réaliste</h4>
          <div
            className={`target-box ${
              probability.bullish > 50 ? "bullish" : "bearish"
            }`}
          >
            <div className="target-label">
              {probability.bullish > 50 ? "Cible Haussière" : "Cible Baissière"}
            </div>
            <div className="target-price">{realisticTarget.toFixed(2)}</div>
            <div className="target-range">
              Mouvement max : ±{intradayTarget.maxMove.toFixed(1)} pts
            </div>
            <div className="target-action">
              {probability.bullish > 50
                ? balance.callDominance > 60
                  ? "⚠️ Forte résistance avant cible"
                  : "✅ Voie dégagée"
                : balance.putDominance > 60
                ? "✅ Support fort attendu"
                : "⚠️ Support faible"}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="summary-box">
          <strong>📝 Résumé :</strong>
          <div className="summary-text">
            {probability.bias} ({probability.bullish.toFixed(0)}%/
            {probability.bearish.toFixed(0)}%). Cible intraday :{" "}
            <strong>{realisticTarget.toFixed(2)}</strong>
            {keyLevels.nextResistance && probability.bullish > 50 && (
              <>
                {" "}
                via {keyLevels.nextResistance.label} (
                {keyLevels.nextResistance.strength})
              </>
            )}
            {keyLevels.nextSupport && probability.bullish <= 50 && (
              <>
                {" "}
                vers {keyLevels.nextSupport.label} (
                {keyLevels.nextSupport.strength})
              </>
            )}
            .
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
          <h2>🎯 Analyse Actionnable GEX</h2>
          <p className="summary-subtitle">
            Niveaux clés • Strikes • Cibles intraday •{" "}
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

        {/* Side by side tickers with correlation */}
        <div className="tickers-grid">
          {renderTickerCard(esData, "ES/SPX", "es", nqData)}
          {renderTickerCard(nqData, "NQ/NDX", "nq", esData)}
        </div>

        {/* 0DTE Warning */}
        {esData?.frontDte === 0 && (
          <div className="analysis-section">
            <div className="alert-box warning">
              <strong>⚠️ 0DTE :</strong> Gamma explosif après 14h EST. Les
              niveaux deviennent des aimants puissants. Cibles limitées au temps
              restant.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
