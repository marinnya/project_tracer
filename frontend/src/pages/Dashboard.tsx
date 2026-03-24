import { useState, useEffect, useRef } from "react";
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

export default function Dashboard({ onLogout }: Props) {
  const navigate = useNavigate(); // хук из react-router-dom, который позволяет программно менять маршрут
  const [showArchive, setShowArchive] = useState(false); // хук для управления архивом
  const [filterOpen, setFilterOpen] = useState(false); // хук для управления фильтрами
  const [projects, setProjects] = useState<Project[]>([]);
  const role = localStorage.getItem("role"); // роль для кнопки "Вернуть из архива"

  // useRef - хук, который создаёт ссылку на DOM-элемент
  const filterRef = useRef<HTMLDivElement>(null);

  // пользовательский хук, который реагирует на клики вне указанного элемента
  useClickOutside(filterRef as React.RefObject<HTMLElement>, () => setFilterOpen(false));

  // загружаем проекты с бэкенда
  const fetchProjects = async () => {
    try {
      const res = await api.get("/projects");
      setProjects(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []); // пустой массив зависимостей — выполняется 1 раз при монтировании компонента

  // Изначально показываем только проекты "В работе"
  const filtered = projects.filter((p) =>
    showArchive ? p.status === "Завершен" : p.status === "В работе"
  );

  // возврат проекта из архива — только для админа
  const handleUnarchive = async (e: React.MouseEvent, projectId: number) => {
    e.stopPropagation(); // не открывать страницу проекта при клике на кнопку
    try {
      await api.patch(`/projects/${projectId}/unarchive`);
      await fetchProjects(); // обновляем список после возврата
    } catch (err) {
      console.error(err);
    }
  };

  // форматируем дату для отображения
  const formatDate = (date: string | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("ru-RU");
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
            <button className={!showArchive ? "active" : ""} onClick={() => setShowArchive(false)}>Активные</button>
            <button className={showArchive ? "active" : ""} onClick={() => setShowArchive(true)}>Архив</button>
          </div>

          {/* Мобильные фильтры, ссылка на элемент для закрытия при внешнем клике */}
          <div className="mobile-only" ref={filterRef}>
            <button className="filter-icon-btn" onClick={() => setFilterOpen((prev) => !prev)}>
              <img src="/filter.png" alt="Фильтр" />
            </button>

            {filterOpen && (
              <div className="filter-dropdown">
                <button className={!showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(false); setFilterOpen(false); }}>
                  Активные
                </button>
                <button className={showArchive ? "active" : ""}
                  onClick={() => { setShowArchive(true); setFilterOpen(false); }}>
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
                <th>Наименование</th>
                <th>Дата начала</th>
                <th>Дата окончания</th>
                <th>Ответственный</th>
                <th>Статус</th>
                {/* колонка действий — только в архиве для админа */}
                {showArchive && role === "ADMIN" && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr key={project.id} className={showArchive ? "" :"clickable"} onClick={() => !showArchive && navigate(`/projects/${project.id}`)}>
                  <td className="name">{project.name}</td>
                  <td>{formatDate(project.startDate)}</td>
                  <td>{formatDate(project.endDate)}</td>
                  <td>{project.responsible}</td>
                  <td>
                    <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
                      {project.status}
                    </span>
                  </td>
                  {/* кнопка "Вернуть" — только в архиве для админа */}
                  {showArchive && role === "ADMIN" && (
                    <td>
                      <span className="status edit" onClick={(e) => handleUnarchive(e, project.id)}>
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
          {filtered.map((project) => (
            <div
              key={project.id}
              className= {showArchive ? "" : "project-card clickable"}
              onClick={() => !showArchive && navigate(`/projects/${project.id}`)}>

              <div className="project-card-header">
                <div className="project-title">{project.name}</div>
              </div>

              <div className="project-info">
                <div className="project-dates">
                  {formatDate(project.startDate)} – {formatDate(project.endDate)}
                </div>
                <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
                  {project.status}
                </span>
              </div>

              <div className="project-responsible">
                <img src="/responsible.png" alt="Ответственный" />
                <span>{project.responsible}</span>
              </div>

              {/* кнопка "Вернуть из архива" на мобильном — только для админа */}
              {showArchive && role === "ADMIN" && (
                <span className="status edit" onClick={(e) => handleUnarchive(e, project.id)}>
                  Вернуть из архива
                </span>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}