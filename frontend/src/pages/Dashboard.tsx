import { useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import StatusBadge from "../components/ui/StatusBadge";

type DashboardStats = {
  students: number;
  groups: number;
  documents: number;
  unassigned: number;
  shared_documents: number;
  personal_documents: number;
};

type MeResponse = {
  id: number;
  login?: string;
  username?: string;
  role: string;
  group_ids?: number[];
};

type GroupItem = {
  id: number;
  name: string;
};

export default function Dashboard() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [stats, setStats] = useState<DashboardStats>({
    students: 0,
    groups: 0,
    documents: 0,
    unassigned: 0,
    shared_documents: 0,
    personal_documents: 0,
  });

  const [teacherGroups, setTeacherGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);

    try {
      const meRes = await api.get("/auth/me");
      const currentUser = meRes.data;
      setMe(currentUser);
      setMeLoaded(true);

      if (currentUser.role === "teacher") {
        await loadTeacherDashboard();
      } else {
        await loadAdminOrHeadDashboard();
      }
    } catch (error) {
      console.error("Dashboard error:", error);
      setMeLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadTeacherDashboard() {
    try {
      const groupsRes = await api.get("/groups");
      const groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
      setTeacherGroups(groups);
    } catch (error) {
      console.error("Teacher dashboard error:", error);
    }
  }

  async function loadAdminOrHeadDashboard() {
    try {
      const studentsRes = await api.get("/students");
      const groupsRes = await api.get("/groups");

      let documents: any[] = [];
      let unassigned: any[] = [];

      try {
        const docsRes = await api.get("/documents/admin/all");
        documents = Array.isArray(docsRes.data) ? docsRes.data : [];
      } catch (e) {
        console.log("Не удалось получить /documents/admin/all");
      }

      try {
        const unassignedRes = await api.get("/documents/unassigned");
        unassigned = Array.isArray(unassignedRes.data) ? unassignedRes.data : [];
      } catch (e) {
        console.log("Не удалось получить /documents/unassigned");
      }

      const students = Array.isArray(studentsRes.data) ? studentsRes.data : [];
      const groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];

      const sharedDocuments = documents.filter((doc: any) => doc.is_shared).length;

      const personalDocuments = documents.filter(
        (doc: any) => !doc.is_shared && doc.linked_students_count === 1
      ).length;

      setStats({
        students: students.length,
        groups: groups.length,
        documents: documents.length,
        unassigned: unassigned.length,
        shared_documents: sharedDocuments,
        personal_documents: personalDocuments,
      });
    } catch (error) {
      console.error("Admin/head dashboard error:", error);
    }
  }

  if (!meLoaded || loading) {
    return (
      <div className="stack">
        <PageHeader
          title="Dashboard"
          subtitle="Загрузка данных IntelliStudent..."
        />
        <div className="card section-card">Загрузка...</div>
      </div>
    );
  }

  const isTeacher = me?.role === "teacher";

  if (isTeacher) {
    return (
      <div className="stack">
        <PageHeader
          title="Dashboard"
          subtitle="Данные, доступные куратору по его группам."
          action={
            <button className="btn btn-secondary" onClick={loadDashboard}>
              Обновить
            </button>
          }
        />

        <div className="grid-3">
          <StatCard
            title="Мои группы"
            value={teacherGroups.length}
            subtitle="Группы, закреплённые за вами"
            icon={<span>🏫</span>}
          />
          <StatCard
            title="Роль"
            value="teacher"
            subtitle="Доступ ограничен только вашими данными"
            icon={<span>🧑‍🏫</span>}
          />
          <StatCard
            title="Статус доступа"
            value="Активен"
            subtitle="Панель куратора загружена"
            icon={<span>✅</span>}
          />
        </div>

        <div className="card section-card">
          <div className="page-header" style={{ marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Мои группы</h3>
              <p className="page-subtitle" style={{ marginTop: 6 }}>
                Здесь отображаются только группы, привязанные к текущему teacher.
              </p>
            </div>
          </div>

          {teacherGroups.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-state-icon">🏫</div>
              <h3>Группы не найдены</h3>
              <p>Пока ни одна группа не привязана к вашему аккаунту.</p>
            </div>
          ) : (
            <div className="grid-3">
              {teacherGroups.map((group) => (
                <div key={group.id} className="card section-card">
                  <div className="info-item" style={{ alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "18px", fontWeight: 700 }}>{group.name}</div>
                      <div className="page-subtitle" style={{ marginTop: 6 }}>
                        ID группы: {group.id}
                      </div>
                    </div>

                    <span className="badge badge-primary">Моя группа</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card section-card">
          <div className="page-header" style={{ marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Состояние доступа</h3>
              <p className="page-subtitle" style={{ marginTop: 6 }}>
                В dashboard teacher скрыты общесистемные данные.
              </p>
            </div>
          </div>

          <div className="info-list">
            <div className="info-item">
              <span className="info-item-label">Роль пользователя</span>
              <span className="info-item-value">{me?.role}</span>
            </div>

            <div className="info-item">
              <span className="info-item-label">Доступ к общесистемной статистике</span>
              <StatusBadge status="unassigned" text="Скрыто" />
            </div>

            <div className="info-item">
              <span className="info-item-label">Доступ к своим группам</span>
              <StatusBadge status="processed" text="Активно" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        subtitle="Общая статистика по студентам, группам и документам в системе."
        action={
          <button className="btn btn-secondary" onClick={loadDashboard}>
            Обновить
          </button>
        }
      />

      <div className="grid-3">
        <StatCard
          title="Студентов"
          value={stats.students}
          subtitle="Всего зарегистрированных студентов"
          icon={<span>👥</span>}
        />
        <StatCard
          title="Групп"
          value={stats.groups}
          subtitle="Учебные группы в системе"
          icon={<span>🏫</span>}
        />
        <StatCard
          title="Документов"
          value={stats.documents}
          subtitle="Все загруженные документы"
          icon={<span>📁</span>}
        />
      </div>

      <div className="grid-3">
        <StatCard
          title="Непривязанных"
          value={stats.unassigned}
          subtitle="Требуют ручной проверки или перепривязки"
          icon={<span>⚠️</span>}
        />
        <StatCard
          title="Общих документов"
          value={stats.shared_documents}
          subtitle="Документы, привязанные к нескольким студентам"
          icon={<span>🗂️</span>}
        />
        <StatCard
          title="Личных документов"
          value={stats.personal_documents}
          subtitle="Документы, привязанные к одному студенту"
          icon={<span>📄</span>}
        />
      </div>

      <div className="card section-card">
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0 }}>Состояние системы</h3>
            <p className="page-subtitle" style={{ marginTop: 6 }}>
              Краткий статус основных сущностей
            </p>
          </div>
        </div>

        <div className="info-list">
          <div className="info-item">
            <span className="info-item-label">Статус обработки документов</span>
            <StatusBadge status="processed" text="Активно" />
          </div>

          <div className="info-item">
            <span className="info-item-label">Непривязанные документы</span>
            <StatusBadge
              status={stats.unassigned > 0 ? "unassigned" : "processed"}
              text={stats.unassigned > 0 ? "Требуют внимания" : "Под контролем"}
            />
          </div>

          <div className="info-item">
            <span className="info-item-label">Общие документы</span>
            <span className="info-item-value">{stats.shared_documents}</span>
          </div>

          <div className="info-item">
            <span className="info-item-label">Личные документы</span>
            <span className="info-item-value">{stats.personal_documents}</span>
          </div>
        </div>
      </div>
    </div>
  );
}