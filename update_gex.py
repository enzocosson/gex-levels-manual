"""
Script de mise à jour GEX pour TradingView
Génère les CSV ET l'indicateur Pine Script avec données hardcodées
Auto-détection ES/NQ + Sélecteur DTE + Multiplicateurs FIXES
"""
import requests
import pandas as pd
from datetime import datetime, timezone
import sys
import os
from config import *


# ==================== CONFIGURATION ====================
TICKERS = {
    'SPX': {'target': 'ES', 'description': 'SPX GEX for ES Futures', 'multiplier': 1.00685},
    'NDX': {'target': 'NQ', 'description': 'NDX GEX for NQ Futures', 'multiplier': 1.00842}
}

DTE_PERIODS = {'zero': 'ZERO', 'one': 'ONE', 'full': 'FULL'}


def log(message):
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}")


def fetch_gex_data(ticker, aggregation):
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
    url = f"{BASE_URL}/{ticker}/classic/{aggregation}/majors?key={API_KEY}"
    try:
        response = requests.get(url, timeout=API_TIMEOUT)
        response.raise_for_status()
        return response.json()
    except:
        return None


def calculate_advanced_levels(strikes, spot):
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
            
            if strike_price > spot and total_gex > 0:
                call_resistance_total += total_gex
            elif strike_price < spot and total_gex < 0:
                put_support_total += abs(total_gex)
            
            if total_gex > 0:
                call_walls.append({'strike': strike_price, 'gex': total_gex, 'abs_gex': abs_total_gex})
            elif total_gex < 0:
                put_walls.append({'strike': strike_price, 'gex': total_gex, 'abs_gex': abs_total_gex})
            
            distance_pct = abs((strike_price - spot) / spot * 100) if spot > 0 else 0
            if distance_pct < 1.5 and abs_total_gex > 500:
                hvl_candidates.append({'strike': strike_price, 'abs_gex': abs_total_gex, 'distance_pct': distance_pct})
    
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
    if not chain_data or not chain_data.get('strikes'):
        return None, None
    
    config = TICKERS[source_ticker]
    target = config['target']
    
    spot_price = chain_data.get('spot', 0)
    front_expiry_dte = chain_data.get('min_dte', 0)
    next_expiry_dte = chain_data.get('sec_min_dte', 0)
    volatility_trigger = chain_data.get('zero_gamma', 0)
    data_timestamp = chain_data.get('timestamp', 0)
    underlying_symbol = chain_data.get('ticker', source_ticker)
    strike_gex_curve = chain_data.get('strikes', [])
    net_gex_volume = chain_data.get('sum_gex_vol', 0)
    net_gex_oi = chain_data.get('sum_gex_oi', 0)
    vol_triggers_timeframe = chain_data.get('max_priors', [])
    
    major_data_source = majors_data if majors_data else chain_data
    call_wall_volume = major_data_source.get('mpos_vol') or major_data_source.get('major_pos_vol', 0)
    call_wall_oi = major_data_source.get('mpos_oi') or major_data_source.get('major_pos_oi', 0)
    put_wall_volume = major_data_source.get('mneg_vol') or major_data_source.get('major_neg_vol', 0)
    put_wall_oi = major_data_source.get('mneg_oi') or major_data_source.get('major_neg_oi', 0)
    
    if not strike_gex_curve:
        return None, None
    
    is_zero_dte = (front_expiry_dte == 0)
    dte_display = f"0DTE" if is_zero_dte else f"{front_expiry_dte}DTE"
    
    log(f"   📊 {target}/{dte_label} - Spot: {spot_price}, {dte_display}")
    log(f"      Zero Gamma: {volatility_trigger}")
    advanced = calculate_advanced_levels(strike_gex_curve, spot_price)
    log(f"      CallResAll: {advanced['call_res_all']:.0f} GEX")
    log(f"      PutSupAll: {advanced['put_sup_all']:.0f} GEX")
    
    levels = []
    
    # IMPORTANCE 10 - Zero Gamma (Gamma Flip Point)
    if volatility_trigger and volatility_trigger != 0:
        regime = "Negative Gamma" if spot_price > volatility_trigger else "Positive Gamma"
        levels.append({
            'strike': round(volatility_trigger, 2), 
            'importance': 10, 
            'type': 'zero_gamma', 
            'label': 'Zero Gamma', 
            'dte': dte_display, 
            'description': f"Gamma flip point - {regime}"
        })
    
    # IMPORTANCE 10 - Major Walls
    if advanced['top_call_wall']:
        cw = advanced['top_call_wall']
        levels.append({
            'strike': round(cw['strike'], 2), 
            'importance': 10, 
            'type': 'major_call_wall', 
            'label': 'Major Call Wall', 
            'dte': dte_display, 
            'description': f"Primary call resistance - {cw['abs_gex']:.0f} GEX"
        })
    
    if advanced['top_put_wall']:
        pw = advanced['top_put_wall']
        levels.append({
            'strike': round(pw['strike'], 2), 
            'importance': 10, 
            'type': 'major_put_wall', 
            'label': 'Major Put Wall', 
            'dte': dte_display, 
            'description': f"Primary put support - {pw['abs_gex']:.0f} GEX"
        })
    
    # IMPORTANCE 9 - HVL
    for idx, hvl in enumerate(advanced['hvl_levels']):
        levels.append({
            'strike': round(hvl['strike'], 2), 
            'importance': 9, 
            'type': 'high_vol_level', 
            'label': f"HVL #{idx+1}", 
            'dte': dte_display, 
            'description': f"High vol zone - {hvl['abs_gex']:.0f} GEX @ {hvl['distance_pct']:.1f}%"
        })
    
    # IMPORTANCE 9 - 0DTE Walls
    if is_zero_dte:
        put_0dte = [p for p in advanced['all_put_walls'][:3] if p['strike'] < spot_price]
        for idx, ps in enumerate(put_0dte[:2]):
            levels.append({
                'strike': round(ps['strike'], 2), 
                'importance': 9, 
                'type': 'put_wall_0dte', 
                'label': f"Put Wall 0DTE #{idx+1}", 
                'dte': dte_display, 
                'description': f"0DTE put support - {ps['abs_gex']:.0f} GEX"
            })
        
        call_0dte = [c for c in advanced['all_call_walls'][:3] if c['strike'] > spot_price]
        for idx, cr in enumerate(call_0dte[:2]):
            levels.append({
                'strike': round(cr['strike'], 2), 
                'importance': 9, 
                'type': 'call_wall_0dte', 
                'label': f"Call Wall 0DTE #{idx+1}", 
                'dte': dte_display, 
                'description': f"0DTE call resistance - {cr['abs_gex']:.0f} GEX"
            })
    
    # IMPORTANCE 9/8 - Walls from API
    if call_wall_volume and call_wall_volume != 0:
        levels.append({
            'strike': round(call_wall_volume, 2), 
            'importance': 9, 
            'type': 'call_wall_volume', 
            'label': 'Call Wall (Vol)', 
            'dte': dte_display, 
            'description': 'Call wall from volume data'
        })
    if put_wall_volume and put_wall_volume != 0:
        levels.append({
            'strike': round(put_wall_volume, 2), 
            'importance': 9, 
            'type': 'put_wall_volume', 
            'label': 'Put Wall (Vol)', 
            'dte': dte_display, 
            'description': 'Put wall from volume data'
        })
    if call_wall_oi and call_wall_oi != 0:
        levels.append({
            'strike': round(call_wall_oi, 2), 
            'importance': 8, 
            'type': 'call_wall_oi', 
            'label': 'Call Wall (OI)', 
            'dte': dte_display, 
            'description': 'Call wall from open interest'
        })
    if put_wall_oi and put_wall_oi != 0:
        levels.append({
            'strike': round(put_wall_oi, 2), 
            'importance': 8, 
            'type': 'put_wall_oi', 
            'label': 'Put Wall (OI)', 
            'dte': dte_display, 
            'description': 'Put wall from open interest'
        })
    
    # IMPORTANCE 8 - Secondary Walls
    for idx, cw in enumerate(advanced['all_call_walls'][1:4], 2):
        levels.append({
            'strike': round(cw['strike'], 2), 
            'importance': 8, 
            'type': 'call_wall_secondary', 
            'label': f"Call Wall #{idx}", 
            'dte': dte_display, 
            'description': f"Secondary call resistance - {cw['abs_gex']:.0f} GEX"
        })
    for idx, pw in enumerate(advanced['all_put_walls'][1:4], 2):
        levels.append({
            'strike': round(pw['strike'], 2), 
            'importance': 8, 
            'type': 'put_wall_secondary', 
            'label': f"Put Wall #{idx}", 
            'dte': dte_display, 
            'description': f"Secondary put support - {pw['abs_gex']:.0f} GEX"
        })
    
    # IMPORTANCE 7 - Individual Strikes
    strikes_data = []
    for strike_array in strike_gex_curve:
        if isinstance(strike_array, list) and len(strike_array) >= 3:
            strike_price_val = strike_array[0]
            gex_vol = strike_array[1]
            gex_oi = strike_array[2]
            total_gex_sum = gex_vol + gex_oi
            total_gex = abs(total_gex_sum)
            if total_gex > 100:
                strikes_data.append({
                    'strike': round(strike_price_val, 2), 
                    'total_gex': total_gex, 
                    'is_call': (total_gex_sum > 0)
                })
    
    strikes_data.sort(key=lambda x: x['total_gex'], reverse=True)
    for s in strikes_data[:15]:
        strike_type = "Call Strike" if s['is_call'] else "Put Strike"
        strike_desc = "Call strike" if s['is_call'] else "Put strike"
        levels.append({
            'strike': s['strike'], 
            'importance': 7, 
            'type': 'strike_call' if s['is_call'] else 'strike_put', 
            'label': strike_type, 
            'dte': dte_display, 
            'description': f"{strike_desc} - {s['total_gex']:.0f} GEX"
        })
    
    # IMPORTANCE 7-9 - Vol Triggers (GEX change over time)
    if vol_triggers_timeframe and isinstance(vol_triggers_timeframe, list):
        intervals = ['1min', '5min', '10min', '15min', '30min', '1h']
        for idx, strike_array in enumerate(vol_triggers_timeframe[:6]):
            if isinstance(strike_array, list) and len(strike_array) >= 2:
                strike_val = strike_array[0]
                gex_change = strike_array[1]
                intensity = abs(gex_change)
                if strike_val and strike_val != 0 and intensity > 50:
                    interval_name = intervals[idx] if idx < len(intervals) else f'interval{idx}'
                    if intensity > 5000:
                        importance, label = 9, f"Vol Trigger ({interval_name})"
                    elif intensity > 2000:
                        importance, label = 8, f"Vol Trigger ({interval_name})"
                    else:
                        importance, label = 7, f"Vol Trigger ({interval_name})"
                    levels.append({
                        'strike': round(strike_val, 2), 
                        'importance': importance, 
                        'type': 'vol_trigger', 
                        'label': label, 
                        'dte': dte_display, 
                        'description': f"GEX change {gex_change:+.0f} over {interval_name}"
                    })
    
    # IMPORTANCE 8 - Max Pain
    min_gex = float('inf')
    max_pain = None
    for strike_array in strike_gex_curve:
        if isinstance(strike_array, list) and len(strike_array) >= 3:
            strike_price_val = strike_array[0]
            gex_vol = strike_array[1]
            gex_oi = strike_array[2]
            total_gex = abs(gex_vol + gex_oi)
            if total_gex < min_gex:
                min_gex = total_gex
                max_pain = strike_price_val
    
    if max_pain:
        levels.append({
            'strike': round(max_pain, 2), 
            'importance': 8, 
            'type': 'max_pain', 
            'label': 'Max Pain', 
            'dte': dte_display, 
            'description': 'Expiration target - min GEX'
        })
    
    df = pd.DataFrame(levels)
    
    metadata = {
        'data_timestamp': data_timestamp,
        'underlying_symbol': underlying_symbol,
        'spot_price': spot_price,
        'front_expiry_dte': front_expiry_dte,
        'next_expiry_dte': next_expiry_dte,
        'volatility_trigger': volatility_trigger,
        'net_gex_volume': net_gex_volume,
        'net_gex_oi': net_gex_oi,
        'call_res_all': advanced['call_res_all'],
        'put_sup_all': advanced['put_sup_all']
    }
    
    if not df.empty:
        df = df.drop_duplicates(subset=['strike'], keep='first')
        df = df.sort_values('importance', ascending=False)
        log(f"      ✅ {len(df)} niveaux générés")
        return df, metadata
    return None, None


def csv_to_pinescript_string(csv_content):
    """Convertit le contenu CSV en string échappé pour Pine Script"""
    escaped = csv_content.replace('"', '\\"').replace('\n', '\\n')
    return escaped


def metadata_to_pinescript_string(metadata_dict):
    """Convertit les métadonnées en string pour Pine Script"""
    meta_str = f"Timestamp:{metadata_dict.get('data_timestamp', 0)}|"
    meta_str += f"Symbol:{metadata_dict.get('underlying_symbol', '')}|"
    meta_str += f"Spot:{metadata_dict.get('spot_price', 0):.2f}|"
    meta_str += f"FrontDTE:{metadata_dict.get('front_expiry_dte', 0)}|"
    meta_str += f"NextDTE:{metadata_dict.get('next_expiry_dte', 0)}|"
    meta_str += f"ZeroGamma:{metadata_dict.get('volatility_trigger', 0):.2f}|"
    meta_str += f"NetGEXVol:{metadata_dict.get('net_gex_volume', 0):.2f}|"
    meta_str += f"NetGEXOI:{metadata_dict.get('net_gex_oi', 0):.2f}|"
    meta_str += f"CallResAll:{metadata_dict.get('call_res_all', 0):.2f}|"
    meta_str += f"PutSupAll:{metadata_dict.get('put_sup_all', 0):.2f}"
    return meta_str


def generate_pinescript_indicator(csv_data_dict, metadata_dict):
    """Génère le fichier Pine Script avec multiplicateurs FIXES et affichage des métadonnées"""
    
    es_zero_str = csv_data_dict.get('es_zero', '')
    es_one_str = csv_data_dict.get('es_one', '')
    es_full_str = csv_data_dict.get('es_full', '')
    nq_zero_str = csv_data_dict.get('nq_zero', '')
    nq_one_str = csv_data_dict.get('nq_one', '')
    nq_full_str = csv_data_dict.get('nq_full', '')
    
    es_zero_meta = metadata_dict.get('es_zero', '')
    es_one_meta = metadata_dict.get('es_one', '')
    es_full_meta = metadata_dict.get('es_full', '')
    nq_zero_meta = metadata_dict.get('nq_zero', '')
    nq_one_meta = metadata_dict.get('nq_one', '')
    nq_full_meta = metadata_dict.get('nq_full', '')
    
    spx_multiplier = TICKERS['SPX']['multiplier']
    ndx_multiplier = TICKERS['NDX']['multiplier']
    
    pine_script = f'''//@version=6
indicator("GEX Professional Levels", overlay=true, max_lines_count=500, max_labels_count=500)

// ==================== CSV DATA (AUTO-GENERATED) ====================
string es_csv_zero = "{es_zero_str}"
string es_csv_one = "{es_one_str}"
string es_csv_full = "{es_full_str}"
string nq_csv_zero = "{nq_zero_str}"
string nq_csv_one = "{nq_one_str}"
string nq_csv_full = "{nq_full_str}"

// ==================== METADATA ====================
string es_meta_zero = "{es_zero_meta}"
string es_meta_one = "{es_one_meta}"
string es_meta_full = "{es_full_meta}"
string nq_meta_zero = "{nq_zero_meta}"
string nq_meta_one = "{nq_one_meta}"
string nq_meta_full = "{nq_full_meta}"

// ==================== AUTO-DETECTION TICKER ====================
string detected_ticker = "ES"
if str.contains(syminfo.ticker, "NQ") or str.contains(syminfo.ticker, "NDX") or str.contains(syminfo.ticker, "NAS")
    detected_ticker := "NQ"
else if str.contains(syminfo.ticker, "ES") or str.contains(syminfo.ticker, "SPX") or str.contains(syminfo.ticker, "SP500")
    detected_ticker := "ES"

// ==================== MULTIPLICATEURS FIXES ====================
float SPX_MULTIPLIER = {spx_multiplier}
float NDX_MULTIPLIER = {ndx_multiplier}

float conversion_multiplier = 1.0
bool needs_conversion = false

if detected_ticker == "ES"
    if str.contains(syminfo.ticker, "ES") and not str.contains(syminfo.ticker, "SPX")
        conversion_multiplier := SPX_MULTIPLIER
        needs_conversion := true
else if detected_ticker == "NQ"
    if str.contains(syminfo.ticker, "NQ") and not str.contains(syminfo.ticker, "NDX")
        conversion_multiplier := NDX_MULTIPLIER
        needs_conversion := true

// ==================== PARAMÈTRES ====================
string selected_dte = input.string("0DTE", "📅 DTE Period", options=["0DTE", "1DTE", "FULL"], group="🎯 Settings", tooltip="Days To Expiration")

// ==================== FILTRES PAR IMPORTANCE ====================
bool show_imp_10 = input.bool(true, "Importance 10 (Zero Gamma, Major Walls)", group="🎯 Importance Filters")
bool show_imp_9 = input.bool(true, "Importance 9 (High Vol Levels, 0DTE Walls)", group="🎯 Importance Filters")
bool show_imp_8 = input.bool(true, "Importance 8 (Secondary Walls, Max Pain)", group="🎯 Importance Filters")
bool show_imp_7 = input.bool(false, "Importance 7 (Individual Strikes, Vol Triggers)", group="🎯 Importance Filters")

// ==================== FILTRES PAR TYPE ====================
bool show_zero_gamma = input.bool(true, "Zero Gamma (Gamma Flip)", group="📌 Level Types", tooltip="Gamma flip point - volatility regime change")
bool show_major_walls = input.bool(true, "Major Call/Put Walls", group="📌 Level Types", tooltip="Primary resistance and support")
bool show_high_vol_levels = input.bool(true, "High Vol Levels (HVL)", group="📌 Level Types", tooltip="High volatility zones near spot")
bool show_0dte_walls = input.bool(true, "0DTE Call/Put Walls", group="📌 Level Types", tooltip="Same-day expiry walls")
bool show_secondary_walls = input.bool(true, "Secondary Walls", group="📌 Level Types", tooltip="All other call/put walls")
bool show_max_pain = input.bool(true, "Max Pain Level", group="📌 Level Types", tooltip="Expiration target strike")
bool show_individual_strikes = input.bool(false, "Individual Strikes", group="📌 Level Types", tooltip="Top 15 strikes by GEX")
bool show_vol_triggers = input.bool(false, "Vol Triggers (Timeframe)", group="📌 Level Types", tooltip="GEX change triggers by interval")

// ==================== STYLE ====================
color color_zero_gamma = input.color(color.new(color.purple, 0), "Zero Gamma", group="🎨 Colors", inline="c1")
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

// ==================== METADATA DISPLAY ====================
bool show_metadata = input.bool(false, "Show Market Info Table", group="📊 Metadata", tooltip="Display GEX metadata table")

// ==================== STOCKAGE ====================
var array<line> all_lines = array.new<line>()
var array<label> all_labels = array.new<label>()

// ==================== FONCTIONS ====================
get_label_size(string size) =>
    size == "Tiny" ? size.tiny : size == "Small" ? size.small : size == "Normal" ? size.normal : size.large

should_show_level(int importance, string level_type) =>
    bool show_importance = (importance == 10 and show_imp_10) or (importance == 9 and show_imp_9) or (importance == 8 and show_imp_8) or (importance == 7 and show_imp_7)
    
    bool show_type = false
    
    // COMPARAISON EXACTE
    if level_type == "zero_gamma"
        show_type := show_zero_gamma
    else if level_type == "major_call_wall" or level_type == "major_put_wall"
        show_type := show_major_walls
    else if level_type == "high_vol_level"
        show_type := show_high_vol_levels
    else if level_type == "put_wall_0dte" or level_type == "call_wall_0dte"
        show_type := show_0dte_walls
    else if level_type == "call_wall_volume" or level_type == "put_wall_volume" or level_type == "call_wall_oi" or level_type == "put_wall_oi" or level_type == "call_wall_secondary" or level_type == "put_wall_secondary"
        show_type := show_secondary_walls
    else if level_type == "max_pain"
        show_type := show_max_pain
    else if level_type == "strike_call" or level_type == "strike_put"
        show_type := show_individual_strikes
    else if level_type == "vol_trigger"
        show_type := show_vol_triggers
    
    show_importance and show_type

get_level_color(string level_type) =>
    color result = color_strikes
    
    // COMPARAISON EXACTE
    if level_type == "zero_gamma"
        result := color_zero_gamma
    else if level_type == "major_call_wall"
        result := color_major_call_wall
    else if level_type == "major_put_wall"
        result := color_major_put_wall
    else if level_type == "high_vol_level"
        result := color_high_vol_level
    else if level_type == "put_wall_0dte" or level_type == "call_wall_0dte"
        result := color_0dte_walls
    else if level_type == "call_wall_volume" or level_type == "put_wall_volume" or level_type == "call_wall_oi" or level_type == "put_wall_oi" or level_type == "call_wall_secondary" or level_type == "put_wall_secondary"
        result := color_secondary_walls
    else if level_type == "max_pain"
        result := color_max_pain
    else if level_type == "strike_call" or level_type == "strike_put"
        result := color_strikes
    else if level_type == "vol_trigger"
        result := color_vol_trigger
    
    result

clear_all_objects() =>
    if array.size(all_lines) > 0
        for i = 0 to array.size(all_lines) - 1
            line.delete(array.get(all_lines, i))
        array.clear(all_lines)
    if array.size(all_labels) > 0
        for i = 0 to array.size(all_labels) - 1
            label.delete(array.get(all_labels, i))
        array.clear(all_labels)

process_csv(string csv_data) =>
    if bar_index == last_bar_index
        lines_array = str.split(csv_data, "\\n")
        int total_lines = array.size(lines_array)
        for i = 1 to total_lines - 1
            if i < total_lines
                string line_str = array.get(lines_array, i)
                line_str := str.replace_all(line_str, "\\r", "")
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
                                
                                if should_show_level(importance, level_type)
                                    color level_color = get_level_color(level_type)
                                    line new_line = line.new(x1=bar_index[500], y1=strike_price, x2=bar_index, y2=strike_price, color=level_color, width=1, style=line.style_solid, extend=extend.right)
                                    array.push(all_lines, new_line)
                                    
                                    if show_labels
                                        bool show_this_label = true
                                        if use_distance_filter
                                            float price_distance = math.abs(close - strike_price)
                                            float min_distance = close * (label_min_distance_pct / 100)
                                            show_this_label := price_distance > min_distance
                                        
                                        if show_this_label
                                            string final_label = label_text
                                            if show_descriptions and str.length(description) > 0
                                                final_label := final_label + "\\n" + description
                                            
                                            label new_label = label.new(x=bar_index, y=strike_price, text=final_label, color=color.new(color.white, 100), textcolor=level_color, style=label.style_label_left, size=get_label_size(label_size))
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
        csv_active := selected_dte == "0DTE" ? nq_csv_zero : selected_dte == "1DTE" ? nq_csv_one : nq_csv_full
        meta_active := selected_dte == "0DTE" ? nq_meta_zero : selected_dte == "1DTE" ? nq_meta_one : nq_meta_full
    
    process_csv(csv_active)
    
    if show_metadata and str.length(meta_active) > 0
        var table meta_tbl = table.new(position.top_right, 2, 11, bgcolor=color.new(color.gray, 85), border_width=1, border_color=color.new(color.white, 50))
        
        table.clear(meta_tbl, 0, 0, 1, 10)
        
        parts = str.split(meta_active, "|")
        table.cell(meta_tbl, 0, 0, "GEX Metadata", text_color=color.white, text_size=size.small, bgcolor=color.new(color.blue, 70))
        table.cell(meta_tbl, 1, 0, "", text_color=color.white, text_size=size.small, bgcolor=color.new(color.blue, 70))
        
        int row = 1
        for part in parts
            kv = str.split(part, ":")
            if array.size(kv) == 2
                key = array.get(kv, 0)
                val = array.get(kv, 1)
                table.cell(meta_tbl, 0, row, key, text_color=color.white, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
                table.cell(meta_tbl, 1, row, val, text_color=color.yellow, text_size=size.tiny, bgcolor=color.new(color.gray, 90))
                row := row + 1

plot(close, title="Price", display=display.none)
'''
    
    return pine_script


def main():
    timestamp = datetime.now(timezone.utc)
    timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')
    
    log("=" * 70)
    log(f"🚀 GEX PROFESSIONAL LEVELS - {timestamp_str}")
    log("=" * 70)
    
    if not API_KEY:
        log("❌ ERREUR: GEXBOT_API_KEY non définie")
        sys.exit(1)
    
    log("\n🔢 Multiplicateurs configurés:")
    log(f"   SPX -> ES: {TICKERS['SPX']['multiplier']}")
    log(f"   NDX -> NQ: {TICKERS['NDX']['multiplier']}")
    
    os.makedirs('indicator', exist_ok=True)
    
    total_files = 0
    csv_data_dict = {}
    metadata_dict = {}
    
    for source_ticker, config in TICKERS.items():
        target = config['target']
        log(f"\n📊 Processing {source_ticker} -> {target}")
        
        for dte_api_name, dte_label in DTE_PERIODS.items():
            log(f"\n   🔹 {dte_label}")
            chain_data = fetch_gex_data(source_ticker, dte_api_name)
            majors_data = fetch_gex_majors(source_ticker, dte_api_name)
            
            if chain_data and chain_data.get('strikes'):
                df_levels, metadata = generate_levels(source_ticker, chain_data, majors_data, dte_api_name, dte_label)
                
                if df_levels is not None and not df_levels.empty and metadata:
                    output_file = f"{target.lower()}_gex_{dte_api_name}.csv"
                    df_levels.to_csv(output_file, index=False)
                    
                    csv_content = df_levels.to_csv(index=False)
                    csv_key = f"{target.lower()}_{dte_api_name}"
                    csv_data_dict[csv_key] = csv_to_pinescript_string(csv_content)
                    metadata_dict[csv_key] = metadata_to_pinescript_string(metadata)
                    
                    log(f"      💾 {output_file} ({len(df_levels)} niveaux)")
                    total_files += 1
    
    if csv_data_dict:
        pinescript_indicator = generate_pinescript_indicator(csv_data_dict, metadata_dict)
        indicator_file = 'indicator/gex-levels.pine'
        
        with open(indicator_file, 'w', encoding='utf-8') as f:
            f.write(pinescript_indicator)
        
        log(f"\n📊 Pine Script généré: {indicator_file}")
    
    if total_files > 0:
        with open('last_update.txt', 'w') as f:
            f.write(timestamp_str)
            f.flush()
    
    log("\n" + "=" * 70)
    log(f"✅ COMPLETED - {total_files} CSV + 1 Pine Script générés")
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
