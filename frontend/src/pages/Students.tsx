import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Group, Student } from "../lib/api";
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

function buildNextGroupName(group: Group) {
  return `${group.prefix}${String(group.admission_year).slice(-2)}-${group.course + 1}${group.suffix}`;
}

export default function Students() {
  const [tab, setTab] = useState<"students" | "groups" | "promote">("students");

  const [me, setMe] = useState<Me | null>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [showArchivedGroups, setShowArchivedGroups] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);

  const [prefix, setPrefix] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [groupCourse, setGroupCourse] = useState(1);
  const [suffix, setSuffix] = useState("");

  const [fullName, setFullName] = useState("");
  const [groupId, setGroupId] = useState<number | "">("");
  const [email, setEmail] = useState("");

  const [groupFilter, setGroupFilter] = useState<number | "all">("all");

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    confirmText: "Подтвердить",
    danger: false,
    onConfirm: null,
  });

  const groupMap = useMemo(
    () => new Map(groups.filter((g) => g.is_active).map((g) => [g.id, g.display_name])),
    [groups]
  );

  const visibleGroups = useMemo(
    () => (showArchivedGroups ? groups : groups.filter((g) => g.is_active)),
    [groups, showArchivedGroups]
  );

  const activeGroups = useMemo(
    () => groups.filter((g) => g.is_active),
    [groups]
  );

  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.includes(g.id)),
    [groups, selectedGroupIds]
  );

  const hasGraduationGroupsSelected = useMemo(
    () => selectedGroups.some((g) => g.course >= 4),
    [selectedGroups]
  );

  const canManageGroups = me?.role === "admin" || me?.role === "head";
  const isAdmin = me?.role === "admin";
  const canCreateStudents =
    me?.role === "admin" || me?.role === "teacher" || me?.role === "head";

  const filteredStudents = useMemo(() => {
    return students.filter((s) =>
      groupFilter === "all" ? true : s.group_id === groupFilter
    );
  }, [students, groupFilter]);

  const studentsSubtitle =
    me?.role === "teacher"
      ? "Студенты только ваших назначенных групп"
      : "Все студенты с фильтрацией по группам";

  const headerSubtitle =
    me?.role === "teacher"
      ? `Текущий пользователь: ${me.login} (${me.role}). Доступ ограничен вашими группами и студентами.`
      : me
      ? `Текущий пользователь: ${me.login} (${me.role})`
      : "Просмотр студентов с фильтрацией по группам.";

  async function load() {
    setError(null);
    setLoading(true);

    try {
      const [meRes, gRes, stRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/groups", { params: { include_inactive: true } }),
        api.get("/students"),
      ]);

      setMe(meRes.data);
      setGroups(Array.isArray(gRes.data) ? gRes.data : []);
      setStudents(Array.isArray(stRes.data) ? stRes.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка загрузки");
    } finally {
      setLoading(false);
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

  async function createGroup(e: React.FormEvent) {
  e.preventDefault();
  setError(null);

  try {
    if (!prefix.trim()) {
      setError("Введите префикс группы");
      return;
    }

    await api.post("/groups", {
      prefix: prefix.trim(),
      admission_year: Number(year),
      course: Number(groupCourse),
      suffix: suffix.trim().toUpperCase() || "",
      is_active: true,
    });

    setPrefix("");
    setSuffix("");
    setGroupCourse(1);

    await load();
    setTab("groups");
  } catch (e: any) {
    setError(e?.response?.data?.detail || "Ошибка создания группы");
  }
}

  async function createStudent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      if (!fullName.trim()) {
        setError("Введите ФИО");
        return;
      }

      if (groupId === "") {
        setError("Выберите группу");
        return;
      }

      if (!email.trim()) {
        setError("Введите email");
        return;
      }

      await api.post("/students", {
        full_name: fullName.trim(),
        group_id: Number(groupId),
        email: email.trim(),
      });

      setFullName("");
      setGroupId("");
      setEmail("");

      await load();
      setTab("students");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка создания студента");
    }
  }

  function toggleGroupSelection(targetGroupId: number) {
    setSelectedGroupIds((prev) =>
      prev.includes(targetGroupId)
        ? prev.filter((id) => id !== targetGroupId)
        : [...prev, targetGroupId]
    );
  }

  function selectAllVisibleGroups() {
    setSelectedGroupIds(visibleGroups.filter((g) => g.is_active).map((g) => g.id));
  }

  function clearSelectedGroups() {
    setSelectedGroupIds([]);
  }

  function promoteSelectedGroups() {
    setError(null);

    if (selectedGroupIds.length === 0) {
      setError("Сначала выберите группы для повышения");
      return;
    }

    if (hasGraduationGroupsSelected) {
      setError("Среди выбранных есть выпускные группы, их нельзя повысить");
      return;
    }

    const preview = selectedGroups
      .map((g) => `${g.display_name} → ${buildNextGroupName(g)}`)
      .join("\n");

    openConfirmModal({
      title: "Повышение групп на курс",
      description: `Будут повышены группы:\n\n${preview}`,
      confirmText: "Повысить",
      onConfirm: async () => {
        setPromoting(true);
        try {
          await api.post("/groups/promote", {
            group_ids: selectedGroupIds,
          });

          setSelectedGroupIds([]);
          await load();
          setTab("promote");
        } finally {
          setPromoting(false);
        }
      },
    });
  }

  function archiveGroup(group: Group) {
    openConfirmModal({
      title: "Архивация группы",
      description: `Архивировать группу ${group.display_name}?`,
      confirmText: "Архивировать",
      onConfirm: async () => {
        await api.patch(`/groups/${group.id}/archive`);
        await load();
      },
    });
  }

  function restoreGroup(group: Group) {
    openConfirmModal({
      title: "Восстановление группы",
      description: `Восстановить группу ${group.display_name}?`,
      confirmText: "Восстановить",
      onConfirm: async () => {
        await api.patch(`/groups/${group.id}/restore`);
        await load();
      },
    });
  }

  function deleteGroup(group: Group) {
    openConfirmModal({
      title: "Удаление группы",
      description: `Удалить группу ${group.display_name}?\n\nУдаление доступно только для пустой группы без привязок.`,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/groups/${group.id}`);
        await load();
      },
    });
  }


  function deleteStudent(student: Student) {
    openConfirmModal({
      title: "Удаление студента",
      description: `Удалить студента ${student.full_name}?`,
      confirmText: "Удалить",
      danger: true,
      onConfirm: async () => {
        await api.delete(`/students/${student.id}`);
        await load();
      },
    });
  }

  return (
    <div className="stack">
      <PageHeader
        title="Список студентов"
        subtitle={headerSubtitle}
        action={
          <button className="btn btn-secondary" onClick={load}>
            Обновить
          </button>
        }
      />

      <div className="row" style={{ gap: 10 }}>
        <button
          className={tab === "students" ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => setTab("students")}
        >
          Студенты
        </button>

        {canManageGroups && (
          <>
            <button
              className={tab === "groups" ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => setTab("groups")}
            >
              Группы
            </button>

            <button
              className={tab === "promote" ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => setTab("promote")}
            >
              Повышение курса
            </button>
          </>
        )}
      </div>

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

      <div className="card section-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Роль доступа</h3>
            <p className="page-subtitle" style={{ marginTop: 6 }}>
              Права текущего пользователя в системе
            </p>
          </div>
          <StatusBadge status={me?.role || "teacher"} text={me?.role || "teacher"} />
        </div>
      </div>

      {tab === "groups" && canManageGroups && (
        <>
          <form onSubmit={createGroup} className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Управление группами</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Создание новых учебных групп по составной модели
                </p>
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                  Префикс
                </label>
                <input
                  className="input"
                  placeholder="Например: П / РЭД / ИСиП"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                  Год набора
                </label>
                <input
                  className="input"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                  Курс
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={groupCourse}
                  onChange={(e) => setGroupCourse(Number(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                  Суффикс
                </label>
                <input
                  className="input"
                  placeholder="Например: Д / А / Б"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <button className="btn btn-primary" type="submit">
                Создать группу
              </button>
            </div>
          </form>

          <div className="card section-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>Список групп</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  Архивируй старые группы, удаляй только пустые ошибочные
                </p>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showArchivedGroups}
                  onChange={(e) => setShowArchivedGroups(e.target.checked)}
                />
                <div className="checkbox-box" />
                Показать архивные
              </label>
            </div>

            {visibleGroups.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 12,
                }}
              >
                {visibleGroups.map((g) => (
                  <div
                    key={g.id}
                    className="card"
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      opacity: g.is_active ? 1 : 0.78,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{g.display_name}</div>
                        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                          {g.is_active ? "Активная группа" : "Архивная группа"}
                        </div>
                      </div>

                      <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {g.is_active ? (
                          isAdmin ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => archiveGroup(g)}
                            >
                              Архивировать
                            </button>
                          ) : null
                        ) : isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => restoreGroup(g)}
                          >
                            Восстановить
                          </button>
                        ) : null}

                        {isAdmin ? (
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

                    <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                      <StatusBadge status="docx" text={`Префикс: ${g.prefix}`} />
                      <StatusBadge status="docx" text={`Набор: ${g.admission_year}`} />
                      <StatusBadge status="docx" text={`Курс: ${g.course}`} />
                      <StatusBadge status="docx" text={`Суффикс: ${g.suffix}`} />
                      <StatusBadge
                        status={g.is_active ? "processed" : "unassigned"}
                        text={g.is_active ? "Активна" : "Архив"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ color: "var(--muted)" }}>Групп пока нет</span>
            )}
          </div>
        </>
      )}

      {tab === "promote" && canManageGroups && (
        <div className="card section-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "flex-start",
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>Повышение групп на курс</h3>
              <p className="page-subtitle" style={{ marginTop: 6 }}>
                Выбери активные группы и повысь их на следующий курс
              </p>
            </div>

            <div className="row">
              <button className="btn btn-secondary" onClick={selectAllVisibleGroups}>
                Выбрать все
              </button>

              <button className="btn btn-secondary" onClick={clearSelectedGroups}>
                Снять выбор
              </button>

              <button
                className="btn btn-primary"
                onClick={promoteSelectedGroups}
                disabled={
                  promoting ||
                  selectedGroupIds.length === 0 ||
                  groups.some((g) => selectedGroupIds.includes(g.id) && (g.course >= 4 || !g.is_active))
                }
              >
                {promoting ? "Повышаем..." : `Повысить (${selectedGroupIds.length})`}
              </button>
            </div>
          </div>

          {hasGraduationGroupsSelected ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 14,
                background: "rgba(127, 29, 29, 0.18)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#fecaca",
              }}
            >
              Среди выбранных есть выпускные группы. Их нельзя повысить выше 4 курса.
            </div>
          ) : null}

          {activeGroups.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {activeGroups.map((g) => {
                const checked = selectedGroupIds.includes(g.id);
                const isGraduation = g.course >= 4;

                return (
                  <label
                    key={g.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: 14,
                      borderRadius: 16,
                      border: checked
                        ? "1px solid rgba(59, 130, 246, 0.45)"
                        : "1px solid rgba(148, 163, 184, 0.12)",
                      background: checked
                        ? "rgba(59, 130, 246, 0.10)"
                        : "rgba(15, 23, 42, 0.35)",
                      cursor: "pointer",
                      opacity: isGraduation ? 0.82 : 1,
                    }}
                  >
                    <div style={{ paddingTop: 2 }}>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleGroupSelection(g.id)}
                        />
                        <div className="checkbox-box" />
                      </label>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontWeight: 700 }}>{g.display_name}</div>
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>
                          {isGraduation
                            ? "Выпускная группа"
                            : `После повышения: ${buildNextGroupName(g)}`}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <StatusBadge status="docx" text={`Префикс: ${g.prefix}`} />
                        <StatusBadge status="docx" text={`Набор: ${g.admission_year}`} />
                        <StatusBadge status="docx" text={`Курс: ${g.course}`} />
                        <StatusBadge status="docx" text={`Суффикс: ${g.suffix}`} />
                        {isGraduation ? (
                          <StatusBadge status="error" text="Выпускная" />
                        ) : null}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "var(--muted)" }}>Нет активных групп</div>
          )}
        </div>
      )}

      {tab === "students" && (
        <>
          {canCreateStudents && (
            <form onSubmit={createStudent} className="card section-card">
              <div className="page-header" style={{ marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0 }}>
                    {me?.role === "teacher" ? "Добавить студента в мою группу" : "Добавить студента"}
                  </h3>
                  <p className="page-subtitle" style={{ marginTop: 6 }}>
                    {me?.role === "teacher"
                      ? "Создание новой записи студента только в назначенных вам группах"
                      : "Создание новой записи студента"}
                  </p>
                </div>
              </div>

              <div className="grid-2">
                <div>
                  <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                    ФИО
                  </label>
                  <input
                    className="input"
                    placeholder="Введите ФИО"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                    Группа
                  </label>
                  <select
                    className="select"
                    value={groupId}
                    onChange={(e) =>
                      setGroupId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    required
                  >
                    <option value="">Выберите группу</option>
                    {activeGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                    Email
                  </label>
                  <input
                    className="input"
                    placeholder="student@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <button className="btn btn-primary" type="submit">
                  Создать студента
                </button>
              </div>
            </form>
          )}

          <div className="card section-card">
            <div className="page-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Список студентов</h3>
                <p className="page-subtitle" style={{ marginTop: 6 }}>
                  {studentsSubtitle}
                </p>
              </div>
            </div>

            <div style={{ marginBottom: 18, maxWidth: 420 }}>
              <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                Фильтр по группе
              </label>
              <select
                className="select"
                value={groupFilter}
                onChange={(e) =>
                  setGroupFilter(
                    e.target.value === "all" ? "all" : Number(e.target.value)
                  )
                }
              >
                <option value="all">Все группы</option>
                {activeGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <div style={{ color: "var(--muted)" }}>Загрузка студентов...</div>
            ) : filteredStudents.length === 0 ? (
              <EmptyState
                title="Студенты не найдены"
                description="В выбранной группе пока нет студентов."
                icon={<span>👥</span>}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>ФИО</th>
                      <th>Группа</th>
                      <th>Курс</th>
                      <th>Email</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => (
                      <tr key={s.id}>
                        <td>{s.id}</td>
                        <td style={{ fontWeight: 600 }}>{s.full_name}</td>
                        <td>
                          <StatusBadge
                            status="docx"
                            text={s.group_name || groupMap.get(s.group_id) || String(s.group_id)}
                          />
                        </td>
                        <td>{s.course ?? "—"}</td>
                        <td>{s.email}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => deleteStudent(s)}
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
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