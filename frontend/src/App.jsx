import { useRef, useState, useEffect } from "react";
import "./App.css";
import IndicatorSummary from "./IndicatorSummary";

// Configuration API GexBot
const GEXBOT_API_KEY =
  import.meta.env.VITE_GEXBOT_API_KEY || "YOUR_API_KEY_HERE";

// Détection automatique de l'environnement
const BASE_URL = import.meta.env.DEV
  ? "/api/gexbot" // En dev local avec Vite proxy
  : "/api/gexbot"; // En production sur Vercel avec serverless function

const API_TIMEOUT = 10000;

// Configuration des tickers
const TICKERS = {
  SPX: {
    target: "ES",
    description: "SPX GEX for ES Futures",
    multiplier: 1.00685,
  },
  NDX: {
    target: "NQ",
    description: "NDX GEX for NQ Futures",
    multiplier: 1.00842,
  },
  QQQ: {
    target: "NQ",
    description: "QQQ GEX for NQ Futures",
    multiplier: 40.0, // QQQ est environ 1/40ème du NDX/NQ
  },
};

const DTE_PERIODS = { zero: "ZERO", one: "ONE", full: "FULL" };

function App() {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gexData, setGexData] = useState({
    es: { zero: [], one: [], full: [] },
    nq: { zero: [], one: [], full: [] },
  });
  const [pineCode, setPineCode] = useState("");
  const [lastUpdate, setLastUpdate] = useState("");
  const [metadataMap, setMetadataMap] = useState({});
  const featuresRef = useRef(null);
  const initializedRef = useRef(false);

  // Fetch GEX data from API
  const fetchGexData = async (ticker, aggregation) => {
    const url = `${BASE_URL}/${ticker}/classic/${aggregation}?key=${GEXBOT_API_KEY}`;

    console.log(`📡 Calling API: ${url.replace(GEXBOT_API_KEY, "***")}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(
        `✅ ${ticker}/${aggregation} - ${data.strikes?.length || 0} strikes`
      );
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        console.error(`⏱️ Timeout fetching ${ticker}/${aggregation}`);
      } else {
        console.error(`❌ Error fetching ${ticker}/${aggregation}:`, e);
      }
      return null;
    }
  };

  // Fetch majors data
  const fetchGexMajors = async (ticker, aggregation) => {
    const url = `${BASE_URL}/${ticker}/classic/${aggregation}/majors?key=${GEXBOT_API_KEY}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;
      const data = await response.json();
      // DEBUG: log majors API response for troubleshooting
      console.log(`📥 /majors response for ${ticker}/${aggregation}:`, data);
      return data;
    } catch (e) {
      // Log errors for visibility
      console.error(
        `❌ Error fetching majors for ${ticker}/${aggregation}:`,
        e
      );
      return null;
    }
  };

  // Calculate advanced levels
  const calculateAdvancedLevels = (strikes, spot) => {
    let callResistanceTotal = 0;
    let putSupportTotal = 0;
    const callWalls = [];
    const putWalls = [];
    const hvlCandidates = [];

    strikes.forEach((strikeArray) => {
      if (Array.isArray(strikeArray) && strikeArray.length >= 3) {
        const strikePrice = strikeArray[0];
        const gexVol = strikeArray[1];
        const gexOi = strikeArray[2];
        const totalGex = gexVol + gexOi;
        const absTotalGex = Math.abs(totalGex);

        if (strikePrice > spot && totalGex > 0) {
          callResistanceTotal += totalGex;
        } else if (strikePrice < spot && totalGex < 0) {
          putSupportTotal += Math.abs(totalGex);
        }

        if (totalGex > 0) {
          callWalls.push({
            strike: strikePrice,
            gex: totalGex,
            abs_gex: absTotalGex,
          });
        } else if (totalGex < 0) {
          putWalls.push({
            strike: strikePrice,
            gex: totalGex,
            abs_gex: absTotalGex,
          });
        }

        const distancePct =
          spot > 0 ? Math.abs(((strikePrice - spot) / spot) * 100) : 0;
        if (distancePct < 1.5 && absTotalGex > 500) {
          hvlCandidates.push({
            strike: strikePrice,
            abs_gex: absTotalGex,
            distance_pct: distancePct,
          });
        }
      }
    });

    callWalls.sort((a, b) => b.abs_gex - a.abs_gex);
    putWalls.sort((a, b) => b.abs_gex - a.abs_gex);
    hvlCandidates.sort((a, b) => b.abs_gex - a.abs_gex);

    return {
      call_res_all: callResistanceTotal,
      put_sup_all: putSupportTotal,
      top_call_wall: callWalls[0] || null,
      top_put_wall: putWalls[0] || null,
      all_call_walls: callWalls.slice(0, 5),
      all_put_walls: putWalls.slice(0, 5),
      hvl_levels: hvlCandidates.slice(0, 3),
    };
  };

  // Generate levels from chain data
  const generateLevels = (sourceTicker, chainData, majorsData) => {
    if (!chainData || !chainData.strikes) return { levels: [], metadata: {} };

    const spotPrice = chainData.spot || 0;
    const frontExpiryDte = chainData.min_dte || 0;
    const nextExpiryDte = chainData.sec_min_dte || 0;
    const volatilityTrigger = chainData.zero_gamma || 0;
    const strikeGexCurve = chainData.strikes || [];

    const isZeroDte = frontExpiryDte === 0;
    const dteDisplay = isZeroDte ? "0DTE" : `${frontExpiryDte}DTE`;

    const advanced = calculateAdvancedLevels(strikeGexCurve, spotPrice);

    // DEBUG: log classic raw and advanced calculations when majorsData is not provided
    if (!majorsData) {
      console.log(`🔎 classic raw for ${sourceTicker}:`, {
        zero_gamma: volatilityTrigger,
        sum_gex_vol: chainData.sum_gex_vol,
        sum_gex_oi: chainData.sum_gex_oi,
        spot: spotPrice,
        strikes_count: strikeGexCurve.length,
      });
      console.log(`🔎 classic advanced for ${sourceTicker}:`, advanced);
    }

    const levels = [];

    // IMPORTANCE 10 - Volatility Trigger
    if (volatilityTrigger && volatilityTrigger !== 0) {
      const regime =
        spotPrice > volatilityTrigger ? "Negative Gamma" : "Positive Gamma";
      levels.push({
        strike: Math.round(volatilityTrigger * 100) / 100,
        importance: 10,
        type: "zero_gamma",
        label: "Zero Gamma - Vol Trigger",
        dte: dteDisplay,
        description: `Vol trigger - ${regime}`,
        source: "classic",
      });
    }

    // IMPORTANCE 10 - Major Walls
    if (advanced.top_call_wall) {
      levels.push({
        strike: Math.round(advanced.top_call_wall.strike * 100) / 100,
        importance: 10,
        type: "major_call_wall",
        label: "Major Call Wall",
        dte: dteDisplay,
        description: `Primary call resistance - ${Math.round(
          advanced.top_call_wall.abs_gex
        )} GEX`,
        source: "classic",
      });
    }

    if (advanced.top_put_wall) {
      levels.push({
        strike: Math.round(advanced.top_put_wall.strike * 100) / 100,
        importance: 10,
        type: "major_put_wall",
        label: "Major Put Wall",
        dte: dteDisplay,
        description: `Primary put support - ${Math.round(
          advanced.top_put_wall.abs_gex
        )} GEX`,
        source: "classic",
      });
    }

    // IMPORTANCE 9 - HVL
    advanced.hvl_levels.forEach((hvl, idx) => {
      levels.push({
        strike: Math.round(hvl.strike * 100) / 100,
        importance: 9,
        type: "high_vol_level",
        label: `HVL #${idx + 1}`,
        dte: dteDisplay,
        description: `High vol zone - ${Math.round(
          hvl.abs_gex
        )} GEX @ ${hvl.distance_pct.toFixed(1)}%`,
        source: "classic",
      });
    });

    // IMPORTANCE 9 - 0DTE Walls
    if (isZeroDte) {
      const put0dte = advanced.all_put_walls
        .slice(0, 3)
        .filter((p) => p.strike < spotPrice);
      put0dte.slice(0, 2).forEach((ps, idx) => {
        levels.push({
          strike: Math.round(ps.strike * 100) / 100,
          importance: 9,
          type: "put_wall_0dte",
          label: `Put Wall 0DTE #${idx + 1}`,
          dte: dteDisplay,
          description: `0DTE put support - ${Math.round(ps.abs_gex)} GEX`,
          source: "classic",
        });
      });

      const call0dte = advanced.all_call_walls
        .slice(0, 3)
        .filter((c) => c.strike > spotPrice);
      call0dte.slice(0, 2).forEach((cr, idx) => {
        levels.push({
          strike: Math.round(cr.strike * 100) / 100,
          importance: 9,
          type: "call_wall_0dte",
          label: `Call Wall 0DTE #${idx + 1}`,
          dte: dteDisplay,
          description: `0DTE call resistance - ${Math.round(cr.abs_gex)} GEX`,
          source: "classic",
        });
      });
    }

    // IMPORTANCE 10/9/8 - Walls from API /majors
    const majorDataSource = majorsData || chainData;

    // ✅ Extraire TOUS les 5 niveaux de l'API /majors
    const callWallVolume = majorDataSource.mpos_vol || 0;
    const putWallVolume = majorDataSource.mneg_vol || 0;
    const callWallOi = majorDataSource.mpos_oi || 0;
    const putWallOi = majorDataSource.mneg_oi || 0;
    const zeroGammaMajors = majorDataSource.zero_gamma || 0;

    // DEBUG: show raw majors-derived values
    if (majorsData) {
      console.log(`🔎 majors raw for ${sourceTicker}:`, {
        zero_gamma: zeroGammaMajors,
        mpos_vol: callWallVolume,
        mpos_oi: callWallOi,
        mneg_vol: putWallVolume,
        mneg_oi: putWallOi,
        spot: majorDataSource.spot,
      });
    }

    // Déterminer si les données viennent de majors ou classic
    const dataSource = majorsData ? "majors" : "classic";

    // ✅ ZERO GAMMA FROM MAJORS (importance 10)
    if (zeroGammaMajors && zeroGammaMajors !== 0 && dataSource === "majors") {
      levels.push({
        strike: Math.round(zeroGammaMajors * 100) / 100,
        importance: 10,
        type: "zero_gamma_majors",
        label: "Zero Gamma - API",
        dte: dteDisplay,
        description: "Zero gamma from majors API",
        source: dataSource,
      });
    }

    // ✅ CALL WALL VOLUME (importance 9)
    if (callWallVolume && callWallVolume !== 0) {
      console.log(`➕ adding call_wall_volume ${callWallVolume}`);
      levels.push({
        strike: Math.round(callWallVolume * 100) / 100,
        importance: 9,
        type: "call_wall_volume",
        label:
          dataSource === "majors" ? "Call Wall (Vol) - API" : "Call Wall Vol",
        dte: dteDisplay,
        description:
          dataSource === "majors"
            ? "Call wall from majors API"
            : "Call wall from volume data",
        source: dataSource,
      });
    }

    if (putWallVolume && putWallVolume !== 0) {
      console.log(`➕ adding put_wall_volume ${putWallVolume}`);
      levels.push({
        strike: Math.round(putWallVolume * 100) / 100,
        importance: 9,
        type: "put_wall_volume",
        label:
          dataSource === "majors" ? "Put Wall (Vol) - API" : "Put Wall Vol",
        dte: dteDisplay,
        description:
          dataSource === "majors"
            ? "Put wall from majors API"
            : "Put wall from volume data",
        source: dataSource,
      });
    }

    if (callWallOi && callWallOi !== 0) {
      console.log(`➕ adding call_wall_oi ${callWallOi}`);
      levels.push({
        strike: Math.round(callWallOi * 100) / 100,
        importance: 8,
        type: "call_wall_oi",
        label:
          dataSource === "majors" ? "Call Wall (OI) - API" : "Call Wall OI",
        dte: dteDisplay,
        description:
          dataSource === "majors"
            ? "Call wall OI from majors API"
            : "Call wall from open interest",
        source: dataSource,
      });
    }

    if (putWallOi && putWallOi !== 0) {
      console.log(`➕ adding put_wall_oi ${putWallOi}`);
      levels.push({
        strike: Math.round(putWallOi * 100) / 100,
        importance: 8,
        type: "put_wall_oi",
        label:
          dataSource === "majors" ? "Call Wall (Vol) - API" : "Call Wall Vol",
        dte: dteDisplay,
        description:
          dataSource === "majors"
            ? "Put wall OI from majors API"
            : "Put wall from open interest",
        source: dataSource,
      });
    }

    // IMPORTANCE 8 - Secondary Walls
    advanced.all_call_walls.slice(1, 4).forEach((cw, idx) => {
      levels.push({
        strike: Math.round(cw.strike * 100) / 100,
        importance: 8,
        type: "call_wall_secondary",
        label: `Call Wall #${idx + 2}`,
        dte: dteDisplay,
        description: `Secondary call resistance - ${Math.round(
          cw.abs_gex
        )} GEX`,
        source: "classic",
      });
    });

    advanced.all_put_walls.slice(1, 4).forEach((pw, idx) => {
      levels.push({
        strike: Math.round(pw.strike * 100) / 100,
        importance: 8,
        type: "put_wall_secondary",
        label: `Put Wall #${idx + 2}`,
        dte: dteDisplay,
        description: `Secondary put support - ${Math.round(pw.abs_gex)} GEX`,
        source: "classic",
      });
    });

    // IMPORTANCE 8 - Max Pain
    let minGex = Infinity;
    let maxPain = null;
    strikeGexCurve.forEach((strikeArray) => {
      if (Array.isArray(strikeArray) && strikeArray.length >= 3) {
        const totalGex = Math.abs(strikeArray[1] + strikeArray[2]);
        if (totalGex < minGex) {
          minGex = totalGex;
          maxPain = strikeArray[0];
        }
      }
    });

    if (maxPain) {
      levels.push({
        strike: Math.round(maxPain * 100) / 100,
        importance: 8,
        type: "max_pain",
        label: "Max Pain",
        dte: dteDisplay,
        description: "Expiration target - min GEX",
        source: "classic",
      });
    }

    // IMPORTANCE 7 - Individual Strikes
    const strikesData = [];
    strikeGexCurve.forEach((strikeArray) => {
      if (Array.isArray(strikeArray) && strikeArray.length >= 3) {
        const totalGexSum = strikeArray[1] + strikeArray[2];
        const totalGex = Math.abs(totalGexSum);
        if (totalGex > 100) {
          strikesData.push({
            strike: Math.round(strikeArray[0] * 100) / 100,
            total_gex: totalGex,
            is_call: totalGexSum > 0,
          });
        }
      }
    });

    strikesData.sort((a, b) => b.total_gex - a.total_gex);
    strikesData.slice(0, 15).forEach((s) => {
      const strikeType = s.is_call ? "Call Strike" : "Put Strike";
      const strikeDesc = s.is_call ? "Call strike" : "Put strike";
      levels.push({
        strike: s.strike,
        importance: 7,
        type: s.is_call ? "strike_call" : "strike_put",
        label: strikeType,
        dte: dteDisplay,
        description: `${strikeDesc} - ${Math.round(s.total_gex)} GEX`,
        source: "classic",
      });
    });

    // DEBUG: show summary of classic/majors levels before deduplication
    try {
      const classicPreview = levels.filter((l) => l.source === "classic");
      const majorsPreview = levels.filter((l) => l.source === "majors");
      if (classicPreview.length > 0) {
        console.log(`📋 classic levels (${sourceTicker}):`, classicPreview);
        // Also show grouped by strike to highlight duplicates
        const grouped = classicPreview.reduce((acc, lv) => {
          const k = String(lv.strike);
          if (!acc[k]) acc[k] = [];
          acc[k].push(lv);
          return acc;
        }, {});
        console.log(
          `📊 classic levels grouped by strike (${sourceTicker}):`,
          grouped
        );
      }
      if (majorsPreview.length > 0) {
        console.log(`📋 majors levels (${sourceTicker}):`, majorsPreview);
      }
    } catch (e) {
      console.error("Error logging level previews:", e);
    }

    // Keep all levels provided (no deduplication) so both `classic` and `majors`
    // entries are available initially. Sort by importance for display then
    // merge entries that share the same strike into a single line with
    // combined labels/types/descriptions/sources.
    const uniqueLevels = levels.slice();
    uniqueLevels.sort((a, b) => b.importance - a.importance);

    // Merge same-strike entries into one level with combined fields
    const mergedByStrike = new Map();
    uniqueLevels.forEach((lv) => {
      const key = String(lv.strike);
      if (!mergedByStrike.has(key)) {
        mergedByStrike.set(key, {
          strike: lv.strike,
          importance: lv.importance || 0,
          // dominantType will determine display color (type of most important level)
          dominantType: lv.type,
          types: new Set([lv.type]),
          labels: new Set([lv.label]),
          descriptions: new Set([lv.description || ""]),
          dte: lv.dte,
          sources: new Set([lv.source || "classic"]),
        });
      } else {
        const ex = mergedByStrike.get(key);
        // if incoming has higher importance, update dominantType
        if ((lv.importance || 0) > (ex.importance || 0)) {
          ex.importance = lv.importance || 0;
          ex.dominantType = lv.type;
        } else {
          ex.importance = Math.max(ex.importance, lv.importance || 0);
        }
        ex.types.add(lv.type);
        ex.labels.add(lv.label);
        if (lv.description) ex.descriptions.add(lv.description);
        ex.sources.add(lv.source || "classic");
      }
    });

    const finalLevels = Array.from(mergedByStrike.values()).map((m) => ({
      strike: m.strike,
      importance: m.importance,
      // use dominantType for display/color, combine all labels into title
      type: m.dominantType || Array.from(m.types).join("/"),
      label: Array.from(m.labels).join(" / "),
      dte: m.dte,
      description: Array.from(m.descriptions).filter(Boolean).join(" | "),
      source: Array.from(m.sources).join("/"),
    }));

    finalLevels.sort((a, b) => b.importance - a.importance);

    const metadata = {
      data_timestamp: chainData.timestamp || 0,
      underlying_symbol: chainData.ticker || sourceTicker,
      spot_price: spotPrice,
      front_expiry_dte: frontExpiryDte,
      next_expiry_dte: nextExpiryDte,
      volatility_trigger: volatilityTrigger,
      net_gex_volume: chainData.sum_gex_vol || 0,
      net_gex_oi: chainData.sum_gex_oi || 0,
      call_res_all: advanced.call_res_all,
      put_sup_all: advanced.put_sup_all,
    };

    // DEBUG: log final unique levels returned for visibility
    try {
      console.log(
        `✅ final levels for ${sourceTicker} (${dteDisplay}):`,
        uniqueLevels
      );
    } catch (e) {
      console.error("Error logging final levels:", e);
    }

    return { levels: uniqueLevels, metadata };
  };

  // Convert levels to CSV string
  const levelsToCSV = (levels) => {
    if (!levels || levels.length === 0) return "";

    const headers = "strike,importance,type,label,dte,description,source";
    const rows = levels.map((level) => {
      // Nettoyer la description
      const cleanDesc = (level.description || "")
        .replace(/"/g, "") // Supprimer guillemets
        .replace(/'/g, "") // Supprimer apostrophes
        .replace(/\n/g, " ") // Remplacer sauts de ligne par espaces
        .replace(/\r/g, "") // Supprimer retours chariot
        .replace(/@/g, "") // Supprimer @
        .replace(/,/g, "-") // Remplacer virgules par tirets
        .replace(/\|/g, "") // Supprimer pipes
        .replace(/\\/g, "") // Supprimer backslashes
        .trim();

      return `${level.strike},${level.importance},${level.type},${
        level.label
      },${level.dte},${cleanDesc},${level.source || "classic"}`;
    });

    // DEUX backslashes pour Pine Script (devient \n dans la string)
    return headers + "\\\\n" + rows.join("\\\\n");
  };

  // Convert metadata to Pine Script string
  const metadataToString = (metadata) => {
    return `Timestamp:${metadata.data_timestamp}|Symbol:${
      metadata.underlying_symbol
    }|Spot:${metadata.spot_price.toFixed(2)}|FrontDTE:${
      metadata.front_expiry_dte
    }|NextDTE:${
      metadata.next_expiry_dte
    }|VolTrigger:${metadata.volatility_trigger.toFixed(
      2
    )}|NetGEXVol:${metadata.net_gex_volume.toFixed(
      2
    )}|NetGEXOI:${metadata.net_gex_oi.toFixed(
      2
    )}|CallResAll:${metadata.call_res_all.toFixed(
      2
    )}|PutSupAll:${metadata.put_sup_all.toFixed(2)}`;
  };

  // Generate Pine Script with data
  const generatePineScript = (csvDataDict, metadataDict) => {
    const spxMultiplier = TICKERS.SPX.multiplier;
    const ndxMultiplier = TICKERS.NDX.multiplier;
    const qqqMultiplier = TICKERS.QQQ.multiplier;

    return `//@version=6
indicator("GEX Professional Levels", overlay=true, max_lines_count=500, max_labels_count=500)

// ==================== CSV DATA (AUTO-GENERATED) ====================
string es_csv_zero = "${csvDataDict.es_zero || ""}"
string es_csv_one = "${csvDataDict.es_one || ""}"
string es_csv_full = "${csvDataDict.es_full || ""}"
string nq_csv_zero = "${csvDataDict.nq_zero || ""}"
string nq_csv_one = "${csvDataDict.nq_one || ""}"
string nq_csv_full = "${csvDataDict.nq_full || ""}"
string qqq_csv_zero = "${csvDataDict.qqq_zero || ""}"
string qqq_csv_one = "${csvDataDict.qqq_one || ""}"
string qqq_csv_full = "${csvDataDict.qqq_full || ""}"

// ==================== METADATA ====================
string es_meta_zero = "${metadataDict.es_zero || ""}"
string es_meta_one = "${metadataDict.es_one || ""}"
string es_meta_full = "${metadataDict.es_full || ""}"
string nq_meta_zero = "${metadataDict.nq_zero || ""}"
string nq_meta_one = "${metadataDict.nq_one || ""}"
string nq_meta_full = "${metadataDict.nq_full || ""}"
string qqq_meta_zero = "${metadataDict.qqq_zero || ""}"
string qqq_meta_one = "${metadataDict.qqq_one || ""}"
string qqq_meta_full = "${metadataDict.qqq_full || ""}"

// ==================== AUTO-DETECTION TICKER ====================
string detected_ticker = "ES"
if str.contains(syminfo.ticker, "NQ") or str.contains(syminfo.ticker, "NDX") or str.contains(syminfo.ticker, "NAS")
    detected_ticker := "NQ"
else if str.contains(syminfo.ticker, "ES") or str.contains(syminfo.ticker, "SPX") or str.contains(syminfo.ticker, "SP500")
    detected_ticker := "ES"

// ==================== MULTIPLICATEURS MODIFIABLES ====================
float SPX_MULTIPLIER = input.float(${spxMultiplier}, "🔢 Multiplicateur SPX", minval=0.5, maxval=2.0, step=0.00001, group="⚙️ Multiplicateurs", tooltip="Ajustement de conversion SPX vers ES (défaut: ${spxMultiplier})")
float NDX_MULTIPLIER = input.float(${ndxMultiplier}, "🔢 Multiplicateur NDX", minval=0.5, maxval=2.0, step=0.00001, group="⚙️ Multiplicateurs", tooltip="Ajustement de conversion NDX vers NQ (défaut: ${ndxMultiplier})")
float QQQ_MULTIPLIER = input.float(${qqqMultiplier}, "🔢 Multiplicateur QQQ", minval=1.0, maxval=100.0, step=0.1, group="⚙️ Multiplicateurs", tooltip="Conversion QQQ vers NQ - QQQ est ~1/40ème du NQ (défaut: ${qqqMultiplier})")


// ==================== SÉLECTEUR DE SOURCE D'OPTIONS ====================
string nq_options_source = input.string("NDX", "🎯 Source Options NQ", options=["NDX", "QQQ"], group="🎯 Settings", tooltip="Choisir la source des données d'options pour NQ: NDX (indice) ou QQQ (ETF)")

float conversion_multiplier = 1.0
bool needs_conversion = false

if detected_ticker == "ES"
    if str.contains(syminfo.ticker, "ES") and not str.contains(syminfo.ticker, "SPX")
        conversion_multiplier := SPX_MULTIPLIER
        needs_conversion := true
else if detected_ticker == "NQ"
    if str.contains(syminfo.ticker, "NQ") and not str.contains(syminfo.ticker, "NDX")
        if nq_options_source == "NDX"
            conversion_multiplier := NDX_MULTIPLIER
        else
            conversion_multiplier := QQQ_MULTIPLIER
        needs_conversion := true

// ==================== PARAMÈTRES ====================
string selected_dte = input.string("0DTE", "📅 DTE Period", options=["0DTE", "1DTE", "FULL"], group="🎯 Settings", tooltip="Days To Expiration")

// ==================== FILTRES PAR SOURCE DE DONNÉES ====================
bool show_classic_levels = input.bool(true, "📊 Niveaux Classic (Calculés)", group="🔌 Data Sources", tooltip="Afficher les niveaux calculés depuis la route /classic")
bool show_majors_levels = input.bool(true, "🎯 Niveaux Majors (API)", group="🔌 Data Sources", tooltip="Afficher les niveaux directs depuis la route /majors")

// ==================== FILTRES PAR IMPORTANCE ====================
bool show_imp_10 = input.bool(true, "Importance 10 (Major Walls/Volatility Trigger)", group="🎯 Importance Filters")
bool show_imp_9 = input.bool(true, "Importance 9 (High Vol Levels, 0DTE Walls)", group="🎯 Importance Filters")
bool show_imp_8 = input.bool(true, "Importance 8 (Secondary Walls, Max Pain)", group="🎯 Importance Filters")
bool show_imp_7 = input.bool(false, "Importance 7 (Individual Strikes, Vol Triggers)", group="🎯 Importance Filters")

// ==================== FILTRES PAR TYPE ====================
bool show_volatility_trigger = input.bool(true, "Volatility Trigger", group="📌 Level Types", tooltip="Zero gamma flip point")
bool show_major_walls = input.bool(true, "Major Call/Put Walls", group="📌 Level Types", tooltip="Primary resistance and support")
bool show_high_vol_levels = input.bool(true, "High Vol Levels (HVL)", group="📌 Level Types", tooltip="High volatility zones near spot")
bool show_0dte_walls = input.bool(true, "0DTE Call/Put Walls", group="📌 Level Types", tooltip="Same-day expiry walls")
bool show_secondary_walls = input.bool(true, "Secondary Walls", group="📌 Level Types", tooltip="Call resistance and put support #2-4")
bool show_max_pain = input.bool(true, "Max Pain Level", group="📌 Level Types", tooltip="Expiration target strike")
bool show_individual_strikes = input.bool(false, "Individual Strikes", group="📌 Level Types", tooltip="Top 15 strikes by GEX")
bool show_vol_triggers = input.bool(false, "Vol Triggers (Timeframe)", group="📌 Level Types", tooltip="GEX change triggers by interval")

// ==================== STYLE ====================
color color_volatility_trigger = input.color(color.new(color.purple, 0), "Volatility Trigger", group="🎨 Colors", inline="c1")
color color_major_call_wall = input.color(color.new(color.red, 0), "Major Call Wall", group="🎨 Colors", inline="c2")
color color_major_put_wall = input.color(color.new(color.green, 0), "Major Put Wall", group="🎨 Colors", inline="c3")
color color_high_vol_level = input.color(color.new(color.orange, 0), "High Vol Level", group="🎨 Colors", inline="c4")
color color_0dte_walls = input.color(color.new(color.yellow, 0), "0DTE Walls", group="🎨 Colors", inline="c5")
color color_secondary_walls = input.color(color.new(color.gray, 30), "Secondary Walls", group="🎨 Colors", inline="c6")
color color_max_pain = input.color(color.new(color.blue, 0), "Max Pain", group="🎨 Colors", inline="c7")
color color_strikes = input.color(color.new(color.silver, 50), "Individual Strikes", group="🎨 Colors", inline="c8")
color color_vol_trigger = input.color(color.new(color.fuchsia, 0), "Vol Triggers", group="🎨 Colors", inline="c9")

// ==================== LABEL SETTINGS ====================
bool show_labels = input.bool(true, "Show Labels", group="🏷️ Labels", tooltip="Display level labels on chart")
bool show_descriptions = input.bool(false, "Show Descriptions", group="🏷️ Labels", tooltip="Add detailed descriptions to labels")
string label_size = input.string("Small", "Label Size", options=["Tiny", "Small", "Normal", "Large"], group="🏷️ Labels")
bool use_distance_filter = input.bool(false, "Filter Labels Near Price", group="🏷️ Labels", tooltip="Hide labels too close to current price")
float label_min_distance_pct = input.float(0.3, "Min Distance from Price (%)", minval=0, maxval=5, step=0.1, group="🏷️ Labels")
float price_tolerance = input.float(0.25, "Regroupement prix (points)", minval=0.1, maxval=5, step=0.1, group="🏷️ Labels", tooltip="Tolérance pour fusionner les niveaux proches")

// ==================== METADATA DISPLAY ====================
bool show_metadata = input.bool(false, "Show Market Info Table", group="📊 Metadata", tooltip="Display GEX metadata table")

// ==================== DEFINITIONS TABLE ====================
bool show_definitions = input.bool(false, "Afficher les Définitions", group="📖 Aide", tooltip="Tableau des définitions des termes GEX")

// ==================== STOCKAGE ====================
var array<line> all_lines = array.new<line>()
var array<label> all_labels = array.new<label>()

// ==================== STRUCTURE POUR REGROUPER LES NIVEAUX ====================
type LevelData
    float price
    array<string> labels
    array<string> descriptions
    string level_type
    int importance
    color level_color
    string source

// ==================== FONCTIONS ====================
get_label_size(string size) =>
    size == "Tiny" ? size.tiny : size == "Small" ? size.small : size == "Normal" ? size.normal : size.large

should_show_level(int importance, string level_type, string source) =>
    bool show_importance = (importance == 10 and show_imp_10) or (importance == 9 and show_imp_9) or (importance == 8 and show_imp_8) or (importance == 7 and show_imp_7)
    
    bool show_type = false
    if str.contains(level_type, "zero_gamma") or str.contains(level_type, "volatility_trigger")
        show_type := show_volatility_trigger
        show_type := show_volatility_trigger
    else if str.contains(level_type, "major_call_wall") or str.contains(level_type, "major_put_wall")
        show_type := show_major_walls
    else if str.contains(level_type, "high_vol_level")
        show_type := show_high_vol_levels
    else if str.contains(level_type, "0dte")
        show_type := show_0dte_walls
    else if str.contains(level_type, "call_resistance") or str.contains(level_type, "put_support") or str.contains(level_type, "call_wall") or str.contains(level_type, "put_wall")
        show_type := show_secondary_walls
    else if str.contains(level_type, "max_pain")
        show_type := show_max_pain
    else if str.contains(level_type, "strike_")
        show_type := show_individual_strikes
    else if str.contains(level_type, "vol_trigger")
        show_type := show_vol_triggers
    
    bool show_source = (source == "classic" and show_classic_levels) or (source == "majors" and show_majors_levels)
    
    show_importance and show_type and show_source

get_level_color(string level_type) =>
    color result = color_strikes
    if str.contains(level_type, "zero_gamma") or str.contains(level_type, "volatility_trigger")
        result := color_volatility_trigger
    else if str.contains(level_type, "major_call_wall")
        result := color_major_call_wall
    else if str.contains(level_type, "major_put_wall")
        result := color_major_put_wall
    else if str.contains(level_type, "high_vol_level")
        result := color_high_vol_level
    else if str.contains(level_type, "0dte")
        result := color_0dte_walls
    else if str.contains(level_type, "call_resistance") or str.contains(level_type, "put_support") or str.contains(level_type, "call_wall") or str.contains(level_type, "put_wall")
        result := color_secondary_walls
    else if str.contains(level_type, "max_pain")
        result := color_max_pain
    else if str.contains(level_type, "vol_trigger")
        result := color_vol_trigger
    result


clear_all_objects() =>
    if array.size(all_lines) > 0
        for i = 0 to (array.size(all_lines) - 1)
            line.delete(array.get(all_lines, i))
        array.clear(all_lines)
    if array.size(all_labels) > 0
        for j = 0 to (array.size(all_labels) - 1)
            label.delete(array.get(all_labels, j))
        array.clear(all_labels)

// ==================== NOUVELLE FONCTION POUR REGROUPER LES NIVEAUX ====================
find_existing_level(array<LevelData> levels, float price, float tolerance) =>
    int result = -1
    if array.size(levels) > 0
        for i = 0 to array.size(levels) - 1
            LevelData level = array.get(levels, i)
            if math.abs(level.price - price) <= tolerance
                result := i
                break
    result

process_csv(string csv_data) =>
    var array<LevelData> grouped_levels = array.new<LevelData>()
    
    if bar_index == last_bar_index
        array.clear(grouped_levels)
        
        lines_array = str.split(csv_data, "\\\\n")
        int total_lines = array.size(lines_array)
        int max_index = total_lines - 1

        if max_index > 0
            for idx = 1 to max_index
                if idx < total_lines
                    string line_str = array.get(lines_array, idx)
                    if str.length(line_str) > 10 and not str.contains(line_str, "strike,importance")
                        fields = str.split(line_str, ",")
                        int num_fields = array.size(fields)
                        if num_fields >= 6
                            string field0 = array.get(fields, 0)
                            string field1 = array.get(fields, 1)
                            if str.length(field0) > 0 and str.length(field1) > 0
                                float strike_price_raw = str.tonumber(field0)
                                int importance = int(str.tonumber(field1))
                                if not na(strike_price_raw) and not na(importance) and importance >= 7 and importance <= 10
                                    float strike_price = needs_conversion ? strike_price_raw * conversion_multiplier : strike_price_raw

                                    string level_type = array.get(fields, 2)
                                    string label_text = array.get(fields, 3)
                                    string description = num_fields >= 6 ? array.get(fields, 5) : ""
                                    string source = num_fields >= 7 ? array.get(fields, 6) : "classic"

                                    if should_show_level(importance, level_type, source)
                                        // Chercher si un niveau existe déjà à ce prix
                                        int existing_idx = find_existing_level(grouped_levels, strike_price, price_tolerance)
                                        
                                        if existing_idx >= 0
                                            // Fusionner avec le niveau existant
                                            LevelData existing = array.get(grouped_levels, existing_idx)
                                            array.push(existing.labels, label_text)
                                            if str.length(description) > 0
                                                array.push(existing.descriptions, description)
                                            // Prioriser l'importance la plus élevée
                                            if importance > existing.importance
                                                existing.importance := importance
                                                existing.level_type := level_type
                                                existing.level_color := get_level_color(level_type)
                                        else
                                            // Créer un nouveau niveau
                                            LevelData new_level = LevelData.new()
                                            new_level.price := strike_price
                                            new_level.labels := array.new<string>()
                                            new_level.descriptions := array.new<string>()
                                            array.push(new_level.labels, label_text)
                                            if str.length(description) > 0
                                                array.push(new_level.descriptions, description)
                                            new_level.level_type := level_type
                                            new_level.importance := importance
                                            new_level.level_color := get_level_color(level_type)
                                            new_level.source := source
                                            array.push(grouped_levels, new_level)
        
        // Dessiner les niveaux regroupés
        if array.size(grouped_levels) > 0
            for i = 0 to array.size(grouped_levels) - 1
                LevelData level = array.get(grouped_levels, i)
                
                // Créer la ligne
                line new_line = line.new(x1=bar_index[500], y1=level.price, x2=bar_index, y2=level.price, color=level.level_color, width=1, style=line.style_solid, extend=extend.both)
                array.push(all_lines, new_line)
                
                // Créer le label regroupé
                if show_labels
                    bool show_this_label = true
                    if use_distance_filter
                        float price_distance = math.abs(close - level.price)
                        float min_distance = close * (label_min_distance_pct / 100)
                        show_this_label := price_distance > min_distance

                    if show_this_label
                        // Construire le texte du label avec tous les labels fusionnés
                        string combined_labels = ""
                        int num_labels = array.size(level.labels)
                        if num_labels > 0
                            for j = 0 to num_labels - 1
                                if j > 0
                                    combined_labels := combined_labels + " + "
                                combined_labels := combined_labels + array.get(level.labels, j)
                        
                        string final_label = combined_labels + " " + str.tostring(level.price, "#.##")
                        
                        // Ajouter les descriptions si activé
                        if show_descriptions and array.size(level.descriptions) > 0
                            for k = 0 to array.size(level.descriptions) - 1
                                final_label := final_label + "\\n" + array.get(level.descriptions, k)

                        label new_label = label.new(x=bar_index, y=level.price, text=final_label, color=color.new(color.white, 100), textcolor=level.level_color, style=label.style_none, size=get_label_size(label_size))
                        array.push(all_labels, new_label)

// ==================== EXÉCUTION ====================
if barstate.islast
    clear_all_objects()

string csv_active = ""
string meta_active = ""

if detected_ticker == "ES"
    csv_active := selected_dte == "0DTE" ? es_csv_zero : selected_dte == "1DTE" ? es_csv_one : es_csv_full
    meta_active := selected_dte == "0DTE" ? es_meta_zero : selected_dte == "1DTE" ? es_meta_one : es_meta_full
else
    // Utiliser NDX ou QQQ selon le choix de l'utilisateur
    if nq_options_source == "NDX"
        csv_active := selected_dte == "0DTE" ? nq_csv_zero : selected_dte == "1DTE" ? nq_csv_one : nq_csv_full
        meta_active := selected_dte == "0DTE" ? nq_meta_zero : selected_dte == "1DTE" ? nq_meta_one : nq_meta_full
    else
        csv_active := selected_dte == "0DTE" ? qqq_csv_zero : selected_dte == "1DTE" ? qqq_csv_one : qqq_csv_full
        meta_active := selected_dte == "0DTE" ? qqq_meta_zero : selected_dte == "1DTE" ? qqq_meta_one : qqq_meta_full

process_csv(csv_active)

if barstate.islast
    if show_metadata and str.length(meta_active) > 0
        var table meta_tbl = table.new(position.top_right, 2, 11, bgcolor=color.new(color.gray, 85), border_width=1, border_color=color.new(color.white, 50))
        
        table.clear(meta_tbl, 0, 0, 1, 10)
        
        parts = str.split(meta_active, "|")
        table.cell(meta_tbl, 0, 0, "GEX Metadata", text_color=color.white, text_size=size.small, bgcolor=color.new(color.blue, 70))
        table.cell(meta_tbl, 1, 0, "", text_color=color.white, text_size=size.small, bgcolor=color.new(color.blue, 70))
        
        int row = 1
        for meta_part in parts
            kv = str.split(meta_part, ":")
            if array.size(kv) == 2
                key = array.get(kv, 0)
                val = array.get(kv, 1)
                table.cell(meta_tbl, 0, row, key, text_color=color.white, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
                table.cell(meta_tbl, 1, row, val, text_color=color.yellow, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
                row := row + 1
    
    if show_definitions
        var table def_tbl = table.new(position.bottom_left, 2, 11, bgcolor=color.new(color.gray, 85), border_width=1, border_color=color.new(color.white, 50))
        
        table.clear(def_tbl, 0, 0, 1, 10)
        
        table.cell(def_tbl, 0, 0, "📖 TERMES GEX", text_color=color.white, text_size=size.small, bgcolor=color.new(color.purple, 70))
        table.cell(def_tbl, 1, 0, "DÉFINITION", text_color=color.white, text_size=size.small, bgcolor=color.new(color.purple, 70))
        
        table.cell(def_tbl, 0, 1, "GEX", text_color=color.white, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 1, "Gamma Exposure - Volume de couverture nécessaire aux market makers pour un mouvement de 1%", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 2, "Zero Gamma", text_color=color.purple, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 2, "Point de bascule où le gamma net = 0. Au-dessus: volatilité amplifiée. En dessous: volatilité supprimée", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 3, "Major Call Wall", text_color=color.red, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 3, "Résistance primaire - Strike call avec le plus fort GEX. Les MM vendent en approchant ce niveau", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 4, "Major Put Wall", text_color=color.green, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 4, "Support primaire - Strike put avec le plus fort GEX. Les MM achètent en approchant ce niveau", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 5, "HVL", text_color=color.orange, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 5, "High Vol Level - Zone de fort GEX proche du spot (<1.5%). Intensifie les mouvements de prix", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 6, "0DTE Walls", text_color=color.yellow, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 6, "Murs d'expiration jour même - Support/résistance actifs uniquement le jour d'expiration", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 7, "Max Pain", text_color=color.blue, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 7, "Strike où le GEX total est minimal - Cible d'expiration théorique où les options perdent le plus", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 8, "Vol Trigger", text_color=color.fuchsia, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 8, "Strike avec variation GEX significative sur intervalle temporel - Signal de changement de flux", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 9, "DTE", text_color=color.white, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 9, "Days To Expiration - Jours avant expiration des options (0DTE = jour même, 1DTE = lendemain)", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        
        table.cell(def_tbl, 0, 10, "Gamma Regime", text_color=color.white, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
        table.cell(def_tbl, 1, 10, "Pos: MM stabilisent (achètent bas/vendent haut). Neg: MM amplifient (achètent haut/vendent bas)", text_color=color.silver, text_size=size.tiny, bgcolor=color.new(color.gray, 90))

plot(close, title="Price", display=display.none)

`;
  };

  // Main data fetching effect
  useEffect(() => {
    const fetchAllData = async () => {
      // Show full-page loader only on the initial load. For periodic
      // refreshes we keep the UI visible and just update data in-place.
      if (!initializedRef.current) {
        setLoading(true);
        setError(null);
      } else {
        setError(null);
      }

      console.log("🚀 Fetching GEX data from API...");

      try {
        const csvDataDict = {};
        const metadataDict = {};
        const displayData = {
          es: { zero: [], one: [], full: [] },
          nq: { zero: [], one: [], full: [] },
          qqq: { zero: [], one: [], full: [] }, // Ajout QQQ
        };

        // Fetch data for all tickers and DTE periods
        for (const [sourceTicker, config] of Object.entries(TICKERS)) {
          const target = config.target.toLowerCase();

          for (const [dteKey, dteApiName] of Object.entries(DTE_PERIODS)) {
            console.log(`📡 Fetching ${sourceTicker}/${dteApiName}...`);

            const chainData = await fetchGexData(
              sourceTicker,
              dteApiName.toLowerCase()
            );
            const majorsData = await fetchGexMajors(
              sourceTicker,
              dteApiName.toLowerCase()
            );

            if (chainData && chainData.strikes) {
              const { levels, metadata } = generateLevels(
                sourceTicker,
                chainData,
                majorsData,
                dteApiName
              );

              // Pour QQQ, utiliser "qqq" comme clé au lieu de "nq"
              const csvKey =
                sourceTicker === "QQQ"
                  ? `qqq_${dteKey}`
                  : `${target}_${dteKey}`;

              csvDataDict[csvKey] = levelsToCSV(levels);
              metadataDict[csvKey] = metadataToString(metadata);

              // Store for display
              if (sourceTicker === "QQQ") {
                displayData.qqq[dteKey] = levels;
              } else {
                displayData[target][dteKey] = levels;
              }

              console.log(
                `✅ ${sourceTicker}/${dteApiName} - ${levels.length} levels generated`
              );
            }
          }
        }

        // Generate Pine Script
        const generatedPineCode = generatePineScript(csvDataDict, metadataDict);
        setPineCode(generatedPineCode);
        setMetadataMap(metadataDict);
        setGexData(displayData);

        // Set last update timestamp
        const now = new Date();
        setLastUpdate(
          now.toLocaleString("fr-FR", {
            dateStyle: "long",
            // Use 'medium' timeStyle to include seconds in the formatted time
            timeStyle: "medium",
            timeZone: "Europe/Paris",
          })
        );

        // Mark that initial load completed so subsequent interval runs
        // won't display the full-page loader.
        initializedRef.current = true;

        console.log("✅ Pine Script generated successfully!");
        setLoading(false);
      } catch (err) {
        console.error("❌ Error fetching GEX data:", err);
        // Only show the full error overlay if the initial load fails.
        if (!initializedRef.current) {
          setError(
            "Erreur lors du chargement des données GEX. Vérifiez votre clé API."
          );
        }
        setLoading(false);
      }
    };

    fetchAllData();

    // Auto-refresh every 5 minutes
    // const interval = setInterval(fetchAllData, 5 * 60 * 1000);
    const interval = setInterval(fetchAllData, 5 * 1000);

    return () => clearInterval(interval);
  }, []);

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

  if (loading) {
    return (
      <div className="app modern">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Chargement des données GEX en temps réel...</p>
          <p className="loading-subtitle">Appels API en cours vers GexBot</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app modern">
        <div className="error-container">
          <h2>❌ Erreur</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Réessayer</button>
        </div>
      </div>
    );
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

      {lastUpdate && (
        <div className="update-banner" role="status" aria-live="polite">
          Dernière mise à jour : <strong>{lastUpdate}</strong>
        </div>
      )}

      <main className="main">
        <section className="hero-compact" id="home">
          <div className="hero-compact-inner">
            <div className="badge">TradingView Pine Script v6</div>
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
                <span>API en direct</span>
              </div>
            </div>
          </div>
        </section>

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

        <IndicatorSummary metadataMap={metadataMap} lastUpdate={lastUpdate} />

        <section className="gex-levels-section" id="levels">
          <h2>📊 Niveaux GEX Actuels</h2>
          <p className="section-subtitle">
            Consultez les niveaux d'exposition gamma calculés pour 0DTE, 1DTE et
            Full
          </p>

          <div className="gex-container">
            {/* ES - inchangé */}
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

            {/* NQ - inchangé */}
            <div className="gex-instrument">
              <h3>
                <span className="instrument-icon">💹</span>
                NQ — Nasdaq 100 Futures (NDX)
              </h3>
              <div className="gex-tabs">
                <GexTable title="0DTE" data={gexData.nq.zero} color="blue" />
                <GexTable title="1DTE" data={gexData.nq.one} color="purple" />
                <GexTable title="Full" data={gexData.nq.full} color="green" />
              </div>
            </div>

            {/* NOUVEAU : QQQ */}
            <div className="gex-instrument">
              <h3>
                <span className="instrument-icon">🔷</span>
                NQ — Nasdaq 100 Futures (QQQ)
              </h3>
              <div className="gex-tabs">
                <GexTable title="0DTE" data={gexData.qqq.zero} color="blue" />
                <GexTable title="1DTE" data={gexData.qqq.one} color="purple" />
                <GexTable title="Full" data={gexData.qqq.full} color="green" />
              </div>
            </div>
          </div>
        </section>

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
              <h4>Temps réel via API</h4>
              <p className="muted">
                Mise à jour automatique toutes les 5 minutes via appels API
                directs
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
                Code optimisé Pine Script v6 pour une exécution rapide
              </p>
            </div>
          </div>
        </section>

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
              <th>Strike</th>
              <th>Imp.</th>
              <th>Type</th>
              <th>Label</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 20).map((level, idx) => (
              <tr key={idx}>
                <td>
                  <strong>{level.strike}</strong>
                </td>
                <td>
                  <span className={`importance-badge imp-${level.importance}`}>
                    {level.importance}
                  </span>
                </td>
                <td className="type-cell">{level.type}</td>
                <td>{level.label}</td>
                <td className="description-cell">{level.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
