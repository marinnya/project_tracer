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

type Props = {
  onLogout: () => void;
};

type SortField = "name" | "startDate" | "endDate";
type SortDirection = "asc" | "desc";

export default function Dashboard({ onLogout }: Props) {
  const navigate = useNavigate();
  const [showArchive, setShowArchive] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const role = localStorage.getItem("role");

  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useClickOutside(filterRef as React.RefObject<HTMLElement>, () => setFilterOpen(false));
  useClickOutside(sortRef as React.RefObject<HTMLElement>, () => setSortOpen(false));

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get("/projects");
      setProjects(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // мобильная сортировка: при повторном нажатии меняет направление
  const handleMobileSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setSortOpen(false);
  };

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

  const formatDateMobile = (date: string | null) => {
    if (!date) return "не указана";
    return new Date(date).toLocaleDateString("ru-RU");
  };

  const colSpan = showArchive && role === "ADMIN" ? 6 : 5;

  const sortLabels: Record<SortField, string> = {
    name: "Наименование",
    startDate: "Дата начала",
    endDate: "Дата окончания",
  };

  return (
    <div className="dashboard">
      <Header onLogout={onLogout} />

      <main className="content">
        <div className="content-header">
          <h1>{showArchive ? "Архив проектов" : "Проекты в работе"}</h1>

          {/* Десктопные фильтры */}
          <div className="filters desktop-only">
            <button className={!showArchive ? "active" : ""} onClick={() => setShowArchive(false)}>
              Активные
            </button>
            <button className={showArchive ? "active" : ""} onClick={() => setShowArchive(true)}>
              Архив
            </button>
          </div>

          {/* Мобильные: кнопка сортировки + кнопка фильтра */}
          <div className="mobile-controls mobile-only">

            {/* Сортировка */}
            <div className="mobile-only" ref={sortRef}>
              <button
                className="filter-icon-btn"
                onClick={() => { setSortOpen(prev => !prev); setFilterOpen(false); }}
              >
                <img src="/sort.png" alt="Сортировка" />
              </button>

              {sortOpen && (
                <div className="filter-dropdown sort-dropdown">
                  {(["name", "startDate", "endDate"] as SortField[]).map(field => (
                    <button
                      key={field}
                      className={sortField === field ? "active" : ""}
                      onClick={() => handleMobileSort(field)}
                    >
                      {sortLabels[field]}
                      {sortField === field && (
                        <span className="sort-dir">{sortDirection === "asc" ? " ↑" : " ↓"}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Фильтр */}
            <div className="mobile-only" ref={filterRef}>
              <button
                className="filter-icon-btn"
                onClick={() => { setFilterOpen(prev => !prev); setSortOpen(false); }}
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
        </div>

        <div className="projects-desktop">
          <table className="projects-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => handleSort("name")}>
                    Наименование
                    <img
                      src="/arrow_down.png"
                      alt=""
                      className={`arrow ${sortField === "name" && sortDirection === "desc" ? "open" : ""}`}
                      style={{ marginLeft: 4, opacity: sortField === "name" ? 1 : 0.35 }}
                    />
                  </button>
                </th>
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => handleSort("startDate")}>
                    Дата начала
                    <img
                      src="/arrow_down.png"
                      alt=""
                      className={`arrow ${sortField === "startDate" && sortDirection === "desc" ? "open" : ""}`}
                      style={{ marginLeft: 4, opacity: sortField === "startDate" ? 1 : 0.35 }}
                    />
                  </button>
                </th>
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => handleSort("endDate")}>
                    Дата окончания
                    <img
                      src="/arrow_down.png"
                      alt=""
                      className={`arrow ${sortField === "endDate" && sortDirection === "desc" ? "open" : ""}`}
                      style={{ marginLeft: 4, opacity: sortField === "endDate" ? 1 : 0.35 }}
                    />
                  </button>
                </th>
                <th>Ответственный</th>
                <th>Статус</th>
                {showArchive && role === "ADMIN" && <th>Действия</th>}
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={colSpan} className="empty-state-table">
                    <div className="spinner" style={{ margin: "16px auto" }} />
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="empty-state-table">
                    {showArchive ? "Нет проектов в архиве" : "Нет активных проектов"}
                  </td>
                </tr>
              ) : (
                sorted.map((project) => (
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
                        <span className="status edit" onClick={(e) => handleUnarchive(e, project.id)}>
                          Вернуть
                        </span>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Мобильная версия */}
        <div className="projects-mobile">
          {isLoading ? (
            <div className="empty-state">
              <div className="spinner" style={{ margin: "0 auto" }} />
            </div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">
              {showArchive ? "Нет проектов в архиве" : "Нет активных проектов"}
            </div>
          ) : (
            sorted.map((project) => (
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
                    {formatDateMobile(project.startDate)} – {formatDateMobile(project.endDate)}
                  </div>

                  <div className="status-actions">
                    <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
                      {project.status}
                    </span>

                    {showArchive && role === "ADMIN" && (
                      <span className="status edit" onClick={(e) => handleUnarchive(e, project.id)}>
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
            ))
          )}
        </div>
      </main>
    </div>
  );
}