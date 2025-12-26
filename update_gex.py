"""
Script de mise à jour GEX pour TradingView
Génère 3 CSV: ZERO, ONE, FULL
"""
import requests
import pandas as pd
from datetime import datetime, timezone
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

# Périodes DTE disponibles
DTE_PERIODS = {
    'zero': 'ZERO',   # 0DTE ou plus proche expiration
    'one': 'ONE',     # Prochaine expiration
    'full': 'FULL'    # Toutes expirations combinées
}


def log(message):
    """Logger simple"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}")


def fetch_gex_data(ticker, aggregation):
    """Récupère les données GEX"""
    url = f"{BASE_URL}/{ticker}/classic/{aggregation}?key={API_KEY}"
    try:
        response = requests.get(url, timeout=API_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        
        strikes_count = len(data.get('strikes', []))
        if strikes_count > 0:
            log(f"✅ {ticker}/{aggregation} - {strikes_count} strikes")
        else:
            log(f"⚠️  {ticker}/{aggregation} - Pas de données")
        
        return data
    except Exception as e:
        log(f"❌ Erreur {ticker}/{aggregation}: {e}")
        return None


def fetch_gex_majors(ticker, aggregation):
    """Récupère les niveaux majeurs"""
    url = f"{BASE_URL}/{ticker}/classic/{aggregation}/majors?key={API_KEY}"
    try:
        response = requests.get(url, timeout=API_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        return data
    except Exception as e:
        return None


def calculate_advanced_levels(strikes, spot):
    """Calcule les niveaux avancés"""
    
    call_resistance_total = 0
    put_support_total = 0
    
    call_walls = []
    put_walls = []
    hvl_candidates = []
    
    for strike_array in strikes:
        if isinstance(strike_array, list) and len(strike_array) >= 3:
            strike_price = strike_array[0]
            gex_vol = strike_array[1]
            gex_oi = strike_array[2]
            
            total_gex = gex_vol + gex_oi
            abs_total_gex = abs(total_gex)
            
            # CallResAll / PutSupAll
            if strike_price > spot and total_gex < 0:
                call_resistance_total += total_gex
            elif strike_price < spot and total_gex > 0:
                put_support_total += total_gex
            
            # Gamma Walls
            if total_gex < 0:
                call_walls.append({
                    'strike': strike_price,
                    'gex': total_gex,
                    'abs_gex': abs_total_gex
                })
            elif total_gex > 0:
                put_walls.append({
                    'strike': strike_price,
                    'gex': total_gex,
                    'abs_gex': abs_total_gex
                })
            
            # HVL (zones haute volatilité près du spot)
            distance_pct = abs((strike_price - spot) / spot * 100) if spot > 0 else 0
            
            if distance_pct < 1.5 and abs_total_gex > 500:
                hvl_candidates.append({
                    'strike': strike_price,
                    'abs_gex': abs_total_gex,
                    'distance_pct': distance_pct
                })
    
    # Trier
    call_walls.sort(key=lambda x: x['abs_gex'], reverse=True)
    put_walls.sort(key=lambda x: x['abs_gex'], reverse=True)
    hvl_candidates.sort(key=lambda x: x['abs_gex'], reverse=True)
    
    return {
        'call_res_all': call_resistance_total,
        'put_sup_all': put_support_total,
        'top_call_wall': call_walls[0] if call_walls else None,
        'top_put_wall': put_walls[0] if put_walls else None,
        'all_call_walls': call_walls[:5],
        'all_put_walls': put_walls[:5],
        'hvl_levels': hvl_candidates[:3]
    }


def generate_levels(source_ticker, chain_data, majors_data, dte_api_name, dte_label):
    """Génère les niveaux professionnels"""
    
    if not chain_data or not chain_data.get('strikes'):
        return None
    
    config = TICKERS[source_ticker]
    target = config['target']
    
    spot = chain_data.get('spot', 0)
    min_dte = chain_data.get('min_dte', 0)
    zero_gamma = chain_data.get('zero_gamma', 0)
    
    # Données majeurs API
    major_data_source = majors_data if majors_data else chain_data
    
    call_wall_vol = major_data_source.get('mneg_vol') or major_data_source.get('major_neg_vol', 0)
    call_wall_oi = major_data_source.get('mneg_oi') or major_data_source.get('major_neg_oi', 0)
    put_wall_vol = major_data_source.get('mpos_vol') or major_data_source.get('major_pos_vol', 0)
    put_wall_oi = major_data_source.get('mpos_oi') or major_data_source.get('major_pos_oi', 0)
    
    strikes = chain_data.get('strikes', [])
    
    if not strikes:
        return None
    
    is_zero_dte = (min_dte == 0)
    dte_display = f"0DTE ⚡" if is_zero_dte else f"{min_dte}DTE"
    
    log(f"   📊 {target}/{dte_label} - Spot: {spot}, {dte_display}")
    
    # Calcul niveaux avancés
    advanced = calculate_advanced_levels(strikes, spot)
    
    log(f"      CallResAll: {advanced['call_res_all']:.0f} GEX")
    log(f"      PutSupAll: {advanced['put_sup_all']:.0f} GEX")
    
    if advanced['top_call_wall']:
        log(f"      Gamma Wall Call: {advanced['top_call_wall']['strike']} ({advanced['top_call_wall']['abs_gex']:.0f} GEX)")
    if advanced['top_put_wall']:
        log(f"      Gamma Wall Put: {advanced['top_put_wall']['strike']} ({advanced['top_put_wall']['abs_gex']:.0f} GEX)")
    
    levels = []
    
    # ==================== ZERO GAMMA ====================
    if zero_gamma and zero_gamma != 0:
        regime = "Negative Gamma" if spot > zero_gamma else "Positive Gamma"
        levels.append({
            'strike': round(zero_gamma, 2),
            'importance': 10,
            'type': 'gamma_flip',
            'label': 'Zero Gamma',
            'dte': dte_display,
            'description': regime
        })
    
    # ==================== GAMMA WALLS ====================
    if advanced['top_call_wall']:
        cw = advanced['top_call_wall']
        levels.append({
            'strike': round(cw['strike'], 2),
            'importance': 10,
            'type': 'gamma_wall_call',
            'label': 'Gamma Wall (Call)',
            'dte': dte_display,
            'description': f"{cw['abs_gex']:.0f} GEX"
        })
    
    if advanced['top_put_wall']:
        pw = advanced['top_put_wall']
        levels.append({
            'strike': round(pw['strike'], 2),
            'importance': 10,
            'type': 'gamma_wall_put',
            'label': 'Gamma Wall (Put)',
            'dte': dte_display,
            'description': f"{pw['abs_gex']:.0f} GEX"
        })
    
    # ==================== HVL ====================
    for idx, hvl in enumerate(advanced['hvl_levels']):
        levels.append({
            'strike': round(hvl['strike'], 2),
            'importance': 9,
            'type': 'hvl',
            'label': f"HVL #{idx+1}",
            'dte': dte_display,
            'description': f"{hvl['abs_gex']:.0f} GEX @ {hvl['distance_pct']:.1f}% from spot"
        })
    
    # ==================== NIVEAUX 0DTE SPÉCIAUX ====================
    if is_zero_dte:
        # PutSup0DTE (en dessous du spot)
        put_0dte = [p for p in advanced['all_put_walls'][:3] if p['strike'] < spot]
        for idx, ps in enumerate(put_0dte[:2]):
            levels.append({
                'strike': round(ps['strike'], 2),
                'importance': 9,
                'type': 'put_sup_0dte',
                'label': f"PutSup0DTE #{idx+1}",
                'dte': dte_display,
                'description': f"Support 0DTE: {ps['abs_gex']:.0f} GEX"
            })
        
        # CallRes0DTE (au dessus du spot)
        call_0dte = [c for c in advanced['all_call_walls'][:3] if c['strike'] > spot]
        for idx, cr in enumerate(call_0dte[:2]):
            levels.append({
                'strike': round(cr['strike'], 2),
                'importance': 9,
                'type': 'call_res_0dte',
                'label': f"CallRes0DTE #{idx+1}",
                'dte': dte_display,
                'description': f"Resistance 0DTE: {cr['abs_gex']:.0f} GEX"
            })
    
    # ==================== MAJOR WALLS API ====================
    if call_wall_vol and call_wall_vol != 0:
        levels.append({
            'strike': round(call_wall_vol, 2),
            'importance': 9,
            'type': 'call_wall_api',
            'label': 'Call Wall (Vol API)',
            'dte': dte_display,
            'description': 'Major from API'
        })
    
    if put_wall_vol and put_wall_vol != 0:
        levels.append({
            'strike': round(put_wall_vol, 2),
            'importance': 9,
            'type': 'put_wall_api',
            'label': 'Put Wall (Vol API)',
            'dte': dte_display,
            'description': 'Major from API'
        })
    
    if call_wall_oi and call_wall_oi != 0:
        levels.append({
            'strike': round(call_wall_oi, 2),
            'importance': 8,
            'type': 'call_wall_api',
            'label': 'Call Wall (OI API)',
            'dte': dte_display,
            'description': 'Major from API'
        })
    
    if put_wall_oi and put_wall_oi != 0:
        levels.append({
            'strike': round(put_wall_oi, 2),
            'importance': 8,
            'type': 'put_wall_api',
            'label': 'Put Wall (OI API)',
            'dte': dte_display,
            'description': 'Major from API'
        })
    
    # ==================== SECONDARY WALLS ====================
    for idx, cw in enumerate(advanced['all_call_walls'][1:4], 2):
        levels.append({
            'strike': round(cw['strike'], 2),
            'importance': 8,
            'type': 'call_wall',
            'label': f"Call Wall #{idx}",
            'dte': dte_display,
            'description': f"{cw['abs_gex']:.0f} GEX"
        })
    
    for idx, pw in enumerate(advanced['all_put_walls'][1:4], 2):
        levels.append({
            'strike': round(pw['strike'], 2),
            'importance': 8,
            'type': 'put_wall',
            'label': f"Put Wall #{idx}",
            'dte': dte_display,
            'description': f"{pw['abs_gex']:.0f} GEX"
        })
    
    # ==================== TOP STRIKES ====================
    strikes_data = []
    
    for strike_array in strikes:
        if isinstance(strike_array, list) and len(strike_array) >= 3:
            strike_price = strike_array[0]
            gex_vol = strike_array[1]
            gex_oi = strike_array[2]
            
            total_gex = abs(gex_vol) + abs(gex_oi)
            
            if total_gex > 100:  # Seuil minimum
                strikes_data.append({
                    'strike': round(strike_price, 2),
                    'total_gex': total_gex,
                    'is_call': (gex_vol < 0 or gex_oi < 0)
                })
    
    strikes_data.sort(key=lambda x: x['total_gex'], reverse=True)
    
    for s in strikes_data[:15]:
        strike_type = "Call Resist" if s['is_call'] else "Put Support"
        levels.append({
            'strike': s['strike'],
            'importance': 7,
            'type': 'strike_' + ('call' if s['is_call'] else 'put'),
            'label': strike_type,
            'dte': dte_display,
            'description': f"{s['total_gex']:.0f} GEX"
        })
    
    # ==================== VOL TRIGGERS ====================
    max_priors = chain_data.get('max_priors', [])
    
    if max_priors and isinstance(max_priors, list):
        intervals = ['1min', '5min', '10min', '15min', '30min', '1h']
        
        for idx, strike_array in enumerate(max_priors[:6]):
            if isinstance(strike_array, list) and len(strike_array) >= 2:
                strike_val = strike_array[0]
                gex_change = strike_array[1]
                intensity = abs(gex_change)
                
                if strike_val and strike_val != 0 and intensity > 50:
                    interval_name = intervals[idx] if idx < len(intervals) else f'interval{idx}'
                    
                    if intensity > 5000:
                        importance = 9
                        label = f"Vol Trigger ⚡ ({interval_name})"
                    elif intensity > 2000:
                        importance = 8
                        label = f"Vol Trigger 🔥 ({interval_name})"
                    else:
                        importance = 7
                        label = f"Vol Trigger ({interval_name})"
                    
                    levels.append({
                        'strike': round(strike_val, 2),
                        'importance': importance,
                        'type': 'vol_trigger',
                        'label': label,
                        'dte': dte_display,
                        'description': f"Change: {gex_change:+.0f}"
                    })
    
    # ==================== MAX PAIN ====================
    min_gex = float('inf')
    max_pain = None
    
    for strike_array in strikes:
        if isinstance(strike_array, list) and len(strike_array) >= 3:
            strike_price = strike_array[0]
            gex_vol = strike_array[1]
            gex_oi = strike_array[2]
            total_gex = abs(gex_vol + gex_oi)
            
            if total_gex < min_gex:
                min_gex = total_gex
                max_pain = strike_price
    
    if max_pain:
        levels.append({
            'strike': round(max_pain, 2),
            'importance': 8,
            'type': 'max_pain',
            'label': 'Max Pain',
            'dte': dte_display,
            'description': 'Expiration Target'
        })
    
    # ==================== DATAFRAME ====================
    df = pd.DataFrame(levels)
    
    if not df.empty:
        df = df.drop_duplicates(subset=['strike'], keep='first')
        df = df.sort_values('importance', ascending=False)
        
        df['call_res_all'] = advanced['call_res_all']
        df['put_sup_all'] = advanced['put_sup_all']
        
        log(f"      ✅ {len(df)} niveaux générés")
        
        return df
    
    return None


def main():
    timestamp = datetime.now(timezone.utc)
    timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')
    
    log("=" * 70)
    log(f"🚀 GEX PROFESSIONAL LEVELS - {timestamp_str}")
    log("=" * 70)
    
    if not API_KEY:
        log("❌ ERREUR: GEXBOT_API_KEY non définie")
        sys.exit(1)
    
    total_files = 0
    
    # Pour chaque ticker
    for source_ticker, config in TICKERS.items():
        target = config['target']
        log(f"\n📊 Processing {source_ticker} → {target}")
        
        # Pour chaque période
        for dte_api_name, dte_label in DTE_PERIODS.items():
            log(f"\n   🔹 {dte_label} (endpoint: /{dte_api_name})")
            
            # Récupérer données
            chain_data = fetch_gex_data(source_ticker, dte_api_name)
            majors_data = fetch_gex_majors(source_ticker, dte_api_name)
            
            if chain_data and chain_data.get('strikes'):
                # Générer niveaux
                df_levels = generate_levels(source_ticker, chain_data, majors_data, dte_api_name, dte_label)
                
                if df_levels is not None and not df_levels.empty:
                    # Sauvegarder
                    output_file = f"{target.lower()}_gex_{dte_api_name}.csv"
                    df_levels.to_csv(output_file, index=False)
                    
                    log(f"      💾 {output_file} ({len(df_levels)} niveaux)")
                    total_files += 1
                else:
                    log(f"      ⚠️  Pas de niveaux générés")
            else:
                log(f"      ⚠️  Pas de données disponibles")
    
    # Mettre à jour `last_update.txt` uniquement si des fichiers ont été générés
    # (considéré comme une exécution réussie). On évite d'écraser la date en cas
    # d'erreur ou si aucun niveau n'a été produit.
    if total_files > 0:
        with open('last_update.txt', 'w') as f:
            f.write(timestamp_str)
            f.flush()  # Force l'écriture immédiate

    log("\n" + "=" * 70)
    log(f"✅ COMPLETED - {total_files} fichiers générés")
    log("=" * 70)
    log("\n📂 Fichiers générés:")
    log("   ES (SPX):")
    log("      • es_gex_zero.csv - Plus proche expiration (0DTE si actif)")
    log("      • es_gex_one.csv  - Prochaine expiration (1DTE)")
    log("      • es_gex_full.csv - Toutes expirations combinées")
    log("   NQ (NDX):")
    log("      • nq_gex_zero.csv")
    log("      • nq_gex_one.csv")
    log("      • nq_gex_full.csv")
    log("\n🎯 Niveaux inclus:")
    log("   • Zero Gamma + Gamma Walls (Importance 10)")
    log("   • HVL + PutSup0DTE/CallRes0DTE (Importance 9)")
    log("   • Secondary Walls + Max Pain (Importance 8)")
    log("   • Top Strikes + Vol Triggers (Importance 7)")
    log("\n📊 Métriques:")
    log("   • CallResAll: Résistance call totale")
    log("   • PutSupAll: Support put total")
    log("=" * 70)
    
    sys.exit(0 if total_files > 0 else 1)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log(f"❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
