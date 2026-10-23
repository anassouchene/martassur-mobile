#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAC_CSV="$BASE_DIR/database/catalogs/tac/tac_full.csv"
SPECS_GLOB="$BASE_DIR/database/catalogs/phone-specs"/*_data.json
SPECS_TSV="$(mktemp /tmp/smartassur-specs-XXXXXX.tsv)"
trap 'rm -f "$SPECS_TSV"' EXIT

: "${PGPASSWORD:?Définissez PGPASSWORD avant de lancer cet import}"
DB_HOST="${SMARTASSUR_DB_HOST:-127.0.0.1}"
DB_PORT="${SMARTASSUR_DB_PORT:-5432}"
DB_NAME="${SMARTASSUR_DB_NAME:-smartassur_db}"
DB_USER="${SMARTASSUR_DB_USER:-smartassur}"

jq -r '.phones[] | [.brand,.model,(.hardware.ram // ""),((.hardware.storage // [])|join("/")),(.hardware.battery.capacity // "")] | @tsv' $SPECS_GLOB > "$SPECS_TSV"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE tac_import (brand text, tac text, specs text);
\copy tac_import(brand,tac,specs) FROM '$TAC_CSV' WITH (FORMAT csv, HEADER true, QUOTE '"');
DELETE FROM tac_import WHERE tac IS NULL OR tac !~ '^[0-9]{8}$';

INSERT INTO tac_catalog (tac, brand, model, market_name, ram_options, storage_options, battery_nominal_mah)
SELECT DISTINCT ON (tac) tac, initcap(trim(brand)), trim(specs), trim(split_part(specs, ',', 1)), '', '', NULL
FROM tac_import ORDER BY tac
ON CONFLICT (tac) DO UPDATE SET brand=EXCLUDED.brand, model=EXCLUDED.model, market_name=EXCLUDED.market_name;

CREATE TEMP TABLE specs_import (brand text, model text, ram text, storage text, battery text);
\copy specs_import FROM '$SPECS_TSV' WITH (FORMAT text, DELIMITER E'\t');
CREATE TEMP TABLE specs_norm AS
  SELECT *, regexp_replace(lower(brand), '[^a-z0-9]+','','g') bn,
         regexp_replace(lower(model), '[^a-z0-9]+','','g') mn FROM specs_import;
CREATE TEMP TABLE tac_norm AS
  SELECT tac, regexp_replace(lower(market_name), '[^a-z0-9]+','','g') tn,
         regexp_replace(lower(brand), '[^a-z0-9]+','','g') bn FROM tac_catalog;
CREATE INDEX ON tac_norm(bn,tn);

WITH matches AS (
  SELECT DISTINCT ON (t.tac) t.tac, s.ram, s.storage, s.battery
  FROM tac_norm t JOIN specs_norm s ON t.bn=s.bn AND (t.tn=s.mn OR t.tn=s.bn||s.mn)
  ORDER BY t.tac, length(s.mn) DESC
)
UPDATE tac_catalog c SET
  ram_options=replace(replace(replace(m.ram,'GB',' Go'),'MB',' MB'),'/',','),
  storage_options=replace(replace(replace(m.storage,'GB',' Go'),'TB',' To'),'/',','),
  battery_nominal_mah=NULLIF(regexp_replace(m.battery,'[^0-9]','','g'),'')::int
FROM matches m WHERE c.tac=m.tac;

-- Correspondance TAC + caractéristiques confirmées par la fiche officielle Xiaomi
-- (Redmi Note 12 Pro 4G = code modèle 2209116AG : 6/128, 8/128, 8/256, 5000 mAh).
UPDATE tac_catalog SET market_name='Redmi Note 12 Pro 4G', ram_options='6 Go,8 Go',
  storage_options='128 Go,256 Go', battery_nominal_mah=5000 WHERE model ILIKE '%2209116AG%';

ANALYZE tac_catalog;
SELECT count(*) AS total_tac,
       count(*) FILTER (WHERE battery_nominal_mah IS NOT NULL) AS enriched_tac
FROM tac_catalog;
SQL
