# GEX Levels TradingView

Indicateur automatique GEX pour ES et NQ.

## 🚀 Installation

### Localement

\`\`\`bash
git clone https://github.com/enzocosson/gex-tradingview.git
cd gex-tradingview

## 📦 Déploiement sur Vercel

Ce dépôt contient une application frontend construite avec Vite dans le dossier `frontend`. Voici les instructions pour déployer rapidement avec la CLI Vercel.

- Installer la CLI Vercel (globalement) :

```bash
npm i -g vercel
# ou : pnpm add -g vercel
```

- Se connecter (une seule fois) :

```bash
vercel login
```

- Déployer depuis la racine en ciblant le dossier `frontend` :

```bash
vercel --cwd frontend
# pour une mise en production :
vercel --cwd frontend --prod
```

La configuration de build se trouve dans `vercel.json` (racine) : Vercel utilisera `frontend/package.json` et la commande `npm run build` pour produire le dossier `dist`.

Alternative : créer un projet depuis l'interface Vercel et définir la `Root Directory` sur `frontend`.

pip install -r requirements.txt
echo "GEXBOT_API_KEY=votre_cle" > .env
python update_gex.py
\`\`\`

### TradingView

1. Ouvrir \`GEX_Levels_Auto.pine\`
2. Copier tout le contenu
3. TradingView → Pine Editor → New
4. Coller et Save
5. Add to Chart (ES ou NQ)

## 📊 Mise à jour

**Automatique** : GitHub Actions update toutes les 5min

**Manuel** :
\`\`\`bash
python update_gex.py

# Copier GEX_Levels_Auto.pine dans TradingView

\`\`\`

## 🎯 Fonctionnalités

- ⚖️ Zero Gamma (jaune)
- 🟢 Supports (vert)
- 🔴 Résistances (rouge)
- 🔥 Hotspots (orange)
- 📱 Alertes automatiques

## ⚙️ Configuration GitHub

1. Repo → Settings → Secrets
2. New secret: \`GEXBOT_API_KEY\`
3. Rendre le repo public

## 📝 Structure

\`\`\`
gex-tradingview/
├── update_gex.py # Script Python
├── config.py # Configuration
├── GEX_Levels_Auto.pine # Indicateur généré
├── es_gex_levels.csv # Données ES
├── nq_gex_levels.csv # Données NQ
└── .github/workflows/ # Automation
\`\`\`
