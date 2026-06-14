import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Group } from "../lib/api";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import ConfirmModal from "../components/ui/ConfirmModal";

type Me = { id: number; login: string; role: string };

type ConfirmModalState = {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: (() => Promise<void> | void) | null;
};

export default function ArchiveGroups() {
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    confirmText: "Подтвердить",
    danger: false,
    onConfirm: null,
  });

  const archivedGroups = useMemo(
    () => groups.filter((g) => !g.is_active),
    [groups]
  );

  const departments = useMemo(() => {
    const map = new Map<number, string>();

    archivedGroups.forEach((g) => {
      if (g.department_id && g.department_name) {
        map.set(g.department_id, g.department_name);
      }
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [archivedGroups]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();

    return archivedGroups.filter((g) => {
      const name = (g.display_name || g.name || "").toLowerCase();
      const dep = (g.department_name || "").toLowerCase();

      const searchOk =
        !q ||
        name.includes(q) ||
        dep.includes(q) ||
        String(g.admission_year).includes(q) ||
        String(g.course).includes(q);

      const departmentOk =
        departmentFilter === "all" ||
        String(g.department_id || "") === departmentFilter;

      return searchOk && departmentOk;
    });
  }, [archivedGroups, search, departmentFilter]);

  const canViewArchive =
    me?.role === "admin" || me?.role === "manager" || me?.role === "head";

  const canRestore = me?.role === "admin" || me?.role === "manager";
  const canDelete = me?.role === "admin";

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [meRes, groupsRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/groups/", { params: { include_inactive: true } }),
      ]);

      setMe(meRes.data);
      setGroups(Array.isArray(groupsRes.data) ? groupsRes.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка загрузки архива групп");
    } finally {
      setLoading(false);
      setMeLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openConfirmModal(params: {
    title: string;
    description: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  }) {
    setConfirmModal({
      open: true,
      title: params.title,
      description: params.description,
      confirmText: params.confirmText || "Подтвердить",
      danger: params.danger || false,
      onConfirm: params.onConfirm,
    });
  }

  function closeConfirmModal() {
    if (confirmLoading) return;

    setConfirmModal({
      open: false,
      title: "",
      description: "",
      confirmText: "Подтвердить",
      danger: false,
      onConfirm: null,
    });
  }

  async function handleModalConfirm() {
    if (!confirmModal.onConfirm) return;

    try {
      setConfirmLoading(true);
      await confirmModal.onConfirm();
      closeConfirmModal();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка выполнения действия");
    } finally {
      setConfirmLoading(false);
    }
  }

  function restoreGroup(group: Group) {
    if (!canRestore) return;

    openConfirmModal({
      title: "Восстановление группы",
      description: `Восстановить группу ${group.display_name || group.name}?`,
      confirmText: "Восстановить",
      onConfirm: async () => {
        await api.patch(`/groups/${group.id}/restore`);
        setMessage(`Группа ${group.display_name || group.name} восстановлена`);
        await load();
      },
    });
  }

  function deleteGroup(group: Group) {
    if (!canDelete) return;

    openConfirmModal({
      title: "Удаление группы",
      description: `Удалить группу ${group.display_name || group.name}?\n\nУдаление доступно только для пустой группы без привязок.`,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/groups/${group.id}`);
        setMessage(`Группа ${group.display_name || group.name} удалена`);
        await load();
      },
    });
  }

  if (!meLoaded) {
    return <div className="page-subtitle">Проверка доступа...</div>;
  }

  if (!canViewArchive) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="stack">
      <PageHeader
        title="Архив групп"
        subtitle="Просмотр архивных учебных групп, поиск и восстановление при необходимости"
        action={
          <button className="btn btn-secondary" onClick={load}>
            Обновить
          </button>
        }
      />

      {error ? (
        <div
          className="card section-card"
          style={{
            borderColor: "rgba(239, 68, 68, 0.25)",
            background: "rgba(127, 29, 29, 0.18)",
            color: "#fecaca",
          }}
        >
          {error}
        </div>
      ) : null}

      {message ? (
        <div
          className="card section-card"
          style={{
            background: "rgba(22, 163, 74, 0.16)",
            borderColor: "rgba(22, 163, 74, 0.28)",
            color: "#bbf7d0",
          }}
        >
          {message}
        </div>
      ) : null}

      <div className="card section-card">
        <div className="grid-3">
          <div>
            <label className="label">Поиск по архиву</label>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Название группы, отделение, год или курс"
            />
          </div>

          <div>
            <label className="label">Отделение</label>
            <select
              className="select"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="all">Все отделения</option>
              {departments.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Найдено</label>
            <div className="input" style={{ display: "flex", alignItems: "center" }}>
              {filteredGroups.length} из {archivedGroups.length}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-subtitle">Загрузка архива...</div>
      ) : filteredGroups.length === 0 ? (
        <EmptyState
          title="Архивные группы не найдены"
          description="По текущим фильтрам нет архивных групп."
          icon={<span>🗄️</span>}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 12,
          }}
        >
          {filteredGroups.map((g) => (
            <div key={g.id} className="card section-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>
                    {g.display_name || g.name}
                  </div>

                  <div className="page-subtitle" style={{ marginTop: 6 }}>
                    {g.department_name || "Без отделения"}
                  </div>
                </div>

                <StatusBadge status="unassigned" text="Архив" />
              </div>

              <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
                <StatusBadge status="docx" text={`Префикс: ${g.prefix}`} />
                <StatusBadge status="docx" text={`Набор: ${g.admission_year}`} />
                <StatusBadge status="docx" text={`Курс: ${g.course}`} />
                <StatusBadge status="docx" text={`Суффикс: ${g.suffix || "—"}`} />
              </div>

              <div className="row" style={{ marginTop: 18 }}>
                {canRestore ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => restoreGroup(g)}
                  >
                    Восстановить
                  </button>
                ) : null}

                {canDelete ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => deleteGroup(g)}
                  >
                    Удалить
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        confirmText={confirmModal.confirmText}
        danger={confirmModal.danger}
        loading={confirmLoading}
        onConfirm={handleModalConfirm}
        onClose={closeConfirmModal}
      />
    </div>
  );
}
