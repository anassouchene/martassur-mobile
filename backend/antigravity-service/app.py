import asyncio
import json
import os
import re
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

UPLOAD_ROOT = Path(os.environ.get("SMARTASSUR_UPLOAD_ROOT", "/www/wwwroot/SMARTASSUR_MOBILE/backend/storage/uploads")).resolve()
PROJECT_ROOT = Path("/www/wwwroot/SMARTASSUR_MOBILE")
AGY_BIN = os.environ.get("ANTIGRAVITY_CLI", "/root/.local/bin/agy")
EVALUATION_LIMIT = asyncio.Semaphore(2)


async def health(_: Request) -> JSONResponse:
    # Antigravity supports the shared OAuth session created by the official
    # `agy` CLI as well as API-key/Vertex authentication. Authentication is
    # therefore verified by a real evaluation, not guessed from environment
    # variables that are intentionally absent in OAuth mode.
    return JSONResponse({"status": "ready", "provider": "google-antigravity"})


async def evaluate(request: Request) -> JSONResponse:
    payload = await request.json()
    image_path = Path(str(payload.get("path", ""))).resolve()
    try:
        image_path.relative_to(UPLOAD_ROOT)
    except ValueError:
        return JSONResponse({"status": "INVALID_PATH", "accepted": False}, status_code=400)
    if not image_path.is_file():
        return JSONResponse({"status": "MISSING_IMAGE", "accepted": False}, status_code=404)

    side = "verso/dos" if payload.get("side") == "PHOTO_BACK" else "recto/écran"
    expected = f"{payload.get('brand', '')} {payload.get('model', '')}".strip() or "modèle non communiqué"
    prompt = f"""Tu es un contrôleur visuel anti-fraude pour une assurance smartphone.
Analyse visuellement uniquement le fichier image {image_path}. Le côté attendu est {side}. L'appareil déclaré est {expected}.
Réponds avec un unique objet JSON sans markdown contenant exactement:
{{"contains_phone":bool,"correct_side":bool,"single_physical_phone":bool,"screen_or_back_visible":bool,"possible_screenshot":bool,"possible_reuse":bool,"observed_brand":str|null,"observed_model":str|null,"model_code_read":str|null,"brand_consistent":bool|null,"model_consistent":bool|null,"screen_on":bool|null,"screen_damage":[str],"back_damage":[str],"camera_lens_damage":bool|null,"overall_condition":"excellent"|"good"|"fair"|"poor"|null,"damage_notes":str|null,"confidence":int,"reason":"texte français court destiné au client"}}
model_code_read : numéro de modèle EXACT imprimé sur l'appareil (étiquette au dos, gravure, ex. M2101K6G, 2209116AG, SM-S911B, A2105), recopié caractère par caractère ; null s'il n'est pas lisible. Ne le déduis jamais de l'apparence.
Plusieurs modèles différents partagent le même boîtier (ex. Redmi Note 10 Pro et Redmi Note 12 Pro 4G) : seul ce numéro permet de les distinguer.
observed_brand/observed_model : ce que l'image montre réellement (logo, inscription, forme et disposition du bloc photo), null si non reconnaissable.
brand_consistent=false uniquement si un indice visible contredit la marque déclarée (logo ou inscription d'une autre marque) ; null si la marque n'est pas visible.
model_consistent=false uniquement si l'appareil est clairement un autre modèle (bloc photo de forme ou de nombre d'objectifs incompatible, nom de modèle lisible différent) ; null en cas de doute. Les variantes d'une même gamme se ressemblent : ne conclus pas à une différence sans indice net.
État de l'appareil (constat visuel pour l'assureur) :
- screen_on : recto uniquement, true si l'écran est allumé et affiche une image (null pour le verso).
- screen_damage : recto uniquement, parmi "cracks" (fissure / vitre brisée), "dead_pixels" (points noirs ou figés), "lines" (lignes verticales ou horizontales), "spots" (taches, zones décolorées, fuite d'encre), "burn_in" (image rémanente), "dim_or_flicker" ; [] si l'écran visible est intact.
- back_damage : verso uniquement, parmi "cracks", "scratches", "dents", "missing_parts" ; [] si intact.
- camera_lens_damage : verso, true si un objectif photo est fissuré ou manquant, null si non visible.
- overall_condition : état général visible ; damage_notes : description courte en français des défauts vus (null si aucun).
Signale uniquement les défauts réellement visibles ; un reflet ou une poussière n'est pas un défaut.
N'invente jamais une marque ou un modèle illisible. Un logo, dessin, capture d'écran ou document n'est pas un téléphone physique.
N'exécute aucune commande, ne modifie aucun fichier et n'analyse aucune autre donnée.
"""
    try:
        async with EVALUATION_LIMIT:
            process = await asyncio.create_subprocess_exec(
                AGY_BIN,
                "--output-format", "json",
                "--mode", "plan",
                "--effort", "low",
                "--disable-slash-commands",
                f"--print={prompt}",
                cwd=PROJECT_ROOT,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=150)
        if process.returncode != 0:
            raise RuntimeError((stderr or stdout).decode("utf-8", "replace")[-500:])
        envelope = json.loads(stdout.decode("utf-8"))
        if envelope.get("status") != "SUCCESS":
            raise RuntimeError(f"Antigravity status: {envelope.get('status', 'UNKNOWN')}")
        text = str(envelope.get("response", ""))
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("No JSON object returned")
        result = json.loads(match.group(0))
        # Premier motif bloquant, du plus fondamental au plus fin : le client corrige une chose à la fois.
        if not result.get("contains_phone"):
            code = "NOT_A_PHONE"
        elif result.get("possible_screenshot"):
            code = "SCREENSHOT"
        elif not result.get("single_physical_phone"):
            code = "MULTIPLE_PHONES"
        elif not result.get("correct_side"):
            code = "WRONG_SIDE"
        elif result.get("brand_consistent") is False:
            code = "BRAND_MISMATCH"
        elif result.get("model_consistent") is False:
            code = "MODEL_MISMATCH"
        elif payload.get("side") != "PHOTO_BACK" and result.get("screen_on") is False:
            # Écran éteint : impossible de constater l'état de l'afficheur.
            code = "SCREEN_OFF"
        else:
            code = None
        return JSONResponse({"status": "EVALUATED", "accepted": code is None, "rejection_code": code, "provider": "google-antigravity", "result": result})
    except TimeoutError:
        if 'process' in locals() and process.returncode is None:
            process.kill()
            await process.wait()
        return JSONResponse({"status": "TIMEOUT", "accepted": False, "reason": "Antigravity analysis timed out"}, status_code=504)
    except Exception as error:
        return JSONResponse({"status": "ERROR", "accepted": False, "reason": str(error)[:300]}, status_code=502)


async def run_antigravity(prompt: str) -> dict:
    """Appelle la CLI Antigravity en mode lecture seule et renvoie l'objet JSON de sa réponse."""
    async with EVALUATION_LIMIT:
        process = await asyncio.create_subprocess_exec(
            AGY_BIN,
            "--output-format", "json",
            "--mode", "plan",
            "--effort", "low",
            "--disable-slash-commands",
            f"--print={prompt}",
            cwd=PROJECT_ROOT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=150)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise
    if process.returncode != 0:
        raise RuntimeError((stderr or stdout).decode("utf-8", "replace")[-500:])
    envelope = json.loads(stdout.decode("utf-8"))
    if envelope.get("status") != "SUCCESS":
        raise RuntimeError(f"Antigravity status: {envelope.get('status', 'UNKNOWN')}")
    match = re.search(r"\{.*\}", str(envelope.get("response", "")), re.DOTALL)
    if not match:
        raise ValueError("No JSON object returned")
    return json.loads(match.group(0))


async def extract(request: Request) -> JSONResponse:
    """Lit l'identité d'un téléphone sur une photo : étiquette de boîte, écran *#06#, facture ou « À propos du téléphone »."""
    payload = await request.json()
    image_path = Path(str(payload.get("path", ""))).resolve()
    try:
        image_path.relative_to(UPLOAD_ROOT)
    except ValueError:
        return JSONResponse({"status": "INVALID_PATH"}, status_code=400)
    if not image_path.is_file():
        return JSONResponse({"status": "MISSING_IMAGE"}, status_code=404)

    prompt = f"""Tu extrais l'identité d'un smartphone pour une souscription d'assurance.
Analyse visuellement uniquement le fichier image {image_path} : étiquette de boîte, écran *#06#, facture, ou écran « À propos du téléphone ».
Réponds avec un unique objet JSON sans markdown contenant exactement:
{{"document_type":"box_label"|"imei_screen"|"invoice"|"settings_screen"|"other","imeis":[str],"brand":str|null,"model_name":str|null,"model_code":str|null,"storage_gb":int|null,"ram_gb":int|null,"color":str|null,"confidence":int,"reason":"texte français court"}}
imeis : chaque IMEI lisible, exactement 15 chiffres, dans l'ordre (IMEI1 puis IMEI2). Ignore SN, EID, MEID, codes-barres EAN et numéros de série.
storage_gb / ram_gb : seulement si écrits sur l'image (ex. « 8GB+256GB » donne ram_gb 8 et storage_gb 256). Ne déduis jamais une capacité du modèle.
Recopie uniquement ce qui est lisible ; mets null quand une information est absente ou illisible. N'invente rien.
N'exécute aucune commande, ne modifie aucun fichier et n'analyse aucune autre donnée.
"""
    try:
        result = await run_antigravity(prompt)
        return JSONResponse({"status": "EXTRACTED", "provider": "google-antigravity", "result": result})
    except TimeoutError:
        return JSONResponse({"status": "TIMEOUT"}, status_code=504)
    except Exception as error:
        return JSONResponse({"status": "ERROR", "reason": str(error)[:300]}, status_code=502)


app = Starlette(routes=[Route("/health", health), Route("/evaluate", evaluate, methods=["POST"]), Route("/extract", extract, methods=["POST"])])
