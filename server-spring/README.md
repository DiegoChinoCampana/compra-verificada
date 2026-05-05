# compra-verificada-api (Spring Boot, deploy en Tomcat)

Capa de backend en **Spring Boot 3 / Java 17** empaquetada como **WAR** para
desplegar en un Tomcat externo. Su única razón de existir es:

- ser **el único** proceso que abre conexiones contra la base remota de
  CompraVerificada (Postgres);
- exponer la misma API HTTP que hoy expone `compra-verificada/server`
  (Node/Express), para que el front siga funcionando con un solo cambio de
  base URL;
- mantener la base remota cerrada al exterior (el firewall / `pg_hba.conf`
  acepta conexiones únicamente desde el host del Tomcat).

> Equivalente 1:1 (mismas rutas, mismo shape JSON) del backend Node bajo
> `compra-verificada/server`. La SQL es la misma — solo cambia el motor.

## Estructura

```
server-spring/
├── pom.xml
├── README.md
└── src/main/
    ├── java/com/compraverificada/api/
    │   ├── CompraVerificadaApplication.java   # @SpringBootApplication
    │   ├── ServletInitializer.java            # Tomcat externo
    │   ├── config/
    │   │   ├── CorsConfig.java                # CORS abierto (ajustar en prod)
    │   │   ├── SchemaInitializer.java         # aplica db/schema.sql al arrancar
    │   │   └── ServiceTokenFilter.java        # Bearer opcional Node↔Spring
    │   ├── service/
    │   │   ├── ClusterRunAuth.java            # secreto del POST de clustering
    │   │   ├── ClusterBatchMetaService.java   # configs.id=100
    │   │   ├── EmbeddingService.java          # OpenAI embeddings + pgvector
    │   │   ├── ProductClusteringJob.java      # DBSCAN + merges
    │   │   └── RecommendationService.java     # heurística informe
    │   ├── sql/
    │   │   ├── SqlSnippets.java               # CTEs y filtros reutilizables
    │   │   └── ProductScopeQuery.java         # productKey / productTitle / seller
    │   └── web/
    │       ├── HealthController.java          # GET /health
    │       ├── ArticlesController.java        # GET /articles[/{id}[/results]]
    │       ├── ResultsController.java         # GET /results
    │       ├── AnalysisController.java        # GET /analysis/*
    │       ├── AnalyticsController.java       # GET/POST /analytics/*
    │       ├── ReportController.java          # GET /report/article/{id}
    │       └── GlobalExceptionHandler.java
    └── resources/
        ├── application.yml
        ├── application-tomcat.yml.example
        └── db/schema.sql                      # mismo IPC que server/db/schema.sql
```

## Endpoints expuestos

`server.servlet.context-path` = `/api` (default), por lo que las rutas finales
quedan como `/api/articles`, `/api/results`, etc. — idéntico al server Node.

| Método | Ruta                                                                | Descripción |
|--------|---------------------------------------------------------------------|-------------|
| GET    | `/api/health`                                                       | Probe (no requiere auth) |
| GET    | `/api/articles`                                                     | Lista (filtros: `article`, `brand`, `detail`, `enabled`) |
| GET    | `/api/articles/{id}`                                                | Detalle |
| GET    | `/api/articles/{id}/results`                                        | Listados (paginado + scope) |
| GET    | `/api/results`                                                      | Resultados globales (paginado) |
| GET    | `/api/analysis/price-stability-by-name`                             | Estabilidad por nombre |
| GET    | `/api/analysis/peer-gap-by-name`                                    | Brecha vs peers |
| GET    | `/api/analysis/price-jumps-by-name`                                 | Saltos de precio |
| GET    | `/api/analytics/article/{id}/analytics-scope`                       | Resolver scope (canónico/manual/key) |
| GET    | `/api/analytics/article/{id}/price-series`                          | Serie de precios |
| GET    | `/api/analytics/article/{id}/best-per-run`                          | Mejor oferta por corrida |
| GET    | `/api/analytics/article/{id}/dispersion`                            | Dispersión + CV |
| GET    | `/api/analytics/article/{id}/sellers`                               | Top vendedores |
| GET    | `/api/analytics/article/{id}/criteria`                              | Cumplimiento de criterios |
| GET    | `/api/analytics/operational/stale-scrapes`                          | Operación |
| GET    | `/api/analytics/operational/missing-recent-results`                 | Operación |
| GET    | `/api/analytics/operational/product-clustering-meta`                | Última corrida del batch |
| POST   | `/api/analytics/operational/product-clustering-run`                 | Disparar batch (requiere secreto) |
| GET    | `/api/analytics/peers/by-article-detail`                            | Peers por artículo + detalle |
| GET    | `/api/report/article/{id}`                                          | Informe consolidado + recomendación |

## Build y deploy

### 1. Construir el WAR

Requiere JDK 17+ y Maven 3.9+.

```bash
cd compra-verificada/server-spring
mvn -DskipTests package
# genera target/compra-verificada-api.war
```

### 2. Configuración del Tomcat (servidor que va a hablar con la base)

En el host del Tomcat (no exponer la base directamente: solo este host
debería tener acceso por red a Postgres), crear `bin/setenv.sh` con las
variables:

```bash
# bin/setenv.sh
export CATALINA_OPTS="$CATALINA_OPTS \
  -Dspring.profiles.active=tomcat \
  -DDATABASE_JDBC_URL='jdbc:postgresql://compra-verificada-db.internal:5432/compra_verificada?sslmode=require' \
  -DDB_USER=cv_api \
  -DDB_PASSWORD='REEMPLAZAR' \
  -DCV_SERVICE_TOKEN='secret-largo-para-bearer' \
  -DCLUSTER_BATCH_SECRET='secret-para-el-POST-de-clustering' \
  -DOPENAI_API_KEY='sk-...' \
  -DOPENAI_PROJECT_ID='proj_...' \
  -DCV_APPLY_SCHEMA=false"
```

Alternativa: copiar `application-tomcat.yml.example` a
`application-tomcat.yml` y empaquetarlo (no recomendado: secretos en el WAR).

### 3. Deploy

Copiar `target/compra-verificada-api.war` a `$CATALINA_BASE/webapps/`. Tomcat
lo levanta automáticamente. Por defecto, las rutas quedan bajo el context
path del nombre del WAR + el `server.servlet.context-path` configurado.

Recomendación: mantener el context path limpio renombrando el WAR a
`api.war` o configurando un `Context` en `conf/Catalina/<host>/api.xml` con
`docBase="…/compra-verificada-api.war"` y `path="/api"`.

### 4. Hardening de la base remota

- En Postgres (`pg_hba.conf`): permitir conexiones únicamente desde la IP
  del Tomcat (`hostssl compra_verificada cv_api <IP_TOMCAT>/32 scram-sha-256`).
- Firewall del proveedor (security group): regla de ingreso para el puerto
  5432 solo desde la IP del Tomcat.
- Crear un usuario de DB dedicado (`cv_api`) con permisos mínimos sobre las
  tablas usadas. Rotar `DB_PASSWORD` periódicamente.
- Si querés que el front siga hablando contra Vercel pero quitando el
  acceso directo a la base, dejá el server Node como proxy y configurá su
  pool para que apunte a la nueva URL **del Tomcat** (no a Postgres). El
  front no necesita cambios.

### 5. Cliente: cómo cambiar la base URL del front

El front actual asume rutas relativas `/api/...`. Si pasás del Vercel/Node
al Tomcat:

- Si Tomcat está detrás del mismo dominio: rewrite del proxy → `/api/* →
  http://tomcat:8080/api/*`. El front no cambia.
- Si está en otro dominio: configurar `VITE_API_BASE_URL` (o equivalente)
  hacia `https://api.tudominio.com` y dejar que `client/src/api.ts` lo use.
- Si activás `cv.service.auth-token`, el front (o el proxy) tiene que
  enviar `Authorization: Bearer <token>` en todas las requests excepto
  `/api/health`. El POST de clustering además requiere
  `X-Cluster-Batch-Secret`.

## Desarrollo local (sin Tomcat externo)

Para iterar rápido se puede correr embebido (Spring Boot levanta su Tomcat
interno):

```bash
# desde server-spring/
mvn spring-boot:run \
  -Dspring-boot.run.jvmArguments="\
    -DDATABASE_JDBC_URL=jdbc:postgresql://localhost:5432/compra_verificada \
    -DDB_USER=$USER -DDB_PASSWORD= \
    -DOPENAI_API_KEY=$OPENAI_API_KEY"

# health
curl -s http://localhost:8080/api/health
```

> Nota: el WAR final que va a Tomcat se construye igual; el embedded server
> de Spring Boot es solo para `spring-boot:run` y se ignora cuando el WAR
> se despliega externamente (porque el starter de Tomcat va `excluded` en
> el `pom.xml`).

## Diferencias intencionales con el server Node

- **Concurrencia del informe**: el server Node ejecuta las consultas con
  `Promise.all`. En Spring se ejecutan secuencialmente con el mismo pool;
  HikariCP serializa por conexión y la latencia total tiende a ser similar
  porque la base ya estaba cuello de botella en Vercel/serverless.
- **Auth Bearer**: nuevo, opcional. Cuando se activa con `CV_SERVICE_TOKEN`,
  Spring rechaza requests sin `Authorization`, excepto `/health`.
- **Recargo de schema**: el `SchemaInitializer` aplica `db/schema.sql` en
  cada arranque (idempotente). En producción se sugiere `CV_APPLY_SCHEMA=false`
  y aplicar el schema una sola vez con `psql`.
