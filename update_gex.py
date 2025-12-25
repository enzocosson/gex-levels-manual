"""
Script de mise à jour des niveaux GEX pour TradingView
Génère des CSV au format Pine Seeds avec historique de 30 jours
SANS conversion - utilise les valeurs brutes de l'API
"""
import requests
import pandas as pd
from datetime import datetime, timezone, timedelta
import sys
from config import *


# ==================== CONFIGURATION TICKERS ====================
TICKERS = {
    'SPX': {
        'target': 'ES',
        'description': 'SPX GEX for ES Futures'
    },
    'NDX': {
        'target': 'NQ', 
        'description': 'NDX GEX for NQ Futures'
    }
}


def log(message):
    """Logger simple"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}")


def fetch_gex_chain(ticker, aggregation='full'):
    """Récupère les données GEX chain complètes"""
    url = f"{BASE_URL}/{ticker}/classic/{aggregation}?key={API_KEY}"
    try:
        response = requests.get(url, timeout=API_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        log(f"✅ {ticker}/chain récupéré - {len(data.get('strikes', []))} strikes")
        return data
    except Exception as e:
        log(f"❌ Erreur {ticker}/chain: {e}")
        return None


def fetch_gex_majors(ticker, aggregation='full'):
    """Récupère les niveaux majeurs GEX"""
    url = f"{BASE_URL}/{ticker}/classic/{aggregation}/majors?key={API_KEY}"
    try:
        response = requests.get(url, timeout=API_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        log(f"✅ {ticker}/majors récupéré")
        return data
    except Exception as e:
        log(f"❌ Erreur {ticker}/majors: {e}")
        return None


def extract_levels(source_ticker, chain_data, majors_data):
    """
    Extrait les niveaux GEX sans conversion
    Utilise les valeurs brutes de l'API
    
    Args:
        source_ticker: 'SPX' ou 'NDX'
        chain_data: données de /classic/full
        majors_data: données de /classic/full/majors
    """
    
    if not chain_data:
        return []
    
    config = TICKERS[source_ticker]
    target = config['target']
    
    levels = []
    
    # ==================== 1. ZERO GAMMA (Importance 10) ====================
    zero_gamma = chain_data.get('zero_gamma', 0)
    if zero_gamma and zero_gamma != 0:
        levels.append({
            'strike': round(zero_gamma, 2),
            'type': 'zero_gamma',
            'importance': 10,
            'label': 'Zero Gamma'
        })
        log(f"   ✅ Zero Gamma: {zero_gamma}")
    
    # ==================== 2. NIVEAUX MAJEURS (Importance 9-8) ====================
    # Utiliser majors_data si disponible, sinon chain_data
    major_data_source = majors_data if majors_data else chain_data
    
    # Major Support Vol (Importance 9)
    mpos_vol = major_data_source.get('mpos_vol') or major_data_source.get('major_pos_vol', 0)
    if mpos_vol and mpos_vol != 0:
        levels.append({
            'strike': round(mpos_vol, 2),
            'type': 'support',
            'importance': 9,
            'label': 'Major Support (Vol)'
        })
        log(f"   ✅ Major Support (Vol): {mpos_vol}")
    
    # Major Resistance Vol (Importance 9)
    mneg_vol = major_data_source.get('mneg_vol') or major_data_source.get('major_neg_vol', 0)
    if mneg_vol and mneg_vol != 0:
        levels.append({
            'strike': round(mneg_vol, 2),
            'type': 'resistance',
            'importance': 9,
            'label': 'Major Resistance (Vol)'
        })
        log(f"   ✅ Major Resistance (Vol): {mneg_vol}")
    
    # Major Support OI (Importance 8)
    mpos_oi = major_data_source.get('mpos_oi') or major_data_source.get('major_pos_oi', 0)
    if mpos_oi and mpos_oi != 0:
        levels.append({
            'strike': round(mpos_oi, 2),
            'type': 'support',
            'importance': 8,
            'label': 'Major Support (OI)'
        })
        log(f"   ✅ Major Support (OI): {mpos_oi}")
    
    # Major Resistance OI (Importance 8)
    mneg_oi = major_data_source.get('mneg_oi') or major_data_source.get('major_neg_oi', 0)
    if mneg_oi and mneg_oi != 0:
        levels.append({
            'strike': round(mneg_oi, 2),
            'type': 'resistance',
            'importance': 8,
            'label': 'Major Resistance (OI)'
        })
        log(f"   ✅ Major Resistance (OI): {mneg_oi}")
    
    # ==================== 3. TOP STRIKES (Importance 7) ====================
    strikes = chain_data.get('strikes', [])
    
    if strikes:
        strikes_data = []
        
        for strike_array in strikes:
            if isinstance(strike_array, list) and len(strike_array) >= 3:
                strike_price = strike_array[0]
                gex_vol = strike_array[1]
                gex_oi = strike_array[2]
                
                # Score d'importance basé sur GEX absolu
                importance_score = abs(gex_vol) + abs(gex_oi)
                
                # Seuil minimum pour filtrer le bruit
                if importance_score > 5:
                    strikes_data.append({
                        'strike': strike_price,
                        'gex_vol': gex_vol,
                        'gex_oi': gex_oi,
                        'importance': importance_score
                    })
        
        # Trier par importance et prendre le top
        strikes_data.sort(key=lambda x: x['importance'], reverse=True)
        top_count = TOP_STRIKES_COUNT if 'TOP_STRIKES_COUNT' in globals() else 15
        top_strikes = strikes_data[:top_count]
        
        for strike_info in top_strikes:
            # Déterminer le type (support vs resistance)
            if abs(strike_info['gex_vol']) > abs(strike_info['gex_oi']):
                strike_type = 'support' if strike_info['gex_vol'] > 0 else 'resistance'
            else:
                strike_type = 'support' if strike_info['gex_oi'] > 0 else 'resistance'
            
            levels.append({
                'strike': round(strike_info['strike'], 2),
                'type': strike_type,
                'importance': 7,
                'label': strike_type.capitalize()
            })
        
        log(f"   ✅ {len(top_strikes)} top strikes ajoutés")
    
    # ==================== 4. HOTSPOTS (Importance 6) ====================
    max_priors = chain_data.get('max_priors', [])
    
    if max_priors and isinstance(max_priors, list):
        hotspots_added = 0
        intervals = ['1min', '5min', '10min', '30min', '1h', '4h']
        
        for idx, strike_array in enumerate(max_priors[:6]):
            if isinstance(strike_array, list) and len(strike_array) >= 2:
                strike_val = strike_array[0]
                gex_change = strike_array[1]
                
                # Seuil minimal pour hotspot
                if strike_val and strike_val != 0 and abs(gex_change) > 100:
                    interval_name = intervals[idx] if idx < len(intervals) else f'{idx}min'
                    
                    levels.append({
                        'strike': round(strike_val, 2),
                        'type': 'hotspot',
                        'importance': 6,
                        'label': f'Hotspot {interval_name}'
                    })
                    hotspots_added += 1
        
        if hotspots_added > 0:
            log(f"   ✅ {hotspots_added} hotspots détectés")
    
    log(f"✅ {target}: {len(levels)} niveaux générés")
    return levels


def convert_to_pine_seeds_format(levels, timestamp):
    """
    Convertit les niveaux GEX au format Pine Seeds OHLCV avec historique
    Format: date,open,high,low,close,volume (sans en-tête)
    
    IMPORTANT: Pine Seeds nécessite un historique de dates
    On génère les 30 derniers jours avec les mêmes niveaux
    """
    pine_rows = []
    
    # Générer un historique de 30 jours
    # Cela permet à Pine Seeds de charger les données correctement
    for days_back in range(30, -1, -1):  # De 30 jours en arrière à aujourd'hui
        historical_date = timestamp - timedelta(days=days_back)
        date_str = historical_date.strftime('%Y%m%dT')
        
        # Ajouter tous les niveaux pour cette date
        for level in levels:
            strike = level['strike']
            importance = level['importance']
            
            pine_rows.append({
                'date': date_str,
                'open': strike,
                'high': strike,
                'low': strike,
                'close': strike,
                'volume': importance
            })
    
    log(f"   📅 Historique généré: {len(pine_rows)} lignes sur 31 jours")
    return pine_rows


def main():
    timestamp = datetime.now(timezone.utc)
    timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')
    
    log("=" * 70)
    log(f"🚀 DÉMARRAGE MISE À JOUR GEX - {timestamp_str}")
    log("=" * 70)
    
    if not API_KEY:
        log("❌ ERREUR: GEXBOT_API_KEY non définie")
        sys.exit(1)
    
    success_count = 0
    
    # Traiter SPX et NDX
    for source_ticker, config in TICKERS.items():
        target = config['target']
        log(f"\n📊 Traitement {source_ticker} → {target}")
        
        # Récupérer les deux endpoints
        chain_data = fetch_gex_chain(source_ticker, aggregation='full')
        majors_data = fetch_gex_majors(source_ticker, aggregation='full')
        
        if chain_data:
            spot = chain_data.get('spot', 0)
            min_dte = chain_data.get('min_dte', 0)
            
            log(f"   Spot {source_ticker}: {spot}")
            log(f"   Min DTE: {min_dte}")
            
            # Extraire les niveaux (sans conversion)
            levels = extract_levels(source_ticker, chain_data, majors_data)
            
            if levels:
                # Trier et dédupliquer
                df_levels = pd.DataFrame(levels)
                df_levels = df_levels.sort_values(['importance', 'strike'], ascending=[False, True])
                df_levels = df_levels.drop_duplicates(subset=['strike'], keep='first')
                
                log(f"   🔧 {len(df_levels)} niveaux uniques après déduplication")
                
                # Convertir au format Pine Seeds avec historique
                pine_data = convert_to_pine_seeds_format(
                    df_levels.to_dict('records'), 
                    timestamp
                )
                
                # Créer DataFrame Pine Seeds
                df_pine = pd.DataFrame(pine_data)
                
                # Nom du fichier de sortie
                output_file = f"{target.lower()}_gex_levels.csv"
                if 'OUTPUT_FILES' in globals() and target in OUTPUT_FILES:
                    output_file = OUTPUT_FILES[target]
                
                # Sauvegarder SANS en-tête (requis par Pine Seeds)
                df_pine.to_csv(
                    output_file, 
                    index=False, 
                    header=False,
                    float_format='%.2f'
                )
                
                log(f"✅ Fichier Pine Seeds: {output_file} ({len(df_pine)} lignes)")
                log(f"   Format: {len(df_levels)} niveaux × 31 jours = {len(df_pine)} lignes")
                
                # Sauvegarder version debug avec métadonnées (1 ligne par niveau)
                debug_file = output_file.replace('.csv', '_metadata.csv')
                df_levels.to_csv(debug_file, index=False)
                log(f"   📝 Debug: {debug_file} ({len(df_levels)} niveaux)")
                
                success_count += 1
            else:
                log(f"⚠️  Aucun niveau généré pour {target}")
        else:
            log(f"❌ Impossible de récupérer les données {source_ticker}")
    
    # Sauvegarder timestamp
    timestamp_file = 'last_update.txt'
    if 'OUTPUT_FILES' in globals() and 'TIMESTAMP' in OUTPUT_FILES:
        timestamp_file = OUTPUT_FILES['TIMESTAMP']
    
    with open(timestamp_file, 'w') as f:
        f.write(timestamp_str)
    
    log("\n" + "=" * 70)
    log(f"✅ TERMINÉ - {success_count}/{len(TICKERS)} succès")
    log(f"📊 Fichiers générés avec historique de 31 jours")
    log("=" * 70)
    
    sys.exit(0 if success_count > 0 else 1)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log(f"❌ ERREUR CRITIQUE: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
