import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { setRole, setToken } from "../lib/auth";

export default function Login() {
  const nav = useNavigate();

  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const form = new URLSearchParams();
      form.set("username", login);
      form.set("password", password);

      const res = await api.post("/auth/login", form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const token = res.data.access_token;
      setToken(token);

      const meRes = await api.get("/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setRole(meRes.data.role || "teacher");

      nav("/students");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div className="card section-card" style={{ width: 420 }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>IntelliStudent</h1>
          <p className="page-subtitle">Вход в систему</p>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 12,
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#fecaca",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="form-grid">
          <div>
            <label className="label">Логин</label>
            <input
              className="input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Пароль</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>

        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          Тест: admin / 1234
        </div>
      </div>
    </div>
  );
}