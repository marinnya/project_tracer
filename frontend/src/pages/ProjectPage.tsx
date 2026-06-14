import { useEffect, useState } from "react";
import "../styles/project.css";
import "../styles/spinner.css";
import ProjectSection from "../components/ProjectSection";
import ProjectDefectSection from "../components/ProjectDefectSection";
import Header from "../components/Header";
import { useNavigate, useParams } from "react-router-dom";
import SuccessModal from "../components/SuccessModal";
import api from "../utils/api";
import { getApiErrorMessage } from "../utils/getApiErrorMessage";
import { MAX_PAGES_PER_PROJECT } from "../constants/uploads";
import { nextTempDefectId } from "../utils/tempDefectId";
import { compressImageFile } from "../utils/compressImage";

// Обновленный тип проекта под новую схему Prisma
type Project = {
  id: number;
  name: string;
  status: string;
  responsibleUser?: {
    firstName: string;
    lastName: string;
  } | null;
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
  "Протоколы испытаний",
  "Сканы паспортов",
  "Прочностные расчеты",
  "Дополнительная информация",
] as const;

const formatDateForInput = (date: string | null) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

/** Следующий порядковый номер после уже сохранённых (не по количеству — после удаления из середины). */
const maxPhotoOrder = (photos: { order: number }[]) =>
  photos.reduce((max, p) => Math.max(max, p.order), 0);

const formatDateDisplay = (date: string) => {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
};

const formatEta = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s} сек`;
  return `${m} мин ${String(s).padStart(2, "0")} сек`;
};

function ProjectPage({ onLogout }: Props) {
  const [completed, setCompleted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalMessage, setModalMessage] = useState("");
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("Сохранение...");
  const [tmpUsage, setTmpUsage] = useState<{ usedBytes: number; maxBytes: number } | null>(null);
  const navigate = useNavigate();

  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [savedDefects, setSavedDefects] = useState<SavedDefect[]>([]);
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<number[]>([]);
  const [defectTypes, setDefectTypes] = useState<{ id: number; name: string }[]>([]);

  const [sections, setSections] = useState<Record<string, SectionState>>(
    Object.fromEntries(SECTIONS.map(s => [s, { files: [], pages: 0 }]))
  );

  const [defects, setDefects] = useState<Defect[]>([
    { id: nextTempDefectId(), typeId: "", pages: "", files: [] },
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
            pages: d.pages,
            files: [],
          })));
        }
      })
      .catch(() => setSavedDefects([]));

    const defectTypesReq = api.get("/onec/defect-types")
      .then(res => setDefectTypes(res.data))
      .catch(() => setDefectTypes([]));

    const tmpUsageReq = api.get(`/projects/${id}/tmp-usage`)
      .then(res => setTmpUsage(res.data))
      .catch(() => setTmpUsage(null));

    Promise.all([projectReq, photosReq, draftReq, defectsReq, defectTypesReq, tmpUsageReq])
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

  const buildAllPhotosForUpload = () => {
    const meta: {
      originalName: string;
      section: string | null;
      defectId?: number;
      defectTypeName?: string;
      order: number;
    }[] = [];

    for (const title of SECTIONS) {
      const saved = savedPhotos.filter(p => p.section === title).sort((a, b) => a.order - b.order);
      saved.forEach(p => meta.push({ originalName: p.originalName, section: title, order: p.order }));
      const sectionBaseOrder = maxPhotoOrder(saved);
      sections[title].files.forEach((file, i) => {
        meta.push({ originalName: file.name, section: title, order: sectionBaseOrder + i + 1 });
      });
    }

    for (const d of defects) {
      if (!d.typeId) continue;
      const selectedTypeName = defectTypes.find(t => t.id === d.typeId)?.name ?? "";
      const savedDef = savedDefects.find(sd => sd.id === d.id);
      const savedDefPhotos = savedDef?.photos.sort((a, b) => a.order - b.order) ?? [];
      const defectTypeName = savedDef?.typeName ?? selectedTypeName;

      savedDefPhotos.forEach(p => {
        meta.push({
          originalName: p.originalName,
          section: 'Дефекты',
          defectId: d.id > 0 ? d.id : undefined,
          defectTypeName,
          order: p.order
        });
      });
      const defectBaseOrder = maxPhotoOrder(savedDefPhotos);
      d.files.forEach((file, i) => {
        meta.push({
          originalName: file.name,
          section: 'Дефекты',
          defectId: d.id > 0 ? d.id : undefined,
          defectTypeName,
          order: defectBaseOrder + i + 1
        });
      });
    }

    return meta;
  };

  /** `fileUploadProgressCap`: при «Записать» оставляем 0–10% под черновик, 10–100% даёт SSE Яндекса; при одном «Сохранить» — вся полоса 0–100%. */
  const handleSave = async (opts?: { fileUploadProgressCap?: number }) => {
    const fileProgressCap = opts?.fileUploadProgressCap ?? 100; // процент загрузки файлов
    /** Единый префикс — без скачков «Сохранение» ↔ «Отправка на сервер». */
    const saveCaption = "Сохранение черновика"; // текст для прогресс-бара
    setIsSaving(true); // включаем режим сохранения: isSaving = true (используется для disable кнопки "Сохранить")
    setError(null); // очищаем ошибку
    setUploadProgress(0); // устанавливаем прогресс на 0%
    setUploadLabel(`${saveCaption}…`); // показываем начальный текст

    try {
      // Сжимаем новые фото перед отправкой (чтобы быстрее грузилось и меньше занимало места)
      // Важно: сохраняем исходные имена файлов, чтобы не ломать привязку/уникальность.
      // считаем общее количество файлов, проходя по секциям и дефектам
      const totalToCompress =
        SECTIONS.reduce((s, t) => s + sections[t].files.length, 0) +
        defects.reduce((s, d) => s + d.files.length, 0);
      // Распределяем прогрессбар на сжатие(35%) и загрузку на Яндекс(65%)
      const prepPortion =
        totalToCompress > 0 ? Math.max(1, Math.round(fileProgressCap * 0.35)) : 0; // 35% от общего прогресса на сжатие
      const uploadPortion = fileProgressCap - prepPortion; // остальные 65% на загрузку на Яндекс
      let compressDone = 0; // счетчик сжатых файлов
      // функция для обновления прогресса сжатия, вызывается после каждого успешно сжатого файла
      const bumpCompressProgress = async () => {
        compressDone++; // увеличиваем счетчик сжатых файлов на 1
        // если есть файлы для сжатия
        if (totalToCompress > 0) {
          // считаем процент сжатия: compressDone / totalToCompress * prepPortion
          const raw = Math.round((compressDone / totalToCompress) * prepPortion);
          // обновляем прогрессбар
          // минимум 1% если что то есть, чтобы не было 0%, но не больше prepPortion
          setUploadProgress(Math.min(prepPortion, Math.max(raw, compressDone > 0 ? 1 : 0)));
          // обновляем подпись прогресс-бара
          setUploadLabel(
            `${saveCaption}: подготовка фото (${compressDone}/${totalToCompress})…`,
          );
          // даем браузеру перерисовать прогресс-бар
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      };

      /** Параллельное сжатие (несколько canvas подряд): быстрее на ПК, без смены качества/размеров в compressImageFile. */
      const COMPRESS_CONCURRENCY = 4; // количество потоков для сжатия

      // тип задачи для сжатия: секция или дефект
      type CompressTask =
        | { kind: "section"; title: string; idx: number; file: File }
        | { kind: "defect"; defectId: number; idx: number; file: File };

      // создаем очередь задач для сжатия, пока пусто
      const compressTasks: CompressTask[] = [];
      // проходим по секциям
      for (const title of SECTIONS) {
        // берем все файлы из для секции
        sections[title].files.forEach((file, idx) =>
          // для каждого файла добавляем задачу в очередь: формат: { kind: "section", title: "крыша", idx: 0, file: roof.jpg }
          compressTasks.push({ kind: "section", title, idx, file }),
        );
      }
      // проходим по дефектам
      for (const d of defects) {
        d.files.forEach((file, idx) =>
          compressTasks.push({ kind: "defect", defectId: d.id, idx, file }),
        );
      }

      // создаем массивы для сжатых файлов: секции и дефекты
      const compressedSections: Record<string, File[]> = {};
      for (const title of SECTIONS) {
        // считаем количество файлов в секции
        const n = sections[title].files.length;
        // создаем массив нужного размера
        compressedSections[title] = n ? new Array<File>(n) : [];
      }
      // аналогично для дефектов
      const compressedDefects: Record<number, File[]> = {};
      for (const d of defects) {
        const n = d.files.length;
        compressedDefects[d.id] = n ? new Array<File>(n) : [];
      }

      // если есть задачи для сжатия
      if (compressTasks.length > 0) {
        let nextCompressIndex = 0; // индекс следующей задачи для сжатия
        // создаем воркер, который берет новую задачу
        const worker = async () => {
          // бесконечный цикл для сжатия файлов, опка не закончится очередь
          while (true) {
            const i = nextCompressIndex++; // берем следующую задачу, чтобы задачи не дублировались
            if (i >= compressTasks.length) return; // если задачи закончились, то выходим из цикла
            const t = compressTasks[i]; // получаем задачу
            // сжимаем файл
            const out = await compressImageFile(t.file);
            // out - File, результат сжатия, добавляем его в заранее созданный массив сжатых файлов
            if (t.kind === "section") {
              compressedSections[t.title][t.idx] = out;
            } else {
              compressedDefects[t.defectId][t.idx] = out;
            }
            await bumpCompressProgress(); // обновляем прогресс сжатия
          }
        };
        // создаем пул потоков для сжатия, количество потоков не больше количества задач и не больше COMPRESS_CONCURRENCY
        const poolSize = Math.min(COMPRESS_CONCURRENCY, compressTasks.length);
        // запускаем пул потоков для сжатия, ждем всех, потом код пойдет дальше
        await Promise.all(Array.from({ length: poolSize }, () => worker()));
      }

      // Быстрый прогноз: чтобы не грузить гигабайты по сети и получить отказ уже на сервере
      // подсчет размера новых файлов: проходим по секциям и дефектам, складываем размеры файлов
      const incomingBytes =
        SECTIONS.reduce((s, t) => s + (compressedSections[t] ?? []).reduce((a, f) => a + f.size, 0), 0) +
        defects.reduce((s, d) => s + (compressedDefects[d.id] ?? []).reduce((a, f) => a + f.size, 0), 0);
        // проверяем, не превышает ли размер новых файлов лимит
      if (tmpUsage && (tmpUsage.usedBytes + incomingBytes > tmpUsage.maxBytes)) {
        const maxGb = (tmpUsage.maxBytes / 1024 / 1024 / 1024).toFixed(1);
        const nextGb = ((tmpUsage.usedBytes + incomingBytes) / 1024 / 1024 / 1024).toFixed(2);
        const msg =
          `Превышен лимит локального объёма фото для проекта: максимум ${maxGb} ГБ. ` +
          `Сейчас получилось бы ${nextGb} ГБ. Удалите часть фото и попробуйте снова.`;
        setError(msg);
        throw new Error(msg);
      }

      // сумма страниц секций и дефектов
      /* sections = {
        "Титульный лист": { files: [...], pages: 2 },
        "План-схема склада": { files: [...], pages: 5 },
      }*/
      const sectionPagesSum = SECTIONS.reduce((s, t) => s + sections[t].pages, 0);
      const defectPagesSum = defects.reduce((s, d) => s + (Number(d.pages) || 0), 0);
      const totalPagesDeclared = sectionPagesSum + defectPagesSum;
      // проверяем, не превышает ли количество страниц лимит
      if (totalPagesDeclared > MAX_PAGES_PER_PROJECT) {
        const msg =
          `Суммарное количество страниц по проекту не может превышать ${MAX_PAGES_PER_PROJECT}. ` + // максимальное количество страниц
          `Сейчас указано: ${totalPagesDeclared}.`; // текущее количество страниц
        setError(msg); // устанавливаем ошибку
        throw new Error(msg); // выбрасываем ошибку
      }

      // создаем форму для отправки FormData (создается multipart-контейнер)
      const saveMetaFormData = new FormData(); // пока пустой
      // внутри ["sections": { "Титульный лист": { pages: 2 }, "План-схема склада": { pages: 5 } }]
      const sectionsState = Object.fromEntries(
        SECTIONS.map(title => [title, { pages: sections[title].pages }])
      );
      // сейчас только метаданные, файлы будут отправляться отдельным запросом
      saveMetaFormData.append("sections", JSON.stringify(sectionsState)); // добавляем секции в формате {"Титульный лист": { pages: 2 }, "План-схема склада": { pages: 5 }}
      saveMetaFormData.append("fileToSection", JSON.stringify({})); // добавляем пустой объект для привязки файлов к секциям
      saveMetaFormData.append("fileKeys", JSON.stringify([])); // добавляем пустой массив для ключей файлов
      saveMetaFormData.append("sectionPhotos", JSON.stringify([])); // добавляем пустой список фото секций

      // берем каждый дефект
      const defectsData = defects.map(d => {
        return {
          // отправляем и временный отрицательный id тоже,
          // чтобы бэкенд смог вернуть defectIdMap (tempId - realId)
          id: d.id,
          typeId: d.typeId,
          pages: d.pages,
          newPhotos: [],
        };
      });
      // добавляем дефекты в запрос в формате {"id": 1, "typeId": 1, "pages": 2, "newPhotos": []}
      saveMetaFormData.append("defects", JSON.stringify(defectsData));
      saveMetaFormData.append("deletedPhotos", JSON.stringify(deletedPhotoIds)); // добавляем удаленные фото в запрос

      // показываем сообщение в прогресс-баре
      setUploadLabel(`${saveCaption}: метаданные…`);
      // отправляем запрос на сохранение метаданных
      const saveRes = await api.patch(`/projects/${id}/save`, saveMetaFormData);
      // получаем map временных id на реальные id дефектов в формате {"-1": 1, "-2": 2, "-3": 3}
      const defectIdMap = (saveRes.data?.defectIdMap ?? {}) as Record<string, number>;

      // если дефект новый, то получаем его реальный id из defectIdMap по ключу
      const resolvedDefectId = (defectId: number) => (
        defectId > 0 ? defectId : (defectIdMap[String(defectId)] ?? defectId)
      );

      // тип элемента для загрузки
      type PendingUpload = {
        file: File; // сам файл, браузерный объект File
        clientKey: string; // уникальный ключ на клиенте
        subfolder: string; // папка, куда файл должен попасть
        // доп. метаданные (необязательные)
        sectionPhoto?: { section: string; originalName: string; clientKey: string; order: number };
        defectPhoto?: { defectId: number; originalName: string; clientKey: string; order: number };
      };

      // пустой массив файлов для загрузки
      const pendingUploads: PendingUpload[] = [];
      let globalIndex = 0; // глобальный счетчик файлов

      // проходим по секциям
      for (const title of SECTIONS) {
        // берем уже сохраненные фото только из этой секции, сортируем по порядку
        const saved = savedPhotos
          .filter(p => p.section === title)
          .sort((a, b) => a.order - b.order);
        // находим макс. order в уже сохраненных фото
        const sectionBaseOrder = maxPhotoOrder(saved);
        // проходим по новымсжатым файлам для секции
        (compressedSections[title] ?? []).forEach((file, i) => {
          // создаем уникальный ключ для файла формата roof.jpg|||0
          const clientKey = buildClientKey(file.name, globalIndex++);
          // добавляем файл в массив для загрузки
          pendingUploads.push({
            file, // сам файл
            clientKey, // уникальный идентификатор файла на клиенте
            subfolder: title, // папка, куда файл должен попасть с именем секции
            sectionPhoto: {
              section: title, // секция
              originalName: file.name, // оригинальное имя файла
              clientKey, // уникальный идентификатор файла на клиенте
              order: sectionBaseOrder + i + 1, // порядок файла
            },
          });
        });
      }

      // проходим по дефектам
      for (const d of defects) {
        const savedDef = savedDefects.find(sd => sd.id === d.id); // находим дефект в savedDefects по id
        const savedDefPhotos = savedDef?.photos ?? []; // берем фото дефекта
        const defectBaseOrder = maxPhotoOrder(savedDefPhotos); // находим макс. order в уже сохраненных фото дефекта
        const defectId = resolvedDefectId(d.id); // получаем реальный id дефекта
        // проходим по новым сжатым файлам для дефекта
        (compressedDefects[d.id] ?? []).forEach((file, i) => {
          const clientKey = buildClientKey(file.name, globalIndex++); // создаем уникальный ключ для файла формата roof.jpg|||0
          // добавляем файл в массив для загрузки
          pendingUploads.push({
            file, // сам файл
            clientKey, // уникальный идентификатор файла на клиенте
            subfolder: `__defect__id__${defectId}`, // папка, куда файл должен попасть с реальным id дефекта
            // доп. метаданные дефекта
            defectPhoto: {
              defectId, // id дефекта
              originalName: file.name, // оригинальное имя файла
              clientKey, // уникальный идентификатор файла на клиенте
              order: defectBaseOrder + i + 1, // порядок файла
            },
          });
        });
      }

      // Важно: слишком большие multipart-запросы часто ловят 413 от nginx/прокси.
      // Меньше chunk => надёжнее загрузка, лучше UX на слабой сети.
      const CHUNK_SIZE = 10; // размер чанка для загрузки
      const saveStartMs = Date.now(); // время начала сохранения для расчета оставшегося времени

      // функция для загрузки чанка
      const uploadChunkWithRetry = async (
        chunk: PendingUpload[], // массив файлов для загрузки
        chunkFirstIndex: number, // позиция в общем списке
        retries = 3, // попытки при шибке
      ) => {
        const formData = new FormData(); // создаем форму для отправки FormData (создается multipart-контейнер)
        // мап clientKey - subfolder: {"roof.jpg|||0": "крыша", "roof.jpg|||1": "крыша", "roof.jpg|||2": "крыша"}
        const fileToSection: Record<string, string> = {};
        const fileKeys: string[] = []; // список ключей файлов
        // метаданные секционных и дефектных фото
        const sectionPhotos: { section: string; originalName: string; clientKey: string; order: number }[] = [];
        const defectPhotos: { defectId: number; originalName: string; clientKey: string; order: number }[] = [];

        // заполнение FormData
        // перебираем файлы в чанке
        for (const item of chunk) {
          formData.append("files", item.file); // добавляем сам файл в форму
          fileKeys.push(item.clientKey); // добавляем ключ файла в список
          fileToSection[item.clientKey] = item.subfolder; // добавляем соответствие clientKey - subfolder
          // добавляем метаданные секционных и дефектных фото
          if (item.sectionPhoto) sectionPhotos.push(item.sectionPhoto);
          if (item.defectPhoto) defectPhotos.push(item.defectPhoto);
        }

        // добавляем метаданные в форму
        formData.append("fileToSection", JSON.stringify(fileToSection)); // формат: {"roof.jpg|||0": "крыша", "roof.jpg|||1": "крыша", "roof.jpg|||2": "крыша"}
        formData.append("fileKeys", JSON.stringify(fileKeys)); // список ключей файлов
        formData.append("sectionPhotos", JSON.stringify(sectionPhotos)); // метаданные секционных фото
        formData.append("defectPhotos", JSON.stringify(defectPhotos)); // метаданные дефектных фото

        const totalFiles = pendingUploads.length; // общее количество файлов в списке
        // функция для обновления прогресса загрузки
        const bumpProgressFromUpload = (loaded: number, totalRequestBytes: number) => {
          if (totalRequestBytes <= 0 || totalFiles <= 0) return;
          // сколько файлов загружено в текущем чанке (доля от общего количества файлов в чанке)
          const withinChunk = (loaded / totalRequestBytes) * chunk.length;
          const virtualDone = chunkFirstIndex + withinChunk; // общее количество загруженных файлов
          // процент загрузки
          const pct = Math.min(
            fileProgressCap, // максимальный процент загрузки
            prepPortion + Math.round((virtualDone / totalFiles) * uploadPortion), // процент загрузки
          );
          setUploadProgress(pct); // обновляем прогресс загрузки
          const doneApprox = Math.min(totalFiles, Math.max(0, Math.floor(virtualDone))); // приблизительное количество загруженных файлов
          const elapsed = Date.now() - saveStartMs; // время, прошедшее с начала сохранения
          const perFile = virtualDone > 0 ? elapsed / virtualDone : 0; // среднее время на один файл
          const remainingMs = (totalFiles - virtualDone) * perFile; // оставшееся время
          const eta = formatEta(remainingMs); // осталось времени
          // обновляем прогресс-бар с сообщением сколько загружено, осталось и время
          setUploadLabel(
            `${saveCaption}: файлы (${doneApprox}/${totalFiles})${eta ? `, осталось ${eta}` : ""}…`, // обновляем прогресс-бар
          );
        };

        // пробуем загрузить чанк несколько раз (3 попытки)
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            // отправляем запрос на сохранение файлов
            await api.patch(`/projects/${id}/save-files`, formData, {
              // прогресс загрузки файлов
              onUploadProgress: (ev) => {
                const total = ev.total ?? 0; // общее количество
                if (total > 0) bumpProgressFromUpload(ev.loaded, total); // обновляем прогресс загрузки файлов
              },
            });
            {
              // скольько файлов уже загружено
              const vd = chunkFirstIndex + chunk.length;
              // считает процент прогресса загрузки файлов
              const pctDone = Math.min(
                fileProgressCap,
                prepPortion + Math.round((vd / totalFiles) * uploadPortion),
              );
              setUploadProgress(pctDone); // обновляет UI
            }
            return;
          } catch (e) {
            // если последняя попытка и ошибка, то выбрасываем ошибку
            if (attempt === retries) throw e;
            await new Promise(resolve => setTimeout(resolve, attempt * 500)); // ждем 500мс перед следующей попыткой (уменьшает нагрузку на сервер)
          }
        }
      };

      // если нет файлов для загрузки, то устанавливаем прогресс на 100%
      if (pendingUploads.length === 0) {
        setUploadProgress(fileProgressCap); // устанавливаем прогресс на 100%
      } else {
        setUploadLabel(`${saveCaption}: файлы (0/${pendingUploads.length})…`); // устанавливаем сообщение в прогресс-баре
      }
      // проходим по чанкам (делим файлы на части)
      for (let i = 0; i < pendingUploads.length; i += CHUNK_SIZE) {
        // берем текущий чанк
        const chunk = pendingUploads.slice(i, i + CHUNK_SIZE);
        await uploadChunkWithRetry(chunk, i); // загружаем текущий чанк
        // считаем сколько файлов уже загружено
        const done = Math.min(i + chunk.length, pendingUploads.length);
        // считаем процент загрузки файлов
        const pct =
          pendingUploads.length === 0
            ? fileProgressCap
            : Math.min(
                fileProgressCap,
                prepPortion +
                  Math.round((done / pendingUploads.length) * uploadPortion),
              );
        setUploadProgress(pct); // обновляем UI
        const elapsed = Date.now() - saveStartMs; // время, прошедшее с начала сохранения
        const perFile = done > 0 ? elapsed / done : 0; // среднее время на один файл
        const remainingMs = (pendingUploads.length - done) * perFile; // оставшееся время
        const eta = formatEta(remainingMs);
        // обновляем сообщение в прогресс-баре
        setUploadLabel(
          `${saveCaption}: файлы (${done}/${pendingUploads.length})${eta ? `, осталось ${eta}` : ""}…`,
        );
      }

      // обновим usage после успешной докачки
      try {
        // получаем сколько места занимают файлы в tmp
        const usageRes = await api.get(`/projects/${id}/tmp-usage`);
        // обновляем usage
        setTmpUsage(usageRes.data);
      } catch {
        // ignore
      }

      // параллельно запрашиваем фото и дефекты с сервера
      const [photosRes, defectsRes] = await Promise.all([
        api.get(`/projects/${id}/photos`),
        api.get(`/projects/${id}/defects`),
      ]);

      // обновляем UI
      setSavedPhotos(photosRes.data);
      const loadedDefects: SavedDefect[] = defectsRes.data;
      setSavedDefects(loadedDefects);

      // обновляем дефекты
      setDefects(prev => prev.map(d => {
        if (d.id > 0) return { ...d, files: [] }; // если дефект уже в БД, то очищаем список файлов
        // если id был временный, то заменяем его на реальный id из defectIdMap
        const mappedId = defectIdMap[String(d.id)];
        return mappedId ? { ...d, id: mappedId, files: [] } : { ...d, files: [] };
      }));

      // для всех секций очищаем загруженные файлы
      setSections(prev =>
        Object.fromEntries(SECTIONS.map(title => [title, { ...prev[title], files: [] }]))
      );
      setDeletedPhotoIds([]); // сбрасываем список удалений

    } catch (e) {
      const msg = getApiErrorMessage(e, "Ошибка сохранения");
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsSaving(false); // выключаем состояние - режим сохранения
    }
  };

  const handleFinalSubmit = async () => {
    setError(null); // сбрасываем ошибку

    // проверяем дату окончания
    if (!endDate) {
      setError("Укажите дату окончания перед записью");
      return;
    }

    // проходим по всем секциям
    for (const title of SECTIONS) {
      const s = sections[title]; // берем состояние секции
      // считаем сколько файлов уже сохранено в БД
      const savedCount = savedPhotos.filter(p => p.section === title).length;
      // общее количество файлов = новые + уже сохраненные
      const totalFiles = s.files.length + savedCount;
      // если общее количество файлов не равно количеству файлов в секции, то выбрасываем ошибку
      if (totalFiles !== s.pages) {
        setError(`Раздел "${title}": выбрано ${totalFiles} файлов, а указано ${s.pages}`);
        return;
      }
    }

    // проходим по всем дефектам
    for (const d of defects) {
      if (!d.typeId || !d.pages) continue; // если тип дефекта или количество страниц не указаны, то пропускаем
      // находим дефект из БД по id
      const savedDef = savedDefects.find(sd => sd.id === d.id);
      // считаем сколько фото уже сохранено в БД
      const savedCount = savedDef?.photos.length ?? 0;
      // общее количество файлов = новые + уже сохраненные
      const totalFiles = d.files.length + savedCount;
      // если общее количество файлов не равно количеству страниц, то выбрасываем ошибку
      if (totalFiles !== Number(d.pages)) {
        setError(`Дефект №${defects.indexOf(d) + 1}: выбрано ${totalFiles} файлов, а указано ${d.pages}`);
        return;
      }
    }

    // начало загрузки
    try {
      setIsUploading(true); // включаем состояние - режим загрузки
      setUploadProgress(0); // устанавливаем прогресс на 0%
      setUploadLabel("Сохранение черновика…"); // устанавливаем сообщение в прогресс-баре

      // собираем списко всех фото + метаданные
      const uploadMeta = buildAllPhotosForUpload();

      // сохранение черновика 10%
      await handleSave({ fileUploadProgressCap: 10 });
      setUploadProgress(10); // устанавливаем прогресс на 10%
      setUploadLabel("Загрузка на Яндекс.Диск..."); // устанавливаем сообщение в прогресс-баре

      // создаем SSE-соединение с сервером
      await new Promise<void>((resolve, reject) => {
        const baseUrl = (import.meta as any).env.VITE_API_URL ?? ""; // URL API
        const token = localStorage.getItem("token") ?? ""; // токен авторизации
        // открываем поток прогресса с сервера
        const sse = new EventSource( // создаем SSE-соединение
          `${baseUrl}/projects/${id}/upload-progress?token=${token}` // URL для соединения
        );

        // точка отсчета времени
        let yandexProgressAnchor: { t0: number; p0: number } | null = null; // временная метка для расчета скорости загрузки

        // обработка сообщений SSE от сервера
        sse.onmessage = (event) => {
          // percent - процент загрузки, done - флаг завершения загрузки
          const data = JSON.parse(event.data) as { percent: number; done: boolean }; // парсим данные из сообщения

          // сервер говорит что ошибка
          if (data.percent === -1) {
            sse.close(); // закрываем соединение
            // прерываем Promise
            reject(new Error("Ошибка загрузки — проверьте консоль бэкенда"));
            return;
          }

          // UI обновляем прогресс загрузки
          setUploadProgress(data.percent);

          // если загрузка завершена
          if (data.done) {
            setUploadLabel("Загрузка на Яндекс.Диск..."); // устанавливаем сообщение в прогресс-баре
            sse.close(); // закрываем соединение
            // завершаем Promise
            resolve();
            return;
          }

          // расчет времени до конца загрузки
          const p = data.percent; // процент загрузки
          let etaSuffix = ""; // текст для сообщения в прогресс-баре
          // если процент загрузки больше 10% и меньше 100%, то считаем время осталось
          if (p >= 10 && p < 100) {
            const now = Date.now(); // текущее время
            // если временная метка не установлена, то устанавливаем ее
            if (yandexProgressAnchor === null) {
              yandexProgressAnchor = { t0: now, p0: p };
            }
            // считаем время, прошедшее с момента начала загрузки
            const elapsed = now - yandexProgressAnchor.t0;
            // считаем разницу в процентах с начального процента
            const deltaP = p - yandexProgressAnchor.p0;
            if (deltaP >= 0.5 && elapsed >= 300) { // если разница в процентах больше 0.5% и время прошедшее больше 300мс, то считаем скорость загрузки
              const speed = deltaP / elapsed; // скорость загрузки
              if (speed > 0) { // если скорость загрузки больше 0, то считаем время осталось
                const remainingMs = (100 - p) / speed; // время осталось
                const eta = formatEta(remainingMs); // осталось времени
                if (eta) etaSuffix = `, осталось ${eta}`; // текст для сообщения в прогресс-баре
              }
            }
          }
          setUploadLabel(`Загрузка на Яндекс.Диск...${etaSuffix}`); // устанавливаем сообщение в прогресс-баре
        };

        // если соединение SSE с сервером прервано
        sse.onerror = () => {
          sse.close(); // закрываем соединение
          // прерываем Promise
          reject(new Error("Ошибка соединения с сервером"));
        };

        // небольшая задержка, чтобы SSE успел подключиться
        setTimeout(() => {
          // Бэкенд отвечает 202 сразу; завершение и ошибки — только через SSE (ниже)
          // запускаем процесс загрузки на Яндекс на сервере
          api.post(`/projects/${id}/upload`, {
            projectName: project.name, // отправляем имя проекта
            photos: JSON.stringify(uploadMeta), // отправляем метаданные фото
          }).catch(reject); // если post упал, то завершаем Promise с ошибкой
        }, 300);
      });

      // показываем модальное окно
      setModalMessage("Данные успешно записаны! Проект помещен в архив.");
      setShouldRedirect(true); // разрешаем перенаправление
      setShowModal(true); // показываем модальное окно
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Ошибка загрузки"));
    } finally {
      setIsUploading(false); // выключаем состояние - режим загрузки
    }
  };

  return (
    <div className="dashboard">
      <Header onLogout={onLogout} />
      <div className="project-page-bg">
        <div className="project-container">

          <div className="project-header">
            <button className="back-button" onClick={() => navigate("/")}>
              <img src="/arrow_back.png" alt="Назад" />
            </button>
            <h1>{project.name}</h1>
            <span className={`status ${project.status === "В работе" ? "in-progress" : "done"}`}>
              {project.status}
            </span>
          </div>

          <div className="project-meta">
            <div className="responsible-field">
              <img src="/responsible.png" alt="Ответственный" />
              <span>
                {project.responsibleUser 
                  ? `${project.responsibleUser.firstName} ${project.responsibleUser.lastName}`.trim() || "Имя не указано"
                  : "Сотрудник не найден"}
              </span>
            </div>

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

          {(isUploading || isSaving) && (
            <div className="progress-wrapper">
              <p className="progress-label">{uploadLabel} {Math.round(uploadProgress)}%</p>
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
                  try {
                    await handleSave();
                    setModalMessage("Данные успешно сохранены!");
                    setShouldRedirect(false);
                    setShowModal(true);
                  } catch {
                    /* текст ошибки уже в setError из handleSave */
                  }
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
              <SuccessModal
                message={modalMessage}
                onClose={() => {
                  setShowModal(false);
                  if (shouldRedirect) {
                    setShouldRedirect(false);
                    navigate("/");
                  }
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