import { NavLink, Outlet } from "react-router-dom";

const subNavCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? "subnavlink subnavlink--active" : "subnavlink";

export function AnalysisLayout() {
  return (
    <div className="analysis-layout">
      <h1>Análisis</h1>
      <p className="lede">
        Herramientas para comparar productos equivalentes según los precios scrapeados: en estabilidad
        de precios se agrupa por <strong>título de publicación</strong> (mismo texto en Mercado Libre),
        aunque provengan de distintas fichas de búsqueda.
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
