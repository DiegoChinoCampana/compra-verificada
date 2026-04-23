import { NavLink, Outlet } from "react-router-dom";

const navCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? "navlink navlink--active" : "navlink";

export function Layout() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img
            className="brand__logo"
            src="/brand-logo.png"
            alt="Compra Verificada"
            width={40}
            height={40}
            decoding="async"
          />
          <div>
            <strong>CompraVerificada</strong>
            <div className="brand__sub">Panel sobre base IPC</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/articulos" end className={navCls}>
            Artículos
          </NavLink>
          <NavLink to="/resultados" end className={navCls}>
            Resultados
          </NavLink>
          <NavLink to="/analisis" className={navCls}>
            Análisis
          </NavLink>
          <NavLink to="/operacion" className={navCls}>
            Operación
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
