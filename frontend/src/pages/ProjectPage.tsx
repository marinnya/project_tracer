import { useEffect, useState } from "react";
import "../styles/project.css";
import "../styles/spinner.css";
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

type SavedDefect = {
  id: number;
  typeId: number;
  typeName: string;
  pages: number;
  photos: SavedPhoto[];
};

type SavedPhoto = {
  id: number;
  section: string | null;
  defectId: number | null;
  originalName: string;
  order: number;
  yandexPath: string | null;
};

type Defect = {
  id: number;
  typeId: number | "";
  typeName: string;
  pages: number | "";
  files: File[];
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

const formatDateDisplay = (date: string) => {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
};

function ProjectPage({ onLogout }: Props) {
  const [completed, setCompleted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("Сохранение...");
  const navigate = useNavigate();

  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [savedDefects, setSavedDefects] = useState<SavedDefect[]>([]);
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<number[]>([]);

  const [sections, setSections] = useState<Record<string, SectionState>>(
    Object.fromEntries(SECTIONS.map(s => [s, { files: [], pages: 0 }]))
  );

  const [defects, setDefects] = useState<Defect[]>([
    { id: -Date.now(), typeId: "", typeName: "", pages: "", files: [] }
  ]);

  useEffect(() => {
    if (!id) return;

    const projectReq = api.get(`/projects/${id}`)
      .then(res => {
        setProject(res.data);
        setStartDate(formatDateForInput(res.data.startDate));
        setEndDate(formatDateForInput(res.data.endDate));
      })
      .catch(() => setProject(null));

    const photosReq = api.get(`/projects/${id}/photos`)
      .then(res => setSavedPhotos(res.data))
      .catch(() => setSavedPhotos([]));

    const draftReq = api.get(`/projects/${id}/draft`)
      .then(res => {
        const draft = res.data as Record<string, { pages: number }> | null;
        if (!draft) return;
        setSections(prev =>
          Object.fromEntries(
            SECTIONS.map(title => [
              title,
              { ...prev[title], pages: draft[title]?.pages ?? 0 }
            ])
          )
        );
      })
      .catch(() => {});

    const defectsReq = api.get(`/projects/${id}/defects`)
      .then(res => {
        const loaded: SavedDefect[] = res.data;
        setSavedDefects(loaded);
        if (loaded.length > 0) {
          setDefects(loaded.map(d => ({
            id: d.id,
            typeId: d.typeId,
            typeName: d.typeName,
            pages: d.pages,
            files: [],
          })));
        }
      })
      .catch(() => setSavedDefects([]));

    Promise.all([projectReq, photosReq, draftReq, defectsReq])
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) return (
    <div className="spinner-fullscreen">
      <div className="spinner" />
    </div>
  );

  if (!project) return (
    <div className="spinner-fullscreen">
      <p style={{ color: "#999", fontSize: 15 }}>Проект не найден</p>
    </div>
  );

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

  const handleRemoveSavedPhoto = (photoId: number) => {
    setDeletedPhotoIds(prev => [...prev, photoId]);
    setSavedPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const handleRemoveSavedDefectPhoto = (photoId: number) => {
    setDeletedPhotoIds(prev => [...prev, photoId]);
    setSavedDefects(prev => prev.map(d => ({
      ...d,
      photos: d.photos.filter(p => p.id !== photoId),
    })));
  };

  const buildClientKey = (fileName: string, globalIndex: number): string => {
    return `${fileName}|||${globalIndex}`;
  };

  const buildSectionPhotosMeta = (
    fileKeys: string[],
    sectionFileStartIndex: number,
  ) => {
    const meta: { section: string; originalName: string; clientKey: string; order: number }[] = [];
    let keyIndex = sectionFileStartIndex;

    for (const title of SECTIONS) {
      const saved = savedPhotos
        .filter(p => p.section === title)
        .sort((a, b) => a.order - b.order);

      saved.forEach(p => meta.push({ section: title, originalName: p.originalName, clientKey: '', order: p.order }));

      sections[title].files.forEach((file, i) => {
        meta.push({ section: title, originalName: file.name, clientKey: fileKeys[keyIndex++], order: saved.length + i + 1 });
      });
    }

    return meta;
  };

  const buildAllPhotosForUpload = () => {
    const meta: { originalName: string; section: string | null; defectTypeName?: string; order: number }[] = [];

    for (const title of SECTIONS) {
      const saved = savedPhotos.filter(p => p.section === title).sort((a, b) => a.order - b.order);
      saved.forEach(p => meta.push({ originalName: p.originalName, section: title, order: p.order }));
      sections[title].files.forEach((file, i) => {
        meta.push({ originalName: file.name, section: title, order: saved.length + i + 1 });
      });
    }

    for (const d of defects) {
      if (!d.typeName) continue;
      const savedDef = savedDefects.find(sd => sd.id === d.id);
      const savedDefPhotos = savedDef?.photos.sort((a, b) => a.order - b.order) ?? [];

      savedDefPhotos.forEach(p => {
        meta.push({ originalName: p.originalName, section: 'дефекты', defectTypeName: d.typeName, order: p.order });
      });
      d.files.forEach((file, i) => {
        meta.push({ originalName: file.name, section: 'дефекты', defectTypeName: d.typeName, order: savedDefPhotos.length + i + 1 });
      });
    }

    return meta;
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const formData = new FormData();

      const sectionsState = Object.fromEntries(
        SECTIONS.map(title => [title, { pages: sections[title].pages }])
      );
      formData.append("sections", JSON.stringify(sectionsState));

      const fileToSection: Record<string, string> = {};
      const fileKeys: string[] = [];
      let globalIndex = 0;

      for (const title of SECTIONS) {
        sections[title].files.forEach(file => {
          const clientKey = buildClientKey(file.name, globalIndex++);
          formData.append("files", file);
          fileKeys.push(clientKey);
          fileToSection[clientKey] = title;
        });
      }

      const sectionFilesCount = fileKeys.length;

      for (const d of defects) {
        d.files.forEach(file => {
          const clientKey = buildClientKey(file.name, globalIndex++);
          formData.append("files", file);
          fileKeys.push(clientKey);
          fileToSection[clientKey] = `__defect__${d.typeName}`;
        });
      }

      formData.append("fileToSection", JSON.stringify(fileToSection));
      formData.append("fileKeys", JSON.stringify(fileKeys));
      formData.append("sectionPhotos", JSON.stringify(buildSectionPhotosMeta(fileKeys, 0)));

      let defectKeyIndex = sectionFilesCount;
      const defectsData = defects.map(d => {
        const savedDef = savedDefects.find(sd => sd.id === d.id);
        const savedCount = savedDef?.photos.length ?? 0;
        return {
          id: d.id > 0 ? d.id : undefined,
          typeId: d.typeId,
          typeName: d.typeName,
          pages: d.pages,
          newPhotos: d.files.map((file, i) => {
            const clientKey = fileKeys[defectKeyIndex++];
            return { originalName: file.name, clientKey, order: savedCount + i + 1 };
          }),
        };
      });
      formData.append("defects", JSON.stringify(defectsData));
      formData.append("deletedPhotos", JSON.stringify(deletedPhotoIds));

      await api.patch(`/projects/${id}/save`, formData);

      const [photosRes, defectsRes] = await Promise.all([
        api.get(`/projects/${id}/photos`),
        api.get(`/projects/${id}/defects`),
      ]);

      setSavedPhotos(photosRes.data);
      const loadedDefects: SavedDefect[] = defectsRes.data;
      setSavedDefects(loadedDefects);

      setDefects(prev => prev.map(d => {
        if (d.id > 0) return { ...d, files: [] };
        const found = loadedDefects.find(sd => sd.typeName === d.typeName);
        return found ? { ...d, id: found.id, files: [] } : { ...d, files: [] };
      }));

      setSections(prev =>
        Object.fromEntries(SECTIONS.map(title => [title, { ...prev[title], files: [] }]))
      );
      setDeletedPhotoIds([]);

    } catch {
      throw new Error("Ошибка сохранения — проверьте консоль бэкенда");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalSubmit = async () => {
    setError(null);

    if (!endDate) {
      setError("Укажите дату окончания перед записью");
      return;
    }

    for (const title of SECTIONS) {
      const s = sections[title];
      const savedCount = savedPhotos.filter(p => p.section === title).length;
      const totalFiles = s.files.length + savedCount;
      if (totalFiles !== s.pages) {
        setError(`Раздел "${title}": выбрано ${totalFiles} файлов, а указано ${s.pages}`);
        return;
      }
    }

    for (const d of defects) {
      if (!d.typeId || !d.pages) continue;
      const savedDef = savedDefects.find(sd => sd.id === d.id);
      const savedCount = savedDef?.photos.length ?? 0;
      const totalFiles = d.files.length + savedCount;
      if (totalFiles !== Number(d.pages)) {
        setError(`Дефект №${defects.indexOf(d) + 1}: выбрано ${totalFiles} файлов, а указано ${d.pages}`);
        return;
      }
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);
      setUploadLabel("Сохранение...");

      const uploadMeta = buildAllPhotosForUpload();

      const saveTimer = setInterval(() => {
        setUploadProgress(prev => (prev < 9 ? prev + 1 : prev));
      }, 200);
      await handleSave();
      clearInterval(saveTimer);
      setUploadProgress(10);
      setUploadLabel("Загрузка на Яндекс.Диск...");

      await new Promise<void>((resolve, reject) => {
        const baseUrl = (import.meta as { env: Record<string, string> }).env.VITE_API_URL ?? "";
        const token = localStorage.getItem("token") ?? "";
        const sse = new EventSource(
          `${baseUrl}/projects/${id}/upload-progress?token=${token}`
        );

        sse.onmessage = (event) => {
          const data = JSON.parse(event.data) as { percent: number; done: boolean };

          if (data.percent === -1) {
            sse.close();
            reject(new Error("Ошибка загрузки — проверьте консоль бэкенда"));
            return;
          }

          setUploadProgress(data.percent);

          if (data.done) {
            sse.close();
            resolve();
          }
        };

        sse.onerror = () => {
          sse.close();
          reject(new Error("Ошибка соединения с сервером"));
        };

        setTimeout(() => {
          api.post(
            `/projects/${id}/upload`,
            {
              projectName: project.name,
              photos: JSON.stringify(uploadMeta),
            },
          ).catch(reject);
        }, 300);
      });

      setShowModal(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="dashboard">
      <Header onLogout={onLogout} />
      <div className="project-page-bg">
        <div className="project-container">

          {/* Заголовок: стрелка + название + статус */}
          <div className="project-header">
            <button className="back-button" onClick={() => navigate("/")}>
              <img src="/arrow_back.png" alt="Назад" />
            </button>
            <h1>{project.name}</h1>
            <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
              {project.status}
            </span>
          </div>

          {/* Мета: ответственный и даты в одну строку на десктопе,
              на мобильном — ответственный отдельно, даты отдельно */}
          <div className="project-meta">
            <div className="responsible-field">
              <img src="/responsible.png" alt="Ответственный" />
              <span>{project.responsible}</span>
            </div>

            {/* Десктоп: две date-field рядом */}
            <div className="meta-dates desktop-only">
              <div className="date-field">
                <label>Дата начала</label>
                <input
                  type="date"
                  value={startDate}
                  disabled
                  onChange={e => { setStartDate(e.target.value); handleDatesUpdate(e.target.value, endDate); }}
                />
              </div>
              <div className="date-field">
                <label>Дата окончания</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); handleDatesUpdate(startDate, e.target.value); }}
                />
              </div>
            </div>

            {/* Мобильный: дата начала текстом через тире + поле окончания */}
            <div className="meta-dates-mobile mobile-only">
              <span className="meta-date-start">{formatDateDisplay(startDate)}</span>
              <span className="meta-date-sep">—</span>
              {endDate ? (
                <input
                  type="date"
                  value={endDate}
                  className="meta-date-end-input"
                  onChange={e => { setEndDate(e.target.value); handleDatesUpdate(startDate, e.target.value); }}
                />
              ) : (
                <label className="meta-date-end-placeholder">
                  <span>дд.мм.гггг</span>
                  <input
                    type="date"
                    value={endDate}
                    className="meta-date-end-input-hidden"
                    onChange={e => { setEndDate(e.target.value); handleDatesUpdate(startDate, e.target.value); }}
                  />
                </label>
              )}
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
              onRemoveSaved={handleRemoveSavedPhoto}
            />
          ))}

          <ProjectDefectSection
            title="Фотографии дефектов"
            defects={defects}
            savedDefects={savedDefects}
            onDefectsChange={setDefects}
            onRemoveSavedPhoto={handleRemoveSavedDefectPhoto}
          />

          {error && <p className="error">{error}</p>}

          {isUploading && (
            <div className="progress-wrapper">
              <p className="progress-label">{uploadLabel} {uploadProgress}%</p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <div className="project-footer">
            <label className="checkbox">
              <input type="checkbox" checked={completed} onChange={e => setCompleted(e.target.checked)} />
              <span>Работы завершены в полном объеме?</span>
            </label>

            <div className="buttons">
              <button
                className="btn secondary"
                onClick={async () => {
                  try { await handleSave(); alert("Данные сохранены"); }
                  catch (e: unknown) { alert(e instanceof Error ? e.message : "Ошибка сохранения"); }
                }}
                disabled={isUploading || isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить"}
              </button>

              <button
                className="btn primary"
                disabled={!completed || isUploading || isSaving}
                onClick={handleFinalSubmit}>
                {isUploading ? "Загрузка..." : "Записать"}
              </button>
            </div>

            {showModal && (
              <SuccessModal onClose={() => { setShowModal(false); navigate("/"); }} />
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