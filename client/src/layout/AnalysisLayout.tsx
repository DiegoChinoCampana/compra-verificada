import { NavLink, Outlet } from "react-router-dom";

const subNavCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? "subnavlink subnavlink--active" : "subnavlink";

export function AnalysisLayout() {
  return (
    <div className="analysis-layout">
      <h1>Análisis</h1>
      <p className="lede">
        Herramientas para comparar productos equivalentes según los precios scrapeados. En{" "}
        <strong>estabilidad</strong> y <strong>saltos</strong> el agrupamiento es el mismo que en el tablero:{" "}
        <strong>clave semántica</strong> (<code>product_key</code> del clustering, p. ej. prefijo{" "}
        <code>cluster:</code>) cuando existe; si no, <strong>título de publicación</strong> normalizado en
        Mercado Libre, aunque las publicaciones vengan de distintas fichas. En <strong>brecha vs peers</strong>{" "}
        el grupo entre marcas se arma solo con <strong>artículo y detalle</strong> de cada ficha, y el
        precio de referencia por marca usa esa misma clave de producto dentro de la última corrida (no el
        mínimo global de toda la corrida).
      </p>

      <nav className="subnav" aria-label="Secciones de análisis">
        <NavLink to="/analisis/estabilidad-precios" end className={subNavCls}>
          Estabilidad de precios
        </NavLink>
        <NavLink to="/analisis/brecha-peers" className={subNavCls}>
          Brecha vs peers
        </NavLink>
        <NavLink to="/analisis/saltos-precio" className={subNavCls}>
          Saltos de precio
        </NavLink>
      </nav>

      <div className="analysis-outlet">
        <Outlet />
      </div>
    </div>
  );
}
