import { useState } from "react";
import "./App.css";

export default function PineFooter({ pineCode = "" }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(pineCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  const downloadHref = `data:text/plain;charset=utf-8,${encodeURIComponent(
    pineCode || ""
  )}`;

  return (
    <section className="pine-footer" aria-live="polite">
      <div className="pine-footer-inner">
        <p className="muted">Script Pine généré — copier ou télécharger :</p>
        <div className="code-actions">
          <button
            className={`btn ${copied ? "success" : "primary"}`}
            onClick={copyToClipboard}
          >
            {copied ? "Copié !" : "Copier le code"}
          </button>
          <a className="btn secondary" href={downloadHref} download="gex-levels.pine">
            Télécharger .pine
          </a>
        </div>
      </div>
    </section>
  );

}
