package com.compraverificada.api.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * Aplica `db/schema.sql` (mismo IPC que el server Node) en el arranque.
 * Idempotente. Se puede saltar con `cv.schema.apply-on-startup=false`.
 */
@Component
public class SchemaInitializer {

    private static final Logger log = LoggerFactory.getLogger(SchemaInitializer.class);

    private final JdbcTemplate jdbc;
    private final boolean enabled;

    public SchemaInitializer(JdbcTemplate jdbc,
                             @Value("${cv.schema.apply-on-startup:true}") boolean enabled) {
        this.jdbc = jdbc;
        this.enabled = enabled;
    }

    @PostConstruct
    public void apply() {
        if (!enabled) {
            log.info("[db] cv.schema.apply-on-startup=false: no se aplica db/schema.sql");
            return;
        }
        try {
            String full;
            try (var in = new ClassPathResource("db/schema.sql").getInputStream()) {
                full = StreamUtils.copyToString(in, StandardCharsets.UTF_8);
            }
            for (String stmt : splitSqlStatements(full)) {
                String trimmed = stmt.trim();
                if (trimmed.isEmpty()) continue;
                try {
                    jdbc.execute(trimmed);
                } catch (RuntimeException e) {
                    if (isOptionalVectorStatement(trimmed)) {
                        log.warn("[db] Esquema opcional (vector/embeddings) omitido o falló — el resto del IPC sigue activo: {}", e.getMessage());
                    } else {
                        throw e;
                    }
                }
            }
            log.info("[db] Esquema IPC aplicado (tablas + configs por defecto).");
        } catch (Exception e) {
            log.error("[db] Falló la aplicación del esquema en el arranque", e);
            throw new IllegalStateException("No se pudo aplicar db/schema.sql", e);
        }
    }

    /** Split rudimentario por ';' a fin de línea (no hay funciones con $$ en el schema actual). */
    static String[] splitSqlStatements(String sql) {
        // Saca comentarios `-- ...` para no confundir el split
        String stripped = Pattern.compile("--[^\n]*").matcher(sql).replaceAll("");
        return stripped.split(";\\s*\\r?\\n");
    }

    static boolean isOptionalVectorStatement(String sql) {
        String s = sql.trim();
        return s.matches("(?is)^CREATE\\s+EXTENSION\\b.*")
                || s.matches("(?is)^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?result_embeddings\\b.*");
    }
}
