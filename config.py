"""Configuration du projet GEX TradingView"""
import os
from dotenv import load_dotenv

load_dotenv()

# API Configuration
API_KEY = os.getenv('GEXBOT_API_KEY')
BASE_URL = "https://api.gexbot.com"

# Tickers et ratios de conversion
TICKERS = {
    'SPX': {
        'target': 'ES',
        'ratio': 10,
        'name': 'S&P 500 E-mini'
    },
    'NDX': {
        'target': 'NQ',
        'ratio': 40,
        'name': 'Nasdaq 100 E-mini'
    }
}

# Output files
OUTPUT_FILES = {
    'ES': 'es_gex_levels.csv',
    'NQ': 'nq_gex_levels.csv',
    'TIMESTAMP': 'last_update.txt'
}

# Paramètres
TOP_STRIKES_COUNT = 15
API_TIMEOUT = 15
DEFAULT_AGGREGATION = 'full'
