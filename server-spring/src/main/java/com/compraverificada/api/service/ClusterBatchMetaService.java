package com.compraverificada.api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Persistencia de la última corrida del job de clustering en {@code configs} (id 100, name 'cluster_batch_last').
 * Equivalente a {@code server/src/clusterBatchMeta.ts}.
 */
@Service
public class ClusterBatchMetaService {

    public static final int CLUSTER_BATCH_CONFIG_ID = 100;
    public static final String CLUSTER_BATCH_CONFIG_NAME = "cluster_batch_last";

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    @Autowired
    public ClusterBatchMetaService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /** Devuelve el JSON guardado como Map (o null si no hay). */
    public Map<String, Object> read() {
        try {
            String raw = jdbc.queryForObject(
                    "SELECT value FROM configs WHERE id = ?",
                    String.class, CLUSTER_BATCH_CONFIG_ID);
            if (raw == null || raw.trim().isEmpty()) return null;
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = mapper.readValue(raw, Map.class);
            return parsed;
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Reemplaza el blob para la fila id=100. */
    public void write(Map<String, Object> payload) {
        try {
            String json = mapper.writeValueAsString(payload);
            jdbc.update(
                    "INSERT INTO configs (id, name, value) VALUES (?, ?, CAST(? AS text)) "
                            + "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, value = EXCLUDED.value",
                    CLUSTER_BATCH_CONFIG_ID, CLUSTER_BATCH_CONFIG_NAME, json);
        } catch (Exception e) {
            throw new RuntimeException("No se pudo escribir cluster_batch_last", e);
        }
    }

    /** Helper para construir un payload estándar (mismas keys que el server Node). */
    public Map<String, Object> newPayload() {
        return new LinkedHashMap<>();
    }
}
