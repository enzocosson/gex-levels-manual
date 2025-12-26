#!/usr/bin/env python3
"""
GEX Levels Updater
Updates ES and NQ GEX levels from API and generates Pine Script indicator
"""

import os
import sys
from datetime import datetime, timezone
import requests
import pandas as pd
from pathlib import Path

# Configuration
API_BASE_URL = "https://api.gexbot.com"
API_KEY = os.environ.get("GEXBOT_API_KEY")

# Paths
SCRIPT_DIR = Path(__file__).parent
INDICATOR_DIR = SCRIPT_DIR / "indicator"
LAST_UPDATE_FILE = SCRIPT_DIR / "last_update.txt"

# Output files
ES_FILES = {
    "zero": SCRIPT_DIR / "es_gex_zero.csv",
    "one": SCRIPT_DIR / "es_gex_one.csv",
    "full": SCRIPT_DIR / "es_gex_full.csv"
}

NQ_FILES = {
    "zero": SCRIPT_DIR / "nq_gex_zero.csv",
    "one": SCRIPT_DIR / "nq_gex_one.csv",
    "full": SCRIPT_DIR / "nq_gex_full.csv"
}


def fetch_gex_data(symbol, dte_type):
    """
    Fetch GEX data from API
    
    Args:
        symbol: 'ES' or 'NQ'
        dte_type: 'zero', 'one', or 'full'
    
    Returns:
        dict: API response data
    """
    if not API_KEY:
        print("❌ Error: GEXBOT_API_KEY not set in environment")
        sys.exit(1)
    
    endpoint = f"{API_BASE_URL}/gex/{symbol.lower()}/{dte_type}"
    
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json"
    }
    
    try:
        print(f"📡 Fetching {symbol} {dte_type.upper()} data...")
        response = requests.get(endpoint, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    
    except requests.exceptions.HTTPError as e:
        if response.status_code == 401:
            print(f"❌ Authentication failed: Invalid API key")
        elif response.status_code == 404:
            print(f"❌ Endpoint not found: {endpoint}")
        else:
            print(f"❌ HTTP error {response.status_code}: {e}")
        sys.exit(1)
    
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        sys.exit(1)


def process_gex_levels(data):
    """
    Process GEX data and convert to DataFrame
    
    Args:
        data: API response data
    
    Returns:
        pd.DataFrame: Processed GEX levels
    """
    if not data or "levels" not in data:
        print("⚠️  No levels data found")
        return pd.DataFrame()
    
    levels = data["levels"]
    
    if not levels:
        print("⚠️  Empty levels array")
        return pd.DataFrame()
    
    df = pd.DataFrame(levels)
    
    # Ensure required columns
    required_cols = ["strike", "gex", "type"]
    for col in required_cols:
        if col not in df.columns:
            df[col] = ""
    
    # Sort by strike price
    if "strike" in df.columns:
        df = df.sort_values("strike", ascending=False)
    
    return df


def save_csv(df, filepath):
    """
    Save DataFrame to CSV
    
    Args:
        df: DataFrame to save
        filepath: Path to output file
    """
    if df.empty:
        print(f"⚠️  Skipping empty data for {filepath.name}")
        # Create empty file with headers
        pd.DataFrame(columns=["strike", "gex", "type"]).to_csv(
            filepath, 
            index=False
        )
        return
    
    df.to_csv(filepath, index=False)
    print(f"✅ Saved {filepath.name} ({len(df)} levels)")


def update_symbol(symbol, files_dict):
    """
    Update all DTE types for a symbol
    
    Args:
        symbol: 'ES' or 'NQ'
        files_dict: Dict mapping DTE types to file paths
    """
    print(f"\n{'='*50}")
    print(f"📈 Updating {symbol} levels...")
    print(f"{'='*50}")
    
    for dte_type, filepath in files_dict.items():
        try:
            data = fetch_gex_data(symbol, dte_type)
            df = process_gex_levels(data)
            save_csv(df, filepath)
        
        except Exception as e:
            print(f"❌ Error processing {symbol} {dte_type}: {e}")
            # Continue with other types even if one fails
            continue


def generate_pine_script():
    """
    Generate Pine Script indicator from CSV files
    """
    print(f"\n{'='*50}")
    print("📝 Generating Pine Script indicator...")
    print(f"{'='*50}")
    
    INDICATOR_DIR.mkdir(exist_ok=True)
    output_file = INDICATOR_DIR / "gex-levels.pine"
    
    # Read CSV files
    try:
        es_zero = pd.read_csv(ES_FILES["zero"])
        es_one = pd.read_csv(ES_FILES["one"])
        es_full = pd.read_csv(ES_FILES["full"])
        nq_zero = pd.read_csv(NQ_FILES["zero"])
        nq_one = pd.read_csv(NQ_FILES["one"])
        nq_full = pd.read_csv(NQ_FILES["full"])
    except Exception as e:
        print(f"❌ Error reading CSV files: {e}")
        return
    
    # Generate Pine Script
    pine_code = generate_pine_code(
        es_zero, es_one, es_full,
        nq_zero, nq_one, nq_full
    )
    
    # Write to file
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(pine_code)
    
    print(f"✅ Generated {output_file.name}")


def generate_pine_code(es_zero, es_one, es_full, nq_zero, nq_one, nq_full):
    """
    Generate complete Pine Script code
    
    Returns:
        str: Pine Script code
    """
    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S UTC")
    
    # Helper function to format levels
    def format_levels(df, max_levels=10):
        if df.empty:
            return "array.new_float(0)"
        
        levels = df.head(max_levels)["strike"].tolist()
        levels_str = ", ".join([str(float(x)) for x in levels])
        return f"array.from({levels_str})"
    
    pine_script = f'''//@version=5
indicator("GEX Levels - ES/NQ", overlay=true, max_lines_count=500, max_labels_count=500)

// ==========================================
// GEX LEVELS INDICATOR
// Last update: {timestamp}
// ==========================================

// INPUTS
show_es = input.bool(true, "Show ES Levels", group="Display")
show_nq = input.bool(true, "Show NQ Levels", group="Display")
show_0dte = input.bool(true, "Show 0DTE", group="Expirations")
show_1dte = input.bool(true, "Show 1DTE", group="Expirations")
show_full = input.bool(true, "Show Full", group="Expirations")

es_color_0dte = input.color(color.new(color.blue, 0), "ES 0DTE", group="Colors")
es_color_1dte = input.color(color.new(color.purple, 0), "ES 1DTE", group="Colors")
es_color_full = input.color(color.new(color.green, 0), "ES Full", group="Colors")
nq_color_0dte = input.color(color.new(color.orange, 0), "NQ 0DTE", group="Colors")
nq_color_1dte = input.color(color.new(color.red, 0), "NQ 1DTE", group="Colors")
nq_color_full = input.color(color.new(color.teal, 0), "NQ Full", group="Colors")

line_width = input.int(2, "Line Width", minval=1, maxval=5, group="Style")
line_style_input = input.string("Solid", "Line Style", options=["Solid", "Dashed", "Dotted"], group="Style")

// Convert line style
line_style = line_style_input == "Solid" ? line.style_solid : 
             line_style_input == "Dashed" ? line.style_dashed : 
             line.style_dotted

// SYMBOL DETECTION
is_es = syminfo.ticker == "ES1!" or syminfo.ticker == "ESZ2024" or str.contains(syminfo.ticker, "ES")
is_nq = syminfo.ticker == "NQ1!" or syminfo.ticker == "NQZ2024" or str.contains(syminfo.ticker, "NQ")

// GEX DATA ARRAYS
// ES Levels
var es_levels_0dte = {format_levels(es_zero)}
var es_levels_1dte = {format_levels(es_one)}
var es_levels_full = {format_levels(es_full)}

// NQ Levels
var nq_levels_0dte = {format_levels(nq_zero)}
var nq_levels_1dte = {format_levels(nq_one)}
var nq_levels_full = {format_levels(nq_full)}

// DRAWING FUNCTIONS
var line[] all_lines = array.new_line()
var label[] all_labels = array.new_label()

f_clear_drawings() =>
    for i = 0 to array.size(all_lines) - 1
        line.delete(array.get(all_lines, i))
    array.clear(all_lines)
    
    for i = 0 to array.size(all_labels) - 1
        label.delete(array.get(all_labels, i))
    array.clear(all_labels)

f_draw_level(level_price, level_color, label_text) =>
    // Draw horizontal line
    new_line = line.new(
        x1=bar_index - 100,
        y1=level_price,
        x2=bar_index + 20,
        y2=level_price,
        color=level_color,
        width=line_width,
        style=line_style,
        extend=extend.right
    )
    array.push(all_lines, new_line)
    
    // Draw label
    new_label = label.new(
        x=bar_index,
        y=level_price,
        text=label_text + "\\n" + str.tostring(level_price, "#.##"),
        style=label.style_label_left,
        color=level_color,
        textcolor=color.white,
        size=size.small
    )
    array.push(all_labels, new_label)

f_draw_levels(levels_array, level_color, prefix) =>
    if array.size(levels_array) > 0
        for i = 0 to math.min(array.size(levels_array) - 1, 9)
            level = array.get(levels_array, i)
            f_draw_level(level, level_color, prefix + str.tostring(i + 1))

// MAIN LOGIC
if barstate.islast
    f_clear_drawings()
    
    // ES Levels
    if show_es and is_es
        if show_0dte
            f_draw_levels(es_levels_0dte, es_color_0dte, "ES 0D L")
        if show_1dte
            f_draw_levels(es_levels_1dte, es_color_1dte, "ES 1D L")
        if show_full
            f_draw_levels(es_levels_full, es_color_full, "ES Full L")
    
    // NQ Levels
    if show_nq and is_nq
        if show_0dte
            f_draw_levels(nq_levels_0dte, nq_color_0dte, "NQ 0D L")
        if show_1dte
            f_draw_levels(nq_levels_1dte, nq_color_1dte, "NQ 1D L")
        if show_full
            f_draw_levels(nq_levels_full, nq_color_full, "NQ Full L")
    
    // Info label
    info_text = "GEX Levels\\nLast update: {timestamp}\\n" +
                "ES: " + str.tostring(array.size(es_levels_0dte)) + "/0D " +
                str.tostring(array.size(es_levels_1dte)) + "/1D " +
                str.tostring(array.size(es_levels_full)) + "/Full\\n" +
                "NQ: " + str.tostring(array.size(nq_levels_0dte)) + "/0D " +
                str.tostring(array.size(nq_levels_1dte)) + "/1D " +
                str.tostring(array.size(nq_levels_full)) + "/Full"
    
    info_label = label.new(
        x=bar_index,
        y=high,
        text=info_text,
        style=label.style_label_down,
        color=color.new(color.gray, 70),
        textcolor=color.white,
        size=size.small
    )
    array.push(all_labels, info_label)

// Plot for alerting
plot(close, title="Close", display=display.none)
'''
    
    return pine_script


def update_timestamp():
    """
    Update last_update.txt with current timestamp
    """
    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S UTC")
    
    with open(LAST_UPDATE_FILE, "w") as f:
        f.write(timestamp)
    
    print(f"✅ Updated timestamp: {timestamp}")


def main():
    """
    Main update workflow
    """
    print("\n" + "="*50)
    print("🚀 GEX Levels Updater")
    print("="*50)
    
    try:
        # Update ES levels
        update_symbol("ES", ES_FILES)
        
        # Update NQ levels
        update_symbol("NQ", NQ_FILES)
        
        # Generate Pine Script
        generate_pine_script()
        
        # Update timestamp
        update_timestamp()
        
        print("\n" + "="*50)
        print("✅ Update completed successfully!")
        print("="*50 + "\n")
    
    except KeyboardInterrupt:
        print("\n⚠️  Update interrupted by user")
        sys.exit(1)
    
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
