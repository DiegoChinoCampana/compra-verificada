import { insertArticleTriple } from "../articles/articleMutations.js";
import { pool } from "../db.js";
import {
  SHOW_COUNT,
  distinctArticleTypes,
  distinctBrandsForArticle,
  distinctDetailsForArticleBrand,
  resolveArticleIdByTriple,
} from "./articleDistinct.js";
import { fetchPriceSeriesLastDays, formatPriceSeriesForWhatsapp } from "./priceLastDays.js";
import type { WaSession } from "./sessionStore.js";
import {
  getSession,
  newMenuSession,
  setSession,
} from "./sessionStore.js";

const CONSULT_DAYS = 60;

function publicAppBase(): string {
  return (process.env.WHATSAPP_PUBLIC_APP_BASE ?? "https://testing.itsaloop.com").replace(/\/$/, "");
}

function normalizeChoice(text: string, options: string[]): string | null {
  const t = text.trim();
  if (!t) return null;
  const n = /^(\d+)$/.exec(t);
  if (n) {
    const idx = Number(n[1]) - 1;
    if (idx >= 0 && idx < options.length) return options[idx];
  }
  return t;
}

function formatNumberedList(title: string, options: string[]): { text: string; shown: string[] } {
  const shown = options.slice(0, SHOW_COUNT);
  let body = title + "\n\n";
  if (shown.length === 0) {
    body += "_(No hay valores en la base; escribí uno.)_\n\n";
  } else {
    shown.forEach((o, i) => {
      body += `${i + 1}. ${o}\n`;
    });
    if (options.length > shown.length) {
      body += `\n…y ${options.length - shown.length} más (podés escribir el texto exacto).\n`;
    }
  }
  body += "\nRespondé con el *número* o escribí un valor *nuevo*. Escribí *menu* para volver.";
  return { text: body, shown };
}

async function replyMenu(): Promise<string> {
  return (
    `¡Hola! Soy el asistente de *CompraVerificada*.\n\n` +
    `Elegí una opción (respondé con el número):\n\n` +
    `*1* — *Seguir* un producto: lo damos de alta y lo buscamos en Mercado Libre.\n\n` +
    `*2* — *Consultar* precios: variación aproximada de los últimos *${CONSULT_DAYS} días* con nuestros datos.\n\n` +
    `_Escribí *menu* cuando quieras volver acá._`
  );
}

async function handleFollow(from: string, sess: WaSession, text: string): Promise<string[]> {
  if (sess.step === "choose_article") {
    const pick = normalizeChoice(text, sess.lastOptions) ?? text.trim();
    sess.draft.article = pick;
    sess.step = "choose_brand";
    sess.lastOptions = await distinctBrandsForArticle(pool, sess.draft.article);
    const { text: msg, shown } = formatNumberedList(`Marca para *${sess.draft.article}*:`, sess.lastOptions);
    sess.lastOptions = shown.length ? shown : [];
    setSession(from, sess);
    return [msg];
  }
  if (sess.step === "choose_brand") {
    const pick = normalizeChoice(text, sess.lastOptions) ?? text.trim();
    sess.draft.brand = pick;
    sess.step = "choose_detail";
    sess.lastOptions = await distinctDetailsForArticleBrand(pool, sess.draft.article, sess.draft.brand);
    const { text: msg, shown } = formatNumberedList(
      `Modelo / *detalle*:`,
      sess.lastOptions,
    );
    sess.lastOptions = shown.length ? shown : [];
    setSession(from, sess);
    return [msg];
  }
  if (sess.step === "choose_detail") {
    const pick = normalizeChoice(text, sess.lastOptions) ?? text.trim();
    sess.draft.detail = pick;
    const triple = sess.draft;
    try {
      const { id, existed } = await insertArticleTriple(pool, triple);
      const base = publicAppBase();
      const msg =
        existed
          ? `Ese producto *ya estaba* en seguimiento (ID ${id}).\nVer resumen: ${base}/resumen/${id}`
          : `Listo. *Dimos de alta* el producto (ID ${id}). Aparecerá en las próximas búsquedas en ML.\nResumen público: ${base}/resumen/${id}`;
      setSession(from, newMenuSession());
      return [msg];
    } catch (e) {
      console.error("[whatsapp] insert article", e);
      return ["Hubo un error al guardar. Probá de nuevo más tarde o escribí *menu*."];
    }
  }
  setSession(from, newMenuSession());
  return [await replyMenu()];
}

async function handleConsult(from: string, sess: WaSession, text: string): Promise<string[]> {
  if (sess.step === "choose_article") {
    const pick = normalizeChoice(text, sess.lastOptions) ?? text.trim();
    sess.draft.article = pick;
    sess.step = "choose_brand";
    sess.lastOptions = await distinctBrandsForArticle(pool, sess.draft.article);
    const { text: msg, shown } = formatNumberedList(`Marca para *${sess.draft.article}*:`, sess.lastOptions);
    sess.lastOptions = shown.length ? shown : [];
    setSession(from, sess);
    return [msg];
  }
  if (sess.step === "choose_brand") {
    const pick = normalizeChoice(text, sess.lastOptions) ?? text.trim();
    sess.draft.brand = pick;
    sess.step = "choose_detail";
    sess.lastOptions = await distinctDetailsForArticleBrand(pool, sess.draft.article, sess.draft.brand);
    const { text: msg, shown } = formatNumberedList(`Modelo / *detalle*:`, sess.lastOptions);
    sess.lastOptions = shown.length ? shown : [];
    setSession(from, sess);
    return [msg];
  }
  if (sess.step === "choose_detail") {
    const pick = normalizeChoice(text, sess.lastOptions) ?? text.trim();
    sess.draft.detail = pick;
    sess.step = "consult_price_note";
    setSession(from, sess);
    return [
      `Si querés, contanos *qué precio viste* y *dónde* (opcional). No lo guardamos por ahora; nos ayuda en el mensaje siguiente.\n\nEscribí el dato o *-* para omitir.`,
    ];
  }
  if (sess.step === "consult_price_note") {
    const note = /^[-_\.]+$/.test(text.trim()) || text.trim().toLowerCase() === "no"
      ? ""
      : text.trim();
    const id = await resolveArticleIdByTriple(pool, sess.draft);
    if (id == null) {
      setSession(from, newMenuSession());
      return [
        `No tenemos en base un artículo que coincida exactamente con:\n` +
          `*${sess.draft.article}* · ${sess.draft.brand} · ${sess.draft.detail}\n\n` +
          `Podés darlo de alta con la opción *1* del menú. Escribí *menu*.`,
      ];
    }
    const series = await fetchPriceSeriesLastDays(pool, id, CONSULT_DAYS);
    const body = formatPriceSeriesForWhatsapp(series, CONSULT_DAYS, sess.draft, note || undefined);
    const base = publicAppBase();
    const footer = `\n\nMás detalle: ${base}/resumen/${id}`;
    setSession(from, newMenuSession());
    return [body + footer];
  }

  setSession(from, newMenuSession());
  return [await replyMenu()];
}

export async function handleInboundText(from: string, textRaw: string): Promise<string[]> {
  const text = textRaw.trim();
  const lower = text.toLowerCase();

  if (!text || lower === "menu" || lower === "reiniciar" || lower === "inicio") {
    setSession(from, newMenuSession());
    return [await replyMenu()];
  }

  let sess = getSession(from) ?? newMenuSession();

  if (sess.flow === "menu" && sess.step === "menu") {
    if (lower === "1" || lower.startsWith("1 ") || lower.includes("seguir")) {
      const next: WaSession = {
        ...sess,
        flow: "follow",
        step: "choose_article",
        draft: { article: "", brand: "", detail: "" },
      };
      next.lastOptions = await distinctArticleTypes(pool);
      const { text: msg, shown } = formatNumberedList(
        `¿Qué *tipo* de artículo es?`,
        next.lastOptions.length ? next.lastOptions : [],
      );
      next.lastOptions = shown;
      setSession(from, next);
      return [msg];
    }
    if (lower === "2" || lower.startsWith("2 ") || lower.includes("consultar")) {
      const next: WaSession = {
        ...sess,
        flow: "consult",
        step: "choose_article",
        draft: { article: "", brand: "", detail: "" },
      };
      next.lastOptions = await distinctArticleTypes(pool);
      const { text: msg, shown } = formatNumberedList(`Consulta: ¿qué *tipo* de artículo?`, next.lastOptions);
      next.lastOptions = shown;
      setSession(from, next);
      return [msg];
    }
    return [
      "No reconocí la opción. Escribí *1* para dar de alta un producto o *2* para consultar precios.",
    ];
  }

  if (sess.flow === "follow") {
    return handleFollow(from, sess, text);
  }
  if (sess.flow === "consult") {
    return handleConsult(from, sess, text);
  }

  setSession(from, newMenuSession());
  return [await replyMenu()];
}
