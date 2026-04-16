import { useEffect, useState } from "react";
import "../styles/project.css";
import ProjectSection from "../components/ProjectSection";
import ProjectDefectSection from "../components/ProjectDefectSection";
import Header from "../components/Header";
import { useNavigate } from "react-router-dom";
import SuccessModal from "../components/SuccessModal";
import { useParams } from "react-router-dom";
import api from "../utils/api";

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

type SavedPhoto = {
  id: number;
  section: string;
  defectType?: string;
  originalName: string;
  order: number;
};

type Props = {
  onLogout: () => void;
};

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

const formatDateForInput = (date: string | null) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

function ProjectPage({ onLogout }: Props) {
  const [completed, setCompleted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const navigate = useNavigate();

  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // сохранённые фото из БД
  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  // id фото которые пользователь удалил — отправляем на бэкенд при сохранении
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<number[]>([]);

  const [sections, setSections] = useState<Record<string, SectionState>>(
    Object.fromEntries(SECTIONS.map(s => [s, { files: [], pages: 0 }]))
  );

  const [defects, setDefects] = useState<Defect[]>([]);

  // загружаем проект и сохранённые фото при открытии страницы
  useEffect(() => {
    api.get(`/projects/${id}`)
      .then(res => {
        setProject(res.data);
        setStartDate(formatDateForInput(res.data.startDate));
        setEndDate(formatDateForInput(res.data.endDate));
      })
      .catch(() => setProject(null));

    api.get(`/projects/${id}/photos`)
      .then(res => setSavedPhotos(res.data))
      .catch(() => setSavedPhotos([]));
  }, [id]);


  useEffect(() => {
    if (!savedPhotos.length) return;

    const defectMap = new Map<string, Defect>();

    savedPhotos
      .filter(p => p.section === "дефекты")
      .forEach(p => {
        if (!p.defectType) return;

        if (!defectMap.has(p.defectType)) {
          defectMap.set(p.defectType, {
            id: Date.now() + Math.random(),
            typeId: "",
            typeName: p.defectType,
            pages: "",
            files: [],
          });
        }
      });

    if (defectMap.size) {
      setDefects(Array.from(defectMap.values()));
    }
  }, [savedPhotos]);


  if (!project) return <div>Проект не найден</div>;

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

  const updateSection = (title: string, patch: Partial<SectionState>) => {
    setSections(prev => ({
      ...prev,
      [title]: { ...prev[title], ...patch }
    }));
  };

  // удаление сохранённого фото — помечаем для удаления на бэкенде
  const handleRemoveSaved = (photoId: number) => {
    setDeletedPhotoIds(prev => [...prev, photoId]);
    setSavedPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  // собирает метаданные фото — сначала сохранённые, потом новые
  const buildPhotosMeta = () => {
    const photosMeta: {
      section: string;
      defectType?: string;
      originalName: string;
      order: number;
    }[] = [];

    // обычные секции
    for (const title of SECTIONS) {
      const newFiles = sections[title].files;
      const saved = savedPhotos
        .filter(p => p.section === title)
        .sort((a, b) => a.order - b.order);

      saved.forEach(p => {
        photosMeta.push({ section: title, originalName: p.originalName, order: p.order });
      });

      newFiles.forEach((file, i) => {
        photosMeta.push({ section: title, originalName: file.name, order: saved.length + i + 1 });
      });
    }

    // дефекты — для каждого дефекта сначала сохранённые потом новые
    for (const d of defects) {
      if (!d.typeName) continue;

      const savedDefectPhotos = savedPhotos
        .filter(p => p.section === "дефекты" && p.defectType === d.typeName)
        .sort((a, b) => a.order - b.order);

      savedDefectPhotos.forEach(p => {
        photosMeta.push({ section: "дефекты", defectType: d.typeName, originalName: p.originalName, order: p.order });
      });

      d.files.forEach((file, i) => {
        photosMeta.push({
          section: "дефекты",
          defectType: d.typeName,
          originalName: file.name,
          order: savedDefectPhotos.length + i + 1
        });
      });
    }

    return photosMeta;
  };

  // кнопка "Сохранить"
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const formData = new FormData();

      const sectionsState = Object.fromEntries(
        SECTIONS.map(title => [title, { pages: sections[title].pages }])
      );
      formData.append("sections", JSON.stringify(sectionsState));

      // отправляем только новые файлы секций
      for (const title of SECTIONS) {
        sections[title].files.forEach(file => formData.append("files", file));
      }

      // отправляем только новые файлы дефектов
      for (const d of defects) {
        if (!d.typeName || !d.files.length) continue;
        d.files.forEach(file => formData.append("files", file));
      }

      formData.append("photos", JSON.stringify(buildPhotosMeta()));
      formData.append("deletedPhotos", JSON.stringify(deletedPhotoIds));

      await api.patch(`/projects/${id}/save`, formData);

      // обновляем сохранённые фото из БД
      const res = await api.get(`/projects/${id}/photos`);
      setSavedPhotos(res.data);

      // очищаем новые файлы секций — они теперь в savedPhotos
      setSections(prev =>
        Object.fromEntries(
          SECTIONS.map(title => [title, { ...prev[title], files: [] }])
        )
      );

      // очищаем новые файлы дефектов — они теперь в savedPhotos
      setDefects(prev => prev.map(d => ({ ...d, files: [] })));

      setDeletedPhotoIds([]);

    } catch {
      throw new Error("Ошибка сохранения — проверьте консоль бэкенда");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalSubmit = async () => {
    setError(null);

    // валидация обычных секций — учитываем сохранённые и новые файлы
    for (const title of SECTIONS) {
      const s = sections[title];
      const savedCount = savedPhotos.filter(p => p.section === title).length;
      const totalFiles = s.files.length + savedCount;

      if (totalFiles !== s.pages) {
        setError(`Раздел "${title}": выбрано ${totalFiles} файлов, а указано ${s.pages}`);
        return;
      }
    }

    // валидация дефектов — учитываем сохранённые и новые файлы
    for (const d of defects) {
      if (!d.typeId || !d.pages) continue;
      const savedCount = savedPhotos.filter(
        p => p.section === "дефекты" && p.defectType === d.typeName
      ).length;
      const totalFiles = d.files.length + savedCount;

      if (totalFiles !== Number(d.pages)) {
        setError(`Дефект №${defects.indexOf(d) + 1}: выбрано ${totalFiles} файлов, а указано ${d.pages}`);
        return;
      }
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // сохраняем перед загрузкой на Яндекс.Диск
      await handleSave();

      await api.post(
        `/projects/${id}/upload`,
        {
          projectName: project.name,
          photos: JSON.stringify(buildPhotosMeta()),
        },
        {
          onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 1)
            );
            // 70% — отправка на сервер, остальные 30% — загрузка на Яндекс.Диск
            setUploadProgress(Math.min(percent, 70));
          },
        }
      );

      setUploadProgress(100);
      setShowModal(true);
    } catch {
      setError("Ошибка загрузки — проверьте консоль бэкенда");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="dashboard">
      <Header onLogout={onLogout} />
      <div className="project-page-bg">
        <div className="project-container">

          <div className="project-header">
            <button className="back-button" onClick={() => navigate("/")}><img src="/arrow_back.png" alt="Назад" /></button>
            <h1>{project.name}</h1>
            <span className={`status ${project.status === "В работе" ? "in-progress" : "done"} desktop-only`}>
              {project.status}
            </span>
          </div>

          <div className="project-meta">
            <div className="meta-top">
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
                    handleDatesUpdate(e.target.value, endDate);
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

          {SECTIONS.map(title => (
            <ProjectSection
              key={title}
              title={title}
              files={sections[title].files}
              pages={sections[title].pages}
              savedPhotos={savedPhotos
                .filter(p => p.section === title)
                .sort((a, b) => a.order - b.order)}
              onFilesChange={(files) => updateSection(title, { files })}
              onPagesChange={(pages) => updateSection(title, { pages })}
              onRemoveSaved={handleRemoveSaved}
            />
          ))}

          <ProjectDefectSection
            title="Фотографии дефектов"
            defects={defects}
            savedPhotos={savedPhotos}
            onDefectsChange={setDefects}
            onRemoveSaved={handleRemoveSaved}
          />

          {error && <p className="error">{error}</p>}

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
              {/* Сохранить — сохраняет файлы на сервер */}
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    await handleSave();
                    alert("Данные сохранены");
                  } catch (e: unknown) {
                    alert(e instanceof Error ? e.message : "Ошибка сохранения");
                  }
                }}
                disabled={isUploading || isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить"}
              </button>

              {/* Записать — активна только если стоит галочка и нет загрузки */}
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
                  navigate("/");
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