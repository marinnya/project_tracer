import { useRef, useState, useMemo } from "react";

type SavedPhoto = {
  id: number;
  originalName: string;
};

type Props = {
  title: string;
  files: File[];
  pages: number;
  savedPhotos: SavedPhoto[];
  onFilesChange: (files: File[]) => void;
  onPagesChange: (pages: number) => void;
  onRemoveSaved: (id: number) => void;
};

const pageOptions = Array.from({ length: 11 }, (_, i) => i);

function ProjectSection({
  title,
  files,
  pages,
  savedPhotos,
  onFilesChange,
  onPagesChange,
  onRemoveSaved,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);

  // ===============================
  // 1. УНИКАЛИЗАЦИЯ ИМЁН
  // ===============================
  const normalizeFiles = (files: File[]) => {
    const nameCount: Record<string, number> = {};

    return files.map((file) => {
      const name = file.name;

      if (!nameCount[name]) {
        nameCount[name] = 1;
        return file;
      }

      const newIndex = ++nameCount[name];
      const newName = name.replace(/(\.[^.]*)?$/, ` (${newIndex})$1`);

      return new File([file], newName, { type: file.type });
    });
  };

  const handleAddFiles = (newFiles: FileList) => {
    const normalized = normalizeFiles(Array.from(newFiles));
    onFilesChange([...files, ...normalized]);
  };

  // ===============================
  // 2. ОБЪЕДИНЕНИЕ БЕЗ ДУБЛЕЙ
  // ===============================
  const allFiles = useMemo(() => {
    const savedNames = new Set(savedPhotos.map(p => p.originalName));

    return [
      ...savedPhotos.map(p => ({
        id: p.id,
        name: p.originalName,
        isSaved: true as const,
      })),
      ...files
        .filter(f => !savedNames.has(f.name)) // 🔥 убираем дубли после save
        .map(f => ({
          name: f.name,
          isSaved: false as const,
        })),
    ];
  }, [savedPhotos, files]);

  const visibleFiles = expanded ? allFiles : [];

  const removeNewFile = (name: string) => {
    onFilesChange(files.filter(f => f.name !== name));
  };

  return (
    <div className="project-section">
      <h3>{title}</h3>

      <select
        value={pages}
        onChange={(e) => onPagesChange(Number(e.target.value))}
      >
        {pageOptions.map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (!e.target.files) return;
          handleAddFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button onClick={() => inputRef.current?.click()}>
        Выбрать файлы
      </button>

      {/* =============================== */}
      {/* СКРЫТО ПО УМОЛЧАНИЮ */}
      {/* =============================== */}
      {allFiles.length > 0 && (
        <>
          {!expanded ? (
            <button onClick={() => setExpanded(true)}>
              Показать все ({allFiles.length})
            </button>
          ) : (
            <ul>
              {allFiles.map((item) => (
                <li key={item.isSaved ? item.id : item.name}>
                  {item.name}

                  <button
                    onClick={() => {
                      if (item.isSaved) {
                        onRemoveSaved(item.id);
                      } else {
                        removeNewFile(item.name);
                      }
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}

              <button onClick={() => setExpanded(false)}>
                Свернуть
              </button>
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default ProjectSection;