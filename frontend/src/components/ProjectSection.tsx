import { useRef, useState, useMemo } from "react";
import { MAX_PHOTO_FILE_BYTES, MAX_PHOTO_FILE_LABEL } from "../constants/uploads";

type SavedPhoto = {
  id: number;
  originalName: string;
  yandexPath: string | null;
};

type Props = {
  title: string;
  files: File[];
  pages: number;
  savedPhotos: SavedPhoto[];
  onFilesChange: (files: File[]) => void;
  onPagesChange: (pages: number) => void;
  onRemoveSaved: (id: number) => void;
  onClientError?: (message: string) => void;
};

const pageOptions = Array.from({ length: 301 }, (_, i) => i);

function ProjectSection({
  title,
  files,
  pages,
  savedPhotos,
  onFilesChange,
  onPagesChange,
  onRemoveSaved,
  onClientError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleAddFiles = (newFiles: FileList) => {
    const existing = [
      ...savedPhotos.map(p => p.originalName),
      ...files.map(f => f.name),
    ];

    const result: File[] = [...files];
    const tooLarge: string[] = [];

    Array.from(newFiles).forEach(file => {
      if (file.size > MAX_PHOTO_FILE_BYTES) {
        tooLarge.push(file.name);
        return;
      }
      let name = file.name;
      const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
      const base = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;

      if (existing.includes(name)) {
        let counter = 1;
        while (existing.includes(`${base} (${counter})${ext}`)) {
          counter++;
        }
        name = `${base} (${counter})${ext}`;
      }

      existing.push(name);
      result.push(new File([file], name, { type: file.type }));
    });

    if (tooLarge.length) {
      const message =
        tooLarge.length === 1
          ? `Файл «${tooLarge[0]}» больше ${MAX_PHOTO_FILE_LABEL} и не был добавлен.`
          : `Не добавлены файлы больше ${MAX_PHOTO_FILE_LABEL}: ${tooLarge.map(n => `«${n}»`).join(", ")}.`;
      setLocalError(message);
      onClientError?.(message);
    } else {
      setLocalError(null);
    }

    onFilesChange(result);
  };

  const allFiles = useMemo(() => [
    ...savedPhotos.map(p => ({
      id: p.id,
      name: p.originalName,
      isSaved: true as const,
      onYandex: !!p.yandexPath,
    })),
    ...files.map(f => ({
      id: undefined,
      name: f.name,
      isSaved: false as const,
      onYandex: false,
    })),
  ], [savedPhotos, files]);

  const removeNewFile = (name: string) => {
    onFilesChange(files.filter(f => f.name !== name));
  };

  return (
    <div className="project-section">
      <h3>{title}</h3>

      <div className="section-row">
        <label>Количество страниц*</label>
        <select
          value={pages}
          onChange={(e) => onPagesChange(Number(e.target.value))}
        >
          {pageOptions.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

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

      <div className="file-row" onClick={() => inputRef.current?.click()}>
        <img src="/clip.png" alt="attach" />
        <span className="desktop-only">Выберите файлы (максимальный размер до {MAX_PHOTO_FILE_LABEL})</span>
        <span className="mobile-only">Выберите файлы (до {MAX_PHOTO_FILE_LABEL})</span>
      </div>

      {localError && <div className="inline-error">{localError}</div>}

      {allFiles.length > 0 && (
        <ul className="file-list">
          {expanded && (
            <>
              <p className="file-list-label">Добавленные файлы</p>
              {allFiles.map((item, index) => (
                <li key={`${item.name}-${index}`} className="file-item">
                  <span className="file-name">{item.name}</span>
                  {!item.onYandex && (
                    <button
                      className="file-remove"
                      onClick={() => {
                        if (item.isSaved) {
                          onRemoveSaved(item.id!);
                        } else {
                          removeNewFile(item.name);
                        }
                      }}
                      title="Удалить файл"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </>
          )}

          <button
            className="file-list-toggle"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? "Свернуть" : `Показать все (${allFiles.length})`}
          </button>
        </ul>
      )}
    </div>
  );
}

export default ProjectSection;