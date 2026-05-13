/**
 * Productos que votó la audiencia en Instagram (Historias Hot Sale).
 * Asigná `articleId` con el ID de la ficha en /articulos (o null si aún no hay monitoreo).
 *
 * Mantener alineado con `server-spring/.../HotSaleRoundupController.java` si usás Spring detrás del proxy.
 */
export type HotSaleVotedSlot = {
  pollLabel: string;
  instagramLabel: string;
  articleId: number | null;
};

export const HOT_SALE_VOTED_SLOTS: HotSaleVotedSlot[] = [
  {
    pollLabel: "Historia 1 — ¿Qué producto analizamos?",
    instagramLabel: "Auriculares JBL tune 510BT",
    articleId: null,
  },
  {
    pollLabel: "Historia 1 — ¿Qué producto analizamos?",
    instagramLabel: "Adidas deportivas Duramo",
    articleId: null,
  },
  {
    pollLabel: "Historia 1 — ¿Qué producto analizamos?",
    instagramLabel: "Colchón Calm 200x200",
    articleId: null,
  },
  {
    pollLabel: "Historia 1 — ¿Qué producto analizamos?",
    instagramLabel: "Maybelline máscara Colossal Bubble",
    articleId: null,
  },
  {
    pollLabel: "Historia 2 — ¿Qué producto analizamos?",
    instagramLabel: "TV Samsung crystal UHD",
    articleId: null,
  },
  {
    pollLabel: "Historia 2 — ¿Qué producto analizamos?",
    instagramLabel: "MacBook Air M1",
    articleId: null,
  },
  {
    pollLabel: "Historia 2 — ¿Qué producto analizamos?",
    instagramLabel: "AirPods 2",
    articleId: null,
  },
  {
    pollLabel: "Historia 2 — ¿Qué producto analizamos?",
    instagramLabel: "JBL flip 6",
    articleId: null,
  },
  {
    pollLabel: "Historia 3 — ¿Qué producto analizamos?",
    instagramLabel: "Nike dunk low retro",
    articleId: null,
  },
  {
    pollLabel: "Historia 3 — ¿Qué producto analizamos?",
    instagramLabel: "Airfryer Philips",
    articleId: null,
  },
  {
    pollLabel: "Historia 3 — ¿Qué producto analizamos?",
    instagramLabel: "Smart TV 4k LG",
    articleId: null,
  },
  {
    pollLabel: "Historia 3 — ¿Qué producto analizamos?",
    instagramLabel: "Microondas Samsung",
    articleId: null,
  },
];
