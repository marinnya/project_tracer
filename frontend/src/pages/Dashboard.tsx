import { useState, useEffect, useRef, useCallback } from "react";
import "../styles/dashboard.css";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useClickOutside } from "../hooks/useClickOutside";
import api from "../utils/api";

type Project = {
  id: number;
  name: string;
  status: string;
  responsible: string;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
};

// пропс onLogout передаётся из App.tsx и пробрасывается в Header
type Props = {
  onLogout: () => void;
};

// поля по которым можно сортировать
type SortField = "name" | "startDate" | "endDate";
type SortDirection = "asc" | "desc";

export default function Dashboard({ onLogout }: Props) {
  const navigate = useNavigate();
  const [showArchive, setShowArchive] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const role = localStorage.getItem("role");

  // состояние сортировки — изначально по наименованию по возрастанию
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const filterRef = useRef<HTMLDivElement>(null);
  useClickOutside(filterRef as React.RefObject<HTMLElement>, () => setFilterOpen(false));

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get("/projects");
      setProjects(res.data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // при клике на заголовок колонки — меняем поле или переключаем направление
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // то же поле — переключаем направление
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      // новое поле — сортируем по возрастанию сразу
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // сортировка проектов
  const sortProjects = (list: Project[]) => {
    return [...list].sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";

      if (sortField === "name") {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortField === "startDate") {
        valA = a.startDate ? new Date(a.startDate).getTime() : 0;
        valB = b.startDate ? new Date(b.startDate).getTime() : 0;
      } else if (sortField === "endDate") {
        valA = a.endDate ? new Date(a.endDate).getTime() : 0;
        valB = b.endDate ? new Date(b.endDate).getTime() : 0;
      }

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  };

  const filtered = projects.filter((p) =>
    showArchive ? p.status === "Завершен" : p.status === "В работе"
  );

  // применяем сортировку к отфильтрованному списку
  const sorted = sortProjects(filtered);

  const handleUnarchive = async (e: React.MouseEvent, projectId: number) => {
    e.stopPropagation();
    try {
      await api.patch(`/projects/${projectId}/unarchive`);
      await fetchProjects();
    } catch (err) {
      console.error(err);
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("ru-RU");
  };

  // стрелка вниз = по возрастанию (asc), стрелка вверх = по убыванию (desc)
  const SortArrow = ({ field }: { field: SortField }) => {
    const isActive = sortField === field;

    return (
      <img
        src="/arrow_down.png"
        alt=""
        className={`arrow ${sortDirection === "desc" && isActive ? "open" : ""}`}
        style={{ marginLeft: 4 }}
      />
    );
  };
    
  return (
    <div className="dashboard">
      {/* пробрасываем onLogout в Header */}
      <Header onLogout={onLogout} />

      <main className="content">
        <div className="content-header">
          <h1>{showArchive ? "Архив проектов" : "Проекты в работе"}</h1>

          {/* Десктопные фильтры */}
          <div className="filters desktop-only">
            <button
              className={!showArchive ? "active" : ""}
              onClick={() => setShowArchive(false)}
            >
              Активные
            </button>
            <button
              className={showArchive ? "active" : ""}
              onClick={() => setShowArchive(true)}
            >
              Архив
            </button>
          </div>

          {/* Мобильные фильтры, ссылка на элемент для закрытия при внешнем клике */}
          <div className="mobile-only" ref={filterRef}>
            <button
              className="filter-icon-btn"
              onClick={() => setFilterOpen((prev) => !prev)}
            >
              <img src="/filter.png" alt="Фильтр" />
            </button>

            {filterOpen && (
              <div className="filter-dropdown">
                <button
                  className={!showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(false); setFilterOpen(false); }}
                >
                  Активные
                </button>
                <button
                  className={showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(true); setFilterOpen(false); }}
                >
                  Архив
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="projects-desktop">
          <table className="projects-table">
            <thead>
              <tr>
                {/* заголовки с кликабельной сортировкой */}
                <th>
                  <button
                    type="button"
                    className="th-sort-btn"
                    onClick={() => handleSort("name")}
                  >
                    Наименование <SortArrow field="name" />
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    className="th-sort-btn"
                    onClick={() => handleSort("startDate")}
                  >
                    Дата начала <SortArrow field="startDate" />
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    className="th-sort-btn"
                    onClick={() => handleSort("endDate")}
                  >
                    Дата окончания <SortArrow field="endDate" />
                  </button>
                </th>
                <th>Ответственный</th>
                <th>Статус</th>
                {showArchive && role === "ADMIN" && <th>Действия</th>}
              </tr>
            </thead>

            <tbody>
              {sorted.map((project) => (
                <tr
                  key={project.id}
                  className={showArchive ? "" : "clickable"}
                  onClick={() => !showArchive && navigate(`/projects/${project.id}`)}
                >
                  <td className="name">{project.name}</td>
                  <td>{formatDate(project.startDate)}</td>
                  <td>{formatDate(project.endDate)}</td>
                  <td>{project.responsible}</td>
                  <td>
                    <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
                      {project.status}
                    </span>
                  </td>
                  {showArchive && role === "ADMIN" && (
                    <td>
                      <span
                        className="status edit"
                        onClick={(e) => handleUnarchive(e, project.id)}
                      >
                        Вернуть
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Мобильная версия */}
        <div className="projects-mobile">
          {sorted.map((project) => (
            <div
              key={project.id}
              className={showArchive ? "project-card" : "project-card clickable"}
              onClick={() => !showArchive && navigate(`/projects/${project.id}`)}
            >
              <div className="project-card-header">
                <div className="project-title">{project.name}</div>
              </div>

              <div className="project-info">
                <div className="project-dates">
                  {formatDate(project.startDate)} – {formatDate(project.endDate)}
                </div>

                <div className="status-actions">
                  <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
                    {project.status}
                  </span>

                  {showArchive && role === "ADMIN" && (
                    <span
                      className="status edit"
                      onClick={(e) => handleUnarchive(e, project.id)}
                    >
                      Вернуть
                    </span>
                  )}
                </div>
              </div>

              <div className="project-responsible">
                <img src="/responsible.png" alt="Ответственный" />
                <span>{project.responsible}</span>
              </div>

              
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}