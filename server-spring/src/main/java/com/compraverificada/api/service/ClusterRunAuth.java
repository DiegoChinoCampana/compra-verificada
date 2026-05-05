package com.compraverificada.api.service;

import com.compraverificada.api.web.GlobalExceptionHandler.HttpStatusException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Equivalente a {@code server/src/clusterRunAuth.ts}: protege el POST de clustering.
 * Si {@code cv.cluster.batch-secret} está configurado, exige header / body match.
 */
@Component
public class ClusterRunAuth {

    private final String expected;

    public ClusterRunAuth(@Value("${cv.cluster.batch-secret:}") String expected) {
        this.expected = expected == null ? "" : expected.trim();
    }

    public boolean secretConfigured() {
        return !expected.isEmpty();
    }

    /** Para la respuesta meta (que el cliente sepa si tiene que mandar token). */
    public boolean requiresClientSecret() {
        return secretConfigured();
    }

    /** Lanza HttpStatusException(401) si el secreto no coincide. */
    public void assertAuthorized(String secretFromClient) {
        if (expected.isEmpty()) return;
        String got = secretFromClient == null ? "" : secretFromClient.trim();
        if (!expected.equals(got)) {
            throw new HttpStatusException(401, "Token de clustering incorrecto o ausente.");
        }
    }
}
