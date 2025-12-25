"""Script de test pour GexBot API"""
import requests
import json
from config import API_KEY, BASE_URL


def test_endpoint(ticker, aggregation_period):
    """Test d'un endpoint selon la doc: /{TICKER}/classic/{AGGREGATION_PERIOD}"""
    url = f"{BASE_URL}/{ticker}/classic/{aggregation_period}?key={API_KEY}"
    headers = {
        'User-Agent': 'GexTradingScript/1.0',
        'Accept': 'application/json'
    }
    
    print(f"\n📡 Test {ticker} - {aggregation_period}")
    print(f"   URL: {url.replace(API_KEY, '***')}")
    
    try:
        response = requests.get(url, headers=headers, timeout=15)
        
        # Afficher status
        print(f"   Status HTTP: {response.status_code}")
        
        if not response.ok:
            print(f"   ❌ Erreur HTTP")
            print(f"   Response: {response.text[:200]}")  # Premiers 200 chars
            return False
        
        data = response.json()
        print(f"   ✅ Réponse JSON reçue")
        
        # Analyser la structure
        if isinstance(data, dict):
            keys = list(data.keys())
            print(f"   📋 Clés JSON: {keys}")
            
            # Informations importantes
            if 'timestamp' in data:
                print(f"   🕐 Timestamp: {data['timestamp']}")
            
            if 'ticker' in data:
                print(f"   📊 Ticker: {data['ticker']}")
            
            if 'spot' in data:
                print(f"   💰 Spot: {data['spot']}")
            
            if 'zero_gamma' in data:
                print(f"   🎯 Zero Gamma: {data['zero_gamma']}")
            
            if 'strikes' in data:
                strikes_count = len(data['strikes'])
                print(f"   📈 Nombre de strikes: {strikes_count}")
                
                # Afficher exemple de strike
                if strikes_count > 0:
                    first_strike = data['strikes'][0]
                    print(f"   📌 Exemple strike: {first_strike}")
                    print(f"      Format: {len(first_strike)} éléments")
            
            if 'mpos_vol' in data:
                print(f"   ⬆️  Major Support (Vol): {data['mpos_vol']}")
            
            if 'mneg_vol' in data:
                print(f"   ⬇️  Major Resistance (Vol): {data['mneg_vol']}")
            
            if 'one' in data:
                print(f"   🔥 Max Change 1min: {data['one']}")
            
            if 'five' in data:
                print(f"   🔥 Max Change 5min: {data['five']}")
            
            # Sauvegarder exemple JSON pour analyse
            filename = f"example_{ticker}_{aggregation_period}.json"
            with open(filename, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"   💾 Exemple sauvegardé: {filename}")
        
        else:
            print(f"   ⚠️  Type inattendu: {type(data)}")
        
        return True
        
    except requests.exceptions.Timeout:
        print(f"   ❌ Timeout après 15s")
        return False
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Erreur réseau: {e}")
        return False
    except json.JSONDecodeError as e:
        print(f"   ❌ Erreur parsing JSON: {e}")
        return False
    except Exception as e:
        print(f"   ❌ Erreur inattendue: {e}")
        return False


def test_all_aggregations(ticker):
    """Test tous les types d'agrégation pour un ticker"""
    print(f"\n{'='*60}")
    print(f"📊 TEST COMPLET - {ticker}")
    print(f"{'='*60}")
    
    # Selon la doc GexBot, les aggregations possibles sont généralement:
    # zero, one, five, fifteen, thirty, full, etc.
    aggregations = ['zero', 'one', 'five', 'fifteen', 'thirty', 'full']
    
    results = {}
    for agg in aggregations:
        result = test_endpoint(ticker, agg)
        results[agg] = result
    
    return results


def main():
    print("=" * 60)
    print("🧪 TEST API GEXBOT - CLASSIC ENDPOINTS")
    print("=" * 60)
    
    if not API_KEY:
        print("❌ GEXBOT_API_KEY non définie dans .env")
        return
    
    print(f"✅ Clé API trouvée: {API_KEY[:10]}...")
    print(f"🌐 Base URL: {BASE_URL}")
    
    # Test complet pour chaque ticker
    all_results = {}
    
    for ticker in ['SPX', 'NDX']:
        results = test_all_aggregations(ticker)
        all_results[ticker] = results
    
    # Résumé global
    print("\n" + "=" * 60)
    print("📋 RÉSUMÉ GLOBAL")
    print("=" * 60)
    
    for ticker, results in all_results.items():
        print(f"\n{ticker}:")
        for agg, success in results.items():
            status = "✅" if success else "❌"
            print(f"  {status} {agg}")
    
    # Statistiques
    total_tests = sum(len(results) for results in all_results.values())
    total_passed = sum(sum(results.values()) for results in all_results.values())
    
    print(f"\n🎯 Score global: {total_passed}/{total_tests} tests réussis")
    
    if total_passed == total_tests:
        print("\n✅ PARFAIT ! Tous les endpoints fonctionnent")
        print("💡 Vérifiez les fichiers example_*.json pour voir la structure des données")
        print("🚀 Vous pouvez maintenant lancer: python update_gex.py")
    elif total_passed > 0:
        print("\n⚠️  Certains endpoints fonctionnent")
        print("💡 Utilisez les endpoints qui réussissent dans update_gex.py")
    else:
        print("\n❌ Aucun endpoint ne fonctionne")
        print("💡 Vérifiez:")
        print("   - Votre clé API est valide")
        print("   - Votre plan inclut l'accès à l'API Classic")
        print("   - Les endpoints dans la documentation GexBot")


if __name__ == '__main__':
    main()
