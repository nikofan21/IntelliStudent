import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { clearToken, getRole, getToken, setRole } from "../lib/auth";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  roles?: string[];
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [role, setLocalRole] = useState<string | null>(getRole());

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const token = getToken();

    if (!token) {
      clearToken();
      navigate("/login", { replace: true });
      return;
    }

    try {
      const meRes = await api.get("/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const actualRole = meRes.data?.role || "teacher";
      setRole(actualRole);
      setLocalRole(actualRole);
    } catch (e) {
      clearToken();
      navigate("/login", { replace: true });
      return;
    } finally {
      setCheckingAuth(false);
    }
  }

  const navItems: NavItem[] = [
    { to: "/dashboard", label: "Dashboard", icon: <span>🏠</span> },
    { to: "/students", label: "Студенты", icon: <span>👥</span> },
    { to: "/search", label: "Поиск", icon: <span>🔎</span> },
    { to: "/upload", label: "Загрузка", icon: <span>⬆️</span> },
    {
      to: "/unassigned-documents",
      label: "Непривязанные",
      icon: <span>📄</span>,
      roles: ["admin", "teacher"],
    },
    {
      to: "/admin/documents",
      label: "Админ",
      icon: <span>🗂️</span>,
      adminOnly: true,
    },
  ];

  const filteredItems = navItems.filter((item) => {
    if (item.adminOnly && role !== "admin") return false;
    if (item.roles && (!role || !item.roles.includes(role))) return false;
    return true;
  });

  const handleLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  if (checkingAuth) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
        }}
      >
        Проверка авторизации...
      </div>
    );
  }

  if (!getToken()) {
    return null;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          {/* 🔥 LOGO */}
          <div className="brand">
            <div className="brand-logo">
              <img src="/logo.png" alt="IntelliStudent" />
            </div>

            <div>
              <h1>IntelliStudent</h1>
              <p>Digital Dean’s Office</p>
            </div>
          </div>

          <div className="sidebar-section-title">Навигация</div>

          <nav className="nav-list">
            {filteredItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item ${isActive(item.to) ? "active" : ""}`}
              >
                <span className="nav-item-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="user-box">
            <div className="user-avatar">
              {role === "admin" ? "🛡️" : role === "head" ? "🎓" : "👤"}
            </div>
            <div>
              <div className="user-role-title">
                {role === "admin"
                  ? "Администратор"
                  : role === "head"
                  ? "Заведующий"
                  : "Преподаватель"}
              </div>
              <div className="user-role-subtitle">Авторизованный доступ</div>
            </div>
          </div>

          <button type="button" className="logout-btn" onClick={handleLogout}>
            <span>🚪</span>
            <span>Выйти</span>
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}