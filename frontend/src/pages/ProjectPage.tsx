import { useEffect, useState } from "react";
import "../styles/project.css";
import ProjectSection from "../components/ProjectSection";
import ProjectDefectSection from "../components/ProjectDefectSection";
import Header from "../components/Header";
import { useNavigate } from "react-router-dom";
import SuccessModal from "../components/SuccessModal";
import { useParams } from "react-router-dom";
import { renameSection, renameDefect } from "../utils/fileRename";
import api from "../utils/api";

// Типы
type Project = {
  id: number;
  name: string;
  status: string;
  responsible: string;
  startDate: string;
  endDate: string;
};

type SectionState = {
  files: File[];
  pages: number;
};

type Defect = {
  id: number;
  typeId: number | "";
  typeName: string;
  pages: number | "";
  files: File[];
};

// пропс onLogout передаётся из App.tsx и пробрасывается в Header
type Props = {
  onLogout: () => void;
};

// Список секций — порядок важен, используется и для рендера и для переименования файлов
const SECTIONS = [
  "Титульный лист",
  "Технические данные объекта контроля",
  "План-схема склада",
  "Лист для фиксации повреждений",
  "Лист для фиксации отклонений в вертикальной плоскости",
  "Лист для фиксации момента затяжки болтовых и анкерных соединений",
  "Лист для эскизов",
  "Дополнительная информация",
] as const;

// вспомогательная функция для форматирования даты под input
const formatDateForInput = (date: string | null) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0]; // берём только "2025-12-12"
};


function ProjectPage({ onLogout }: Props) {

  const [completed, setCompleted] = useState(false); // хук: проект окончен?
  const [showModal, setShowModal] = useState(false); // хук для успешного модального окна при записи проекта
  const [error, setError] = useState<string | null>(null); // хук для ошибки валидации
  const [isUploading, setIsUploading] = useState(false); // хук: идёт ли загрузка на Яндекс.Диск
  const [isSaving, setIsSaving] = useState(false); // хук: идёт ли сохранение черновика
  const [uploadProgress, setUploadProgress] = useState(0); // хук: прогресс загрузки 0-100
  const navigate = useNavigate(); // хук из react-router-dom, который позволяет программно менять маршрут

  const { id } = useParams(); // хук из react-router-dom, который берет параметры маршрута из URL
  const [project, setProject] = useState<Project | null>(null); // состояние для текущего проекта
  const [startDate, setStartDate] = useState(""); // состояние для даты начала
  const [endDate, setEndDate] = useState(""); // состояние для даты окончания

  // состояние всех обычных секций — объект, где ключ = название секции
  const [sections, setSections] = useState<Record<string, SectionState>>(
    Object.fromEntries(SECTIONS.map(s => [s, { files: [], pages: 0 }]))
  );

  // состояние дефектов — массив объектов, начинаем с одного пустого
  const [defects, setDefects] = useState<Defect[]>([
    { id: Date.now(), typeId: "", typeName: "", pages: "", files: [] }
  ]);

  // загружаем проект с бэкенда по id из URL
  useEffect(() => {
    api.get(`/projects/${id}`)
      .then(res => {
        setProject(res.data);
        // инициализируем даты после загрузки проекта
        setStartDate(formatDateForInput(res.data.startDate));
        setEndDate(formatDateForInput(res.data.endDate));
      })
      .catch(() => setProject(null));
  }, [id]);

  // только после всех хуков можно делать условный return
  if (!project) return <div>Проект не найден</div>;

  // отправляет обновлённые даты на бэкенд
  const handleDatesUpdate = async (newStartDate: string, newEndDate: string) => {
    try {
      await api.patch(`/projects/${id}/dates`, {
        startDate: newStartDate || null,
        endDate: newEndDate || null,
      });
    } catch {
      console.error("Ошибка обновления дат");
    }
  };

  // обновление конкретной секции — принимает название и частичный объект с изменениями
  const updateSection = (title: string, patch: Partial<SectionState>) => {
    setSections(prev => ({
      ...prev,
      [title]: { ...prev[title], ...patch }
    }));
  };

  // собирает метаданные всех фото — используется и в handleSave и в handleFinalSubmit
  const buildPhotosMeta = () => {
    const photosMeta: { section: string; defectType?: string; filename: string; order: number }[] = [];

    // переименовываем файлы обычных секций и собираем метаданные
    for (const title of SECTIONS) {
      const renamed = renameSection(sections[title].files, title);
      renamed.forEach((file, i) => {
        photosMeta.push({ section: title, filename: file.name, order: i + 1 });
      });
    }

    // переименовываем файлы дефектов и собираем метаданные
    for (const d of defects) {
      if (!d.typeName || !d.files.length) continue;
      const renamed = renameDefect(d.files, d.typeName);
      renamed.forEach((file, i) => {
        photosMeta.push({ section: "дефекты", defectType: d.typeName, filename: file.name, order: i + 1 });
      });
    }

    return photosMeta;
  };

  // кнопка "Сохранить" — сохраняет файлы во временную папку на сервере + метаданные в БД
  // также вызывается автоматически перед "Записать"
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const formData = new FormData();

      // метаданные секций (количество страниц)
      const sectionsState = Object.fromEntries(
        SECTIONS.map(title => [title, { pages: sections[title].pages }])
      );
      formData.append("sections", JSON.stringify(sectionsState));

      // переименовываем и добавляем файлы обычных секций
      for (const title of SECTIONS) {
        const renamed = renameSection(sections[title].files, title);
        renamed.forEach(file => formData.append("files", file));
      }

      // переименовываем и добавляем файлы дефектов
      for (const d of defects) {
        if (!d.typeName || !d.files.length) continue;
        const renamed = renameDefect(d.files, d.typeName);
        renamed.forEach(file => formData.append("files", file));
      }

      // метаданные фото передаём как JSON-строку (FormData не умеет вложенные объекты)
      formData.append("photos", JSON.stringify(buildPhotosMeta()));

      await api.patch(`/projects/${id}/save`, formData);
    } catch {
      throw new Error("Ошибка сохранения — проверьте консоль бэкенда");
    } finally {
      setIsSaving(false);
    }
  };

  // кнопка "Записать" — валидация, автосохранение, отправка на Яндекс.Диск
  const handleFinalSubmit = async () => {
    setError(null);

    // проверяем обычные секции: число выбранных файлов должно совпадать с указанным количеством страниц
    for (const title of SECTIONS) {
      const s = sections[title];
      if (s.files.length !== s.pages) {
        setError(`Раздел "${title}": выбрано ${s.files.length} файлов, а указано ${s.pages}`);
        return;
      }
    }

    // проверяем дефекты: у каждого заполненного дефекта файлы должны совпадать со страницами
    for (const d of defects) {
      if (!d.typeId || !d.pages) continue; // пустой дефект пропускаем
      if (d.files.length !== Number(d.pages)) {
        setError(`Дефект №${defects.indexOf(d) + 1}: выбрано ${d.files.length} файлов, а указано ${d.pages}`);
        return;
      }
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // сначала всегда сохраняем файлы на сервер — так работает и при прямой записи и после черновика
      await handleSave();

      // затем отправляем на Яндекс.Диск — файлы бэкенд читает из временной папки
      await api.post(
        `/projects/${id}/upload`,
        {
          projectName: project.name,
          photos: JSON.stringify(buildPhotosMeta()),
        },
        {
          /*onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 1)
            );
            setUploadProgress(percent);
          },*/
          
          // трекер загрузки фото
          onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 1)
            );
            // показываем максимум 70% пока файлы идут на сервер
            // остальные 30% — это загрузка на Яндекс.Диск
            setUploadProgress(Math.min(percent, 70));
          },
        }
      );

      setShowModal(true);
    } catch (e) {
      setError("Ошибка загрузки — проверьте консоль бэкенда");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="dashboard">
      {/* пробрасываем onLogout в Header */}
      <Header onLogout={onLogout} />
      {/* Контент */}
      <div className="project-page-bg">
        <div className="project-container">

          <div className="project-header">
            <button className="back-button" onClick={() => navigate("/")}><img src="/arrow_back.png" alt="Назад" /></button>
            <h1>{project.name}</h1>

            {/* Статус для десктопа */}
            <span className={`status ${project.status === "В работе" ? "in-progress" : "done"} desktop-only`}>
              {project.status}
            </span>
          </div>

          <div className="project-meta">
            <div className="meta-top">
              {/* Статус для мобильных */}
              <span className={`status ${project.status === "В работе" ? "in-progress" : "done"} mobile-only`}>
                {project.status}
              </span>

              <div className="responsible-field">
                <img src="/responsible.png" alt="Ответственный" />
                <span>{project.responsible}</span>
              </div>
            </div>

            <div className="meta-dates">
              <div className="date-field">
                <label>Дата начала</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => {
                    setStartDate(e.target.value);
                    handleDatesUpdate(e.target.value, endDate); // отправляем на бэкенд сразу при изменении
                  }}
                />
              </div>

              <div className="date-field">
                <label>Дата окончания</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => {
                    setEndDate(e.target.value);
                    handleDatesUpdate(startDate, e.target.value);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Используем один компонент ProjectSection с разными пропсами для разных разделов.
              Состояние каждой секции хранится здесь и передаётся вниз через пропсы */}
          {SECTIONS.map(title => (
            <ProjectSection
              key={title}
              title={title}
              files={sections[title].files}
              pages={sections[title].pages}
              onFilesChange={(files) => updateSection(title, { files })}
              onPagesChange={(pages) => updateSection(title, { pages })}
            />
          ))}

          {/* Состояние дефектов также хранится здесь и передаётся вниз */}
          <ProjectDefectSection
            title="Фотографии дефектов"
            defects={defects}
            onDefectsChange={setDefects}
          />

          {/* Ошибка валидации — показывается если файлы не совпадают со страницами */}
          {error && <p className="error">{error}</p>}

          {/* Прогресс-бар — показывается только во время загрузки на Яндекс.Диск */}
          {isUploading && (
            <div className="progress-wrapper">
              <p className="progress-label">Загрузка на Яндекс.Диск... {uploadProgress}%</p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <div className="project-footer">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={completed}
                onChange={e => setCompleted(e.target.checked)} />
              <span>Работы завершены в полном объеме?</span>
            </label>

            <div className="buttons">
              {/* Сохранить — сохраняет файлы на сервер, заблокирована во время загрузки */}
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    await handleSave();
                    alert("Данные сохранены");
                  } catch (e: any) {
                    alert(e.message);
                  }
                }}
                disabled={isUploading || isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить"}
              </button>

              {/* Записать — активна только если стоит галочка "завершены", заблокирована во время загрузки */}
              <button
                className="btn primary"
                disabled={!completed || isUploading || isSaving}
                onClick={handleFinalSubmit}>
                {isUploading ? "Загрузка..." : "Записать"}
              </button>
            </div>

            {showModal && (
              <SuccessModal
                onClose={() => {
                  setShowModal(false);
                  navigate("/"); // экран со всеми проектами
                }}
              />
            )}
          </div>

          <p className="warning">
            Внимание! После записи данных их редактирование через приложение будет невозможно
          </p>

        </div>
      </div>
    </div>
  );
}

export default ProjectPage;