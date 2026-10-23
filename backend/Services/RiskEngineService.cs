using System;
using System.Collections.Generic;

namespace SmartAssur.Api.Services
{
    public record RiskAssessmentResult(
        string RiskLevel, // LOW, MEDIUM, HIGH, INCOHERENT
        string ConfidenceLabel, // Fort, Moyen, Faible, Incohérent
        int Score, // 0 - 100
        List<string> Factors,
        List<string> Recommendations
    );

    public interface IRiskEngineService
    {
        RiskAssessmentResult Evaluate(
            bool isLuhnValid,
            bool isTacMatched,
            bool isMobilePaired,
            bool isUsbAdbUsed,
            bool hasFrontPhoto,
            bool hasBackPhoto,
            bool isDuplicateImei,
            int photoQualityScore
        );
    }

    public class RiskEngineService : IRiskEngineService
    {
        public RiskAssessmentResult Evaluate(
            bool isLuhnValid,
            bool isTacMatched,
            bool isMobilePaired,
            bool isUsbAdbUsed,
            bool hasFrontPhoto,
            bool hasBackPhoto,
            bool isDuplicateImei,
            int photoQualityScore)
        {
            var factors = new List<string>();
            var recommendations = new List<string>();

            if (isDuplicateImei)
            {
                factors.Add("IMEI déjà répertorié dans un autre dossier actif.");
                recommendations.Add("Bloquer la souscription automatique et transmettre au service anti-fraude.");
                return new RiskAssessmentResult("INCOHERENT", "Incohérent / Risque majeur", 10, factors, recommendations);
            }

            if (!isLuhnValid)
            {
                factors.Add("Luhn checksum invalide sur le numéro IMEI.");
                recommendations.Add("Corriger la saisie ou fournir la facture d'achat.");
                return new RiskAssessmentResult("INCOHERENT", "Incohérent", 0, factors, recommendations);
            }

            int score = 40; // Base score for valid Luhn
            factors.Add("Contrôle Luhn validé (format IMEI conforme).");

            if (isTacMatched)
            {
                score += 20;
                factors.Add("TAC reconnu dans la base d'homologation smartphone.");
            }
            else
            {
                factors.Add("TAC non répertorié : marque/modèle déclaré manuellement.");
                recommendations.Add("Vérification manuelle de la variante d'appareil par le gestionnaire.");
            }

            if (isUsbAdbUsed)
            {
                score += 20;
                factors.Add("Télémétrie matérielle lue via USB WebADB.");
            }
            else if (isMobilePaired)
            {
                score += 15;
                factors.Add("Session interactive complétée directement depuis le smartphone cible.");
            }
            else
            {
                factors.Add("Session sans interaction directe mobile confirmée.");
            }

            if (hasFrontPhoto && hasBackPhoto)
            {
                score += 15;
                factors.Add($"Photos recto/verso fournies (qualité visuelle {photoQualityScore}%).");
            }
            else
            {
                recommendations.Add("Photos recto et verso obligatoires pour émission de garantie.");
            }

            score = Math.Min(100, Math.Max(0, score));

            if (score >= 80)
            {
                recommendations.Add("Dossier éligible à validation accélérée.");
                return new RiskAssessmentResult("LOW", "Fort (Confiance Élevée)", score, factors, recommendations);
            }
            else if (score >= 60)
            {
                recommendations.Add("Examen standard par le gestionnaire requis avant accord.");
                return new RiskAssessmentResult("MEDIUM", "Moyen (Revue standard)", score, factors, recommendations);
            }
            else
            {
                recommendations.Add("Pièces justificatives complémentaires (facture, photo boîte) exigées.");
                return new RiskAssessmentResult("HIGH", "Faible (Contrôle renforcé)", score, factors, recommendations);
            }
        }
    }
}

