package com.compraverificada.api.whatsapp;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Estado por usuario de WhatsApp (memoria). Para varias instancias → Redis / DB. */
public final class WhatsappSessionStore {

    private static final long TTL_MS = 24L * 60 * 60 * 1000;
    private static final ConcurrentHashMap<String, WaSession> store = new ConcurrentHashMap<>();

    private WhatsappSessionStore() {}

    public enum Flow {
        MENU, FOLLOW, CONSULT
    }

    public record Draft(String article, String brand, String detail) {
        public Draft {
            article = article == null ? "" : article;
            brand = brand == null ? "" : brand;
            detail = detail == null ? "" : detail;
        }
    }

    public static class WaSession {
        long updatedAt;
        Flow flow;
        String step;
        Draft draft;
        List<String> lastOptions = new ArrayList<>();

        public WaSession(Flow flow, String step, Draft draft, List<String> lastOptions) {
            this.updatedAt = System.currentTimeMillis();
            this.flow = flow;
            this.step = step;
            this.draft = draft;
            if (lastOptions != null) {
                this.lastOptions = new ArrayList<>(lastOptions);
            }
        }
    }

    public static WaSession get(String waId) {
        WaSession s = store.get(waId);
        if (s == null) {
            return null;
        }
        if (System.currentTimeMillis() - s.updatedAt > TTL_MS) {
            store.remove(waId);
            return null;
        }
        return s;
    }

    public static void put(String waId, WaSession s) {
        pruneIfHuge();
        s.updatedAt = System.currentTimeMillis();
        store.put(waId, s);
    }

    public static void remove(String waId) {
        store.remove(waId);
    }

    public static WaSession newMenu() {
        return new WaSession(Flow.MENU, "menu", new Draft("", "", ""), List.of());
    }

    private static void pruneIfHuge() {
        if (store.size() < 2000) {
            return;
        }
        long now = System.currentTimeMillis();
        for (Map.Entry<String, WaSession> e : store.entrySet()) {
            if (now - e.getValue().updatedAt > TTL_MS) {
                store.remove(e.getKey());
            }
        }
    }
}
