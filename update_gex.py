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
        return None
    
    config = TICKERS[source_ticker]
    target = config['target']
    spot = chain_data.get('spot', 0)
    min_dte = chain_data.get('min_dte', 0)
    zero_gamma = chain_data.get('zero_gamma', 0)
    
    major_data_source = majors_data if majors_data else chain_data
    call_wall_vol = major_data_source.get('mneg_vol') or major_data_source.get('major_neg_vol', 0)
    call_wall_oi = major_data_source.get('mneg_oi') or major_data_source.get('major_neg_oi', 0)
    put_wall_vol = major_data_source.get('mpos_vol') or major_data_source.get('major_pos_vol', 0)
    put_wall_oi = major_data_source.get('mpos_oi') or major_data_source.get('major_pos_oi', 0)
    
    strikes = chain_data.get('strikes', [])
    if not strikes:
        return None
    
    is_zero_dte = (min_dte == 0)
    dte_display = f"0DTE" if is_zero_dte else f"{min_dte}DTE"
    
    log(f"   📊 {target}/{dte_label} - Spot: {spot}, {dte_display}")
    advanced = calculate_advanced_levels(strikes, spot)
    log(f"      CallResAll: {advanced['call_res_all']:.0f} GEX")
    log(f"      PutSupAll: {advanced['put_sup_all']:.0f} GEX")
    
    levels = []
    
    if zero_gamma and zero_gamma != 0:
        regime = "Negative Gamma" if spot > zero_gamma else "Positive Gamma"
        levels.append({'strike': round(zero_gamma, 2), 'importance': 10, 'type': 'gamma_flip', 'label': 'Zero Gamma', 'dte': dte_display, 'description': regime})
    
    if advanced['top_call_wall']:
        cw = advanced['top_call_wall']
        levels.append({'strike': round(cw['strike'], 2), 'importance': 10, 'type': 'gamma_wall_call', 'label': 'Gamma Wall (Call)', 'dte': dte_display, 'description': f"{cw['abs_gex']:.0f} GEX"})
    
    if advanced['top_put_wall']:
        pw = advanced['top_put_wall']
        levels.append({'strike': round(pw['strike'], 2), 'importance': 10, 'type': 'gamma_wall_put', 'label': 'Gamma Wall (Put)', 'dte': dte_display, 'description': f"{pw['abs_gex']:.0f} GEX"})
    
    for idx, hvl in enumerate(advanced['hvl_levels']):
        levels.append({'strike': round(hvl['strike'], 2), 'importance': 9, 'type': 'hvl', 'label': f"HVL #{idx+1}", 'dte': dte_display, 'description': f"{hvl['abs_gex']:.0f} GEX @ {hvl['distance_pct']:.1f}% from spot"})
    
    if is_zero_dte:
        put_0dte = [p for p in advanced['all_put_walls'][:3] if p['strike'] < spot]
        for idx, ps in enumerate(put_0dte[:2]):
            levels.append({'strike': round(ps['strike'], 2), 'importance': 9, 'type': 'put_sup_0dte', 'label': f"PutSup0DTE #{idx+1}", 'dte': dte_display, 'description': f"Support 0DTE: {ps['abs_gex']:.0f} GEX"})
        
        call_0dte = [c for c in advanced['all_call_walls'][:3] if c['strike'] > spot]
        for idx, cr in enumerate(call_0dte[:2]):
            levels.append({'strike': round(cr['strike'], 2), 'importance': 9, 'type': 'call_res_0dte', 'label': f"CallRes0DTE #{idx+1}", 'dte': dte_display, 'description': f"Resistance 0DTE: {cr['abs_gex']:.0f} GEX"})
    
    if call_wall_vol and call_wall_vol != 0:
        levels.append({'strike': round(call_wall_vol, 2), 'importance': 9, 'type': 'call_wall_api', 'label': 'Call Wall (Vol API)', 'dte': dte_display, 'description': 'Major from API'})
    if put_wall_vol and put_wall_vol != 0:
        levels.append({'strike': round(put_wall_vol, 2), 'importance': 9, 'type': 'put_wall_api', 'label': 'Put Wall (Vol API)', 'dte': dte_display, 'description': 'Major from API'})
    if call_wall_oi and call_wall_oi != 0:
        levels.append({'strike': round(call_wall_oi, 2), 'importance': 8, 'type': 'call_wall_api', 'label': 'Call Wall (OI API)', 'dte': dte_display, 'description': 'Major from API'})
    if put_wall_oi and put_wall_oi != 0:
        levels.append({'strike': round(put_wall_oi, 2), 'importance': 8, 'type': 'put_wall_api', 'label': 'Put Wall (OI API)', 'dte': dte_display, 'description': 'Major from API'})
    
    for idx, cw in enumerate(advanced['all_call_walls'][1:4], 2):
        levels.append({'strike': round(cw['strike'], 2), 'importance': 8, 'type': 'call_wall', 'label': f"Call Wall #{idx}", 'dte': dte_display, 'description': f"{cw['abs_gex']:.0f} GEX"})
    for idx, pw in enumerate(advanced['all_put_walls'][1:4], 2):
        levels.append({'strike': round(pw['strike'], 2), 'importance': 8, 'type': 'put_wall', 'label': f"Put Wall #{idx}", 'dte': dte_display, 'description': f"{pw['abs_gex']:.0f} GEX"})
    
    strikes_data = []
    for strike_array in strikes:
        if isinstance(strike_array, list) and len(strike_array) >= 3:
            strike_price = strike_array[0]
            gex_vol = strike_array[1]
            gex_oi = strike_array[2]
            total_gex_sum = gex_vol + gex_oi
            total_gex = abs(total_gex_sum)
            if total_gex > 100:
                strikes_data.append({'strike': round(strike_price, 2), 'total_gex': total_gex, 'is_call': (total_gex_sum > 0)})
    
    strikes_data.sort(key=lambda x: x['total_gex'], reverse=True)
    for s in strikes_data[:15]:
        strike_type = "Call Resist" if s['is_call'] else "Put Support"
        levels.append({'strike': s['strike'], 'importance': 7, 'type': 'strike_' + ('call' if s['is_call'] else 'put'), 'label': strike_type, 'dte': dte_display, 'description': f"{s['total_gex']:.0f} GEX"})
    
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
                        importance, label = 9, f"Vol Trigger ({interval_name})"
                    elif intensity > 2000:
                        importance, label = 8, f"Vol Trigger ({interval_name})"
                    else:
                        importance, label = 7, f"Vol Trigger ({interval_name})"
                    levels.append({'strike': round(strike_val, 2), 'importance': importance, 'type': 'vol_trigger', 'label': label, 'dte': dte_display, 'description': f"Change: {gex_change:+.0f}"})
    
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
        levels.append({'strike': round(max_pain, 2), 'importance': 8, 'type': 'max_pain', 'label': 'Max Pain', 'dte': dte_display, 'description': 'Expiration Target'})
    
    df = pd.DataFrame(levels)
    if not df.empty:
        df = df.drop_duplicates(subset=['strike'], keep='first')
        df = df.sort_values('importance', ascending=False)
        df['call_res_all'] = advanced['call_res_all']
        df['put_sup_all'] = advanced['put_sup_all']
        log(f"      ✅ {len(df)} niveaux générés")
        return df
    return None


def csv_to_pinescript_string(csv_content):
    """Convertit le contenu CSV en string échappé pour Pine Script"""
    escaped = csv_content.replace('"', '\\"').replace('\n', '\\n')
    return escaped


def generate_pinescript_indicator(csv_data_dict):
    """Génère le fichier Pine Script avec multiplicateurs FIXES (non modifiables)"""
    
    es_zero_str = csv_data_dict.get('es_zero', '')
    es_one_str = csv_data_dict.get('es_one', '')
    es_full_str = csv_data_dict.get('es_full', '')
    nq_zero_str = csv_data_dict.get('nq_zero', '')
    nq_one_str = csv_data_dict.get('nq_one', '')
    nq_full_str = csv_data_dict.get('nq_full', '')
    
    # Récupérer les multiplicateurs depuis TICKERS
    spx_multiplier = TICKERS['SPX']['multiplier']
    ndx_multiplier = TICKERS['NDX']['multiplier']
    
    # Template Pine Script avec multiplicateurs FIXES
    part1 = f'''//@version=6
indicator("GEX Professional Levels - Auto", overlay=true, max_lines_count=500, max_labels_count=500)


// ==================== CSV DATA (AUTO-GENERATED) ====================
string es_csv_zero = "{es_zero_str}"
string es_csv_one = "{es_one_str}"
string es_csv_full = "{es_full_str}"
string nq_csv_zero = "{nq_zero_str}"
string nq_csv_one = "{nq_one_str}"
string nq_csv_full = "{nq_full_str}"
'''
    
    part2 = f'''

// ==================== AUTO-DETECTION TICKER ====================
string detected_ticker = "ES"
if str.contains(syminfo.ticker, "NQ") or str.contains(syminfo.ticker, "NDX") or str.contains(syminfo.ticker, "NAS")
    detected_ticker := "NQ"
else if str.contains(syminfo.ticker, "ES") or str.contains(syminfo.ticker, "SPX") or str.contains(syminfo.ticker, "SP500")
    detected_ticker := "ES"


// ==================== MULTIPLICATEURS FIXES POUR CONVERSION ====================
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
bool show_imp_10 = input.bool(true, "Importance 10 (Gamma Flip/Walls)", group="🎯 Importance Filters")
bool show_imp_9 = input.bool(true, "Importance 9 (HVL, 0DTE Levels)", group="🎯 Importance Filters")
bool show_imp_8 = input.bool(true, "Importance 8 (Secondary Walls, Max Pain)", group="🎯 Importance Filters")
bool show_imp_7 = input.bool(false, "Importance 7 (Strikes, Vol Triggers)", group="🎯 Importance Filters")


// ==================== FILTRES PAR TYPE ====================
bool show_gamma_flip = input.bool(true, "Zero Gamma", group="📌 Level Types")
bool show_gamma_walls = input.bool(true, "Gamma Walls", group="📌 Level Types")
bool show_hvl = input.bool(true, "HVL (High Vol Levels)", group="📌 Level Types")
bool show_0dte_levels = input.bool(true, "0DTE Specific Levels", group="📌 Level Types")
bool show_max_pain = input.bool(true, "Max Pain", group="📌 Level Types")
bool show_strikes = input.bool(false, "Top Strikes", group="📌 Level Types")
bool show_vol_triggers = input.bool(false, "Vol Triggers", group="📌 Level Types")


// ==================== STYLE ====================
color color_gamma_flip = input.color(color.new(color.purple, 0), "Zero Gamma", group="🎨 Colors", inline="c1")
color color_call_wall = input.color(color.new(color.red, 0), "Call Wall", group="🎨 Colors", inline="c2")
color color_put_wall = input.color(color.new(color.green, 0), "Put Wall", group="🎨 Colors", inline="c2")
color color_hvl = input.color(color.new(color.orange, 0), "HVL", group="🎨 Colors", inline="c3")
color color_0dte = input.color(color.new(color.yellow, 0), "0DTE Levels", group="🎨 Colors", inline="c4")
color color_max_pain = input.color(color.new(color.blue, 0), "Max Pain", group="🎨 Colors", inline="c5")
color color_strikes = input.color(color.new(color.gray, 30), "Strikes", group="🎨 Colors", inline="c6")


bool show_labels = input.bool(true, "Show Labels", group="🏷️ Labels")
string label_size = input.string("Small", "Label Size", options=["Tiny", "Small", "Normal", "Large"], group="🏷️ Labels")
bool use_distance_filter = input.bool(false, "Filter Labels Near Price", group="🏷️ Labels")
float label_min_distance_pct = input.float(0.3, "Min Distance from Price (%)", minval=0, maxval=5, step=0.1, group="🏷️ Labels")


// ==================== STOCKAGE ====================
var array<line> all_lines = array.new<line>()
var array<label> all_labels = array.new<label>()


// ==================== FONCTIONS ====================
get_label_size(string size) =>
    size == "Tiny" ? size.tiny : size == "Small" ? size.small : size == "Normal" ? size.normal : size.large


should_show_level(int importance, string level_type) =>
    bool show_importance = (importance == 10 and show_imp_10) or (importance == 9 and show_imp_9) or (importance == 8 and show_imp_8) or (importance == 7 and show_imp_7)
    bool show_type = (str.contains(level_type, "gamma_flip") and show_gamma_flip) or (str.contains(level_type, "gamma_wall") and show_gamma_walls) or (str.contains(level_type, "hvl") and show_hvl) or (str.contains(level_type, "0dte") and show_0dte_levels) or (str.contains(level_type, "max_pain") and show_max_pain) or (str.contains(level_type, "strike_") and show_strikes) or (str.contains(level_type, "vol_trigger") and show_vol_triggers) or str.contains(level_type, "call_wall") or str.contains(level_type, "put_wall")
    show_importance and show_type


get_level_color(string level_type) =>
    str.contains(level_type, "gamma_flip") ? color_gamma_flip : str.contains(level_type, "gamma_wall_call") or str.contains(level_type, "call_wall") or str.contains(level_type, "call_res") ? color_call_wall : str.contains(level_type, "gamma_wall_put") or str.contains(level_type, "put_wall") or str.contains(level_type, "put_sup") ? color_put_wall : str.contains(level_type, "hvl") ? color_hvl : str.contains(level_type, "0dte") ? color_0dte : str.contains(level_type, "max_pain") ? color_max_pain : color_strikes


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
                                // CONVERSION AVEC MULTIPLICATEUR FIXE
                                float strike_price = needs_conversion ? strike_price_raw * conversion_multiplier : strike_price_raw
                                
                                string level_type = array.get(fields, 2)
                                string label_text = array.get(fields, 3)
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
                                            string simple_label = label_text + " " + str.tostring(strike_price, "#.##")
                                            label new_label = label.new(x=bar_index, y=strike_price, text=simple_label, color=color.new(color.white, 100), textcolor=level_color, style=label.style_none, size=get_label_size(label_size))
                                            array.push(all_labels, new_label)


// ==================== EXÉCUTION ====================
if barstate.islast
    clear_all_objects()
    
    string csv_active = ""
    
    if detected_ticker == "ES"
        csv_active := selected_dte == "0DTE" ? es_csv_zero : selected_dte == "1DTE" ? es_csv_one : es_csv_full
    else
        csv_active := selected_dte == "0DTE" ? nq_csv_zero : selected_dte == "1DTE" ? nq_csv_one : nq_csv_full
    
    process_csv(csv_active)


plot(close, title="Price", display=display.none)
'''
    
    return part1 + part2


def main():
    timestamp = datetime.now(timezone.utc)
    timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')
    
    log("=" * 70)
    log(f"🚀 GEX PROFESSIONAL LEVELS - {timestamp_str}")
    log("=" * 70)
    
    if not API_KEY:
        log("❌ ERREUR: GEXBOT_API_KEY non définie")
        sys.exit(1)
    
    # Afficher les multiplicateurs utilisés
    log("\n🔢 Multiplicateurs configurés:")
    log(f"   SPX -> ES: {TICKERS['SPX']['multiplier']}")
    log(f"   NDX -> NQ: {TICKERS['NDX']['multiplier']}")
    
    os.makedirs('indicator', exist_ok=True)
    
    total_files = 0
    csv_data_dict = {}
    
    for source_ticker, config in TICKERS.items():
        target = config['target']
        log(f"\n📊 Processing {source_ticker} -> {target}")
        
        for dte_api_name, dte_label in DTE_PERIODS.items():
            log(f"\n   🔹 {dte_label}")
            chain_data = fetch_gex_data(source_ticker, dte_api_name)
            majors_data = fetch_gex_majors(source_ticker, dte_api_name)
            
            if chain_data and chain_data.get('strikes'):
                df_levels = generate_levels(source_ticker, chain_data, majors_data, dte_api_name, dte_label)
                
                if df_levels is not None and not df_levels.empty:
                    output_file = f"{target.lower()}_gex_{dte_api_name}.csv"
                    df_levels.to_csv(output_file, index=False)
                    
                    csv_content = df_levels.to_csv(index=False)
                    csv_key = f"{target.lower()}_{dte_api_name}"
                    csv_data_dict[csv_key] = csv_to_pinescript_string(csv_content)
                    
                    log(f"      💾 {output_file} ({len(df_levels)} niveaux)")
                    total_files += 1
    
    if csv_data_dict:
        pinescript_indicator = generate_pinescript_indicator(csv_data_dict)
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
