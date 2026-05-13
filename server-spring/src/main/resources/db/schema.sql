-- Alineado con IPC: https://github.com/DiegoChinoCampana/IPC (src/db/schema.sql)
-- Mismo contenido que server/db/schema.sql del backend Node.
CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    article TEXT NOT NULL,
    brand TEXT,
    detail TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT now(),
    last_scraped_at TIMESTAMP NULL,
    ordered_by TEXT NOT NULL DEFAULT 'Más relevantes'
        CHECK (ordered_by IN ('Más relevantes', 'Menor precio', 'Mayor precio')),

    official_store_required BOOLEAN,
    free_shipping_required BOOLEAN
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id SERIAL PRIMARY KEY,
    executed_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY,
    scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id),
    search_id INTEGER NOT NULL REFERENCES articles(id),
    title TEXT,
    price NUMERIC,
    rating NUMERIC,
    url TEXT,
    seller TEXT,
    seller_score TEXT,
    created_at TIMESTAMP DEFAULT now(),
    scrape_run_criteria TEXT,

    official_store_required BOOLEAN,
    official_store_applied BOOLEAN,

    free_shipping_required BOOLEAN,
    free_shipping_applied BOOLEAN
);

-- Clustering semántico (batch): embeddings + claves de producto. Requiere extensión `vector`.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS result_embeddings (
    result_id BIGINT PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
    embedding vector(1536),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE results ADD COLUMN IF NOT EXISTS product_key TEXT;
ALTER TABLE results ADD COLUMN IF NOT EXISTS product_cluster_id INTEGER;
ALTER TABLE results ADD COLUMN IF NOT EXISTS product_confidence NUMERIC;

CREATE TABLE IF NOT EXISTS configs (
    id SERIAL PRIMARY KEY,
    name TEXT,
    value TEXT
);

INSERT INTO configs (id, name, value) VALUES
    (1, 'scraping_interval_mins', '4'),
    (2, 'cards_per_article', '2'),
    (3, 'articles_per_scrape', '3'),
    (4, 'seller_badge_weighting', '0.5'),
    (5, 'seller_sales_weighting', '0.3'),
    (6, 'seller_thermometer_weighting', '0.2')
ON CONFLICT (id) DO NOTHING;

-- Guía Hot Sale: array JSON editable sin redeploy (server/src/config/hotSaleVoted.ts).
INSERT INTO configs (id, name, value) VALUES
    (7, 'hot_sale_voted_slots', $hs$[{"pollLabel":"Historia 1 — ¿Qué producto analizamos?","instagramLabel":"Auriculares JBL tune 510BT","articleId":null,"match":{"article":"Auriculares","brand":"JBL","detail":"Tune 510BT"}},{"pollLabel":"Historia 1 — ¿Qué producto analizamos?","instagramLabel":"Adidas deportivas Duramo","articleId":null,"match":{"article":"Zapatillas","brand":"Adidas","detail":"Duramo"}},{"pollLabel":"Historia 1 — ¿Qué producto analizamos?","instagramLabel":"Colchón Calm 200x200","articleId":null,"match":{"brand":"Calm","detail":"200"}},{"pollLabel":"Historia 1 — ¿Qué producto analizamos?","instagramLabel":"Maybelline máscara Colossal Bubble","articleId":null,"match":{"article":"Maquillaje","brand":"Maybelline","detail":"Colossal"}},{"pollLabel":"Historia 2 — ¿Qué producto analizamos?","instagramLabel":"TV Samsung crystal UHD","articleId":null,"match":{"article":"Televisor","brand":"Samsung","detail":"Crystal"}},{"pollLabel":"Historia 2 — ¿Qué producto analizamos?","instagramLabel":"MacBook Air M1","articleId":null,"match":{"article":"Computadora","brand":"Apple","detail":"MacBook"}},{"pollLabel":"Historia 2 — ¿Qué producto analizamos?","instagramLabel":"AirPods 2","articleId":null,"match":{"article":"Auriculares","brand":"Apple","detail":"AirPods"}},{"pollLabel":"Historia 2 — ¿Qué producto analizamos?","instagramLabel":"JBL flip 6","articleId":null,"match":{"article":"Parlante","brand":"JBL","detail":"flip"}},{"pollLabel":"Historia 3 — ¿Qué producto analizamos?","instagramLabel":"Nike dunk low retro","articleId":null,"match":{"article":"Zapatillas","brand":"Nike","detail":"dunk"}},{"pollLabel":"Historia 3 — ¿Qué producto analizamos?","instagramLabel":"Airfryer Philips","articleId":null,"match":{"article":"Air Fryer","brand":"Philips"}},{"pollLabel":"Historia 3 — ¿Qué producto analizamos?","instagramLabel":"Smart TV 4k LG","articleId":null,"match":{"article":"Televisor","brand":"LG"}},{"pollLabel":"Historia 3 — ¿Qué producto analizamos?","instagramLabel":"Microondas Samsung","articleId":null,"match":{"article":"Microondas","brand":"Samsung"}}]$hs$)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('configs', 'id'), coalesce(max(id), 1)) FROM configs;
