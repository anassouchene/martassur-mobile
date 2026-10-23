# SmartAssur Mobile V3 - Assurance smartphone en 4 étapes

**Version :** 22 octobre 2026  
**Objectif :** construire un site web premium de souscription d'assurance smartphone, avec identification IMEI/TAC, vérification de possession, capture recto/verso, contrôles anti-fraude et espace de gestion. Aucun logiciel desktop ni application mobile n'est obligatoire.

## 1. Ce que l'on veut obtenir

- Un seul parcours web, responsive, accessible depuis ordinateur, Android et iPhone.
- Quatre écrans/actions principales au maximum, avec remplissage automatique et progression sauvegardee.
- Deux portes d'entree : QR code/session web pour tous, USB Android via navigateur Chromium si l'utilisateur accepte ADB.
- Un IMEI saisi ou lu depuis une photo de la boite/écran par OCR et valide par chiffre de contrôle Luhn.
- Marque/modèle pré-remplis via TAC et catalogue; RAM, stockage et batterie nominale affiches avec source et niveau de confiance.
- Deux photos exterieures recto et verso; contrôle qualité avant validation; autres preuves uniquement si risque eleve.
- Un dossier transmis au gestionnaire, jamais un contrat emis sur la seule foi d'un scan QR, d'un screenshot ou d'un contrôle Luhn.

## 2. Parcours UX en 4 étapes

| Étape | Intitulé | Synthèse du parcours |
|---|---|---|
| **Écran 1** | **Détecter mon smartphone** | Détection automatique du support : QR code / USB Android sur PC, bouton direct sur smartphone. |
| **Écran 2** | **Identifier mon appareil** | Saisie ou scan IMEI, détection automatique marque/modèle/specs, confirmation des détails manquants. |
| **Écran 3** | **Vérifier et photographier** | Session interactive anti-fraude, capture recto/verso avec guide de cadrage et contrôle qualité instantané. |
| **Écran 4** | **Envoyer ma demande** | Récapitulatif, consentement légal, transmission sécurisée et délivrance du numéro de suivi. |

---

### Écran 1 - Détecter mon smartphone

Le site propose automatiquement la bonne méthode :
- Sur PC : QR code ou USB Android.
- Sur smartphone : bouton « Vérifier ce téléphone » directement, sans devoir scanner son propre écran.

**Spécifications techniques :**
- Sur ordinateur : afficher QR code **de session**, plus option "Connecter en USB" pour Android.
- Sur le smartphone a assurer : afficher directement le bouton **Vérifier ce téléphone** avec un lien de session signe (pas de QR a scanner sur lui-meme).
- Session courte a usage unique, associee au dossier et au navigateur/téléphone ayant repondu au defi.
- Le QR prouve une interaction avec le navigateur de ce téléphone, PAS son IMEI.
- Le navigateur peut fournir des signaux de modèle/OS incomplets et falsifiables; ne pas les considerer comme identifiants uniques.
- En cas USB Android, l'utilisateur doit activer le débogage USB et confirmer les permissions. C'est un mode avance, pas le chemin par defaut.

### Écran 2 - Identifier mon appareil

L'IMEI est saisi, scanné depuis un document ou renseigné par une source autorisée. Le site récupère marque, modèle et caractéristiques connues. Le client confirme uniquement les informations manquantes.

**Spécifications techniques :**
- IMEI a 15 chiffres (saisie manuelle, OCR depuis une photo, code-barres d'emballage en option).
- Vérifier longueur + chiffre Luhn; extraire TAC 8 premiers chiffres.
- Chercher fabricant/modèle dans la base TAC locale. Si introuvable ou ambigu, proposer selection manuelle et revue.
- Enrichir le modèle avec le catalogue technique : capacité nominale batterie, choix possibles de RAM et stockage.
- Demander uniquement la variante que l'IMEI/TAC ne permet pas de confirmer.
- Sur écran, chaque champ porte une preuve : "via TAC", "catalogue", "déclaré par le client", "via USB" ou "vérifié par operateur".
- NE JAMAIS afficher un IMEI "vérifié sur l'appareil" si le systeme n'a lu qu'un IMEI saisi/OCR.

### Écran 3 - Vérifier et photographier

Session interactive anti-fraude, photo recto, photo verso, avec guide de cadrage et contrôle de qualité automatique.

**Spécifications techniques :**
- Deux cases : photo recto, photo verso; bouton direct camera ou upload.
- Apercu instantane, détecter flou, obscurite, reflet, cadrage incomplet et reutilisation d'image.
- Fournir un contour du téléphone et un guidage vocal/textuel court.
- Si preuve forte demandee : capture directe avec defi aleatoire court, différent pour chaque session, ou passage en contrôle manuel.
- Difficulte physique : un smartphone ne peut pas photographier lui-meme son dos avec sa propre camera. Il faut un deuxieme appareil, une webcam, un depot de photo moins fiable ou une vérification en boutique.
- Conserver les originaux avec hash et stockage prive; versions compressees uniquement pour affichage.

### Écran 4 - Envoyer ma demande

Récapitulatif, consentement, transmission du dossier et numéro de suivi. La validation de l'assurance intervient après les contrôles nécessaires.

**Spécifications techniques :**
- Carte recap : téléphone, IMEI masque (****1234), variante RAM/stockage, 2 photos et niveau de vérification.
- Consentement et mentions de confidentialite, bouton Envoyer.
- Confirmation avec numéro de dossier et statut "A examiner" ou "Pieces supplementaires necessaires".
- Validation d'assurance uniquement apres les verifications réellement effectuees.

## 3. Bibliotheques GitHub pertinentes

| Projet | Lien | Usage dans SmartAssur | Licence affichee |
|---|---|---|---|
| Stepperize | https://github.com/damianricobelli/stepperize | Machine a etats/formulaire en 4 étapes | MIT |
| shadcn/ui | https://github.com/shadcn-ui/ui | Design system, cartes, inputs, drawer et boutons | MIT |
| Uppy | https://github.com/transloadit/uppy | Camera/webcam, apercu, upload, progression | MIT |
| react-webcam | https://github.com/mozmorris/react-webcam | Capture photo/video depuis navigateur | MIT |
| react-easy-crop | https://github.com/ValentinH/react-easy-crop | Recentrage visuel des photos | MIT |
| browser-image-compression | https://github.com/Donaldcwl/browser-image-compression | Compression des apercus sur mobile | MIT |
| Tesseract.js | https://github.com/naptha/tesseract.js | OCR de l'IMEI depuis emballage ou capture | Apache-2.0 |
| Tango / ya-webadb | https://github.com/yume-chan/ya-webadb | Connection USB Android et infos ADB autorisées | MIT |
| node-qrcode | https://github.com/soldair/node-qrcode | QR de session a courte durée | MIT |
| TensorFlow.js models COCO-SSD | https://github.com/tensorflow/tfjs-models | Verification qu'un objet de type téléphone est visible | Apache-2.0 |
| React Hook Form | https://github.com/react-hook-form/react-hook-form | Validation sans écran supplementaire | MIT |
| Zod | https://github.com/colinhacks/zod | Validation schema metier cote client et serveur | MIT |
| Bowser | https://github.com/bowser-js/bowser | Adapter l'interface selon le navigateur, pas identité | MIT |
| TAC database (communautaire) | https://github.com/MoazEb/tac-database | Lookup TAC -> marque / modèle | MIT declaree dans repo |
| PhoneSpecsAPI | https://github.com/AnarDevStudio/PhoneSpecsAPI | Reference de catalogue de caractéristiques | Apache-2.0 |

**Important :** ce sont des briques a assembler, pas une solution cle-en-main qui prouve l'IMEI en 4 clics. Vérifier les licences des sous-dependances et des données a l'integration.

## 4. Choix techniques

- Frontend : Next.js + TypeScript + Tailwind + shadcn/ui.
- Wizard : Stepperize et React Hook Form + Zod; 4 étapes automatiques, sauvegarde de brouillon.
- API : ASP.NET Core, modèle RBAC Client/Gestionnaire/Admin; PostgreSQL.
- Temps reel : SignalR du backend ASP.NET Core pour associer QR/téléphone/site PC, sans service externe payant.
- USB Android : Tango/WebADB uniquement depuis navigateur compatible en HTTPS, autorisation explicite et ADB active. Ne pas rendre obligatoires les options developpeur pour tout client.
- Photos : Uppy + capture native, origine privee chiffree, hashes et derivatifs. Ne jamais supprimer l'original pour faire uniquement de la compression.
- OCR : Tesseract cote navigateur si possible, ne pas transmettre automatiquement une photo contenant des données personnelles a une API externe.
- Detection objet / qualité : TensorFlow.js + heuristiques OpenCV/WebAssembly possibles, mais aucune "preuve de non-fraude" automatique garantie.
- Catalogue : lookup TAC local + base specs versionnee + correspondances incertaines signalees.

## 5. Niveaux de confiance et regles anti-fraude

| Signal disponible | Ce que ca demontre | Ce que ca ne demontre pas |
|---|---|---|
| IMEI valide Luhn | La forme du numéro est correcte | L'existence, la possession ou la légitimité |
| TAC correspond au modèle | Plausibilite marque/modèle | L'identité physique unique du téléphone |
| QR associe a une session mobile | Interaction avec un navigateur ayant ouvert la session | L'IMEI du téléphone ou sa provenance |
| WebADB lit un modèle Android | Un appareil connecte déclaré ce modèle | IMEI individuel garanti ou absence de fraude |
| Photos recto/verso | Preuve visuelle de l'etat déclaré | Que le téléphone photographie est le meme que l'IMEI |
| API operateur Device Identifier (si accessible) | Comparaison d'un IMEI signale au reseau, sous conditions | Un contrôle visuel de l'etat exterieur |

**Regles de decision proposees :**

- Niveau fort : IMEI confirme par source operateur autorisée, photos conformes, aucune incoherence => file de validation acceleree.
- Niveau moyen : USB + modèle coherent avec TAC + photos conformes, mais IMEI non confirme => contrôle additionnel ou gestionnaire.
- Niveau faible : QR seul ou données utilisateur seules => depot du dossier possible, jamais accord automatique sans preuve supplementaire.
- Cas incoherent : modèle/TAC différent, photo repetee, IMEI deja assure, tentative multiple => blocage provisoire et revue humaine.
- Tous les rejets doivent pouvoir etre contrôles et contestes; aucun score IA ne prend seul la decision finale.

## 6. Verification IMEI veritable (option selon partenaires)

- GSMA Device Identifier via Open Gateway/CAMARA : https://open-gateway.gsma.com/docs/device-identifier
- Requiert des integrations d'operateurs compatibles, droits d'acces, consentement et possiblement couts commerciaux.
- Ne pas supposer que ce service est disponible directement au Maroc ou accessible gratuitement.
- Si indisponible : afficher "IMEI déclaré et modèle coherent" et non "IMEI authentifie".
- Garder distinct le contrôle de vol/perte/blacklist, qui necessite un autre service legitime.

## 7. UX premium et conversion

- Une seule grande carte au centre; bandeau de progression 1/4, 2/4, 3/4, 4/4.
- Mobile first avec bouton principal fixe en bas, zones tactiles larges, gros textes clairs.
- Champs pré-remplis, erreurs immediates mais non intrusives, selection de variante uniquement si besoin.
- QR scanne : synchronisation instantanee de la progression sur le PC.
- Pas de barre laterale, de menus administratifs, de jargon (TAC/ADB reserve au panneau d'aide), ni de compte cree avant la soumission si non indispensable.
- Aucune demande de permissions excessive; camera activee seulement lorsqu'elle sert.
- Rien de faux : afficher "Non vérifié", "Vérifié partiellement" ou "Vérifié par source externe" selon les preuves.
- Accessibilite : contraste AA, clavier, lecteurs d'écran, assistance FR/AR si nécessaire.
- Si sur mobile et une seule camera disponible : proposer autre appareil pour les photos, ou upload avec statut "contrôle a completer".

## 8. API REST et structures de données (proposition)

### API

- POST /api/insurance-sessions : créer session a usage unique (expiration courte)
- POST /api/insurance-sessions/{id}/pair : prouver connaissance du jeton QR/deep link
- POST /api/devices/imei/resolve : contrôle Luhn, TAC, modèles correspondants
- POST /api/devices/specs/resolve : variantes catalogue et source
- POST /api/devices/usb-evidence : mesures Android autorisées, limitees au strict nécessaire
- POST /api/evidence/upload : photo originale, hash, association a session
- POST /api/evidence/evaluate : qualité photo / détection double emploi / coherence
- POST /api/insurance-applications : dossier en attente
- GET /api/insurance-applications/{id} : etat et pieces du dossier
- PATCH /api/admin/insurance-applications/{id}/review : decision motivee et auditee

### Tables

- insurance_sessions(id, nonce_hash, expires_at, status, client_id)
- mobile_devices(id, imei_encrypted, imei_hmac_index, tac, brand, model, ram_gb, storage_gb, battery_nominal_mah)
- device_fields_sources(device_id, field, source_type, source_ref, confidence)
- device_evidence(id, application_id, type, path_private, sha256, captured_at, source, quality_flags)
- device_checks(id, application_id, kind, outcome, evidence_ref, created_at)
- insurance_applications(id, client_id, device_id, status, risk_level, created_at)
- risk_events(id, application_id, code, status, reason, created_at)
- review_log(id, application_id, reviewer_id, action, reason, created_at)

## 9. Sécurité minimale obligatoire

- HTTPS et autorisations explicites de camera/USB.
- Jamais de commandes ADB arbitraires proposees au client. Aucune lecture de photos/fichiers personnels par ADB.
- Sessions QR jetables, courtes, liees au dossier, anti-replay et limites de tentative.
- Autorisation serveur sur chaque endpoint; rate limiting, anti-bot, antivirus sur uploads.
- IMEI chiffre et index HMAC pour les recherches anti-doublon, jamais en clair dans les logs ou analytics.
- Photos stockees privees, chiffrees, avec retention limitee; originaux et hashes avec traces de consentement.
- CNDP / loi marocaine 09-08 : information, base legale, droits des personnes, finalites, conservation et flux transfrontaliers a examiner.
- Tests multi-navigateurs : Android Chrome, Windows Chrome/Edge, iPhone Safari.

## 10. Scenarios de recette obligatoires

1. Client Android sur PC : QR -> formulaire -> IMEI -> photos -> dossier.
2. Client Android USB : WebADB identifie un modèle; si IMEI inaccessible, l'écran l'indique clairement.
3. Client iPhone sur iPhone : lien direct, pas de QR impossible a scanner.
4. L'IMEI est valide Luhn mais pas present dans la base : mode manuel et examen humain.
5. L'IMEI est deja assure : signalement interne, aucune divulgation de l'identité du premier client.
6. Deux photos sont floues ou reutilisees : nouvelles preuves demandees.
7. L'utilisateur n'a qu'un seul téléphone : voie alternative realiste, sans mensonge sur la preuve photo live.
8. QR expire, reload, onglet quitte, autorisation refusee : reprise de parcours et erreurs utiles.
9. Absence d'API operateur : pas de statut 'IMEI confirme' automatique.
10. Pas de données inventees, meme en cas d'echec des connecteurs.

## 11. Plan d'implementation recommande

**Phase A - MVP web** : Next.js/shadcn/Stepperize, sessions QR/deep links, IMEI/TAC/Luhn, Uppy/photos et dossiers de validation.

**Phase B - preuves et UX** : contrôles de qualité, OCR, sauvegarde brouillon, mise en relation instantanee, backoffice gestionnaire.

**Phase C - USB Android** : module WebADB explicite et optionnel, extraction en lecture seule de mesures autorisées; tests sur marques differentes.

**Phase D - fiabilisation assurance** : integration eventuelle GSMA/operateur, anti-doublon, workflow de revue, politique vie privee et contrôles de sécurité.

## 12. Prompt bref pour Codex / Claude Code

> Lis SMARTASSUR_MOBILE_V3_4_ETAPES_GITHUB_UX.md et construis SmartAssur Mobile de A a Z en Next.js, shadcn/ui, Stepperize, ASP.NET Core et PostgreSQL. Cree un parcours 100% web en 4 étapes : Détecter mon smartphone (QR/USB Android), Identifier mon appareil (IMEI/TAC + specs), Vérifier et photographier (photos recto/verso) et Envoyer ma demande (récapitulatif et soumission). Integre les GitHub verifies, une vraie preuve par session, les niveaux de confiance et un backoffice; aucune fausse vérification IMEI ni données fictives.

## 13. References techniques

- https://developer.android.com/about/versions/10/privacy/changes
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- https://open-gateway.gsma.com/docs/device-identifier
- https://tacdb.osmocom.org/
- https://github.com/yume-chan/ya-webadb
- https://github.com/damianricobelli/stepperize
- https://github.com/transloadit/uppy
- https://github.com/naptha/tesseract.js

**Note de portee :** aucun projet GitHub consulte n'offre seul une preuve universelle, gratuite, web-only et cryptographiquement fiable que l'IMEI saisi appartient au smartphone physique. Le produit doit combiner des preuves de qualité variable et une revue appropriee.
