import { NavLink, Outlet } from "react-router-dom";

const navCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? "navlink navlink--active" : "navlink";

const footerLinkCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? "site-footer__link site-footer__link--active" : "site-footer__link";

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
          <NavLink to="/guia-hot-sale" className={navCls}>
            Hot Sale
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
      <footer className="site-footer">
        <div className="site-footer__inner">
          <nav className="site-footer__links" aria-label="Información legal">
            <NavLink to="/privacidad" className={footerLinkCls}>
              Política de privacidad
            </NavLink>
            <span className="site-footer__sep" aria-hidden>
              ·
            </span>
            <NavLink to="/terminos" className={footerLinkCls}>
              Términos del servicio
            </NavLink>
            <span className="site-footer__sep" aria-hidden>
              ·
            </span>
            <NavLink to="/eliminacion-datos" className={footerLinkCls}>
              Eliminación de datos
            </NavLink>
          </nav>
        </div>
      </footer>
    </div>
  );
}
