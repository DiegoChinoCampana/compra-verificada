import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

/**
 * Páginas legales mínimas para cumplimiento Meta (App Dashboard).
 * URLs sugeridas al configurar la app:
 * - Política de privacidad → /privacidad
 * - Términos → /terminos
 * - Eliminación de datos → /eliminacion-datos
 */
const legalWrap: CSSProperties = {
  maxWidth: "42rem",
  margin: "0 auto",
};

export function PrivacyPolicyPage() {
  return (
    <article className="card block" style={legalWrap}>
      <h1>Política de privacidad</h1>
      <p className="muted small">
        CompraVerificada — última actualización:{" "}
        {new Date().toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" })}
      </p>
      <p>
        CompraVerificada analiza información de precios proveniente de fuentes públicas (por ejemplo,
        listados en Mercado Libre) para ofrecer tableros e informes. Esta aplicación web puede registrar
        de forma técnica datos habituales de operación (registros de servidor, dirección IP, tipo de
        navegador y páginas visitadas) con fines de seguridad y mejora del servicio.
      </p>
      <p>
        Si utilizás integraciones opcionales (por ejemplo, asistente por WhatsApp Business), el
        proveedor de la plataforma puede procesar el contenido de los mensajes según sus propias
        políticas; nosotros utilizamos esos datos solo para responder consultas relacionadas con el
        servicio.
      </p>
      <p>
        Para ejercer derechos de acceso, rectificación o supresión, o para consultas sobre esta
        política, escribinos a{" "}
        <a href="mailto:diegocampana@hotmail.com">diegocampana@hotmail.com</a>.
      </p>
      <p>
        <Link to="/articulos">Volver al inicio</Link>
      </p>
    </article>
  );
}

export function TermsOfServicePage() {
  return (
    <article className="card block" style={legalWrap}>
      <h1>Términos del servicio</h1>
      <p className="muted small">CompraVerificada — uso de la aplicación web y datos mostrados.</p>
      <p>
        El contenido y los análisis se ofrecen con fines informativos. Los precios y listados reflejan
        snapshots y automatizaciones sobre sitios públicos; pueden no coincidir en tiempo real con el
        sitio de origen. No constituyen asesoramiento financiero, oferta comercial ni garantía de
        disponibilidad o precio.
      </p>
      <p>
        El uso del sitio implica aceptar que el servicio se presta "tal cual", sin garantías
        expresas o implícitas, dentro de lo permitido por la ley aplicable.
      </p>
      <p>
        Contacto:{" "}
        <a href="mailto:diegocampana@hotmail.com">diegocampana@hotmail.com</a>
      </p>
      <p>
        <Link to="/articulos">Volver al inicio</Link>
      </p>
    </article>
  );
}

export function DataDeletionPage() {
  return (
    <article className="card block" style={legalWrap}>
      <h1>Eliminación de datos de usuario</h1>
      <p className="muted small">
        Instrucciones para solicitar la eliminación de datos asociados a CompraVerificada.
      </p>
      <p>
        Para solicitar la eliminación de datos personales que pudieran estar asociados al uso del
        servicio (por ejemplo, consultas mediante canales de contacto), enviá un correo a{" "}
        <a href="mailto:diegocampana@hotmail.com?subject=Solicitud%20de%20eliminación%20de%20datos">
          diegocampana@hotmail.com
        </a>{" "}
        con el asunto &quot;Solicitud de eliminación de datos&quot; e indicá el medio utilizado
        (correo, teléfono del cual escribiste por WhatsApp, etc.) y el alcance de tu pedido.
      </p>
      <p>
        Responderemos en un plazo razonable. Algunos registros pueden conservarse cuando la ley lo
        exija o para fines de seguridad y prevención de fraude.
      </p>
      <p>
        <Link to="/articulos">Volver al inicio</Link> · <Link to="/privacidad">Política de privacidad</Link>
      </p>
    </article>
  );
}
